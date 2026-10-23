#ifndef COMBINED_RFID_FRAME_H
#define COMBINED_RFID_FRAME_H

#include <stddef.h>
#include <stdint.h>

namespace DoorRfidProtocol {
    constexpr int hexValue(char value) {
        return value >= '0' && value <= '9' ? value - '0'
            : value >= 'A' && value <= 'F' ? value - 'A' + 10
            : value >= 'a' && value <= 'f' ? value - 'a' + 10 : -1;
    }

    constexpr bool validFrame(const char *data, size_t length) {
        if (length != 12) return false;
        uint8_t checksum = 0;
        for (size_t index = 0; index < 12; index += 2) {
            const int high = hexValue(data[index]);
            const int low = hexValue(data[index + 1]);
            if (high < 0 || low < 0) return false;
            const uint8_t byte = static_cast<uint8_t>((high << 4) | low);
            if (index == 10) return checksum == byte;
            checksum ^= byte;
        }
        return false;
    }

    struct FrameParser {
        char data[12] = {};
        size_t count = 0;
        bool started = false;
        uint32_t startedAt = 0;

        constexpr void reset() { count = 0; started = false; startedAt = 0; }

        constexpr bool feed(uint8_t byte, uint32_t now, char *uid) {
            if (byte == 0x02) { count = 0; started = true; startedAt = now; return false; }
            if (!started) return false;
            if (static_cast<uint32_t>(now - startedAt) > 100) { reset(); return false; }
            if (byte == 0x03) {
                const bool valid = validFrame(data, count);
                if (valid) {
                    for (size_t index = 0; index < 10; ++index) {
                        uid[index] = data[index] >= 'a' && data[index] <= 'f'
                            ? static_cast<char>(data[index] - 'a' + 'A') : data[index];
                    }
                    uid[10] = '\0';
                }
                reset();
                return valid;
            }
            if (count >= sizeof(data) || hexValue(static_cast<char>(byte)) < 0) { reset(); return false; }
            data[count++] = static_cast<char>(byte);
            return false;
        }
    };
}

#endif
