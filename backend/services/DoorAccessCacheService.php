<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/ScheduleStatusService.php';
require_once __DIR__ . '/ScheduleAccessPolicy.php';
require_once __DIR__ . '/DirectFingerprintAccessService.php';
require_once __DIR__ . '/EmergencyCards.php';

/**
 * The door's offline schedule copy. While online, the door controller keeps
 * a small binary list of who may enter during the next days, so that when it
 * loses the backend it still checks schedules itself instead of letting every
 * enrolled finger in. The same rules as a live entry decide what goes in:
 *  - a credential is listed only when it would pass every non-schedule entry
 *    check (active card or confirmed active fingerprint, active and set-up
 *    account, a door role);
 *  - faculty / staff: approved regular and override windows;
 *  - students: approved override windows only;
 *  - admin / super_admin, and emergency cards: any time (no windows).
 *
 * Binary format 1, little-endian; ESP32 AccessCacheFormat.h reads it.
 *   Header (40 bytes): "ENAC", u16 format, u16 header size, u32 version,
 *     u32 generated_at, u32 valid_from, u32 valid_until, u16 people,
 *     u16 credentials, u16 windows, u16 0, u32 payload CRC-32, u32 payload size.
 *   People (12 bytes): u32 user_id, u8 role, u8 flags, u16 first window,
 *     u16 window count, u16 0.
 *   Credentials (12 bytes): u8 type (1 finger, 2 card), u8 flags, u16 slot,
 *     5 UID bytes, u8 0, u16 person index.
 *   Windows (12 bytes): u32 start, u32 end (Unix time), u8 kind
 *     (1 regular, 2 override), 3 zero bytes.
 * valid_from is midnight today in Asia/Manila; the copy covers whole days up
 * to valid_until. The version is the CRC-32 of the validity range and the
 * payload, so it changes only when the door's answers would change.
 */
final class DoorAccessCacheService
{
    public const FORMAT = 1;
    public const HEADER_BYTES = 40;
    public const RECORD_BYTES = 12;
    public const DAYS = 8;                  // today and the next 7 days
    public const MAX_BYTES = 61440;         // the controller stores up to 64 KB per copy
    public const MAX_WINDOWS_PER_PERSON = 128;
    public const VERSION_TTL_SECONDS = 60;  // heartbeat replies reuse a version this long

    public const ROLE_CODES = ['student' => 1, 'faculty' => 2, 'staff' => 3, 'admin' => 4, 'super_admin' => 5];
    public const FLAG_ALWAYS = 1;
    public const TYPE_FINGER = 1;
    public const TYPE_CARD = 2;
    public const KIND_REGULAR = 1;
    public const KIND_OVERRIDE = 2;

    /** $slotOwner (tests): replaces the fingerprint slot check, fn(int $deviceId, int $slot): ?array. */
    public function __construct(private PDO $pdo, private ?Closure $slotOwner = null)
    {
    }

    /**
     * Version for the heartbeat reply, rebuilt at most once a minute per door.
     */
    public function cachedVersion(int $deviceId, ?DateTimeImmutable $now = null): int
    {
        $file = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'entrivo_door_access_cache_' . $deviceId . '.json';
        $time = $now ? $now->getTimestamp() : time();
        $saved = @json_decode((string) @file_get_contents($file), true);
        if (is_array($saved) && isset($saved['version'], $saved['at'])
            && $time - (int) $saved['at'] < self::VERSION_TTL_SECONDS && $time >= (int) $saved['at']) {
            return (int) $saved['version'];
        }
        $version = $this->build($deviceId, $now)['version'];
        @file_put_contents($file, json_encode(['version' => $version, 'at' => $time]), LOCK_EX);
        return $version;
    }

    /**
     * @return array{bytes: string, version: int, people: int, credentials: int, windows: int,
     *     valid_from: int, valid_until: int, days: int}
     */
    public function build(int $deviceId, ?DateTimeImmutable $now = null): array
    {
        $zone = new DateTimeZone('Asia/Manila');
        $now = ($now ?? new DateTimeImmutable('now', $zone))->setTimezone($zone);
        $today = new DateTimeImmutable($now->format('Y-m-d') . ' 00:00:00', $zone);

        [$people, $credentials] = $this->collectCredentials($deviceId);
        $schedules = $this->schedulesFor(array_keys($people));
        $policy = new ScheduleAccessPolicy($this->pdo);

        // Fewer days when a large school would not fit the controller's copy.
        for ($days = self::DAYS; $days >= 1; $days--) {
            $packed = $this->pack($people, $credentials, $schedules, $policy, $today, $days, $now);
            if (strlen($packed['bytes']) <= self::MAX_BYTES) return $packed + ['days' => $days];
        }
        throw new RuntimeException('The door schedule copy does not fit the controller even for one day.');
    }

