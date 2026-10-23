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
    unsigned long lastAcceptedAt[2] = {};
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
    selectReader(isDoorUnlocked());
}

bool pollRfidReader(String &uid, bool &isExit) {
    // Keep a complete listen window per reader. While open, only EXIT can act.
    if (isDoorUnlocked()) {
        if (!listeningExit) selectReader(true);
    } else if (millis() - switchedAt >= RFID_LISTEN_WINDOW_MS) {
        selectReader(!listeningExit);
    }
    SoftwareSerial &port = listeningExit ? exitReader : entrance;
    const size_t index = listeningExit ? 1 : 0;
    while (port.available() > 0) {
        char decoded[11] = {};
        if (!parsers[index].feed(static_cast<uint8_t>(port.read()), millis(), decoded)) continue;
        const String candidate(decoded);
        if (candidate == lastUid[index] && millis() - lastAcceptedAt[index] < RFID_COOLDOWN_MS) continue;
        lastUid[index] = candidate;
        lastAcceptedAt[index] = millis();
        uid = candidate;
        isExit = listeningExit;
        return true;
    }
    return false;
}
