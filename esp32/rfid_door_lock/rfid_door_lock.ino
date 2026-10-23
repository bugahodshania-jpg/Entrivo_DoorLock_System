#include <Arduino.h>
#include <Preferences.h>
#include "driver/gpio.h"

#define RFID_RX 16
#define RELAY1 25

// Locked is LOW. A registered UID drives relay 1 HIGH.
// An unregistered UID leaves both relays LOW.
#define RELAY_ON HIGH
#define RELAY_OFF LOW

#define UNLOCK_TIME 3000
#define MAX_CARDS 30

// This is the only card that is stored on first boot.
// The lock stays off until this UID is scanned.
const char DEFAULT_UID[] = "4300C46DDF";

HardwareSerial RFID(1);
Preferences storage;

String cards[MAX_CARDS];
int cardCount = 0;

String lastUID = "";
String serialCommand = "";

bool unlocked = false;
unsigned long unlockTime = 0;
unsigned long lastScan = 0;

// Latch LOW before the pin becomes an output, so the relay stays off
// while the board is starting. A registered scan drives channel 1 HIGH.
void initRelaysLocked() {
  const gpio_num_t pins[] = {GPIO_NUM_25};

  for (gpio_num_t pin : pins) {
    gpio_set_pull_mode(pin, GPIO_PULLDOWN_ONLY);
    gpio_set_level(pin, 0);
    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
    gpio_set_level(pin, 0);
  }
}

class RelayBootLock {
 public:
  RelayBootLock() {
    initRelaysLocked();
  }
};

RelayBootLock relayBootLock;

// ==============================
// RELAY CONTROL
// ==============================

void lockDoor() {
  digitalWrite(RELAY1, RELAY_OFF);
  unlocked = false;
}

void unlockDoor() {
  digitalWrite(RELAY1, RELAY_ON);
  unlockTime = millis();
  unlocked = true;

  Serial.println("ACCESS GRANTED");
  Serial.println("DOOR UNLOCKED");
}

void updateRelay() {
  if (unlocked && millis() - unlockTime >= UNLOCK_TIME) {
    lockDoor();
    Serial.println("DOOR LOCKED");
    return;
  }

  // Stay locked until a registered UID is scanned.
  if (!unlocked) {
    digitalWrite(RELAY1, RELAY_OFF);
  }
}

// ==============================
// RFID STORAGE
// ==============================

void loadCards() {
  cardCount = storage.getInt("count", 0);

  if (cardCount < 0 || cardCount > MAX_CARDS) {
    cardCount = 0;
  }

  for (int i = 0; i < cardCount; i++) {
    String key = "card" + String(i);
    cards[i] = storage.getString(key.c_str(), "");
    cards[i].toUpperCase();
  }
}

void saveCards() {
  storage.putInt("count", cardCount);

  for (int i = 0; i < cardCount; i++) {
    String key = "card" + String(i);
    storage.putString(key.c_str(), cards[i]);
  }
}

bool isRegistered(String uid) {
  uid.toUpperCase();

  for (int i = 0; i < cardCount; i++) {
    if (cards[i] == uid) {
      return true;
    }
  }
  return false;
}

void ensureDefaultCard() {
  if (isRegistered(DEFAULT_UID) || cardCount >= MAX_CARDS) {
    return;
  }

  cards[cardCount++] = DEFAULT_UID;
  saveCards();
  Serial.print("REGISTERED UID: ");
  Serial.println(DEFAULT_UID);
}

void registerCard() {
  if (lastUID.length() != 10) {
    Serial.println("Scan RFID first.");
    return;
  }

  if (isRegistered(lastUID)) {
    Serial.println("UID already registered.");
    return;
  }

  if (cardCount >= MAX_CARDS) {
    Serial.println("Card storage full.");
    return;
  }

  cards[cardCount++] = lastUID;
  saveCards();

  Serial.print("REGISTERED UID: ");
  Serial.println(lastUID);
}