    /**
     * Everyone with a usable credential on this door, keyed by user id
     * (user id 0 = emergency cards that belong to no account).
     * @return array{0: array<int, array{role: int, flags: int}>, 1: list<array>}
     */
    private function collectCredentials(int $deviceId): array
    {
        $hasRole = (bool) $this->pdo->query("SHOW COLUMNS FROM users LIKE 'role'")->fetch();
        $people = [];
        $credentials = [];
        $addPerson = function (int $userId, ?string $role) use (&$people): void {
            if (isset($people[$userId])) return;
            $role = strtolower(trim((string) $role));
            $people[$userId] = [
                'role' => self::ROLE_CODES[$role] ?? 0,
                'flags' => in_array($role, ScheduleAccessPolicy::PERMANENT_OVERRIDE_ROLES, true) ? self::FLAG_ALWAYS : 0,
            ];
        };

        // Fingerprints: the sensor slots of this door, checked like a live entry.
        $slotOwner = $this->slotOwner ?? (function () {
            $service = new DirectFingerprintAccessService($this->pdo);
            return static fn (int $deviceId, int $slot): ?array => $service->usableSlotOwner($deviceId, $slot);
        })();
        $slots = $this->pdo->prepare('SELECT DISTINCT enrollment_slot FROM fingerprints
            WHERE enrollment_device_id = ? AND enrollment_slot BETWEEN 1 AND 65535 ORDER BY enrollment_slot');
        $slots->execute([$deviceId]);
        foreach ($slots->fetchAll(PDO::FETCH_COLUMN) as $slot) {
            $owner = $slotOwner($deviceId, (int) $slot);
            if ($owner === null) continue;
            $addPerson($owner['user_id'], $owner['role']);
            $credentials[] = ['type' => self::TYPE_FINGER, 'flags' => 0, 'slot' => (int) $slot, 'uid' => '', 'user_id' => $owner['user_id']];
        }

        // RFID cards: one active card for one active, set-up account.
        $emergency = EmergencyCards::uids();
        $cards = $this->pdo->query('SELECT UPPER(c.rfid_uid) AS uid, c.status, c.user_id, u.id AS owner, u.is_active,
                u.approval_status, u.must_change_password, u.onboarding_step' . ($hasRole ? ', u.role' : '') . '
            FROM rfid_cards c LEFT JOIN users u ON u.id = c.user_id')->fetchAll(PDO::FETCH_ASSOC);
        $byUid = [];
        foreach ($cards as $card) $byUid[(string) $card['uid']][] = $card;
        foreach ($byUid as $uid => $rows) {
            if (preg_match('/^[0-9A-F]{10}$/D', (string) $uid) !== 1 || count($rows) !== 1) continue;
            $card = $rows[0];
            $isEmergency = in_array((string) $uid, $emergency, true);
            if ($card['owner'] === null) {
                // An emergency card that belongs to no account enters at any time.
                if (!$isEmergency) continue;
                $people[0] ??= ['role' => 0, 'flags' => self::FLAG_ALWAYS];
                $credentials[] = ['type' => self::TYPE_CARD, 'flags' => self::FLAG_ALWAYS, 'slot' => 0, 'uid' => (string) $uid, 'user_id' => 0];
                continue;
            }
            $role = $hasRole ? strtolower(trim((string) ($card['role'] ?? ''))) : null;
            if ($card['status'] !== 'active' || (int) $card['is_active'] !== 1 || $card['approval_status'] !== 'approved'
                || (int) $card['must_change_password'] !== 0 || $card['onboarding_step'] !== 'done') {
                continue;
            }
            $addPerson((int) $card['owner'], $role);
            $credentials[] = ['type' => self::TYPE_CARD, 'flags' => $isEmergency ? self::FLAG_ALWAYS : 0,
                'slot' => 0, 'uid' => (string) $uid, 'user_id' => (int) $card['owner']];
        }
        // Emergency cards that were never registered as an RFID card at all.
        foreach ($emergency as $uid) {
            if (isset($byUid[$uid]) || preg_match('/^[0-9A-F]{10}$/D', $uid) !== 1) continue;
            $people[0] ??= ['role' => 0, 'flags' => self::FLAG_ALWAYS];
            $credentials[] = ['type' => self::TYPE_CARD, 'flags' => self::FLAG_ALWAYS, 'slot' => 0, 'uid' => $uid, 'user_id' => 0];
        }
        ksort($people);
        return [$people, $credentials];
    }

    /** @return array<int, list<array>> schedules by user id */
    private function schedulesFor(array $userIds): array
    {
        $userIds = array_values(array_filter($userIds, static fn ($id) => $id > 0));
        if ($userIds === []) return [];
        $marks = implode(',', array_fill(0, count($userIds), '?'));
        $query = $this->pdo->prepare("SELECT * FROM schedules WHERE user_id IN ($marks) ORDER BY schedule_id ASC");
        $query->execute($userIds);
        $byUser = [];
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $schedule) $byUser[(int) $schedule['user_id']][] = $schedule;
        return $byUser;
    }

    /**
     * Approved windows of one person on one date, as ScheduleAccessPolicy::evaluate
     * accepts them. @return list<array{0: int, 1: int, 2: int}> [start, end, kind]
     */
    private function windowsOn(array $schedules, int $userId, int $roleCode, string $date, DateTimeZone $zone, ScheduleAccessPolicy $policy): array
    {
        $windows = [];
        foreach ($schedules as $schedule) {
            if (ScheduleStatusService::normalizeStatus($schedule['status'] ?? null) !== 'approved'
                || !ScheduleAccessPolicy::occursOn($schedule, $date)) {
                continue;
            }
            $start = (string) $schedule['time_start'];
            $end = (string) $schedule['time_end'];
            if (!preg_match('/^\d{2}:\d{2}:\d{2}$/', $start) || !preg_match('/^\d{2}:\d{2}:\d{2}$/', $end) || $end <= $start) {
                continue;
            }
            $isOverride = strtolower(trim((string) $schedule['status'])) === 'overridden'
                || strtolower(trim((string) ($schedule['schedule_kind'] ?? 'regular'))) === 'override';
            // Students enter only on an approved override.
            if ($roleCode === self::ROLE_CODES['student'] && !$isOverride) continue;
            if ($isOverride && $policy->approvedOverrideId($userId, $date . ' ' . $start, $date . ' ' . $end) === null) continue;
            $windows[] = [
                (new DateTimeImmutable($date . ' ' . $start, $zone))->getTimestamp(),
                (new DateTimeImmutable($date . ' ' . $end, $zone))->getTimestamp(),
                $isOverride ? self::KIND_OVERRIDE : self::KIND_REGULAR,
            ];
        }
        return $windows;
    }

    private function pack(array $people, array $credentials, array $schedules, ScheduleAccessPolicy $policy,
        DateTimeImmutable $today, int $days, DateTimeImmutable $now): array
    {
        $zone = $today->getTimezone();
        $index = [];
        $peopleBytes = '';
        $windowBytes = '';
        $windowCount = 0;
        foreach ($people as $userId => $person) {
            $windows = [];
            if (!($person['flags'] & self::FLAG_ALWAYS)) {
                for ($day = 0; $day < $days; $day++) {
                    $date = $today->modify("+$day day")->format('Y-m-d');
                    array_push($windows, ...$this->windowsOn($schedules[$userId] ?? [], $userId, $person['role'], $date, $zone, $policy));
                }
                // Regular before override at the same start (regular has priority).
                usort($windows, static fn ($a, $b) => [$a[0], $a[2], $a[1]] <=> [$b[0], $b[2], $b[1]]);
                $windows = array_slice(array_values(array_unique($windows, SORT_REGULAR)), 0, self::MAX_WINDOWS_PER_PERSON);
            }
            $index[$userId] = count($index);
            $peopleBytes .= pack('VCCvvv', $userId, $person['role'], $person['flags'], $windowCount, count($windows), 0);
            foreach ($windows as [$start, $end, $kind]) {
                $windowBytes .= pack('VVCCCC', $start, $end, $kind, 0, 0, 0);
            }
            $windowCount += count($windows);
        }

        // Fingers before cards, each by key, so the list is stable.
        usort($credentials, static fn ($a, $b) => [$a['type'], $a['slot'], $a['uid']] <=> [$b['type'], $b['slot'], $b['uid']]);
        $credentialBytes = '';
        foreach ($credentials as $credential) {
            $uid = $credential['uid'] === '' ? str_repeat("\0", 5) : hex2bin($credential['uid']);
            $credentialBytes .= pack('CCv', $credential['type'], $credential['flags'], $credential['slot'])
                . $uid . "\0" . pack('v', $index[$credential['user_id']]);
        }
        if (count($people) > 65535 || count($credentials) > 65535 || $windowCount > 65535) {
            throw new RuntimeException('Too many people or schedules for the door schedule copy.');
        }

        $validFrom = $today->getTimestamp();
        $validUntil = $today->modify("+$days day")->getTimestamp();
        $payload = $peopleBytes . $credentialBytes . $windowBytes;
        $version = crc32(pack('VV', $validFrom, $validUntil) . $payload);
        $header = 'ENAC' . pack('vvVVVVvvvvVV', self::FORMAT, self::HEADER_BYTES, $version, $now->getTimestamp(),
            $validFrom, $validUntil, count($people), count($credentials), $windowCount, 0, crc32($payload), strlen($payload));
        return [
            'bytes' => $header . $payload,
            'version' => $version,
            'people' => count($people),
            'credentials' => count($credentials),
            'windows' => $windowCount,
            'valid_from' => $validFrom,
            'valid_until' => $validUntil,
        ];
    }
}
