<?php

class RfidScanService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function normalizeUid(mixed $rfidUid): string
    {
        return strtoupper(preg_replace('/\s+/', '', (string) $rfidUid));
    }

    public function isValidUid(string $rfidUid): bool
    {
        return $rfidUid !== ''
            && strlen($rfidUid) <= 30
            && preg_match('/^[A-Z0-9]+$/', $rfidUid) === 1;
    }

    public function record(string $rfidUid, ?string $deviceLabel = null): array
    {
        $scannedAt = entrivo_now();
        $label = trim((string) $deviceLabel);
        $statement = $this->pdo->prepare(
            'INSERT INTO rfid_scan_log (rfid_uid, scanned_at, device_label)
             VALUES (:rfid_uid, :scanned_at, :device_label)'
        );
        $statement->execute([
            'rfid_uid' => $rfidUid,
            'scanned_at' => $scannedAt,
            'device_label' => $label === '' ? null : substr($label, 0, 64),
        ]);

        return [
            'scan_id' => (int) $this->pdo->lastInsertId(),
            'rfid_uid' => $rfidUid,
            'scanned_at' => $scannedAt,
        ];
    }

    public function listScans(): array
    {
        $statement = $this->pdo->query(
            "SELECT
                rfid_scan_log.scan_id,
                rfid_scan_log.rfid_uid,
                DATE_FORMAT(rfid_scan_log.scanned_at, '%b %e, %Y %h:%i %p') AS scanned_at,
                DATE_FORMAT(rfid_scan_log.scanned_at, '%Y-%m-%d') AS scanned_on,
                rfid_scan_log.device_label,
                CASE
                    WHEN rfid_cards.card_id IS NULL THEN 'unknown'
                    ELSE 'registered'
                END AS registration_status
             FROM rfid_scan_log
             LEFT JOIN rfid_cards
               ON UPPER(rfid_cards.rfid_uid) = UPPER(rfid_scan_log.rfid_uid)
             ORDER BY rfid_scan_log.scanned_at DESC, rfid_scan_log.scan_id DESC"
        );

        return array_map(static function (array $row): array {
            $deviceLabel = trim((string) ($row['device_label'] ?? ''));

            return [
                'id' => (int) $row['scan_id'],
                'rfidUid' => $row['rfid_uid'],
                'scannedAt' => $row['scanned_at'],
                'scannedOn' => $row['scanned_on'],
                'deviceLabel' => $deviceLabel !== '' ? $deviceLabel : 'Enrollment scanner',
                'registrationStatus' => $row['registration_status'] === 'registered' ? 'registered' : 'unknown',
            ];
        }, $statement->fetchAll());
    }

    public function latestScan(string $rfidUid): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT scan_id, rfid_uid, scanned_at
             FROM rfid_scan_log
             WHERE rfid_uid = :rfid_uid
             ORDER BY scanned_at DESC, scan_id DESC
             LIMIT 1'
        );
        $statement->execute(['rfid_uid' => $rfidUid]);
        $row = $statement->fetch();

        return $row ?: null;
    }

    public function isRegistered(string $rfidUid): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT card_id FROM rfid_cards WHERE rfid_uid = :rfid_uid LIMIT 1'
        );
        $statement->execute(['rfid_uid' => $rfidUid]);

        return (bool) $statement->fetch();
    }
}
