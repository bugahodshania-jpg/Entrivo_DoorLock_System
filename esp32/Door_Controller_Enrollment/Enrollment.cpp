// Enrollment workflow implementation.

#include "Enrollment.h"

#include "API.h"
#include "Fingerprint.h"
#include "SensorTransfer.h"
#include "EnrollmentProof.h"
#include "SerialLog.h"
#include <memory>
#include <new>

namespace
{
    constexpr uint32_t FINGER_CAPTURE_TIMEOUT_MS = 30000;
    constexpr uint32_t FINGER_REMOVAL_TIMEOUT_MS = 30000;
    constexpr uint32_t FINGER_VERIFY_REMOVAL_TIMEOUT_MS = 45000;
    constexpr uint32_t FINGER_SETTLE_MS = 350;
    constexpr uint8_t FINGER_MATCH_ATTEMPTS = 3;

    bool updateProgress(const EnrollmentJob &job, int progress, const String &step, String &errorMessage)
    {
        if (job.jobId <= 0) return true;
        return reportEnrollmentProgress(job.jobId, progress, step, &errorMessage);
    }

    // Sub-steps inside the final scan are advisory telemetry. A dropped progress
    // POST must never discard a scan the sensor already captured successfully,
    // so the failure is logged and the workflow continues.
    void noteProgress(const EnrollmentJob &job, int progress, const String &step)
    {
        String failure;
        if (!reportEnrollmentProgress(job.jobId, progress, step, &failure))
            Serial.println("  [ENROLL] " + failure);
    }

    String getImageErrorMessage(uint8_t code)
    {
        switch (code)
        {
            case FINGERPRINT_IMAGEMESS:
                return "Fingerprint image was too messy.";
            case FINGERPRINT_PACKETRECIEVEERR:
            case 0xFE:
            case 0xFF:
                return "Communication error while reading the fingerprint image.";
            case FINGERPRINT_IMAGEFAIL:
                return "Could not capture a fingerprint image.";
            default:
                return "Unknown fingerprint image error.";
        }
    }

    String getTemplateErrorMessage(uint8_t code)
    {
        switch (code)
        {
            case FINGERPRINT_IMAGEMESS:
                return "Fingerprint image was too messy to convert.";
            case FINGERPRINT_PACKETRECIEVEERR:
            case 0xFE:
            case 0xFF:
                return "Communication error while converting the fingerprint image.";
            case FINGERPRINT_FEATUREFAIL:
            case FINGERPRINT_INVALIDIMAGE:
                return "Fingerprint features could not be extracted.";
            default:
                return "Unknown fingerprint template error.";
        }
    }

    bool weakFingerprintImage(uint8_t status)
    {
        return status == FINGERPRINT_IMAGEMESS || status == FINGERPRINT_IMAGEFAIL;
    }

    bool weakFingerprintTemplate(uint8_t status)
    {
        return status == FINGERPRINT_IMAGEMESS || status == FINGERPRINT_FEATUREFAIL || status == FINGERPRINT_INVALIDIMAGE;
    }

    // Progress map (monotone, so the dashboard modal never jumps backwards):
    //   10 scan 1 -> 35 remove -> 60 scan 2 -> 72/80/82 RegModel+Store -> 85 stored
    //   86 remove before verification -> 88 place for verification (3rd scan)
    //   90 verifying -> 92 verified -> 93 reading template -> 95 waiting for download
    constexpr int PROGRESS_VERIFY_REMOVE = 86;
    constexpr int PROGRESS_VERIFY_PLACE = 88;
    constexpr int PROGRESS_VERIFY_MATCHING = 90;
    constexpr int PROGRESS_VERIFY_PASSED = 92;
    constexpr int PROGRESS_READ_TEMPLATE = 93;
    constexpr uint8_t VERIFY_SCAN_ATTEMPTS = 5;

    String scanLabelText(uint8_t imageBuffer, const char *labelOverride = nullptr)
    {
        if (labelOverride != nullptr) return String(labelOverride);
        return imageBuffer == 1 ? String("first scan") : String("second scan");
    }

    // Adafruit-style capture (enroll.ino getFingerprintEnroll): getImage until a
    // finger is present, then image2Tz(buffer). Keep the same step open until
    // image/template quality is usable.
    bool waitForFingerPlacement(uint8_t imageBuffer, String &errorMessage, const EnrollmentJob &job, int progress,
        const char *labelOverride = nullptr)
    {
        auto scanLabel = [&](uint8_t buffer) { return scanLabelText(buffer, labelOverride); };
        const unsigned long startedAt = millis();
        bool sawWeakContact = false;
        String lastQualityHint;
        auto reportQuality = [&](const String &hint) {
            sawWeakContact = true;
            if (hint == lastQualityHint) return;
            lastQualityHint = hint;
            if (job.jobId > 0) {
                reportEnrollmentProgress(job.jobId, progress, hint);
            }
        };

        while (millis() - startedAt < FINGER_CAPTURE_TIMEOUT_MS)
        {
            const uint8_t imageStatus = getFingerprintImageVerified();

            if (imageStatus == FINGERPRINT_NOFINGER)
            {
                delay(80);
                continue;
            }

            if (imageStatus != FINGERPRINT_OK)
            {
                if (weakFingerprintImage(imageStatus))
                {
                    reportQuality(String("Low quality on ") + scanLabel(imageBuffer)
                        + ". Reposition the finger flat and centered, then hold still.");
                    delay(120);
                    continue;
                }
                SerialLog::sensorStatus("getImage", imageStatus);
                errorMessage = getImageErrorMessage(imageStatus);
                return false;
            }

            // The first frame is often the edge of a finger that is still
            // settling. Wait, then read the image that will be converted.
            delay(FINGER_SETTLE_MS);
            const uint8_t settledStatus = getFingerprintImageVerified();
            if (settledStatus == FINGERPRINT_NOFINGER)
            {
                reportQuality(String("Finger moved during ") + scanLabel(imageBuffer)
                    + ". Place it again and hold still until the scan completes.");
                delay(80);
                continue;
            }
            if (settledStatus != FINGERPRINT_OK)
            {
                if (weakFingerprintImage(settledStatus))
                {
                    reportQuality(String("Image quality too low for ") + scanLabel(imageBuffer)
                        + ". Cover more of the sensor with the finger pad and retry.");
                    delay(120);
                    continue;
                }
                SerialLog::sensorStatus("getImage (settled)", settledStatus);
                errorMessage = getImageErrorMessage(settledStatus);
                return false;
            }

            const uint8_t templateStatus = convertFingerprintImageVerified(imageBuffer);
            if (templateStatus == FINGERPRINT_OK) {
                if (job.jobId > 0) {
                    reportEnrollmentProgress(job.jobId, progress,
                        String("Good quality on ") + scanLabel(imageBuffer) + ". Continuing.");
                }
                return true;
            }
            if (weakFingerprintTemplate(templateStatus))
            {
                reportQuality(String("Could not extract features for ") + scanLabel(imageBuffer)
                    + ". Lift, clean the sensor if needed, then place the finger flat again.");
                delay(200);
                continue;
            }

            SerialLog::sensorStatus("image2Tz", templateStatus);
                errorMessage = getTemplateErrorMessage(templateStatus);
            return false;
        }

        errorMessage = sawWeakContact
            ? String("Timed out on ") + scanLabel(imageBuffer)
                + ". Hold the center of the finger flat and still, then start enrollment again."
            : String("Timed out waiting for finger placement on ") + scanLabel(imageBuffer) + ".";
        return false;
    }

