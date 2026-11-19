<?php
declare(strict_types=1);

/**
 * SQLite access and schema migrations (tracked with PRAGMA user_version).
 */
final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $dir = config('data_dir');
            if (!is_dir($dir)) {
                mkdir($dir, 0770, true);
            }
            self::protectDir($dir);
            $pdo = new PDO('sqlite:' . $dir . '/fitness.sqlite');
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            // WAL is faster but not supported on every (network) filesystem; fall back silently.
            try {
                $pdo->exec('PRAGMA journal_mode = WAL');
            } catch (Throwable $e) {
            }
            self::$pdo = $pdo;
            self::migrate($pdo);
        }
        return self::$pdo;
    }

    /** Defence in depth: deny web access even if the data dir ends up inside the web root. */
    private static function protectDir(string $dir): void
    {
        $ht = $dir . '/.htaccess';
        if (!is_file($ht)) {
            @file_put_contents($ht, "Require all denied\nDeny from all\n");
        }
    }

    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function exec(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::exec($sql, $params);
        return (int) self::pdo()->lastInsertId();
    }

    private static function migrate(PDO $pdo): void
    {
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        $migrations = self::migrations();
        $target = count($migrations);
        if ($version >= $target) {
            return;
        }
        $pdo->beginTransaction();
        try {
            for ($v = $version; $v < $target; $v++) {
                $pdo->exec($migrations[$v]);
            }
            $pdo->exec('PRAGMA user_version = ' . $target);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Append-only list: never change an existing migration, add a new one instead. */
    private static function migrations(): array
    {
        return [
            // 1: initial schema
            <<<SQL
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                pass_hash TEXT NOT NULL,
                totp_secret TEXT,
                totp_enabled INTEGER NOT NULL DEFAULT 0,
                totp_last_step INTEGER NOT NULL DEFAULT 0,
                settings TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                user_agent TEXT
            );
            CREATE INDEX idx_sessions_user ON sessions(user_id);
            CREATE TABLE login_attempts (
                id INTEGER PRIMARY KEY,
                ip TEXT NOT NULL,
                username TEXT,
                ts INTEGER NOT NULL
            );
            CREATE INDEX idx_attempts_ts ON login_attempts(ts);
            CREATE TABLE workouts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                uid TEXT NOT NULL,
                name TEXT NOT NULL,
                goal TEXT,
                focus TEXT,
                started_at INTEGER NOT NULL,
                finished_at INTEGER NOT NULL,
                rating INTEGER,
                notes TEXT,
                data TEXT NOT NULL,
                UNIQUE(user_id, uid)
            );
            CREATE INDEX idx_workouts_user_time ON workouts(user_id, started_at);
            CREATE TABLE sets (
                id INTEGER PRIMARY KEY,
                workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL,
                exercise_id TEXT NOT NULL,
                item_index INTEGER NOT NULL,
                set_index INTEGER NOT NULL,
                weight REAL,
                reps INTEGER,
                seconds INTEGER,
                is_warmup INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX idx_sets_user_ex ON sets(user_id, exercise_id);
            CREATE TABLE templates (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                planned_for TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE custom_exercises (
                id TEXT NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                data TEXT NOT NULL,
                PRIMARY KEY (user_id, id)
            );
            CREATE TABLE body_logs (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                weight REAL,
                waist REAL,
                notes TEXT,
                UNIQUE(user_id, date)
            );
            CREATE TABLE photos (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                pose TEXT NOT NULL,
                file TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            SQL,
        ];
    }
}
