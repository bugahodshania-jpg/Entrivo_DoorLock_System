#include "Fingerprint.h"
#include "Config.h"

HardwareSerial FingerSerial(2);
Adafruit_Fingerprint finger(&FingerSerial);

namespace
{
    constexpr size_t TEMPLATE_PACKET_SIZE = 534;
    constexpr size_t TEMPLATE_BINARY_SIZE = 512;

    const char *BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    String encodeBase64(const uint8_t *data, size_t length)
    {
        String encoded;
        encoded.reserve(((length + 2) / 3) * 4);

        for (size_t index = 0; index < length; index += 3)
        {
            const size_t remaining = length - index;
            const uint32_t octetA = data[index];
            const uint32_t octetB = remaining > 1 ? data[index + 1] : 0;
            const uint32_t octetC = remaining > 2 ? data[index + 2] : 0;
            const uint32_t triple = (octetA << 16) | (octetB << 8) | octetC;

            encoded += BASE64_ALPHABET[(triple >> 18) & 0x3F];
            encoded += BASE64_ALPHABET[(triple >> 12) & 0x3F];
            encoded += remaining > 1 ? BASE64_ALPHABET[(triple >> 6) & 0x3F] : '=';
            encoded += remaining > 2 ? BASE64_ALPHABET[triple & 0x3F] : '=';
        }

        return encoded;
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

    if (finger.verifyPassword())
    {
        Serial.println("Fingerprint Sensor Connected");
        return true;
    }

    Serial.println("Fingerprint Sensor NOT Found");
    return false;
}

bool downloadStoredTemplateBase64(uint16_t slot, String &templateDataBase64, String &errorMessage)
{
    while (FingerSerial.available() > 0)
    {
        FingerSerial.read();
    }

    uint8_t status = finger.loadModel(slot);
    if (status != FINGERPRINT_OK)
    {
        switch (status)
        {
            case FINGERPRINT_PACKETRECIEVEERR:
                errorMessage = "Communication error while loading the stored fingerprint template.";
                break;
            case FINGERPRINT_BADLOCATION:
                errorMessage = "Cannot load fingerprint template because the sensor slot is invalid.";
                break;
            case FINGERPRINT_FLASHERR:
                errorMessage = "Sensor flash error while loading the stored fingerprint template.";
                break;
            default:
                errorMessage = "Unknown error while loading the stored fingerprint template.";
                break;
        }

        return false;
    }

    status = finger.getModel();
    if (status != FINGERPRINT_OK)
    {
        switch (status)
        {
            case FINGERPRINT_PACKETRECIEVEERR:
                errorMessage = "Communication error while requesting the fingerprint template upload.";
                break;
            default:
                errorMessage = "Unknown error while requesting the fingerprint template upload.";
                break;
        }

        return false;
    }

    uint8_t rawPacket[TEMPLATE_PACKET_SIZE];
    memset(rawPacket, 0xFF, sizeof(rawPacket));

    const unsigned long startedAt = millis();
    size_t bytesRead = 0;

    while (bytesRead < sizeof(rawPacket) && (millis() - startedAt) < 20000)
    {
        if (FingerSerial.available() > 0)
        {
            rawPacket[bytesRead++] = static_cast<uint8_t>(FingerSerial.read());
        }
    }

    if (bytesRead < sizeof(rawPacket))
    {
        errorMessage = "Timed out while downloading the fingerprint template from the sensor.";
        return false;
    }

    uint8_t templateBinary[TEMPLATE_BINARY_SIZE];
    memset(templateBinary, 0x00, sizeof(templateBinary));

    size_t rawIndex = 9;
    memcpy(templateBinary, rawPacket + rawIndex, 256);
    rawIndex += 256;
    rawIndex += 2;
    rawIndex += 9;
    memcpy(templateBinary + 256, rawPacket + rawIndex, 256);

    templateDataBase64 = encodeBase64(templateBinary, sizeof(templateBinary));
    return templateDataBase64.length() > 0;
}
