// R307 packet transfer adapted from the original door controller. All work runs while locked.
#include "SensorTransfer.h"
#include "Fingerprint.h"
#include "DoorHardware.h"
#include "TemplateStream.h"
#include "EnrollmentProof.h"
#include "SensorCommandProtocol.h"
#include <memory>
#include <new>

static_assert(DIRECT_TEMPLATE_MAX_BYTES == R307TemplateStream::MAX_TEMPLATE_BYTES, "Template buffer must support every database backup format.");

namespace
{
    constexpr uint8_t COMMAND_PACKET = 0x01;
    constexpr uint8_t DATA_PACKET = 0x02;
    constexpr uint8_t ACK_PACKET = 0x07;
    constexpr uint8_t END_DATA_PACKET = 0x08;
    constexpr uint32_t PACKET_TIMEOUT_MS = 4000;

    using SensorPacket = DoorSensorProtocol::Packet;

    const char *packetError(DoorSensorProtocol::Error error) {
        using DoorSensorProtocol::Error;
        switch (error) {
            case Error::Header: return "The fingerprint sensor returned an invalid packet header.";
            case Error::Address: return "The fingerprint sensor returned an unexpected packet address.";
            case Error::Length: return "The fingerprint sensor returned an invalid packet length.";
            case Error::Checksum: return "Fingerprint sensor packet checksum validation failed.";
            default: return "Timed out waiting for a complete fingerprint sensor packet.";
        }
    }

    void clearSerial()
    {
        while (FingerSerial.available() > 0)
        {
            FingerSerial.read();
        }
    }

    bool readByte(uint8_t &value, unsigned long startedAt)
    {
        while (millis() - startedAt < PACKET_TIMEOUT_MS)
        {
            if (FingerSerial.available() > 0)
            {
                value = static_cast<uint8_t>(FingerSerial.read());
                return true;
            }
            delay(1);
        }
        return false;
    }

    bool readPacket(SensorPacket &packet, String &errorMessage)
    {
        packet = SensorPacket{};
        const unsigned long startedAt = millis();
        uint8_t frame[DoorSensorProtocol::MAX_FRAME_BYTES] = {};
        for (size_t index = 0; index < DoorSensorProtocol::HEADER_BYTES; ++index)
        {
            if (!readByte(frame[index], startedAt))
            {
                errorMessage = "Timed out waiting for a complete fingerprint sensor packet.";
                return false;
            }
        }
        size_t frameBytes = 0;
        DoorSensorProtocol::Error validation = DoorSensorProtocol::frameSize(frame, DoorSensorProtocol::HEADER_BYTES, frameBytes);
        if (validation != DoorSensorProtocol::Error::None) {
            errorMessage = packetError(validation);
            return false;
        }
        for (size_t index = DoorSensorProtocol::HEADER_BYTES; index < frameBytes; ++index) {
            if (!readByte(frame[index], startedAt))
            {
                errorMessage = "Timed out waiting for a complete fingerprint sensor packet.";
                return false;
            }
        }
        validation = DoorSensorProtocol::decode(frame, frameBytes, packet);
        if (validation != DoorSensorProtocol::Error::None) {
            errorMessage = packetError(validation);
            return false;
        }
        return true;
    }

    bool writePacket(uint8_t type, const uint8_t *data, uint16_t length)
    {
        if (length > 256)
        {
            return false;
        }
        uint8_t packet[267] = {0xEF, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, type};
        const uint16_t wireLength = length + 2;
        packet[7] = wireLength >> 8;
        packet[8] = wireLength & 0xFF;
        uint16_t checksum = type + packet[7] + packet[8];
        for (uint16_t index = 0; index < length; ++index)
        {
            packet[9 + index] = data[index];
            checksum += data[index];
        }
        packet[9 + length] = checksum >> 8;
        packet[10 + length] = checksum & 0xFF;
        const size_t written = FingerSerial.write(packet, length + 11);
        FingerSerial.flush();
        return written == length + 11;
    }

