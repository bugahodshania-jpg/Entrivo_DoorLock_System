#ifndef DOOR_SENSOR_COMMAND_PROTOCOL_H
#define DOOR_SENSOR_COMMAND_PROTOCOL_H

#include "SensorPacketProtocol.h"

namespace DoorSensorCommand {
    constexpr uint8_t PROTOCOL_FAILURE = 0xFE;

    struct Command {
        uint8_t data[6] = {};
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
    // DeletChar: start page plus count. Slot 0 is a valid physical page on R307S.
    constexpr Command remove(uint16_t slot, uint16_t count = 1) {
        return count == 0 ? Command{} : Command{{0x0C,
            static_cast<uint8_t>(slot >> 8), static_cast<uint8_t>(slot),
            static_cast<uint8_t>(count >> 8), static_cast<uint8_t>(count)}, 5};
    }
    constexpr Command emptyLibrary() { return {{0x0D}, 1}; }
    // Adafruit identification uses High-speed Search 0x1B with a 163-page window.
    // Opcode 0x04 Search on 1000-capacity R307S modules often reports 0x09/0x17
    // for a stored slot if the page window is larger than 163.
    constexpr Command search(uint16_t start, uint16_t count, uint8_t buffer = 1) {
        return validBuffer(buffer) && count > 0 ? Command{{0x04, buffer,
            static_cast<uint8_t>(start >> 8), static_cast<uint8_t>(start),
            static_cast<uint8_t>(count >> 8), static_cast<uint8_t>(count)}, 6} : Command{};
    }
    constexpr Command highSpeedSearch(uint16_t start, uint16_t count, uint8_t buffer = 1) {
        return validBuffer(buffer) && count > 0 ? Command{{0x1B, buffer,
            static_cast<uint8_t>(start >> 8), static_cast<uint8_t>(start),
            static_cast<uint8_t>(count >> 8), static_cast<uint8_t>(count)}, 6} : Command{};
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
