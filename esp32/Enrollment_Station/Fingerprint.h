#ifndef FINGERPRINT_H
#define FINGERPRINT_H

#include <Arduino.h>
#include <Adafruit_Fingerprint.h>

extern HardwareSerial FingerSerial;
extern Adafruit_Fingerprint finger;

bool initFingerprint();
bool downloadStoredTemplateBase64(uint16_t slot, String &templateDataBase64, String &errorMessage);

#endif
