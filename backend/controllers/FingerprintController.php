<?php

require_once __DIR__ . '/../services/FingerprintTemplateService.php';

class FingerprintController
{
    private FingerprintTemplateService $templateService;

    public function __construct(?FingerprintTemplateService $templateService = null)
    {
        $this->templateService = $templateService ?: new FingerprintTemplateService();
    }

    public function exportTemplate(array $query): array
    {
        return $this->templateService->exportTemplate($query);
    }

    public function uploadTemplate(array $input): array
    {
        return $this->templateService->uploadTemplate($input);
    }
}