    constexpr uint16_t FAST_SEARCH_WINDOW = 163; // Adafruit fingerFastSearch() page count (0x00A3).

    // This R307S treats CharBuffer1 as consumed after one Search/Match: every
    // later Search in the same capture returns 0x17. The image buffer is not
    // touched by Search, so image2Tz(1) on the SAME image rebuilds CharBuffer1
    // without asking the user to press again.
    bool regenerateBuffer1FromImage(const char *why)
    {
        const uint8_t status = convertFingerprintImageVerified(1);
        SerialLog::sensorStatus((String("image2Tz(1) rebuild, ") + why).c_str(), status);
        return status == FINGERPRINT_OK;
    }

    // Whole-library duplicate search for scan 1: fingerFastSearch per 163-page
    // window, but ONLY windows the sensor's index table marks as holding
    // templates (an empty sensor needs no search at all). CharBuffer1 is
    // reloaded with the saved original scan before every window after the
    // first; firstScanIsNotDuplicate puts the original back before RegModel.
    //
    // Only 0x09 means "this window has no copy". On this R307S HiSpeedSearch
    // returned 0x17 for window 163-325 even with a fresh buffer and an empty
    // library, so a 0x17 is re-checked with standard Search (0x04); if that
    // also fails, the check is reported as incomplete, never as clear.
    // Occupied-slot bitmap read from the sensor's own index table (ReadIndexTable
    // 0x1F, 32 bytes per 256 slots). Used so the duplicate check only searches
    // windows that actually hold templates.
    struct OccupiedIndex {
        uint8_t bits[128] = {};
        bool valid = false;
        uint16_t count = 0;
    };

    OccupiedIndex readOccupiedIndex()
    {
        OccupiedIndex index;
        const uint16_t pages = (finger.capacity + 255U) / 256U;
        if (finger.capacity == 0 || pages * 32U > sizeof(index.bits)) return index;
        for (uint16_t page = 0; page < pages; ++page) {
            String pageError;
            if (!readSensorSlotIndexPage(static_cast<uint8_t>(page), index.bits + page * 32U, 32, pageError)) {
                Serial.print("  [ENROLL] Could not read the sensor slot index (page "); Serial.print(page);
                Serial.print("): "); Serial.println(pageError);
                return index;
            }
        }
        for (uint16_t slot = 0; slot < finger.capacity; ++slot)
            if (index.bits[slot / 8] & (1U << (slot % 8))) ++index.count;
        index.valid = true;
        return index;
    }

    bool windowHasTemplates(const OccupiedIndex &index, uint16_t start, uint16_t count)
    {
        if (!index.valid) return true; // Unknown: search it.
        for (uint32_t slot = start; slot < static_cast<uint32_t>(start) + count && slot < finger.capacity; ++slot)
            if (index.bits[slot / 8] & (1U << (slot % 8))) return true;
        return false;
    }

    // Give CharBuffer1 a valid copy of scan 1 for the next search. Prefer the
    // saved ORIGINAL feature file (DownChar, verified); fall back to a
    // rebuild from the image. Either copy is only searched, never stored.
    bool refreshScanForSearch(const uint8_t *original, size_t originalLength, const char *why)
    {
        if (original != nullptr) {
            String restoreError;
            if (restoreCurrentTemplate(original, originalLength, restoreError)) {
                Serial.print("  [ENROLL] Original scan 1 reloaded for "); Serial.println(why);
                return true;
            }
            Serial.print("  [ENROLL] Could not reload the original scan 1 ("); Serial.print(restoreError);
            Serial.println("). Rebuilding from the image instead.");
        }
        return regenerateBuffer1FromImage(why);
    }

