<?php

require_once dirname(__DIR__) . '/models/FingerprintSyncQueue.php';
require_once dirname(__DIR__) . '/services/FingerprintSyncService.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';

function expectPickupTimeout(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** Inject the connection without running a model constructor or schema migration. */
function pickupQueue(PDO $pdo): FingerprintSyncQueue
{
    $reflection = new ReflectionClass(FingerprintSyncQueue::class);
    $queue = $reflection->newInstanceWithoutConstructor();
    $reflection->getProperty('conn')->setValue($queue, $pdo);
    return $queue;
}

/** Simulate a claim or fresh retry after expiration reads a candidate's old state. */
class PickupRaceQueue extends FingerprintSyncQueue
{
    public int $raceId = 0;
    public string $race = '';

    public function __construct(private PDO $testPdo)
    {
        (new ReflectionProperty(FingerprintSyncQueue::class, 'conn'))->setValue($this, $testPdo);
    }

    public function getJobById(int $queueId): ?array
    {
        $job = parent::getJobById($queueId);

        if ($job && $queueId === $this->raceId) {
            $this->raceId = 0;
            $sql = $this->race === 'claim'
                ? "UPDATE fingerprint_sync_queue SET status = 'syncing', processing_at = NOW() WHERE id = :id"
                : "UPDATE fingerprint_sync_queue SET queued_at = NOW() WHERE id = :id";
            $this->testPdo->prepare($sql)->execute(['id' => $queueId]);
        }

        return $job;
    }
}

$pdo = entrivo_pdo();
$temporaryTables = [
    'fingerprint_sync_queue', 'fingerprints', 'users', 'fingerprint_devices',
    'faculty_info', 'staff_info', 'admin_info', 'activity_transactions',
];

// Every application table used below is shadowed by a connection-local temporary
// table before any fixtures or model calls run. No real rows or schemas are edited.
try {
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_sync_queue (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        fingerprint_id INT NOT NULL, device_id INT NOT NULL,
        status ENUM('pending', 'syncing', 'synced', 'failed') NOT NULL DEFAULT 'pending',
        progress_step VARCHAR(32) NULL, attempts INT UNSIGNED NOT NULL DEFAULT 0,
        error_message TEXT NULL, queued_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        processing_at TIMESTAMP NULL, synced_at TIMESTAMP NULL,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        active_sync_key VARCHAR(64) NULL UNIQUE
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TEMPORARY TABLE fingerprints (
        fingerprint_id INT PRIMARY KEY, user_id INT, finger_name VARCHAR(50),
        shared_door_slot INT NULL, door_sync_status VARCHAR(20) DEFAULT 'pending'
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, username VARCHAR(50), email VARCHAR(100), role VARCHAR(32)) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY, device_name VARCHAR(100), device_code VARCHAR(50), location VARCHAR(100), description VARCHAR(255), device_type VARCHAR(20), status VARCHAR(20)) ENGINE=InnoDB');

    foreach (['faculty_info', 'staff_info', 'admin_info'] as $profileTable) {
        $pdo->exec("CREATE TEMPORARY TABLE {$profileTable} (user_id INT, first_name VARCHAR(50), middle_name VARCHAR(50), last_name VARCHAR(50), extension_name VARCHAR(20)) ENGINE=InnoDB");
    }
    $pdo->exec("CREATE TEMPORARY TABLE activity_transactions (
        transaction_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        actor_user_id INT NULL, target_user_id INT NULL, activity_type VARCHAR(32),
        entity_type VARCHAR(64), entity_id VARCHAR(64), description VARCHAR(512),
        status VARCHAR(32), ip_address VARCHAR(45) NULL, user_agent VARCHAR(512) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB");

    $frozen = new DateTimeImmutable('2026-10-21 10:00:00', new DateTimeZone('Asia/Manila'));
    $pdo->exec('SET timestamp = ' . $frozen->getTimestamp());
    $pdo->exec("INSERT INTO users VALUES (1, 'fixture.user', 'fixture@example.invalid', 'staff')");
    $pdo->exec("INSERT INTO fingerprint_devices VALUES
        (1, 'Sensor B', 'SENSORB_TEST', 'Fixture', '', 'door', 'active'),
        (2, 'Inactive controller', 'INACTIVE_TEST', 'Fixture', '', 'door', 'inactive'),
        (3, 'Enrollment device', 'ENROLL_TEST', 'Fixture', '', 'enrollment', 'active')");

    for ($id = 1; $id <= 30; ++$id) {
        $pdo->prepare('INSERT INTO fingerprints (fingerprint_id, user_id, finger_name) VALUES (?, 1, ?)')->execute([$id, 'Fixture finger ' . $id]);
    }

    $insert = $pdo->prepare('INSERT INTO fingerprint_sync_queue (id, fingerprint_id, device_id, status, queued_at, processing_at, active_sync_key) VALUES (:id, :id_fingerprint, :device_id, :status, :queued_at, :processing_at, :active_key)');
    $add = static function (int $id, int $ageSeconds, int $deviceId = 1, string $status = 'pending', ?int $processingAge = null) use ($insert, $frozen): void {
        $insert->execute([
            'id' => $id, 'id_fingerprint' => $id, 'device_id' => $deviceId,
            'status' => $status,
            'queued_at' => $frozen->modify('-' . $ageSeconds . ' seconds')->format('Y-m-d H:i:s'),
            'processing_at' => $processingAge === null ? null : $frozen->modify('-' . $processingAge . ' seconds')->format('Y-m-d H:i:s'),
            'active_key' => in_array($status, ['pending', 'syncing'], true) ? $id . ':' . $deviceId : null,
        ]);
    };
    $queue = pickupQueue($pdo);

    $add(1, 299);
    $add(2, 300);
    $add(3, 301, 2);
    $add(4, 600, 99);
    $add(5, 600, 3);
    $add(6, 3600, 1, 'syncing', 299);
    $add(7, 3600, 1, 'syncing', 1801);
    $add(8, 3600, 1, 'synced');
    $add(9, 3600, 1, 'failed');

    $expired = $queue->failIdleJobs();
    $expiredIds = array_column($expired, 'id');
    sort($expiredIds);
    expectPickupTimeout(array_map('intval', $expiredIds) === [2, 3, 4, 5, 7], 'Only pending jobs at least five minutes old and existing thirty-minute processing timeouts should expire.');
    expectPickupTimeout($queue->getJobById(1)['status'] === 'pending', 'A job at 4:59 must remain queued.');
    expectPickupTimeout($queue->getJobById(6)['status'] === 'syncing', 'A claimed job must not be cancelled by the five-minute pickup deadline.');
    foreach ([2 => 'no_response', 3 => 'inactive', 4 => 'not_registered', 5 => 'not_registered'] as $id => $reason) {
        $job = $queue->getJobById($id);
        expectPickupTimeout($job['status'] === 'failed', 'An expired queued job must be closed.');
        expectPickupTimeout($job['error_message'] === FingerprintSyncQueue::PICKUP_TIMEOUT_MESSAGES[$reason], 'Cancellation must explain the target controller problem.');
        expectPickupTimeout(!$queue->hasActiveJobForFingerprint($id), 'Cancellation must release the active queue slot.');
        expectPickupTimeout($queue->createJob($id, (int) $job['device_id']) > 0, 'An expired job must not prevent a new sync from being queued.');
    }
    expectPickupTimeout($queue->getDoorDeviceSyncIssue(1) === null, 'An active registered controller must remain eligible.');
    expectPickupTimeout($queue->getDoorDeviceSyncIssue(2) === 'inactive', 'An inactive controller must be identified.');
    expectPickupTimeout($queue->getDoorDeviceSyncIssue(99) === 'not_registered', 'An unregistered controller must be identified.');

    // Clear only the known temporary queue; keep registry and identity fixtures.
    $pdo->exec('DELETE FROM fingerprint_sync_queue');
    $add(10, 300);
    $add(11, 299);
    $claimed = $queue->claimNextPendingJob(1);
    expectPickupTimeout((int) ($claimed['id'] ?? 0) === 11, 'A returning controller must skip a job whose five-minute deadline has passed.');
    expectPickupTimeout($claimed['status'] === 'syncing' && (int) $claimed['attempts'] === 1, 'A fresh queue item must still be claimed normally.');
    expectPickupTimeout($queue->claimNextPendingJob(1) === null, 'An expired pending job must never be handed to a controller.');
    expectPickupTimeout(!$pdo->inTransaction(), 'Claiming or skipping must release the transaction.');
    expectPickupTimeout(count($queue->failIdleJobs()) === 1, 'A previously skipped expired job must be cancelled on expiration.');

    expectPickupTimeout($queue->retryJob(10), 'A cancelled job must remain available for retry.');
    $retried = $queue->getJobById(10);
    expectPickupTimeout($retried['status'] === 'pending' && $retried['queued_at'] === $frozen->format('Y-m-d H:i:s'), 'A manual retry must receive a fresh pickup deadline.');
    expectPickupTimeout($queue->failIdleJobs() === [], 'A fresh retry and a recent claim must remain active.');

    $pdo->exec('DELETE FROM fingerprint_sync_queue');
    $add(12, 3600, 1, 'syncing', 61);
    $queue->requeueStaleSyncingJobs(1, 1);
    $requeued = $queue->getJobById(12);
    expectPickupTimeout($requeued['status'] === 'pending' && $requeued['queued_at'] === $frozen->format('Y-m-d H:i:s'), 'An acknowledgment retry must receive a fresh pickup window.');
    expectPickupTimeout($queue->failIdleJobs() === [], 'An automatic retry must not expire using its previous queued time.');

    foreach (['claim', 'retry'] as $race) {
        $pdo->exec('DELETE FROM fingerprint_sync_queue');
        $id = $race === 'claim' ? 13 : 14;
        $add($id, 600);
        $raceQueue = new PickupRaceQueue($pdo);
        $raceQueue->raceId = $id;
        $raceQueue->race = $race;
        expectPickupTimeout($raceQueue->failIdleJobs() === [], 'Expiration must not overwrite a concurrent ' . $race . '.');
        expectPickupTimeout($queue->getJobById($id)['status'] === ($race === 'claim' ? 'syncing' : 'pending'), 'Concurrent state must be preserved.');
    }

    $serviceReflection = new ReflectionClass(FingerprintSyncService::class);
    $service = $serviceReflection->newInstanceWithoutConstructor();
    $timedOutJob = $expired[0];
    $timedOutJob['error_message'] = FingerprintSyncQueue::PICKUP_TIMEOUT_MESSAGES['no_response'];
    $normalized = $serviceReflection->getMethod('normalizeJob')->invoke($service, $timedOutJob);
    expectPickupTimeout($normalized['is_cancelled'] === true && $normalized['cancellation_reason'] === 'pickup_timeout', 'The API must expose pickup cancellation separately from general failure.');
    expectPickupTimeout($normalized['controller_issue'] === 'no_response' && $normalized['is_closed'] && $normalized['can_retry'], 'A pickup cancellation must expose its controller reason and remain closed but retryable.');

    $activityLog = new ActivityLogService($pdo);
    (new ReflectionProperty(ActivityLogService::class, 'tableReady'))->setValue($activityLog, true);
    $activityLog->recordFingerprintSync('cancelled', $timedOutJob, null, 'Cancelled');
    $event = $pdo->query('SELECT description, status FROM activity_transactions ORDER BY transaction_id DESC LIMIT 1')->fetch();
    expectPickupTimeout($event['status'] === 'Cancelled', 'A timeout log must report successful cancellation.');
    expectPickupTimeout(str_contains($event['description'], $timedOutJob['error_message']), 'The cancellation log must preserve the reason shown in the modal.');
    expectPickupTimeout(!str_contains($event['description'], 'Unable to cancel'), 'A cancelled timeout must not claim cancellation failed.');

    echo "PASS: five-minute pickup boundary, controller reasons, closed states, late claim prevention, fresh retry deadlines, thirty-minute claimed-job timeout, claim/retry race protection, API cancellation details, and cancellation log reason.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    $pdo->exec('SET timestamp = 0');
    foreach ($temporaryTables as $table) {
        $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
    }
}
