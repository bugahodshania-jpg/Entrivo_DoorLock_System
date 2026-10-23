#ifndef DOOR_SENSOR_COMMAND_PROTOCOL_H
#define DOOR_SENSOR_COMMAND_PROTOCOL_H

#include "SensorPacketProtocol.h"

namespace DoorSensorCommand {
    constexpr uint8_t PROTOCOL_FAILURE = 0xFE;

    struct Command {
        uint8_t data[4] = {};
        uint8_t length = 0;
    };

    constexpr bool validBuffer(uint8_t buffer) { return buffer == 1 || buffer == 2; }
    constexpr Command getImage() { return {{0x01}, 1}; }
    constexpr Command generateModel() { return {{0x05}, 1}; }
    constexpr Command convertImage(uint8_t buffer) {
        return validBuffer(buffer) ? Command{{0x02, buffer}, 2} : Command{};
    }
    constexpr Command upload(uint8_t buffer) {
        return validBuffer(buffer) ? Command{{0x08, buffer}, 2} : Command{};
    }
    constexpr Command store(uint16_t slot, uint8_t buffer) {
        return validBuffer(buffer) ? Command{{0x06, buffer, static_cast<uint8_t>(slot >> 8), static_cast<uint8_t>(slot)}, 4} : Command{};
    }
    constexpr Command load(uint16_t slot, uint8_t buffer) {
        return validBuffer(buffer) ? Command{{0x07, buffer, static_cast<uint8_t>(slot >> 8), static_cast<uint8_t>(slot)}, 4} : Command{};
    }

    struct Acknowledgement {
        bool valid = false;
        uint8_t status = PROTOCOL_FAILURE;
    };

    // The packet must first pass the shared frame decoder. These commands have
    // exactly one status byte, unlike Search or parameter/index responses.
    constexpr Acknowledgement decodeAcknowledgement(const DoorSensorProtocol::Packet &packet) {
        return packet.type == DoorSensorProtocol::ACK_PACKET && packet.length == 1
            ? Acknowledgement{true, packet.data[0]} : Acknowledgement{};
    }
}

#endif
