<?php

/**
 * Records admin/system transactions for the Activity Logs page
 * (add, edit, delete, enroll, approve, etc.).
 */
class ActivityLogService
{
    private PDO $pdo;
    private bool $tableReady = false;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function ensureTable(): void
    {
        if ($this->tableReady) {
            return;
        }

        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS activity_transactions (
                transaction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                actor_user_id INT UNSIGNED NULL DEFAULT NULL,
                target_user_id INT UNSIGNED NULL DEFAULT NULL,
                activity_type VARCHAR(32) NOT NULL,
                entity_type VARCHAR(64) NULL DEFAULT NULL,
                entity_id VARCHAR(64) NULL DEFAULT NULL,
                description VARCHAR(512) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'Success',
                ip_address VARCHAR(45) NULL DEFAULT NULL,
                user_agent VARCHAR(512) NULL DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (transaction_id),
                KEY idx_activity_transactions_type (activity_type),
                KEY idx_activity_transactions_status (status),
                KEY idx_activity_transactions_actor (actor_user_id),
                KEY idx_activity_transactions_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );

        $this->tableReady = true;
    }

    public function clientIp(): ?string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;

        if (!is_string($ip) || $ip === '') {
            return null;
        }

        return substr($ip, 0, 45);
    }

    public function userAgent(): ?string
    {
        $ua = $_SERVER['HTTP_USER_AGENT'] ?? null;

        if (!is_string($ua) || $ua === '') {
            return null;
        }

        return substr($ua, 0, 512);
    }

    /**
     * Groups a stored action into the category shown on Activity Logs.
     */
    public static function category(string $activityType, ?string $entityType = null, string $description = ''): string
    {
        $type = strtolower(trim($activityType));
        $entity = strtolower(trim((string) $entityType));
        $text = strtolower($description);

        if ($type === 'logout' || $entity === 'logout') {
            return 'Logout';
        }

        if ($type === 'login' || $entity === 'login') {
            return 'Login';
        }

        if ($entity === 'fingerprint_job') {
            return 'Job';
        }

        if ($entity === 'fingerprint_sync') {
            return 'Sync';
        }

        if ($entity === 'access' || $type === 'access' || str_contains($text, 'door access')) {
            return 'Access';
        }

        if (
            $entity === 'recovery'
            || $entity === 'password_reset'
            || $type === 'recovery'
            || str_contains($text, 'account recovery')
            || str_contains($text, 'password reset')
        ) {
            return 'Recovery';
        }

        if (
            $entity === 'password'
            || str_contains($text, 'password')
        ) {
            return 'Password';
        }

        if (
            $entity === 'security_questions'
            || $entity === 'privilege'
            || $entity === 'privileges'
            || str_contains($text, 'security question')
            || str_contains($text, 'privileges')
        ) {
            return 'Security';
        }

        if ($entity === 'profile') {
            return 'Account';
        }

        if ($entity === 'access_override' || str_contains($text, 'override')) {
            return 'Override';
        }

        if ($entity === 'registration' || str_contains($text, 'registration')) {
            return 'Registration';
        }

        if ($entity === 'schedule' || str_contains($text, 'schedule')) {
            return 'Schedule';
        }

        if ($entity === 'fingerprint' || str_contains($text, 'fingerprint')) {
            if (
                $type === 'delete'
                || str_contains($text, 'deleted fingerprint')
                || str_contains($text, 'removed')
            ) {
                return 'Delete';
            }

            if (
                $type === 'update'
                || str_contains($text, 'fingerprint update')
                || str_contains($text, 'updated an existing fingerprint')
                || str_contains($text, 'updated fingerprint')
            ) {
                return 'Update';
            }

            return 'Enroll';
        }

        if ($entity === 'rfid' || str_contains($text, 'rfid')) {
            return 'RFID';
        }

        if (
            $entity === 'user'
            || in_array($type, ['add', 'edit', 'delete', 'block', 'unblock'], true)
        ) {
            return 'User';
        }

        return 'Account';
    }

    /**
     * @param string $activityType Add|Edit|Delete|Enroll|Update|Approve|Reject|Block|Unblock|Password|Recovery
     * @param string $status Success|Failed
     */
    public function record(
        ?int $actorUserId,
        string $activityType,
        string $description,
        string $status = 'Success',
        ?int $targetUserId = null,
        ?string $entityType = null,
        ?string $entityId = null
    ): void {
        try {
            $this->ensureTable();

            $statement = $this->pdo->prepare(
                'INSERT INTO activity_transactions
                    (actor_user_id, target_user_id, activity_type, entity_type, entity_id,
                     description, status, ip_address, user_agent, created_at)
                 VALUES
                    (:actor_user_id, :target_user_id, :activity_type, :entity_type, :entity_id,
                     :description, :status, :ip_address, :user_agent, NOW())'
            );

            $statement->execute([
                'actor_user_id' => $actorUserId && $actorUserId > 0 ? $actorUserId : null,
                'target_user_id' => $targetUserId && $targetUserId > 0 ? $targetUserId : null,
                'activity_type' => substr(trim($activityType), 0, 32),
                'entity_type' => $entityType !== null ? substr($entityType, 0, 64) : null,
                'entity_id' => $entityId !== null ? substr((string) $entityId, 0, 64) : null,
                'description' => substr(trim($description), 0, 512),
                'status' => $status === 'Failed' ? 'Failed' : 'Success',
                'ip_address' => $this->clientIp(),
                'user_agent' => $this->userAgent(),
            ]);
        } catch (Throwable $error) {
            // Never break the main request if audit logging fails.
            error_log('ActivityLogService: ' . $error->getMessage());
        }
    }

    /**
     * Writes the final fingerprint enrollment or update result onto the job's activity row.
     *
     * @param array<string, mixed> $job
     */
    public function recordFingerprintResult(array $job, string $outcome, ?int $actorUserId = null): void
    {
        $isUpdate = $this->fingerprintJobIsUpdate($job);
        $activityType = $isUpdate ? 'Update' : 'Enroll';
        $userId = (int) ($job['user_id'] ?? 0);
        $fingerName = trim((string) ($job['finger_name'] ?? 'finger'));
        $fingerName = $fingerName !== '' ? $fingerName : 'finger';
        $who = 'user #' . ($userId > 0 ? $userId : '?') . ' (' . $fingerName . ')';
        $failed = $outcome !== 'success';
        $description = $failed
            ? ($isUpdate ? 'Fingerprint update failed' : 'Fingerprint enrollment failed') . ' for ' . $who . '.'
            : ($isUpdate ? 'Updated an existing fingerprint' : 'Enrolled a new fingerprint') . ' for ' . $who . '.';
        $reason = trim((string) ($job['error_message'] ?? ''));

        if ($failed && $reason !== '') {
            $description = rtrim($description, '.') . '. ' . $reason;
        }

        $jobId = isset($job['job_id']) ? trim((string) $job['job_id']) : '';

        if ($jobId === '') {
            $this->record(
                $actorUserId,
                $activityType,
                $description,
                $failed ? 'Failed' : 'Success',
                $userId > 0 ? $userId : null,
                'fingerprint',
                null
            );
            return;
        }

        $this->settle(
            'fingerprint',
            $jobId,
            $actorUserId,
            $activityType,
            $description,
            $failed ? 'Failed' : 'Success',
            $userId > 0 ? $userId : null
        );
    }

    /**
     * A job is an update only when its fingerprint record already holds an enrolled
     * fingerprint. Registration creates an empty "pending" record, so the first
     * enrollment carries a fingerprint_id but is still a new enrollment.
     * Pass 'is_update' when the record may already have been overwritten by the job.
     *
     * @param array<string, mixed> $job
     */
    public function fingerprintJobIsUpdate(array $job): bool
    {
        if (array_key_exists('is_update', $job) && $job['is_update'] !== null) {
            return (bool) $job['is_update'];
        }

        $jobId = isset($job['job_id']) ? trim((string) $job['job_id']) : '';

        if ($jobId !== '') {
            try {
                $this->ensureTable();
                $statement = $this->pdo->prepare(
                    "SELECT description
                     FROM activity_transactions
                     WHERE entity_type = 'fingerprint_job'
                       AND entity_id = :entity_id
                       AND activity_type = 'Create'
                       AND status = 'Success'
                     ORDER BY transaction_id ASC
                     LIMIT 1"
                );
                $statement->execute(['entity_id' => substr($jobId, 0, 64)]);
                $description = $statement->fetchColumn();

                if (is_string($description)) {
                    return stripos($description, 'update job') !== false;
                }
            } catch (Throwable $error) {
                error_log('ActivityLogService job kind: ' . $error->getMessage());
            }
        }

        return $this->isEnrolledFingerprint((int) ($job['fingerprint_id'] ?? 0));
    }

    public function isEnrolledFingerprint(int $fingerprintId): bool
    {
        if ($fingerprintId <= 0) {
            return false;
        }

        try {
            $statement = $this->pdo->prepare(
                "SELECT 1
                 FROM fingerprints
                 WHERE fingerprint_id = :fingerprint_id
                   AND (
                       (template_data IS NOT NULL AND OCTET_LENGTH(template_data) > 0)
                       OR enrollment_slot IS NOT NULL
                   )
                 LIMIT 1"
            );
            $statement->execute(['fingerprint_id' => $fingerprintId]);

            return (bool) $statement->fetchColumn();
        } catch (Throwable $error) {
            error_log('ActivityLogService fingerprint state: ' . $error->getMessage());
            return false;
        }
    }

    /**
     * Logs an enrollment job event (created, retried, cancelled). A job is only a
     * request to the enrollment station, not a finished enrollment.
     *
     * @param array<string, mixed> $job
     */
    public function recordFingerprintJob(string $action, array $job, ?int $actorUserId = null, string $status = 'Success'): void
    {
        $jobId = isset($job['job_id']) ? trim((string) $job['job_id']) : '';
        $userId = (int) ($job['user_id'] ?? 0);
        $fingerName = trim((string) ($job['finger_name'] ?? ''));
        $kind = $this->fingerprintJobIsUpdate($job) ? 'update' : 'enrollment';
        $subject = 'fingerprint ' . $kind . ' job' . ($jobId !== '' ? ' #' . $jobId : '');
        $who = 'user #' . ($userId > 0 ? $userId : '?') . ($fingerName !== '' ? ' (' . $fingerName . ')' : '');

        $verbs = [
            'created' => ['Create', 'Created'],
            'retried' => ['Retry', 'Retried'],
            'cancelled' => ['Cancel', 'Cancelled'],
        ];
        [$activityType, $verb] = $verbs[$action] ?? ['Job', ucfirst($action)];

        $description = $status === 'Failed'
            ? 'Unable to ' . strtolower($activityType) . ' ' . $subject . ' for ' . $who . '.'
            : $verb . ' ' . $subject . ' for ' . $who . '.';
        $reason = trim((string) ($job['error_message'] ?? ''));

        if ($status === 'Failed' && $reason !== '') {
            $description = rtrim($description, '.') . '. ' . $reason;
        }

        $this->record(
            $actorUserId,
            $activityType,
            $description,
            $status,
            $userId > 0 ? $userId : null,
            'fingerprint_job',
            $jobId !== '' ? $jobId : null
        );
    }

    /**
     * Logs a Sensor B template sync event (queued, retried, cancelled, synced, failed).
     *
     * @param array<string, mixed> $job
     */
    public function recordFingerprintSync(string $action, array $job, ?int $actorUserId = null, string $status = 'Success'): void
    {
        $queueId = (int) ($job['queue_id'] ?? ($job['id'] ?? 0));
        $userId = (int) ($job['user_id'] ?? 0);
        $fingerName = trim((string) ($job['finger_name'] ?? ''));
        $device = trim((string) ($job['device_name'] ?? ''));
        $device = $device !== '' ? $device : 'Sensor B';
        $subject = 'fingerprint sync job' . ($queueId > 0 ? ' #' . $queueId : '');
        $who = 'user #' . ($userId > 0 ? $userId : '?') . ($fingerName !== '' ? ' (' . $fingerName . ')' : '');

        $descriptions = [
            'queued' => ['Queue', 'Queued ' . $subject . ' to ' . $device . ' for ' . $who . '.'],
            'pending' => ['Queue', 'Fingerprint sync to ' . $device . ' for ' . $who . ' is already pending (' . $subject . ').'],
            'retried' => ['Retry', 'Retried ' . $subject . ' to ' . $device . ' for ' . $who . '.'],
            'cancelled' => ['Cancel', 'Cancelled ' . $subject . ' to ' . $device . ' for ' . $who . '.'],
            'synced' => ['Sync', 'Synced fingerprint to ' . $device . ' for ' . $who . ' (' . $subject . ').'],
            'failed' => ['Sync', 'Fingerprint sync to ' . $device . ' failed for ' . $who . ' (' . $subject . ').'],
        ];
        [$activityType, $description] = $descriptions[$action] ?? ['Sync', ucfirst($action) . ' ' . $subject . ' for ' . $who . '.'];

        if ($status === 'Failed' && $action !== 'failed') {
            $description = 'Unable to ' . strtolower($activityType) . ' ' . $subject . ' for ' . $who . '.';
        }

        $reason = trim((string) ($job['error_message'] ?? ''));

        if ($status === 'Failed' && $reason !== '') {
            $description = rtrim($description, '.') . '. ' . $reason;
        }

        $this->record(
            $actorUserId,
            $activityType,
            $description,
            $status,
            $userId > 0 ? $userId : null,
            'fingerprint_sync',
            $queueId > 0 ? (string) $queueId : null
        );
    }

    /**
     * Removes job-start rows that are not a finished fingerprint enrollment.
     * A cancelled or unfinished job is not an enrollment or an update.
     */
    public function syncFingerprintEnrollmentActivities(): void
    {
        try {
            $this->ensureTable();
            $this->pdo->exec(
                "DELETE activity_transactions
                 FROM activity_transactions
                 LEFT JOIN fingerprint_enrollment_jobs AS jobs
                    ON jobs.job_id = activity_transactions.entity_id
                 WHERE activity_transactions.entity_type = 'fingerprint'
                   AND activity_transactions.description LIKE 'Started fingerprint%'
                   AND (jobs.job_id IS NULL OR jobs.status NOT IN ('completed', 'failed'))"
            );

            $statement = $this->pdo->query(
                "SELECT jobs.job_id,
                        jobs.user_id,
                        jobs.finger_name,
                        jobs.fingerprint_id,
                        jobs.status,
                        jobs.error_message
                 FROM fingerprint_enrollment_jobs AS jobs
                 INNER JOIN activity_transactions
                    ON activity_transactions.entity_type = 'fingerprint'
                   AND jobs.job_id = activity_transactions.entity_id
                 WHERE jobs.status = 'completed'
                   AND activity_transactions.description LIKE 'Started fingerprint%'"
            );

            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $job) {
                $this->recordFingerprintResult($job, 'success', null);
            }
        } catch (Throwable $error) {
            error_log('ActivityLogService fingerprint sync: ' . $error->getMessage());
        }
    }

    public function discardFingerprintJobActivity(string $jobId): void
    {
        $jobId = trim($jobId);

        if ($jobId === '') {
            return;
        }

        try {
            $this->ensureTable();
            $statement = $this->pdo->prepare(
                "DELETE FROM activity_transactions
                 WHERE entity_type = 'fingerprint'
                   AND entity_id = :entity_id
                   AND description LIKE 'Started fingerprint%'"
            );
            $statement->execute(['entity_id' => substr($jobId, 0, 64)]);
        } catch (Throwable $error) {
            error_log('ActivityLogService discard fingerprint job: ' . $error->getMessage());
        }
    }

    private function settle(
        string $entityType,
        string $entityId,
        ?int $actorUserId,
        string $activityType,
        string $description,
        string $status,
        ?int $targetUserId
    ): void {
        try {
            $this->ensureTable();
            $statement = $this->pdo->prepare(
                'UPDATE activity_transactions
                 SET actor_user_id = COALESCE(:actor_user_id, actor_user_id),
                     target_user_id = COALESCE(:target_user_id, target_user_id),
                     activity_type = :activity_type,
                     description = :description,
                     status = :status
                 WHERE entity_type = :entity_type
                   AND entity_id = :entity_id'
            );
            $statement->execute([
                'actor_user_id' => $actorUserId && $actorUserId > 0 ? $actorUserId : null,
                'target_user_id' => $targetUserId && $targetUserId > 0 ? $targetUserId : null,
                'activity_type' => substr(trim($activityType), 0, 32),
                'description' => substr(trim($description), 0, 512),
                'status' => $status === 'Failed' ? 'Failed' : 'Success',
                'entity_type' => substr($entityType, 0, 64),
                'entity_id' => substr($entityId, 0, 64),
            ]);

            if ($statement->rowCount() > 0) {
                $cleanup = $this->pdo->prepare(
                    'DELETE older_rows
                     FROM activity_transactions AS older_rows
                     INNER JOIN (
                         SELECT MAX(transaction_id) AS keep_id
                         FROM activity_transactions
                         WHERE entity_type = :entity_type
                           AND entity_id = :entity_id
                     ) AS keeper ON older_rows.transaction_id < keeper.keep_id
                     WHERE older_rows.entity_type = :cleanup_entity_type
                       AND older_rows.entity_id = :cleanup_entity_id'
                );
                $cleanup->execute([
                    'entity_type' => substr($entityType, 0, 64),
                    'entity_id' => substr($entityId, 0, 64),
                    'cleanup_entity_type' => substr($entityType, 0, 64),
                    'cleanup_entity_id' => substr($entityId, 0, 64),
                ]);
                return;
            }
        } catch (Throwable $error) {
            error_log('ActivityLogService settle: ' . $error->getMessage());
        }

        $this->record(
            $actorUserId,
            $activityType,
            $description,
            $status,
            $targetUserId,
            $entityType,
            $entityId
        );
    }
}
