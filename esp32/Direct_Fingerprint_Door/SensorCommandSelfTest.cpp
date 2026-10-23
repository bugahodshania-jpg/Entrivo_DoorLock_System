#include "SensorCommandProtocol.h"

namespace {
    using namespace DoorSensorCommand;

    constexpr bool commandPayloads() {
        const Command image = getImage();
        const Command model = generateModel();
        if (image.length != 1 || image.data[0] != 0x01 || model.length != 1 || model.data[0] != 0x05) return false;
        for (uint8_t buffer = 1; buffer <= 2; ++buffer) {
            const Command convert = convertImage(buffer), up = upload(buffer);
            if (convert.length != 2 || convert.data[0] != 0x02 || convert.data[1] != buffer ||
                up.length != 2 || up.data[0] != 0x08 || up.data[1] != buffer) return false;
            const Command save = store(0x035A, buffer), read = load(0x035A, buffer);
            if (save.length != 4 || save.data[0] != 0x06 || save.data[1] != buffer || save.data[2] != 0x03 || save.data[3] != 0x5A ||
                read.length != 4 || read.data[0] != 0x07 || read.data[1] != buffer || read.data[2] != 0x03 || read.data[3] != 0x5A) return false;
        }
        const uint8_t invalid[] = {0, 3, 0xFF};
        for (uint8_t buffer : invalid) {
            if (convertImage(buffer).length != 0 || upload(buffer).length != 0 ||
                store(1, buffer).length != 0 || load(1, buffer).length != 0) return false;
        }
        return true;
    }

    constexpr Acknowledgement decode(const uint8_t *frame, size_t length) {
        DoorSensorProtocol::Packet packet;
        return DoorSensorProtocol::decode(frame, length, packet) == DoorSensorProtocol::Error::None
            ? decodeAcknowledgement(packet) : Acknowledgement{};
    }

    constexpr bool simpleAcks() {
        uint8_t frame[] = {0xEF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0x07, 0x00, 0x03, 0x00, 0x00, 0x0A};
        const uint8_t statuses[] = {0x00, 0x01, 0x02, 0x0A, 0x0B, 0x0C, 0x0D, 0x17, 0x18, 0xFE, 0xFF};
        for (uint8_t status : statuses) {
            const uint16_t sum = 0x0A + status;
            frame[9] = status; frame[10] = sum >> 8; frame[11] = sum & 0xFF;
            const Acknowledgement ack = decode(frame, sizeof(frame));
            if (!ack.valid || ack.status != status) return false;
        }
        frame[9] = 0; frame[10] = 0; frame[11] = 0x0A;
        for (size_t bytes = 0; bytes < sizeof(frame); ++bytes)
            if (decode(frame, bytes).valid || decode(frame, bytes).status != PROTOCOL_FAILURE) return false;
        frame[11] ^= 1;
        if (decode(frame, sizeof(frame)).valid) return false;
        frame[11] ^= 1; frame[0] ^= 1;
        if (decode(frame, sizeof(frame)).valid) return false;
        frame[0] ^= 1; frame[2] ^= 1;
        if (decode(frame, sizeof(frame)).valid) return false;
        frame[2] ^= 1; frame[6] = 0x02; frame[11] = 0x05;
        if (decode(frame, sizeof(frame)).valid) return false;
        // A valid checksummed Search ACK must not masquerade as a Store/Load ACK.
        const uint8_t search[] = {0xEF,0x01,0xFF,0xFF,0xFF,0xFF,0x07,0x00,0x07,0x00,0x00,0x0A,0x00,0x50,0x00,0x68};
        if (decode(search, sizeof(search)).valid) return false;
        DoorSensorProtocol::Packet packet;
        packet.type = DoorSensorProtocol::ACK_PACKET;
        const uint16_t invalidLengths[] = {0, 2, 3, 5, 256};
        for (uint16_t length : invalidLengths) {
            packet.length = length;
            if (decodeAcknowledgement(packet).valid || decodeAcknowledgement(packet).status != PROTOCOL_FAILURE) return false;
        }
        return true;
    }

    static_assert(commandPayloads(), "Native commands must select explicit buffer1/2 and encode full big-endian slots.");
    static_assert(simpleAcks(), "Only checksummed exact one-byte status ACKs may confirm native sensor commands.");
}