    DoorFingerprintSearch::Result searchLibraryFromCurrentImage(String &error, const uint8_t *original, size_t originalLength)
    {
        DoorFingerprintSearch::Result result;
        result.outcome = DoorFingerprintSearch::Outcome::NoMatch;
        result.standardStatus = DoorFingerprintSearch::NOT_FOUND;

        const OccupiedIndex index = readOccupiedIndex();
        if (index.valid) {
            Serial.print("  [ENROLL] Sensor slot index: "); Serial.print(index.count);
            Serial.println(" stored template(s).");
            if (index.count == 0) {
                Serial.println("  [ENROLL] Sensor A has no stored fingerprints. Nothing to compare; no duplicate possible.");
                return result;
            }
        }

        bool bufferUsed = false; // CharBuffer1 must be refreshed after any Search.
        for (uint16_t start = 0; start < finger.capacity; start += FAST_SEARCH_WINDOW) {
            const uint16_t end = min<uint32_t>(static_cast<uint32_t>(start) + FAST_SEARCH_WINDOW, finger.capacity) - 1;
            if (!windowHasTemplates(index, start, FAST_SEARCH_WINDOW)) continue; // Empty window: nothing to match.
            if (bufferUsed && !refreshScanForSearch(original, originalLength, "next search window")) {
                error = "Sensor A could not reload the scan for the next search window.";
                return DoorFingerprintSearch::protocolFailure();
            }
            DoorFingerprintSearch::Result window = searchFingerprintWindowVerified(start, FAST_SEARCH_WINDOW, &error);
            bufferUsed = true;
            if (window.outcome == DoorFingerprintSearch::Outcome::SensorError) {
                // 0x17 from HiSpeedSearch: check this window with the standard
                // Search (0x04) on a freshly reloaded scan before giving up.
                Serial.print("  [ENROLL] Duplicate check slots "); Serial.print(start); Serial.print("-"); Serial.print(end);
                Serial.print(" returned "); Serial.print(SerialLog::hex(window.standardStatus));
                Serial.println(". Checking this window with standard Search (0x04).");
                if (!refreshScanForSearch(original, originalLength, "standard search retry")) {
                    error = "Sensor A could not reload the scan to retry the duplicate check.";
                    return DoorFingerprintSearch::protocolFailure();
                }
                window = searchFingerprintWindowStandard(start, FAST_SEARCH_WINDOW, &error);
                logFingerprintStatus("duplicate check standard search", window.standardStatus);
            }
            if (window.outcome == DoorFingerprintSearch::Outcome::NoMatch) continue; // 0x09: window clear.
            if (window.outcome == DoorFingerprintSearch::Outcome::SensorError && error.length() == 0) {
                error = "Sensor returned status " + SerialLog::hex(window.standardStatus) + " while checking slots "
                    + String(start) + "-" + String(end) + ", which hold stored fingerprints.";
            }
            return window; // Matched, InvalidMatch, CommunicationError, or an unchecked window.
        }
        return result;
    }

    // Unsuccessful enrollments must not leave an orphan template in the reserved slot.
    bool rollbackEnrollmentSlot(uint16_t slot, const char *reason)
    {
        if (slot == 0 || slot > UINT16_MAX) return true;
        String eraseError;
        bool occupied = false;
        if (!isSensorSlotOccupied(slot, occupied, eraseError)) {
            Serial.print("  [ENROLL] Rollback could not inspect slot ");
            Serial.print(slot);
            Serial.print(": ");
            Serial.println(eraseError);
            return false;
        }
        if (!occupied) {
            Serial.print("  [ENROLL] Rollback: slot ");
            Serial.print(slot);
            Serial.println(" already empty.");
            return true;
        }
        Serial.print("  [ENROLL] Rolling back sensor slot ");
        Serial.print(slot);
        Serial.print(" (");
        Serial.print(reason);
        Serial.println(").");
        if (!deleteStoredFingerprint(slot, eraseError)) {
            Serial.print("  [ENROLL] Rollback delete failed: ");
            Serial.println(eraseError);
            return false;
        }
        occupied = false;
        if (isSensorSlotOccupied(slot, occupied, eraseError) && occupied) {
            Serial.println("  [ENROLL] Rollback delete reported success but the slot is still occupied.");
            return false;
        }
        return true;
    }

    bool waitForFingerRemoval(String &errorMessage, uint32_t timeoutMs = FINGER_REMOVAL_TIMEOUT_MS)
    {
        const unsigned long startedAt = millis();
        unsigned long clearSince = 0;
        bool clearing = false;

        while (millis() - startedAt < timeoutMs)
        {
            const uint8_t imageStatus = getFingerprintImageVerified();

            if (imageStatus == FINGERPRINT_NOFINGER)
            {
                if (!clearing) { clearing = true; clearSince = millis(); }
                else if (millis() - clearSince >= 400) return true;
            }
            else if (imageStatus != FINGERPRINT_OK)
            {
                SerialLog::sensorStatus("getImage", imageStatus);
                errorMessage = getImageErrorMessage(imageStatus);
                return false;
            }
            else clearing = false;

            delay(100);
        }

        errorMessage = "Sensor A did not confirm finger removal. Lift fully clear of the glass; if it is already clear, clean the sensor and retry.";
        return false;
    }

struct EnrollmentOperations {
        EnrollmentJob &job;
        String &error;

        bool emptySlot() {
            bool occupied = false;
            if (!isSensorSlotOccupied(job.assignedSlot, occupied, error)) return false;
            if (occupied) error = "The reserved sensor slot is occupied. Existing fingerprints were preserved.";
            return !occupied;
        }