    bool readAcknowledgement(uint8_t &code, String &errorMessage)
    {
        code = DoorSensorCommand::PROTOCOL_FAILURE;
        SensorPacket packet;
        if (!readPacket(packet, errorMessage))
        {
            return false;
        }
        const DoorSensorCommand::Acknowledgement acknowledgement = DoorSensorCommand::decodeAcknowledgement(packet);
        if (!acknowledgement.valid)
        {
            errorMessage = "The fingerprint sensor returned an unexpected acknowledgement.";
            return false;
        }
        code = acknowledgement.status;
        if (code != FINGERPRINT_OK)
        {
            errorMessage = "The fingerprint sensor rejected template data (code 0x" + String(code, HEX) + ").";
            return false;
        }
        return true;
    }

    uint8_t executeCheckedCommand(const DoorSensorCommand::Command &command, const char *name, String &errorMessage)
    {
        errorMessage = "";
        if (isDoorUnlocked() || command.length == 0 || command.length > sizeof(command.data)) {
            errorMessage = String(name) + " request is invalid or the door is unlocked.";
            return DoorSensorCommand::PROTOCOL_FAILURE;
        }
        clearSerial();
        if (!writePacket(COMMAND_PACKET, command.data, command.length)) {
            errorMessage = String("Could not transmit ") + name + " command.";
            return DoorSensorCommand::PROTOCOL_FAILURE;
        }
        SensorPacket packet;
        if (!readPacket(packet, errorMessage)) {
            errorMessage = String(name) + ": " + errorMessage;
            return DoorSensorCommand::PROTOCOL_FAILURE;
        }
        const DoorSensorCommand::Acknowledgement acknowledgement = DoorSensorCommand::decodeAcknowledgement(packet);
        if (!acknowledgement.valid) {
            errorMessage = String(name) + " returned an invalid ACK type or payload length.";
            return DoorSensorCommand::PROTOCOL_FAILURE;
        }
        if (acknowledgement.status != FINGERPRINT_OK)
            errorMessage = String(name) + " failed (code 0x" + String(acknowledgement.status, HEX) + ").";
        return acknowledgement.status;
    }

    uint8_t loadFingerprintModelVerified(uint16_t slot, uint8_t buffer, String &errorMessage)
    {
        errorMessage = "";
        const uint8_t status = slot == 0 || finger.capacity == 0 || slot >= finger.capacity
            ? DoorSensorCommand::PROTOCOL_FAILURE
            : executeCheckedCommand(DoorSensorCommand::load(slot, buffer), "LoadChar", errorMessage);
        if (status == DoorSensorCommand::PROTOCOL_FAILURE && errorMessage.length() == 0)
            errorMessage = "LoadChar requires a valid sensor slot.";
        Serial.print("[TEMPLATE] LoadChar buffer="); Serial.print(buffer);
        Serial.print(", slot="); Serial.print(slot); Serial.print(", status=0x"); Serial.println(status, HEX);
        return status;
    }

    bool sendTemplate(const uint8_t *data, size_t length, size_t chunkSize, bool &retryable, String &errorMessage)
    {
        retryable = true;
        clearSerial();
        const uint8_t command[] = {0x09, 0x01};
        uint8_t code = FINGERPRINT_PACKETRECIEVEERR;
        if (!writePacket(COMMAND_PACKET, command, sizeof(command)))
        {
            errorMessage = "Could not send the fingerprint template download command.";
            return false;
        }
        if (!readAcknowledgement(code, errorMessage))
        {
            retryable = code == DoorSensorCommand::PROTOCOL_FAILURE ||
                code == FINGERPRINT_PACKETRECIEVEERR || code == FINGERPRINT_PACKETRESPONSEFAIL;
            return false;
        }
        delay(20);
        for (size_t offset = 0; offset < length; offset += chunkSize)
        {
            const size_t count = min(chunkSize, length - offset);
            const bool last = offset + count == length;
            if (!writePacket(last ? END_DATA_PACKET : DATA_PACKET, data + offset, count))
            {
                errorMessage = "Could not transmit fingerprint template data to the sensor.";
                return false;
            }
            if (!last)
            {
                delay(30);
            }
        }
        // A final ACK is optional on compatible modules. The public restore
        // function validates any received ACK and then proves the buffer bytes.
        return true;
    }

