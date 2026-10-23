#include "DirectImport.h"
#include "API.h"
#include "Config.h"
#include "DoorHardware.h"
#include "Fingerprint.h"
#include "SensorTransfer.h"
#include "EnrollmentProof.h"

#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>
#include <mbedtls/version.h>

namespace
{
    String templateHash(const uint8_t *data, size_t length)
    {
        uint8_t digest[32] = {0};
#if MBEDTLS_VERSION_MAJOR >= 3
        const int status = mbedtls_sha256(data, length, digest, 0);
#else
        const int status = mbedtls_sha256_ret(data, length, digest, 0);
#endif
        if (status != 0)
        {
            return String("");
        }
        const char *alphabet = "0123456789abcdef";
        String result;
        result.reserve(64);
        for (uint8_t value : digest)
        {
            result += alphabet[value >> 4];
            result += alphabet[value & 0x0F];
        }
        return result;
    }

    bool progress(const DirectImportJob &job, int percent, const String &step, String &errorMessage)
    {
        Serial.println(step);
        if (!reportDirectImportProgress(job.jobId, percent, step))
        {
            errorMessage = "The backend did not confirm the active import job. Import stopped.";
            return false;
        }
        return true;
    }
}

bool runDirectImportJob(const DirectImportJob &job, String &verifiedHash, String &errorMessage)
{
    verifiedHash = "";
    if (isDoorUnlocked() || job.jobId <= 0 || job.fingerprintId <= 0 || job.deviceId != ENROLLMENT_DEVICE_ID ||
        job.targetSlot <= 0 || job.targetSlot > UINT16_MAX || !R307TemplateStream::supportedSize(job.templateBytes) ||
        job.templateDataBase64.length() != ((job.templateBytes + 2) / 3) * 4 || job.templateHash.length() != 64)
    {
        errorMessage = "The backend import job is missing a valid slot or supported fingerprint backup (512, 768, 1024, or 1536 bytes).";
        return false;
    }
    String expectedHash = job.templateHash;
    expectedHash.toLowerCase();
    for (size_t index = 0; index < expectedHash.length(); ++index)
    {
        const char value = expectedHash.charAt(index);
        if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f')))
        {
            errorMessage = "The fingerprint backup SHA-256 hash is invalid.";
            return false;
        }
    }

    uint8_t binary[DIRECT_TEMPLATE_MAX_BYTES] = {0};
    size_t decodedLength = 0;
    if (mbedtls_base64_decode(binary, sizeof(binary), &decodedLength,
            reinterpret_cast<const uint8_t *>(job.templateDataBase64.c_str()), job.templateDataBase64.length()) != 0 ||
        decodedLength != static_cast<size_t>(job.templateBytes) || !DoorEnrollmentProof::validTemplate(binary, decodedLength) ||
        templateHash(binary, decodedLength) != expectedHash)
    {
        errorMessage = "Fingerprint backup data failed its size or SHA-256 validation.";
        return false;
    }
    if (!progress(job, 20, "Backup validated. Checking Sensor A slot " + String(job.targetSlot), errorMessage))
    {
        return false;
    }

    bool occupied = false;
    if (!isSensorSlotOccupied(job.targetSlot, occupied, errorMessage))
    {
        return false;
    }
    uint8_t readback[DIRECT_TEMPLATE_MAX_BYTES] = {0};
    size_t readbackLength = 0;
    if (occupied)
    {
        // A completed write whose HTTP reply was lost can safely be confirmed without rewriting it.
        if (!readStoredTemplate(job.targetSlot, readback, sizeof(readback), readbackLength, errorMessage))
        {
            return false;
        }
        if (readbackLength != decodedLength || templateHash(readback, readbackLength) != expectedHash)
        {
            errorMessage = "Sensor A slot " + String(job.targetSlot) +
                " contains a different fingerprint. Import cancelled without overwriting it.";
            return false;
        }
        String searchError;
        const DoorFingerprintSearch::Result match = searchFingerprintVerified(&searchError);
        if (match.outcome != DoorFingerprintSearch::Outcome::Matched || match.matchedSlot != job.targetSlot)
        {
            errorMessage = "The sensor could not uniquely confirm this fingerprint at its reserved slot (standard search code 0x" +
                String(match.standardStatus, HEX) + "). Import was not completed.";
            if (searchError.length()) errorMessage += " " + searchError;
            return false;
        }
    }
    else
    {
        if (!progress(job, 45, "Writing backup directly to Sensor A", errorMessage) ||
            !writeImportedTemplate(job.targetSlot, binary, decodedLength, errorMessage))
        {
            return false;
        }
        if (!progress(job, 80, "Fingerprint saved. Reading Sensor A back for verification", errorMessage) ||
            !readStoredTemplate(job.targetSlot, readback, sizeof(readback), readbackLength, errorMessage))
        {
            // Keep an unconfirmed local copy for a same-slot retry. Never claim DB completion here.
            return false;
        }
        if (readbackLength != decodedLength || templateHash(readback, readbackLength) != expectedHash)
        {
            errorMessage = "Sensor A read-back hash did not match the backup. Import was not completed.";
            return false;
        }
    }
    if (!progress(job, 95, "Sensor A read-back verified. Confirming import", errorMessage))
    {
        return false;
    }
    verifiedHash = expectedHash;
    return true;
}
