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

enum SensorSlotState
{
    SENSOR_SLOT_EMPTY = 0,
    SENSOR_SLOT_OCCUPIED = 1,
    SENSOR_SLOT_UNREADABLE = 2
};

extern HardwareSerial FingerSerial;
extern Adafruit_Fingerprint finger;

bool initFingerprint();
bool readSensorOccupancy(uint8_t *occupiedBits, uint16_t capacity, String &errorMessage);
uint16_t sensorSlotCapacity();
SensorSlotState probeSensorSlot(uint16_t slot, String &errorMessage);
bool deleteTemplateFromSlot(uint16_t slot, String &errorMessage);
bool storeTemplateInSlot(uint16_t slot, const uint8_t *templateBinary, size_t templateLength, String &errorMessage);
FingerprintScanStatus pollFingerprintMatch(uint16_t &matchedSlot, String &errorMessage);

#endif
