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

        bool capturePair() {
            // Adafruit enroll.ino two-scan flow: getImage -> image2Tz(1),
            // remove finger, getImage -> image2Tz(2), then createModel ->
            // storeModel, with nothing else sent to the sensor in between.
            SerialLog::subsection("STEP 1/4  FIRST SCAN");
            if (!updateProgress(job, 10, "Place finger for first scan", error) ||
                !waitForFingerPlacement(1, error, job, 10)) return false;
            // No sensor command between scan 1 and RegModel: on this R307S any
            // Search in between (even on CharBuffer2) left a stored model that
            // no later scan could match. Duplicates are checked after Store,
            // on the verification scan (verifyEnrolledFingerprint).
            SerialLog::ok("First scan accepted.");
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

    constexpr uint16_t NO_SLOT = 0xFFFF;

    // Result of searching a fresh verification capture against stored slots.
    struct Sweep {
        enum class Kind { Clear, Found, Fault };
        Kind kind = Kind::Clear;
        uint16_t slot = NO_SLOT;
        uint16_t confidence = 0;
        uint8_t lastStatus = DoorFingerprintSearch::NOT_FOUND;
        String error;
    };

    // Searches the verification image (CharBuffer1) against every occupied slot
    // in [from, to), skipping skipA and skipB, and reports the first other slot
    // that matches. Runs only AFTER Store, when consuming CharBuffer1 can no
    // longer damage the model: the buffer is rebuilt from the same image
    // before every search after the first. Windows follow the 163-slot
    // fingerFastSearch layout; a window whose hit is a skipped slot is split
    // around it and the remaining parts are searched. HiSpeedSearch (0x1B) is
    // tried first; on a miss or 0x17 the standard Search (0x04) checks the same
    // range again.
    Sweep sweepForMatch(const OccupiedIndex &index, uint16_t from, uint16_t to, uint16_t skipA, uint16_t skipB,
        bool bufferFresh, const char *label)
    {
        Sweep sweep;
        struct Range { uint16_t start; uint16_t end; };
        constexpr uint8_t MAX_RANGES = 24;
        Range pending[MAX_RANGES];
        uint8_t pendingCount = 0;
        if (from >= to) return sweep;

        // Push aligned windows from the highest down, so they are searched from low to high slots.
        const int32_t firstWindow = (from / FAST_SEARCH_WINDOW) * FAST_SEARCH_WINDOW;
        for (int32_t w = ((to - 1) / FAST_SEARCH_WINDOW) * FAST_SEARCH_WINDOW;
             w >= firstWindow && pendingCount < MAX_RANGES; w -= FAST_SEARCH_WINDOW) {
            const uint16_t start = max<int32_t>(w, from);
            const uint16_t end = min<int32_t>(w + FAST_SEARCH_WINDOW, to);
            if (start < end) pending[pendingCount++] = {start, end};
        }

        bool fresh = bufferFresh;
        while (pendingCount > 0) {
            const Range range = pending[--pendingCount];
            if (range.start >= range.end || !windowHasTemplates(index, range.start, range.end - range.start)) continue;
            const uint16_t count = range.end - range.start;

            if (fresh) fresh = false;
            else if (!regenerateBuffer1FromImage(label)) {
                sweep.kind = Sweep::Kind::Fault;
                sweep.error = "Sensor A could not rebuild the verification scan for the next search.";
                return sweep;
            }
            String error;
            DoorFingerprintSearch::Result result = searchFingerprintWindowVerified(range.start, count, &error);
            if (result.outcome == DoorFingerprintSearch::Outcome::NoMatch ||
                result.outcome == DoorFingerprintSearch::Outcome::SensorError) {
                if (!regenerateBuffer1FromImage(label)) {
                    sweep.kind = Sweep::Kind::Fault;
                    sweep.error = "Sensor A could not rebuild the verification scan for the standard search.";
                    return sweep;
                }
                result = searchFingerprintWindowStandard(range.start, count, &error);
            }
            sweep.lastStatus = result.standardStatus;

            if (result.outcome == DoorFingerprintSearch::Outcome::NoMatch) continue;
            if (result.outcome == DoorFingerprintSearch::Outcome::Matched) {
                const uint16_t hit = result.matchedSlot;
                if (hit == skipA || hit == skipB) {
                    // Search reports one slot per range: look on both sides of the skipped one.
                    if (pendingCount + 2 > MAX_RANGES) {
                        sweep.kind = Sweep::Kind::Fault;
                        sweep.error = "Too many ranges to search.";
                        return sweep;
                    }
                    pending[pendingCount++] = {static_cast<uint16_t>(hit + 1), range.end};
                    pending[pendingCount++] = {range.start, hit};
                    continue;
                }
                sweep.kind = Sweep::Kind::Found;
                sweep.slot = hit;
                sweep.confidence = result.confidence;
                return sweep;
            }
            sweep.kind = Sweep::Kind::Fault;
            sweep.error = error.length() ? error
                : "Sensor returned status " + SerialLog::hex(result.standardStatus) + " while searching slots "
                    + String(range.start) + "-" + String(range.end - 1) + ".";
            return sweep;
        }
        return sweep;
    }

    String alreadyStoredMessage(uint16_t existingSlot, uint16_t confidence, uint16_t newSlot)
    {
        return "This finger is already stored on Sensor A at slot " + String(existingSlot)
            + " (confidence " + String(confidence) + "). The new slot " + String(newSlot)
            + " was cleared. Delete slot " + String(existingSlot)
            + " in Sensor Memory (or update the fingerprint that uses it), or enroll a different finger.";
    }

    // Third scan: independent verification after Store, which is also the
    // duplicate check. The user lifts the finger and places the SAME finger
    // again. (1) The fresh capture must identify exactly the slot just stored;
    // an update's previous slot holds the same finger and is skipped. A miss is
    // retried up to VERIFY_SCAN_ATTEMPTS times. (2) Once verified, the same
    // image is searched against every other stored slot: a hit means this
    // finger was already enrolled there, so only the new slot is rolled back.
    bool verifyEnrolledFingerprint(EnrollmentJob &job, String &errorMessage)
    {
        errorMessage = "";
        const uint16_t slot = static_cast<uint16_t>(job.assignedSlot);
        const uint16_t toleratedSlot = (job.previousSlot > 0 && job.previousSlot != job.assignedSlot)
            ? static_cast<uint16_t>(job.previousSlot) : NO_SLOT;
        SerialLog::subsection("STEP 4/4  VERIFICATION SCAN (3rd scan) + DUPLICATE CHECK");
        SerialLog::kv("Expected slot", String(slot));
        if (toleratedSlot != NO_SLOT) SerialLog::kv("Previous slot", String(toleratedSlot) + " (same finger, update)");
        String attemptLog[VERIFY_SCAN_ATTEMPTS];

        // Give the module a moment to finish the flash write from Store
        // before the first search of that page.
        delay(200);
        const OccupiedIndex index = readOccupiedIndex();
        if (index.valid) {
            Serial.print("  [ENROLL] Sensor slot index: "); Serial.print(index.count);
            Serial.println(" stored template(s), including the new one.");
        }

        const uint16_t windowStart = (slot / FAST_SEARCH_WINDOW) * FAST_SEARCH_WINDOW;
        const uint16_t windowEnd = min<uint32_t>(static_cast<uint32_t>(windowStart) + FAST_SEARCH_WINDOW, finger.capacity);

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
            Serial.print("  [ENROLL] Searching slots "); Serial.print(windowStart); Serial.print("-");
            Serial.print(windowEnd - 1); Serial.print(" for expected slot "); Serial.println(slot);
            Sweep check = sweepForMatch(index, windowStart, windowEnd, toleratedSlot, NO_SLOT, true, "verification");
            String directLog;
            if (check.kind == Sweep::Kind::Clear) {
                // The window search missed. Compare the same image with ONLY the
                // new slot: Search over a one-slot range, then a 1:1 Match
                // (LoadChar slot -> Buffer 2, Match Buffer 1 vs 2). Both look at
                // exactly the stored slot, so a hit is a real verification. The
                // log shows whether Search or the stored model is at fault.
                Serial.println("  [ENROLL] Window search missed. Checking slot " + String(slot) + " directly.");
                String directError;
                if (regenerateBuffer1FromImage("direct one-slot search")) {
                    const DoorFingerprintSearch::Result one = searchFingerprintWindowStandard(slot, 1, &directError);
                    directLog += " | one-slot Search " + SerialLog::hex(one.standardStatus);
                    if (one.outcome == DoorFingerprintSearch::Outcome::Matched && one.matchedSlot == slot) {
                        check.kind = Sweep::Kind::Found;
                        check.slot = slot;
                        check.confidence = one.confidence;
                    }
                }
                if (check.kind != Sweep::Kind::Found && regenerateBuffer1FromImage("direct 1:1 match")) {
                    const DoorFingerprintSearch::Result one = matchStoredFingerprintSlot(slot, &directError);
                    directLog += " | 1:1 Match " + SerialLog::hex(one.standardStatus);
                    if (one.outcome == DoorFingerprintSearch::Outcome::Matched) {
                        directLog += " score " + String(one.confidence);
                        check.kind = Sweep::Kind::Found;
                        check.slot = slot;
                        check.confidence = one.confidence;
                    }
                }
                if (directError.length()) Serial.println("  [ENROLL] Direct check: " + directError);
                if (check.kind == Sweep::Kind::Found)
                    Serial.println("  [ENROLL] Slot " + String(slot) + " matched directly; the window Search missed it.");
            }
            attemptLog[attempt - 1] = (check.kind == Sweep::Kind::Found
                ? "matched slot " + String(check.slot) + " conf " + String(check.confidence)
                : check.kind == Sweep::Kind::Clear
                    ? "no match (" + SerialLog::hex(check.lastStatus) + " " + SerialLog::statusName(check.lastStatus) + ")"
                    : "sensor fault: " + check.error) + directLog;

            if (check.kind == Sweep::Kind::Found && check.slot != slot) {
                Serial.print("  [ENROLL] Third scan matched slot "); Serial.print(check.slot);
                Serial.print(" instead of "); Serial.print(slot);
                Serial.println(". This finger is already stored there. Rolling back the new slot.");
                errorMessage = alreadyStoredMessage(check.slot, check.confidence, slot);
                rollbackEnrollmentSlot(slot, "verification scan matched an existing slot");
                return false;
            }
            if (check.kind != Sweep::Kind::Found) {
                Serial.print("  [ENROLL] Third scan attempt "); Serial.print(attempt);
                Serial.print(": "); Serial.println(attemptLog[attempt - 1]);
                continue;
            }

            SerialLog::ok("Verification scan matched slot " + String(slot) + " (confidence "
                + String(check.confidence) + ", attempt " + String(attempt) + ").");

            // Duplicate check: the same image against every other stored slot.
            noteProgress(job, PROGRESS_VERIFY_MATCHING, "Checking Sensor A for another copy of this finger");
            const Sweep duplicate = sweepForMatch(index, 0, finger.capacity, slot, toleratedSlot, false, "duplicate check");
            if (duplicate.kind == Sweep::Kind::Found) {
                Serial.print("  [ENROLL] Duplicate: this finger is also stored at slot "); Serial.print(duplicate.slot);
                Serial.print(", confidence="); Serial.println(duplicate.confidence);
                errorMessage = alreadyStoredMessage(duplicate.slot, duplicate.confidence, slot);
                rollbackEnrollmentSlot(slot, "duplicate of an existing slot");
                return false;
            }
            if (duplicate.kind == Sweep::Kind::Fault) {
                Serial.print("  [ENROLL] Duplicate check could not finish: "); Serial.println(duplicate.error);
                errorMessage = "Sensor A could not finish checking for another copy of this finger. The new slot "
                    + String(slot) + " was cleared. Start enrollment again. " + duplicate.error;
                rollbackEnrollmentSlot(slot, "duplicate check incomplete");
                return false;
            }
            SerialLog::ok("No other copy of this finger on Sensor A.");

            job.verification.freshScanVerified = true;
            job.verification.storageConfirmed = true;
            job.verification.storedSlot = job.assignedSlot;
            job.verification.matchedSlot = job.assignedSlot;
            job.verification.confidence = check.confidence > 0 && check.confidence != DoorFingerprintSearch::UNSET_MATCH
                ? static_cast<int>(check.confidence) : 1;
            noteProgress(job, PROGRESS_VERIFY_PASSED, "Verification successful at slot " + String(slot)
                + " (confidence " + String(job.verification.confidence) + ")");
            return true;
        }

        SerialLog::blank();
        SerialLog::debug("Verification attempt summary (expected slot " + String(slot) + "):");
        for (uint8_t i = 0; i < VERIFY_SCAN_ATTEMPTS; ++i)
            SerialLog::kv((String("  Attempt ") + (i + 1)).c_str(), attemptLog[i].length() ? attemptLog[i] : String("not reached"));
        SerialLog::debug("0x09 on every attempt = the stored model does not match this finger.");
        errorMessage = "The verification scan did not match the newly enrolled fingerprint after "
            + String(VERIFY_SCAN_ATTEMPTS) + " attempts. The new slot was cleared. Enroll again and press the finger flat and centered the same way for all three scans.";
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
    // Same search as the enrollment third scan, over the target slot's window.
    const uint16_t target = static_cast<uint16_t>(job.targetSlot);
    const uint16_t windowStart = (target / FAST_SEARCH_WINDOW) * FAST_SEARCH_WINDOW;
    const uint16_t windowEnd = min<uint32_t>(static_cast<uint32_t>(windowStart) + FAST_SEARCH_WINDOW, finger.capacity);
    const Sweep check = sweepForMatch(readOccupiedIndex(), windowStart, windowEnd, NO_SLOT, NO_SLOT, true,
        "post-download verify");
    match.standardStatus = check.lastStatus;
    logFingerprintStatus("enrollment post-download verify", match.standardStatus);
    if (check.kind != Sweep::Kind::Found || check.slot != target) {
        if (check.kind == Sweep::Kind::Found)
            errorMessage = "Sensor A identified slot " + String(check.slot) + " instead of the enrolled slot "
                + String(job.targetSlot) + ". Use the same finger that was enrolled.";
        else
            errorMessage = check.error.length() ? check.error :
                "Sensor A did not identify the enrolled slot after download.";
        return false;
    }
    match.outcome = DoorFingerprintSearch::Outcome::Matched;
    match.standardStatus = 0x00;
    match.matchedSlot = target;
    match.confidence = check.confidence;
    if (!readStoredTemplateHash(job.targetSlot, templateHash, errorMessage)) return false;
    return templateHash.length() == 64;
}
