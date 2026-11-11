#include <SoftwareSerial.h>
#include "Config.h"
#include "DoorHardware.h"
#include "Rfid.h"
#include "RfidFrame.h"

namespace {
    SoftwareSerial entrance;
    SoftwareSerial exitReader;
    DoorRfidProtocol::FrameParser parsers[2];
    String lastUid[2];
    // When each reader last saw its previous card. A reader repeats a card's
    // frame for as long as the card stays in range, so a card is accepted again
    // only after it has been away for RFID_COOLDOWN_MS (one tap = one scan).
    unsigned long lastSeenAt[2] = {};
    unsigned long switchedAt = 0;
    bool listeningExit = false;

    void selectReader(bool selectExit) {
        listeningExit = selectExit;
        parsers[selectExit ? 1 : 0].reset();
        if (selectExit) exitReader.listen();
        else entrance.listen();
        switchedAt = millis();
    }
}

void initRfidReaders() {
    entrance.begin(RFID_BAUDRATE, SWSERIAL_8N1, RFID_ENTRANCE_RX_PIN, -1, false, 128);
    exitReader.begin(RFID_BAUDRATE, SWSERIAL_8N1, RFID_EXIT_RX_PIN, -1, false, 128);
    selectReader(false);
}

void resetRfidReaders() {
    parsers[0].reset();
    parsers[1].reset();
    while (entrance.available() > 0) entrance.read();
    while (exitReader.available() > 0) exitReader.read();
    // A scan can block for seconds; restart the "away" timer so a card that
    // stayed on the reader during it is not taken as a new tap.
    lastSeenAt[0] = lastSeenAt[1] = millis();
    selectReader(isDoorUnlocked());
}

bool pollRfidReader(String &uid, bool &isExit) {
    // Keep a complete listen window per reader. While open, only EXIT can act.
    // Both readers are polled in turn, locked or unlocked: the outside reader
    // also records arrivals while the door is already open.
    if (millis() - switchedAt >= RFID_LISTEN_WINDOW_MS) {
        selectReader(!listeningExit);
    }
    SoftwareSerial &port = listeningExit ? exitReader : entrance;
    const size_t index = listeningExit ? 1 : 0;
    while (port.available() > 0) {
        char decoded[11] = {};
        if (!parsers[index].feed(static_cast<uint8_t>(port.read()), millis(), decoded)) continue;
        const String candidate(decoded);
        if (candidate == lastUid[index] && millis() - lastSeenAt[index] < RFID_COOLDOWN_MS) {
            lastSeenAt[index] = millis(); // Still in range: the same tap.
            continue;
        }
        lastUid[index] = candidate;
        lastSeenAt[index] = millis();
        uid = candidate;
        isExit = listeningExit;
        return true;
    }
    return false;
}