        // Duplicate check on the first scan (Adafruit fingerprint.ino:
        // image2Tz(1) -> fingerFastSearch). Without this, a finger already
        // stored in another slot (for example an orphan template left by an
        // earlier failed enrollment) is stored a second time and the third
        // verification scan then identifies the old slot instead of the new one.
        //
        // The library search needs CharBuffer1 rebuilt from the same image
        // before every 163-page window (up to 7 times on a 1000-slot sensor).
        // Those repeated conversions must NOT become the scan-1 half of the
        // model: on these modules GenChar can alter the image buffer, so each
        // rebuild is a weaker copy, RegModel still accepts it, and the stored
        // template then fails the third scan (0x09). So the feature file from
        // the ONE original image2Tz(1) is uploaded to ESP32 RAM first and
        // written back (byte-for-byte verified) after the search. If that is
        // not possible, a fresh first scan is taken instead; a rebuilt buffer
        // is never used for RegModel.
        bool firstScanIsNotDuplicate() {
            if (!updateProgress(job, 30, "First scan captured. Checking Sensor A for an existing copy of this finger", error))
                return false;

            std::unique_ptr<uint8_t[]> original(new (std::nothrow) uint8_t[DIRECT_TEMPLATE_MAX_BYTES]);
            size_t originalLength = 0;
            String backupError;
            const bool haveOriginal = original
                && readCurrentTemplateFromBuffer(1, original.get(), DIRECT_TEMPLATE_MAX_BYTES, originalLength, backupError)
                && DoorEnrollmentProof::validTemplate(original.get(), originalLength);
            if (haveOriginal) {
                Serial.print("  [ENROLL] Saved the original scan 1 features ("); Serial.print(originalLength);
                Serial.println(" bytes) before the duplicate check.");
            } else {
                Serial.print("  [ENROLL] Could not save the original scan 1 features");
                if (backupError.length()) { Serial.print(": "); Serial.print(backupError); }
                Serial.println(". A fresh first scan will be taken after the duplicate check.");
            }

            String searchError;
            const DoorFingerprintSearch::Result match = searchLibraryFromCurrentImage(searchError,
                haveOriginal ? original.get() : nullptr, originalLength);
            logFingerprintStatus("enrollment duplicate check", match.standardStatus);
            if (match.outcome == DoorFingerprintSearch::Outcome::Matched) {
                if (job.previousSlot > 0 && match.matchedSlot == static_cast<uint16_t>(job.previousSlot)) {
                    Serial.print("  [ENROLL] First scan matches this fingerprint's previous slot ");
                    Serial.print(job.previousSlot);
                    Serial.println(" (update). Continuing.");
                } else {
                    Serial.print("  [ENROLL] Duplicate: first scan already matches slot ");
                    Serial.print(match.matchedSlot); Serial.print(", confidence="); Serial.println(match.confidence);
                    error = "This finger is already stored on Sensor A at slot " + String(match.matchedSlot)
                        + " (confidence " + String(match.confidence) + "). Enrollment stopped before anything was saved. "
                        "Delete slot " + String(match.matchedSlot) + " in Sensor Memory (or update the fingerprint that uses it), then enroll again.";
                    return false;
                }
            } else if (match.outcome != DoorFingerprintSearch::Outcome::NoMatch) {
                // Communication error, invalid match, or a window that returned
                // 0x17 twice: the library was not fully checked, so do not
                // continue as if it were clear.
                error = "Sensor A could not finish checking for an existing copy of this finger. Nothing was saved. Start enrollment again. " + searchError;
                return false;
            }

            // The search consumed CharBuffer1. Put back the original scan-1
            // conversion so RegModel combines the real first scan with scan 2.
            if (haveOriginal) {
                String restoreError;
                if (restoreCurrentTemplate(original.get(), originalLength, restoreError)) {
                    Serial.println("  [ENROLL] Restored the original scan 1 features into Buffer 1 (verified byte-for-byte).");
                    return true;
                }
                Serial.print("  [ENROLL] Could not restore the original scan 1 features: ");
                Serial.println(restoreError);
            }
            Serial.println("  [ENROLL] Taking a fresh first scan so the model uses one clean conversion.");
            return updateProgress(job, 10, "Keep the same finger on the sensor for a fresh first scan", error)
                && waitForFingerPlacement(1, error, job, 10);
        }

        bool capturePair() {
            // Adafruit enroll.ino two-scan flow: getImage -> image2Tz(1),
            // remove finger, getImage -> image2Tz(2), then createModel ->
            // storeModel. The only extra step is a read-only duplicate search on
            // Buffer 1 before the second scan.
            SerialLog::subsection("STEP 1/4  FIRST SCAN");
            if (!updateProgress(job, 10, "Place finger for first scan", error) ||
                !waitForFingerPlacement(1, error, job, 10)) return false;
            if (!firstScanIsNotDuplicate()) return false;
            SerialLog::ok("First scan accepted (no duplicate on Sensor A).");
            if (!updateProgress(job, 35, "First scan captured. Remove finger", error) ||
                !waitForFingerRemoval(error)) return false;
            SerialLog::subsection("STEP 2/4  SECOND SCAN");
            if (!updateProgress(job, 60, "Place the same finger for second scan", error) ||
                !waitForFingerPlacement(2, error, job, 60)) return false;
            return updateProgress(job, 72, "Second scan accepted. Building fingerprint model", error);
        }

        bool beforeGeneration() {
            SerialLog::subsection("STEP 3/4  CREATE MODEL + STORE");
            return updateProgress(job, 80, "Creating model for slot " + String(job.assignedSlot), error);
        }

        bool generate() {
            for (uint8_t attempt = 0; attempt < FINGER_MATCH_ATTEMPTS; ++attempt) {
                const uint8_t status = generateFingerprintModelVerified(error);
                SerialLog::sensorStatus("RegModel (combine scan 1 + scan 2)", status);
                if (status == FINGERPRINT_OK) {
                    return updateProgress(job, 82, "Model created. Storing on Sensor A slot "
                        + String(job.assignedSlot), error);
                }
                if (status != FINGERPRINT_ENROLLMISMATCH || attempt + 1 == FINGER_MATCH_ATTEMPTS) {
                    if (status == FINGERPRINT_ENROLLMISMATCH)
                        error = "The two scans did not match. Start enrollment again and keep the same finger flat for both scans.";
                    return false;
                }
                // Buffer 1 stays. Only the second press is captured again.
                // The successful RegModel still runs immediately before Store.
                Serial.println("  [ENROLL] The two scans differed. Place the same finger flat for the second scan again.");
                if (!updateProgress(job, 60, "Scans differed. Remove finger", error) ||
                    !waitForFingerRemoval(error) ||
                    !updateProgress(job, 60, "Place the same finger flat again for second scan", error) ||
                    !waitForFingerPlacement(2, error, job, 60)) return false;
            }
            return false;
        }

