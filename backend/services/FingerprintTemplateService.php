<?php

require_once __DIR__ . '/../models/Fingerprint.php';
require_once __DIR__ . '/FingerprintTemplateFormat.php';

class FingerprintTemplateService
{
    private Fingerprint $fingerprintModel;

    public function __construct(?Fingerprint $fingerprintModel = null)
    {
        $this->fingerprintModel = $fingerprintModel ?: new Fingerprint();
    }

    public function exportTemplate(array $query): array
    {
        $fingerprintId = (int) ($query['fingerprint_id'] ?? 0);

        if ($fingerprintId <= 0) {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'A valid fingerprint record is required.',
                ],
            ];
        }

        $record = $this->fingerprintModel->getTemplateExportData($fingerprintId);

        if (!$record) {
            return [
                'status' => 404,
                'body' => [
                    'success' => false,
                    'message' => 'Fingerprint record not found.',
                ],
            ];
        }

        $templateBinary = $record['template_data'] ?? null;

        if (!is_string($templateBinary) || $templateBinary === '') {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'No stored template data was found for this fingerprint.',
                ],
            ];
        }

        $templateBinary = FingerprintTemplateFormat::verifiedBinary($templateBinary, $record['template_hash'] ?? null);
        if ($templateBinary === null) {
            return [
                'status' => 422,
                'body' => [
                    'success' => false,
                    'message' => 'The stored fingerprint template is invalid. Enroll the finger again before exporting it.',
                ],
            ];
        }

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'fingerprint' => [
                    'fingerprint_id' => (int) $record['fingerprint_id'],
                    'user_id' => (int) $record['user_id'],
                    'username' => (string) ($record['username'] ?? ''),
                    'email' => (string) ($record['email'] ?? ''),
                    'role' => (string) ($record['role'] ?? ''),
                    'finger_name' => (string) ($record['finger_name'] ?? ''),
                    'status' => (string) ($record['status'] ?? ''),
                    'enrollment_device_id' => isset($record['enrollment_device_id']) ? (int) $record['enrollment_device_id'] : null,
                    'enrollment_slot' => isset($record['enrollment_slot']) ? (int) $record['enrollment_slot'] : null,
                    'shared_door_slot' => isset($record['shared_door_slot']) ? (int) $record['shared_door_slot'] : null,
                    'door_sync_status' => (string) ($record['door_sync_status'] ?? ''),
                    'template_hash' => (string) ($record['template_hash'] ?? ''),
                    'template_bytes' => strlen($templateBinary),
                    'template_data_base64' => base64_encode($templateBinary),
                    'exported_at' => date('c'),
                ],
            ],
        ];
    }

    public function uploadTemplate(array $input): array
    {
        $fingerprintId = (int) ($input['fingerprint_id'] ?? 0);
        $templateDataBase64 = trim((string) ($input['template_data_base64'] ?? ''));
        $fingerName = trim((string) ($input['finger_name'] ?? ''));
        $enrollmentDeviceId = isset($input['enrollment_device_id']) ? (int) $input['enrollment_device_id'] : null;
        $enrollmentSlot = isset($input['enrollment_slot']) ? (int) $input['enrollment_slot'] : null;
        $sharedDoorSlot = isset($input['shared_door_slot']) ? (int) $input['shared_door_slot'] : null;

        if ($fingerprintId <= 0) {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'A valid fingerprint record is required.',
                ],
            ];
        }

        if ($templateDataBase64 === '') {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'Fingerprint template data is required.',
                ],
            ];
        }

        $decodedTemplate = base64_decode($templateDataBase64, true);

        if ($decodedTemplate === false || $decodedTemplate === '') {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'Template data must be valid base64.',
                ],
            ];
        }

        $templateBytes = strlen($decodedTemplate);
        if (!FingerprintTemplateFormat::isSupportedSize($templateBytes)) {
            return [
                'status' => 422,
                'body' => [
                    'success' => false,
                    'message' => sprintf(
                        'Invalid fingerprint template size. Expected %s bytes, got %d bytes.',
                        FingerprintTemplateFormat::describeSupportedSizes(),
                        $templateBytes
                    ),
                ],
            ];
        }

        if (!FingerprintTemplateFormat::isUsableTemplate($decodedTemplate)) {
            return [
                'status' => 422,
                'body' => [
                    'success' => false,
                    'message' => 'The fingerprint template contains only one repeated byte and cannot be used. Enroll the finger again; the existing fingerprint was preserved.',
                ],
            ];
        }

        $existingRecord = $this->fingerprintModel->getById($fingerprintId);

        if (!$existingRecord) {
            return [
                'status' => 404,
                'body' => [
                    'success' => false,
                    'message' => 'Fingerprint record not found.',
                ],
            ];
        }

        $updatedRecord = $this->fingerprintModel->importTemplateData(
            $fingerprintId,
            $decodedTemplate,
            hash('sha256', $decodedTemplate),
            $fingerName !== '' ? $fingerName : null,
            $enrollmentDeviceId !== null && $enrollmentDeviceId > 0 ? $enrollmentDeviceId : null,
            $enrollmentSlot !== null && $enrollmentSlot > 0 ? $enrollmentSlot : null,
            $sharedDoorSlot !== null && $sharedDoorSlot > 0 ? $sharedDoorSlot : null
        );

        if (!$updatedRecord) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'message' => 'Unable to store the fingerprint template.',
                ],
            ];
        }

        $hasSlot = (
            (isset($updatedRecord['enrollment_slot']) && (int) $updatedRecord['enrollment_slot'] > 0)
            || (isset($updatedRecord['shared_door_slot']) && (int) $updatedRecord['shared_door_slot'] > 0)
        );

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'message' => $hasSlot
                    ? 'Fingerprint template uploaded and stored for future device sync.'
                    : 'Fingerprint template stored in the database. Assign a slot before syncing it to devices.',
                'fingerprint' => [
                    'fingerprint_id' => (int) $updatedRecord['fingerprint_id'],
                    'user_id' => (int) $updatedRecord['user_id'],
                    'finger_name' => (string) ($updatedRecord['finger_name'] ?? ''),
                    'status' => (string) ($updatedRecord['status'] ?? ''),
                    'enrollment_device_id' => isset($updatedRecord['enrollment_device_id']) ? (int) $updatedRecord['enrollment_device_id'] : null,
                    'enrollment_slot' => isset($updatedRecord['enrollment_slot']) ? (int) $updatedRecord['enrollment_slot'] : null,
                    'shared_door_slot' => isset($updatedRecord['shared_door_slot']) ? (int) $updatedRecord['shared_door_slot'] : null,
                    'template_hash' => (string) ($updatedRecord['template_hash'] ?? ''),
                    'template_bytes' => strlen($decodedTemplate),
                    'door_sync_status' => (string) ($updatedRecord['door_sync_status'] ?? ''),
                ],
            ],
        ];
    }
}