    struct RestoreOperations {
        String &error;
        DoorEnrollmentProof::DownloadAck finalAck() {
            const unsigned long startedAt = millis();
            while (FingerSerial.available() == 0 && millis() - startedAt < 250UL) delay(1);
            if (FingerSerial.available() == 0) {
                Serial.println("[TEMPLATE] No final download ACK. Verifying current buffer bytes.");
                return DoorEnrollmentProof::DownloadAck::Absent;
            }
            // Once even one byte arrives, a full checksummed successful ACK
            // is required. Partial, malformed, and negative packets fail.
            uint8_t code = FINGERPRINT_PACKETRECIEVEERR;
            return readAcknowledgement(code, error) ? DoorEnrollmentProof::DownloadAck::Accepted :
                DoorEnrollmentProof::DownloadAck::Rejected;
        }
        bool readCurrent(uint8_t *data, size_t capacity, size_t &length) {
            return readCurrentTemplate(data, capacity, length, error);
        }
    };
}

uint8_t getFingerprintImageVerified()
{
    String error;
    const uint8_t status = executeCheckedCommand(DoorSensorCommand::getImage(), "GenImg", error);
    if (status == DoorSensorCommand::PROTOCOL_FAILURE) Serial.println(error);
    return status;
}

uint8_t convertFingerprintImageVerified(uint8_t buffer)
{
    String error;
    const uint8_t status = executeCheckedCommand(DoorSensorCommand::convertImage(buffer), "GenChar", error);
    if (status == DoorSensorCommand::PROTOCOL_FAILURE) Serial.println(error);
    return status;
}

uint8_t generateFingerprintModelVerified(String &errorMessage)
{
    return executeCheckedCommand(DoorSensorCommand::generateModel(), "RegModel", errorMessage);
}

uint8_t storeFingerprintModelVerified(uint16_t slot, uint8_t buffer, String &errorMessage)
{
    errorMessage = "";
    const uint8_t status = slot == 0 || finger.capacity == 0 || slot >= finger.capacity
        ? DoorSensorCommand::PROTOCOL_FAILURE
        : executeCheckedCommand(DoorSensorCommand::store(slot, buffer), "Store", errorMessage);
    if (status == DoorSensorCommand::PROTOCOL_FAILURE && errorMessage.length() == 0)
        errorMessage = "Store requires a valid sensor slot.";
    Serial.print("[TEMPLATE] Store buffer="); Serial.print(buffer);
    Serial.print(", slot="); Serial.print(slot); Serial.print(", status=0x"); Serial.println(status, HEX);
    return status;
}

DoorFingerprintSearch::Result searchFingerprintVerified(String *errorMessage)
{
    // Exactly one standard full-capacity Search command; no compatibility retry.
    DoorFingerprintSearch::applyMatch(finger, DoorFingerprintSearch::protocolFailure());
    if (errorMessage) *errorMessage = "";
    if (isDoorUnlocked() || finger.capacity == 0) {
        if (errorMessage) *errorMessage = "The sensor cannot search while unlocked or without a valid capacity.";
        return DoorFingerprintSearch::protocolFailure();
    }
    clearSerial();
    const uint8_t command[] = {0x04, 0x01, 0x00, 0x00,
        static_cast<uint8_t>(finger.capacity >> 8), static_cast<uint8_t>(finger.capacity & 0xFF)};
    String error;
    SensorPacket packet;
    if (!writePacket(COMMAND_PACKET, command, sizeof(command)) || !readPacket(packet, error)) {
        if (error.length() == 0) error = "Could not transmit search command.";
        if (errorMessage) *errorMessage = error;
        Serial.print("[FP] Standard search protocol failure: ");
        Serial.println(error);
        return DoorFingerprintSearch::protocolFailure();
    }
    const DoorFingerprintSearch::Result result = DoorFingerprintSearch::decodeAcknowledgement(packet, finger.capacity);
    const char *ackError = DoorFingerprintSearch::acknowledgementError(packet);
    if (ackError) {
        if (errorMessage) *errorMessage = ackError;
        Serial.print("[FP] Standard search protocol failure: "); Serial.println(ackError);
    }
    DoorFingerprintSearch::applyMatch(finger, result);
    return result;
}