        bool storeNative() {
            // Follow the R307S native enrollment flow: RegModel -> Store(buffer1).
            // No UpChar, DownChar, index query, HTTP, or other sensor operation
            // occurs between these two checked commands. After Store many R307
            // modules clear buffer 1, so a 1:1 Match here is not a valid check.
            const uint8_t status = storeFingerprintModelVerified(job.assignedSlot, 1, error);
            if (status == FINGERPRINT_OK) {
                SerialLog::ok("Model stored on Sensor A slot " + String(job.assignedSlot) + ".");
                return true;
            }
            SerialLog::sensorStatus("Store", status);
            error = "Sensor A did not store the fingerprint in slot " + String(job.assignedSlot)
                + ". Enrollment must be started again. " + error;
            rollbackEnrollmentSlot(static_cast<uint16_t>(job.assignedSlot), "failed Store");
            return false;
        }

        bool markStored() {
            reportEnrollmentStored(job, "Stored at slot " + String(job.assignedSlot));
            return true;
        }

        bool confirmRecovery() {
            String searchError;
            const DoorFingerprintSearch::Result match = searchFingerprintVerified(&searchError);
            logFingerprintStatus("native occupied-slot recovery search", match.standardStatus);
            if (match.outcome == DoorFingerprintSearch::Outcome::Matched &&
                match.matchedSlot == job.assignedSlot) return true;
            error = "The two fresh recovery scans did not identify reserved sensor slot " +
                String(job.assignedSlot) + ". Existing sensor data was preserved. " + searchError;
            return false;
        }

    };

    bool acceptStoredTemplate(EnrollmentJob &job, const uint8_t *data, size_t length,
        String &templateDataBase64, String &errorMessage)
    {
        templateDataBase64 = "";
        String hash;
        if (!job.verification.storageConfirmed || job.verification.storedSlot != job.assignedSlot
            || !DoorEnrollmentProof::validTemplate(data, length)
            || !encodeFingerprintTemplateBase64(data, length, templateDataBase64, errorMessage)
            || !hashFingerprintTemplate(data, length, hash, errorMessage) || hash.length() != 64) {
            templateDataBase64 = "";
            return false;
        }
        // Do not overwrite matchedSlot or confidence: a real third scan already
        // established which slot the sensor identified and at what score.
        job.verification.templateBytes = length;
        hash.toCharArray(job.verification.templateSha256, sizeof(job.verification.templateSha256));
        noteProgress(job, 95, "Stored at slot " + String(job.assignedSlot) + ". Waiting for download.");
        return true;
    }

    // Result of comparing a fresh capture in CharBuffer1 with one stored slot.
    struct SlotCheck {
        enum class Kind { Verified, WrongSlot, NoMatch, SensorFault };
        Kind kind = Kind::NoMatch;
        DoorFingerprintSearch::Result match;
        String error;
        uint8_t fastStatus = 0xFF;       // HiSpeedSearch (0x1B) status, for the attempt log.
        bool usedStandardSearch = false; // Standard Search (0x04) fallback ran.
    };

    // Adafruit fingerprint.ino check of a fresh scan: image2Tz(1) was just
    // done, now run ONE fingerFastSearch over the page window that holds the
    // expected slot. No 1:1 Match first: it consumes CharBuffer1, which made
    // every following search fail (0x09/0x17) even for the correct finger.
    //
    // If HiSpeedSearch misses (0x09) or reports an unchecked buffer (0x17),
    // CharBuffer1 is rebuilt from the SAME verification image (no new press,
    // and this rebuilt file is only compared, never stored) and the standard
    // Search (0x04) runs over the same window. The rules are unchanged: only
    // the exact expected slot verifies; any other slot is a wrong finger.
    // toleratedSlot (an update's previous slot) holds the same finger, so a hit
    // there means "scan again", never a wrong finger.
    SlotCheck checkFreshScanAgainstSlot(uint16_t expectedSlot, int toleratedSlot)
    {
        SlotCheck check;
        const uint16_t windowStart = (expectedSlot / FAST_SEARCH_WINDOW) * FAST_SEARCH_WINDOW;
        Serial.print("  [ENROLL] fingerFastSearch of the fresh scan, window start="); Serial.print(windowStart);
        Serial.print(", expected slot "); Serial.println(expectedSlot);
        String searchError;
        check.match = searchFingerprintWindowVerified(windowStart, FAST_SEARCH_WINDOW, &searchError);
        check.error = searchError;
        check.fastStatus = check.match.standardStatus;
        logFingerprintStatus("verification fast search", check.match.standardStatus);
        if (check.match.outcome == DoorFingerprintSearch::Outcome::NoMatch ||
            check.match.outcome == DoorFingerprintSearch::Outcome::SensorError) {
            Serial.println("  [ENROLL] HiSpeedSearch did not identify the scan. Rebuilding the same verification image "
                "and running standard Search (0x04) over the same window.");
            if (regenerateBuffer1FromImage("verification standard search")) {
                String standardError;
                const DoorFingerprintSearch::Result standard =
                    searchFingerprintWindowStandard(windowStart, FAST_SEARCH_WINDOW, &standardError);
                logFingerprintStatus("verification standard search", standard.standardStatus);
                check.usedStandardSearch = true;
                check.match = standard;
                check.error = standardError;
            } else {
                Serial.println("  [ENROLL] Could not rebuild the verification image; keeping the HiSpeedSearch result.");
            }
        }
        if (check.match.outcome == DoorFingerprintSearch::Outcome::Matched) {
            if (check.match.matchedSlot == expectedSlot) check.kind = SlotCheck::Kind::Verified;
            else if (toleratedSlot > 0 && check.match.matchedSlot == static_cast<uint16_t>(toleratedSlot)) {
                Serial.print("  [ENROLL] Search found the previous slot "); Serial.print(toleratedSlot);
                Serial.println(" of this same fingerprint. Asking for another verification scan.");
                check.kind = SlotCheck::Kind::NoMatch;
            } else check.kind = SlotCheck::Kind::WrongSlot;
            return check;
        }
        check.kind = check.match.outcome == DoorFingerprintSearch::Outcome::CommunicationError
            ? SlotCheck::Kind::SensorFault : SlotCheck::Kind::NoMatch;
        return check;
    }

