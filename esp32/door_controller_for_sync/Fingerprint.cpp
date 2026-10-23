#include "Fingerprint.h"
#include "Config.h"
#include "ControllerLog.h"

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

    String getSensorErrorMessage(uint8_t confirmationCode);

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
        Serial.print(confirmationCode, HEX);
        if (confirmationCode == FINGERPRINT_OK)
        {
            Serial.println(". The sensor accepted this step.");
            return;
        }

        Serial.print(". ");
        Serial.println(getSensorErrorMessage(confirmationCode));
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
                return "Unrecognized fingerprint sensor fault. Confirmation code 0x" + String(confirmationCode, HEX) + " is not one of the handled sensor errors.";
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
                return "Unrecognized fingerprint image fault. Sensor code 0x" + String(status, HEX) + " is not one of the handled image errors.";
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
        logStep("SYNC", "Sending the template in " + String(chunkSize) + "-byte packets.");
        Serial.flush();
        delay(20);

        const size_t packetCount = (templateLength + chunkSize - 1) / chunkSize;
        size_t packetNumber = 0;

        for (size_t offset = 0; offset < templateLength; offset += chunkSize)
        {
            const size_t remaining = templateLength - offset;
            const size_t thisChunk = remaining < chunkSize ? remaining : chunkSize;
            const bool lastPacket = (offset + thisChunk) >= templateLength;
            ++packetNumber;

            logNote("Packet " + String(packetNumber) + " of " + String(packetCount) + ".");
            Serial.flush();

            if (!writeRawPacket(
                    lastPacket ? SENSOR_PACKET_END_DATA : SENSOR_PACKET_DATA,
                    templateBinary + offset,
                    static_cast<uint16_t>(thisChunk)))
            {
                errorMessage = "Could not send template packet " + String(packetNumber) + ".";
                wrongPacketSize = true;
                return false;
            }

            // The sensor confirms the whole transfer after the last packet.
            // Reading between packets treats a late byte as a new reply and aborts the sync.
            if (!lastPacket)
            {
                delay(30);
            }
        }

        if (!readAckPacket(confirmationCode, errorMessage, 3000))
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

        if (errorMessage.length() == 0)
        {
            errorMessage = "The sensor did not accept the 512-byte template in 128, 256, or 64 byte packets.";
        }

        return false;
    }

    bool readExactBytes(uint8_t *buffer, size_t length, uint16_t timeoutMs, String &errorMessage)
    {
        for (size_t index = 0; index < length; ++index)
        {
            if (!readByteWithTimeout(buffer[index], timeoutMs))
            {
                errorMessage = "Timed out while reading the fingerprint sensor slot index.";
                return false;
            }
        }

        return true;
    }

    bool readSensorIndexPage(uint8_t page, uint8_t indexBytes[32], String &errorMessage)
    {
        const uint8_t commandPayload[] = {0x1F, page};
        clearFingerprintSerial();

        if (!writeRawPacket(SENSOR_PACKET_COMMAND, commandPayload, sizeof(commandPayload)))
        {
            errorMessage = "Could not ask the sensor which fingerprint slots are in use.";
            return false;
        }

        uint8_t header[9] = {0};
        if (!readExactBytes(header, sizeof(header), 1500, errorMessage))
        {
            return false;
        }

        if (header[0] != SENSOR_HEADER_HIGH || header[1] != SENSOR_HEADER_LOW || header[6] != SENSOR_PACKET_ACK)
        {
            errorMessage = "The sensor slot index reply was not a valid acknowledgement.";
            return false;
        }

        const uint16_t packetLength = (static_cast<uint16_t>(header[7]) << 8) | header[8];
        if (packetLength < 3)
        {
            errorMessage = "The sensor slot index reply was too short.";
            return false;
        }

        uint8_t confirmationCode = 0;
        if (!readByteWithTimeout(confirmationCode, 1500))
        {
            errorMessage = "Timed out while reading the sensor slot index result.";
            return false;
        }

        if (confirmationCode != FINGERPRINT_OK)
        {
            errorMessage = getSensorErrorMessage(confirmationCode);
            return false;
        }

        const uint16_t bytesAfterConfirmation = packetLength - 3;
        if (bytesAfterConfirmation >= 32)
        {
            if (!readExactBytes(indexBytes, 32, 1500, errorMessage))
            {
                return false;
            }

            for (uint16_t extra = 32; extra < bytesAfterConfirmation; ++extra)
            {
                uint8_t ignored = 0;
                if (!readByteWithTimeout(ignored, 1500))
                {
                    errorMessage = "The sensor slot index reply ended early.";
                    return false;
                }
            }
        }
        else
        {
            uint8_t checksumHigh = 0;
            uint8_t checksumLow = 0;
            if (!readByteWithTimeout(checksumHigh, 1500) || !readByteWithTimeout(checksumLow, 1500))
            {
                errorMessage = "The sensor slot index acknowledgement ended early.";
                return false;
            }

            uint8_t dataHeader[9] = {0};
            if (!readExactBytes(dataHeader, sizeof(dataHeader), 1500, errorMessage))
            {
                return false;
            }

            if (dataHeader[0] != SENSOR_HEADER_HIGH || dataHeader[1] != SENSOR_HEADER_LOW)
            {
                errorMessage = "The sensor did not send the slot index data.";
                return false;
            }

            const uint16_t dataPacketLength = (static_cast<uint16_t>(dataHeader[7]) << 8) | dataHeader[8];
            if (dataPacketLength < 34)
            {
                errorMessage = "The sensor slot index data was too short.";
                return false;
            }

            if (!readExactBytes(indexBytes, 32, 1500, errorMessage))
            {
                return false;
            }

            const uint16_t dataBytesAfterIndex = dataPacketLength - 32;
            for (uint16_t extra = 0; extra < dataBytesAfterIndex; ++extra)
            {
                uint8_t ignored = 0;
                if (!readByteWithTimeout(ignored, 1500))
                {
                    errorMessage = "The sensor slot index data ended early.";
                    return false;
                }
            }

            return true;
        }

        uint8_t checksumHigh = 0;
        uint8_t checksumLow = 0;
        if (!readByteWithTimeout(checksumHigh, 1500) || !readByteWithTimeout(checksumLow, 1500))
        {
            errorMessage = "The sensor slot index checksum did not arrive.";
            return false;
        }

        return true;
    }
}

