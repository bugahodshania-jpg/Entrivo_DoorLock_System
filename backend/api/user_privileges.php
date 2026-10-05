<?php

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');
$allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://127.0.0.1:5173';
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowedOrigins, true) ? $origin : $allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    http_response_code(405);
    echo json_encode(['message' => 'Method not allowed.']);
    exit;
}

require_once dirname(__DIR__) . '/config/connection.php';
require_once dirname(__DIR__) . '/services/UserPrivilegeService.php';
require_once dirname(__DIR__) . '/services/ActivityLogService.php';
require_once dirname(__DIR__) . '/services/SuperAdminDashboardSession.php';

try {
    $pdo = entrivo_pdo();
    $privilegeService = new UserPrivilegeService($pdo);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $userId = filter_input(INPUT_GET, 'user_id', FILTER_VALIDATE_INT);

        if (!$userId) {
            http_response_code(422);
            echo json_encode(['message' => 'A valid user id is required.']);
            exit;
        }

        $user = fetchPrivilegeUser($pdo, $userId);

        if (!$user) {
            http_response_code(404);
            echo json_encode(['message' => 'That user was not found.']);
            exit;
        }

        if (!in_array($user['role'], ['admin', 'super_admin'], true)) {
            http_response_code(422);
            echo json_encode(['message' => 'Roles & privileges can only be managed for Admin and Super Admin accounts.']);
            exit;
        }

        $privileges = $privilegeService->getPrivileges($userId);

        echo json_encode([
            'message' => 'Privileges loaded.',
            'user' => $user,
            'role' => $user['role'],
            'privileges' => $privileges,
            'catalog' => UserPrivilegeService::catalog(),
            'role_defaults' => UserPrivilegeService::ROLE_DEFAULTS,
        ]);
        exit;
    }

    $input = json_decode(file_get_contents('php://input'), true);

    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['message' => 'Invalid JSON payload.']);
        exit;
    }

    $actorId = filter_var($input['actor_id'] ?? null, FILTER_VALIDATE_INT);
    $userId = filter_var($input['user_id'] ?? null, FILTER_VALIDATE_INT);
    $nextRole = strtolower(trim((string) ($input['role'] ?? '')));
    $privileges = $input['privileges'] ?? [];

    if (!$actorId) {
        http_response_code(422);
        echo json_encode(['message' => 'A valid actor id is required.']);
        exit;
    }

    if (!$userId) {
        http_response_code(422);
        echo json_encode(['message' => 'A valid user id is required.']);
        exit;
    }

    $actor = fetchPrivilegeUser($pdo, $actorId);

    if (!$actor || $actor['role'] !== 'super_admin' || !(bool) $actor['is_active']) {
        http_response_code(403);
        echo json_encode(['message' => 'Only an active Super Admin can update roles and privileges.']);
        exit;
    }

    if ((int) $actorId === (int) $userId) {
        http_response_code(403);
        echo json_encode([
            'message' => 'You can only view your own privileges.',
        ]);
        exit;
    }

    $user = fetchPrivilegeUser($pdo, $userId);

    if (!$user) {
        http_response_code(404);
        echo json_encode(['message' => 'That user was not found.']);
        exit;
    }

    if (!in_array($user['role'], ['admin', 'super_admin'], true)) {
        http_response_code(422);
        echo json_encode(['message' => 'Roles & privileges can only be managed for Admin and Super Admin accounts.']);
        exit;
    }

    if (!in_array($nextRole, ['admin', 'super_admin'], true)) {
        http_response_code(422);
        echo json_encode(['message' => 'Role must be Admin or Super Admin.']);
        exit;
    }

    if (!is_array($privileges)) {
        http_response_code(422);
        echo json_encode(['message' => 'Privileges must be a list of keys.']);
        exit;
    }

    if ($nextRole === 'super_admin' && $user['role'] !== 'super_admin') {
        assertCanPromoteToSuperAdmin($pdo, $userId);
    }

    if (
        $nextRole === 'admin'
        && $user['role'] === 'super_admin'
        && (int) $actorId === (int) $userId
    ) {
        throw new InvalidArgumentException('You cannot demote your own Super Admin account.');
    }

    if ($nextRole === 'admin' && $user['role'] === 'super_admin') {
        $activeSuperAdmins = (int) $pdo->query(
            "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND is_active = 1"
        )->fetchColumn();

        if ($activeSuperAdmins <= 1 && (bool) $user['is_active']) {
            throw new InvalidArgumentException('The last active Super Admin cannot be demoted.');
        }
    }

    $pdo->beginTransaction();

    try {
        if ($user['role'] !== $nextRole) {
            $roleUpdate = $pdo->prepare('UPDATE users SET role = :role WHERE id = :id');
            $roleUpdate->execute([
                'role' => $nextRole,
                'id' => $userId,
            ]);
        }

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $error;
    }

    if ($user['role'] === 'super_admin' && $nextRole === 'admin') {
        try {
            (new SuperAdminDashboardSession($pdo))->releaseIfHeldBy($userId);
            (new SuperAdminDashboardSession($pdo))->removeFromStandby($userId);
        } catch (Throwable) {
            // Optional session cleanup.
        }
    }

    if ($user['role'] !== 'super_admin' && $nextRole === 'super_admin') {
        try {
            (new SuperAdminDashboardSession($pdo))->placeOnStandbyIfSessionHeldByOther($userId);
        } catch (Throwable) {
            // Session standby sync is best-effort.
        }
    }

    $savedPrivileges = $privilegeService->setPrivileges($userId, $privileges);
    $updatedUser = fetchPrivilegeUser($pdo, $userId);

    (new ActivityLogService($pdo))->record(
        (int) $actorId,
        'Update',
        'Updated role and privileges for ' . trim((string) ($updatedUser['username'] ?? 'an administrator')) . '.',
        'Success',
        (int) $userId,
        'privileges',
        (string) $userId
    );

    echo json_encode([
        'message' => 'Roles and privileges updated successfully.',
        'user' => $updatedUser,
        'role' => $nextRole,
        'privileges' => $savedPrivileges,
        'catalog' => UserPrivilegeService::catalog(),
        'role_defaults' => UserPrivilegeService::ROLE_DEFAULTS,
    ]);
} catch (InvalidArgumentException $error) {
    http_response_code(422);
    echo json_encode(['message' => $error->getMessage()]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'message' => 'Unable to update roles and privileges right now.',
        'error' => $error->getMessage(),
    ]);
}

