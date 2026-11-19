<?php
declare(strict_types=1);

/**
 * JSON API. Routes are passed as ?r=group/action. Only GET and POST are used,
 * because some shared hosts block PUT/DELETE.
 */
final class Api
{
    private const ROUTES = [
        'GET auth/state' => 'authState',
        'POST auth/setup' => 'authSetup',
        'POST auth/login' => 'authLogin',
        'POST auth/logout' => 'authLogout',
        'POST auth/password' => 'authPassword',
        'POST auth/totp-begin' => 'totpBegin',
        'POST auth/totp-enable' => 'totpEnable',
        'POST auth/totp-disable' => 'totpDisable',
        'POST auth/revoke-others' => 'revokeOthers',
        'GET sync' => 'sync',
        'POST settings/save' => 'settingsSave',
        'POST workouts/save' => 'workoutSave',
        'POST workouts/delete' => 'workoutDelete',
        'POST templates/save' => 'templateSave',
        'POST templates/delete' => 'templateDelete',
        'POST custom/save' => 'customSave',
        'POST custom/delete' => 'customDelete',
        'POST body/save' => 'bodySave',
        'POST body/delete' => 'bodyDelete',
        'POST photos/upload' => 'photoUpload',
        'POST photos/delete' => 'photoDelete',
        'GET photos/file' => 'photoFile',
        'GET export/json' => 'exportJson',
        'GET export/csv' => 'exportCsv',
    ];

