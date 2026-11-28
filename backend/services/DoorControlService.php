<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/DoorStatusService.php';
require_once __DIR__ . '/ActivityLogService.php';
require_once __DIR__ . '/StaffRoomAccess.php';
require_once __DIR__ . '/AdminDoorAccess.php';
require_once __DIR__ . '/EmergencyCards.php';

/**
 * Portal controls for the door controller:
 *  - Scheduling mode. "auto" (default): entry needs a schedule while the
 *    controller is online; when it loses the backend, any finger enrolled on
 *    its sensor may enter (saved and logged later). "on": schedules always
 *    apply, offline too (offline, only the emergency card enters). "off":
 *    schedules never apply; any active registered user may enter.
 *  - Remote lock / unlock by a Super Admin, or an Admin with the
 *    "door_override" privilege. The command waits here until the
 *    controller's next status report picks it up and confirms it.
 *  - The portal emergency card, set by a Super Admin. It works next to the
 *    door's built-in card (Secrets.h): the controller receives it in its
 *    status reply, saves it in its own flash, and reports it back.
 * Each change needs the actor's own password, checked here on the server.
 */
final class DoorControlService
{
    public const MODES = ['auto', 'on', 'off'];
    public const ACTIONS = ['lock', 'unlock'];
    // A command the controller has not picked up within this time is dropped,
    // so a door that comes back online hours later does not act on it.
    public const COMMAND_TTL_SECONDS = 120;

    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? entrivo_pdo();
    }

    /** DDL commits implicitly: call outside a transaction. */
    public static function ensureSchema(PDO $pdo): void
    {
        $pdo->exec("CREATE TABLE IF NOT EXISTS door_controller_controls (
            device_id INT NOT NULL PRIMARY KEY,
            schedule_mode VARCHAR(10) NOT NULL DEFAULT 'auto',
            command VARCHAR(10) NULL DEFAULT NULL,
            command_id INT NOT NULL DEFAULT 0,
            command_by INT NULL DEFAULT NULL,
            command_at DATETIME NULL DEFAULT NULL,
            command_done_id INT NOT NULL DEFAULT 0,
            command_done_at DATETIME NULL DEFAULT NULL,
            mode_updated_by INT NULL DEFAULT NULL,
            mode_updated_at DATETIME NULL DEFAULT NULL
        )");
    }

    public const EMERGENCY_COLUMNS = [
        'emergency_card_uid' => 'VARCHAR(10) NULL DEFAULT NULL',
        'emergency_card_name' => 'VARCHAR(60) NULL DEFAULT NULL',
        'emergency_card_by' => 'INT NULL DEFAULT NULL',
        'emergency_card_at' => 'DATETIME NULL DEFAULT NULL',
        // What the controller last reported it has saved ('' = none).
        'emergency_card_door_uid' => 'VARCHAR(10) NULL DEFAULT NULL',
        'emergency_card_door_at' => 'DATETIME NULL DEFAULT NULL',
    ];

    /** Adds the portal emergency card columns. DDL commits implicitly: call outside a transaction. */
    public static function ensureEmergencySchema(PDO $pdo): void
    {
        self::ensureSchema($pdo);
        foreach (self::EMERGENCY_COLUMNS as $column => $type) {
            if ($pdo->query("SHOW COLUMNS FROM door_controller_controls LIKE '{$column}'")->fetch()) continue;
            try {
                $pdo->exec("ALTER TABLE door_controller_controls ADD COLUMN {$column} {$type}");
            } catch (PDOException $error) {
                if ((int) ($error->errorInfo[1] ?? 0) !== 1060) throw $error; // added meanwhile
            }
        }
    }

    /**
     * Portal emergency cards of every door, upper-case UID => name. Empty when
     * none is set or the columns do not exist yet.
     * @return array<string, string>
     */
    public static function portalEmergencyCards(PDO $pdo): array
    {
        try {
            $rows = $pdo->query("SELECT emergency_card_uid, emergency_card_name FROM door_controller_controls
                WHERE emergency_card_uid IS NOT NULL AND emergency_card_uid <> ''")->fetchAll(PDO::FETCH_NUM);
        } catch (PDOException) {
            return [];
        }
        $cards = [];
        foreach ($rows as [$uid, $name]) {
            $cards[strtoupper((string) $uid)] = is_string($name) && $name !== '' ? $name : EmergencyCards::DEFAULT_NAME;
        }
        return $cards;
    }

    /** Current controls of a device; defaults when nothing is stored yet. */
    public function controls(int $deviceId): array
    {
        $row = $this->row($deviceId);
        $pending = $row && $row['command'] !== null && $this->commandFresh($row) ? [
            'id' => (int) $row['command_id'],
            'action' => (string) $row['command'],
            'requested_at' => $row['command_at'],
        ] : null;
        return [
            'schedule_mode' => $row && in_array($row['schedule_mode'], self::MODES, true) ? $row['schedule_mode'] : 'auto',
            'pending_command' => $pending,
            'last_command' => $row && (int) $row['command_done_id'] > 0 ? [
                'id' => (int) $row['command_done_id'],
                'done_at' => $row['command_done_at'],
            ] : null,
        ];
    }

    /** Whether this active admin account may lock / unlock the door remotely. */
    public static function canOverride(PDO $pdo, int $userId): bool
    {
        require_once __DIR__ . '/UserPrivilegeService.php';
        $privileges = new UserPrivilegeService($pdo);
        return $privileges->actorRole($userId) === 'super_admin'
            || $privileges->actorHasPrivilege($userId, 'door_override');
    }

    public static function scheduleMode(PDO $pdo, int $deviceId): string
    {
        try {
            $query = $pdo->prepare('SELECT schedule_mode FROM door_controller_controls WHERE device_id = ?');
            $query->execute([$deviceId]);
            $mode = $query->fetchColumn();
        } catch (PDOException) {
            return 'auto'; // table not created yet
        }
        return is_string($mode) && in_array($mode, self::MODES, true) ? $mode : 'auto';
    }

    public function setScheduleMode(array $input): array
    {
        $actor = $this->authorizedActor($input, ['admin', 'super_admin']);
        $deviceId = $this->deviceId($input);
        $mode = $input['mode'] ?? null;
        if (!is_string($mode) || !in_array($mode, self::MODES, true)) {
            throw new DoorStatusException('Choose Auto, On, or Off for scheduling.', 422);
        }
        self::ensureSchema($this->pdo);
        $this->pdo->prepare('INSERT INTO door_controller_controls (device_id, schedule_mode, mode_updated_by, mode_updated_at)
            VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE schedule_mode = VALUES(schedule_mode),
            mode_updated_by = VALUES(mode_updated_by), mode_updated_at = NOW()')
            ->execute([$deviceId, $mode, $actor['id']]);
        $label = ['auto' => 'Auto (off only while the door is offline)', 'on' => 'On', 'off' => 'Off'][$mode];
        (new ActivityLogService($this->pdo))->record($actor['id'], 'Update', 'Set door scheduling to ' . $label . '.',
            'Success', null, 'door', (string) $deviceId);
        return ['success' => true, 'message' => 'Scheduling is now ' . $label . '.', 'controls' => $this->controls($deviceId)];
    }

    public function sendCommand(array $input): array
    {
        $action = $input['action'] ?? null;
        if (!is_string($action) || !in_array($action, self::ACTIONS, true)) {
            throw new DoorStatusException('Choose lock or unlock.', 422);
        }
        $actor = $this->authorizedActor($input, ['admin', 'super_admin']);
        $deviceId = $this->deviceId($input);
        // Super Admins can always override; an Admin needs the "door_override"
        // privilege, set by a Super Admin in Manage Users > Roles & Privileges.
        if ($actor['role'] !== 'super_admin' && !self::canOverride($this->pdo, $actor['id'])) {
            (new ActivityLogService($this->pdo))->record($actor['id'], 'Update',
                'Refused an attempt to remotely ' . $action . ' the door: no door override privilege.', 'Failed', null, 'door', (string) $deviceId);
            throw new DoorStatusException('Your account is not allowed to lock or unlock the door remotely. Ask a Super Admin for the door override privilege.', 403);
        }
        $door = (new DoorStatusService($this->pdo))->snapshot($deviceId);
        if (!$door['online']) {
            throw new DoorStatusException('The door controller is offline, so it cannot receive the command. Check its WiFi.', 409);
        }
        self::ensureSchema($this->pdo);
        $this->pdo->prepare('INSERT INTO door_controller_controls (device_id, command, command_id, command_by, command_at)
            VALUES (?, ?, 1, ?, NOW()) ON DUPLICATE KEY UPDATE command = VALUES(command), command_id = command_id + 1,
            command_by = VALUES(command_by), command_at = NOW()')
            ->execute([$deviceId, $action, $actor['id']]);
        (new ActivityLogService($this->pdo))->record($actor['id'], 'Update',
            ($action === 'lock' ? 'Locked' : 'Unlocked') . ' the door remotely from the portal.', 'Success', null, 'door', (string) $deviceId);
        return ['success' => true, 'message' => 'Sent. The door ' . ($action === 'lock' ? 'locks' : 'unlocks') . ' within a few seconds.',
            'controls' => $this->controls($deviceId)];
    }

    /**
     * For the controller's status report: confirm a finished command and hand
     * over the current mode and any pending command.
     */
    public function forController(int $deviceId, mixed $doneId, mixed $reportedCardUid = null): array
    {
        try {
            // The portal emergency card the controller has saved (newer firmware only).
            if (is_string($reportedCardUid) && ($reportedCardUid === '' || preg_match('/^[A-Fa-f0-9]{10}$/D', $reportedCardUid) === 1)) {
                try {
                    $this->pdo->prepare('UPDATE door_controller_controls SET
                            emergency_card_door_at = IF(emergency_card_door_uid <=> ?, emergency_card_door_at, NOW()),
                            emergency_card_door_uid = ?
                        WHERE device_id = ?')
                        ->execute([strtoupper($reportedCardUid), strtoupper($reportedCardUid), $deviceId]);
                } catch (PDOException) {
                    // Columns not added yet: no portal card has been set.
                }
            }
            if (is_int($doneId) && $doneId > 0) {
                $before = $this->row($deviceId);
                $done = $this->pdo->prepare('UPDATE door_controller_controls SET command = NULL, command_done_id = ?, command_done_at = NOW()
                    WHERE device_id = ? AND command_id = ? AND command IS NOT NULL');
                $done->execute([$doneId, $deviceId, $doneId]);
                if ($done->rowCount() > 0 && $before) {
                    // For the Door control logs: the door really carried it out.
                    (new ActivityLogService($this->pdo))->record((int) $before['command_by'] ?: null, 'Update',
                        'The door confirmed the remote ' . ($before['command'] === 'lock' ? 'lock' : 'unlock') . '.',
                        'Success', null, 'door', (string) $deviceId);
                }
            }
            $controls = $this->controls($deviceId);
        } catch (PDOException) {
            return ['schedule_mode' => 'auto'];
        }
        $reply = ['schedule_mode' => $controls['schedule_mode']];
        // Always sent once the columns exist, so removing it reaches the door
        // too ('' = no portal card). Left out otherwise: the door keeps its own.
        $row = $this->row($deviceId);
        if ($row && array_key_exists('emergency_card_uid', $row)) {
            $reply['emergency_card'] = [
                'uid' => (string) ($row['emergency_card_uid'] ?? ''),
                'name' => (string) ($row['emergency_card_name'] ?? ''),
            ];
        }
        if ($controls['pending_command']) {
            $reply['command'] = ['id' => $controls['pending_command']['id'], 'action' => $controls['pending_command']['action']];
        }
        return $reply;
    }

    /**
     * Door control logs: scheduling changes, remote lock/unlock requests, the
     * door's confirmations and refused attempts, newest first.
     */
    /**
     * Staff room access for the portal (GET ?view=room_access&actor_id=):
     * the room hours and the staff allowed to enter during them. Admins can
     * view it; only a Super Admin can change it.
     */
    public function roomAccess(array $input): array
    {
        $actor = $this->viewer($input, 'Only an administrator can view staff room access.');
        $deviceId = $this->deviceId($input);
        $hours = StaffRoomAccess::hours($this->pdo, $deviceId);
        return [
            'success' => true,
            'hours' => [
                'start' => substr($hours['start'], 0, 5),
                'end' => substr($hours['end'], 0, 5),
                'label' => StaffRoomAccess::label($hours['start']) . ' – ' . StaffRoomAccess::label($hours['end']),
                'enabled' => $hours['enabled'],
            ],
            'allowed_user_ids' => StaffRoomAccess::allowedUserIds($this->pdo),
            // Admins who need a schedule to enter (the rest enter any time).
            'admin_schedule_required_ids' => AdminDoorAccess::scheduleRequiredUserIds($this->pdo),
            'can_edit' => $actor['role'] === 'super_admin',
        ];
    }

    public function setRoomHours(array $input): array
    {
        $actor = $this->authorizedActor($input, ['super_admin']);
        $deviceId = $this->deviceId($input);
        $start = $this->timeInput($input['start'] ?? null);
        $end = $this->timeInput($input['end'] ?? null);
        if ($start === null || $end === null || $end <= $start) {
            throw new DoorStatusException('Choose a start time before the end time, for example 06:00 to 21:00.', 422);
        }
        $enabled = $input['enabled'] ?? null; // optional: true/false turns the daily hours on or off
        if ($enabled !== null && !is_bool($enabled)) {
            throw new DoorStatusException('enabled must be true or false.', 422);
        }
        StaffRoomAccess::ensureSchema($this->pdo);
        $before = StaffRoomAccess::hours($this->pdo, $deviceId);
        $enabled ??= $before['enabled'];
        $this->pdo->prepare('INSERT INTO door_controller_controls (device_id, room_hours_start, room_hours_end, room_hours_enabled)
            VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE room_hours_start = VALUES(room_hours_start),
            room_hours_end = VALUES(room_hours_end), room_hours_enabled = VALUES(room_hours_enabled)')
            ->execute([$deviceId, $start, $end, $enabled ? 1 : 0]);
        $label = StaffRoomAccess::label($start) . ' – ' . StaffRoomAccess::label($end);
        $timesChanged = $start !== $before['start'] || $end !== $before['end'];
        [$log, $message] = match (true) {
            !$enabled && $before['enabled'] => ['Turned off the staff room hours.',
                'Staff room hours are off. Staff need a schedule to enter until they are turned on again.'],
            $enabled && !$before['enabled'] => ['Turned on the staff room hours (' . $label . ', every day).',
                'Staff room hours are on: ' . $label . ' every day until turned off.'],
            default => ['Set the staff room hours to ' . $label . '.', 'Staff room hours are now ' . $label . '.'],
        };
        if ($timesChanged && $enabled !== $before['enabled']) $log = rtrim($log, '.') . ' and set them to ' . $label . '.';
        (new ActivityLogService($this->pdo))->record($actor['id'], 'Update', $log, 'Success', null, 'door', (string) $deviceId);
        return ['success' => true, 'message' => $message] + $this->roomAccess($input);
    }

    public function setStaffRoomAccess(array $input): array
    {
        $actor = $this->authorizedActor($input, ['super_admin']);
        $deviceId = $this->deviceId($input);
        $userId = filter_var($input['user_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $allowed = $input['allowed'] ?? null;
        if ($userId === false || !is_bool($allowed)) {
            throw new DoorStatusException('Choose a staff member and whether to allow room hours.', 422);
        }
        $query = $this->pdo->prepare('SELECT id, role, username FROM users WHERE id = ?');
        $query->execute([$userId]);
        $person = $query->fetch(PDO::FETCH_ASSOC);
        if (!$person || $person['role'] !== 'staff') {
            throw new DoorStatusException('Room hours access is only for staff accounts.', 422);
        }
        StaffRoomAccess::ensureSchema($this->pdo);
        if ($allowed) {
            $this->pdo->prepare('INSERT INTO staff_room_access (user_id, granted_by, granted_at) VALUES (?, ?, NOW())
                ON DUPLICATE KEY UPDATE granted_by = VALUES(granted_by), granted_at = NOW()')->execute([$userId, $actor['id']]);
        } else {
            $this->pdo->prepare('DELETE FROM staff_room_access WHERE user_id = ?')->execute([$userId]);
        }
        $name = $this->personName((int) $userId) ?? (string) $person['username'];
        (new ActivityLogService($this->pdo))->record($actor['id'], 'Update',
            ($allowed ? 'Allowed ' : 'Removed ') . $name . ($allowed ? ' to enter during the staff room hours.' : ' from the staff room hours.'),
            'Success', null, 'door', (string) $deviceId);
        return ['success' => true, 'message' => $allowed
            ? $name . ' can now enter during the room hours without a schedule.'
            : $name . ' now needs a schedule again to enter.'] + $this->roomAccess($input);
    }

    /** Super Admin: whether an Admin enters any time or needs a schedule (user_id, any_time). */
    public function setAdminDoorAccess(array $input): array
    {
        $actor = $this->authorizedActor($input, ['super_admin']);
        $deviceId = $this->deviceId($input);
        $userId = filter_var($input['user_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $anyTime = $input['any_time'] ?? null;
        if ($userId === false || !is_bool($anyTime)) {
            throw new DoorStatusException('Choose an Admin and whether they can enter any time.', 422);
        }
        $query = $this->pdo->prepare('SELECT id, role, username FROM users WHERE id = ?');
        $query->execute([$userId]);
        $person = $query->fetch(PDO::FETCH_ASSOC);
        if (!$person || $person['role'] !== 'admin') {
            throw new DoorStatusException('Door access can only be set for Admin accounts. Super Admins always enter any time.', 422);
        }
        AdminDoorAccess::set($this->pdo, (int) $userId, $anyTime, $actor['id']);
        $name = $this->adminName((int) $userId) ?? (string) $person['username'];
        (new ActivityLogService($this->pdo))->record($actor['id'], 'Update', $anyTime
            ? 'Allowed ' . $name . ' (Admin) to enter the room any time without a schedule.'
            : 'Set ' . $name . ' (Admin) to need a schedule to enter the room.', 'Success', (int) $userId, 'door', (string) $deviceId);
        return ['success' => true, 'message' => $anyTime
            ? $name . ' can now enter the room any time, without a schedule.'
            : $name . ' now needs a schedule or an approved override to enter the room.'] + $this->roomAccess($input);
    }

    /**
     * Super Admin view of the portal emergency card (GET ?view=emergency_card):
     * the card, who set it, and whether the door has saved it.
     */
    public function emergencyCard(array $input): array
    {
        $actor = $this->viewer($input, 'Only a Super Admin can view the emergency card.');
        if ($actor['role'] !== 'super_admin') {
            throw new DoorStatusException('Only a Super Admin can view the emergency card.', 403);
        }
        $deviceId = $this->deviceId($input);
        $row = $this->row($deviceId);
        $has = $row && array_key_exists('emergency_card_uid', $row);
        $uid = $has ? (string) ($row['emergency_card_uid'] ?? '') : '';
        $doorUid = $has ? $row['emergency_card_door_uid'] : null;
        $setBy = $has && $row['emergency_card_by'] ? ($this->adminName((int) $row['emergency_card_by']) ?? 'A Super Admin') : null;
        return [
            'success' => true,
            'card' => $uid !== '' ? [
                'uid' => $uid,
                'name' => (string) ($row['emergency_card_name'] ?: EmergencyCards::DEFAULT_NAME),
                'set_at' => $row['emergency_card_at'],
                'set_by' => $setBy,
            ] : null,
            // null: the door has not reported it (older firmware, or not yet).
            'door' => $doorUid === null ? null : [
                'uid' => (string) $doorUid,
                'matches' => strtoupper((string) $doorUid) === strtoupper($uid),
                'reported_at' => $row['emergency_card_door_at'],
            ],
            'built_in' => $this->builtInCard($deviceId),
        ];
    }

    /** Super Admin: set (uid, name) or remove (uid "") the portal emergency card. */
    public function setEmergencyCard(array $input): array
    {
        $actor = $this->authorizedActor($input, ['super_admin']);
        $deviceId = $this->deviceId($input);
        $uid = $input['uid'] ?? null;
        $uid = is_string($uid) ? strtoupper(preg_replace('/\s+/', '', $uid)) : null;
        if ($uid === null || ($uid !== '' && preg_match('/^[A-F0-9]{10}$/D', $uid) !== 1)) {
            throw new DoorStatusException('Enter the card UID: 10 characters, 0-9 and A-F.', 422);
        }
        $name = is_string($input['name'] ?? null) ? trim(preg_replace('/\s+/', ' ', $input['name'])) : '';
        $name = $name !== '' ? mb_substr($name, 0, 60) : EmergencyCards::DEFAULT_NAME;
        if ($uid !== '') {
            try {
                $query = $this->pdo->prepare('SELECT 1 FROM rfid_cards WHERE UPPER(rfid_uid) = ? LIMIT 1');
                $query->execute([$uid]);
                $taken = (bool) $query->fetchColumn();
            } catch (PDOException) {
                $taken = false; // no cards table yet
            }
            if ($taken) {
                throw new DoorStatusException('This card is registered to a user. Use an unregistered card as the emergency card.', 422);
            }
            if (($this->builtInCard($deviceId)['uid'] ?? null) === $uid) {
                throw new DoorStatusException("This is already the door's built-in emergency card. Use a different card.", 422);
            }
        }
        self::ensureEmergencySchema($this->pdo);
        $before = $this->row($deviceId);
        $beforeUid = $before ? (string) ($before['emergency_card_uid'] ?? '') : '';
        $this->pdo->prepare('INSERT INTO door_controller_controls (device_id, emergency_card_uid, emergency_card_name, emergency_card_by, emergency_card_at)
            VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE emergency_card_uid = VALUES(emergency_card_uid),
            emergency_card_name = VALUES(emergency_card_name), emergency_card_by = VALUES(emergency_card_by), emergency_card_at = NOW()')
            ->execute([$deviceId, $uid === '' ? null : $uid, $uid === '' ? null : $name, $actor['id']]);
        EmergencyCards::reset();
        // The door's saved schedule copy lists emergency cards too: rebuild its version now.
        @unlink(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'entrivo_door_access_cache_' . $deviceId . '.json');
        $ending = static fn (string $value): string => 'ending ' . substr($value, -4);
        $log = $uid === ''
            ? 'Removed the portal emergency card' . ($beforeUid !== '' ? ' (card ' . $ending($beforeUid) . ')' : '') . '.'
            : ($beforeUid === $uid ? 'Renamed the portal emergency card (card ' . $ending($uid) . ') to ' . $name . '.'
                : 'Set the portal emergency card to ' . $name . ' (card ' . $ending($uid) . ')'
                    . ($beforeUid !== '' ? ', replacing card ' . $ending($beforeUid) : '') . '.');
        (new ActivityLogService($this->pdo))->record($actor['id'], 'Update', $log, 'Success', null, 'door', (string) $deviceId);
        return ['success' => true, 'message' => $uid === ''
            ? 'Removed. The door stops accepting that card once it receives the change.'
            : 'Saved. The door accepts ' . $name . ' once it receives the change, within a few seconds while online.']
            + $this->emergencyCard($input);
    }

    /** The door's built-in card (Secrets.h), as the controller reported it; null if never reported. */
    private function builtInCard(int $deviceId): ?array
    {
        try {
            $query = $this->pdo->prepare('SELECT rfid_uid, card_name FROM door_emergency_cards WHERE device_id = ? ORDER BY reported_at DESC LIMIT 1');
            $query->execute([$deviceId]);
            $row = $query->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException) {
            return null; // the door has not reported its card yet
        }
        return $row ? ['uid' => strtoupper((string) $row['rfid_uid']), 'name' => (string) $row['card_name']] : null;
    }

    private function adminName(int $userId): ?string
    {
        if (!$this->hasInfoTables()) return null;
        $query = $this->pdo->prepare("SELECT NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') FROM admin_info WHERE user_id = ?");
        $query->execute([$userId]);
        $name = $query->fetchColumn();
        return is_string($name) && $name !== '' ? $name : null;
    }

    public function history(array $input): array
    {
        $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $query = $this->pdo->prepare('SELECT role, is_active FROM users WHERE id = ?');
        $query->execute([$actorId === false ? 0 : $actorId]);
        $actor = $query->fetch(PDO::FETCH_ASSOC);
        if (!$actor || (int) $actor['is_active'] !== 1 || !in_array($actor['role'], ['admin', 'super_admin'], true)) {
            throw new DoorStatusException('Only an administrator can view the door control logs.', 403);
        }
        $deviceId = $this->deviceId($input);
        (new ActivityLogService($this->pdo))->ensureTable();
        $names = $this->hasInfoTables() ? "COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', fi.first_name, fi.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), ''),
                u.username)" : 'u.username';
        $joins = $this->hasInfoTables() ? 'LEFT JOIN admin_info ai ON ai.user_id = u.id
            LEFT JOIN faculty_info fi ON fi.user_id = u.id LEFT JOIN staff_info st ON st.user_id = u.id' : '';
        $query = $this->pdo->prepare("SELECT t.transaction_id, t.description, t.status, t.created_at, u.role,
                {$names} AS actor_name
            FROM activity_transactions t LEFT JOIN users u ON u.id = t.actor_user_id {$joins}
            WHERE t.entity_type = 'door' AND t.entity_id = ?
            ORDER BY t.created_at DESC, t.transaction_id DESC LIMIT 100");
        $query->execute([(string) $deviceId]);
        $logs = array_map(static fn (array $row): array => [
            'id' => (int) $row['transaction_id'],
            'description' => $row['description'],
            'status' => $row['status'],
            'created_at' => $row['created_at'],
            'actor_name' => $row['actor_name'] ?: 'System',
            'actor_role' => $row['role'],
        ], $query->fetchAll(PDO::FETCH_ASSOC));
        return ['success' => true, 'logs' => $logs];
    }

    /** An active admin or super admin, by actor_id (read-only views). */
    private function viewer(array $input, string $message): array
    {
        $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $query = $this->pdo->prepare('SELECT id, role, is_active FROM users WHERE id = ?');
        $query->execute([$actorId === false ? 0 : $actorId]);
        $actor = $query->fetch(PDO::FETCH_ASSOC);
        if (!$actor || (int) $actor['is_active'] !== 1 || !in_array($actor['role'], ['admin', 'super_admin'], true)) {
            throw new DoorStatusException($message, 403);
        }
        return ['id' => (int) $actor['id'], 'role' => $actor['role']];
    }

    /** "06:00" or "06:00:00" -> "06:00:00", else null. */
    private function timeInput(mixed $value): ?string
    {
        if (!is_string($value)) return null;
        $value = strlen($value) === 5 ? $value . ':00' : $value;
        return StaffRoomAccess::validTime($value) ? $value : null;
    }

    private function personName(int $userId): ?string
    {
        if (!$this->hasInfoTables()) return null;
        $query = $this->pdo->prepare("SELECT COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', st.first_name, st.last_name)), ''),
                NULLIF(TRIM(CONCAT_WS(' ', fi.first_name, fi.last_name)), ''))
            FROM users u LEFT JOIN staff_info st ON st.user_id = u.id LEFT JOIN faculty_info fi ON fi.user_id = u.id WHERE u.id = ?");
        $query->execute([$userId]);
        $name = $query->fetchColumn();
        return is_string($name) && $name !== '' ? $name : null;
    }

    private function hasInfoTables(): bool
    {
        static $has = null;
        if ($has === null) {
            try {
                $this->pdo->query('SELECT 1 FROM admin_info LIMIT 0');
                $this->pdo->query('SELECT 1 FROM faculty_info LIMIT 0');
                $this->pdo->query('SELECT 1 FROM staff_info LIMIT 0');
                $has = true;
            } catch (PDOException) {
                $has = false;
            }
        }
        return $has;
    }

    private function row(int $deviceId): array|false
    {
        try {
            $query = $this->pdo->prepare('SELECT *, TIMESTAMPDIFF(SECOND, command_at, NOW()) AS command_age FROM door_controller_controls WHERE device_id = ?');
            $query->execute([$deviceId]);
            return $query->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException) {
            return false;
        }
    }

    private function commandFresh(array $row): bool
    {
        return $row['command_age'] !== null && (int) $row['command_age'] <= self::COMMAND_TTL_SECONDS;
    }

    private function deviceId(array $input): int
    {
        $deviceId = filter_var($input['device_id'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($deviceId === false) throw new DoorStatusException('A valid door controller is required.', 422);
        return $deviceId;
    }

    /** The actor must hold one of the roles, be active, and give their own password. */
    private function authorizedActor(array $input, array $roles): array
    {
        $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $password = $input['password'] ?? null;
        if ($actorId === false || !is_string($password) || $password === '') {
            throw new DoorStatusException('Sign in again and enter your security password.', 422);
        }
        $query = $this->pdo->prepare('SELECT id, role, is_active, password_hash FROM users WHERE id = ?');
        $query->execute([$actorId]);
        $user = $query->fetch(PDO::FETCH_ASSOC);
        if (!$user || (int) $user['is_active'] !== 1 || !in_array($user['role'], $roles, true)) {
            throw new DoorStatusException(in_array($input['action'] ?? '', self::ACTIONS, true)
                ? 'Only an administrator with the door override privilege can lock or unlock the door remotely.'
                : (in_array('admin', $roles, true)
                ? 'Only an administrator can change door scheduling.'
                : (($input['action'] ?? '') === 'emergency_card'
                    ? 'Only a Super Admin can change the emergency card.'
                : (in_array($input['action'] ?? '', ['room_hours', 'staff_room_access', 'admin_door_access'], true)
                    ? 'Only a Super Admin can change who enters the room without a schedule.'
                    : 'Only a Super Admin can lock or unlock the door remotely.'))), 403);
        }
        if (!password_verify($password, (string) $user['password_hash'])) {
            $what = match ($input['action'] ?? '') {
                'schedule_mode' => 'change door scheduling',
                'room_hours' => 'change the staff room hours',
                'staff_room_access' => 'change staff room access',
                'admin_door_access' => 'change an Admin door access setting',
                'emergency_card' => 'change the emergency card',
                'lock' => 'remotely lock the door',
                default => 'remotely unlock the door',
            };
            (new ActivityLogService($this->pdo))->record((int) $user['id'], 'Update',
                'Refused an attempt to ' . $what . ': incorrect security password.', 'Failed', null, 'door',
                (string) $this->deviceId($input));
            throw new DoorStatusException('The security password is incorrect.', 422);
        }
        return ['id' => (int) $user['id'], 'role' => $user['role']];
    }
}
