/*
  Fingerprint bench test (R307S) - isolates the sensor from the door firmware.

  Uses only the stock Adafruit Fingerprint library calls (enroll.ino /
  fingerprint.ino). No WiFi, no backend, no custom packets.

  Same wiring as Door_Controller_Enrollment: UART1, ESP32 RX=GPIO32 <- sensor TX,
  ESP32 TX=GPIO33 -> sensor RX, 57600 baud.

  Serial Monitor at 115200, then type a letter and press Enter:
    e = enroll a finger into TEST_SLOT (two scans -> createModel -> storeModel)
    v = verify: one scan -> fingerFastSearch (slots 0-162)
    m = 1:1 match of one scan against TEST_SLOT only
    x = RAM vs FLASH test: does the new model match before AND after it is saved?
    d = delete TEST_SLOT (do this when you are done testing)
    c = show stored template count

  TEST_SLOT is not used by the door system. Delete it after testing (press d).
*/

#include <Adafruit_Fingerprint.h>

HardwareSerial FingerSerial(1);
Adafruit_Fingerprint finger(&FingerSerial);

constexpr uint16_t TEST_SLOT = 150;

uint8_t waitImage() {
  Serial.println("  Place finger...");
  uint8_t p;
  while ((p = finger.getImage()) == FINGERPRINT_NOFINGER) delay(50);
  return p;
}

void waitRemoval() {
  Serial.println("  Remove finger.");
  delay(800);
  while (finger.getImage() != FINGERPRINT_NOFINGER) delay(50);
}

bool scanInto(uint8_t buffer) {
  uint8_t p = waitImage();
  if (p != FINGERPRINT_OK) { Serial.printf("  getImage error 0x%02X\n", p); return false; }
  p = finger.image2Tz(buffer);
  if (p != FINGERPRINT_OK) { Serial.printf("  image2Tz(%u) error 0x%02X\n", buffer, p); return false; }
  Serial.printf("  Scan converted into buffer %u.\n", buffer);
  return true;
}

void enroll() {
  Serial.printf("\n== ENROLL into slot %u ==\n", TEST_SLOT);
  finger.deleteModel(TEST_SLOT);
  if (!scanInto(1)) return;
  waitRemoval();
  Serial.println("  Same finger again.");
  if (!scanInto(2)) return;
  uint8_t p = finger.createModel();
  Serial.printf("  createModel: 0x%02X %s\n", p, p == FINGERPRINT_OK ? "OK" : p == FINGERPRINT_ENROLLMISMATCH ? "scans did not match" : "error");
  if (p != FINGERPRINT_OK) return;
  p = finger.storeModel(TEST_SLOT);
  Serial.printf("  storeModel(%u): 0x%02X %s\n", TEST_SLOT, p, p == FINGERPRINT_OK ? "OK" : "error");
  waitRemoval();
  Serial.println("  Done. Now press v (or m) and scan the same finger.");
}

void verify() {
  Serial.println("\n== VERIFY (fingerFastSearch slots 0-162) ==");
  if (!scanInto(1)) return;
  uint8_t p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK)
    Serial.printf("  MATCH: slot %u, confidence %u %s\n", finger.fingerID, finger.confidence,
                  finger.fingerID == TEST_SLOT ? "(the test slot)" : "(another stored finger)");
  else if (p == FINGERPRINT_NOTFOUND) Serial.println("  NO MATCH (0x09)");
  else Serial.printf("  search error 0x%02X\n", p);
  waitRemoval();
}

// Match (0x03): compare buffer 1 with buffer 2. The library has no wrapper.
void matchBuffers(const char *label) {
  uint8_t command[] = {0x03};
  Adafruit_Fingerprint_Packet request(FINGERPRINT_COMMANDPACKET, sizeof(command), command);
  finger.writeStructuredPacket(request);
  Adafruit_Fingerprint_Packet reply(FINGERPRINT_ACKPACKET, 0, nullptr);
  if (finger.getStructuredPacket(&reply) != FINGERPRINT_OK || reply.type != FINGERPRINT_ACKPACKET) {
    Serial.printf("  %s: no valid reply to Match.\n", label);
  } else if (reply.data[0] == FINGERPRINT_OK) {
    Serial.printf("  %s: MATCH, score %u\n", label, (reply.data[1] << 8) | reply.data[2]);
  } else {
    Serial.printf("  %s: NO MATCH (0x%02X)\n", label, reply.data[0]);
  }
}

