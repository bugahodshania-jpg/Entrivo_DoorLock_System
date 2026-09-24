// Enrollment workflow implementation.

#include "Enrollment.h"

#include "API.h"
#include "Fingerprint.h"

namespace
{
    constexpr uint32_t FINGER_CAPTURE_TIMEOUT_MS = 30000;
    constexpr uint32_t FINGER_REMOVAL_TIMEOUT_MS = 15000;

    String getImageErrorMessage(uint8_t code)
    {
        switch (code)
        {
            case FINGERPRINT_IMAGEMESS:
                return "Fingerprint image was too messy.";
            case FINGERPRINT_PACKETRECIEVEERR:
                return "Communication error while reading the fingerprint image.";
            case FINGERPRINT_IMAGEFAIL:
                return "Could not capture a fingerprint image.";
            default:
                return "Unknown fingerprint image error.";
        }
    }

    String getTemplateErrorMessage(uint8_t code)
    {
        switch (code)
        {
            case FINGERPRINT_IMAGEMESS:
                return "Fingerprint image was too messy to convert.";
            case FINGERPRINT_PACKETRECIEVEERR:
                return "Communication error while converting the fingerprint image.";
            case FINGERPRINT_FEATUREFAIL:
            case FINGERPRINT_INVALIDIMAGE:
                return "Fingerprint features could not be extracted.";
            default:
                return "Unknown fingerprint template error.";
        }
    }

    bool waitForFingerPlacement(uint8_t imageBuffer, String &errorMessage)
    {
        const unsigned long startedAt = millis();

        while (millis() - startedAt < FINGER_CAPTURE_TIMEOUT_MS)
        {
            const uint8_t imageStatus = finger.getImage();

            if (imageStatus == FINGERPRINT_OK)
            {
                const uint8_t templateStatus = finger.image2Tz(imageBuffer);

                if (templateStatus == FINGERPRINT_OK)
                {
                    return true;
                }

                errorMessage = getTemplateErrorMessage(templateStatus);
                return false;
            }

            if (imageStatus != FINGERPRINT_NOFINGER)
            {
                errorMessage = getImageErrorMessage(imageStatus);
                return false;
            }

            delay(100);
        }

        errorMessage = "Timed out waiting for finger placement.";
        return false;
    }

    bool waitForFingerRemoval(String &errorMessage)
    {
        const unsigned long startedAt = millis();

        while (millis() - startedAt < FINGER_REMOVAL_TIMEOUT_MS)
        {
            const uint8_t imageStatus = finger.getImage();

            if (imageStatus == FINGERPRINT_NOFINGER)
            {
                return true;
            }

            if (imageStatus != FINGERPRINT_OK)
            {
                errorMessage = getImageErrorMessage(imageStatus);
                return false;
            }

            delay(100);
        }

        errorMessage = "Timed out waiting for finger removal.";
        return false;
    }
}

bool runEnrollmentJob(const EnrollmentJob &job, String &templateDataBase64, String &errorMessage)
{
    if (job.jobId <= 0)
    {
        errorMessage = "Enrollment job ID is invalid.";
        return false;
    }

    if (job.assignedSlot <= 0)
    {
        errorMessage = "No valid sensor slot was reserved for this job.";
        return false;
    }

    Serial.println();
    Serial.print("Starting enrollment job #");
    Serial.print(job.jobId);
    Serial.print(" for ");
    Serial.println(job.fingerName);

    reportEnrollmentProgress(job.jobId, 10, "Place finger for first scan");

    if (!waitForFingerPlacement(1, errorMessage))
    {
        return false;
    }

    reportEnrollmentProgress(job.jobId, 35, "First scan captured. Remove finger");

    if (!waitForFingerRemoval(errorMessage))
    {
        return false;
    }

    reportEnrollmentProgress(job.jobId, 60, "Place the same finger for second scan");

    if (!waitForFingerPlacement(2, errorMessage))
    {
        return false;
    }

    reportEnrollmentProgress(job.jobId, 80, "Generating fingerprint model");

    const uint8_t modelStatus = finger.createModel();
    if (modelStatus != FINGERPRINT_OK)
    {
        switch (modelStatus)
        {
            case FINGERPRINT_PACKETRECIEVEERR:
                errorMessage = "Communication error while creating the fingerprint model.";
                break;
            case FINGERPRINT_ENROLLMISMATCH:
                errorMessage = "The two scans did not match. Please try again.";
                break;
            default:
                errorMessage = "Unknown error while generating the fingerprint model.";
                break;
        }

        return false;
    }

    reportEnrollmentProgress(
        job.jobId,
        90,
        "Saving fingerprint to sensor slot " + String(job.assignedSlot)
    );

    const uint8_t storeStatus = finger.storeModel(job.assignedSlot);
    if (storeStatus != FINGERPRINT_OK)
    {
        switch (storeStatus)
        {
            case FINGERPRINT_PACKETRECIEVEERR:
                errorMessage = "Communication error while storing the fingerprint template.";
                break;
            case FINGERPRINT_BADLOCATION:
                errorMessage = "The reserved sensor slot is invalid.";
                break;
            case FINGERPRINT_FLASHERR:
                errorMessage = "Could not write the fingerprint template to sensor memory.";
                break;
            default:
                errorMessage = "Unknown error while saving the fingerprint template.";
                break;
        }

        return false;
    }

    reportEnrollmentProgress(job.jobId, 95, "Fingerprint saved on ESP32. Downloading raw template");

    if (!downloadStoredTemplateBase64(job.assignedSlot, templateDataBase64, errorMessage))
    {
        return false;
    }

    reportEnrollmentProgress(job.jobId, 98, "Raw template downloaded. Sending completion to backend");
    return true;
}