    public static function handle(): void
    {
        Http::securityHeaders();
        try {
            $route = Http::method() . ' ' . (string) ($_GET['r'] ?? '');
            $handler = self::ROUTES[$route] ?? null;
            if ($handler === null) {
                throw new HttpError(404, 'not_found');
            }
            if (Http::method() === 'POST' && ($_SERVER['HTTP_X_FIT'] ?? '') !== '1') {
                // Custom header can't be sent cross-site without a CORS preflight: CSRF protection.
                throw new HttpError(403, 'csrf');
            }
            $result = self::$handler();
            if ($result !== null) {
                Http::json($result);
            }
        } catch (HttpError $e) {
            Http::json(['error' => $e->errorCode], $e->status);
        } catch (Throwable $e) {
            error_log('[fitness] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            Http::json(['error' => 'server_error'], 500);
        }
    }

    // ---------------------------------------------------------------- auth

    private static function publicUser(array $u): array
    {
        return [
            'username' => $u['username'],
            'totp' => (int) $u['totp_enabled'] === 1,
        ];
    }

    private static function authState(): array
    {
        $u = Auth::user();
        return [
            'setup_needed' => Auth::setupNeeded(),
            'user' => $u ? self::publicUser($u) : null,
        ];
    }

    private static function authSetup(): array
    {
        $u = Auth::setup(self::str('username', 40), self::str('password', 200));
        return ['user' => self::publicUser($u)];
    }

    private static function authLogin(): array
    {
        $res = Auth::login(self::str('username', 40), self::str('password', 200), self::str('code', 10));
        if ($res['status'] !== 'ok') {
            return ['status' => $res['status']];
        }
        return ['status' => 'ok', 'user' => self::publicUser($res['user'])];
    }

    private static function authLogout(): array
    {
        Auth::logout();
        return ['ok' => true];
    }

    private static function authPassword(): array
    {
        $u = Auth::requireUser();
        Auth::changePassword($u, self::str('current', 200), self::str('new', 200));
        return ['ok' => true];
    }

    private static function totpBegin(): array
    {
        $u = Auth::requireUser();
        Auth::verifyPassword($u, self::str('password', 200));
        if ((int) $u['totp_enabled'] === 1) {
            throw new HttpError(409, 'totp_already_enabled');
        }
        $secret = Totp::generateSecret();
        Db::exec('UPDATE users SET totp_secret = ? WHERE id = ?', [$secret, $u['id']]);
        $host = preg_replace('/[^A-Za-z0-9.-]/', '', $_SERVER['HTTP_HOST'] ?? 'fitness');
        return ['secret' => $secret, 'uri' => Totp::uri($secret, $u['username'], $host ?: 'Fitness')];
    }

    private static function totpEnable(): array
    {
        $u = Auth::requireUser();
        if (empty($u['totp_secret'])) {
            throw new HttpError(409, 'totp_not_started');
        }
        $step = Totp::verify($u['totp_secret'], self::str('code', 10));
        if ($step === null) {
            throw new HttpError(422, 'invalid_code');
        }
        Db::exec('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', [$step, $u['id']]);
        Auth::revokeOtherSessions((int) $u['id']);
        return ['ok' => true];
    }

    private static function totpDisable(): array
    {
        $u = Auth::requireUser();
        Auth::verifyPassword($u, self::str('password', 200));
        if ((int) $u['totp_enabled'] === 1 && Totp::verify($u['totp_secret'], self::str('code', 10)) === null) {
            throw new HttpError(422, 'invalid_code');
        }
        Db::exec('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?', [$u['id']]);
        return ['ok' => true];
    }

    private static function revokeOthers(): array
    {
        $u = Auth::requireUser();
        return ['revoked' => Auth::revokeOtherSessions((int) $u['id'])];
    }

    // ---------------------------------------------------------------- data

    /** Everything the client needs, in one request. The dataset of one person stays small. */
    private static function sync(): array
    {
        $u = Auth::requireUser();
        $uid = (int) $u['id'];
        $workouts = array_map([self::class, 'workoutOut'], Db::all(
            'SELECT * FROM workouts WHERE user_id = ? ORDER BY started_at', [$uid]
        ));
        $templates = array_map(function (array $t): array {
            return [
                'id' => (int) $t['id'],
                'name' => $t['name'],
                'planned_for' => $t['planned_for'],
                'updated_at' => (int) $t['updated_at'],
            ] + json_decode($t['data'], true);
        }, Db::all('SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC', [$uid]));
        $custom = array_map(fn ($r) => json_decode($r['data'], true), Db::all(
            'SELECT data FROM custom_exercises WHERE user_id = ?', [$uid]
        ));
        $body = array_map(fn ($r) => [
            'id' => (int) $r['id'], 'date' => $r['date'],
            'weight' => $r['weight'] !== null ? (float) $r['weight'] : null,
            'waist' => $r['waist'] !== null ? (float) $r['waist'] : null,
            'notes' => $r['notes'],
        ], Db::all('SELECT * FROM body_logs WHERE user_id = ? ORDER BY date', [$uid]));
        $photos = array_map(fn ($r) => [
            'id' => (int) $r['id'], 'date' => $r['date'], 'pose' => $r['pose'],
        ], Db::all('SELECT id, date, pose FROM photos WHERE user_id = ? ORDER BY date, id', [$uid]));

        return [
            'user' => self::publicUser($u),
            'settings' => json_decode($u['settings'], true) ?: new stdClass(),
            'workouts' => $workouts,
            'templates' => $templates,
            'custom' => $custom,
            'body' => $body,
            'photos' => $photos,
            'server_time' => time(),
        ];
    }

    private static function workoutOut(array $w): array
    {
        $data = json_decode($w['data'], true) ?: [];
        return [
            'id' => (int) $w['id'],
            'uid' => $w['uid'],
            'name' => $w['name'],
            'goal' => $w['goal'],
            'focus' => $w['focus'],
            'started_at' => (int) $w['started_at'],
            'finished_at' => (int) $w['finished_at'],
            'rating' => $w['rating'] !== null ? (int) $w['rating'] : null,
            'notes' => $w['notes'],
            'items' => $data['items'] ?? [],
        ];
    }

    private static function settingsSave(): array
    {
        $u = Auth::requireUser();
        $settings = Http::input('settings');
        if (!is_array($settings)) {
            throw new HttpError(422, 'invalid_settings');
        }
        $json = json_encode($settings, JSON_UNESCAPED_UNICODE);
        if (strlen($json) > 20000) {
            throw new HttpError(413, 'too_large');
        }
        Db::exec('UPDATE users SET settings = ? WHERE id = ?', [$json, $u['id']]);
        return ['ok' => true];
    }

    /** Idempotent upsert by client-generated uid (so offline retries never create duplicates). */
    private static function workoutSave(): array
    {
        $u = Auth::requireUser();
        $uid = (int) $u['id'];
        $w = Http::input('workout');
        if (!is_array($w)) {
            throw new HttpError(422, 'invalid_workout');
        }
        $clientUid = (string) ($w['uid'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $clientUid)) {
            throw new HttpError(422, 'invalid_uid');
        }
        $items = [];
        foreach (array_slice((array) ($w['items'] ?? []), 0, 80) as $it) {
            if (!is_array($it) || !self::validExerciseId($it['ex'] ?? null)) {
                continue;
            }
            $sets = [];
            foreach (array_slice((array) ($it['sets'] ?? []), 0, 30) as $s) {
                if (!is_array($s)) {
                    continue;
                }
                $sets[] = [
                    'w' => self::num($s['w'] ?? null, 0, 1000),
                    'r' => self::int($s['r'] ?? null, 0, 1000),
                    's' => self::int($s['s'] ?? null, 0, 36000),
                    'warm' => !empty($s['warm']),
                    'done' => !empty($s['done']),
                ];
            }
            $items[] = [
                'ex' => $it['ex'],
                'group' => substr((string) ($it['group'] ?? ''), 0, 12),
                'rest' => self::int($it['rest'] ?? null, 0, 900),
                'target' => self::int($it['target'] ?? null, 0, 3600),
                'sets' => $sets,
            ];
        }
        $started = self::int($w['started_at'] ?? null, 0, PHP_INT_MAX) ?? time();
        $finished = self::int($w['finished_at'] ?? null, 0, PHP_INT_MAX) ?? time();
        $rating = self::int($w['rating'] ?? null, 1, 5);
        $row = [
            substr(trim((string) ($w['name'] ?? 'Training')), 0, 100) ?: 'Training',
            substr((string) ($w['goal'] ?? ''), 0, 20),
            substr((string) ($w['focus'] ?? ''), 0, 20),
            $started, max($started, $finished), $rating,
            substr((string) ($w['notes'] ?? ''), 0, 4000),
            json_encode(['items' => $items], JSON_UNESCAPED_UNICODE),
        ];

        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            $existing = Db::one('SELECT id FROM workouts WHERE user_id = ? AND uid = ?', [$uid, $clientUid]);
            if ($existing) {
                $id = (int) $existing['id'];
                Db::exec('UPDATE workouts SET name=?, goal=?, focus=?, started_at=?, finished_at=?, rating=?, notes=?, data=? WHERE id = ?', array_merge($row, [$id]));
                Db::exec('DELETE FROM sets WHERE workout_id = ?', [$id]);
            } else {
                $id = Db::insert('INSERT INTO workouts (name, goal, focus, started_at, finished_at, rating, notes, data, user_id, uid) VALUES (?,?,?,?,?,?,?,?,?,?)', array_merge($row, [$uid, $clientUid]));
            }
            $st = $pdo->prepare('INSERT INTO sets (workout_id, user_id, exercise_id, item_index, set_index, weight, reps, seconds, is_warmup) VALUES (?,?,?,?,?,?,?,?,?)');
            foreach ($items as $i => $it) {
                foreach ($it['sets'] as $j => $s) {
                    if ($s['done']) {
                        $st->execute([$id, $uid, $it['ex'], $i, $j, $s['w'], $s['r'], $s['s'], $s['warm'] ? 1 : 0]);
                    }
                }
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return ['workout' => self::workoutOut(Db::one('SELECT * FROM workouts WHERE id = ?', [$id]))];
    }

    private static function workoutDelete(): array
    {
        $u = Auth::requireUser();
        Db::exec('DELETE FROM workouts WHERE id = ? AND user_id = ?', [self::int(Http::input('id'), 1, PHP_INT_MAX), $u['id']]);
        return ['ok' => true];
    }

    private static function templateSave(): array
    {
        $u = Auth::requireUser();
        $t = Http::input('template');
        if (!is_array($t)) {
            throw new HttpError(422, 'invalid_template');
        }
        $name = substr(trim((string) ($t['name'] ?? '')), 0, 100) ?: 'Training';
        $planned = $t['planned_for'] ?? null;
        if ($planned !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $planned)) {
            $planned = null;
        }
        $items = [];
        foreach (array_slice((array) ($t['items'] ?? []), 0, 80) as $it) {
            if (!is_array($it) || !self::validExerciseId($it['ex'] ?? null)) {
                continue;
            }
            $items[] = [
                'ex' => $it['ex'],
                'group' => substr((string) ($it['group'] ?? ''), 0, 12),
                'sets' => self::int($it['sets'] ?? 3, 1, 20) ?? 3,
                'target' => self::int($it['target'] ?? null, 0, 3600),
                'rest' => self::int($it['rest'] ?? null, 0, 900),
            ];
        }
        $data = json_encode([
            'goal' => substr((string) ($t['goal'] ?? ''), 0, 20),
            'focus' => substr((string) ($t['focus'] ?? ''), 0, 20),
            'items' => $items,
        ], JSON_UNESCAPED_UNICODE);
        $now = time();
        $id = self::int($t['id'] ?? null, 1, PHP_INT_MAX);
        if ($id !== null) {
            $n = Db::exec('UPDATE templates SET name=?, data=?, planned_for=?, updated_at=? WHERE id=? AND user_id=?', [$name, $data, $planned, $now, $id, $u['id']]);
            if ($n === 0) {
                throw new HttpError(404, 'not_found');
            }
        } else {
            $id = Db::insert('INSERT INTO templates (user_id, name, data, planned_for, created_at, updated_at) VALUES (?,?,?,?,?,?)', [$u['id'], $name, $data, $planned, $now, $now]);
        }
        return ['id' => $id];
    }

    private static function templateDelete(): array
    {
        $u = Auth::requireUser();
        Db::exec('DELETE FROM templates WHERE id = ? AND user_id = ?', [self::int(Http::input('id'), 1, PHP_INT_MAX), $u['id']]);
        return ['ok' => true];
    }

    private static function customSave(): array
    {
        $u = Auth::requireUser();
        $e = Http::input('exercise');
        if (!is_array($e) || !preg_match('/^c_[a-z0-9_]{3,40}$/', (string) ($e['id'] ?? ''))) {
            throw new HttpError(422, 'invalid_exercise');
        }
        $clean = [
            'id' => $e['id'],
            'name' => substr(trim((string) ($e['name'] ?? '')), 0, 80),
            'pattern' => substr((string) ($e['pattern'] ?? 'other'), 0, 20),
            'muscles' => array_values(array_slice(array_map(fn ($m) => substr((string) $m, 0, 20), (array) ($e['muscles'] ?? [])), 0, 6)),
            'equip' => array_values(array_slice(array_map(fn ($m) => substr((string) $m, 0, 20), (array) ($e['equip'] ?? [])), 0, 6)),
            'type' => ($e['type'] ?? '') === 'time' ? 'time' : 'reps',
            'reps' => self::int($e['reps'] ?? 10, 1, 3600) ?? 10,
            'rest' => self::int($e['rest'] ?? 90, 0, 900) ?? 90,
            'inc' => self::num($e['inc'] ?? 2.5, 0, 50) ?? 2.5,
            'tips' => array_values(array_slice(array_map(fn ($m) => substr((string) $m, 0, 300), (array) ($e['tips'] ?? [])), 0, 8)),
            'link' => preg_match('#^https://#', (string) ($e['link'] ?? '')) ? substr((string) $e['link'], 0, 300) : '',
            'custom' => true,
        ];
        if ($clean['name'] === '') {
            throw new HttpError(422, 'invalid_exercise');
        }
        Db::exec('INSERT OR REPLACE INTO custom_exercises (id, user_id, data) VALUES (?, ?, ?)', [$clean['id'], $u['id'], json_encode($clean, JSON_UNESCAPED_UNICODE)]);
        return ['exercise' => $clean];
    }

    private static function customDelete(): array
    {
        $u = Auth::requireUser();
        Db::exec('DELETE FROM custom_exercises WHERE id = ? AND user_id = ?', [(string) Http::input('id'), $u['id']]);
        return ['ok' => true];
    }

    private static function bodySave(): array
    {
        $u = Auth::requireUser();
        $date = (string) Http::input('date');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new HttpError(422, 'invalid_date');
        }
        Db::exec(
            'INSERT INTO body_logs (user_id, date, weight, waist, notes) VALUES (?,?,?,?,?)
             ON CONFLICT(user_id, date) DO UPDATE SET weight=excluded.weight, waist=excluded.waist, notes=excluded.notes',
            [$u['id'], $date, self::num(Http::input('weight'), 20, 400), self::num(Http::input('waist'), 30, 250), substr((string) Http::input('notes', ''), 0, 1000)]
        );
        return ['ok' => true];
    }

