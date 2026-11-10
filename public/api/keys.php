<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/src/Keyring.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    echo '{"error":"Use GET."}';
    exit;
}

try {
    $directory = getenv('SCPSL_QR_KEY_CACHE') ?: sys_get_temp_dir() . '/scpsl-qr-keyring';
    if (!is_dir($directory)) {
        @mkdir($directory, 0700, true);
    }
    $keyring = (new Keyring($directory))->load();
    http_response_code($keyring['documents'] === [] ? 503 : 200);
    echo json_encode($keyring, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log('SCP:SL signing key synchronization failed: ' . $error::class);
    http_response_code(503);
    echo '{"error":"Signing key synchronization unavailable."}';
}
