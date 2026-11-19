<?php
declare(strict_types=1);

/**
 * Authentication: password (password_hash), optional TOTP 2FA, DB-backed sessions,
 * and rate limiting of login attempts.
 */
final class Auth
{
    private static ?array $user = null;
    private static bool $resolved = false;

    private static function cookieName(): string
    {
        // The __Host- prefix forces Secure, Path=/ and no Domain: the cookie can't be set by subdomains.
        return Http::isHttps() ? '__Host-fit_sid' : 'fit_sid';
    }

    public static function setupNeeded(): bool
    {
        return Db::one('SELECT COUNT(*) AS n FROM users')['n'] == 0;
    }

    public static function user(): ?array
    {
        if (self::$resolved) {
            return self::$user;
        }
        self::$resolved = true;
        $token = $_COOKIE[self::cookieName()] ?? '';
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
            return null;
        }
        $hash = hash('sha256', $token);
        $now = time();
        $row = Db::one(
            'SELECT s.last_seen, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > ?',
            [$hash, $now]
        );
        if ($row === null) {
            return null;
        }
        // Sliding expiry, written at most once per hour.
        if ($now - (int) $row['last_seen'] > 3600) {
            $expires = $now + config('session_days') * 86400;
            Db::exec('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?', [$now, $expires, $hash]);
            self::setCookie($token, $expires);
        }
        self::$user = $row;
        return $row;
    }

    public static function requireUser(): array
    {
        $u = self::user();
        if ($u === null) {
            throw new HttpError(401, 'not_logged_in');
        }
        return $u;
    }

    public static function setup(string $username, string $password): array
    {
        if (!self::setupNeeded()) {
            throw new HttpError(403, 'setup_done');
        }
        self::validateUsername($username);
        self::validatePassword($password);
        $id = Db::insert(
            'INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)',
            [$username, password_hash($password, PASSWORD_DEFAULT), time()]
        );
        self::startSession($id);
        return Db::one('SELECT * FROM users WHERE id = ?', [$id]);
    }

    /**
     * @return array{status:string, user?:array}
     */
    public static function login(string $username, string $password, string $code): array
    {
        self::throttle($username);
        $user = Db::one('SELECT * FROM users WHERE username = ?', [$username]);
        // Always run password_verify to keep timing similar for unknown users.
        $hash = $user['pass_hash'] ?? '$2y$10$WKT1mjBww.5LgJCnLLQFaeJXyVUlbRbl87k1QDgAt5XYHaIclS53u';
        $ok = password_verify($password, $hash) && $user !== null;
        if (!$ok) {
            self::recordFailure($username);
            throw new HttpError(401, 'invalid_credentials');
        }
        if ((int) $user['totp_enabled'] === 1) {
            if ($code === '') {
                return ['status' => 'totp_required'];
            }
            $step = Totp::verify($user['totp_secret'], $code, (int) $user['totp_last_step']);
            if ($step === null) {
                self::recordFailure($username);
                throw new HttpError(401, 'invalid_code');
            }
            Db::exec('UPDATE users SET totp_last_step = ? WHERE id = ?', [$step, $user['id']]);
        }
        if (password_needs_rehash($user['pass_hash'], PASSWORD_DEFAULT)) {
            Db::exec('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        Db::exec('DELETE FROM login_attempts WHERE ip = ? OR username = ?', [Http::ip(), strtolower($username)]);
        self::startSession((int) $user['id']);
        return ['status' => 'ok', 'user' => $user];
    }

    public static function logout(): void
    {
        $token = $_COOKIE[self::cookieName()] ?? '';
        if (is_string($token) && $token !== '') {
            Db::exec('DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', $token)]);
        }
        self::setCookie('', time() - 3600);
    }

    public static function revokeOtherSessions(int $userId): int
    {
        $token = $_COOKIE[self::cookieName()] ?? '';
        return Db::exec('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [$userId, hash('sha256', (string) $token)]);
    }

    public static function changePassword(array $user, string $current, string $new): void
    {
        if (!password_verify($current, $user['pass_hash'])) {
            throw new HttpError(403, 'wrong_password');
        }
        self::validatePassword($new);
        Db::exec('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $user['id']]);
        self::revokeOtherSessions((int) $user['id']);
    }

    public static function verifyPassword(array $user, string $password): void
    {
        if (!password_verify($password, $user['pass_hash'])) {
            throw new HttpError(403, 'wrong_password');
        }
    }

    private static function startSession(int $userId): void
    {
        $token = bin2hex(random_bytes(32));
        $now = time();
        $expires = $now + config('session_days') * 86400;
        Db::exec(
            'INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
            [hash('sha256', $token), $userId, $now, $now, $expires, substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 200)]
        );
        Db::exec('DELETE FROM sessions WHERE expires_at < ?', [$now]);
        self::setCookie($token, $expires);
    }

    private static function setCookie(string $value, int $expires): void
    {
        setcookie(self::cookieName(), $value, [
            'expires' => $expires,
            'path' => '/',
            'secure' => Http::isHttps(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }

    private static function throttle(string $username): void
    {
        $since = time() - config('login_window_minutes') * 60;
        Db::exec('DELETE FROM login_attempts WHERE ts < ?', [$since]);
        $byIp = Db::one('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?', [Http::ip()])['n'];
        $byUser = Db::one('SELECT COUNT(*) AS n FROM login_attempts WHERE username = ?', [strtolower($username)])['n'];
        $max = config('login_max_attempts');
        if ($byIp >= $max || $byUser >= $max) {
            throw new HttpError(429, 'too_many_attempts');
        }
    }

    private static function recordFailure(string $username): void
    {
        Db::exec('INSERT INTO login_attempts (ip, username, ts) VALUES (?, ?, ?)', [Http::ip(), strtolower($username), time()]);
    }

    private static function validateUsername(string $u): void
    {
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $u)) {
            throw new HttpError(422, 'invalid_username');
        }
    }

    public static function validatePassword(string $p): void
    {
        if (strlen($p) < 10 || strlen($p) > 200) {
            throw new HttpError(422, 'weak_password');
        }
    }
}
