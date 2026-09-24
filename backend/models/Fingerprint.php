<?php

require_once __DIR__ . '/../config/connection.php';

class Fingerprint
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = entrivo_pdo();
    }

    public function getById(int $fingerprintId): ?array
    {
        $statement = $this->conn->prepare(
            "SELECT *
             FROM fingerprints
             WHERE fingerprint_id = :fingerprint_id
             LIMIT 1"
        );
        $statement->execute([
            'fingerprint_id' => $fingerprintId,
        ]);

        $record = $statement->fetch();

        return $record ?: null;
    }

    public function findByUserAndFingerName(int $userId, string $fingerName): ?array
    {
        $statement = $this->conn->prepare(
            "SELECT *
             FROM fingerprints
             WHERE user_id = :user_id
               AND finger_name = :finger_name
             ORDER BY fingerprint_id DESC
             LIMIT 1"
        );
        $statement->execute([
            'user_id' => $userId,
            'finger_name' => $fingerName,
        ]);

        $record = $statement->fetch();

        return $record ?: null;
    }

    public function findPendingRecordForUser(int $userId): ?array
    {
        $statement = $this->conn->prepare(
            "SELECT *
             FROM fingerprints
             WHERE user_id = :user_id
               AND (
                    status = 'pending'
                    OR finger_name IS NULL
                    OR finger_name = ''
               )
             ORDER BY
                CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
                fingerprint_id DESC
             LIMIT 1"
        );
        $statement->execute([
            'user_id' => $userId,
        ]);

        $record = $statement->fetch();

        return $record ?: null;
    }

    public function getTemplateExportData(int $fingerprintId): ?array
    {
        $statement = $this->conn->prepare(
            "SELECT
                fingerprints.*,
                users.username,
                users.email,
                users.role
             FROM fingerprints
             INNER JOIN users
                ON users.id = fingerprints.user_id
             WHERE fingerprints.fingerprint_id = :fingerprint_id
             LIMIT 1"
        );
        $statement->execute([
            'fingerprint_id' => $fingerprintId,
        ]);

        $record = $statement->fetch();

        return $record ?: null;
    }

    public function saveEnrollment(
        int $userId,
        string $fingerName,
        int $enrollmentDeviceId,
        int $assignedSlot,
        string $templateBinary,
        string $templateHash,
        ?int $fingerprintId = null
    ): array {
        $existingRecord = null;

        if ($fingerprintId !== null && $fingerprintId > 0) {
            $existingRecord = $this->getById($fingerprintId);
        }

        if (!$existingRecord) {
            $existingRecord = $this->findByUserAndFingerName($userId, $fingerName);
        }

        if (!$existingRecord) {
            $existingRecord = $this->findPendingRecordForUser($userId);
        }

        if ($existingRecord) {
            $fingerprintId = (int) $existingRecord['fingerprint_id'];
            $statement = $this->conn->prepare(
                "UPDATE fingerprints
                 SET
                    finger_name = :finger_name,
                    enrollment_device_id = :enrollment_device_id,
                    enrollment_slot = :enrollment_slot,
                    shared_door_slot = :shared_door_slot,
                    template_data = :template_data,
                    template_hash = :template_hash,
                    status = 'active',
                    door_sync_status = 'pending',
                    door_synced_at = NULL,
                    enrolled_at = CURRENT_TIMESTAMP
                 WHERE fingerprint_id = :fingerprint_id"
            );

            $statement->bindValue(':finger_name', $fingerName);
            $statement->bindValue(':enrollment_device_id', $enrollmentDeviceId ?: null, $enrollmentDeviceId > 0 ? PDO::PARAM_INT : PDO::PARAM_NULL);
            $statement->bindValue(':enrollment_slot', $assignedSlot, PDO::PARAM_INT);
            $statement->bindValue(':shared_door_slot', $assignedSlot, PDO::PARAM_INT);
            $statement->bindParam(':template_data', $templateBinary, PDO::PARAM_LOB);
            $statement->bindValue(':template_hash', $templateHash);
            $statement->bindValue(':fingerprint_id', $fingerprintId, PDO::PARAM_INT);
            $statement->execute();

            return $this->getById($fingerprintId) ?: [];
        }

        $statement = $this->conn->prepare(
            "INSERT INTO fingerprints
                (
                    user_id,
                    finger_name,
                    enrollment_device_id,
                    enrollment_slot,
                    shared_door_slot,
                    template_data,
                    template_hash,
                    status,
                    door_sync_status,
                    door_synced_at,
                    enrolled_at
                )
             VALUES
                (
                    :user_id,
                    :finger_name,
                    :enrollment_device_id,
                    :enrollment_slot,
                    :shared_door_slot,
                    :template_data,
                    :template_hash,
                    'active',
                    'pending',
                    NULL,
                    CURRENT_TIMESTAMP
                )"
        );

        $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $statement->bindValue(':finger_name', $fingerName);
        $statement->bindValue(':enrollment_device_id', $enrollmentDeviceId ?: null, $enrollmentDeviceId > 0 ? PDO::PARAM_INT : PDO::PARAM_NULL);
        $statement->bindValue(':enrollment_slot', $assignedSlot, PDO::PARAM_INT);
        $statement->bindValue(':shared_door_slot', $assignedSlot, PDO::PARAM_INT);
        $statement->bindParam(':template_data', $templateBinary, PDO::PARAM_LOB);
        $statement->bindValue(':template_hash', $templateHash);
        $statement->execute();

        return $this->getById((int) $this->conn->lastInsertId()) ?: [];
    }

    public function importTemplateData(
        int $fingerprintId,
        string $templateBinary,
        string $templateHash,
        ?string $fingerName = null,
        ?int $enrollmentDeviceId = null,
        ?int $enrollmentSlot = null,
        ?int $sharedDoorSlot = null
    ): ?array {
        $existingRecord = $this->getById($fingerprintId);

        if (!$existingRecord) {
            return null;
        }

        $resolvedFingerName = trim((string) ($fingerName ?? ''));
        if ($resolvedFingerName === '') {
            $resolvedFingerName = trim((string) ($existingRecord['finger_name'] ?? ''));
        }
        if ($resolvedFingerName === '') {
            $resolvedFingerName = 'Imported Template';
        }

        $existingEnrollmentDeviceId = isset($existingRecord['enrollment_device_id'])
            ? (int) $existingRecord['enrollment_device_id']
            : 0;
        $existingEnrollmentSlot = isset($existingRecord['enrollment_slot'])
            ? (int) $existingRecord['enrollment_slot']
            : 0;
        $existingSharedDoorSlot = isset($existingRecord['shared_door_slot'])
            ? (int) $existingRecord['shared_door_slot']
            : 0;

        $resolvedEnrollmentDeviceId = $enrollmentDeviceId !== null && $enrollmentDeviceId > 0
            ? $enrollmentDeviceId
            : ($existingEnrollmentDeviceId > 0 ? $existingEnrollmentDeviceId : null);
        $resolvedEnrollmentSlot = $enrollmentSlot !== null && $enrollmentSlot > 0
            ? $enrollmentSlot
            : ($existingEnrollmentSlot > 0 ? $existingEnrollmentSlot : null);
        $resolvedSharedDoorSlot = $sharedDoorSlot !== null && $sharedDoorSlot > 0
            ? $sharedDoorSlot
            : ($existingSharedDoorSlot > 0
                ? $existingSharedDoorSlot
                : ($resolvedEnrollmentSlot !== null && $resolvedEnrollmentSlot > 0 ? $resolvedEnrollmentSlot : null));

        $shouldActivate = (
            $resolvedEnrollmentSlot !== null
            || $resolvedSharedDoorSlot !== null
            || (string) ($existingRecord['status'] ?? '') === 'active'
        );
        $resolvedStatus = $shouldActivate
            ? 'active'
            : (string) ($existingRecord['status'] ?? 'pending');

        $statement = $this->conn->prepare(
            "UPDATE fingerprints
             SET
                finger_name = :finger_name,
                enrollment_device_id = :enrollment_device_id,
                enrollment_slot = :enrollment_slot,
                shared_door_slot = :shared_door_slot,
                template_data = :template_data,
                template_hash = :template_hash,
                status = :status,
                door_sync_status = 'pending',
                door_synced_at = NULL,
                enrolled_at = CASE
                    WHEN :should_activate = 1 THEN CURRENT_TIMESTAMP
                    ELSE enrolled_at
                END
             WHERE fingerprint_id = :fingerprint_id"
        );

        $statement->bindValue(':finger_name', $resolvedFingerName);
        $statement->bindValue(
            ':enrollment_device_id',
            $resolvedEnrollmentDeviceId,
            $resolvedEnrollmentDeviceId !== null ? PDO::PARAM_INT : PDO::PARAM_NULL
        );
        $statement->bindValue(
            ':enrollment_slot',
            $resolvedEnrollmentSlot,
            $resolvedEnrollmentSlot !== null ? PDO::PARAM_INT : PDO::PARAM_NULL
        );
        $statement->bindValue(
            ':shared_door_slot',
            $resolvedSharedDoorSlot,
            $resolvedSharedDoorSlot !== null ? PDO::PARAM_INT : PDO::PARAM_NULL
        );
        $statement->bindParam(':template_data', $templateBinary, PDO::PARAM_LOB);
        $statement->bindValue(':template_hash', $templateHash);
        $statement->bindValue(':status', $resolvedStatus);
        $statement->bindValue(':should_activate', $shouldActivate ? 1 : 0, PDO::PARAM_INT);
        $statement->bindValue(':fingerprint_id', $fingerprintId, PDO::PARAM_INT);
        $statement->execute();

        return $this->getById($fingerprintId);
    }

    public function markDoorSyncPending(int $fingerprintId): bool
    {
        $statement = $this->conn->prepare(
            "UPDATE fingerprints
             SET
                door_sync_status = 'pending',
                door_synced_at = NULL
             WHERE fingerprint_id = :fingerprint_id"
        );
        $statement->bindValue(':fingerprint_id', $fingerprintId, PDO::PARAM_INT);

        return $statement->execute();
    }

    public function markDoorSyncStatus(int $fingerprintId, string $status): bool
    {
        $allowedStatuses = ['pending', 'synced', 'partial', 'failed'];

        if (!in_array($status, $allowedStatuses, true)) {
            return false;
        }

        $statement = $this->conn->prepare(
            "UPDATE fingerprints
             SET
                door_sync_status = :status,
                door_synced_at = CASE
                    WHEN :status = 'synced' THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END
             WHERE fingerprint_id = :fingerprint_id"
        );
        $statement->bindValue(':status', $status);
        $statement->bindValue(':fingerprint_id', $fingerprintId, PDO::PARAM_INT);

        return $statement->execute();
    }
}
