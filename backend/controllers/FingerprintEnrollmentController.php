<?php

class FingerprintEnrollmentController
{
    private FingerprintEnrollmentService $service;

    public function __construct(?FingerprintEnrollmentService $service = null)
    {
        $this->service = $service ?: new FingerprintEnrollmentService();
    }

    public function startEnrollment(array $input): array
    {
        return $this->service->startEnrollment($input);
    }

    public function listEnrollmentJobs(array $query = []): array
    {
        return $this->service->listEnrollmentJobs($query);
    }

    public function getPendingJob(array $query = []): array
    {
        $deviceId = (int) ($query['enrollment_device_id'] ?? 0);

        if ($deviceId <= 0) {
            return [
                'status' => 400,
                'body' => [
                    'success' => false,
                    'message' => 'A valid enrollment device is required.'
                ],
            ];
        }

        $job = $this->service->getPendingJob($query);

        if (!$job) {
            return [
                'status' => 200,
                'body' => [
                    'success' => false,
                    'message' => 'No pending enrollment.'
                ],
            ];
        }

        $claimed = $this->service->claimJob((int) $job['job_id'], $deviceId);

        if (!$claimed) {
            return [
                'status' => 200,
                'body' => [
                    'success' => false,
                    'message' => 'No pending enrollment.'
                ],
            ];
        }

        $job = $this->service->getJobById((int) $job['job_id']);

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'job' => $job,
            ],
        ];
    }

    public function updateProgress(array $input): array
    {
        return $this->service->updateJobProgress($input);
    }

    public function completeEnrollment(array $input): array
    {
        return $this->service->completeEnrollment($input);
    }

    public function failEnrollment(array $input): array
    {
        return $this->service->failEnrollment($input);
    }

    public function retryEnrollmentJob(array $input): array
    {
        return $this->service->retryEnrollmentJob($input);
    }

    public function cancelEnrollmentJob(array $input): array
    {
        return $this->service->cancelEnrollmentJob($input);
    }
}
