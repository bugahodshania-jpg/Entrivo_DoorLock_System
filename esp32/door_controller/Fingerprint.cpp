#include "Fingerprint.h"
#include "Config.h"

HardwareSerial FingerSerial(2);
Adafruit_Fingerprint finger(&FingerSerial);

namespace
{
    constexpr uint8_t SENSOR_HEADER_HIGH = 0xEF;
    constexpr uint8_t SENSOR_HEADER_LOW = 0x01;
    constexpr uint8_t SENSOR_PACKET_COMMAND = 0x01;
    constexpr uint8_t SENSOR_PACKET_DATA = 0x02;
    constexpr uint8_t SENSOR_PACKET_ACK = 0x07;
    constexpr uint8_t SENSOR_PACKET_END_DATA = 0x08;
    constexpr uint8_t SENSOR_COMMAND_DOWNLOAD_TEMPLATE = 0x09;
    constexpr uint8_t SENSOR_CHAR_BUFFER_1 = 0x01;
    constexpr size_t TEMPLATE_CHUNK_SIZE = 256;
    constexpr uint16_t ACK_TIMEOUT_MS = 4000;

    void clearFingerprintSerial()
    {
        while (FingerSerial.available() > 0)
        {
            FingerSerial.read();
        }
    }

    bool readByteWithTimeout(uint8_t &value, uint32_t timeoutMs)
    {
        const unsigned long startedAt = millis();

        while ((millis() - startedAt) < timeoutMs)
        {
            if (FingerSerial.available() > 0)
            {
                value = static_cast<uint8_t>(FingerSerial.read());
                return true;
            }

            delay(1);
        }

        return false;
    }

    bool writeRawPacket(uint8_t packetType, const uint8_t *payload, uint16_t payloadLength)
    {
        const uint16_t packetLength = payloadLength + 2;
        uint16_t checksum = packetType + (packetLength >> 8) + (packetLength & 0xFF);

        FingerSerial.write(SENSOR_HEADER_HIGH);
        FingerSerial.write(SENSOR_HEADER_LOW);

        for (uint8_t index = 0; index < 4; ++index)
        {
            FingerSerial.write(static_cast<uint8_t>(0xFF));
        }

        FingerSerial.write(packetType);
        FingerSerial.write(static_cast<uint8_t>(packetLength >> 8));
        FingerSerial.write(static_cast<uint8_t>(packetLength & 0xFF));

        for (uint16_t index = 0; index < payloadLength; ++index)
        {
            const uint8_t value = payload[index];
            FingerSerial.write(value);
            checksum += value;
        }

        FingerSerial.write(static_cast<uint8_t>(checksum >> 8));
        FingerSerial.write(static_cast<uint8_t>(checksum & 0xFF));
        FingerSerial.flush();

        return true;
    }

    bool readAckPacket(uint8_t &confirmationCode, String &errorMessage, uint16_t timeoutMs = ACK_TIMEOUT_MS)
    {
        uint8_t header[9] = {0};

        for (size_t index = 0; index < sizeof(header); ++index)
        {
            if (!readByteWithTimeout(header[index], timeoutMs))
            {
                errorMessage = "Timed out while waiting for the fingerprint sensor acknowledgement.";
                return false;
            }
        }

        if (header[0] != SENSOR_HEADER_HIGH || header[1] != SENSOR_HEADER_LOW)
        {
            errorMessage = "The fingerprint sensor returned an invalid packet header.";
            return false;
        }

        if (header[6] != SENSOR_PACKET_ACK)
        {
            errorMessage = "The fingerprint sensor returned an unexpected packet type.";
            return false;
        }

        const uint16_t packetLength = (static_cast<uint16_t>(header[7]) << 8) | header[8];
        if (packetLength < 3)
        {
            errorMessage = "The fingerprint sensor acknowledgement was too short.";
            return false;
        }

        const uint16_t payloadLength = packetLength - 2;
        uint8_t payload[16] = {0};

        for (uint16_t index = 0; index < payloadLength; ++index)
        {
            uint8_t value = 0;
            if (!readByteWithTimeout(value, timeoutMs))
            {
                errorMessage = "Timed out while reading the fingerprint sensor acknowledgement payload.";
                return false;
            }

            if (index < sizeof(payload))
            {
                payload[index] = value;
            }
        }

        uint8_t checksumHigh = 0;
        uint8_t checksumLow = 0;
        if (!readByteWithTimeout(checksumHigh, timeoutMs) || !readByteWithTimeout(checksumLow, timeoutMs))
        {
            errorMessage = "Timed out while reading the fingerprint sensor acknowledgement checksum.";
            return false;
        }

        (void) checksumHigh;
        (void) checksumLow;

        confirmationCode = payload[0];
        return true;
    }

    String getSensorErrorMessage(uint8_t confirmationCode)
    {
        switch (confirmationCode)
        {
            case FINGERPRINT_PACKETRECIEVEERR:
                return "Communication error while talking to the fingerprint sensor.";
            case FINGERPRINT_BADLOCATION:
                return "The requested fingerprint slot is invalid.";
            case FINGERPRINT_NOTFOUND:
                return "The fingerprint was not found in local sensor storage.";
            case FINGERPRINT_UPLOADFEATUREFAIL:
                return "The sensor rejected the uploaded template features.";
            case FINGERPRINT_PACKETRESPONSEFAIL:
                return "The sensor reported a packet response failure during template upload.";
            case FINGERPRINT_UPLOADFAIL:
                return "The sensor could not finish the template upload.";
            case FINGERPRINT_FLASHERR:
                return "The sensor reported a flash write error.";
            case FINGERPRINT_INVALIDIMAGE:
                return "The sensor reported invalid fingerprint template data.";
            default:
                return "Unknown fingerprint sensor error.";
        }
    }