namespace {
    const char *transferError(R307TemplateStream::Result result) {
        using R307TemplateStream::Result;
        switch (result) {
            case Result::UnexpectedPacket: return "unexpected packet type";
            case Result::InvalidAck: return "unexpected or unsuccessful acknowledgement";
            case Result::EmptyData: return "empty data packet or premature end";
            case Result::TooLong: return "sensor template exceeds the supported 1536-byte limit";
            case Result::TooShort: return "sensor ended before the minimum 512-byte template";
            case Result::UnsupportedSize: return "sensor template size is unsupported (expected 512, 768, 1024, or 1536 bytes)";
            default: return "invalid template buffer state";
        }
    }

    void drainTemplateTransfer() {
        const unsigned long startedAt = millis();
        unsigned long lastByteAt = startedAt;
        while (millis() - startedAt < 1500UL) {
            while (FingerSerial.available() > 0) { FingerSerial.read(); lastByteAt = millis(); }
            if (millis() - lastByteAt >= 120UL) break;
            delay(1);
        }
    }

bool readCurrentTemplateOnce(uint8_t buffer, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage)
{
    templateBytes = 0;
    if (isDoorUnlocked() || !DoorSensorCommand::validBuffer(buffer) || output == nullptr || capacity < DIRECT_TEMPLATE_MAX_BYTES)
    {
        errorMessage = "The fingerprint template read request is invalid.";
        return false;
    }
    // UpChar only: loading a stored slot here would destroy the captured model.
    const uint8_t uploadStatus = executeCheckedCommand(DoorSensorCommand::upload(buffer), "UpChar", errorMessage);
    if (uploadStatus != FINGERPRINT_OK)
    {
        return false;
    }
    const unsigned long startedAt = millis();
    R307TemplateStream::Receiver receiver(output, capacity);
    while (millis() - startedAt < 20000)
    {
        SensorPacket packet;
        if (!readPacket(packet, errorMessage))
        {
            errorMessage += " (received " + String(receiver.received()) + " bytes before END).";
            return false;
        }
        const size_t receivedBefore = receiver.received();
        const R307TemplateStream::Result result = receiver.append(packet.type, packet.data, packet.length);
        if (result == R307TemplateStream::Result::Complete) {
            templateBytes = receiver.received();
            return true;
        }
        if (result != R307TemplateStream::Result::More)
        {
            errorMessage = "Template read failed: " + String(transferError(result)) +
                " (packet 0x" + String(packet.type, HEX) +
                ", payload " + String(packet.length) + ", received " + String(receivedBefore) + " bytes before this packet).";
            return false;
        }
    }
    errorMessage = "Timed out while reading the stored fingerprint template.";
    return false;
}
}

bool readCurrentTemplateFromBuffer(uint8_t buffer, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage)
{
    templateBytes = 0;
    if (isDoorUnlocked() || !DoorSensorCommand::validBuffer(buffer) || output == nullptr || capacity < DIRECT_TEMPLATE_MAX_BYTES) {
        errorMessage = "The current fingerprint template read request is invalid.";
        return false;
    }
    for (uint8_t attempt = 1; attempt <= 3; ++attempt) {
        memset(output, 0, DIRECT_TEMPLATE_MAX_BYTES);
        if (readCurrentTemplateOnce(buffer, output, capacity, templateBytes, errorMessage)) { errorMessage = ""; return true; }
        drainTemplateTransfer();
    }
    return false;
}

bool readCurrentTemplate(uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage)
{
    return readCurrentTemplateFromBuffer(1, output, capacity, templateBytes, errorMessage);
}