function fetchPrivilegeUser(PDO $pdo, int $userId): ?array
{
    $statement = $pdo->prepare(
        'SELECT users.id, users.username, users.email, users.role, users.is_active,
                admin_info.first_name, admin_info.middle_name, admin_info.last_name, admin_info.extension_name
         FROM users
         LEFT JOIN admin_info ON admin_info.user_id = users.id
         WHERE users.id = :id
         LIMIT 1'
    );
    $statement->execute(['id' => $userId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        return null;
    }

    $fullName = trim(implode(' ', array_filter([
        $row['first_name'] ?? null,
        $row['middle_name'] ?? null,
        $row['last_name'] ?? null,
        $row['extension_name'] ?? null,
    ])));

    return [
        'id' => (int) $row['id'],
        'username' => $row['username'],
        'email' => $row['email'],
        'role' => $row['role'],
        'is_active' => (bool) $row['is_active'],
        'name' => $fullName ?: $row['username'],
    ];
}

function assertCanPromoteToSuperAdmin(PDO $pdo, int $userId): void
{
    $superAdmins = $pdo->query(
        "SELECT id, is_active FROM users WHERE role = 'super_admin'"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $standbyMap = [];

    try {
        $standbyMap = (new SuperAdminDashboardSession($pdo))->standbyUserIdMap();
    } catch (Throwable) {
        $standbyMap = [];
    }

    $occupiedSlots = 0;

    foreach ($superAdmins as $row) {
        $id = (int) ($row['id'] ?? 0);

        if ($id === $userId) {
            continue;
        }

        $isActive = (bool) ($row['is_active'] ?? false);
        $isStandby = !empty($standbyMap[$id]);

        if ($isActive || $isStandby) {
            $occupiedSlots += 1;
        }
    }

    if ($occupiedSlots >= 2) {
        throw new InvalidArgumentException(
            'Only 2 active Super Admin accounts are allowed. Block an existing Super Admin before promoting another.'
        );
    }
}
