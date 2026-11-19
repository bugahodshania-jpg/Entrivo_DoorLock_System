<?php

require_once __DIR__ . '/../config/connection.php';
require_once __DIR__ . '/DoorStatusService.php';
require_once __DIR__ . '/ActivityLogService.php';

/**
 * Portal controls for the door controller:
 *  - Scheduling mode. "auto" (default): entry needs a schedule while the
 *    controller is online; when it loses the backend, any finger enrolled on
 *    its sensor may enter (saved and logged later). "on": schedules always
 *    apply, offline too (offline, only the emergency card enters). "off":
 *    schedules never apply; any active registered user may enter.
 *  - Remote lock / unlock by a Super Admin. The command waits here until the
 *    controller's next status report picks it up and confirms it.
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
        $actor = $this->authorizedActor($input, ['super_admin']);
        $deviceId = $this->deviceId($input);
        $action = $input['action'] ?? null;
        if (!is_string($action) || !in_array($action, self::ACTIONS, true)) {
            throw new DoorStatusException('Choose lock or unlock.', 422);
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
    public function forController(int $deviceId, mixed $doneId): array
    {
        try {
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
        if ($controls['pending_command']) {
            $reply['command'] = ['id' => $controls['pending_command']['id'], 'action' => $controls['pending_command']['action']];
        }
        return $reply;
    }

    /**
     * Door control logs: scheduling changes, remote lock/unlock requests, the
     * door's confirmations and refused attempts, newest first.
     */
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
            throw new DoorStatusException(in_array('admin', $roles, true)
                ? 'Only an administrator can change door scheduling.'
                : 'Only a Super Admin can lock or unlock the door remotely.', 403);
        }
        if (!password_verify($password, (string) $user['password_hash'])) {
            $what = ($input['action'] ?? '') === 'schedule_mode'
                ? 'change door scheduling' : 'remotely ' . (($input['action'] ?? '') === 'lock' ? 'lock' : 'unlock') . ' the door';
            (new ActivityLogService($this->pdo))->record((int) $user['id'], 'Update',
                'Refused an attempt to ' . $what . ': incorrect security password.', 'Failed', null, 'door',
                (string) $this->deviceId($input));
            throw new DoorStatusException('The security password is incorrect.', 422);
        }
        return ['id' => (int) $user['id'], 'role' => $user['role']];
    }
}