    // Third scan: independent verification after Store. The user lifts the
    // finger, places the SAME finger again, and the fresh capture must identify
    // exactly the slot that was just stored. A different finger (match on any
    // other slot) rolls back only the new slot. A miss is retried up to
    // VERIFY_SCAN_ATTEMPTS times before the new slot is rolled back.
    bool verifyEnrolledFingerprint(EnrollmentJob &job, String &errorMessage)
    {
        errorMessage = "";
        const uint16_t slot = static_cast<uint16_t>(job.assignedSlot);
        const int toleratedSlot = (job.previousSlot > 0 && job.previousSlot != job.assignedSlot) ? job.previousSlot : 0;
        SerialLog::subsection("STEP 4/4  VERIFICATION SCAN (3rd scan)");
        SerialLog::kv("Expected slot", String(slot));
        if (toleratedSlot > 0) SerialLog::kv("Previous slot", String(toleratedSlot) + " (same finger, update)");
        String attemptLog[VERIFY_SCAN_ATTEMPTS];

        // Give the module a moment to finish the flash write from Store
        // before the first LoadChar of that page.
        delay(200);

        SlotCheck last;
        for (uint8_t attempt = 1; attempt <= VERIFY_SCAN_ATTEMPTS; ++attempt)
        {
            const String attemptText = " (attempt " + String(attempt) + "/" + String(VERIFY_SCAN_ATTEMPTS) + ")";
            const String removeStep = attempt == 1
                ? String("Remove finger completely before the verification scan")
                : String("Verification scan did not match slot ") + String(slot) + ". Remove finger and try again" + attemptText;
            // This POST is strict on purpose: it fails when the admin cancelled
            // the job, which must stop the third scan.
            if (!updateProgress(job, PROGRESS_VERIFY_REMOVE, removeStep, errorMessage)) {
                rollbackEnrollmentSlot(slot, "progress rejected during verification");
                return false;
            }
            if (!waitForFingerRemoval(errorMessage, FINGER_VERIFY_REMOVAL_TIMEOUT_MS)) {
                Serial.println("  [ENROLL] Third scan: finger was not removed.");
                errorMessage = "Verification scan stopped: " + errorMessage;
                rollbackEnrollmentSlot(slot, "finger not removed before verification");
                return false;
            }

            noteProgress(job, PROGRESS_VERIFY_PLACE, "Place the enrolled finger for the verification scan" + attemptText);
            if (!waitForFingerPlacement(1, errorMessage, job, PROGRESS_VERIFY_PLACE, "verification scan")) {
                Serial.println("  [ENROLL] Third scan: fresh capture failed.");
                errorMessage = "Verification scan stopped: " + errorMessage;
                rollbackEnrollmentSlot(slot, "verification capture failed");
                return false;
            }

            noteProgress(job, PROGRESS_VERIFY_MATCHING, "Verifying against the enrolled sensor slot " + String(slot));
            last = checkFreshScanAgainstSlot(slot, toleratedSlot);
            {
                String summary = "fast " + SerialLog::hex(last.fastStatus) + " " + SerialLog::statusName(last.fastStatus);
                if (last.usedStandardSearch)
                    summary += " | standard " + SerialLog::hex(last.match.standardStatus) + " "
                        + SerialLog::statusName(last.match.standardStatus);
                if (last.match.outcome == DoorFingerprintSearch::Outcome::Matched)
                    summary += ", matched slot " + String(last.match.matchedSlot) + " conf " + String(last.match.confidence);
                attemptLog[attempt - 1] = summary;
            }

            if (last.kind == SlotCheck::Kind::Verified) {
                job.verification.freshScanVerified = true;
                job.verification.storageConfirmed = true;
                job.verification.storedSlot = job.assignedSlot;
                job.verification.matchedSlot = job.assignedSlot;
                job.verification.confidence = last.match.confidence > 0 && last.match.confidence != DoorFingerprintSearch::UNSET_MATCH
                    ? static_cast<int>(last.match.confidence) : 1;
                SerialLog::ok("Verification scan matched slot " + String(slot) + " (confidence "
                    + String(job.verification.confidence) + ", attempt " + String(attempt) + ").");
                noteProgress(job, PROGRESS_VERIFY_PASSED, "Verification successful at slot " + String(slot)
                    + " (confidence " + String(job.verification.confidence) + ")");
                return true;
            }

            if (last.kind == SlotCheck::Kind::WrongSlot) {
                Serial.print("  [ENROLL] Third scan matched slot "); Serial.print(last.match.matchedSlot);
                Serial.print(" instead of "); Serial.print(slot);
                Serial.println(". Rolling back the new slot.");
                errorMessage = "The verification scan matched a different fingerprint at slot " + String(last.match.matchedSlot)
                    + " (confidence " + String(last.match.confidence) + "), not the newly enrolled slot " + String(slot)
                    + ". Use the same finger for all three scans. The new slot was cleared; start enrollment again.";
                rollbackEnrollmentSlot(slot, "third scan matched wrong slot");
                return false;
            }

            Serial.print("  [ENROLL] Third scan attempt "); Serial.print(attempt);
            Serial.print(last.kind == SlotCheck::Kind::SensorFault ? " sensor fault: " : " no match: ");
            Serial.println(last.error);
        }

        SerialLog::blank();
        SerialLog::debug("Verification attempt summary (expected slot " + String(slot) + "):");
        for (uint8_t i = 0; i < VERIFY_SCAN_ATTEMPTS; ++i)
            SerialLog::kv((String("  Attempt ") + (i + 1)).c_str(), attemptLog[i].length() ? attemptLog[i] : String("not reached"));
        SerialLog::debug("fast and standard both 0x09 = the stored model does not match this finger. Re-enroll pressing");
        SerialLog::debug("the same spot of the finger each time. 0x17 = consumed buffer (firmware issue, report this log).");
        errorMessage = "The verification scan did not match the newly enrolled fingerprint after "
            + String(VERIFY_SCAN_ATTEMPTS) + " attempts. The new slot was cleared. Enroll again and press the finger flat and centered the same way for all three scans.";
        if (last.error.length()) errorMessage += " " + last.error;
        rollbackEnrollmentSlot(slot, "third scan no match after retries");
        return false;
    }

