#ifndef DOOR_FINGERPRINT_SEARCH_H
#define DOOR_FINGERPRINT_SEARCH_H

#include <stdint.h>
#include "SensorPacketProtocol.h"

namespace DoorFingerprintSearch {
    constexpr uint8_t OK = 0x00;
    constexpr uint8_t NOT_FOUND = 0x09;
    constexpr uint16_t UNSET_MATCH = 0xFFFF;

    constexpr bool communicationError(uint8_t status) {
        return status == 0x01 || status == 0xFE || status == 0xFF;
    }

    enum class Outcome { Matched, NoMatch, CommunicationError, SensorError, InvalidMatch };
    struct Result {
        Outcome outcome = Outcome::SensorError;
        uint8_t standardStatus = 0xFF;
        uint16_t matchedSlot = UNSET_MATCH;
        uint16_t confidence = UNSET_MATCH;
    };

    constexpr Result protocolFailure() {
        Result result;
        result.standardStatus = 0xFE; // Host-side protocol failure, distinct from a valid sensor ACK0x01.
        result.outcome = Outcome::CommunicationError;
        return result;
    }

    constexpr const char *acknowledgementError(const DoorSensorProtocol::Packet &packet) {
        if (packet.type != DoorSensorProtocol::ACK_PACKET) return "Search response has an unexpected packet type.";
        if (packet.length != 1 && packet.length != 5) return "Search ACK has an invalid payload length.";
        if (packet.data[0] == OK && packet.length != 5) return "Successful search ACK is missing its slot and confidence.";
        return nullptr;
    }

    constexpr Result decodeAcknowledgement(const DoorSensorProtocol::Packet &packet, uint16_t capacity) {
        if (acknowledgementError(packet) != nullptr) return protocolFailure();
        Result result;
        result.standardStatus = packet.data[0];
        const uint8_t status = result.standardStatus;
        if (status == OK) {
            result.matchedSlot = (static_cast<uint16_t>(packet.data[1]) << 8) | packet.data[2];
            result.confidence = (static_cast<uint16_t>(packet.data[3]) << 8) | packet.data[4];
            // Slot zero is not assigned by this application's backend. Reject a
            // malformed OK or stale ID instead of sending it for authorization.
            if (result.matchedSlot == 0 || result.matchedSlot == UNSET_MATCH ||
                result.confidence == UNSET_MATCH || result.matchedSlot >= capacity) {
                result.outcome = Outcome::InvalidMatch;
            } else result.outcome = Outcome::Matched;
        } else if (status == NOT_FOUND) result.outcome = Outcome::NoMatch;
        else if (communicationError(status)) result.outcome = Outcome::CommunicationError;
        else result.outcome = Outcome::SensorError;
        return result;
    }

    template <typename Sensor>
    constexpr void applyMatch(Sensor &sensor, const Result &result) {
        sensor.fingerID = sensor.confidence = UNSET_MATCH;
        if (result.outcome == Outcome::Matched) {
            sensor.fingerID = result.matchedSlot;
            sensor.confidence = result.confidence;
        }
    }
}

#endif
