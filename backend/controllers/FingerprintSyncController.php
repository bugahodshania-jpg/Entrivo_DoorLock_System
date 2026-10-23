<?php

class FingerprintSyncController
{
    private FingerprintSyncService $service;

    public function __construct(?FingerprintSyncService $service = null)
    {
        $this->service = $service ?: new FingerprintSyncService();
    }

    public function queueTemplateSync(array $input): array
    {
        return $this->service->queueTemplateSync($input);
    }

    public function listSyncJobs(array $query = []): array
    {
        return $this->service->listSyncJobs($query);
    }

    public function retrySyncJob(array $input): array
    {
        return $this->service->retrySyncJob($input);
    }

    public function cancelSyncJob(array $input): array
    {
        return $this->service->cancelSyncJob($input);
    }

    public function getPendingDeviceJob(array $query = []): array
    {
        return $this->service->getPendingDeviceJob($query);
    }

    public function completeDeviceJob(array $input): array
    {
        return $this->service->completeDeviceJob($input);
    }

    public function failDeviceJob(array $input): array
    {
        return $this->service->failDeviceJob($input);
    }

    public function updateDeviceProgress(array $input): array
    {
        return $this->service->updateDeviceProgress($input);
    }
}
