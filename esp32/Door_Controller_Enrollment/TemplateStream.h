#ifndef COMBINED_TEMPLATE_STREAM_H
#define COMBINED_TEMPLATE_STREAM_H

#include <stddef.h>
#include <stdint.h>

// Input packets must already have passed address, length, and checksum checks.
namespace R307TemplateStream {
    constexpr size_t MIN_TEMPLATE_BYTES = 512;
    constexpr size_t MAX_TEMPLATE_BYTES = 1536;
    constexpr bool supportedSize(size_t length) {
        return length == 512 || length == 768 || length == 1024 || length == 1536;
    }
    enum class Result { More, Complete, InvalidBuffer, UnexpectedPacket, InvalidAck, EmptyData, TooLong, TooShort, UnsupportedSize };

    class Receiver {
    public:
        constexpr Receiver(uint8_t *destination, size_t capacity) : output(destination), capacity(capacity) {}
        constexpr size_t received() const { return count; }

        constexpr Result append(uint8_t type, const uint8_t *payload, size_t length) {
            if (finished || output == nullptr || capacity < MIN_TEMPLATE_BYTES || (length > 0 && payload == nullptr))
                return Result::InvalidBuffer;
            // Some modules repeat the successful upload ACK. It is never template data.
            if (type == 0x07) {
                if (count == 0 && extraAcks == 0 && length == 1 && payload[0] == 0) {
                    ++extraAcks;
                    return Result::More;
                }
                return Result::InvalidAck;
            }
            if (type != 0x02 && type != 0x08) return Result::UnexpectedPacket;
            // The END packet, not the first 512 bytes, determines the full template size.
            if (length == 0) {
                if (type == 0x08 && supportedSize(count)) { finished = true; return Result::Complete; }
                return Result::EmptyData;
            }
            const size_t limit = capacity < MAX_TEMPLATE_BYTES ? capacity : MAX_TEMPLATE_BYTES;
            if (length > limit - count) return Result::TooLong;
            for (size_t index = 0; index < length; ++index) output[count + index] = payload[index];
            count += length;
            if (type == 0x08) {
                if (count < MIN_TEMPLATE_BYTES) return Result::TooShort;
                if (!supportedSize(count)) return Result::UnsupportedSize;
                finished = true;
                return Result::Complete;
            }
            return Result::More;
        }

    private:
        uint8_t *output;
        size_t capacity;
        size_t count = 0;
        uint8_t extraAcks = 0;
        bool finished = false;
    };
}

#endif