bool readStoredTemplate(uint16_t slot, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage)
{
    templateBytes = 0;
    if (isDoorUnlocked() || slot == 0 || output == nullptr || capacity < DIRECT_TEMPLATE_MAX_BYTES) {
        errorMessage = "The fingerprint template read request is invalid.";
        return false;
    }
    for (uint8_t attempt = 1; attempt <= 3; ++attempt) {
        memset(output, 0, DIRECT_TEMPLATE_MAX_BYTES);
        errorMessage = "";
        const uint8_t loadStatus = loadFingerprintModelVerified(slot, 1, errorMessage);
        if (loadStatus == FINGERPRINT_OK &&
            readCurrentTemplateOnce(1, output, capacity, templateBytes, errorMessage)) { errorMessage = ""; return true; }
        Serial.print("[TEMPLATE] Read attempt "); Serial.print(attempt); Serial.print("/3: "); Serial.println(errorMessage);
        drainTemplateTransfer();
    }
    return false;
}

bool readSensorMemoryTemplate(uint16_t slot, uint8_t *output, size_t capacity, size_t &templateBytes, String &errorMessage)
{
    templateBytes = 0;
    if (isDoorUnlocked() || finger.capacity == 0 || slot >= finger.capacity ||
        output == nullptr || capacity < DIRECT_TEMPLATE_MAX_BYTES) {
        errorMessage = "The sensor memory template read request is invalid.";
        return false;
    }
    memset(output, 0, DIRECT_TEMPLATE_MAX_BYTES);
    // LoadChar copies flash into RAM; UpChar uploads RAM. Neither changes flash.
    // A single attempt avoids repeatedly blocking door scans on a disconnected sensor.
    const uint8_t status = executeCheckedCommand(DoorSensorCommand::load(slot, 1), "LoadChar", errorMessage);
    if (status == FINGERPRINT_OK && readCurrentTemplateOnce(1, output, capacity, templateBytes, errorMessage)) return true;
    drainTemplateTransfer();
    return false;
}

bool readSensorSlotIndexPage(uint8_t page, uint8_t *index, size_t indexBytes, String &errorMessage)
{
    if (isDoorUnlocked() || index == nullptr || indexBytes != 32)
    {
        errorMessage = "The sensor slot index cannot be read while the door is unlocked or without a complete index buffer.";
        return false;
    }
    const uint8_t command[] = {0x1F, page};
    clearSerial();
    if (!writePacket(COMMAND_PACKET, command, sizeof(command)))
    {
        errorMessage = "Could not request the sensor slot index.";
        return false;
    }
    SensorPacket packet;
    if (!readPacket(packet, errorMessage))
    {
        return false;
    }
    if (packet.type != ACK_PACKET || packet.length < 1 || packet.data[0] != FINGERPRINT_OK)
    {
        errorMessage = "The sensor did not confirm its slot index. Import was stopped to protect existing fingerprints.";
        return false;
    }

    const uint8_t *packetIndex = nullptr;
    if (packet.length == 33)
    {
        packetIndex = packet.data + 1;
    }
    else if (packet.length == 1)
    {
        if (!readPacket(packet, errorMessage))
        {
            return false;
        }
        if ((packet.type != DATA_PACKET && packet.type != END_DATA_PACKET) || packet.length != 32)
        {
            errorMessage = "The sensor returned an invalid slot index data packet.";
            return false;
        }
        packetIndex = packet.data;
    }
    else
    {
        errorMessage = "The sensor returned an invalid slot index size.";
        return false;
    }
    memcpy(index, packetIndex, indexBytes);
    return true;
}

bool isSensorSlotOccupied(uint16_t slot, bool &occupied, String &errorMessage)
{
    occupied = false;
    if (isDoorUnlocked() || finger.getParameters() != FINGERPRINT_OK || slot == 0 || slot >= finger.capacity)
    {
        errorMessage = "The reserved slot is outside the sensor capacity, or the sensor is unavailable.";
        return false;
    }
    uint8_t index[32] = {};
    if (!readSensorSlotIndexPage(static_cast<uint8_t>(slot / 256), index, sizeof(index), errorMessage)) return false;
    const uint16_t pageSlot = slot % 256;
    occupied = (index[pageSlot / 8] & (1U << (pageSlot % 8))) != 0;
    return true;
}

