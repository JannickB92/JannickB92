<?php
declare(strict_types=1);

final class HttpError extends RuntimeException
{
    public int $status;
    public string $errorCode;

    public function __construct(int $status, string $errorCode, string $message = '')
    {
        parent::__construct($message !== '' ? $message : $errorCode);
        $this->status = $status;
        $this->errorCode = $errorCode;
    }
}

final class Http
{
    private static ?array $body = null;

    public static function isHttps(): bool
    {
        if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
            return true;
        }
        if (config('trust_forwarded_proto') && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
            return true;
        }
        return ($_SERVER['SERVER_PORT'] ?? '') === '443';
    }

    public static function ip(): string
    {
        return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    /** Parsed JSON request body. */
    public static function body(): array
    {
        if (self::$body === null) {
            $raw = file_get_contents('php://input') ?: '';
            if ($raw === '') {
                self::$body = $_POST ?: [];
            } else {
                $data = json_decode($raw, true);
                if (!is_array($data)) {
                    throw new HttpError(400, 'invalid_json');
                }
                self::$body = $data;
            }
        }
        return self::$body;
    }

    public static function input(string $key, $default = null)
    {
        return self::body()[$key] ?? $default;
    }

    public static function securityHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        header('Cache-Control: no-store');
        if (self::isHttps()) {
            header('Strict-Transport-Security: max-age=31536000');
        }
    }

    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
