<?php

require_once __DIR__ . '/ActivityLogService.php';

/** Admin deletion requests. Only a super admin approval removes the record. */
final class DeleteRequestService
{
    public const TYPES = [
        'pending_registration' => 'Pending registration',
        'user_account' => 'Account',
        'rfid_card' => 'RFID card',
        'schedule' => 'Schedule',
        'access_log' => 'Access log',
    ];

    public function __construct(private PDO $pdo)
    {
    }

    public function ensureSchema(): void
    {
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS delete_requests (
                request_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                target_type VARCHAR(40) NOT NULL,
                target_id INT UNSIGNED NOT NULL,
                target_label VARCHAR(255) NOT NULL,
                reason TEXT NOT NULL,
                proof_path VARCHAR(255) NOT NULL,
                status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
                requested_by INT UNSIGNED NOT NULL,
                reviewed_by INT UNSIGNED NULL,
                review_note VARCHAR(500) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at DATETIME NULL,
                INDEX idx_delete_requests_status (status, created_at),
                INDEX idx_delete_requests_target (target_type, target_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        $column = $this->pdo->query("SHOW COLUMNS FROM delete_requests LIKE 'status'")->fetch(PDO::FETCH_ASSOC);
        $type = (string) ($column['Type'] ?? '');
        if (!str_contains($type, 'cancelled')) {
            $this->pdo->exec(
                "ALTER TABLE delete_requests
                 MODIFY status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending'"
            );
        }
    }

    public function create(int $actorId, string $targetType, int $targetId, string $targetLabel, string $reason, array $proof): array
    {
        $this->ensureSchema();
        $this->assertRole($actorId, 'admin', 'Only an admin can submit a delete request.');

        if (!isset(self::TYPES[$targetType]) || $targetId <= 0) {
            throw new InvalidArgumentException('Choose a record that can be sent for deletion review.');
        }

        $reason = trim($reason);
        if (mb_strlen($reason) < 8) {
            throw new InvalidArgumentException('Enter a reason of at least 8 characters.');
        }
        if (mb_strlen($reason) > 1000) {
            throw new InvalidArgumentException('Keep the reason within 1000 characters.');
        }

        $label = trim($targetLabel);
        if ($label === '') {
            $label = self::TYPES[$targetType] . ' #' . $targetId;
        }

        $this->assertTargetAllowed($targetType, $targetId);

        $pending = $this->pdo->prepare(
            "SELECT request_id FROM delete_requests
             WHERE target_type = :type AND target_id = :id AND status = 'pending'
             LIMIT 1"
        );
        $pending->execute(['type' => $targetType, 'id' => $targetId]);
        if ($pending->fetch()) {
            throw new InvalidArgumentException('A delete request for this record is already waiting for Super Admin review.');
        }

        $proofPath = $this->storeProof($proof);
        $insert = $this->pdo->prepare(
            'INSERT INTO delete_requests (target_type, target_id, target_label, reason, proof_path, requested_by)
             VALUES (:type, :id, :label, :reason, :proof, :actor)'
        );
        $insert->execute([
            'type' => $targetType,
            'id' => $targetId,
            'label' => mb_substr($label, 0, 255),
            'reason' => $reason,
            'proof' => $proofPath,
            'actor' => $actorId,
        ]);

        $requestId = (int) $this->pdo->lastInsertId();
        $this->logRequest(
            $actorId,
            'Request',
            'Submitted a delete request for ' . $label . '.',
            'Pending',
            $requestId,
            $this->targetUserId($targetType, $targetId)
        );

        $request = $this->find($requestId);
        if (!$request) {
            throw new RuntimeException('The delete request was saved but could not be loaded.');
        }

        return $request;
    }

    public function listForReviewer(int $actorId, string $status = 'pending'): array
    {
        $this->ensureSchema();
        $this->assertRole($actorId, 'super_admin', 'Only a Super Admin can review delete requests.');
        $status = in_array($status, ['pending', 'approved', 'rejected', 'cancelled', 'all'], true) ? $status : 'pending';
        $sql = 'SELECT r.*, requester.username AS requester_username, reviewer.username AS reviewer_username
                FROM delete_requests r
                INNER JOIN users requester ON requester.id = r.requested_by
                LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by';
        $params = [];
        if ($status !== 'all') {
            $sql .= ' WHERE r.status = :status';
            $params['status'] = $status;
        }
        $sql .= ' ORDER BY r.created_at DESC LIMIT 300';
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return array_map(fn (array $row): array => $this->mapRow($row), $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    public function listForRequester(int $actorId, string $status = 'all'): array
    {
        $this->ensureSchema();
        $this->assertRole($actorId, 'admin', 'Only an admin can view their own delete requests.');
        $status = in_array($status, ['pending', 'approved', 'rejected', 'cancelled', 'all'], true) ? $status : 'all';
        $sql = 'SELECT r.*, requester.username AS requester_username, reviewer.username AS reviewer_username
                FROM delete_requests r
                INNER JOIN users requester ON requester.id = r.requested_by
                LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
                WHERE r.requested_by = :actor';
        $params = ['actor' => $actorId];
        if ($status !== 'all') {
            $sql .= ' AND r.status = :status';
            $params['status'] = $status;
        }
        $sql .= ' ORDER BY r.created_at DESC LIMIT 300';
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return array_map(fn (array $row): array => $this->mapRow($row), $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    public function approve(int $actorId, int $requestId, string $password): array
    {
        $this->ensureSchema();
        $this->assertRole($actorId, 'super_admin', 'Only a Super Admin can approve a delete request.');
        $this->assertPassword($actorId, $password);

        $this->pdo->beginTransaction();
        try {
            $locked = $this->lockRequest($requestId);
            if ($locked['status'] === 'approved') {
                $this->pdo->commit();
                return $this->find($requestId) ?? $this->mapRow($locked);
            }
            if ($locked['status'] === 'cancelled') {
                throw new InvalidArgumentException('This delete request was cancelled by the admin.');
            }
            if ($locked['status'] !== 'pending') {
                throw new InvalidArgumentException('This delete request has already been reviewed.');
            }
            $this->deleteTarget((string) $locked['target_type'], (int) $locked['target_id']);
            $this->review($requestId, $actorId, 'approved', null);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        $saved = $this->find($requestId) ?? [];
        $this->logRequest(
            $actorId,
            'Approve',
            'Approved delete request #' . $requestId . ' and deleted ' . $this->requestLabel($saved) . '.',
            'Success',
            $requestId,
            $this->targetUserId((string) ($saved['targetType'] ?? ''), (int) ($saved['targetId'] ?? 0))
        );

        return $saved ?: ['id' => $requestId, 'status' => 'approved'];
    }

    public function reject(int $actorId, int $requestId, string $note): array
    {
        $this->ensureSchema();
        $this->assertRole($actorId, 'super_admin', 'Only a Super Admin can reject a delete request.');
        $note = trim($note);
        $note = $note !== '' ? mb_substr($note, 0, 500) : null;
        $alreadyRejected = false;

        $this->pdo->beginTransaction();
        try {
            $locked = $this->lockRequest($requestId);
            if ($locked['status'] === 'rejected') {
                $alreadyRejected = true;
            } elseif ($locked['status'] === 'cancelled') {
                throw new InvalidArgumentException('This delete request was cancelled by the admin.');
            } elseif ($locked['status'] !== 'pending') {
                throw new InvalidArgumentException('This delete request has already been reviewed.');
            } else {
                $this->review($requestId, $actorId, 'rejected', $note);
            }
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        $saved = $this->find($requestId) ?? [];
        if (!$alreadyRejected) {
            $detail = 'Rejected delete request #' . $requestId . ' for ' . $this->requestLabel($saved) . '. The record was kept.';
            if ($note) {
                $detail .= ' Note: ' . $note;
            }
            $this->logRequest(
                $actorId,
                'Reject',
                $detail,
                'Cancelled',
                $requestId,
                $this->targetUserId((string) ($saved['targetType'] ?? ''), (int) ($saved['targetId'] ?? 0))
            );
        }

        return $saved ?: ['id' => $requestId, 'status' => 'rejected'];
    }

    public function revert(int $actorId, int $requestId): array
    {
        $this->ensureSchema();
        $this->assertRole($actorId, 'super_admin', 'Only a Super Admin can revert a delete request.');

        $this->pdo->beginTransaction();
        try {
            $locked = $this->lockRequest($requestId);
            if ($locked['status'] !== 'rejected') {
                throw new InvalidArgumentException('Only a rejected delete request can be reverted.');
            }
            if (!$this->withinRevertWindow($locked['reviewed_at'] ?? null)) {
                throw new InvalidArgumentException('This rejection can only be reverted within 1 day.');
            }
            $statement = $this->pdo->prepare(
                "UPDATE delete_requests
                 SET status = 'pending', reviewed_by = NULL, review_note = NULL, reviewed_at = NULL
                 WHERE request_id = ? AND status = 'rejected'"
            );
            $statement->execute([$requestId]);
            if ($statement->rowCount() < 1) {
                throw new InvalidArgumentException('Only a rejected delete request can be reverted.');
            }
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        $saved = $this->find($requestId) ?? [];
        $this->logRequest(
            $actorId,
            'Revert',
            'Reverted delete request #' . $requestId . ' for ' . $this->requestLabel($saved) . '. It is back in review.',
            'Success',
            $requestId,
            $this->targetUserId((string) ($saved['targetType'] ?? ''), (int) ($saved['targetId'] ?? 0))
        );

        return $saved ?: ['id' => $requestId, 'status' => 'pending'];
    }

    public function cancel(int $actorId, int $requestId, string $password): array
    {
        $this->ensureSchema();
        $this->assertRole($actorId, 'admin', 'Only an admin can cancel a delete request.');
        $this->assertPassword($actorId, $password, 'admin');

        $this->pdo->beginTransaction();
        try {
            $locked = $this->lockRequest($requestId);
            if ((int) $locked['requested_by'] !== $actorId) {
                throw new InvalidArgumentException('You can only cancel a delete request you sent.');
            }
            if ($locked['status'] === 'cancelled') {
                $this->pdo->commit();

                return $this->find($requestId) ?? $this->mapRow($locked);
            }
            if ($locked['status'] !== 'pending') {
                throw new InvalidArgumentException('Only a pending delete request can be cancelled.');
            }
            $statement = $this->pdo->prepare(
                "UPDATE delete_requests
                 SET status = 'cancelled', reviewed_at = NOW()
                 WHERE request_id = ? AND requested_by = ? AND status = 'pending'"
            );
            $statement->execute([$requestId, $actorId]);
            if ($statement->rowCount() < 1) {
                throw new InvalidArgumentException('Only a pending delete request can be cancelled.');
            }
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }

        $saved = $this->find($requestId) ?? [];
        $this->logRequest(
            $actorId,
            'Cancel',
            'Cancelled delete request #' . $requestId . ' for ' . $this->requestLabel($saved) . '. The record was kept.',
            'Cancelled',
            $requestId,
            $this->targetUserId((string) ($saved['targetType'] ?? ''), (int) ($saved['targetId'] ?? 0))
        );

        return $saved ?: ['id' => $requestId, 'status' => 'cancelled'];
    }

    public function deleteNow(int $actorId, string $targetType, int $targetId): void
    {
        $this->assertRole($actorId, 'super_admin', 'Only a Super Admin can delete this record.');
        if (!isset(self::TYPES[$targetType]) || $targetId <= 0) {
            throw new InvalidArgumentException('That record cannot be deleted.');
        }
        $this->assertTargetAllowed($targetType, $targetId);
        $this->deleteTarget($targetType, $targetId);
        $this->logRequest(
            $actorId,
            'Delete',
            'Deleted ' . self::TYPES[$targetType] . ' #' . $targetId . ' directly.',
            'Success',
            0,
            $this->targetUserId($targetType, $targetId),
            $targetType,
            (string) $targetId
        );
    }

    public function proofFile(int $actorId, int $requestId): array
    {
        $this->ensureSchema();
        $role = $this->roleOf($actorId);
        $request = $this->find($requestId);
        if (!$request) {
            throw new InvalidArgumentException('That delete request was not found.');
        }
        if ($role !== 'super_admin' && (int) $request['requestedBy'] !== $actorId) {
            throw new InvalidArgumentException('You cannot view this proof.');
        }
        $path = dirname(__DIR__) . '/' . ltrim((string) $request['proofPath'], '/');
        if (!is_file($path)) {
            throw new InvalidArgumentException('The proof screenshot is no longer available.');
        }

        $info = @getimagesize($path);
        $mime = is_array($info) ? (string) ($info['mime'] ?? '') : '';
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
            throw new InvalidArgumentException('The proof screenshot is no longer available.');
        }

        return ['path' => $path, 'mime' => $mime];
    }

    private function deleteTarget(string $targetType, int $targetId): void
    {
        $this->assertTargetAllowed($targetType, $targetId);

        if ($targetType === 'pending_registration' || $targetType === 'user_account') {
            $this->deleteUser($targetId);
            return;
        }

        if ($targetType === 'rfid_card') {
            $this->pdo->prepare('DELETE FROM rfid_cards WHERE card_id = ?')->execute([$targetId]);
            return;
        }

        if ($targetType === 'schedule') {
            try {
                $this->pdo->prepare('UPDATE schedules SET overridden_by_schedule_id = NULL WHERE overridden_by_schedule_id = ?')->execute([$targetId]);
            } catch (PDOException) {
                // Older databases may not have the override stamp column.
            }
            $this->pdo->prepare('DELETE FROM schedules WHERE schedule_id = ?')->execute([$targetId]);
            return;
        }

        $this->pdo->prepare('DELETE FROM access_log WHERE log_id = ?')->execute([$targetId]);
    }

    private function deleteUser(int $userId): void
    {
        $ownsTransaction = !$this->pdo->inTransaction();
        if ($ownsTransaction) {
            $this->pdo->beginTransaction();
        }
        try {
            foreach ([
                'password_reset_challenges',
                'account_security_questions',
                'user_login_sessions',
                'login_attempts',
                'rfid_cards',
                'fingerprint_enrollment_jobs',
                'fingerprints',
                'schedules',
                'schedule_edit_history',
                'access_overrides',
                'access_log',
            ] as $table) {
                try {
                    $this->pdo->prepare("DELETE FROM {$table} WHERE user_id = ?")->execute([$userId]);
                } catch (PDOException) {
                    // Optional tables differ between environments.
                }
            }

            $role = $this->pdo->prepare('SELECT role FROM users WHERE id = ?');
            $role->execute([$userId]);
            $roleName = (string) $role->fetchColumn();
            $profileTable = match ($roleName) {
                'student' => 'student_info',
                'faculty' => 'faculty_info',
                'staff' => 'staff_info',
                'admin', 'super_admin' => 'admin_info',
                default => null,
            };
            if ($profileTable) {
                try {
                    $this->pdo->prepare("DELETE FROM {$profileTable} WHERE user_id = ?")->execute([$userId]);
                } catch (PDOException) {
                    // Profile table may use a different key in older databases.
                }
            }

            $deleted = $this->pdo->prepare('DELETE FROM users WHERE id = ?');
            $deleted->execute([$userId]);
            if ($deleted->rowCount() < 1) {
                throw new InvalidArgumentException('That account was not found.');
            }
            if ($ownsTransaction) {
                $this->pdo->commit();
            }
        } catch (Throwable $error) {
            if ($ownsTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    private function assertTargetAllowed(string $targetType, int $targetId): void
    {
        if ($targetType === 'pending_registration') {
            $statement = $this->pdo->prepare(
                "SELECT id FROM users WHERE id = ? AND role = 'student' AND approval_status = 'pending' LIMIT 1"
            );
            $statement->execute([$targetId]);
            if (!$statement->fetch()) {
                throw new InvalidArgumentException('That pending registration cannot be deleted.');
            }
            return;
        }

        if ($targetType === 'user_account') {
            $statement = $this->pdo->prepare('SELECT role FROM users WHERE id = ? LIMIT 1');
            $statement->execute([$targetId]);
            $role = (string) $statement->fetchColumn();
            if (!in_array($role, ['faculty', 'student'], true)) {
                throw new InvalidArgumentException('Only faculty and student accounts can be requested for deletion.');
            }
            return;
        }

        if ($targetType === 'rfid_card') {
            $statement = $this->pdo->prepare('SELECT card_id FROM rfid_cards WHERE card_id = ? LIMIT 1');
            $statement->execute([$targetId]);
            if (!$statement->fetch()) {
                throw new InvalidArgumentException('That RFID card was not found.');
            }
            return;
        }

        if ($targetType === 'schedule') {
            $statement = $this->pdo->prepare('SELECT schedule_id FROM schedules WHERE schedule_id = ? LIMIT 1');
            $statement->execute([$targetId]);
            if (!$statement->fetch()) {
                throw new InvalidArgumentException('That schedule was not found.');
            }
            return;
        }

        $statement = $this->pdo->prepare('SELECT log_id FROM access_log WHERE log_id = ? LIMIT 1');
        $statement->execute([$targetId]);
        if (!$statement->fetch()) {
            throw new InvalidArgumentException('That access log was not found.');
        }
    }

    private function storeProof(array $proof): string
    {
        $error = (int) ($proof['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK || !is_uploaded_file((string) ($proof['tmp_name'] ?? ''))) {
            throw new InvalidArgumentException('Attach a screenshot that shows why this record should be deleted.');
        }
        if ((int) ($proof['size'] ?? 0) > 4 * 1024 * 1024) {
            throw new InvalidArgumentException('The screenshot must be 4 MB or smaller.');
        }

        $info = @getimagesize((string) $proof['tmp_name']);
        $mime = is_array($info) ? (string) ($info['mime'] ?? '') : '';
        $extension = match ($mime) {
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            default => '',
        };
        if ($extension === '') {
            throw new InvalidArgumentException('The proof must be a PNG, JPG, WEBP, or GIF screenshot.');
        }

        $directory = dirname(__DIR__) . '/storage/delete-proofs';
        if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException('The proof screenshot could not be stored.');
        }

        $filename = bin2hex(random_bytes(16)) . '.' . $extension;
        $destination = $directory . '/' . $filename;
        if (!move_uploaded_file((string) $proof['tmp_name'], $destination)) {
            throw new RuntimeException('The proof screenshot could not be stored.');
        }

        return 'storage/delete-proofs/' . $filename;
    }

    private function lockRequest(int $requestId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT * FROM delete_requests WHERE request_id = ? LIMIT 1 FOR UPDATE'
        );
        $statement->execute([$requestId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new InvalidArgumentException('That delete request was not found.');
        }

        return $row;
    }

    private function review(int $requestId, int $actorId, string $status, ?string $note): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE delete_requests
             SET status = :status, reviewed_by = :actor, review_note = :note, reviewed_at = NOW()
             WHERE request_id = :id AND status = \'pending\''
        );
        $statement->execute([
            'status' => $status,
            'actor' => $actorId,
            'note' => $note,
            'id' => $requestId,
        ]);
    }

    private function find(int $requestId): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT r.*, requester.username AS requester_username, reviewer.username AS reviewer_username
             FROM delete_requests r
             INNER JOIN users requester ON requester.id = r.requested_by
             LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
             WHERE r.request_id = ?
             LIMIT 1'
        );
        $statement->execute([$requestId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return $row ? $this->mapRow($row) : null;
    }

    private function mapRow(array $row): array
    {
        return [
            'id' => (int) $row['request_id'],
            'targetType' => $row['target_type'],
            'targetTypeLabel' => self::TYPES[$row['target_type']] ?? $row['target_type'],
            'targetId' => (int) $row['target_id'],
            'targetLabel' => $row['target_label'],
            'reason' => $row['reason'],
            'proofPath' => $row['proof_path'],
            'status' => $row['status'],
            'requestedBy' => (int) $row['requested_by'],
            'requestedByName' => $row['requester_username'] ?? 'Admin',
            'reviewedByName' => $row['reviewer_username'] ?? '',
            'reviewNote' => $row['review_note'] ?? '',
            'createdAt' => $row['created_at'],
            'reviewedAt' => $row['reviewed_at'],
            'canRevert' => ($row['status'] ?? '') === 'rejected' && $this->withinRevertWindow($row['reviewed_at'] ?? null),
        ];
    }

    private function logRequest(
        int $actorId,
        string $activityType,
        string $description,
        string $status,
        int $requestId,
        ?int $targetUserId = null,
        ?string $entityType = null,
        ?string $entityId = null
    ): void {
        (new ActivityLogService($this->pdo))->record(
            $actorId,
            $activityType,
            $description,
            $status,
            $targetUserId,
            $entityType ?? 'delete_request',
            $entityId ?? ($requestId > 0 ? (string) $requestId : null)
        );
    }

    private function requestLabel(array $row): string
    {
        $label = trim((string) ($row['targetLabel'] ?? $row['target_label'] ?? ''));
        if ($label !== '') {
            return $label;
        }
        $type = (string) ($row['targetType'] ?? $row['target_type'] ?? '');
        $id = (int) ($row['targetId'] ?? $row['target_id'] ?? 0);

        return (self::TYPES[$type] ?? 'record') . ($id > 0 ? ' #' . $id : '');
    }

    private function targetUserId(string $targetType, int $targetId): ?int
    {
        if (!in_array($targetType, ['user_account', 'pending_registration'], true) || $targetId <= 0) {
            return null;
        }

        return $targetId;
    }

    private function withinRevertWindow(?string $reviewedAt): bool
    {
        if ($reviewedAt === null || trim($reviewedAt) === '') {
            return false;
        }
        $reviewed = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $reviewedAt, new DateTimeZone('Asia/Manila'));
        if (!$reviewed) {
            return false;
        }
        $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));

        return $now <= $reviewed->modify('+1 day');
    }

    private function assertPassword(int $actorId, string $password, string $role = 'super_admin'): void
    {
        if ($password === '') {
            throw new InvalidArgumentException('Security password is required.');
        }
        $statement = $this->pdo->prepare(
            'SELECT password_hash, is_active FROM users WHERE id = ? AND role = ? LIMIT 1'
        );
        $statement->execute([$actorId, $role]);
        $user = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$user || !(int) $user['is_active'] || !password_verify($password, (string) $user['password_hash'])) {
            throw new InvalidArgumentException('The security password is incorrect.');
        }
    }

    private function assertRole(int $actorId, string $role, string $message): void
    {
        if ($this->roleOf($actorId) !== $role) {
            throw new InvalidArgumentException($message);
        }
    }

    private function roleOf(int $actorId): ?string
    {
        if ($actorId <= 0) {
            return null;
        }
        $statement = $this->pdo->prepare('SELECT role FROM users WHERE id = ? AND is_active = 1 LIMIT 1');
        $statement->execute([$actorId]);
        $role = $statement->fetchColumn();

        return $role ? (string) $role : null;
    }
}
