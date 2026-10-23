#ifndef DOOR_SENSOR_PACKET_PROTOCOL_H
#define DOOR_SENSOR_PACKET_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

namespace DoorSensorProtocol {
    constexpr size_t HEADER_BYTES = 9;
    constexpr size_t MAX_PAYLOAD_BYTES = 256;
    constexpr size_t MAX_FRAME_BYTES = HEADER_BYTES + MAX_PAYLOAD_BYTES + 2;
    constexpr uint8_t ACK_PACKET = 0x07;

    enum class Error { None, Truncated, Header, Address, Length, Checksum };
    struct Packet {
        uint8_t type = 0;
        uint16_t length = 0;
        uint8_t data[MAX_PAYLOAD_BYTES] = {};
    };

    constexpr Error frameSize(const uint8_t *frame, size_t available, size_t &expected) {
        expected = 0;
        if (frame == nullptr || available < HEADER_BYTES) return Error::Truncated;
        if (frame[0] != 0xEF || frame[1] != 0x01) return Error::Header;
        if (frame[2] != 0xFF || frame[3] != 0xFF || frame[4] != 0xFF || frame[5] != 0xFF)
            return Error::Address;
        const uint16_t wireLength = (static_cast<uint16_t>(frame[7]) << 8) | frame[8];
        if (wireLength < 2 || wireLength > MAX_PAYLOAD_BYTES + 2) return Error::Length;
        expected = HEADER_BYTES + wireLength;
        return Error::None;
    }

    // Decode only complete frames. No payload/status is exposed before every
    // header, address, length, and checksum check has passed.
    constexpr Error decode(const uint8_t *frame, size_t length, Packet &packet) {
        packet = Packet{};
        size_t expected = 0;
        const Error header = frameSize(frame, length, expected);
        if (header != Error::None) return header;
        if (length < expected) return Error::Truncated;
        if (length != expected) return Error::Length;
        uint16_t checksum = 0;
        for (size_t index = 6; index < length - 2; ++index) checksum += frame[index];
        if (checksum != ((static_cast<uint16_t>(frame[length - 2]) << 8) | frame[length - 1]))
            return Error::Checksum;
        packet.type = frame[6];
        packet.length = length - HEADER_BYTES - 2;
        for (size_t index = 0; index < packet.length; ++index) packet.data[index] = frame[HEADER_BYTES + index];
        return Error::None;
    }
}

#endif
