<?php

/**
 * Emergency access cards from DOOR_EMERGENCY_RFID_UIDS: comma-separated
 * 10-digit hex UIDs, each with an optional name after "=", e.g.
 * "0A1B2C3D4E=Dean's Office Card,1122334455". A card without a name is shown
 * as "Emergency card". Unset or empty = none from the environment.
 *
 * The door controller's own emergency card (SECRET_OFFLINE_ACCESS_CARD_UID)
 * is also an emergency card: the authenticated controller flags it with each
 * scan, and it is remembered in door_emergency_cards (with its name), so it
 * works online too and the logs show its name.
 */
final class EmergencyCards
{
    public const DEFAULT_NAME = 'Emergency card';

    /** @var array<string, string>|null controller-reported cards, per request */
    private static ?array $reported = null;

    /** @return array<string, string> upper-case UID => display name */
    public static function names(): array
    {
        $cards = self::reportedCards();
        $configured = getenv('DOOR_EMERGENCY_RFID_UIDS');
        if (!is_string($configured)) return $cards;
        foreach (explode(',', $configured) as $entry) {
            [$uid, $name] = array_pad(explode('=', $entry, 2), 2, '');
            $uid = strtoupper(trim($uid));
            if (preg_match('/^[A-F0-9]{10}$/D', $uid) !== 1) continue;
            $name = trim(preg_replace('/\s+/', ' ', $name));
            $cards[$uid] = $name !== '' ? mb_substr($name, 0, 60) : self::DEFAULT_NAME;
        }
        return $cards;
    }

    /**
     * Remember the controller's own emergency card. Called only for requests
     * authenticated with the door device token. DDL commits implicitly, so
     * call it before beginning a transaction.
     */
    public static function remember(PDO $pdo, string $uid, mixed $name, int $deviceId): void
    {
        $uid = strtoupper(trim($uid));
        if (preg_match('/^[A-F0-9]{10}$/D', $uid) !== 1) return;
        $name = is_string($name) ? trim(preg_replace('/\s+/', ' ', $name)) : '';
        $name = $name !== '' ? mb_substr($name, 0, 60) : self::DEFAULT_NAME;
        try {
            $pdo->exec('CREATE TABLE IF NOT EXISTS door_emergency_cards (
                rfid_uid VARCHAR(10) NOT NULL PRIMARY KEY, card_name VARCHAR(60) NOT NULL,
                device_id INT NULL, reported_at DATETIME NOT NULL)');
            $pdo->prepare('INSERT INTO door_emergency_cards (rfid_uid, card_name, device_id, reported_at) VALUES (?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE card_name = VALUES(card_name), device_id = VALUES(device_id), reported_at = NOW()')
                ->execute([$uid, $name, $deviceId]);
            self::$reported = null;
        } catch (Throwable $error) {
            error_log('Emergency card: ' . $error->getMessage());
        }
    }

    /** @return array<string, string> */
    private static function reportedCards(): array
    {
        if (self::$reported !== null) return self::$reported;
        self::$reported = [];
        try {
            require_once __DIR__ . '/../config/connection.php';
            $rows = entrivo_pdo()->query('SELECT rfid_uid, card_name FROM door_emergency_cards')->fetchAll(PDO::FETCH_KEY_PAIR);
            foreach ($rows as $uid => $name) self::$reported[strtoupper((string) $uid)] = (string) $name;
        } catch (Throwable) {
            // Table not created yet (no controller has reported its card).
        }
        return self::$reported;
    }

    /** @return list<string> */
    public static function uids(): array
    {
        // An all-digit UID becomes an integer array key; give it back as a string.
        return array_map('strval', array_keys(self::names()));
    }

    /** The card's name, or null when the UID is not an emergency card. */
    public static function nameFor(?string $uid): ?string
    {
        if (!is_string($uid) || $uid === '') return null;
        return self::names()[strtoupper(trim($uid))] ?? null;
    }
}
