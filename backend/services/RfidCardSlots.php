<?php

require_once __DIR__ . '/RfidScanService.php';

/**
 * Each account has at most one primary RFID card. Faculty, staff, admins and
 * super admins may also hold one backup card. The door matches a tapped UID
 * to its row in rfid_cards, so a backup card opens the door under the same
 * person, schedule and role rules as the primary card.
 */
final class RfidCardSlots
{
    public const PRIMARY = 'primary';
    public const BACKUP = 'backup';
    public const BACKUP_ROLES = ['faculty', 'staff', 'admin', 'super_admin'];
    public const STATUSES = ['active', 'inactive', 'lost'];

    /** Adds rfid_cards.card_slot and swaps the one-card-per-user key for one card per slot. */
    public static function ensureSchema(PDO $pdo): void
    {
        $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
        if (!self::hasSlotColumn($pdo)) {
            if ($pdo->inTransaction()) {
                throw new RuntimeException('Add the rfid_cards card_slot column before beginning a transaction.');
            }
            try {
                $pdo->exec($sqlite
                    ? "ALTER TABLE rfid_cards ADD COLUMN card_slot TEXT NOT NULL DEFAULT 'primary'"
                    : "ALTER TABLE rfid_cards ADD COLUMN card_slot ENUM('primary','backup') NOT NULL DEFAULT 'primary' AFTER rfid_uid");
            } catch (PDOException $error) {
                if ((int) ($error->errorInfo[1] ?? 0) !== 1060) throw $error;
            }
        }
        if ($sqlite) return;

        $indexes = [];
        foreach ($pdo->query('SHOW INDEX FROM rfid_cards')->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $indexes[(string) $row['Key_name']][] = $row;
        }
        if (!isset($indexes['uq_rfid_cards_user_slot']) || isset($indexes['user_id'])) {
            if ($pdo->inTransaction()) {
                throw new RuntimeException('Update the rfid_cards keys before beginning a transaction.');
            }
        }
        // The new key is added first: the user_id foreign key always keeps an index.
        if (!isset($indexes['uq_rfid_cards_user_slot'])) {
            $pdo->exec('ALTER TABLE rfid_cards ADD UNIQUE KEY uq_rfid_cards_user_slot (user_id, card_slot)');
        }
        if (isset($indexes['user_id']) && (int) $indexes['user_id'][0]['Non_unique'] === 0) {
            $pdo->exec('ALTER TABLE rfid_cards DROP INDEX user_id');
        }
    }

    public static function hasSlotColumn(PDO $pdo): bool
    {
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            foreach ($pdo->query('PRAGMA table_info(rfid_cards)') as $row) {
                if (strcasecmp((string) ($row['name'] ?? ''), 'card_slot') === 0) return true;
            }
            return false;
        }
        $query = $pdo->query("SHOW COLUMNS FROM rfid_cards LIKE 'card_slot'");
        return (bool) ($query ? $query->fetch() : false);
    }

    public static function canHoldBackup(string $role): bool
    {
        return in_array(strtolower(trim($role)), self::BACKUP_ROLES, true);
    }

    public static function card(PDO $pdo, int $userId, string $slot): ?array
    {
        $statement = $pdo->prepare('SELECT card_id, rfid_uid, status FROM rfid_cards
            WHERE user_id = :user_id AND card_slot = :slot
            ORDER BY card_id DESC LIMIT 1');
        $statement->execute(['user_id' => $userId, 'slot' => $slot]);
        return $statement->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * Checks a requested backup card before any write. Returns the UID to
     * store (null removes the backup) and its status.
     *
     * @return array{uid: ?string, status: string}
     */
    public static function validateBackup(PDO $pdo, int $userId, string $role, mixed $uid, mixed $status, ?string $primaryUid): array
    {
        $uid = strtoupper(preg_replace('/\s+/', '', (string) ($uid ?? '')));
        $status = strtolower(trim((string) ($status ?? ''))) ?: 'active';
        if ($uid === '') return ['uid' => null, 'status' => 'active'];

        if (!self::canHoldBackup($role)) {
            throw new InvalidArgumentException('Only faculty, staff, admins and super admins can have a backup RFID UID.');
        }
        if (preg_match('/^[0-9A-F]{10}$/D', $uid) !== 1) {
            throw new InvalidArgumentException('Backup RFID UID must be the 10-character UID shown on the scanner (0-9, A-F).');
        }
        if (!in_array($status, self::STATUSES, true)) {
            throw new InvalidArgumentException('Backup RFID status must be active, inactive, or lost.');
        }
        if ($primaryUid !== null && strcasecmp($primaryUid, $uid) === 0) {
            throw new InvalidArgumentException('Backup RFID UID must be different from the RFID UID.');
        }

        $owner = $pdo->prepare('SELECT user_id FROM rfid_cards WHERE UPPER(rfid_uid) = :uid');
        $owner->execute(['uid' => $uid]);
        $ownedByUser = false;
        foreach ($owner->fetchAll(PDO::FETCH_COLUMN) as $ownerId) {
            if ((int) $ownerId !== $userId) {
                throw new InvalidArgumentException('That backup RFID UID is already assigned to another user.');
            }
            $ownedByUser = true;
        }

        // A UID new to this user must have been tapped on the RFID scanner or
        // the door first, so a typing mistake never becomes a card nobody holds.
        if (!$ownedByUser && (new RfidScanService($pdo))->latestScan($uid) === null) {
            throw new InvalidArgumentException('Backup RFID UID was not scanned yet. Tap the card on the RFID scanner, then enter the UID it shows.');
        }

        return ['uid' => $uid, 'status' => $status];
    }

    /** Must run after the primary card is saved, inside the caller's transaction. */
    public static function saveBackup(PDO $pdo, int $userId, ?string $uid, string $status): void
    {
        $current = self::card($pdo, $userId, self::BACKUP);
        if ($uid === null) {
            if ($current) {
                $pdo->prepare('DELETE FROM rfid_cards WHERE card_id = :card_id')->execute(['card_id' => (int) $current['card_id']]);
            }
            return;
        }
        if ($current) {
            $pdo->prepare('UPDATE rfid_cards SET rfid_uid = :uid, status = :status WHERE card_id = :card_id')
                ->execute(['uid' => $uid, 'status' => $status, 'card_id' => (int) $current['card_id']]);
            return;
        }
        $pdo->prepare("INSERT INTO rfid_cards (user_id, rfid_uid, card_slot, status) VALUES (:user_id, :uid, 'backup', :status)")
            ->execute(['user_id' => $userId, 'uid' => $uid, 'status' => $status]);
    }

    /** Frees a UID held by this user's backup slot so the primary can take it (a swap). */
    public static function releaseBackupUid(PDO $pdo, int $userId, string $uid): void
    {
        $pdo->prepare("DELETE FROM rfid_cards WHERE user_id = :user_id AND card_slot = 'backup' AND UPPER(rfid_uid) = :uid")
            ->execute(['user_id' => $userId, 'uid' => strtoupper($uid)]);
    }
}