    String getImageErrorMessage(uint8_t status)
    {
        switch (status)
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

    bool uploadTemplateToCharBuffer1(const uint8_t *templateBinary, size_t templateLength, String &errorMessage)
    {
        if (templateBinary == nullptr || templateLength != EXPECTED_TEMPLATE_BYTES)
        {
            errorMessage = "Template upload requires exactly 512 bytes.";
            return false;
        }

        clearFingerprintSerial();

        const uint8_t commandPayload[] = {
            SENSOR_COMMAND_DOWNLOAD_TEMPLATE,
            SENSOR_CHAR_BUFFER_1
        };

        writeRawPacket(SENSOR_PACKET_COMMAND, commandPayload, sizeof(commandPayload));

        uint8_t confirmationCode = FINGERPRINT_PACKETRECIEVEERR;
        if (!readAckPacket(confirmationCode, errorMessage))
        {
            return false;
        }

        if (confirmationCode != FINGERPRINT_OK)
        {
            errorMessage = getSensorErrorMessage(confirmationCode);
            return false;
        }

        writeRawPacket(SENSOR_PACKET_DATA, templateBinary, TEMPLATE_CHUNK_SIZE);
        writeRawPacket(
            SENSOR_PACKET_END_DATA,
            templateBinary + TEMPLATE_CHUNK_SIZE,
            TEMPLATE_CHUNK_SIZE
        );

        if (!readAckPacket(confirmationCode, errorMessage, 10000))
        {
            return false;
        }

        if (confirmationCode != FINGERPRINT_OK)
        {
            errorMessage = getSensorErrorMessage(confirmationCode);
            return false;
        }

        return true;
    }
}

bool initFingerprint()
{
    FingerSerial.begin(
        FP_BAUDRATE,
        SERIAL_8N1,
        FP_RX_PIN,
        FP_TX_PIN
    );

    finger.begin(FP_BAUDRATE);

    Serial.println();
    Serial.println("Initializing Fingerprint...");

    if (!finger.verifyPassword())
    {
        Serial.println("Fingerprint Sensor NOT Found");
        return false;
    }

    finger.getParameters();
    const uint8_t packetSizeStatus = finger.setPacketSize(FINGERPRINT_PACKET_SIZE_256);

    if (packetSizeStatus != FINGERPRINT_OK)
    {
        Serial.println("Warning: could not switch the fingerprint sensor packet size to 256 bytes.");
    }

    Serial.println("Fingerprint Sensor Connected");
    return true;
}

uint16_t sensorSlotCapacity()
{
    if (finger.capacity > 0)
    {
        return finger.capacity;
    }

    return MAX_ALLOWED_SLOTS;
}

SensorSlotState probeSensorSlot(uint16_t slot, String &errorMessage)
{
    if (slot == 0)
    {
        errorMessage = "Fingerprint slot 0 cannot be checked.";
        return SENSOR_SLOT_UNREADABLE;
    }

    const uint8_t status = finger.loadModel(slot);
    if (status == FINGERPRINT_OK)
    {
        return SENSOR_SLOT_OCCUPIED;
    }

    if (status == FINGERPRINT_PACKETRECIEVEERR)
    {
        errorMessage = "Communication error while checking a Sensor B fingerprint slot.";
        return SENSOR_SLOT_UNREADABLE;
    }

    return SENSOR_SLOT_EMPTY;
}

bool deleteTemplateFromSlot(uint16_t slot, String &errorMessage)
{
    if (slot == 0)
    {
        errorMessage = "Fingerprint slot 0 cannot be deleted.";
        return false;
    }

    const uint8_t status = finger.deleteModel(slot);
    if (status == FINGERPRINT_OK || status == FINGERPRINT_DELETEFAIL)
    {
        return true;
    }

    errorMessage = getSensorErrorMessage(status);
    return false;
}

bool storeTemplateInSlot(uint16_t slot, const uint8_t *templateBinary, size_t templateLength, String &errorMessage)
{
    if (slot == 0)
    {
        errorMessage = "The target fingerprint slot must be greater than zero.";
        return false;
    }

    if (!uploadTemplateToCharBuffer1(templateBinary, templateLength, errorMessage))
    {
        return false;
    }

    const uint8_t storeStatus = finger.storeModel(slot);
    if (storeStatus != FINGERPRINT_OK)
    {
        errorMessage = getSensorErrorMessage(storeStatus);
        return false;
    }

    return true;
}

FingerprintScanStatus pollFingerprintMatch(uint16_t &matchedSlot, String &errorMessage)
{
    matchedSlot = 0;
    errorMessage = "";

    const uint8_t imageStatus = finger.getImage();
    if (imageStatus == FINGERPRINT_NOFINGER)
    {
        return FINGERPRINT_SCAN_IDLE;
    }

    if (imageStatus != FINGERPRINT_OK)
    {
        errorMessage = getImageErrorMessage(imageStatus);
        return FINGERPRINT_SCAN_ERROR;
    }

    const uint8_t templateStatus = finger.image2Tz();
    if (templateStatus != FINGERPRINT_OK)
    {
        errorMessage = getSensorErrorMessage(templateStatus);
        return FINGERPRINT_SCAN_ERROR;
    }

    const uint8_t searchStatus = finger.fingerFastSearch();
    if (searchStatus == FINGERPRINT_OK)
    {
        matchedSlot = finger.fingerID;
        return FINGERPRINT_SCAN_MATCHED;
    }

    if (searchStatus == FINGERPRINT_NOTFOUND)
    {
        return FINGERPRINT_SCAN_NO_MATCH;
    }

    errorMessage = getSensorErrorMessage(searchStatus);
    return FINGERPRINT_SCAN_ERROR;
}
