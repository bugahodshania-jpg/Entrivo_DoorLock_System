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
    constexpr uint16_t ACK_TIMEOUT_MS = 4000;
    constexpr size_t SENSOR_PACKET_BUFFER_BYTES = 280;

    size_t g_sensorPacketBytes = 128;

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
        if (payloadLength > 256)
        {
            return false;
        }

        uint8_t rawPacket[SENSOR_PACKET_BUFFER_BYTES] = {0};
        const uint16_t packetLength = payloadLength + 2;
        uint16_t checksum = packetType + (packetLength >> 8) + (packetLength & 0xFF);
        size_t count = 0;

        rawPacket[count++] = SENSOR_HEADER_HIGH;
        rawPacket[count++] = SENSOR_HEADER_LOW;
        rawPacket[count++] = 0xFF;
        rawPacket[count++] = 0xFF;
        rawPacket[count++] = 0xFF;
        rawPacket[count++] = 0xFF;
        rawPacket[count++] = packetType;
        rawPacket[count++] = static_cast<uint8_t>(packetLength >> 8);
        rawPacket[count++] = static_cast<uint8_t>(packetLength & 0xFF);

        for (uint16_t index = 0; index < payloadLength; ++index)
        {
            rawPacket[count++] = payload[index];
            checksum += payload[index];
        }

        rawPacket[count++] = static_cast<uint8_t>(checksum >> 8);
        rawPacket[count++] = static_cast<uint8_t>(checksum & 0xFF);

        // The whole packet is queued, then the UART shifts it out without gaps.
        // A gap makes the R307S drop the packet and send no confirmation.
        const size_t written = FingerSerial.write(rawPacket, count);
        FingerSerial.flush();
        return written == count;
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

    void printConfirmationCode(const char *label, uint8_t confirmationCode)
    {
        Serial.print(label);
        Serial.println(confirmationCode, HEX);
    }

    bool readEarlyAck(uint8_t &confirmationCode, String &errorMessage)
    {
        constexpr uint16_t EARLY_ACK_TIMEOUT_MS = 600;
        uint8_t firstByte = 0;

        if (!readByteWithTimeout(firstByte, EARLY_ACK_TIMEOUT_MS))
        {
            return false;
        }

        uint8_t header[9] = {firstByte, 0, 0, 0, 0, 0, 0, 0, 0};
        for (size_t index = 1; index < sizeof(header); ++index)
        {
            if (!readByteWithTimeout(header[index], ACK_TIMEOUT_MS))
            {
                errorMessage = "The sensor started a data-packet confirmation, but it did not finish.";
                return false;
            }
        }

        if (header[0] != SENSOR_HEADER_HIGH || header[1] != SENSOR_HEADER_LOW || header[6] != SENSOR_PACKET_ACK)
        {
            errorMessage = "The sensor sent an unexpected reply while receiving template data.";
            confirmationCode = 0xFF;
            return false;
        }

        const uint16_t packetLength = (static_cast<uint16_t>(header[7]) << 8) | header[8];
        if (packetLength < 3)
        {
            errorMessage = "The sensor data-packet confirmation was too short.";
            return false;
        }

        const uint16_t payloadLength = packetLength - 2;
        uint8_t payload[16] = {0};
        for (uint16_t index = 0; index < payloadLength; ++index)
        {
            uint8_t value = 0;
            if (!readByteWithTimeout(value, ACK_TIMEOUT_MS))
            {
                errorMessage = "The sensor data-packet confirmation ended early.";
                return false;
            }

            if (index < sizeof(payload))
            {
                payload[index] = value;
            }
        }

        uint8_t checksumHigh = 0;
        uint8_t checksumLow = 0;
        if (!readByteWithTimeout(checksumHigh, ACK_TIMEOUT_MS) || !readByteWithTimeout(checksumLow, ACK_TIMEOUT_MS))
        {
            errorMessage = "The sensor data-packet confirmation checksum did not arrive.";
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

    bool confirmationMeansWrongPacketSize(bool gotCode, uint8_t confirmationCode)
    {
        if (!gotCode)
        {
            return true;
        }

        return confirmationCode == FINGERPRINT_PACKETRECIEVEERR || confirmationCode == FINGERPRINT_PACKETRESPONSEFAIL;
    }

    void recoverSensorAfterFailedDownload()
    {
        Serial.println("Waiting for the fingerprint sensor to leave the failed transfer.");
        const unsigned long quietUntil = millis() + 800;
        while (static_cast<long>(quietUntil - millis()) > 0)
        {
            while (FingerSerial.available() > 0)
            {
                FingerSerial.read();
            }
            delay(20);
        }

        const uint8_t readParametersCommand[] = {0x0F};
        writeRawPacket(SENSOR_PACKET_COMMAND, readParametersCommand, sizeof(readParametersCommand));

        uint8_t confirmationCode = 0;
        String ignored;
        readAckPacket(confirmationCode, ignored, 1500);
        clearFingerprintSerial();
    }

    bool downloadTemplateAtPacketSize(
        const uint8_t *templateBinary,
        size_t templateLength,
        size_t chunkSize,
        String &errorMessage,
        bool &sensorAcceptedDownload,
        bool &wrongPacketSize
    )
    {
        sensorAcceptedDownload = false;
        wrongPacketSize = false;
        clearFingerprintSerial();

        const uint8_t commandPayload[] = {
            SENSOR_COMMAND_DOWNLOAD_TEMPLATE,
            SENSOR_CHAR_BUFFER_1
        };

        if (!writeRawPacket(SENSOR_PACKET_COMMAND, commandPayload, sizeof(commandPayload)))
        {
            errorMessage = "Could not send the template download command.";
            wrongPacketSize = true;
            return false;
        }

        uint8_t confirmationCode = FINGERPRINT_PACKETRECIEVEERR;
        if (!readAckPacket(confirmationCode, errorMessage))
        {
            errorMessage = "Timed out waiting for the sensor to accept the template download.";
            wrongPacketSize = true;
            return false;
        }

        sensorAcceptedDownload = true;
        if (confirmationCode != FINGERPRINT_OK)
        {
            printConfirmationCode("Template download was refused with code: 0x", confirmationCode);
            errorMessage = getSensorErrorMessage(confirmationCode);
            wrongPacketSize = confirmationMeansWrongPacketSize(true, confirmationCode);
            return false;
        }

        printConfirmationCode("Template download accepted with code: 0x", confirmationCode);
        Serial.print("Uploading template in ");
        Serial.print(chunkSize);
        Serial.println("-byte packets.");
        delay(20);

        for (size_t offset = 0; offset < templateLength; offset += chunkSize)
        {
            const size_t remaining = templateLength - offset;
            const size_t thisChunk = remaining < chunkSize ? remaining : chunkSize;
            const bool lastPacket = (offset + thisChunk) >= templateLength;

            if (!writeRawPacket(
                    lastPacket ? SENSOR_PACKET_END_DATA : SENSOR_PACKET_DATA,
                    templateBinary + offset,
                    static_cast<uint16_t>(thisChunk)))
            {
                errorMessage = "Could not send a template data packet.";
                wrongPacketSize = true;
                return false;
            }

            if (lastPacket)
            {
                continue;
            }

            uint8_t earlyCode = 0;
            String earlyError;
            if (!readEarlyAck(earlyCode, earlyError))
            {
                if (earlyError.length() > 0)
                {
                    errorMessage = earlyError;
                    wrongPacketSize = true;
                    return false;
                }

                continue;
            }

            printConfirmationCode("Data packet confirmation code: 0x", earlyCode);
            if (earlyCode != FINGERPRINT_OK)
            {
                errorMessage = getSensorErrorMessage(earlyCode);
                wrongPacketSize = confirmationMeansWrongPacketSize(true, earlyCode);
                return false;
            }
        }

        if (!readAckPacket(confirmationCode, errorMessage, 2000))
        {
            errorMessage = "Timed out waiting for the sensor to confirm the template data.";
            wrongPacketSize = true;
            return false;
        }

        printConfirmationCode("Template download confirmation code: 0x", confirmationCode);
        if (confirmationCode != FINGERPRINT_OK)
        {
            errorMessage = getSensorErrorMessage(confirmationCode);
            wrongPacketSize = confirmationMeansWrongPacketSize(true, confirmationCode);
            return false;
        }

        g_sensorPacketBytes = chunkSize;
        return true;
    }

    bool uploadTemplateToCharBuffer1(const uint8_t *templateBinary, size_t templateLength, String &errorMessage)
    {
        if (templateBinary == nullptr || templateLength != EXPECTED_TEMPLATE_BYTES)
        {
            errorMessage = "Template upload requires exactly 512 bytes.";
            return false;
        }

        size_t packetSizes[4];
        size_t packetSizeCount = 0;
        const size_t candidates[] = {g_sensorPacketBytes, static_cast<size_t>(128), static_cast<size_t>(256), static_cast<size_t>(64)};

        for (size_t index = 0; index < sizeof(candidates) / sizeof(candidates[0]); ++index)
        {
            const size_t candidate = candidates[index];
            if (candidate == 0 || (templateLength % candidate) != 0)
            {
                continue;
            }

            bool alreadyListed = false;
            for (size_t listed = 0; listed < packetSizeCount; ++listed)
            {
                if (packetSizes[listed] == candidate)
                {
                    alreadyListed = true;
                    break;
                }
            }

            if (!alreadyListed && packetSizeCount < sizeof(packetSizes) / sizeof(packetSizes[0]))
            {
                packetSizes[packetSizeCount++] = candidate;
            }
        }

        for (size_t index = 0; index < packetSizeCount; ++index)
        {
            if (index > 0)
            {
                Serial.print("The sensor did not confirm the previous packet size. Trying ");
                Serial.print(packetSizes[index]);
                Serial.println("-byte packets.");
                recoverSensorAfterFailedDownload();
            }

            bool sensorAcceptedDownload = false;
            bool wrongPacketSize = false;
            if (downloadTemplateAtPacketSize(
                    templateBinary,
                    templateLength,
                    packetSizes[index],
                    errorMessage,
                    sensorAcceptedDownload,
                    wrongPacketSize))
            {
                return true;
            }

            if (!wrongPacketSize)
            {
                return false;
            }

            if (!sensorAcceptedDownload && index == 0)
            {
                recoverSensorAfterFailedDownload();
                if (downloadTemplateAtPacketSize(
                        templateBinary,
                        templateLength,
                        packetSizes[index],
                        errorMessage,
                        sensorAcceptedDownload,
                        wrongPacketSize))
                {
                    return true;
                }

                if (!wrongPacketSize || !sensorAcceptedDownload)
                {
                    return false;
                }
            }
        }

        return false;
    }
}

bool initFingerprint()
{
    // A data packet is longer than the UART hardware FIFO. Queue the whole
    // packet so Wi-Fi cannot open a gap in the middle of it.
    if (!FingerSerial)
    {
        FingerSerial.setRxBufferSize(1024);
        FingerSerial.setTxBufferSize(512);
    }

    FingerSerial.begin(
        FP_BAUDRATE,
        SERIAL_8N1,
        FP_RX_PIN,
        FP_TX_PIN
    );

    finger.begin(FP_BAUDRATE);

    // The library calls begin() again without pins and restarts this UART.
    // Put the sensor back on GPIO 32 and GPIO 33 before the password check.
    FingerSerial.begin(
        FP_BAUDRATE,
        SERIAL_8N1,
        FP_RX_PIN,
        FP_TX_PIN
    );

    Serial.println();
    Serial.println("Initializing Fingerprint...");

    if (!finger.verifyPassword())
    {
        Serial.println("Fingerprint Sensor NOT Found");
        return false;
    }

    if (finger.getParameters() == FINGERPRINT_OK &&
        (finger.packet_len == 32 || finger.packet_len == 64 || finger.packet_len == 128 || finger.packet_len == 256))
    {
        g_sensorPacketBytes = finger.packet_len;
    }
    else
    {
        g_sensorPacketBytes = 128;
        Serial.println("Warning: could not read the fingerprint packet size. Using 128 bytes.");
    }

    Serial.print("Fingerprint packet size: ");
    Serial.println(g_sensorPacketBytes);

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
