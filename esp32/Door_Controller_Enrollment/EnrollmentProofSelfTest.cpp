#include "EnrollmentProof.h"
namespace {
    using namespace DoorEnrollmentProof;
    constexpr size_t BYTES = 512;
    enum class AckInput { Absent, Success, Negative, Partial, Malformed };
    struct FakeRestore {
        AckInput input = AckInput::Absent;
        bool corrupt = false, uniform = false;
        unsigned reads = 0;
        constexpr DownloadAck finalAck() {
            return input == AckInput::Absent ? DownloadAck::Absent :
                input == AckInput::Success ? DownloadAck::Accepted : DownloadAck::Rejected;
        }
        constexpr bool readCurrent(uint8_t *data, size_t capacity, size_t &length) {
            ++reads;
            if (capacity < 768) return false;
            length = 768;
            for (size_t index = 0; index < length; ++index) data[index] = uniform ? 0xFF : static_cast<uint8_t>(index);
            if (corrupt) data[0] ^= 1;
            return true;
        }
    };
    constexpr bool downloadAckNeedsByteProof() {
        uint8_t captured[768] = {}, scratch[768] = {};
        for (size_t index = 0; index < 768; ++index) captured[index] = static_cast<uint8_t>(index);
        FakeRestore absent;
        if (verifyRestoredBuffer(absent, captured, 768, scratch, 768) != RestoreResult::Verified || absent.reads != 1) return false;
        FakeRestore mismatch; mismatch.corrupt = true;
        if (verifyRestoredBuffer(mismatch, captured, 768, scratch, 768) != RestoreResult::BufferMismatch) return false;
        FakeRestore uniform; uniform.uniform = true;
        if (verifyRestoredBuffer(uniform, captured, 768, scratch, 768) != RestoreResult::BufferMismatch) return false;
        const AckInput rejected[] = {AckInput::Negative, AckInput::Partial, AckInput::Malformed};
        for (AckInput input : rejected) {
            FakeRestore invalid; invalid.input = input;
            if (verifyRestoredBuffer(invalid, captured, 768, scratch, 768) != RestoreResult::RejectedAck || invalid.reads != 0) return false;
        }
        FakeRestore accepted; accepted.input = AckInput::Success;
        return verifyRestoredBuffer(accepted, captured, 768, scratch, 768) == RestoreResult::Verified;
    }

