#ifndef DOOR_ENROLLMENT_PROOF_H
#define DOOR_ENROLLMENT_PROOF_H

#include "TemplateStream.h"

namespace DoorEnrollmentProof {
    struct Verification {
        bool freshScanVerified = false;
        bool storageConfirmed = false;
        int storedSlot = 0;
        int matchedSlot = 0;
        int confidence = 0;
        size_t templateBytes = 0;
        char templateSha256[65] = {};
    };

    constexpr bool validHash(const char *hash) {
        if (hash == nullptr) return false;
        for (size_t index = 0; index < 64; ++index)
            if (!((hash[index] >= '0' && hash[index] <= '9') ||
                (hash[index] >= 'a' && hash[index] <= 'f'))) return false;
        return hash[64] == '\0';
    }

    constexpr bool validVerification(const Verification &proof, int reservedSlot) {
        if (reservedSlot <= 0 || reservedSlot > UINT16_MAX || proof.storedSlot != reservedSlot) return false;
        if (proof.freshScanVerified) {
            return proof.matchedSlot == reservedSlot && proof.confidence > 0 &&
                R307TemplateStream::supportedSize(proof.templateBytes) && validHash(proof.templateSha256);
        }
        return proof.storageConfirmed && proof.storedSlot == reservedSlot &&
            (proof.templateBytes == 0 || (R307TemplateStream::supportedSize(proof.templateBytes) &&
                validHash(proof.templateSha256)));
    }

    constexpr bool sameVerification(const Verification &expected, const Verification &received) {
        if (!validVerification(expected, expected.storedSlot) ||
            !validVerification(received, expected.storedSlot)) return false;
        if (expected.storageConfirmed && received.storageConfirmed &&
            expected.storedSlot == received.storedSlot &&
            (expected.templateBytes == 0 || received.templateBytes == 0 ||
                expected.templateBytes == received.templateBytes)) {
            if (expected.templateBytes == 0 || received.templateBytes == 0) return true;
        } else if (expected.confidence != received.confidence || expected.templateBytes != received.templateBytes) {
            return false;
        }
        for (size_t index = 0; index < 64; ++index)
            if (expected.templateSha256[index] != received.templateSha256[index]) return false;
        return true;
    }

    constexpr bool completionConfirmed(const Verification &submitted, const Verification &received,
        int expectedJobId, int expectedDeviceId, int confirmedJobId, int confirmedDeviceId,
        int confirmedSlot, bool completed, bool verifiedAtPresent) {
        return completed && verifiedAtPresent && expectedJobId > 0 && expectedDeviceId > 0 &&
            confirmedJobId == expectedJobId && confirmedDeviceId == expectedDeviceId &&
            validVerification(submitted, confirmedSlot) && sameVerification(submitted, received);
    }

    constexpr bool validTemplate(const uint8_t *data, size_t length) {
        if (data == nullptr || !R307TemplateStream::supportedSize(length)) return false;
        for (size_t index = 1; index < length; ++index)
            if (data[index] != data[0]) return true;
        return false;
    }

    constexpr bool sameTemplate(const uint8_t *first, size_t firstLength,
        const uint8_t *second, size_t secondLength) {
        if (!validTemplate(first, firstLength) || !validTemplate(second, secondLength) || firstLength != secondLength) return false;
        for (size_t index = 0; index < firstLength; ++index)
            if (first[index] != second[index]) return false;
        return true;
    }

    enum class DownloadAck { Absent, Accepted, Rejected };
    enum class RestoreResult { Verified, RejectedAck, ReadFailed, BufferMismatch };

    template <typename Operations>
    constexpr RestoreResult verifyRestoredBuffer(Operations &ops, const uint8_t *captured,
        size_t capturedLength, uint8_t *scratch, size_t capacity) {
        // Some compatible modules omit the post-data ACK. Absence permits a
        // read-back attempt, never a successful restore without byte proof.
        if (ops.finalAck() == DownloadAck::Rejected) return RestoreResult::RejectedAck;
        size_t restoredLength = 0;
        if (!ops.readCurrent(scratch, capacity, restoredLength)) return RestoreResult::ReadFailed;
        if (restoredLength > capacity || !sameTemplate(captured, capturedLength, scratch, restoredLength))
            return RestoreResult::BufferMismatch;
        return RestoreResult::Verified;
    }

    enum class Result {
        Verified, StoredPending, OccupiedSlot, CaptureFailed, ProgressFailed, ModelFailed,
        StoreFailed, RecoveryFailed
    };

    // Adafruit two-scan enrollment: RegModel -> Store. The stored-slot
    // template is read and downloaded after this returns StoredPending.
    template <typename Operations>
    constexpr Result finishNative(Operations &ops, bool recovering, uint8_t *saved,
        size_t capacity, size_t &savedLength) {
        savedLength = 0;
        (void)saved;
        (void)capacity;
        if (!recovering && !ops.emptySlot()) return Result::OccupiedSlot;
        if (!ops.capturePair()) return Result::CaptureFailed;
        if (!ops.beforeGeneration()) return Result::ProgressFailed;
        if (!ops.generate()) return Result::ModelFailed;
        if (recovering) {
            if (!ops.confirmRecovery()) return Result::RecoveryFailed;
            return Result::StoredPending;
        }
        if (!ops.storeNative()) return Result::StoreFailed;
        ops.markStored();
        return Result::StoredPending;
    }
}

#endif
