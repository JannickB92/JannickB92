<?php
declare(strict_types=1);

// Entry point for the JSON API. The application code lives outside the web root in ../../app.
// If your host places this folder elsewhere, adjust the path below.
require __DIR__ . '/../../app/bootstrap.php';

Api::handle();
