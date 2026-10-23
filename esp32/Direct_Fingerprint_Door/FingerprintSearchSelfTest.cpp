#include "FingerprintSearch.h"

namespace {
    using namespace DoorFingerprintSearch;
    struct Frame {
        uint8_t bytes[DoorSensorProtocol::MAX_FRAME_BYTES] = {0xEF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF};
        size_t length = 0;
    };
    constexpr void checksum(Frame &frame) {
        uint16_t sum = 0;
        for (size_t index = 6; index < frame.length - 2; ++index) sum += frame.bytes[index];
        frame.bytes[frame.length - 2] = sum >> 8;
        frame.bytes[frame.length - 1] = sum & 0xFF;
    }
    constexpr Frame acknowledgement(uint8_t status = OK, uint8_t payload = 5, uint16_t id = 900, uint16_t score = 1234) {
        Frame frame;
        frame.length = DoorSensorProtocol::HEADER_BYTES + payload + 2;
        frame.bytes[6] = DoorSensorProtocol::ACK_PACKET;
        frame.bytes[8] = payload + 2;
        frame.bytes[9] = status;
        if (payload >= 5) {
            frame.bytes[10] = id >> 8; frame.bytes[11] = id & 0xFF;
            frame.bytes[12] = score >> 8; frame.bytes[13] = score & 0xFF;
        }
        checksum(frame);
        return frame;
    }
    constexpr Result decode(const Frame &frame, size_t bytes = 0) {
        DoorSensorProtocol::Packet packet;
        if (DoorSensorProtocol::decode(frame.bytes, bytes ? bytes : frame.length, packet) != DoorSensorProtocol::Error::None)
            return protocolFailure();
        return decodeAcknowledgement(packet, 1000);
    }
    constexpr bool validResponses() {
        const Result valid = decode(acknowledgement());
        if (valid.outcome != Outcome::Matched || valid.matchedSlot != 900 || valid.confidence != 1234) return false;
        const uint8_t statuses[] = {0x09, 0x17, 0x01};
        const uint8_t payloads[] = {1, 5};
        for (uint8_t status : statuses) {
            for (uint8_t payload : payloads) {
                const Result failed = decode(acknowledgement(status, payload));
                if (failed.standardStatus != status || failed.matchedSlot != UNSET_MATCH || failed.confidence != UNSET_MATCH) return false;
                if ((status == NOT_FOUND) != (failed.outcome == Outcome::NoMatch)) return false;
                if (communicationError(status) != (failed.outcome == Outcome::CommunicationError)) return false;
            }
        }
        // The R307S no-match frame ends in checksum0x0017; its status is0x09.
        const uint8_t noMatch[] = {0xEF,0x01,0xFF,0xFF,0xFF,0xFF,0x07,0x00,0x07,0x09,0x00,0x00,0x00,0x00,0x00,0x17};
        DoorSensorProtocol::Packet packet;
        if (DoorSensorProtocol::decode(noMatch, sizeof(noMatch), packet) != DoorSensorProtocol::Error::None) return false;
        const Result result = decodeAcknowledgement(packet, 1000);
        return result.standardStatus == 0x09 && result.outcome == Outcome::NoMatch;
    }
    constexpr bool malformedFrames() {
        const Frame valid = acknowledgement();
        for (size_t length = 1; length < valid.length; ++length)
            if (decode(valid, length).outcome != Outcome::CommunicationError) return false;
        Frame broken = valid; broken.bytes[0] ^= 1;
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        broken = valid; broken.bytes[2] ^= 1;
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        broken = valid; broken.bytes[6] = 0x02; checksum(broken);
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        broken = valid; broken.bytes[8] = 1;
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        broken = valid; broken.bytes[7] = 1; broken.bytes[8] = 3;
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        broken = valid; ++broken.bytes[8];
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        broken = valid; ++broken.length;
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        broken = valid; broken.bytes[15] ^= 1;
        if (decode(broken).outcome != Outcome::CommunicationError) return false;
        const uint8_t invalidSuccessLengths[] = {1, 2, 3, 4, 6};
        for (uint8_t length : invalidSuccessLengths)
            if (decode(acknowledgement(OK, length)).outcome != Outcome::CommunicationError) return false;
        const uint8_t invalidFailureLengths[] = {2, 6};
        for (uint8_t length : invalidFailureLengths)
            if (decode(acknowledgement(0x17, length)).outcome != Outcome::CommunicationError) return false;
        return true;
    }
    constexpr bool sharedPacketBoundaries() {
        // This decoder also reads template packets, including256-byte payloads.
        Frame frame;
        frame.length = DoorSensorProtocol::MAX_FRAME_BYTES;
        frame.bytes[6] = 0x02; frame.bytes[7] = 1; frame.bytes[8] = 2;
        for (size_t index = 0; index < DoorSensorProtocol::MAX_PAYLOAD_BYTES; ++index)
            frame.bytes[DoorSensorProtocol::HEADER_BYTES + index] = static_cast<uint8_t>(index);
        checksum(frame);
        DoorSensorProtocol::Packet packet;
        if (DoorSensorProtocol::decode(frame.bytes, frame.length, packet) != DoorSensorProtocol::Error::None ||
            packet.length != 256 || packet.data[255] != 255) return false;
        frame.bytes[frame.length - 1] ^= 1;
        if (DoorSensorProtocol::decode(frame.bytes, frame.length, packet) != DoorSensorProtocol::Error::Checksum ||
            packet.type != 0 || packet.length != 0 || packet.data[255] != 0) return false;
        return DoorSensorProtocol::decode(nullptr, 0, packet) == DoorSensorProtocol::Error::Truncated;
    }
    struct MatchFields { uint16_t fingerID = 88, confidence = 99; };
    constexpr bool staleAndInvalidMatches() {
        MatchFields sensor;
        const uint8_t statuses[] = {0x09, 0x17, 0x00};
        for (uint8_t status : statuses) {
            applyMatch(sensor, decode(acknowledgement()));
            if (sensor.fingerID != 900 || sensor.confidence != 1234) return false;
            // The final case is a short successful ACK with no ID/score fields.
            applyMatch(sensor, decode(acknowledgement(status, 1)));
            if (sensor.fingerID != UNSET_MATCH || sensor.confidence != UNSET_MATCH) return false;
        }
        const uint16_t invalidSlots[] = {0, 1000, UNSET_MATCH};
        for (uint16_t slot : invalidSlots) {
            const Result result = decode(acknowledgement(OK, 5, slot));
            if (result.outcome != Outcome::InvalidMatch) return false;
            applyMatch(sensor, result);
            if (sensor.fingerID != UNSET_MATCH || sensor.confidence != UNSET_MATCH) return false;
        }
        return decode(acknowledgement(OK, 5, 10, UNSET_MATCH)).outcome == Outcome::InvalidMatch;
    }
    static_assert(validResponses(), "Only validated ACK payloads may identify a match or preserve a sensor status.");
    static_assert(malformedFrames(), "Malformed and truncated search packets must fail as communication errors.");
    static_assert(sharedPacketBoundaries(), "The shared packet validator must handle full template packets and clear failed output.");
    static_assert(staleAndInvalidMatches(), "A failed search must never retain a previous or missing match.");
}
