#include "SerialLog.h"
#include "Fingerprint.h"
#include "Config.h"
#include "SensorTransfer.h"
#include "DoorHardware.h"
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

    SerialLog::subsection("FINGERPRINT SENSOR (R307S)");

    if (finger.verifyPassword() && finger.getParameters() == FINGERPRINT_OK && finger.capacity > 0)
    {
        SerialLog::ok("Fingerprint sensor connected");
        SerialLog::kv("Capacity", String(finger.capacity) + " slots");
        SerialLog::kv("Packet bytes", String(finger.packet_len));
        SerialLog::kv("Security level", String(finger.security_level));
        SerialLog::kv("Device address", "0x" + String(finger.device_addr, HEX));
        const uint8_t countStatus = finger.getTemplateCount();
        if (countStatus == FINGERPRINT_OK) SerialLog::kv("Stored templates", String(finger.templateCount));
        else logFingerprintStatus("template count", countStatus);
        return true;
    }

    SerialLog::fail("Fingerprint sensor NOT found");
    SerialLog::debug(String("Check sensor wiring: ESP32 RX=GPIO") + FP_RX_PIN + " <- sensor TX, ESP32 TX=GPIO" + FP_TX_PIN
        + " -> sensor RX, baud " + FP_BAUDRATE + ", and sensor power.");
    return false;
}

void logFingerprintStatus(const char *stage, uint8_t status)
{
    SerialLog::sensorStatus(stage, status);
}

DoorFingerprintSearch::Result searchFingerprintForAccess(bool announceNoMatch)
{
    FingerprintExitAccess exitAccess(isDoorUnlocked());
    String error;
    const DoorFingerprintSearch::Result result = searchFingerprintVerified(&error);
    SerialLog::sensorStatus(result.usedMatchFallback ? "access search (1:1 fallback)" : "access search",
        result.standardStatus);
    switch (result.outcome) {
        case DoorFingerprintSearch::Outcome::Matched:
            SerialLog::ok("Sensor matched slot " + String(result.matchedSlot) + " (confidence "
                + String(result.confidence) + "). Checking backend authorization.");
            break;
        case DoorFingerprintSearch::Outcome::NoMatch:
            if (announceNoMatch)
                SerialLog::fail("Fingerprint not recognized by the sensor. Remove your finger and try again.");
            else SerialLog::step("Live search missed. Waiting for a settled recapture.");
            break;
        case DoorFingerprintSearch::Outcome::CommunicationError:
            if (error.length()) {
                SerialLog::debug(error);
            }
            if (result.standardStatus == 0xFE)
                SerialLog::fail("Fingerprint search was blocked. Door stays locked.");
            else SerialLog::fail("Fingerprint search communication lost. Sensor will reinitialize; door stays locked.");
            break;
        case DoorFingerprintSearch::Outcome::InvalidMatch:
            Serial.print("      [FP] Sensor returned an invalid match: slot="); Serial.print(result.matchedSlot);
            Serial.print(", confidence="); Serial.println(result.confidence);
            SerialLog::fail("Fingerprint match was rejected. Door stays locked.");
            break;
        default:
            if (result.standardStatus == 0x17)
                Serial.println("Fingerprint search returned R307S status 0x17 after page-window Search. Hold the finger still and try again.");
            else Serial.println("Fingerprint search failed with a sensor error. Door stays locked.");
            break;
    }
    return result;
}

DoorFingerprintSearch::Result identifySettledFingerprintForAccess(bool &fingerLifted)
{
    constexpr uint32_t settleMs = 350;
    fingerLifted = false;
    delay(settleMs);
    DoorFingerprintSearch::Result result;
    result.outcome = DoorFingerprintSearch::Outcome::NoMatch;
    result.standardStatus = DoorFingerprintSearch::NOT_FOUND;
    const uint8_t image = finger.getImage();
    if (image == FINGERPRINT_NOFINGER) { fingerLifted = true; return result; }
    if (DoorFingerprintSearch::communicationError(image)) {
        logFingerprintStatus("settled image", image);
        return DoorFingerprintSearch::protocolFailure();
    }
    if (image != FINGERPRINT_OK) {
        logFingerprintStatus("settled image", image);
        result.outcome = DoorFingerprintSearch::Outcome::SensorError;
        result.standardStatus = image;
        SerialLog::fail("Fingerprint could not be read. Remove your finger and try again.");
        return result;
    }
    const uint8_t converted = finger.image2Tz(1);
    if (DoorFingerprintSearch::communicationError(converted)) {
        logFingerprintStatus("image conversion", converted);
        return DoorFingerprintSearch::protocolFailure();
    }
    if (converted != FINGERPRINT_OK) {
        logFingerprintStatus("image conversion", converted);
        result.outcome = DoorFingerprintSearch::Outcome::SensorError;
        result.standardStatus = converted;
        SerialLog::fail("Fingerprint features were unclear. Remove your finger and rescan.");
        return result;
    }
    return searchFingerprintForAccess(true);
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

bool readStoredTemplateHash(uint16_t slot, String &templateHash, String &errorMessage, bool allowWhileUnlocked)
{
    templateHash = "";
    uint8_t binary[DIRECT_TEMPLATE_MAX_BYTES] = {};
    size_t templateBytes = 0;
    if (!readStoredTemplate(slot, binary, sizeof(binary), templateBytes, errorMessage, allowWhileUnlocked)) return false;
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
