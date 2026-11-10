<?php

declare(strict_types=1);

final class Keyring
{
    private const SOURCES = [
        'https://sbg1.scpslgame.com/v5/publickey.php?major=14',
        'https://api.scpslgame.com/v5/publickey.php?major=14',
    ];

    public function __construct(private readonly string $cacheDirectory)
    {
    }

    public function load(): array
    {
        $cache = $this->readCache();
        if (($cache['attemptedAt'] ?? 0) + 900 <= time() && is_dir($this->cacheDirectory)) {
            $cache = $this->refresh($cache);
        }

        $documents = [];
        foreach ($cache['entries'] ?? [] as $entry) {
            $key = self::validate($entry['document'] ?? null);
            if ($key !== null) {
                $documents[$key] = $entry['document'];
            }
        }
        $snapshot = json_decode(file_get_contents(__DIR__ . '/../public/assets/trust/northwood-14.json'), true);
        $key = self::validate($snapshot);
        if ($key !== null) {
            $documents[$key] ??= $snapshot;
        }
        return [
            'documents' => array_values($documents),
            'lastRefresh' => isset($cache['refreshedAt']) ? gmdate(DATE_ATOM, $cache['refreshedAt']) : null,
        ];
    }

    private static function validate(mixed $document): ?string
    {
        if (!is_array($document) || !is_string($document['key'] ?? null)
            || !is_string($document['signature'] ?? null) || strlen($document['key']) > 2048
            || strlen($document['signature']) > 256) {
            return null;
        }
        $signature = base64_decode($document['signature'], true);
        $pem = $document['key'];
        // Both CRLF and LF envelopes exist. Verify the exact bytes received.
        $root = file_get_contents(__DIR__ . '/../public/assets/trust/root.pem');
        if ($root === false || $signature === false || @openssl_verify($pem, $signature, $root, OPENSSL_ALGO_SHA256) !== 1) {
            return null;
        }
        $publicKey = openssl_pkey_get_public($pem);
        $details = $publicKey === false ? false : openssl_pkey_get_details($publicKey);
        if (($details['ec']['curve_name'] ?? null) !== 'secp521r1') {
            return null;
        }
        return hash('sha256', $details['key']);
    }

    private function readCache(): array
    {
        $data = @file_get_contents($this->cacheDirectory . '/northwood-keys.json', false, null, 0, 65536);
        $cache = $data === false ? null : json_decode($data, true);
        return is_array($cache) ? $cache : [];
    }

    private function refresh(array $cache): array
    {
        $lock = @fopen($this->cacheDirectory . '/refresh.lock', 'c');
        if ($lock === false) {
            return $cache;
        }
        try {
            if (!flock($lock, LOCK_EX | LOCK_NB)) {
                return $cache;
            }
            $cache = $this->readCache();
            $now = time();
            if (($cache['attemptedAt'] ?? 0) + 900 > $now) {
                return $cache;
            }
            $cache['attemptedAt'] = $now;
            $context = stream_context_create(['http' => [
                'timeout' => 2, 'follow_location' => 0,
                'header' => "Accept: application/json\r\nUser-Agent: SCPSL-Auth-QR-Manager/1\r\n",
            ]]);
            foreach (self::SOURCES as $source) {
                $raw = @file_get_contents($source, false, $context, 0, 8192);
                $document = $raw === false ? null : json_decode($raw, true);
                $key = self::validate($document);
                if ($key === null) {
                    continue;
                }
                $entries = $cache['entries'] ?? [];
                unset($entries[$key]);
                $entries = [$key => ['document' => $document]] + $entries;
                $cache['entries'] = array_slice($entries, 0, 12, true);
                $cache['refreshedAt'] = $now;
                break;
            }
            $temporary = tempnam($this->cacheDirectory, 'keys-');
            if ($temporary !== false) {
                if (file_put_contents($temporary, json_encode($cache, JSON_THROW_ON_ERROR)) === false
                    || !rename($temporary, $this->cacheDirectory . '/northwood-keys.json')) {
                    unlink($temporary);
                }
            }
            return $cache;
        } finally {
            fclose($lock);
        }
    }
}