bool readSensorOccupancy(uint8_t *occupiedBits, uint16_t capacity, String &errorMessage)
{
    if (occupiedBits == nullptr || capacity == 0)
    {
        errorMessage = "The sensor slot index buffer is missing.";
        return false;
    }

    const uint16_t limitedCapacity = capacity > 1023 ? 1023 : capacity;
    const uint16_t pageCount = (limitedCapacity / 256) + 1;

    for (uint16_t page = 0; page < pageCount; ++page)
    {
        uint8_t indexBytes[32] = {0};
        if (!readSensorIndexPage(static_cast<uint8_t>(page), indexBytes, errorMessage))
        {
            return false;
        }

        for (uint8_t byteIndex = 0; byteIndex < 32; ++byteIndex)
        {
            for (uint8_t bitIndex = 0; bitIndex < 8; ++bitIndex)
            {
                const uint16_t slot = static_cast<uint16_t>(page * 256 + byteIndex * 8 + bitIndex);
                if (slot > limitedCapacity)
                {
                    return true;
                }

                if ((indexBytes[byteIndex] & (1 << bitIndex)) != 0)
                {
                    occupiedBits[slot / 8] = occupiedBits[slot / 8] | (1 << (slot % 8));
                }
            }
        }
    }

    return true;
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

    logNote("Sensor TX -> GPIO " + String(FP_RX_PIN) + ", sensor RX <- GPIO " + String(FP_TX_PIN) + ", baud " + String(FP_BAUDRATE) + ".");
    logNote("Password sent to the sensor: 00 00 00 00. This is the factory sensor password, not the WiFi password.");
    logNote("After a full power-on the sensor can take a few seconds to answer.");

    bool sensorReady = false;
    for (uint8_t attempt = 1; attempt <= 8; ++attempt)
    {
        delay(attempt == 1 ? 500 : 700);

        FingerSerial.begin(
            FP_BAUDRATE,
            SERIAL_8N1,
            FP_RX_PIN,
            FP_TX_PIN
        );

        if (finger.verifyPassword())
        {
            sensorReady = true;
            break;
        }

        logStep("SENSOR", "No reply yet. Attempt " + String(attempt) + " of 8.");
    }

    if (!sensorReady)
    {
        logStep("SENSOR", "The sensor did not answer the password check.");
        logNote("What is wrong: no 5V, missing ground, or the data wires are not on GPIO 32 and GPIO 33.");
        logNote("Sensor TX must go to GPIO 32. Sensor RX must come from GPIO 33. Do not power the sensor from 3.3V.");
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
        logNote("The sensor answered, but its packet size could not be read. Templates will be sent in 128-byte packets.");
    }

    String connectedMessage = "Connected. Password accepted. Packet size " + String(g_sensorPacketBytes) + " bytes";
    if (finger.capacity > 0)
    {
        connectedMessage += ". Capacity " + String(finger.capacity) + " templates";
    }
    connectedMessage += ".";
    logStep("SENSOR", connectedMessage);
    logNote("A packet size of 128 is normal. It is not an error.");
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
