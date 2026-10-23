
#include <Arduino.h>

// =====================================
// PIN CONFIGURATION
// =====================================

// RDM6300 RFID
constexpr uint8_t RFID_RX_PIN = 16;
constexpr uint32_t RFID_BAUDRATE = 9600;

// Relay
constexpr uint8_t DOOR_RELAY_PIN = 4;
constexpr uint8_t DOOR_RELAY2_PIN = 17;

// Based on your latest code
constexpr uint8_t DOOR_RELAY_ACTIVE_LEVEL = HIGH;
constexpr uint8_t DOOR_RELAY_IDLE_LEVEL = LOW;

// Unlock duration
constexpr uint32_t DOOR_UNLOCK_DURATION_MS = 3000;

// Registered RFID
const char REGISTERED_UID[] = "4300C46DDF";

// RFID Serial
HardwareSerial RFIDSerial(1);

// RFID frame
char rfidBuffer[13];
uint8_t rfidIndex = 0;
bool rfidReceiving = false;

// Door status
bool doorUnlocked = false;
unsigned long unlockStart = 0;

// Prevent repeated scans
String lastCardUID = "";
unsigned long lastCardSeen = 0;
const unsigned long CARD_REMOVAL_MS = 800;

// =====================================
// RELAY CONTROL
// =====================================

void holdRelaysLocked() {

  // Set intended idle level before OUTPUT
  digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
  digitalWrite(DOOR_RELAY2_PIN, DOOR_RELAY_IDLE_LEVEL);

  pinMode(DOOR_RELAY_PIN, OUTPUT);
  pinMode(DOOR_RELAY2_PIN, OUTPUT);

  digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
  digitalWrite(DOOR_RELAY2_PIN, DOOR_RELAY_IDLE_LEVEL);

  doorUnlocked = false;
}

void unlockDoor() {

  if (doorUnlocked) {
    return;
  }

  digitalWrite(
    DOOR_RELAY_PIN,
    DOOR_RELAY_ACTIVE_LEVEL
  );

  doorUnlocked = true;
  unlockStart = millis();

  Serial.println("ACCESS GRANTED");
  Serial.println("DOOR UNLOCKED");
  Serial.println("Auto-lock after 3 seconds.");
}

void lockDoor() {

  digitalWrite(
    DOOR_RELAY_PIN,
    DOOR_RELAY_IDLE_LEVEL
  );

  doorUnlocked = false;

  Serial.println("DOOR LOCKED");
}

// =====================================
// RFID CHECKSUM
// =====================================

int hexValue(char c) {

  if (c >= '0' && c <= '9')
    return c - '0';

  if (c >= 'A' && c <= 'F')
    return c - 'A' + 10;

  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;

  return -1;
}

bool validRFIDFrame(const char* frame) {

  uint8_t checksum = 0;

  for (int i = 0; i < 10; i += 2) {

    int high = hexValue(frame[i]);
    int low = hexValue(frame[i + 1]);

    if (high < 0 || low < 0)
      return false;

    checksum ^= (high << 4) | low;
  }

  int high = hexValue(frame[10]);
  int low = hexValue(frame[11]);

  if (high < 0 || low < 0)
    return false;

  uint8_t received = (high << 4) | low;

  return checksum == received;
}

// =====================================
// PROCESS RFID
// =====================================

void processRFID(String uid) {

  uid.toUpperCase();

  // Track how long the card is present
  lastCardSeen = millis();

  // Ignore repeated frames from same card
  if (uid == lastCardUID) {
    return;
  }

  lastCardUID = uid;

  Serial.println();
  Serial.println("================================");
  Serial.println("RFID CARD DETECTED");
  Serial.println("UID: " + uid);

  if (uid == REGISTERED_UID) {

    if (!doorUnlocked) {
      unlockDoor();
    }

  } else {

    Serial.println("ACCESS DENIED");
    Serial.println("RFID NOT REGISTERED");
    Serial.println("Door remains locked.");
  }

  Serial.println("================================");
}

// =====================================
// READ RFID
// =====================================

void readRFID() {

  while (RFIDSerial.available()) {

    uint8_t incoming = RFIDSerial.read();

    // Start of RFID frame
    if (incoming == 0x02) {

      rfidReceiving = true;
      rfidIndex = 0;
      continue;
    }

    if (!rfidReceiving)
      continue;

    // End of RFID frame
    if (incoming == 0x03) {

      if (rfidIndex == 12) {

        rfidBuffer[12] = '\0';

        if (validRFIDFrame(rfidBuffer)) {

          String uid =
            String(rfidBuffer).substring(0, 10);

          processRFID(uid);

        } else {

          Serial.println("Invalid RFID checksum.");
        }
      }

      rfidReceiving = false;
      rfidIndex = 0;
      continue;
    }

    if (rfidIndex < 12) {

      rfidBuffer[rfidIndex++] = (char)incoming;

    } else {

      rfidReceiving = false;
      rfidIndex = 0;
    }
  }
}

// =====================================
// SETUP
// =====================================

void setup() {

  // Initialize relays in locked state
  holdRelaysLocked();

  Serial.begin(115200);

  RFIDSerial.begin(
    RFID_BAUDRATE,
    SERIAL_8N1,
    RFID_RX_PIN,
    -1
  );

  delay(300);

  Serial.println();
  Serial.println("================================");
  Serial.println(" ESP32 RFID DOOR LOCK SYSTEM");
  Serial.println("================================");

  Serial.println("RFID Reader: GPIO 16");
  Serial.println("Door Relay: GPIO 4");
  Serial.println("Spare Relay: GPIO 17");

  Serial.println();
  Serial.println("Registered UID:");
  Serial.println(REGISTERED_UID);

  Serial.println();
  Serial.println("System Ready");
  Serial.println("Door commanded LOCKED");
  Serial.println("Waiting for RFID card...");
}

// =====================================
// LOOP
// =====================================

void loop() {

  // Automatically read RFID
  readRFID();

  // Automatically lock after 3 seconds
  if (doorUnlocked &&
      millis() - unlockStart >=
      DOOR_UNLOCK_DURATION_MS) {

    lockDoor();
  }

  // Allow scanning again after card removal
  if (lastCardUID.length() > 0 &&
      millis() - lastCardSeen >=
      CARD_REMOVAL_MS) {

    lastCardUID = "";
  }
}
