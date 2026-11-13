<?php

/**
 * How a granted door access happened, for the live Access Status modal:
 * the schedule kind it used, an administrator's permanent override, or the
 * emergency card. Read from what the access log already stores.
 */
final class AccessEventType
{
    public const LABELS = [
        'regular' => 'Regular schedule',
        'override' => 'Approved override',
        'admin_override' => 'Admin permanent override',
        'super_admin_override' => 'Super Admin permanent override',
        'emergency_card' => 'Emergency card',
        'exit' => 'Exit',
        'no_schedule' => 'No schedule',
    ];

    /**
     * @param array $row access_status, access_type (IN/OUT), schedule_id,
     *     override_id, schedule_kind/schedule_status of the linked schedule,
     *     user_role, method_access, rfid_uid.
     * @param list<string> $emergencyUids Upper-case emergency card UIDs.
     * @return string|null A LABELS key; null for a denied attempt.
     */
    public static function classify(array $row, array $emergencyUids = []): ?string
    {
        if (($row['access_status'] ?? '') !== 'granted') return null;
        if (strtoupper((string) ($row['access_type'] ?? 'IN')) === 'OUT') return 'exit';
        if (($row['override_id'] ?? null) !== null) return 'override';
        if (($row['schedule_id'] ?? null) !== null) {
            $isOverride = strtolower(trim((string) ($row['schedule_kind'] ?? ''))) === 'override'
                || strtolower(trim((string) ($row['schedule_status'] ?? ''))) === 'overridden';
            return $isOverride ? 'override' : 'regular';
        }
        $role = (string) ($row['user_role'] ?? '');
        if ($role === 'super_admin') return 'super_admin_override';
        if ($role === 'admin') return 'admin_override';
        $uid = strtoupper(trim((string) ($row['rfid_uid'] ?? '')));
        if (($row['method_access'] ?? '') === 'RFID' && $uid !== '' && in_array($uid, $emergencyUids, true)) {
            return 'emergency_card';
        }
        return 'no_schedule';
    }
}