    private static function bodyDelete(): array
    {
        $u = Auth::requireUser();
        Db::exec('DELETE FROM body_logs WHERE id = ? AND user_id = ?', [self::int(Http::input('id'), 1, PHP_INT_MAX), $u['id']]);
        return ['ok' => true];
    }

    // ---------------------------------------------------------------- photos

    private static function photoDir(int $userId): string
    {
        $dir = config('data_dir') . '/photos/' . $userId;
        if (!is_dir($dir)) {
            mkdir($dir, 0770, true);
        }
        return $dir;
    }

    private static function photoUpload(): array
    {
        $u = Auth::requireUser();
        $f = $_FILES['photo'] ?? null;
        if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
            throw new HttpError(422, 'upload_failed');
        }
        if ($f['size'] > config('photo_max_bytes')) {
            throw new HttpError(413, 'too_large');
        }
        $info = @getimagesize($f['tmp_name']);
        $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'];
        if ($info === false || !isset($types[$info[2]])) {
            throw new HttpError(422, 'not_an_image');
        }
        $date = (string) ($_POST['date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }
        $pose = in_array($_POST['pose'] ?? '', ['voor', 'zij', 'achter', 'overig'], true) ? $_POST['pose'] : 'voor';
        $file = bin2hex(random_bytes(16)) . '.' . $types[$info[2]];
        if (!move_uploaded_file($f['tmp_name'], self::photoDir((int) $u['id']) . '/' . $file)) {
            throw new HttpError(500, 'store_failed');
        }
        $id = Db::insert('INSERT INTO photos (user_id, date, pose, file, created_at) VALUES (?,?,?,?,?)', [$u['id'], $date, $pose, $file, time()]);
        return ['photo' => ['id' => $id, 'date' => $date, 'pose' => $pose]];
    }

    private static function photoDelete(): array
    {
        $u = Auth::requireUser();
        $p = Db::one('SELECT * FROM photos WHERE id = ? AND user_id = ?', [self::int(Http::input('id'), 1, PHP_INT_MAX), $u['id']]);
        if ($p) {
            @unlink(self::photoDir((int) $u['id']) . '/' . basename($p['file']));
            Db::exec('DELETE FROM photos WHERE id = ?', [$p['id']]);
        }
        return ['ok' => true];
    }

    private static function photoFile(): ?array
    {
        $u = Auth::requireUser();
        $p = Db::one('SELECT * FROM photos WHERE id = ? AND user_id = ?', [self::int($_GET['id'] ?? null, 1, PHP_INT_MAX), $u['id']]);
        $path = $p ? self::photoDir((int) $u['id']) . '/' . basename($p['file']) : '';
        if (!$p || !is_file($path)) {
            throw new HttpError(404, 'not_found');
        }
        $mime = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][pathinfo($path, PATHINFO_EXTENSION)] ?? 'application/octet-stream';
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: private, max-age=31536000, immutable');
        readfile($path);
        return null;
    }

