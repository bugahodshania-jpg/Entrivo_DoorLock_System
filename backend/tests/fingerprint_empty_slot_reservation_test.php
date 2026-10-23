<?php

require_once dirname(__DIR__) . '/services/FingerprintEnrollmentService.php';

function expectEmptySlot(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo = entrivo_pdo();
$tables = ['fingerprint_enrollment_jobs', 'fingerprint_devices', 'fingerprints', 'direct_fingerprint_import_jobs'];

try {
    // Connection-local shadows isolate every query and write from production data.
    $pdo->exec("CREATE TEMPORARY TABLE fingerprint_enrollment_jobs (
        job_id INT PRIMARY KEY, user_id INT, finger_name VARCHAR(50),
        enrollment_device_id INT NULL, assigned_slot INT NULL, status VARCHAR(20),
        progress INT, current_step VARCHAR(150), error_message TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME NULL, finished_at DATETIME NULL
    ) ENGINE=InnoDB");
    $pdo->exec('CREATE TEMPORARY TABLE fingerprint_devices (device_id INT PRIMARY KEY) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE fingerprints (fingerprint_id INT PRIMARY KEY, enrollment_slot INT NULL, shared_door_slot INT NULL, template_data BLOB) ENGINE=InnoDB');
    $pdo->exec('CREATE TEMPORARY TABLE direct_fingerprint_import_jobs (id INT PRIMARY KEY, enrollment_device_id INT, target_slot INT, status VARCHAR(20), queued_at DATETIME, processing_at DATETIME NULL) ENGINE=InnoDB');
    $pdo->exec('INSERT INTO fingerprint_devices VALUES (1),(2)');
    $service = new FingerprintEnrollmentService();
    $model = new FingerprintEnrollmentJob();
    $request = ['job_id' => 24, 'enrollment_device_id' => 1, 'expected_assigned_slot' => 7,
        'sensor_capacity' => 512, 'occupied_slots' => range(1, 7)];
    $read = static function () use ($pdo): array {
        return $pdo->query('SELECT * FROM fingerprint_enrollment_jobs WHERE job_id=24')->fetch(PDO::FETCH_ASSOC);
    };
    $reset = static function () use ($pdo): void {
        $pdo->exec('DELETE FROM fingerprint_enrollment_jobs');
        $pdo->exec('DELETE FROM fingerprints');
        $pdo->exec('DELETE FROM direct_fingerprint_import_jobs');
        $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (job_id,user_id,finger_name,enrollment_device_id,assigned_slot,status,progress,current_step)
            VALUES (24,1,'Fixture finger',1,7,'processing',80,'Generating fingerprint model')");
        $insert = $pdo->prepare('INSERT INTO fingerprints VALUES (?,?,?,?)');
        for ($slot = 1; $slot <= 6; ++$slot) $insert->execute([$slot, $slot, $slot, str_repeat(chr($slot) . chr($slot + 1), 256)]);
    };
    $reject = static function (array $payload, int $status = 409) use ($service, $read, $pdo): void {
        $before = $read();
        $response = $service->reserveEmptySlot($payload);
        expectEmptySlot($response['status'] === $status && !$response['body']['success'], 'The reservation should reject invalid or unsafe input.');
        expectEmptySlot($read() === $before && !$pdo->inTransaction(), 'Rejected reservations must preserve the job and release every lock.');
    };

    $reset();
    $backups = $pdo->query('SELECT * FROM fingerprints ORDER BY fingerprint_id')->fetchAll();
    $result = $service->reserveEmptySlot($request);
    expectEmptySlot($result['status'] === 200 && $result['body']['success'] && $result['body']['job_id'] === 24 && $result['body']['assigned_slot'] === 8,
        'A sensor-only template in slot 7 must move the enrollment to confirmed-empty slot 8.');
    expectEmptySlot((int) $read()['assigned_slot'] === 8 && (int) $read()['progress'] === 80 && $read()['status'] === 'processing',
        'The new slot must be committed before returning without resetting the capture stage.');
    expectEmptySlot($pdo->query('SELECT * FROM fingerprints ORDER BY fingerprint_id')->fetchAll() === $backups,
        'Slot reassignment must never mutate fingerprints, backup bytes, or existing mappings.');
    expectEmptySlot(!$pdo->inTransaction(), 'Successful reservations must release device and job locks.');
    $reject($request);
    $oldCompletion = $service->completeEnrollment(['job_id' => 24, 'enrollment_device_id' => 1,
        'assigned_slot' => 7, 'template_data_base64' => base64_encode(str_repeat('AB', 256)),
        'verification' => ['fresh_scan_verified' => true, 'stored_slot' => 7, 'matched_slot' => 7,
            'confidence' => 1, 'template_bytes' => 512, 'template_sha256' => hash('sha256', str_repeat('AB', 256))]]);
    expectEmptySlot($oldCompletion['status'] === 409 && str_contains($oldCompletion['body']['message'], 'reserved job slot'),
        'A delayed completion must not save into the old reservation.');

    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (job_id,enrollment_device_id,assigned_slot,status,progress) VALUES (25,2,7,'processing',80)");
    $otherDevice = $service->reserveEmptySlot([...$request, 'job_id' => 25, 'enrollment_device_id' => 2]);
    expectEmptySlot($otherDevice['status'] === 200 && $otherDevice['body']['assigned_slot'] === 9,
        'A replacement for another sensor must observe and preserve the earlier device reservation in the shared slot namespace.');

    $reset();
    $pdo->exec("INSERT INTO fingerprints VALUES (8,8,9,'preserve both mappings')");
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (job_id,enrollment_device_id,assigned_slot,status,progress) VALUES
        (25,2,10,'waiting',0),(26,2,11,'failed',90),(27,2,13,'failed',80)");
    $pdo->exec("INSERT INTO direct_fingerprint_import_jobs VALUES (1,2,12,'completed',NOW(),NULL)");
    $result = $service->reserveEmptySlot($request);
    expectEmptySlot($result['status'] === 200 && $result['body']['assigned_slot'] === 13,
        'Allocation must skip both mapped slot types, active enrollment and failed-write reservations, and import targets.');

    $reset();
    $reject([...$request, 'enrollment_device_id' => 2]);
    $reject([...$request, 'enrollment_device_id' => 99], 404);
    $reject([...$request, 'job_id' => 999], 404);
    $reject([...$request, 'expected_assigned_slot' => 6]);
    foreach (['waiting', 'failed', 'cancelled', 'completed'] as $status) {
        $pdo->prepare('UPDATE fingerprint_enrollment_jobs SET status=? WHERE job_id=24')->execute([$status]);
        $reject($request);
    }
    $pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='processing',progress=90 WHERE job_id=24");
    $reject($request);
    $pdo->exec('UPDATE fingerprint_enrollment_jobs SET progress=80,finished_at=NOW() WHERE job_id=24');
    $reject($request);

    $reset();
    $pdo->exec("INSERT INTO direct_fingerprint_import_jobs VALUES (1,1,30,'pending',NOW(),NULL)");
    $reject($request);
    $pdo->exec("UPDATE direct_fingerprint_import_jobs SET status='processing',processing_at=NOW() WHERE id=1");
    $reject($request);
    $pdo->exec('DELETE FROM direct_fingerprint_import_jobs');
    $pdo->exec("INSERT INTO fingerprint_enrollment_jobs (job_id,enrollment_device_id,assigned_slot,status,progress) VALUES (25,1,30,'processing',5)");
    $reject($request);

    $reset();
    $reject([...$request, 'sensor_capacity' => 8]);
    $reset();
    $pdo->exec('DELETE FROM fingerprints');
    $result = $service->reserveEmptySlot([...$request, 'sensor_capacity' => 8, 'occupied_slots' => [2,3,4,5,6,7]]);
    expectEmptySlot($result['status'] === 200 && $result['body']['assigned_slot'] === 1,
        'An empty gap must remain usable even when higher slot numbers are occupied.');

    $reset();
    foreach (['job_id', 'enrollment_device_id', 'expected_assigned_slot', 'sensor_capacity'] as $field) {
        foreach ([null, '7', 7.0, true, [], 0, -1] as $invalid) $reject([...$request, $field => $invalid], 400);
    }
    foreach ([1, 65536] as $capacity) $reject([...$request, 'sensor_capacity' => $capacity], 400);
    $reject([...$request, 'expected_assigned_slot' => 65536], 400);
    foreach ([null, '1,2', [false], ['7'], [7.0], [-1], [512], ['slot' => 7]] as $invalid) {
        $reject([...$request, 'occupied_slots' => $invalid], 400);
    }
    $reject([...$request, 'sensor_capacity' => 2, 'occupied_slots' => [0,1,1]], 400);
    $missing = $request;
    unset($missing['occupied_slots']);
    $reject($missing, 400);

    // Retry retains the original reservation for safe recovery; the next claimed
    // attempt must still be able to move it after a new physical occupancy check.
    $reset();
    $pdo->exec("UPDATE fingerprint_enrollment_jobs SET status='failed',finished_at=NOW() WHERE job_id=24");
    expectEmptySlot($model->retryJob(24) && $model->claimJob(24, 1), 'A failed enrollment must remain retryable and claimable.');
    expectEmptySlot((int) $read()['assigned_slot'] === 7, 'Retry must preserve the original slot until the device verifies physical occupancy.');
    $result = $service->reserveEmptySlot($request);
    expectEmptySlot($result['status'] === 200 && $result['body']['assigned_slot'] === 8, 'A retried job must escape the occupied-slot conflict.');

    echo "PASS: sensor-only slot conflicts, retry reservation, mapped/reserved/import exclusions, full capacity and empty gaps, input validation, closed/busy/stale rejection, preserved templates, and old-slot completion rejection.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($tables as $table) $pdo->exec('DROP TEMPORARY TABLE IF EXISTS ' . $table);
}
