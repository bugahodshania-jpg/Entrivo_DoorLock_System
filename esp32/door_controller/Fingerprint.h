#ifndef FINGERPRINT_H
#define FINGERPRINT_H

#include <Arduino.h>
#include <Adafruit_Fingerprint.h>

enum FingerprintScanStatus
{
    FINGERPRINT_SCAN_IDLE = 0,
    FINGERPRINT_SCAN_MATCHED = 1,
    FINGERPRINT_SCAN_NO_MATCH = 2,
    FINGERPRINT_SCAN_ERROR = 3
};

extern HardwareSerial FingerSerial;
extern Adafruit_Fingerprint finger;

bool initFingerprint();
bool storeTemplateInSlot(uint16_t slot, const uint8_t *templateBinary, size_t templateLength, String &errorMessage);
FingerprintScanStatus pollFingerprintMatch(uint16_t &matchedSlot, String &errorMessage);

#endif
