<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/ReportsService.php';

$dateFrom = trim((string) ($_GET['date_from'] ?? ''));
$dateTo = trim((string) ($_GET['date_to'] ?? ''));
$role = strtolower(trim((string) ($_GET['role'] ?? 'all')));
$search = trim((string) ($_GET['search'] ?? ''));

$validDate = '/^\d{4}-\d{2}-\d{2}$/';
if (($dateFrom !== '' && !preg_match($validDate, $dateFrom)) || ($dateTo !== '' && !preg_match($validDate, $dateTo))) {
    http_response_code(422);
    echo json_encode(['message' => 'Choose a valid date range.']);
    exit;
}

if ($dateFrom !== '' && $dateTo !== '') {
    if ($dateFrom > $dateTo) {
        [$dateFrom, $dateTo] = [$dateTo, $dateFrom];
    }

    $span = (strtotime($dateTo) - strtotime($dateFrom)) / 86400;
    if ($span > 366) {
        http_response_code(422);
        echo json_encode(['message' => 'Choose a date range of one year or less.']);
        exit;
    }
}

try {
    $report = (new ReportsService(entrivo_pdo()))->build($dateFrom, $dateTo, $role, $search);
    echo json_encode(['message' => 'Reports loaded.', 'report' => $report]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to load reports right now.',
        'error' => $error->getMessage(),
    ]);
}
