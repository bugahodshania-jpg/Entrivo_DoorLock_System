<?php

/**
 * Emergency access cards from DOOR_EMERGENCY_RFID_UIDS: comma-separated
 * 10-digit hex UIDs, each with an optional name after "=", e.g.
 * "0A1B2C3D4E=Dean's Office Card,1122334455". A card without a name is shown
 * as "Emergency card". Unset or empty = no emergency cards.
 */
final class EmergencyCards
{
    public const DEFAULT_NAME = 'Emergency card';

    /** @return array<string, string> upper-case UID => display name */
    public static function names(): array
    {
        $configured = getenv('DOOR_EMERGENCY_RFID_UIDS');
        if (!is_string($configured)) return [];
        $cards = [];
        foreach (explode(',', $configured) as $entry) {
            [$uid, $name] = array_pad(explode('=', $entry, 2), 2, '');
            $uid = strtoupper(trim($uid));
            if (preg_match('/^[A-F0-9]{10}$/D', $uid) !== 1) continue;
            $name = trim(preg_replace('/\s+/', ' ', $name));
            $cards[$uid] = $name !== '' ? mb_substr($name, 0, 60) : self::DEFAULT_NAME;
        }
        return $cards;
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
