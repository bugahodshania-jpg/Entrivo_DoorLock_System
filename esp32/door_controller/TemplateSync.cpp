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
                const size_t bytesInBlock = paddingCount >= 3 ? 0 : static_cast<size_t>(3 - paddingCount);
                if (bytesInBlock == 0 || decodedLength + bytesInBlock > outputCapacity)
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

    bool reservedListContains(const String &reservedSlots, uint16_t slot)
    {
        if (reservedSlots.length() == 0 || slot == 0)
        {
            return false;
        }

        const String token = String(slot);
        int start = 0;

        while (start < static_cast<int>(reservedSlots.length()))
        {
            int end = reservedSlots.indexOf(',', start);
            if (end < 0)
            {
                end = reservedSlots.length();
            }

            String piece = reservedSlots.substring(start, end);
            piece.trim();
            if (piece == token)
            {
                return true;
            }

            start = end + 1;
        }

        return false;
    }

    bool slotCanStoreTemplate(
        const TemplateSyncJob &job,
        uint16_t slot,
        uint16_t capacity,
        bool &unreadable,
        String &errorMessage)
    {
        unreadable = false;

        if (slot == 0 || slot > capacity)
        {
            return false;
        }

        if (reservedListContains(job.reservedSlots, slot))
        {
            return false;
        }

        const String existingHash = getTemplateHash(slot);
        if (job.templateHash.length() > 0 && existingHash.equalsIgnoreCase(job.templateHash))
        {
            return true;
        }

        const SensorSlotState state = probeSensorSlot(slot, errorMessage);
        if (state == SENSOR_SLOT_UNREADABLE)
        {
            unreadable = true;
            return false;
        }

        return state == SENSOR_SLOT_EMPTY;
    }

    uint16_t chooseDoorSlot(const TemplateSyncJob &job, String &errorMessage)
    {
        const uint16_t capacity = sensorSlotCapacity();
        const uint16_t preferred = job.targetSlot > 0 ? static_cast<uint16_t>(job.targetSlot) : 0;
        bool unreadable = false;

        if (preferred > 0 && slotCanStoreTemplate(job, preferred, capacity, unreadable, errorMessage))
        {
            return preferred;
        }

        if (unreadable)
        {
            return 0;
        }

        for (uint16_t slot = 1; slot <= capacity; ++slot)
        {
            if (slot == preferred)
            {
                continue;
            }

            if (slotCanStoreTemplate(job, slot, capacity, unreadable, errorMessage))
            {
                return slot;
            }

            if (unreadable)
            {
                return 0;
            }
        }

        errorMessage = "Sensor B has no free slot that can be linked to this user.";
        return 0;
    }

    bool previousSlotBelongsToJob(const TemplateSyncJob &job, uint16_t previousSlot)
    {
        if (previousSlot == 0)
        {
            return false;
        }

        DoorSlotUser previousUser;
        if (loadDoorSlotUser(previousSlot, previousUser) && previousUser.fingerprintId == job.fingerprintId)
        {
            return true;
        }

        const String previousHash = getTemplateHash(previousSlot);
        return job.templateHash.length() > 0 && previousHash.equalsIgnoreCase(job.templateHash);
    }
}

bool runTemplateSyncJob(const TemplateSyncJob &job, uint16_t &storedSlot, String &errorMessage)
{
    storedSlot = 0;

    if (job.queueId <= 0)
    {
        errorMessage = "Template sync queue ID is invalid.";
        return false;
    }

    if (job.fingerprintId <= 0)
    {
        errorMessage = "Template sync job is missing the fingerprint record.";
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

    const uint16_t doorSlot = chooseDoorSlot(job, errorMessage);
    if (doorSlot == 0)
    {
        return false;
    }

    const uint16_t previousSlot = getFingerprintDoorSlot(job.fingerprintId);
    if (previousSlot > 0 && previousSlot != doorSlot && previousSlotBelongsToJob(job, previousSlot))
    {
        if (!deleteTemplateFromSlot(previousSlot, errorMessage))
        {
            errorMessage = "Could not remove this user's previous Sensor B slot: " + errorMessage;
            return false;
        }

        clearTemplateHash(previousSlot);
        clearDoorSlotUser(previousSlot);
    }

    Serial.print("Writing template for ");
    Serial.print(job.userName.length() > 0 ? job.userName : String("Unknown user"));
    Serial.print(" to Sensor B slot ");
    Serial.println(doorSlot);

    if (job.targetSlot > 0 && static_cast<uint16_t>(job.targetSlot) != doorSlot)
    {
        Serial.print("Enrollment slot ");
        Serial.print(job.targetSlot);
        Serial.println(" is already in use, so this user is linked to the Sensor B slot above.");
    }

    if (!storeTemplateInSlot(doorSlot, templateBinary, templateLength, errorMessage))
    {
        return false;
    }

    DoorSlotUser doorUser;
    doorUser.slot = doorSlot;
    doorUser.fingerprintId = job.fingerprintId;
    doorUser.userId = job.userId;
    doorUser.userName = job.userName.length() > 0 ? job.userName : String("Unknown user");
    doorUser.fingerName = job.fingerName.length() > 0 ? job.fingerName : String("Fingerprint");

    if ((job.templateHash.length() > 0 && !saveTemplateHash(doorSlot, job.templateHash)) || !saveDoorSlotUser(doorUser))
    {
        String cleanupError;
        deleteTemplateFromSlot(doorSlot, cleanupError);
        clearTemplateHash(doorSlot);
        clearDoorSlotUser(doorSlot);
        errorMessage = "The template was written, but Sensor B could not link that slot to the user.";
        return false;
    }

    storedSlot = doorSlot;

    Serial.print("Template sync job #");
    Serial.print(job.queueId);
    Serial.print(" linked ");
    Serial.print(doorUser.userName);
    Serial.print(" to Sensor B slot ");
    Serial.println(doorSlot);

    return true;
}
