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

    enum class Event { None, Empty, Pair, Progress, Generate, Store, Recover, Read, Fresh, Confirm };
    template <size_t LENGTH = BYTES>
    struct NativeOperations {
        Event fail = Event::None;
        Event events[9] = {};
        size_t count = 0;
        unsigned stores = 0, fresh = 0, reads = 0;
        bool uniform = false;
        uint8_t uniformValue = 0xFF;
        size_t reportedLength = LENGTH;
        bool corruptReadback = false, uniformReadback = false;
        size_t confirmedLength = LENGTH;
        constexpr bool call(Event event) { events[count++] = event; return fail != event; }
        constexpr bool emptySlot() { return call(Event::Empty); }
        constexpr bool capturePair() { return call(Event::Pair); }
        constexpr bool beforeGeneration() { return call(Event::Progress); }
        constexpr bool generate() { return call(Event::Generate); }
        constexpr bool storeNative() { ++stores; return call(Event::Store); }
        constexpr bool confirmRecovery() { return call(Event::Recover); }
        constexpr bool readStored(uint8_t *output, size_t capacity, size_t &length) {
            ++reads;
            if (!call(Event::Read) || capacity < LENGTH) return false;
            length = reportedLength;
            for (size_t index = 0; index < LENGTH; ++index)
                output[index] = uniform ? uniformValue : static_cast<uint8_t>(index);
            return true;
        }
        constexpr bool verifyFresh() { ++fresh; return call(Event::Fresh); }
        constexpr bool confirmStored(const uint8_t *saved, size_t length) {
            ++reads;
            if (!call(Event::Confirm) || confirmedLength > LENGTH) return false;
            uint8_t readback[LENGTH] = {};
            for (size_t index = 0; index < LENGTH; ++index)
                readback[index] = uniformReadback ? 0xFF : static_cast<uint8_t>(index);
            if (corruptReadback) readback[0] ^= 1;
            return sameTemplate(saved, length, readback, confirmedLength);
        }
    };
    template <size_t LENGTH>
    constexpr bool nativeWriteOrderAndUniformGuards() {
        uint8_t saved[LENGTH] = {}; size_t length = 0;
        NativeOperations<LENGTH> ops;
        if (finishNative(ops, false, saved, LENGTH, length) != Result::Verified ||
            length != LENGTH || !validTemplate(saved, length) || ops.stores != 1 || ops.fresh != 1 || ops.reads != 2) return false;
        const Event expected[] = {Event::Empty, Event::Pair, Event::Progress, Event::Generate, Event::Store, Event::Read, Event::Fresh, Event::Confirm};
        if (ops.count != sizeof(expected) / sizeof(expected[0])) return false;
        for (size_t index = 0; index < ops.count; ++index)
            if (ops.events[index] != expected[index]) return false;
        // Reproduce the hardware report: Store ACK succeeds, flash reads uniform.
        const uint8_t values[] = {0x00, 0xFF, 0xA5};
        for (uint8_t value : values) {
            NativeOperations<LENGTH> bad; bad.uniform = true; bad.uniformValue = value;
            if (finishNative(bad, false, saved, LENGTH, length) != Result::InvalidStored ||
                bad.stores != 1 || bad.fresh != 0) return false;
        }
        return true;
    }
    constexpr bool everyFailureStopsCompletion() {
        uint8_t saved[BYTES] = {}; size_t length = 0;
        const Event failures[] = {Event::Empty, Event::Pair, Event::Progress, Event::Generate, Event::Store, Event::Read, Event::Fresh, Event::Confirm};
        const Result results[] = {Result::OccupiedSlot, Result::CaptureFailed, Result::ProgressFailed,
            Result::ModelFailed, Result::StoreFailed, Result::StoredReadFailed, Result::FreshVerificationFailed, Result::StoredVerificationFailed};
        for (size_t index = 0; index < sizeof(failures) / sizeof(failures[0]); ++index) {
            NativeOperations<> ops; ops.fail = failures[index];
            if (finishNative(ops, false, saved, BYTES, length) != results[index] ||
                ops.events[ops.count - 1] != failures[index]) return false;
            if (index < 4 && ops.stores != 0) return false;
        }
        NativeOperations<> tooLong; tooLong.reportedLength = BYTES + 256;
        if (finishNative(tooLong, false, saved, BYTES, length) != Result::InvalidStored || tooLong.fresh != 0) return false;
        NativeOperations<> wrongSize; wrongSize.reportedLength = BYTES - 1;
        return finishNative(wrongSize, false, saved, BYTES, length) == Result::InvalidStored && wrongSize.fresh == 0;
    }
    constexpr bool recoveryNeverWritesAndRequiresFreshMatch() {
        uint8_t saved[BYTES] = {}; size_t length = 0;
        NativeOperations<> ops;
        if (finishNative(ops, true, saved, BYTES, length) != Result::Verified || ops.stores != 0) return false;
        const Event expected[] = {Event::Pair, Event::Progress, Event::Generate, Event::Recover, Event::Read, Event::Fresh, Event::Confirm};
        if (ops.count != sizeof(expected) / sizeof(expected[0])) return false;
        for (size_t index = 0; index < ops.count; ++index)
            if (ops.events[index] != expected[index]) return false;
        NativeOperations<> wrongSlot; wrongSlot.fail = Event::Recover;
        if (finishNative(wrongSlot, true, saved, BYTES, length) != Result::RecoveryFailed ||
            wrongSlot.reads != 0 || wrongSlot.stores != 0) return false;
        NativeOperations<> freshFailed; freshFailed.fail = Event::Fresh;
        return finishNative(freshFailed, true, saved, BYTES, length) == Result::FreshVerificationFailed &&
            freshFailed.stores == 0 && freshFailed.fresh == 1;
    }
    constexpr bool changedFlashNeverCompletes() {
        uint8_t saved[BYTES] = {}; size_t length = 0;
        NativeOperations<> corrupt; corrupt.corruptReadback = true;
        if (finishNative(corrupt, false, saved, BYTES, length) != Result::StoredVerificationFailed ||
            corrupt.fresh != 1 || corrupt.stores != 1) return false;
        NativeOperations<> uniform; uniform.uniformReadback = true;
        if (finishNative(uniform, false, saved, BYTES, length) != Result::StoredVerificationFailed) return false;
        NativeOperations<> shorter; shorter.confirmedLength = BYTES - 1;
        return finishNative(shorter, true, saved, BYTES, length) == Result::StoredVerificationFailed && shorter.stores == 0;
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
    static_assert(nativeWriteOrderAndUniformGuards<512>() && nativeWriteOrderAndUniformGuards<768>() &&
        nativeWriteOrderAndUniformGuards<1024>() && nativeWriteOrderAndUniformGuards<1536>(),
        "Native RegModel -> Store must be adjacent, and uniform flash readback cannot complete at any supported length.");
    static_assert(everyFailureStopsCompletion(), "Capture, progress, model, storage, readback, and fresh-scan failures must stop completion.");
    static_assert(recoveryNeverWritesAndRequiresFreshMatch(), "Recovery must prove the existing slot without writing flash.");
    static_assert(downloadAckNeedsByteProof(), "Database imports still require exact download-buffer proof even without a final ACK.");
    static_assert(changedFlashNeverCompletes(), "Flash must remain byte-identical after the final fresh scan, including recovery.");
    static_assert(completionRequiresBoundProof(), "Completion requires a positive fresh match and a completed backend receipt bound to the exact job, slot, and template.");
}
