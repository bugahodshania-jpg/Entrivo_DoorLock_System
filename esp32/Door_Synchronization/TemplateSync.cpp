// Template sync workflow implementation for Sensor B.
#include "TemplateSync.h"

#include "Config.h"
#include "Fingerprint.h"
#include "LocalState.h"

#include "mbedtls/sha256.h"

namespace
{
    int8_t decodeBase64Character(char value)
    {
        if (value >= 'A' && value <= 'Z')
        {
            return value - 'A';
        }

        if (value >= 'a' && value <= 'z')
        {
            return 26 + (value - 'a');
        }

        if (value >= '0' && value <= '9')
        {
            return 52 + (value - '0');
        }

        if (value == '+')
        {
            return 62;
        }

        if (value == '/')
        {
            return 63;
        }

        return -1;
    }

    bool decodeTemplateBase64(
        const String &encodedTemplate,
        uint8_t *outputBuffer,
        size_t outputCapacity,
        size_t &decodedLength,
        String &errorMessage
    ) {
        decodedLength = 0;

        uint8_t quartet[4] = {0};
        uint8_t quartetLength = 0;
        uint8_t paddingCount = 0;

        for (size_t index = 0; index < encodedTemplate.length(); ++index)
        {
            const char currentCharacter = encodedTemplate.charAt(index);

            if (currentCharacter == ' ' || currentCharacter == '\n' || currentCharacter == '\r' || currentCharacter == '\t')
            {
                continue;
            }

            if (currentCharacter == '=')
            {
                quartet[quartetLength++] = 0;
                ++paddingCount;
            }
            else
            {
                const int8_t decodedCharacter = decodeBase64Character(currentCharacter);
                if (decodedCharacter < 0)
                {
                    errorMessage = "Template data contains an invalid base64 character.";
                    return false;
                }

                quartet[quartetLength++] = static_cast<uint8_t>(decodedCharacter);
            }

            if (quartetLength == 4)
            {
                if (decodedLength + 3 > outputCapacity)
                {
                    errorMessage = "Template data exceeds the supported output buffer size.";
                    return false;
                }

                outputBuffer[decodedLength++] = (quartet[0] << 2) | (quartet[1] >> 4);

                if (paddingCount < 2)
                {
                    outputBuffer[decodedLength++] = ((quartet[1] & 0x0F) << 4) | (quartet[2] >> 2);
                }

                if (paddingCount == 0)
                {
                    outputBuffer[decodedLength++] = ((quartet[2] & 0x03) << 6) | quartet[3];
                }

                quartetLength = 0;
                paddingCount = 0;
            }
        }

        if (quartetLength != 0)
        {
            errorMessage = "Template data ended in the middle of a base64 block.";
            return false;
        }

        return true;
    }

    String toLowerHexString(const uint8_t *data, size_t length)
    {
        const char *hexAlphabet = "0123456789abcdef";
        String hexValue;
        hexValue.reserve(length * 2);

        for (size_t index = 0; index < length; ++index)
        {
            hexValue += hexAlphabet[(data[index] >> 4) & 0x0F];
            hexValue += hexAlphabet[data[index] & 0x0F];
        }

        return hexValue;
    }

    bool verifyTemplateHash(
        const uint8_t *templateBinary,
        size_t templateLength,
        const String &expectedHash,
        String &errorMessage
    ) {
        const String normalizedExpectedHash = String(expectedHash);

        if (normalizedExpectedHash.length() == 0)
        {
            return true;
        }

        uint8_t digest[32] = {0};
        mbedtls_sha256_context context;
        mbedtls_sha256_init(&context);
        mbedtls_sha256_starts(&context, 0);
        mbedtls_sha256_update(&context, templateBinary, templateLength);
        mbedtls_sha256_finish(&context, digest);
        mbedtls_sha256_free(&context);

        const String calculatedHash = toLowerHexString(digest, sizeof(digest));
        String expectedLowercase = normalizedExpectedHash;
        expectedLowercase.toLowerCase();

        if (calculatedHash != expectedLowercase)
        {
            errorMessage = "The downloaded template hash did not match the backend hash.";
            return false;
        }

        return true;
    }
}

bool runTemplateSyncJob(const TemplateSyncJob &job, String &errorMessage)
{
    if (job.queueId <= 0)
    {
        errorMessage = "Template sync queue ID is invalid.";
        return false;
    }

    if (job.targetSlot <= 0)
    {
        errorMessage = "The backend did not provide a valid target slot for this template sync.";
        return false;
    }

    if (job.templateDataBase64.length() == 0)
    {
        errorMessage = "The backend response did not include any template data.";
        return false;
    }

    Serial.println();
    Serial.print("Starting template sync job #");
    Serial.print(job.queueId);
    Serial.print(" for ");
    Serial.print(job.userName.length() > 0 ? job.userName : String("Unknown user"));
    Serial.print(" / ");
    Serial.println(job.fingerName.length() > 0 ? job.fingerName : String("Fingerprint"));

    uint8_t templateBinary[EXPECTED_TEMPLATE_BYTES] = {0};
    size_t templateLength = 0;

    if (!decodeTemplateBase64(
            job.templateDataBase64,
            templateBinary,
            sizeof(templateBinary),
            templateLength,
            errorMessage))
    {
        return false;
    }

    if (templateLength != EXPECTED_TEMPLATE_BYTES)
    {
        errorMessage = "Decoded template size is invalid. Expected 512 bytes.";
        return false;
    }

    if (job.templateBytes > 0 && job.templateBytes != static_cast<int>(templateLength))
    {
        errorMessage = "Decoded template size does not match the backend-reported template size.";
        return false;
    }

    if (!verifyTemplateHash(templateBinary, templateLength, job.templateHash, errorMessage))
    {
        return false;
    }

    Serial.print("Writing template to slot ");
    Serial.println(job.targetSlot);

    if (!storeTemplateInSlot(
            static_cast<uint16_t>(job.targetSlot),
            templateBinary,
            templateLength,
            errorMessage))
    {
        return false;
    }

    if (job.templateHash.length() > 0 && !saveTemplateHash(static_cast<uint16_t>(job.targetSlot), job.templateHash))
    {
        Serial.println("Warning: template metadata could not be cached locally.");
    }

    Serial.print("Template sync job #");
    Serial.print(job.queueId);
    Serial.print(" saved to slot ");
    Serial.println(job.targetSlot);

    return true;
}