void listCards() {
  Serial.println("REGISTERED CARDS:");

  if (cardCount == 0) {
    Serial.println("No registered cards.");
  }

  for (int i = 0; i < cardCount; i++) {
    Serial.print(i + 1);
    Serial.print(". ");
    Serial.println(cards[i]);
  }
}

// ==============================
// RFID FRAME PARSING
// ==============================

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

bool hexByte(char a, char b, uint8_t &value) {
  int hi = hexDigit(a);
  int lo = hexDigit(b);

  if (hi < 0 || lo < 0) return false;

  value = (hi << 4) | lo;
  return true;
}

String readRFID() {
  static uint8_t frame[14];
  static int index = 0;
  static unsigned long lastByte = 0;

  while (RFID.available()) {
    uint8_t c = RFID.read();

    if (millis() - lastByte > 100) {
      index = 0;
    }

    lastByte = millis();

    if (c == 0x02) {
      index = 0;
      frame[index++] = c;
      continue;
    }

    if (index == 0) continue;

    if (index >= 14) {
      index = 0;
      continue;
    }

    frame[index++] = c;

    if (index == 14) {
      index = 0;

      if (frame[13] != 0x03) return "";

      uint8_t checksum = 0;

      for (int i = 0; i < 5; i++) {
        uint8_t value;

        if (!hexByte(
          frame[1 + i * 2],
          frame[2 + i * 2],
          value
        )) return "";

        checksum ^= value;
      }

      uint8_t received;

      if (!hexByte(
        frame[11],
        frame[12],
        received
      )) return "";

      if (checksum != received) return "";

      String uid = "";

      for (int i = 1; i <= 10; i++) {
        uid += (char)frame[i];
      }

      uid.toUpperCase();
      return uid;
    }
  }

  return "";
}

// ==============================
// SERIAL COMMANDS
// ==============================

void showMenu() {
  Serial.println();
  Serial.println("ESP32 RFID DOOR CONTROLLER");
  Serial.println("--------------------------");
  Serial.println("REGISTER - Save last UID");
  Serial.println("LIST     - List cards");
  Serial.println("DELETE   - Remove extra cards");
  Serial.println("MENU     - Show menu");
  Serial.println("--------------------------");
  Serial.println("The door stays locked until a registered UID is scanned.");
}

void handleCommand(String command) {
  command.trim();
  command.toUpperCase();

  if (command == "REGISTER") {
    registerCard();
  }
  else if (command == "LIST") {
    listCards();
  }
  else if (command == "DELETE") {
    storage.clear();
    cardCount = 0;
    ensureDefaultCard();
    Serial.println("Extra cards deleted. 4300C46DDF stays registered.");
  }
  else if (command == "MENU") {
    showMenu();
  }
  else if (command.length() > 0) {
    Serial.println("Unknown command.");
  }
}

// ==============================
// SETUP
// ==============================

void setup() {
  initRelaysLocked();
  lockDoor();

  Serial.begin(115200);

  RFID.begin(
    9600,
    SERIAL_8N1,
    RFID_RX,
    -1
  );

  storage.begin("rfidcards", false);
  loadCards();
  ensureDefaultCard();
  lockDoor();

  Serial.println("RFID DOOR CONTROLLER READY");
  Serial.println("Relay is locked. It unlocks only after a registered UID is scanned.");
  Serial.print("Registered cards: ");
  Serial.println(cardCount);

  showMenu();
}

// ==============================
// LOOP
// ==============================

void loop() {
  updateRelay();

  String uid = readRFID();

  if (uid.length() == 10) {
    if (uid != lastUID || millis() - lastScan > 2000) {
      lastUID = uid;
      lastScan = millis();

      Serial.println();
      Serial.print("SCANNED UID: ");
      Serial.println(uid);

      if (isRegistered(uid)) {
        unlockDoor();
      } else {
        Serial.println("ACCESS DENIED");
        Serial.println("UID NOT REGISTERED");
        if (!unlocked) {
          lockDoor();
        }
      }
    }
  }

  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {
      if (serialCommand.length() > 0) {
        handleCommand(serialCommand);
        serialCommand = "";
      }
    } else if (serialCommand.length() < 64) {
      serialCommand += c;
    }
  }
}