void matchOne() {
  Serial.printf("\n== 1:1 MATCH against slot %u ==\n", TEST_SLOT);
  if (!scanInto(2)) return;           // live scan -> buffer 2
  uint8_t p = finger.loadModel(TEST_SLOT); // stored slot -> buffer 1
  if (p != FINGERPRINT_OK) { Serial.printf("  loadModel error 0x%02X (slot empty?)\n", p); return; }
  matchBuffers("Saved slot vs live scan");
  waitRemoval();
}

// The model straight from createModel (still in the sensor's RAM) vs the same
// model after storeModel + loadModel (read back from the sensor's flash).
// RAM matches but flash does not -> the sensor stores new templates wrongly.
// Both fail -> the scans themselves differ (finger placement or sensor glass).
void ramVsFlash() {
  Serial.printf("\n== RAM vs FLASH test (slot %u) ==\n", TEST_SLOT);
  finger.deleteModel(TEST_SLOT);
  Serial.println("  Scan 1 of 4.");
  if (!scanInto(1)) return;
  waitRemoval();
  Serial.println("  Scan 2 of 4 (same finger).");
  if (!scanInto(2)) return;
  uint8_t p = finger.createModel();
  Serial.printf("  createModel: 0x%02X\n", p);
  if (p != FINGERPRINT_OK) return;
  p = finger.storeModel(TEST_SLOT);    // model stays in buffer 1
  Serial.printf("  storeModel(%u): 0x%02X\n", TEST_SLOT, p);
  if (p != FINGERPRINT_OK) return;
  waitRemoval();

  Serial.println("  Scan 3 of 4 (same finger).");
  if (!scanInto(2)) return;           // buffer 1 still holds the model from RAM
  matchBuffers("A) Model in RAM vs scan 3");
  waitRemoval();

  Serial.println("  Scan 4 of 4 (same finger).");
  if (!scanInto(2)) return;
  p = finger.loadModel(TEST_SLOT);     // model read back from flash -> buffer 1
  if (p != FINGERPRINT_OK) { Serial.printf("  loadModel error 0x%02X\n", p); return; }
  matchBuffers("B) Model from FLASH vs scan 4");
  waitRemoval();
  Serial.println("  Done. Paste this result. Press d to delete the test slot.");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  FingerSerial.begin(57600, SERIAL_8N1, 32, 33);
  finger.begin(57600);
  FingerSerial.begin(57600, SERIAL_8N1, 32, 33);
  if (!finger.verifyPassword()) {
    Serial.println("Sensor NOT found. Check wiring (RX=32, TX=33) and power.");
    while (true) delay(1000);
  }
  finger.getParameters();
  finger.getTemplateCount();
  Serial.printf("\nSensor OK. Capacity %u, security level %u, stored %u.\n",
                finger.capacity, finger.security_level, finger.templateCount);
  Serial.println("Commands: x = RAM vs FLASH test, e = enroll, v = verify, m = 1:1 match, d = delete test slot, c = count");
}

void loop() {
  if (!Serial.available()) { delay(20); return; }
  const char c = Serial.read();
  if (c == 'e' || c == 'E') enroll();
  else if (c == 'v' || c == 'V') verify();
  else if (c == 'm' || c == 'M') matchOne();
  else if (c == 'x' || c == 'X') ramVsFlash();
  else if (c == 'd' || c == 'D') {
    const uint8_t p = finger.deleteModel(TEST_SLOT);
    Serial.printf("\nDelete slot %u: 0x%02X\n", TEST_SLOT, p);
  } else if (c == 'c' || c == 'C') {
    finger.getTemplateCount();
    Serial.printf("\nStored templates: %u\n", finger.templateCount);
  }
}