    enum class Event { None, Empty, Pair, Progress, Generate, Store, Mark, Recover };
    template <size_t LENGTH = BYTES>
    struct NativeOperations {
        Event fail = Event::None;
        Event events[8] = {};
        size_t count = 0;
        unsigned stores = 0, marks = 0;
        constexpr bool call(Event event) { events[count++] = event; return fail != event; }
        constexpr bool emptySlot() { return call(Event::Empty); }
        constexpr bool capturePair() { return call(Event::Pair); }
        constexpr bool beforeGeneration() { return call(Event::Progress); }
        constexpr bool generate() { return call(Event::Generate); }
        constexpr bool storeNative() { ++stores; return call(Event::Store); }
        constexpr bool markStored() { ++marks; return call(Event::Mark); }
        constexpr bool confirmRecovery() { return call(Event::Recover); }
    };
    template <size_t LENGTH>
    constexpr bool nativeWriteOrderStopsAfterStore() {
        uint8_t saved[LENGTH] = {}; size_t length = 99;
        NativeOperations<LENGTH> ops;
        if (finishNative(ops, false, saved, LENGTH, length) != Result::StoredPending ||
            length != 0 || ops.stores != 1 || ops.marks != 1) return false;
        const Event expected[] = {Event::Empty, Event::Pair, Event::Progress, Event::Generate, Event::Store, Event::Mark};
        if (ops.count != sizeof(expected) / sizeof(expected[0])) return false;
        for (size_t index = 0; index < ops.count; ++index)
            if (ops.events[index] != expected[index]) return false;
        return true;
    }
    constexpr bool everyFailureStopsCompletion() {
        uint8_t saved[BYTES] = {}; size_t length = 0;
        const Event failures[] = {Event::Empty, Event::Pair, Event::Progress, Event::Generate, Event::Store};
        const Result results[] = {Result::OccupiedSlot, Result::CaptureFailed, Result::ProgressFailed,
            Result::ModelFailed, Result::StoreFailed};
        for (size_t index = 0; index < sizeof(failures) / sizeof(failures[0]); ++index) {
            NativeOperations<> ops; ops.fail = failures[index];
            if (finishNative(ops, false, saved, BYTES, length) != results[index] ||
                ops.events[ops.count - 1] != failures[index]) return false;
            if (index < 4 && ops.stores != 0) return false;
            if (index == 4 && ops.marks != 0) return false;
        }
        NativeOperations<> stored;
        return finishNative(stored, false, saved, BYTES, length) == Result::StoredPending &&
            stored.stores == 1 && stored.marks == 1;
    }
    constexpr bool recoveryNeverWritesAndStopsBeforeIdentify() {
        uint8_t saved[BYTES] = {}; size_t length = 0;
        NativeOperations<> ops;
        if (finishNative(ops, true, saved, BYTES, length) != Result::StoredPending || ops.stores != 0) return false;
        const Event expected[] = {Event::Pair, Event::Progress, Event::Generate, Event::Recover};
        if (ops.count != sizeof(expected) / sizeof(expected[0])) return false;
        for (size_t index = 0; index < ops.count; ++index)
            if (ops.events[index] != expected[index]) return false;
        NativeOperations<> wrongSlot; wrongSlot.fail = Event::Recover;
        return finishNative(wrongSlot, true, saved, BYTES, length) == Result::RecoveryFailed &&
            wrongSlot.stores == 0 && wrongSlot.marks == 0;
    }
    constexpr bool successfulStoreNeverReadsOrVerifies() {
        uint8_t saved[BYTES] = {}; size_t length = 7;
        NativeOperations<> ops;
        return finishNative(ops, false, saved, BYTES, length) == Result::StoredPending &&
            length == 0 && ops.stores == 1 && ops.marks == 1;
    }
    constexpr Verification verifiedProof() {
        Verification proof;
        proof.freshScanVerified = true;
        proof.storedSlot = proof.matchedSlot = 7;
        proof.confidence = 1; // Positive sensor result; no invented accuracy threshold.
        proof.templateBytes = 768;
        for (size_t index = 0; index < 64; ++index) proof.templateSha256[index] = "0123456789abcdef"[index % 16];
        return proof;
    }
    constexpr bool completionRequiresBoundProof() {
        const Verification submitted = verifiedProof();
        Verification received = submitted;
        if (!completionConfirmed(submitted, received, 28, 1, 28, 1, 7, true, true)) return false;
        if (completionConfirmed(submitted, received, 28, 1, 29, 1, 7, true, true) ||
            completionConfirmed(submitted, received, 28, 1, 28, 2, 7, true, true) ||
            completionConfirmed(submitted, received, 28, 1, 28, 1, 8, true, true) ||
            completionConfirmed(submitted, received, 28, 1, 28, 1, 7, false, true) ||
            completionConfirmed(submitted, received, 28, 1, 28, 1, 7, true, false)) return false;
        received.templateSha256[0] = 'f';
        if (sameVerification(submitted, received)) return false;
        received = submitted; received.templateBytes = 512;
        if (sameVerification(submitted, received)) return false;
        received = submitted; received.confidence = 2;
        if (sameVerification(submitted, received)) return false;
        received = submitted; received.confidence = 0;
        if (validVerification(received, 7)) return false;
        received = submitted; received.freshScanVerified = false;
        if (validVerification(received, 7)) return false;
        received = submitted; received.matchedSlot = 8;
        if (validVerification(received, 7)) return false;
        received = submitted; received.templateSha256[0] = 'A';
        if (validVerification(received, 7)) return false;
        const Verification pendingCopy = submitted;
        return sameVerification(submitted, pendingCopy);
    }
    static_assert(nativeWriteOrderStopsAfterStore<512>() && nativeWriteOrderStopsAfterStore<768>() &&
        nativeWriteOrderStopsAfterStore<1024>() && nativeWriteOrderStopsAfterStore<1536>(),
        "Native RegModel -> Store must be adjacent and stop after Store. Download reads the stored slot.");
    static_assert(everyFailureStopsCompletion(), "Capture, model, and Store failures must stop enrollment. A successful Store stays StoredPending.");
    static_assert(recoveryNeverWritesAndStopsBeforeIdentify(), "Recovery must prove the existing slot without writing flash.");
    static_assert(downloadAckNeedsByteProof(), "Database imports still require exact download-buffer proof even without a final ACK.");
    static_assert(successfulStoreNeverReadsOrVerifies(), "Store must not LoadChar, backup, or Search in the same pass.");
    static_assert(completionRequiresBoundProof(), "Completion requires a bound backend receipt for the exact job and slot.");
}