    bool readConfirmedStoredTemplate(EnrollmentJob &job, String &templateDataBase64, String &errorMessage)
    {
        templateDataBase64 = "";
        errorMessage = "";
        // Preserve any verification already established by verifyEnrolledFingerprint.
        // Recovery (no live finger) falls back to storage-only proof.
        const bool hadFreshScan = job.verification.freshScanVerified;
        const int savedMatchedSlot = job.verification.matchedSlot;
        const int savedConfidence = job.verification.confidence;
        job.verification.storageConfirmed = true;
        job.verification.storedSlot = job.assignedSlot;
        if (!hadFreshScan) {
            job.verification.freshScanVerified = false;
            job.verification.matchedSlot = job.assignedSlot;
            job.verification.confidence = 1;
        } else {
            job.verification.matchedSlot = savedMatchedSlot;
            job.verification.confidence = savedConfidence;
        }
        SerialLog::subsection("DOWNLOAD  READ STORED TEMPLATE");
        reportEnrollmentStored(job, "Stored at slot " + String(job.assignedSlot));
        noteProgress(job, PROGRESS_READ_TEMPLATE, String(hadFreshScan ? "Verification passed. " : "")
            + "Reading the stored template of slot " + String(job.assignedSlot) + " for download.");

        std::unique_ptr<uint8_t[]> flash(new (std::nothrow) uint8_t[DIRECT_TEMPLATE_MAX_BYTES]);
        std::unique_ptr<uint8_t[]> ram(new (std::nothrow) uint8_t[DIRECT_TEMPLATE_MAX_BYTES]);
        if (!flash) {
            errorMessage = "Not enough memory to read the stored slot. The new sensor template was rolled back. Start enrollment again.";
            rollbackEnrollmentSlot(static_cast<uint16_t>(job.assignedSlot), "OOM during template read");
            job.verification = {};
            return false;
        }

        // Adafruit stores RegModel from buffer 1. Download the flash copy that
        // Search will use. If RAM still holds that model, the hashes must match.
        delay(400);
        for (uint8_t round = 1; round <= 4; ++round) {
            size_t flashLength = 0;
            size_t ramLength = 0;
            String flashError;
            String ramError;
            const bool haveFlash = readStoredTemplate(job.assignedSlot, flash.get(), DIRECT_TEMPLATE_MAX_BYTES, flashLength, flashError);
            const bool haveRam = ram
                && readCurrentTemplate(ram.get(), DIRECT_TEMPLATE_MAX_BYTES, ramLength, ramError);
            if (haveFlash && haveRam && !DoorEnrollmentProof::sameTemplate(flash.get(), flashLength, ram.get(), ramLength)) {
                Serial.print("  [ENROLL] Buffer 1 does not match stored slot ");
                Serial.print(job.assignedSlot);
                Serial.println(". Using flash only after another LoadChar.");
            } else if (haveFlash && acceptStoredTemplate(job, flash.get(), flashLength, templateDataBase64, flashError)) {
                Serial.print("  [ENROLL] Download template read from stored slot ");
                Serial.println(job.assignedSlot);
                return true;
            }
            Serial.print("  [ENROLL] Stored-slot read round "); Serial.print(round);
            Serial.print("/4 failed. "); Serial.println(haveFlash ? flashError : (flashError.length() ? flashError : ramError));
            delay(200);
        }
        templateDataBase64 = "";
        job.verification = {};
        errorMessage = "Sensor A stored the fingerprint but the template could not be read for download. "
            "The new sensor template was rolled back. Start enrollment again.";
        rollbackEnrollmentSlot(static_cast<uint16_t>(job.assignedSlot), "template download failed");
        return false;
    }

    String proofFailure(DoorEnrollmentProof::Result result, const EnrollmentJob &job, size_t length) {
        using DoorEnrollmentProof::Result;
        if (result == Result::OccupiedSlot)
            return "The reserved sensor slot is occupied. Existing fingerprints were preserved. Choose another slot or clear it in Sensor Memory.";
        if (result == Result::StoreFailed)
            return "Sensor A did not store the fingerprint. No download is available. Start enrollment again.";
        if (result == Result::CaptureFailed)
            return "Fingerprint capture did not finish with usable quality. Start enrollment again.";
        if (result == Result::ModelFailed)
            return "The two scans could not build a matching model. Start enrollment again.";
        if (result == Result::RecoveryFailed)
            return "The reserved slot could not be confirmed. Start enrollment again.";
        (void)length;
        (void)job;
        return "Native fingerprint enrollment failed before download. Start enrollment again.";
    }
}

