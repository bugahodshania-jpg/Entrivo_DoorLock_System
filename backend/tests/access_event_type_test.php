<?php

require_once dirname(__DIR__) . '/services/AccessEventType.php';

function expectType(?string $expected, array $row, string $label, array $emergency = []): void
{
    $actual = AccessEventType::classify($row, $emergency);
    if ($actual !== $expected) {
        throw new RuntimeException($label . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

$granted = ['access_status' => 'granted', 'access_type' => 'IN', 'schedule_id' => null, 'override_id' => null,
    'schedule_kind' => null, 'schedule_status' => null, 'user_role' => 'faculty', 'method_access' => 'Fingerprint', 'rfid_uid' => null];

expectType(null, [...$granted, 'access_status' => 'denied'], 'denied attempts have no type');
expectType('exit', [...$granted, 'access_type' => 'OUT', 'schedule_id' => 4], 'exits');
expectType('regular', [...$granted, 'schedule_id' => 4, 'schedule_kind' => 'regular', 'schedule_status' => 'approved'], 'regular schedule');
expectType('override', [...$granted, 'schedule_id' => 5, 'schedule_kind' => 'override'], 'override schedule');
expectType('override', [...$granted, 'schedule_id' => 5, 'schedule_kind' => 'regular', 'schedule_status' => 'overridden'], 'legacy overridden status');
expectType('override', [...$granted, 'override_id' => 9], 'linked approved override');
expectType('admin_override', [...$granted, 'user_role' => 'admin'], 'admin without a schedule');
expectType('super_admin_override', [...$granted, 'user_role' => 'super_admin'], 'super admin without a schedule');
expectType('regular', [...$granted, 'user_role' => 'super_admin', 'schedule_id' => 4, 'schedule_kind' => 'regular'], 'an admin on a running schedule uses it');
expectType('emergency_card', [...$granted, 'user_role' => 'student', 'method_access' => 'RFID', 'rfid_uid' => '4300c46ddf'], 'emergency card', ['4300C46DDF']);
expectType('no_schedule', [...$granted, 'user_role' => 'student', 'method_access' => 'RFID', 'rfid_uid' => 'AA00000001'], 'other cards are not emergency', ['4300C46DDF']);

echo "PASS: granted door access is labeled regular, approved override, admin/super admin permanent override, emergency card or exit; denied attempts are unlabeled.\n";
