// Enrollment workflow implementation.

#include "Enrollment.h"

#include "API.h"
#include "Fingerprint.h"
#include "SensorTransfer.h"
#include "EnrollmentProof.h"
#include <memory>
#include <new>

namespace
{
    constexpr uint32_t FINGER_CAPTURE_TIMEOUT_MS = 30000;
    constexpr uint32_t FINGER_REMOVAL_TIMEOUT_MS = 15000;

    bool updateProgress(const EnrollmentJob &job, int progress, const String &step, String &errorMessage)
    {
        if (reportEnrollmentProgress(job.jobId, progress, step)) return true;
        errorMessage = "Enrollment stopped because the backend did not confirm the job progress.";
        return false;
    }

    String getImageErrorMessage(uint8_t code)
    {
        switch (code)
        {
            case FINGERPRINT_IMAGEMESS:
                return "Fingerprint image was too messy.";
            case FINGERPRINT_PACKETRECIEVEERR:
            case 0xFE:
            case 0xFF:
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
            case 0xFE:
            case 0xFF:
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
            const uint8_t imageStatus = getFingerprintImageVerified();

            if (imageStatus == FINGERPRINT_OK)
            {
                const uint8_t templateStatus = convertFingerprintImageVerified(imageBuffer);

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
        unsigned long clearSince = 0;
        bool clearing = false;

        while (millis() - startedAt < FINGER_REMOVAL_TIMEOUT_MS)
        {
            const uint8_t imageStatus = getFingerprintImageVerified();

            if (imageStatus == FINGERPRINT_NOFINGER)
            {
                if (!clearing) { clearing = true; clearSince = millis(); }
                else if (millis() - clearSince >= 400) return true;
            }
            else if (imageStatus != FINGERPRINT_OK)
            {
                errorMessage = getImageErrorMessage(imageStatus);
                return false;
            }
            else clearing = false;

            delay(100);
        }

        errorMessage = "Timed out waiting for finger removal.";
        return false;
    }

struct EnrollmentOperations {
        EnrollmentJob &job;
        String &error;
        bool recovering;
        bool firstCaptured;
        uint16_t verifiedMatchedSlot = 0;
        uint16_t verifiedConfidence = 0;
        String verifiedHash;

        bool emptySlot() {
            bool occupied = false;
            if (!isSensorSlotOccupied(job.assignedSlot, occupied, error)) return false;
            if (occupied) error = "The reserved sensor slot is occupied. Existing fingerprints were preserved.";
            return !occupied;
        }

        bool capturePair() {
            if (!firstCaptured) {
                if (!updateProgress(job, 10, "Place finger for first scan", error) ||
                    !waitForFingerPlacement(1, error)) return false;
                // Duplicate checking precedes the second capture and RegModel.
                // No transfer or metadata command may interrupt RegModel -> Store.
                String searchError;
                const DoorFingerprintSearch::Result match = searchFingerprintVerified(&searchError);
                logFingerprintStatus("enrollment first-capture duplicate search", match.standardStatus);
                if (match.outcome == DoorFingerprintSearch::Outcome::Matched) {
                    error = "This finger already matches sensor slot " + String(match.matchedSlot) +
                        ". Reconcile the existing fingerprint mapping before retrying. Existing sensor data was preserved.";
                    return false;
                }
                if (match.outcome != DoorFingerprintSearch::Outcome::NoMatch) {
                    error = "Could not check the first capture for an existing fingerprint (code 0x" +
                        String(match.standardStatus, HEX) + "). " + searchError;
                    return false;
                }
            }
            if (!updateProgress(job, 35, "First scan captured. Remove finger", error) ||
                !waitForFingerRemoval(error)) return false;
            if (!updateProgress(job, 60, "Place the same finger for second scan", error) ||
                !waitForFingerPlacement(2, error)) return false;
            return true;
        }

        bool beforeGeneration() {
            // Complete backend progress reporting before native model creation.
            return updateProgress(job, 80,
                String(recovering ? "Verifying native model for sensor slot " :
                    "Generating and storing native fingerprint model in sensor slot ") +
                    String(job.assignedSlot), error);
        }

        bool generate() {
            const uint8_t status = generateFingerprintModelVerified(error);
            if (status == FINGERPRINT_OK) return true;
            if (status == FINGERPRINT_ENROLLMISMATCH)
                error = "The two scans did not match. Please try again.";
            return false;
        }

        bool storeNative() {
            // Follow the R307S native enrollment flow: RegModel -> Store(buffer2).
            // No UpChar, DownChar, index query, HTTP, or other sensor operation
            // occurs between these two checked commands.
            return storeFingerprintModelVerified(job.assignedSlot, 2, error) == FINGERPRINT_OK;
        }

        bool confirmRecovery() {
            String searchError;
            const DoorFingerprintSearch::Result match = searchFingerprintVerified(&searchError);
            logFingerprintStatus("native occupied-slot recovery search", match.standardStatus);
            if (match.outcome == DoorFingerprintSearch::Outcome::Matched &&
                match.matchedSlot == job.assignedSlot) return true;
            error = "The two fresh recovery scans did not identify reserved sensor slot " +
                String(job.assignedSlot) + ". Existing sensor data was preserved. " + searchError;
            return false;
        }

        bool readStored(uint8_t *data, size_t capacity, size_t &length) {
            if (!updateProgress(job, 95, "Fingerprint saved. Downloading template for verification", error))
                return false;
            return readStoredTemplate(job.assignedSlot, data, capacity, length, error);
        }
        bool verifyFresh() {
            reportEnrollmentProgress(job.jobId, 96, "Remove finger for final verification");
            if (!waitForFingerRemoval(error)) { error = "Final verification failed: " + error; return false; }
            reportEnrollmentProgress(job.jobId, 98, "Place the enrolled finger for final verification");
            if (!waitForFingerPlacement(1, error)) { error = "Final verification failed: " + error; return false; }
            String searchError;
            const DoorFingerprintSearch::Result match = searchFingerprintVerified(&searchError);
            logFingerprintStatus("final verification standard search", match.standardStatus);
            if (match.outcome != DoorFingerprintSearch::Outcome::Matched) {
                error = "Final verification failed: standard search returned code 0x" + String(match.standardStatus, HEX) +
                    ". The new capture did not identify a valid stored fingerprint. Sensor data was preserved.";
                if (searchError.length()) error += " " + searchError;
                if (match.standardStatus == 0x17) error += " R307S documentation does not define status 0x17.";
                return false;
            }
            if (match.matchedSlot != job.assignedSlot) {
                error = "Final verification failed: this finger matched sensor slot " + String(match.matchedSlot) +
                    " instead of reserved slot " + String(job.assignedSlot) +
                    ". Reconcile the existing fingerprint mapping before retrying. No existing template was erased or reassigned.";
                return false;
            }
            if (match.confidence == 0) {
                error = "Final verification failed: the sensor did not report positive match confidence.";
                return false;
            }
            verifiedMatchedSlot = match.matchedSlot;
            verifiedConfidence = match.confidence;
            Serial.print("[ENROLL] Fresh verification matched slot "); Serial.print(match.matchedSlot);
            Serial.print(", confidence="); Serial.println(match.confidence);
            return true;
        }

        bool confirmStored(const uint8_t *saved, size_t savedLength) {
            std::unique_ptr<uint8_t[]> readback(new (std::nothrow) uint8_t[DIRECT_TEMPLATE_MAX_BYTES]);
            if (!readback) { error = "Not enough memory to confirm fingerprint flash storage."; return false; }
            size_t readbackLength = 0;
            if (!readStoredTemplate(job.assignedSlot, readback.get(), DIRECT_TEMPLATE_MAX_BYTES, readbackLength, error))
                return false;
            if (!DoorEnrollmentProof::sameTemplate(saved, savedLength, readback.get(), readbackLength)) {
                error = "Final verification failed: stored fingerprint changed between flash reads. Enrollment was not completed.";
                return false;
            }
            return hashFingerprintTemplate(readback.get(), readbackLength, verifiedHash, error);
        }
    };

    String proofFailure(DoorEnrollmentProof::Result result, const EnrollmentJob &job, size_t length) {
        using DoorEnrollmentProof::Result;
        if (result == Result::InvalidStored)
            return "Flash read-back from sensor slot " + String(job.assignedSlot) +
                " was invalid or uniform (" + String(length) +
                " bytes). Enrollment was not completed. Checked native Store/Load details are in Serial Monitor.";
        return "The native fingerprint enrollment proof failed. Enrollment was not completed; existing sensor data was preserved.";
    }
}

bool runEnrollmentJob(EnrollmentJob &job, String &templateDataBase64, String &errorMessage)
{
    templateDataBase64 = "";
    errorMessage = "";
    job.verification = {};
    if (job.jobId <= 0 || job.assignedSlot <= 0 || job.assignedSlot > UINT16_MAX) {
        errorMessage = "The enrollment job or reserved sensor slot is invalid.";
        return false;
    }

    std::unique_ptr<uint8_t[]> saved(new (std::nothrow) uint8_t[DIRECT_TEMPLATE_MAX_BYTES]);
    if (!saved) { errorMessage = "Not enough memory to verify the stored fingerprint."; return false; }
    size_t savedLength = 0;

    Serial.println();
    Serial.print("Starting enrollment job #"); Serial.print(job.jobId);
    Serial.print(" for "); Serial.println(job.fingerName);
    Serial.println("[ENROLL] Native R307S enrollment: RegModel -> Store buffer 2; export follows flash storage.");

    bool occupied = false;
    if (!isSensorSlotOccupied(job.assignedSlot, occupied, errorMessage)) return false;
    bool recovering = false;
    if (occupied) {
        // Probe with a fresh native feature file before selecting the write lane.
        // A matching existing reservation can be recovered without any flash write.
        if (!updateProgress(job, 5, "Reserved slot occupied. Place the enrolled finger for recovery check", errorMessage) ||
            !waitForFingerPlacement(1, errorMessage)) return false;
        String searchError;
        const DoorFingerprintSearch::Result match = searchFingerprintVerified(&searchError);
        logFingerprintStatus("occupied-slot preflight search", match.standardStatus);
        if (match.outcome == DoorFingerprintSearch::Outcome::Matched) {
            if (match.matchedSlot != job.assignedSlot) {
                errorMessage = "This finger already matches sensor slot " + String(match.matchedSlot) +
                    ", but this job reserved slot " + String(job.assignedSlot) +
                    ". Reconcile the existing fingerprint mapping before retrying. Existing sensor data was preserved.";
                return false;
            }
            recovering = true; // This probe is scan1 of the two-scan recovery.
        } else if (match.outcome == DoorFingerprintSearch::Outcome::NoMatch) {
            // Finish all metadata queries and slot reservation before capturing
            // the actual pair that will be generated and stored natively.
            if (!reserveEmptyEnrollmentSlot(job, errorMessage)) return false;
            if (!updateProgress(job, 8, "Empty replacement slot reserved. Remove finger before enrollment", errorMessage) ||
                !waitForFingerRemoval(errorMessage)) return false;
        } else {
            errorMessage = "Could not check the occupied sensor slot (code 0x" +
                String(match.standardStatus, HEX) + "). " + searchError;
            return false;
        }
    }

    EnrollmentOperations operations{job, errorMessage, recovering, recovering};
    const DoorEnrollmentProof::Result proof = DoorEnrollmentProof::finishNative(
        operations, recovering, saved.get(), DIRECT_TEMPLATE_MAX_BYTES, savedLength);
    if (proof != DoorEnrollmentProof::Result::Verified) {
        if (errorMessage.length() == 0) errorMessage = proofFailure(proof, job, savedLength);
        return false;
    }
    // The final scan replaces the sensor buffer; retain the checked flash
    // read-back in RAM for the backup sent to the backend.
    if (!encodeFingerprintTemplateBase64(saved.get(), savedLength, templateDataBase64, errorMessage)) return false;
    job.verification.freshScanVerified = true;
    job.verification.storedSlot = job.assignedSlot;
    job.verification.matchedSlot = operations.verifiedMatchedSlot;
    job.verification.confidence = operations.verifiedConfidence;
    job.verification.templateBytes = savedLength;
    operations.verifiedHash.toCharArray(job.verification.templateSha256, sizeof(job.verification.templateSha256));
    if (!DoorEnrollmentProof::validVerification(job.verification, job.assignedSlot)) {
        job.verification = {};
        errorMessage = "The final enrollment verification proof is incomplete. Enrollment was not completed.";
        return false;
    }
    if (!reportEnrollmentProgress(job.jobId, 99,
        "Final verification passed at sensor slot " + String(job.assignedSlot) + ". Sending completion to backend"))
        Serial.println("Final verification passed, but the progress reply was lost. Sending the verified completion proof.");
    return true;
}
