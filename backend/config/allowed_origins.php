<?php

// Browser origins allowed to call the API. Local dev origins are always allowed.
// ALLOWED_ORIGINS is a comma-separated list for deployed frontends. An entry may
// contain "*" to match one address label, e.g.
//   https://entrivodoorlocksystem.vercel.app,https://entrivodoorlocksystem-*-entrivo.vercel.app
// so every Vercel deployment link of this project is accepted too.
$origins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$patterns = [];

$extra = getenv('ALLOWED_ORIGINS') ?: '';
foreach (explode(',', $extra) as $value) {
    $value = rtrim(trim($value), '/');
    if ($value === '') {
        continue;
    }
    if (str_contains($value, '*')) {
        $patterns[] = '#^' . str_replace('\*', '[a-z0-9-]+', preg_quote($value, '#')) . '$#i';
    } elseif (!in_array($value, $origins, true)) {
        $origins[] = $value;
    }
}

// Endpoints echo the request origin only when it is in this list, so add the
// current origin when it matches one of the configured patterns.
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin !== '' && !in_array($requestOrigin, $origins, true)) {
    foreach ($patterns as $pattern) {
        if (preg_match($pattern, $requestOrigin) === 1) {
            $origins[] = $requestOrigin;
            break;
        }
    }
}

return $origins;
