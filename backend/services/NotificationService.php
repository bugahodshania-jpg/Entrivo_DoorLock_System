<?php

require_once __DIR__ . '/MailService.php';
require_once __DIR__ . '/ScheduleStatusService.php';

/** Durable, per-recipient notices for approved overrides. All dates use Asia/Manila. */
final class NotificationService
{
    private $sendMail;
    private $clock;

    public function __construct(private PDO $pdo, ?callable $sendMail = null, ?callable $clock = null)
    {
        $this->sendMail = $sendMail ?? static function (string $email, string $subject, string $body): void {
            (new MailService())->send($email, $subject, $body);
        };
        $this->clock = $clock ?? static fn (): DateTimeImmutable => new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
    }

    /** Call before beginning the approval transaction: MySQL DDL commits implicitly. */
    public function ensureSchema(): void
    {
        if ($this->pdo->inTransaction()) {
            throw new LogicException('Prepare notification storage before starting a transaction.');
        }

        // Polling should need only SELECT privileges once migration has run.
        // Avoid CREATE/SHOW INDEX on every five-second notification request.
        try {
            $this->pdo->query('SELECT id, override_id, user_id, requester_name, recipient_email, reason,
                override_start, override_end, affected_schedules, created_at, acknowledged_at,
                email_status, email_attempts, email_attempted_at, email_sent_at, email_error
                FROM override_notifications LIMIT 0')->closeCursor();
            return;
        } catch (PDOException $error) {
            $missingTable = ($error->errorInfo[0] ?? '') === '42S02'
                || str_contains($error->getMessage(), 'no such table: override_notifications');
            if (!$missingTable) {
                throw $error;
            }
        }
        $sqlite = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
        $id = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
        $tail = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS override_notifications (
            id {$id},
            override_id INT NOT NULL,
            user_id INT NOT NULL,
            requester_name VARCHAR(255) NOT NULL,
            recipient_email VARCHAR(255) NOT NULL,
            reason TEXT NOT NULL,
            override_start DATETIME NOT NULL,
            override_end DATETIME NOT NULL,
            affected_schedules TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            acknowledged_at DATETIME NULL,
            email_status VARCHAR(20) NOT NULL DEFAULT 'pending',
            email_attempts INT NOT NULL DEFAULT 0,
            email_attempted_at DATETIME NULL,
            email_sent_at DATETIME NULL,
            email_error TEXT NULL,
            UNIQUE (override_id, user_id)
        ){$tail}");
        if ($sqlite) {
            $this->pdo->exec('CREATE INDEX IF NOT EXISTS override_notifications_owner ON override_notifications (user_id, acknowledged_at, id)');
            $this->pdo->exec('CREATE INDEX IF NOT EXISTS override_notifications_delivery ON override_notifications (email_status, id)');
        } else {
            // Defined here rather than separate ALTERs so existing requests never run DDL in a transaction.
            $indexes = $this->pdo->query('SHOW INDEX FROM override_notifications')->fetchAll(PDO::FETCH_ASSOC);
            $names = array_column($indexes, 'Key_name');
            foreach ([
                'override_notifications_owner' => '(user_id, acknowledged_at, id)',
                'override_notifications_delivery' => '(email_status, id)',
            ] as $name => $columns) {
                if (!in_array($name, $names, true)) {
                    try {
                        $this->pdo->exec("CREATE INDEX {$name} ON override_notifications {$columns}");
                    } catch (PDOException $error) {
                        // Another request may have created the same index concurrently.
                        if ((int) ($error->errorInfo[1] ?? 0) !== 1061) {
                            throw $error;
                        }
                    }
                }
            }
        }
    }

    public static function affectedOccurrences(array $schedule, DateTimeImmutable $overrideStart, DateTimeImmutable $overrideEnd): array
    {
        if (ScheduleStatusService::normalizeStatus($schedule['status'] ?? '') !== 'approved' || $overrideEnd <= $overrideStart) {
            return [];
        }
        $startTime = self::validTime($schedule['time_start'] ?? '');
        $endTime = self::validTime($schedule['time_end'] ?? '');
        if ($startTime === null || $endTime === null || $endTime <= $startTime) {
            return [];
        }
        $zone = new DateTimeZone('Asia/Manila');
        $overrideStart = $overrideStart->setTimezone($zone);
        $overrideEnd = $overrideEnd->setTimezone($zone);
        $first = $overrideStart->setTime(0, 0);
        $last = $overrideEnd->setTime(0, 0);
        $type = $schedule['schedule_type'] ?? 'single';
        if ($type === 'single') {
            $date = self::validDate($schedule['schedule_date'] ?? '');
            if ($date === null || $date < $first->format('Y-m-d') || $date > $last->format('Y-m-d')) {
                return [];
            }
            $first = $last = new DateTimeImmutable($date, $zone);
        } elseif ($type === 'recurring') {
            $rangeStart = self::validDate($schedule['start_date'] ?? '');
            $rangeEnd = self::validDate($schedule['end_date'] ?? '');
            if ($rangeStart === null || $rangeEnd === null || $rangeEnd < $rangeStart) {
                return [];
            }
            $first = max($first, new DateTimeImmutable($rangeStart, $zone));
            $last = min($last, new DateTimeImmutable($rangeEnd, $zone));
        } else {
            return [];
        }

        $occurrences = [];
        for ($day = $first; $day <= $last; $day = $day->modify('+1 day')) {
            if ($type === 'recurring' && !self::recursOn($schedule, $day)) {
                continue;
            }
            $date = $day->format('Y-m-d');
            $start = new DateTimeImmutable($date . ' ' . $startTime, $zone);
            $end = new DateTimeImmutable($date . ' ' . $endTime, $zone);
            // Adjacent windows do not overlap; grace periods do not extend access.
            if ($start >= $overrideEnd || $end <= $overrideStart) {
                continue;
            }
            $occurrences[] = [
                'id' => (int) ($schedule['schedule_id'] ?? 0),
                'date' => $date,
                'timeStart' => $startTime,
                'timeEnd' => $endTime,
                'overlapStart' => max($start, $overrideStart)->format('Y-m-d H:i:s'),
                'overlapEnd' => min($end, $overrideEnd)->format('Y-m-d H:i:s'),
            ];
        }
        return $occurrences;
    }

    /** Store notices inside the SAME transaction as approval; never send SMTP here. */
    public function createForApprovedOverride(array $override, bool $notifyOwner = false): array
    {
        if (!$this->pdo->inTransaction()) {
            throw new LogicException('Create override notices within the approval transaction.');
        }
        $request = $this->pdo->prepare('SELECT * FROM access_overrides WHERE override_id = ? AND approved_by IS NOT NULL');
        $request->execute([(int) ($override['id'] ?? 0)]);
        $approved = $request->fetch(PDO::FETCH_ASSOC);
        if (!$approved) {
            return [];
        }
        $start = self::dateTime((string) $approved['override_start']);
        $end = self::dateTime((string) $approved['override_end']);
        if (!$start || !$end || $end <= $start || $start->format('Y-m-d') !== $end->format('Y-m-d')) {
            throw new InvalidArgumentException('An approved override must have a valid single-day window.');
        }
        $ownerFilter = $notifyOwner ? 'u.is_active = 1' : 's.user_id <> :requester_id AND u.is_active = 1';
        $candidates = $this->pdo->prepare("SELECT s.*, u.email
            FROM schedules s INNER JOIN users u ON u.id = s.user_id
            WHERE {$ownerFilter}
              AND s.status IN ('approved', 'overridden')
              AND s.time_start < :time_end AND s.time_end > :time_start
              AND ((s.schedule_type = 'single' AND s.schedule_date = :single_date)
                OR (s.schedule_type = 'recurring' AND s.start_date <= :range_end AND s.end_date >= :range_start))");
        $date = $start->format('Y-m-d');
        $params = [
            'time_start' => $start->format('H:i:s'),
            'time_end' => $end->format('H:i:s'),
            'single_date' => $date,
            'range_start' => $date,
            'range_end' => $date,
        ];
        if (!$notifyOwner) {
            $params['requester_id'] = (int) $approved['user_id'];
        }
        $candidates->execute($params);
        $recipients = [];
        $requesterId = (int) $approved['user_id'];
        foreach ($candidates->fetchAll(PDO::FETCH_ASSOC) as $schedule) {
            $isOwnOverride = (int) $schedule['user_id'] === $requesterId
                && (($schedule['schedule_kind'] ?? '') === 'override' || $schedule['status'] === 'overridden');
            if ($isOwnOverride) {
                continue;
            }
            if (($schedule['schedule_kind'] ?? '') === 'override' || $schedule['status'] === 'overridden') {
                $backing = $this->pdo->prepare('SELECT 1 FROM access_overrides WHERE user_id = ? AND approved_by IS NOT NULL AND override_start = ? AND override_end = ? LIMIT 1');
                $backing->execute([(int) $schedule['user_id'], $date . ' ' . $schedule['time_start'], $date . ' ' . $schedule['time_end']]);
                if (!$backing->fetchColumn()) {
                    continue;
                }
            }
            $occurrences = self::affectedOccurrences($schedule, $start, $end);
            if (!$occurrences) {
                continue;
            }
            $userId = (int) $schedule['user_id'];
            $recipients[$userId] ??= ['email' => trim((string) $schedule['email']), 'schedules' => []];
            array_push($recipients[$userId]['schedules'], ...$occurrences);
        }

        $ignore = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'ON CONFLICT (override_id, user_id) DO NOTHING' : 'ON DUPLICATE KEY UPDATE id = id';
        $insert = $this->pdo->prepare("INSERT INTO override_notifications
            (override_id,user_id,requester_name,recipient_email,reason,override_start,override_end,affected_schedules,created_at)
            VALUES (?,?,?,?,?,?,?,?,?) {$ignore}");
        $lookup = $this->pdo->prepare('SELECT id FROM override_notifications WHERE override_id = ? AND user_id = ?');
        $ids = [];
        foreach ($recipients as $userId => $recipient) {
            $insert->execute([
                (int) $approved['override_id'], $userId, trim((string) ($override['name'] ?? '')) ?: 'Another user',
                $recipient['email'], (string) ($approved['reason'] ?? ''), $start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s'),
                json_encode($recipient['schedules'], JSON_THROW_ON_ERROR), $this->now(),
            ]);
            $lookup->execute([(int) $approved['override_id'], $userId]);
            $ids[] = (int) $lookup->fetchColumn();
        }
        return $ids;
    }

    public function getUnacknowledged(int $userId): array
    {
        $statement = $this->pdo->prepare('SELECT n.* FROM override_notifications n WHERE n.user_id = ? AND n.acknowledged_at IS NULL AND ' . self::activeOverrideSql() . ' ORDER BY n.created_at ASC, n.id ASC');
        $statement->execute([$userId]);
        return array_map([self::class, 'mapNotification'], $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    public function acknowledge(int $userId, int $id): bool
    {
        $statement = $this->pdo->prepare('UPDATE override_notifications SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ? AND user_id = ?');
        $statement->execute([$this->now(), $id, $userId]);
        $check = $this->pdo->prepare('SELECT 1 FROM override_notifications WHERE id = ? AND user_id = ? AND acknowledged_at IS NOT NULL');
        $check->execute([$id, $userId]);
        return (bool) $check->fetchColumn();
    }

    /** Start SMTP outside the HTTP server so php -S can keep serving live notices. */
    public static function dispatchDelivery(int $overrideId, int $limit = 100): bool
    {
        try {
            return self::launchDetachedPhp(dirname(__DIR__) . '/tools/deliver_override_notifications.php', [
                (string) max(1, min(100, $limit)), (string) $overrideId, '--loop',
            ]);
        } catch (Throwable $error) {
            error_log('Override email worker could not start: ' . $error->getMessage());
            return false;
        }
    }

    private static function launchDetachedPhp(string $script, array $arguments): bool
    {
        if (!function_exists('exec')) {
            return false;
        }
        $windows = PHP_OS_FAMILY === 'Windows';
        $php = in_array(PHP_SAPI, ['cli', 'cli-server'], true) ? PHP_BINARY : PHP_BINDIR . ($windows ? '/php.exe' : '/php');
        if (!is_file($php) || !is_file($script)) {
            return false;
        }
        if ($windows) {
            if (!function_exists('iconv')) {
                return false;
            }
            $quote = static fn (string $value): string => "'" . str_replace("'", "''", $value) . "'";
            // Windows filenames cannot contain a double quote. Keep the script path
            // quoted inside Start-Process's ArgumentList when a checkout has spaces.
            $args = array_map(static fn (string $value): string => '"' . $value . '"', array_merge([$script], $arguments));
            $powershell = '$ErrorActionPreference = \'Stop\'; Start-Process -WindowStyle Hidden -FilePath '
                . $quote($php) . ' -ArgumentList @(' . implode(',', array_map($quote, $args)) . ') | Out-Null';
            $encoded = base64_encode(iconv('UTF-8', 'UTF-16LE', $powershell));
            exec('powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' . $encoded . ' 2>&1', $output, $status);
        } else {
            $command = implode(' ', array_map('escapeshellarg', array_merge([$php, $script], $arguments)));
            exec($command . ' > /dev/null 2>&1 &', $output, $status);
        }
        return $status === 0;
    }

    /** Safely retry known failures; claims and ambiguous sends are never automatically reclaimed. */
    public function deliverPending(?int $overrideId = null, int $limit = 20): array
    {
        if ($this->pdo->inTransaction()) {
            throw new LogicException('Deliver override email only after approval has committed.');
        }
        $limit = max(1, min(100, $limit));
        $statement = $this->pdo->prepare("SELECT n.* FROM override_notifications n
            INNER JOIN users u ON u.id = n.user_id AND u.is_active = 1
            WHERE n.email_status IN ('pending','failed') AND n.email_attempts < 5 AND n.override_end > ?
              AND " . self::activeOverrideSql() . ($overrideId === null ? '' : ' AND n.override_id = ?') . "
            ORDER BY n.email_attempts ASC, n.id ASC LIMIT {$limit}");
        $statement->execute($overrideId === null ? [$this->now()] : [$this->now(), $overrideId]);
        $result = ['sent' => 0, 'failed' => 0, 'uncertain' => 0, 'pending' => 0, 'retryable' => 0];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            // Revalidate every recipient: approval/account can be revoked while an
            // earlier recipient's SMTP send is in progress.
            $claim = $this->pdo->prepare("UPDATE override_notifications AS n SET email_status = 'sending', email_attempts = email_attempts + 1, email_attempted_at = ?, email_error = NULL
                WHERE id = ? AND email_status IN ('pending','failed') AND email_attempts < 5 AND override_end > ?
                  AND EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id AND u.is_active = 1)
                  AND " . self::activeOverrideSql());
            $claim->execute([$this->now(), (int) $row['id'], $this->now()]);
            if ($claim->rowCount() !== 1) {
                continue;
            }
            try {
                if (!filter_var($row['recipient_email'], FILTER_VALIDATE_EMAIL)) {
                    throw new RuntimeException('The affected user has no valid email address.');
                }
                ($this->sendMail)((string) $row['recipient_email'], 'Entrivo: an approved override overlaps your schedule', self::emailBody(self::mapNotification($row)));
            } catch (Throwable $error) {
                $state = $error instanceof MailDeliveryUncertainException ? 'uncertain' : 'failed';
                // A lost SMTP acceptance reply cannot be safely retried automatically.
                $mark = $this->pdo->prepare("UPDATE override_notifications SET email_status = ?, email_error = ? WHERE id = ? AND email_status = 'sending'");
                $mark->execute([$state, substr($error->getMessage(), 0, 1000), (int) $row['id']]);
                $result[$state]++;
                error_log('Override notice #' . $row['id'] . ' email ' . $state . ': ' . $error->getMessage());
                continue;
            }
            // If this write fails after SMTP accepts mail, leave the durable 'sending'
            // claim in place. A later worker must not resend an already accepted email.
            $mark = $this->pdo->prepare("UPDATE override_notifications SET email_status = 'sent', email_sent_at = ?, email_error = NULL WHERE id = ? AND email_status = 'sending'");
            $mark->execute([$this->now(), (int) $row['id']]);
            $result['sent']++;
        }
        $pending = $this->pdo->prepare("SELECT COUNT(*) AS pending_count, SUM(CASE WHEN n.email_attempts < 5 THEN 1 ELSE 0 END) AS retryable_count
            FROM override_notifications n WHERE n.email_status IN ('pending','failed') AND n.override_end > ?
              AND EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id AND u.is_active = 1)
              AND " . self::activeOverrideSql() . ($overrideId === null ? '' : ' AND n.override_id = ?'));
        $pending->execute($overrideId === null ? [$this->now()] : [$this->now(), $overrideId]);
        $remaining = $pending->fetch(PDO::FETCH_ASSOC);
        $result['pending'] = (int) $remaining['pending_count'];
        $result['retryable'] = (int) $remaining['retryable_count'];
        return $result;
    }

    private static function activeOverrideSql(): string
    {
        return "EXISTS (SELECT 1 FROM access_overrides a WHERE a.override_id = n.override_id AND a.approved_by IS NOT NULL
            AND EXISTS (SELECT 1 FROM schedules s WHERE s.user_id = a.user_id
                AND s.schedule_type = 'single' AND s.schedule_date = SUBSTR(a.override_start, 1, 10)
                AND s.time_start = SUBSTR(a.override_start, 12, 8) AND s.time_end = SUBSTR(a.override_end, 12, 8)
                AND s.status IN ('approved','overridden') AND (s.schedule_kind = 'override' OR s.status = 'overridden')))";
    }

    private static function mapNotification(array $row): array
    {
        return [
            'id' => (int) $row['id'], 'overrideId' => (int) $row['override_id'],
            'requesterName' => $row['requester_name'], 'reason' => $row['reason'],
            'overrideStart' => $row['override_start'], 'overrideEnd' => $row['override_end'],
            'affectedSchedules' => json_decode($row['affected_schedules'], true, 512, JSON_THROW_ON_ERROR),
            'createdAt' => $row['created_at'],
        ];
    }

    private static function emailBody(array $notice): string
    {
        $start = self::dateTime($notice['overrideStart'])->format('M j, Y g:i A');
        $end = self::dateTime($notice['overrideEnd'])->format('M j, Y g:i A');
        $lines = [
            'Entrivo Door Lock System', '',
            $notice['requesterName'] . " was granted temporary access that overlaps your schedule.",
            '', 'Override window: ' . $start . ' - ' . $end . ' (Asia/Manila)',
            'Reason: ' . ($notice['reason'] !== '' ? $notice['reason'] : 'No reason provided.'), '',
            'Your affected schedule(s):',
        ];
        foreach ($notice['affectedSchedules'] as $schedule) {
            $lines[] = '- ' . $schedule['date'] . ', ' . substr($schedule['timeStart'], 0, 5) . ' - ' . substr($schedule['timeEnd'], 0, 5)
                . ' (overlap: ' . substr($schedule['overlapStart'], 11, 5) . ' - ' . substr($schedule['overlapEnd'], 11, 5) . ')';
        }
        $lines[] = '';
        $lines[] = 'Sign in to your Entrivo dashboard to review and acknowledge this notice.';
        return implode("\n", $lines);
    }

    private static function recursOn(array $schedule, DateTimeImmutable $day): bool
    {
        $rule = $schedule['repeat_type'] ?? '';
        if ($rule === 'daily') {
            return true;
        }
        if ($rule === 'weekly') {
            $expected = trim((string) ($schedule['repeat_day'] ?? ''));
            if ($expected === '') {
                $expected = (new DateTimeImmutable($schedule['start_date'], new DateTimeZone('Asia/Manila')))->format('l');
            }
            return strcasecmp($day->format('l'), $expected) === 0;
        }
        if ($rule === 'weekly_selected') {
            $days = is_array($schedule['repeat_days'] ?? null) ? $schedule['repeat_days'] : json_decode((string) ($schedule['repeat_days'] ?? '[]'), true);
            if (is_array($days)) {
                foreach ($days as $selected) {
                    if (is_string($selected) && strcasecmp($day->format('l'), $selected) === 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private static function validTime(mixed $value): ?string
    {
        if (!is_string($value) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/D', $value)) {
            return null;
        }
        return strlen($value) === 5 ? $value . ':00' : $value;
    }

    private static function validDate(mixed $value): ?string
    {
        if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $value, $parts) || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
            return null;
        }
        return $value;
    }

    private static function dateTime(string $value): ?DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value, new DateTimeZone('Asia/Manila'));
        return $date && $date->format('Y-m-d H:i:s') === $value ? $date : null;
    }

    private function now(): string
    {
        return ($this->clock)()->setTimezone(new DateTimeZone('Asia/Manila'))->format('Y-m-d H:i:s');
    }
}