bool restoreCurrentTemplate(const uint8_t *data, size_t length, String &errorMessage)
{
    if (isDoorUnlocked() || !DoorEnrollmentProof::validTemplate(data, length))
    {
        errorMessage = "The generated fingerprint template is invalid or uniform. No sensor slot was written.";
        return false;
    }
    std::unique_ptr<uint8_t[]> restored(new (std::nothrow) uint8_t[DIRECT_TEMPLATE_MAX_BYTES]);
    if (!restored) {
        errorMessage = "Not enough memory to prove fingerprint buffer restoration. No sensor slot was written.";
        return false;
    }

    const size_t choices[] = {finger.packet_len, 128, 256, 64, 32};
    bool sent = false;
    for (size_t index = 0; index < sizeof(choices) / sizeof(choices[0]); ++index)
    {
        const size_t chunkSize = choices[index];
        if (chunkSize != 32 && chunkSize != 64 && chunkSize != 128 && chunkSize != 256)
        {
            continue;
        }
        bool repeated = false;
        for (size_t earlier = 0; earlier < index; ++earlier)
        {
            repeated = repeated || choices[earlier] == chunkSize;
        }
        if (repeated)
        {
            continue;
        }
        if (index > 0)
        {
            // Let a rejected transfer drain before starting a different packet size.
            const unsigned long quietAt = millis();
            while (millis() - quietAt < 800)
            {
                clearSerial();
                delay(20);
            }
            // Keep restoration independent of metadata queries and flash storage.
        }
        bool retryable = false;
        if (sendTemplate(data, length, chunkSize, retryable, errorMessage))
        {
            sent = true;
            break;
        }
        if (!retryable)
        {
            return false;
        }
    }
    if (!sent)
    {
        return false;
    }
    RestoreOperations operations{errorMessage};
    const DoorEnrollmentProof::RestoreResult proof = DoorEnrollmentProof::verifyRestoredBuffer(
        operations, data, length, restored.get(), DIRECT_TEMPLATE_MAX_BYTES);
    if (proof != DoorEnrollmentProof::RestoreResult::Verified) {
        if (proof == DoorEnrollmentProof::RestoreResult::BufferMismatch)
            errorMessage = "The restored sensor buffer was uniform or did not exactly match the captured template. No sensor slot was written.";
        else if (errorMessage.length() == 0)
            errorMessage = "The sensor did not confirm a valid fingerprint buffer restoration. No sensor slot was written.";
        return false;
    }
    return true;
}

bool writeImportedTemplate(uint16_t slot, const uint8_t *data, size_t length, String &errorMessage)
{
    if (isDoorUnlocked() || slot == 0 || !DoorEnrollmentProof::validTemplate(data, length)) {
        errorMessage = "The fingerprint import write request is invalid or uniform.";
        return false;
    }
    bool occupied = false;
    if (!isSensorSlotOccupied(slot, occupied, errorMessage)) return false;
    if (occupied) {
        errorMessage = "The reserved sensor slot is occupied. No fingerprint was overwritten.";
        return false;
    }
    if (!restoreCurrentTemplate(data, length, errorMessage)) return false;

    // Searching the received character buffer protects against duplicate physical templates.
    String searchError;
    const DoorFingerprintSearch::Result search = searchFingerprintVerified(&searchError);
    if (search.outcome == DoorFingerprintSearch::Outcome::Matched)
    {
        errorMessage = "This fingerprint already exists in sensor slot " + String(search.matchedSlot) +
            ". Import stopped to avoid creating a duplicate in reserved slot " + String(slot) + ".";
        return false;
    }
    if (search.outcome != DoorFingerprintSearch::Outcome::NoMatch)
    {
        errorMessage = "The sensor could not check for an existing fingerprint before import (standard search code 0x" +
            String(search.standardStatus, HEX) + ").";
        if (searchError.length()) errorMessage += " " + searchError;
        return false;
    }
    // Duplicate checking is a separate sensor command. Re-establish the exact
    // intended bytes afterward, immediately before writing the empty slot.
    if (!restoreCurrentTemplate(data, length, errorMessage)) return false;
    if (storeFingerprintModelVerified(slot, 1, errorMessage) != FINGERPRINT_OK)
    {
        return false;
    }
    return true;
}
