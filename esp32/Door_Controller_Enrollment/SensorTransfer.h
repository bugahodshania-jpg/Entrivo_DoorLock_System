#ifndef DIRECT_SENSOR_TRANSFER_H
#define DIRECT_SENSOR_TRANSFER_H

#include <Arduino.h>
#include "TemplateStream.h"
#include "FingerprintSearch.h"

constexpr size_t DIRECT_TEMPLATE_MAX_BYTES = R307TemplateStream::MAX_TEMPLATE_BYTES;

// Faculty/staff exit must search and hash a template while the solenoid is still unlocked.
class FingerprintExitAccess {
public:
    explicit FingerprintExitAccess(bool enable);
    ~FingerprintExitAccess();
    FingerprintExitAccess(const FingerprintExitAccess &) = delete;
    FingerprintExitAccess &operator=(const FingerprintExitAccess &) = delete;
private:
    bool enabled;
};

uint8_t getFingerprintImageVerified();
uint8_t convertFingerprintImageVerified(uint8_t buffer);
uint8_t generateFingerprintModelVerified(String &errorMessage);
uint8_t storeFingerprintModelVerified(uint16_t slot, uint8_t buffer, String &errorMessage);
bool deleteStoredFingerprint(uint16_t slot, String &errorMessage);
bool emptyFingerprintLibrary(String &errorMessage);
DoorFingerprintSearch::Result searchFingerprintVerified(String *errorMessage = nullptr);
DoorFingerprintSearch::Result matchStoredFingerprintSlot(uint16_t slot, String *errorMessage = nullptr);
DoorFingerprintSearch::Result searchFingerprintWindowVerified(uint16_t start, uint16_t count, String *errorMessage = nullptr);
bool readStoredTemplate(uint16_t slot, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage, bool allowWhileUnlocked = false);
// Read-only inspection includes slot zero; enrollment/import retain their existing guards.
bool readSensorMemoryTemplate(uint16_t slot, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage);
bool readCurrentTemplateFromBuffer(uint8_t buffer, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage);
bool readCurrentTemplate(uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage);
bool restoreCurrentTemplate(const uint8_t *data, size_t length, String &errorMessage);
bool readSensorSlotIndexPage(uint8_t page, uint8_t *index, size_t indexBytes, String &errorMessage);
bool isSensorSlotOccupied(uint16_t slot, bool &occupied, String &errorMessage);
bool writeImportedTemplate(uint16_t slot, const uint8_t *data, size_t length, String &errorMessage);

#endif