bool runEnrollmentJob(EnrollmentJob &job, String &templateDataBase64, String &errorMessage)
{
    templateDataBase64 = "";
    errorMessage = "";
    job.verification = {};
    if (job.jobId <= 0 || job.assignedSlot <= 0 || job.assignedSlot > UINT16_MAX) {
        errorMessage = "The enrollment job or reserved sensor slot is invalid.";
        return false;
    }
    if (job.recovery) {
        Serial.println("  [ENROLL] Recovery of an already stored slot. Reading that slot for download.");
        return readConfirmedStoredTemplate(job, templateDataBase64, errorMessage);
    }

    std::unique_ptr<uint8_t[]> saved(new (std::nothrow) uint8_t[DIRECT_TEMPLATE_MAX_BYTES]);
    if (!saved) { errorMessage = "Not enough memory to enroll the fingerprint."; return false; }
    size_t savedLength = 0;

    SerialLog::clearStatus();
    SerialLog::subsection("ENROLLMENT PLAN");
    SerialLog::kv("Flow", "Scan 1 -> Scan 2 -> RegModel + Store -> Verification scan");

    bool occupied = false;
    if (!isSensorSlotOccupied(job.assignedSlot, occupied, errorMessage)) return false;
    if (occupied) {
        // A leftover template in this page is not this enrollment. Downloading it
        // made the dashboard look enrolled while Search/Match still missed.
        const bool replaceAssigned = job.isUpdate || job.previousSlot == job.assignedSlot || job.fingerprintId > 0;
        if (replaceAssigned) {
            if (!updateProgress(job, 5, "Clearing Sensor A slot " + String(job.assignedSlot) +
                " before a new two-scan Store", errorMessage)) return false;
            if (!deleteStoredFingerprint(job.assignedSlot, errorMessage)) {
                errorMessage = "Could not clear Sensor A slot " + String(job.assignedSlot) +
                    " before enrollment. " + errorMessage;
                return false;
            }
            Serial.print("  [ENROLL] Cleared occupied slot ");
            Serial.print(job.assignedSlot);
            Serial.println(" so this job can Store a new model.");
        } else if (!reserveEmptyEnrollmentSlot(job, errorMessage)) {
            return false;
        }
        if (!isSensorSlotOccupied(job.assignedSlot, occupied, errorMessage)) return false;
        if (occupied) {
            errorMessage = "Sensor A slot " + String(job.assignedSlot) +
                " is still occupied. Existing fingerprints were preserved.";
            return false;
        }
    }

    EnrollmentOperations operations{job, errorMessage};
    const DoorEnrollmentProof::Result proof = DoorEnrollmentProof::finishNative(
        operations, false, saved.get(), DIRECT_TEMPLATE_MAX_BYTES, savedLength);
    if (proof != DoorEnrollmentProof::Result::StoredPending) {
        if (errorMessage.length() == 0) errorMessage = proofFailure(proof, job, savedLength);
        // Capture/model failures never Store. StoreFailed already attempted slot rollback.
        return false;
    }
    if (!isSensorSlotOccupied(job.assignedSlot, occupied, errorMessage) || !occupied) {
        errorMessage = "Sensor A accepted Store but slot " + String(job.assignedSlot) +
            " is empty. The fingerprint was not saved. Start enrollment again.";
        rollbackEnrollmentSlot(static_cast<uint16_t>(job.assignedSlot), "Store ACK without occupied slot");
        return false;
    }
    // Real third-scan verification: require a fresh finger capture that identifies
    // exactly the assignedSlot. A match to any other slot (e.g. an old thumb)
    // rejects enrollment and rolls back only this slot. This must run BEFORE
    // readConfirmedStoredTemplate, because that function loads the stored template
    // into Buffer 1 and would overwrite the fresh scan's character file.
    if (!verifyEnrolledFingerprint(job, errorMessage)) {
        return false;
    }
    // Download uses the exact flash template format stored by RegModel -> Store.
    // Download is blocked unless this read succeeds; failure rolls the slot back.
    return readConfirmedStoredTemplate(job, templateDataBase64, errorMessage);
}

bool runEnrollmentVerifyJob(const EnrollmentVerifyJob &job, DoorFingerprintSearch::Result &match, String &templateHash, String &errorMessage)
{
    templateHash = "";
    errorMessage = "";
    match = DoorFingerprintSearch::protocolFailure();
    if (job.jobId <= 0 || job.targetSlot <= 0) {
        errorMessage = "The enrollment verification job or stored slot is invalid.";
        return false;
    }
    EnrollmentJob capture{};
    Serial.println("  [ENROLL] Place the same finger to verify the downloaded enrollment.");
    if (!waitForFingerRemoval(errorMessage) ||
        !waitForFingerPlacement(1, errorMessage, capture, 0)) {
        return false;
    }
    // Same Adafruit fingerFastSearch check as the enrollment third scan.
    const SlotCheck check = checkFreshScanAgainstSlot(static_cast<uint16_t>(job.targetSlot), 0);
    match = check.match;
    logFingerprintStatus("enrollment post-download verify", match.standardStatus);
    if (check.kind != SlotCheck::Kind::Verified) {
        if (check.kind == SlotCheck::Kind::WrongSlot)
            errorMessage = "Sensor A identified slot " + String(match.matchedSlot) + " instead of the enrolled slot "
                + String(job.targetSlot) + ". Use the same finger that was enrolled.";
        else
            errorMessage = check.error.length() ? check.error :
                "Sensor A did not identify the enrolled slot after download.";
        return false;
    }
    match.outcome = DoorFingerprintSearch::Outcome::Matched;
    match.matchedSlot = static_cast<uint16_t>(job.targetSlot);
    if (!readStoredTemplateHash(job.targetSlot, templateHash, errorMessage)) return false;
    return templateHash.length() == 64;
}