    // ---------------------------------------------------------------- export

    private static function exportJson(): ?array
    {
        $data = self::sync();
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="fitness-export-' . date('Y-m-d') . '.json"');
        echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return null;
    }

    private static function exportCsv(): ?array
    {
        $u = Auth::requireUser();
        $rows = Db::all(
            'SELECT w.started_at, w.name AS workout, s.exercise_id, s.set_index, s.weight, s.reps, s.seconds, s.is_warmup
             FROM sets s JOIN workouts w ON w.id = s.workout_id WHERE s.user_id = ? ORDER BY w.started_at, s.item_index, s.set_index',
            [$u['id']]
        );
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="fitness-sets-' . date('Y-m-d') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['datum', 'training', 'oefening', 'set', 'gewicht_kg', 'herhalingen', 'seconden', 'opwarmset']);
        foreach ($rows as $r) {
            fputcsv($out, [date('Y-m-d H:i', (int) $r['started_at']), $r['workout'], $r['exercise_id'], (int) $r['set_index'] + 1, $r['weight'], $r['reps'], $r['seconds'], $r['is_warmup']]);
        }
        fclose($out);
        return null;
    }

    // ---------------------------------------------------------------- input helpers

    private static function str(string $key, int $max): string
    {
        $v = Http::input($key, '');
        if (!is_string($v)) {
            throw new HttpError(422, 'invalid_' . $key);
        }
        return substr($v, 0, $max);
    }

    private static function int($v, int $min, int $max): ?int
    {
        if ($v === null || $v === '' || !is_numeric($v)) {
            return null;
        }
        return max($min, min($max, (int) round((float) $v)));
    }

    private static function num($v, float $min, float $max): ?float
    {
        if ($v === null || $v === '' || !is_numeric($v)) {
            return null;
        }
        return max($min, min($max, round((float) $v, 2)));
    }

    private static function validExerciseId($id): bool
    {
        return is_string($id) && preg_match('/^[a-z0-9_]{2,44}$/', $id) === 1;
    }
}
