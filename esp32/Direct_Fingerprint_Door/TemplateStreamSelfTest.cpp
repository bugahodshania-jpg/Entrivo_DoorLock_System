#include "TemplateStream.h"

namespace {
    using namespace R307TemplateStream;

    constexpr bool validTransfer(size_t totalBytes, size_t chunk, bool separateEnd, bool extraAck) {
        uint8_t output[MAX_TEMPLATE_BYTES + 2] = {};
        output[0] = output[MAX_TEMPLATE_BYTES + 1] = 0xA5;
        Receiver receiver(output + 1, MAX_TEMPLATE_BYTES);
        const uint8_t ack[] = {0};
        if (extraAck && receiver.append(0x07, ack, 1) != Result::More) return false;
        for (size_t offset = 0; offset < totalBytes; offset += chunk) {
            uint8_t payload[256] = {};
            for (size_t index = 0; index < chunk; ++index) payload[index] = static_cast<uint8_t>(offset + index);
            const bool last = offset + chunk == totalBytes;
            const Result expected = last && !separateEnd ? Result::Complete : Result::More;
            if (receiver.append(last && !separateEnd ? 0x08 : 0x02, payload, chunk) != expected) return false;
        }
        if (separateEnd && receiver.append(0x08, nullptr, 0) != Result::Complete) return false;
        if (receiver.received() != totalBytes || output[0] != 0xA5 || output[MAX_TEMPLATE_BYTES + 1] != 0xA5) return false;
        for (size_t index = 0; index < totalBytes; ++index)
            if (output[index + 1] != static_cast<uint8_t>(index)) return false;
        for (size_t index = totalBytes; index < MAX_TEMPLATE_BYTES; ++index)
            if (output[index + 1] != 0) return false;
        return receiver.append(0x08, nullptr, 0) == Result::InvalidBuffer;
    }

    constexpr bool allPacketSizes(size_t totalBytes, bool separateEnd, bool extraAck) {
        return validTransfer(totalBytes, 32, separateEnd, extraAck) &&
            validTransfer(totalBytes, 64, separateEnd, extraAck) &&
            validTransfer(totalBytes, 128, separateEnd, extraAck) &&
            validTransfer(totalBytes, 256, separateEnd, extraAck);
    }

    constexpr bool rejectsInvalidTransfers() {
        uint8_t output[MAX_TEMPLATE_BYTES] = {};
        uint8_t payload[256] = {};
        const uint8_t ok[] = {0};
        const uint8_t failure[] = {0x0D};
        Receiver shortEnd(output, sizeof(output));
        if (shortEnd.append(0x08, payload, 256) != Result::TooShort) return false;
        Receiver emptyEnd(output, sizeof(output));
        if (emptyEnd.append(0x08, nullptr, 0) != Result::EmptyData) return false;
        if (emptyEnd.append(0x02, nullptr, 0) != Result::EmptyData) return false;
        if (emptyEnd.append(0x01, payload, 1) != Result::UnexpectedPacket) return false;
        if (emptyEnd.append(0x07, failure, 1) != Result::InvalidAck) return false;
        if (emptyEnd.append(0x07, ok, 1) != Result::More) return false;
        if (emptyEnd.append(0x07, ok, 1) != Result::InvalidAck) return false;
        Receiver tooLong(output, sizeof(output));
        for (size_t offset = 0; offset < MAX_TEMPLATE_BYTES; offset += 256)
            if (tooLong.append(0x02, payload, 256) != Result::More) return false;
        if (tooLong.append(0x08, payload, 1) != Result::TooLong || tooLong.received() != MAX_TEMPLATE_BYTES) return false;
        if (tooLong.append(0x07, ok, 1) != Result::InvalidAck) return false;
        Receiver unsupported(output, sizeof(output));
        if (unsupported.append(0x02, payload, 256) != Result::More || unsupported.append(0x02, payload, 256) != Result::More) return false;
        if (unsupported.append(0x08, payload, 128) != Result::UnsupportedSize) return false;
        Receiver smallTransfer(output, MIN_TEMPLATE_BYTES);
        if (smallTransfer.append(0x02, payload, 256) != Result::More || smallTransfer.append(0x02, payload, 256) != Result::More) return false;
        if (smallTransfer.append(0x02, payload, 128) != Result::TooLong) return false;
        Receiver noBuffer(nullptr, MAX_TEMPLATE_BYTES);
        Receiver smallBuffer(output, MIN_TEMPLATE_BYTES - 1);
        return noBuffer.append(0x08, payload, 256) == Result::InvalidBuffer &&
            smallBuffer.append(0x08, payload, 256) == Result::InvalidBuffer;
    }

    // The observed failure was a fifth 128-byte DATA packet after byte 512.
    // Larger supported sizes must retain those bytes and wait for END.
    static_assert(allPacketSizes(512, false, false) && allPacketSizes(768, false, false) &&
        allPacketSizes(1024, false, false) && allPacketSizes(1536, false, false), "Every supported template size must retain all bytes through END.");
    static_assert(allPacketSizes(512, true, false) && allPacketSizes(768, true, false) &&
        allPacketSizes(1024, true, false) && allPacketSizes(1536, true, false), "A separate empty END must follow a complete supported template.");
    static_assert(allPacketSizes(512, true, true) && allPacketSizes(768, false, true) &&
        allPacketSizes(1024, true, true) && allPacketSizes(1536, false, true), "An extra successful ACK must never be copied into the template.");
    static_assert(rejectsInvalidTransfers(), "Invalid, incomplete, overlong, unsupported-size, and repeated-ACK transfers must fail closed.");
}
