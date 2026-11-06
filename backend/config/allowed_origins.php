<?php

// Browser origins allowed to call the API. Local dev origins are always allowed;
// add deployed frontends (e.g. https://entrivo.vercel.app) as a comma-separated
// ALLOWED_ORIGINS environment variable.
$origins = ['http://127.0.0.1:5173', 'http://localhost:5173'];

$extra = getenv('ALLOWED_ORIGINS') ?: '';
foreach (explode(',', $extra) as $value) {
    $value = rtrim(trim($value), '/');
    if ($value !== '' && !in_array($value, $origins, true)) {
        $origins[] = $value;
    }
}

return $origins;
