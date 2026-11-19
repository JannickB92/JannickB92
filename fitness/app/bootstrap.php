<?php
declare(strict_types=1);

/*
 * Bootstrap: configuration, error handling and autoloading.
 * No external dependencies: only PHP >= 8.0 with PDO SQLite (standard on shared hosting).
 */

define('APP_ROOT', __DIR__);

$defaults = [
    // Directory for the SQLite database and uploaded photos. Must be writable and NOT web-accessible.
    'data_dir' => APP_ROOT . '/data',
    // Session lifetime (sliding) in days.
    'session_days' => 60,
    // Max failed login attempts per IP / username within the window.
    'login_max_attempts' => 5,
    'login_window_minutes' => 15,
    // Max upload size for progress photos (bytes). Photos are resized client-side first.
    'photo_max_bytes' => 8 * 1024 * 1024,
    // Set to true when behind a proxy that terminates HTTPS and sets X-Forwarded-Proto.
    'trust_forwarded_proto' => true,
];

$config = $defaults;
if (is_file(APP_ROOT . '/config.php')) {
    $custom = require APP_ROOT . '/config.php';
    if (is_array($custom)) {
        $config = array_merge($defaults, $custom);
    }
}
$GLOBALS['APP_CONFIG'] = $config;

function config(string $key)
{
    return $GLOBALS['APP_CONFIG'][$key] ?? null;
}

spl_autoload_register(function (string $class): void {
    $file = APP_ROOT . '/lib/' . $class . '.php';
    if (is_file($file)) {
        require $file;
    }
});

ini_set('display_errors', '0');
error_reporting(E_ALL);
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
