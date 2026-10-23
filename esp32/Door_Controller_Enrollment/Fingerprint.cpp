#include "Fingerprint.h"
#include "Config.h"
#include "SensorTransfer.h"
#include "EnrollmentProof.h"
#include <mbedtls/sha256.h>
#include <mbedtls/version.h>

HardwareSerial FingerSerial(FP_UART_INDEX);
Adafruit_Fingerprint finger(&FingerSerial);

namespace
{
    static_assert(DoorFingerprintSearch::OK == FINGERPRINT_OK &&
        DoorFingerprintSearch::NOT_FOUND == FINGERPRINT_NOTFOUND,
        "Search strategy must use the fingerprint library's status codes.");

    void printStatusCode(uint8_t status)
    {
        Serial.print("0x");
        if (status < 16) Serial.print('0');
        Serial.print(status, HEX);
    }

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
    // Restore UART1 pins after the library initializes the port.
    FingerSerial.begin(FP_BAUDRATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);

    Serial.println();
    Serial.println("Initializing Fingerprint...");

    if (finger.verifyPassword() && finger.getParameters() == FINGERPRINT_OK && finger.capacity > 0)
    {
        Serial.println("Fingerprint Sensor Connected");
        Serial.print("[FP] Sensor capacity="); Serial.print(finger.capacity);
        Serial.print(", packet bytes="); Serial.println(finger.packet_len);
        const uint8_t countStatus = finger.getTemplateCount();
        if (countStatus == FINGERPRINT_OK) {
            Serial.print("[FP] Stored templates="); Serial.println(finger.templateCount);
        } else logFingerprintStatus("template count", countStatus);
        return true;
    }

    Serial.println("Fingerprint Sensor NOT Found");
    return false;
}

void logFingerprintStatus(const char *stage, uint8_t status)
{
    Serial.print("[FP] "); Serial.print(stage); Serial.print(" status=");
    printStatusCode(status);
    if (DoorFingerprintSearch::communicationError(status)) Serial.print(" (communication error)");
    Serial.println();
}

DoorFingerprintSearch::Result searchFingerprintForAccess()
{
    const DoorFingerprintSearch::Result result = searchFingerprintVerified();
    Serial.print("[FP] Search standard="); printStatusCode(result.standardStatus);
    Serial.print(", sensor capacity="); Serial.println(finger.capacity);
    switch (result.outcome) {
        case DoorFingerprintSearch::Outcome::Matched:
            Serial.print("[FP] Matched slot "); Serial.print(result.matchedSlot);
            Serial.print(", confidence="); Serial.print(result.confidence);
            Serial.println(". Checking backend authorization.");
            break;
        case DoorFingerprintSearch::Outcome::NoMatch:
            Serial.println("Fingerprint not recognized by standard search (0x09). Remove your finger and try again.");
            break;
        case DoorFingerprintSearch::Outcome::CommunicationError:
            Serial.println("Fingerprint search communication lost. Sensor will reinitialize; door stays locked.");
            break;
        case DoorFingerprintSearch::Outcome::InvalidMatch:
            Serial.print("[FP] Sensor returned an invalid match: slot="); Serial.print(result.matchedSlot);
            Serial.print(", confidence="); Serial.println(result.confidence);
            Serial.println("Fingerprint match was rejected. Door stays locked.");
            break;
        default:
            if (result.standardStatus == 0x17)
                Serial.println("Fingerprint search returned undefined R307S status 0x17. Door stays locked.");
            else Serial.println("Fingerprint search failed with a sensor error. Door stays locked.");
            break;
    }
    return result;
}

bool downloadStoredTemplateBase64(uint16_t slot, String &templateDataBase64, String &errorMessage)
{
    uint8_t templateBinary[DIRECT_TEMPLATE_MAX_BYTES] = {0};
    size_t templateBytes = 0;
    if (!readStoredTemplate(slot, templateBinary, sizeof(templateBinary), templateBytes, errorMessage))
    {
        return false;
    }
    return encodeFingerprintTemplateBase64(templateBinary, templateBytes, templateDataBase64, errorMessage);
}

bool encodeFingerprintTemplateBase64(const uint8_t *data, size_t length, String &templateDataBase64, String &errorMessage)
{
    templateDataBase64 = "";
    if (!DoorEnrollmentProof::validTemplate(data, length)) {
        errorMessage = "The fingerprint template is invalid or uniform. Enrollment was not completed.";
        return false;
    }
    templateDataBase64 = encodeBase64(data, length);
    return templateDataBase64.length() > 0;
}

bool readStoredTemplateHash(uint16_t slot, String &templateHash, String &errorMessage)
{
    templateHash = "";
    uint8_t binary[DIRECT_TEMPLATE_MAX_BYTES] = {};
    size_t templateBytes = 0;
    if (!readStoredTemplate(slot, binary, sizeof(binary), templateBytes, errorMessage)) return false;
    return hashFingerprintTemplate(binary, templateBytes, templateHash, errorMessage);
}

bool hashFingerprintTemplate(const uint8_t *data, size_t length, String &templateHash, String &errorMessage)
{
    templateHash = "";
    if (!DoorEnrollmentProof::validTemplate(data, length)) {
        errorMessage = "The stored fingerprint template is invalid or uniform. Door stays locked.";
        return false;
    }
    uint8_t digest[32] = {};
#if MBEDTLS_VERSION_MAJOR >= 3
    const int status = mbedtls_sha256(data, length, digest, 0);
#else
    const int status = mbedtls_sha256_ret(data, length, digest, 0);
#endif
    if (status != 0) { errorMessage = "Could not hash the sensor template. Door stays locked."; return false; }
    const char *alphabet = "0123456789abcdef";
    templateHash.reserve(64);
    for (uint8_t value : digest) {
        templateHash += alphabet[value >> 4];
        templateHash += alphabet[value & 0x0F];
    }
    return true;
}
