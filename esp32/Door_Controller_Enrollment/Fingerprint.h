#ifndef FINGERPRINT_H
#define FINGERPRINT_H

#include <Arduino.h>
#include <Adafruit_Fingerprint.h>
#include "FingerprintSearch.h"

extern HardwareSerial FingerSerial;
extern Adafruit_Fingerprint finger;

bool initFingerprint();
void logFingerprintStatus(const char *stage, uint8_t status);
DoorFingerprintSearch::Result searchFingerprintForAccess(bool announceNoMatch = true);
DoorFingerprintSearch::Result identifySettledFingerprintForAccess(bool &fingerLifted);
bool downloadStoredTemplateBase64(uint16_t slot, String &templateDataBase64, String &errorMessage);
bool encodeFingerprintTemplateBase64(const uint8_t *data, size_t length, String &templateDataBase64, String &errorMessage);
bool readStoredTemplateHash(uint16_t slot, String &templateHash, String &errorMessage, bool allowWhileUnlocked = false);
bool hashFingerprintTemplate(const uint8_t *data, size_t length, String &templateHash, String &errorMessage);

#endif
