#ifndef DIRECT_SENSOR_TRANSFER_H
#define DIRECT_SENSOR_TRANSFER_H

#include <Arduino.h>
#include "TemplateStream.h"
#include "FingerprintSearch.h"

constexpr size_t DIRECT_TEMPLATE_MAX_BYTES = R307TemplateStream::MAX_TEMPLATE_BYTES;

uint8_t getFingerprintImageVerified();
uint8_t convertFingerprintImageVerified(uint8_t buffer);
uint8_t generateFingerprintModelVerified(String &errorMessage);
uint8_t storeFingerprintModelVerified(uint16_t slot, uint8_t buffer, String &errorMessage);
DoorFingerprintSearch::Result searchFingerprintVerified(String *errorMessage = nullptr);
bool readStoredTemplate(uint16_t slot, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage);
// Read-only inspection includes slot zero; enrollment/import retain their existing guards.
bool readSensorMemoryTemplate(uint16_t slot, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage);
bool readCurrentTemplateFromBuffer(uint8_t buffer, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage);
bool readCurrentTemplate(uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage);
bool restoreCurrentTemplate(const uint8_t *data, size_t length, String &errorMessage);
bool readSensorSlotIndexPage(uint8_t page, uint8_t *index, size_t indexBytes, String &errorMessage);
bool isSensorSlotOccupied(uint16_t slot, bool &occupied, String &errorMessage);
bool writeImportedTemplate(uint16_t slot, const uint8_t *data, size_t length, String &errorMessage);

#endif
