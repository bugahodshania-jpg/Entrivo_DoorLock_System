// Door_controller_testing_hardware onlt bot intergrated into web


#include <Arduino.h>
#include <Preferences.h>
#include <Adafruit_Fingerprint.h>
#include <SoftwareSerial.h> // Library: EspSoftwareSerial by Dirk Kaar
#include <Wire.h>
#include <RTClib.h>         // Library: RTClib by Adafruit

// ESP32 pin assignment (sensor TX connects to ESP32 RX)
#define FP_RX 32
#define FP_TX 33
#define RFID_ENTRANCE_RX 14
#define RFID_EXIT_RX 27
#define RTC_SDA 19
#define RTC_SCL 21
#define MP3_RX 25
#define MP3_TX 26
#define RELAY1 4
#define RELAY2 17
#define TOUCH_PIN 18

// Settings
constexpr int MAX_USERS = 50;
constexpr uint16_t MAX_FINGER_ID = 127; // Check your R307S capacity
constexpr unsigned long RFID_COOLDOWN_MS = 1800;
constexpr uint8_t TOUCH_ACTIVE = HIGH; // Typical TTP223: HIGH when touched
constexpr uint8_t RELAY_ON = HIGH;
constexpr uint8_t RELAY_OFF = LOW;
// Exit authorization stays valid until touch locks the door.
constexpr unsigned long RFID_LISTEN_WINDOW_MS = 650;

// IMPORTANT: Adjust for YOUR relay/solenoid combination.
// Matches the supplied working hardware-test sketch:
// GPIO 17 (IN2) HIGH = relay energized / unlock; LOW = idle / lock.
// GPIO 4 (IN1) stays LOW and is not used for door control.
// Verify with the real lock before installation.
constexpr uint8_t DOOR_RELAY_PIN = 4;
constexpr uint8_t DOOR_RELAY2_PIN = 17;
constexpr uint8_t DOOR_RELAY_ACTIVE_LEVEL = HIGH;
constexpr uint8_t DOOR_RELAY_IDLE_LEVEL = LOW;
constexpr uint32_t DOOR_UNLOCK_DURATION_MS = 3000;

HardwareSerial FingerUART(1);
HardwareSerial Mp3UART(2);
Adafruit_Fingerprint finger(&FingerUART);
SoftwareSerial entranceRFID;
SoftwareSerial exitRFID;
RTC_DS3231 rtc;
Preferences prefs;

struct Credential { String uid; uint16_t fingerId; } users[MAX_USERS];
int userCount = 0;
bool unlocked = false;
bool exitAuthorized = false; // Registered EXIT RFID must be scanned before touch can lock

bool rtcOK = false;
unsigned long lastTouchMs = 0;
unsigned long lastAcceptedScanMs = 0;
String lastScanKey;

struct RFIDFrame {
  char data[13];
  uint8_t pos = 0;
  bool inFrame = false;
};
RFIDFrame entranceFrame, exitFrame;

void mp3Command(uint8_t cmd, uint16_t value) {
  uint8_t pkt[10] = {0x7E,0xFF,0x06,cmd,0x00,(uint8_t)(value>>8),(uint8_t)value,0,0,0xEF};
  uint16_t sum = 0;
  for (int i=1; i<=6; i++) sum += pkt[i];
  uint16_t checksum = (uint16_t)(0 - sum);
  pkt[7] = checksum >> 8; pkt[8] = checksum & 0xFF;
  Mp3UART.write(pkt, 10);
}
void playAudio(uint16_t number) { mp3Command(0x12, number); } // /MP3/0001.mp3 ...

void setDoor(bool open, bool announce=true) {
  // Always drive GPIO17, even if the software state already matches.
  digitalWrite(RELAY2, open ? RELAY_ON : RELAY_OFF);
  if (open == unlocked) return;
  unlocked = open;
  exitAuthorized = false;
  Serial.println(open ? "[DOOR] UNLOCKED (waiting for touch to lock)" : "[DOOR] LOCKED");
  if (announce) playAudio(open ? 1 : 9);
}

void printTime() {
  if (!rtcOK) { Serial.print("[RTC unavailable] "); return; }
  DateTime t = rtc.now();
  char s[25];
  snprintf(s,sizeof(s),"%04d-%02d-%02d %02d:%02d:%02d",t.year(),t.month(),t.day(),t.hour(),t.minute(),t.second());
  Serial.print(s); Serial.print(' ');
}

int findUID(const String &uid) {
  for (int i=0;i<userCount;i++) if(uid.length() && users[i].uid == uid) return i;
  return -1;
}
int findFinger(uint16_t id) {
  for (int i=0;i<userCount;i++) if(id != 0 && users[i].fingerId == id) return i;
  return -1;
}
uint16_t freeFingerID() {
  for (uint16_t id=1;id<=MAX_FINGER_ID;id++) if(findFinger(id)<0) return id;
  return 0;
}
void saveUsers() {
  prefs.putUInt("count",userCount);
  for(int i=0;i<userCount;i++) {
    String u="u"+String(i), f="f"+String(i);
    prefs.putString(u.c_str(),users[i].uid);
    prefs.putUShort(f.c_str(),users[i].fingerId);
  }
}
void loadUsers() {
  userCount = min((int)prefs.getUInt("count",0),MAX_USERS);
  for(int i=0;i<userCount;i++) {
    String u="u"+String(i), f="f"+String(i);
    users[i].uid=prefs.getString(u.c_str(),"");
    users[i].fingerId=prefs.getUShort(f.c_str(),0);
  }
}

// RDM6300: STX + 10 hex UID characters + 2 hex checksum + ETX.
// Both readers share the same saved UID database.
bool feedRFID(RFIDFrame &frame, char c, String &uid) {
  uint8_t b=(uint8_t)c;
  if(b==0x02) { frame.inFrame=true; frame.pos=0; return false; }
  if(!frame.inFrame) return false;
  if(b==0x03) {
    bool valid=frame.pos==12;
    frame.inFrame=false;
    if(!valid) return false;
    uint8_t check=0;
    for(int i=0;i<10;i+=2) {
      char a=frame.data[i], d=frame.data[i+1];
      if(!isxdigit((unsigned char)a)||!isxdigit((unsigned char)d)) return false;
      char pair[3]={a,d,0}; check ^= (uint8_t)strtoul(pair,nullptr,16);
    }
    char cs[3]={frame.data[10],frame.data[11],0};
    if(!isxdigit((unsigned char)cs[0])||!isxdigit((unsigned char)cs[1])) return false;
    if(check!=(uint8_t)strtoul(cs,nullptr,16)) return false;
    frame.data[10]=0;
    uid=String(frame.data); uid.toUpperCase();
    return true;
  }
  if(frame.pos>=12) { frame.inFrame=false; return false; }
  frame.data[frame.pos++]=(char)toupper((unsigned char)b);
  return false;
}

void grant(const String &method) {
  printTime(); Serial.println("ACCESS GRANTED: " + method);
  if(!unlocked) setDoor(true);
  else Serial.println("Door already unlocked");
}
void deny(const String &method) {
  printTime(); Serial.println("NOT REGISTERED: " + method);
  playAudio(3);
}
void handleRFID(String uid, const char *reader) {
  String key=String(reader)+uid;
  if(key==lastScanKey && millis()-lastAcceptedScanMs<RFID_COOLDOWN_MS) return;
  lastScanKey=key; lastAcceptedScanMs=millis();
  Serial.println(String("[RFID ")+reader+"] UID: "+uid);
  if(findUID(uid)<0) { deny(String("RFID ")+reader); return; }
  if(String(reader)=="EXIT") {
    if(unlocked) {
      exitAuthorized=true;
      Serial.println("[EXIT] Authorized. Playing audio 0011; now TOUCH GPIO18 to LOCK the door.");
      playAudio(11); // /MP3/0011.mp3 - Exit RFID verified; touch sensor to lock
    } else Serial.println("[EXIT] Door already locked. Scan at entrance to unlock.");
  } else grant("RFID ENTRANCE");
}
void readReader(SoftwareSerial &port, RFIDFrame &frame, const char *name, bool access=true, String *capture=nullptr) {
  while(port.available()) {
    String uid;
    if(feedRFID(frame,(char)port.read(),uid)) {
      if(capture) { if(capture->length()==0) *capture=uid; }
      else if(access) handleRFID(uid,name);
    }
  }
}

// EspSoftwareSerial only receives on one reader at a time.
// Give each reader enough time to receive a WHOLE 14-byte RDM6300 frame
// (~15 ms at 9600 baud), instead of switching every 45 ms.
// While the door is open, prioritize the EXIT reader for touch-to-lock.
// Hold the RFID card in front of the reader until a UID is printed.
void pollRFIDs(bool access=true, String *captureEntrance=nullptr) {
  static unsigned long switchedAt = 0;
  static bool entranceActive = true;
  const unsigned long now = millis();
  if (now - switchedAt >= RFID_LISTEN_WINDOW_MS) {
    entranceActive = !entranceActive;
    if (entranceActive) {
      entranceFrame = RFIDFrame();
      entranceRFID.listen();
    } else {
      exitFrame = RFIDFrame();
      exitRFID.listen();
    }
    switchedAt = now;
  }
  if (entranceActive)
    readReader(entranceRFID, entranceFrame, "ENTRANCE", access, captureEntrance);
  else
    readReader(exitRFID, exitFrame, "EXIT", access, nullptr);
}

void pollTouch() {
  static bool prev = false;
  static unsigned long lastDebug = 0;
  bool pressed = digitalRead(TOUCH_PIN) == TOUCH_ACTIVE;
  if (pressed != prev) {
    Serial.println(pressed ? "[TOUCH] PRESSED GPIO18" : "[TOUCH] RELEASED GPIO18");
  }
  if (pressed && !prev && millis() - lastTouchMs > 300) {
    lastTouchMs = millis();
    if (unlocked && exitAuthorized) {
      Serial.println("[TOUCH] Exit authorized: locking door and playing audio 0009");
      setDoor(false);
    } else if (unlocked) {
      Serial.println("[TOUCH] Scan a REGISTERED EXIT RFID first, then touch to LOCK.");
    } else {
      Serial.println("[TOUCH] Door already locked");
    }
  }
  prev = pressed;
}

void pollFingerprint() {
  static unsigned long lastPoll=0;
  static bool waitingRemoval=false;
  if(millis()-lastPoll<180) return;
  lastPoll=millis();
  uint8_t p=finger.getImage();
  if(p==FINGERPRINT_NOFINGER) { waitingRemoval=false; return; }
  if(p!=FINGERPRINT_OK || waitingRemoval) return;
  waitingRemoval=true;
  if(finger.image2Tz(1)!=FINGERPRINT_OK) { Serial.println("Fingerprint image error"); return; }
  if(finger.fingerFastSearch()==FINGERPRINT_OK) {
    if(findFinger(finger.fingerID)>=0) grant("FINGERPRINT ID "+String(finger.fingerID));
    else deny("FINGERPRINT ID not in local registration list");
  } else deny("FINGERPRINT");
}

void printMenu() {
  Serial.println("\n========== TECHNOKEEPER MENU ==========");
  Serial.println("R - Register RFID (entrance; works on both readers)");
  Serial.println("F - Register Fingerprint (separate, two scans)");
  Serial.println("D - Delete RFID or Fingerprint");
  Serial.println("L - List registered credentials");
  Serial.println("T - Test MP3 / Speaker (1-11)");
  Serial.println("5 - Show RTC date/time");
  Serial.println("P - Print touch sensor state");
  Serial.println("P - Touch/door status");
  Serial.println("G - Test relay IN2: unlock 3 seconds then lock (NO solenoid during first test)");
  Serial.println("M - Show menu");
  Serial.println("=======================================");
  Serial.println("ENTRANCE RFID / Fingerprint: unlock until exit action.");
  Serial.println("EXIT registered RFID + TOUCH: lock door.");
}

String readLine(unsigned long timeoutMs=30000) {
  String line;
  unsigned long start=millis();
  while(millis()-start<timeoutMs) {
    pollTouch();
    if(Serial.available()) {
      char c=Serial.read();
      if(c=='\r'||c=='\n') { if(line.length()) break; }
      else line+=c;
    }
    delay(2);
  }
  line.trim(); line.toUpperCase(); return line;
}

bool waitFingerStep(uint8_t slot, unsigned long timeoutMs) {
  unsigned long start=millis();
  while(millis()-start<timeoutMs) {
    pollTouch();
    uint8_t p=finger.getImage();
    if(p==FINGERPRINT_OK) {
      p=finger.image2Tz(slot);
      if(p==FINGERPRINT_OK) return true;
      Serial.println("Bad fingerprint image. Try again.");
    }
    delay(100);
  }
  return false;
}
void waitFingerRemoved() {
  unsigned long start=millis();
  while(millis()-start<10000) {
    pollTouch();
    if(finger.getImage()==FINGERPRINT_NOFINGER) return;
    delay(100);
  }
}
void registerRFID() {
  if(userCount>=MAX_USERS) { Serial.println("Registration full (50 credentials)"); return; }
  Serial.println("\n===== REGISTER RFID (ENTRANCE) =====");
  Serial.println("Scan NEW RFID on ENTRANCE within 25 seconds...");
  String uid;
  unsigned long start=millis();
  entranceFrame=RFIDFrame();
  entranceRFID.listen();
  while(millis()-start<25000 && uid.isEmpty()) {
    pollTouch();
    readReader(entranceRFID,entranceFrame,"ENTRANCE",false,&uid);
    delay(2);
  }
  if(uid.isEmpty()) { Serial.println("RFID registration timeout"); return; }
  if(findUID(uid)>=0) { Serial.println("UID already registered: "+uid); return; }
  users[userCount].uid=uid;
  users[userCount].fingerId=0;
  userCount++; saveUsers();
  Serial.println("RFID SAVED: "+uid+" (ENTRANCE and EXIT)");
}
void registerFingerprint() {
  if(userCount>=MAX_USERS) { Serial.println("Registration full (50 credentials)"); return; }
  uint16_t id=freeFingerID();
  if(!id) { Serial.println("No available fingerprint ID"); return; }
  Serial.println("\n===== REGISTER FINGERPRINT =====");
  Serial.println("Place finger on R307S (first scan, 20s)...");
  if(!waitFingerStep(1,20000)) { Serial.println("First scan failed / timeout"); return; }
  Serial.println("Remove finger completely...");
  waitFingerRemoved();
  Serial.println("Place SAME finger again (second scan, 20s)...");
  if(!waitFingerStep(2,20000)) { Serial.println("Second scan failed / timeout"); return; }
  if(finger.createModel()!=FINGERPRINT_OK) { Serial.println("Fingerprints did not match"); return; }
  if(finger.storeModel(id)!=FINGERPRINT_OK) { Serial.println("Could not save fingerprint"); return; }
  users[userCount].uid="";
  users[userCount].fingerId=id;
  userCount++; saveUsers();
  Serial.println("FINGERPRINT SAVED SUCCESSFULLY! Finger ID="+String(id));
  Serial.println("This ID is authorized locally. Scan finger again after removing it.");
}
void removeRecord(int idx) {
  for(int i=idx;i<userCount-1;i++) users[i]=users[i+1];
  userCount--; saveUsers();
  Serial.println("DELETED SUCCESSFULLY");
}
void deleteCredential() {
  Serial.println("Delete: type R for RFID, F for Fingerprint ID, or X to cancel:");
  String kind=readLine(15000);
  if(kind=="R") {
    Serial.println("Enter UID (10 hex characters):");
    String uid=readLine();
    int idx=findUID(uid);
    if(idx<0) { Serial.println("UID not found"); return; }
    Serial.println("Type YES to confirm deleting RFID "+uid);
    if(readLine(15000)!="YES") { Serial.println("Cancelled"); return; }
    // Legacy paired record: keep its fingerprint as a separate entry.
    if(users[idx].fingerId!=0) users[idx].uid="";
    else { removeRecord(idx); return; }
    saveUsers(); Serial.println("RFID DELETED (paired fingerprint retained)");
  } else if(kind=="F") {
    Serial.println("Enter Fingerprint ID to delete:");
    String input=readLine();
    uint16_t id=(uint16_t)input.toInt();
    int idx=findFinger(id);
    if(idx<0) { Serial.println("Fingerprint ID not found"); return; }
    Serial.println("Type YES to confirm deleting Fingerprint ID "+String(id));
    if(readLine(15000)!="YES") { Serial.println("Cancelled"); return; }
    if(finger.deleteModel(id)!=FINGERPRINT_OK) { Serial.println("Sensor deletion failed; record retained"); return; }
    if(users[idx].uid.length()) users[idx].fingerId=0;
    else { removeRecord(idx); return; }
    saveUsers(); Serial.println("FINGERPRINT DELETED (paired RFID retained)");
  } else Serial.println("Cancelled");
}
void listUsers() {
  Serial.println("\nREGISTERED CREDENTIAL RECORDS: "+String(userCount));
  for(int i=0;i<userCount;i++) {
    if(users[i].uid.length()) Serial.println("RFID: "+users[i].uid);
    if(users[i].fingerId) Serial.println("FINGERPRINT ID: "+String(users[i].fingerId));
  }
}
void handleMenu() {
  if(!Serial.available()) return;
  char command=Serial.read();
  while(Serial.available() && (Serial.peek()=='\r'||Serial.peek()=='\n')) Serial.read();
  switch(toupper((unsigned char)command)) {
    case 'R': registerRFID(); break;
    case 'F': registerFingerprint(); break;
    case 'D': deleteCredential(); break;
    case 'L': listUsers(); break;
    case 'T':
    case '4': {
      Serial.println("\n===== MP3 / SPEAKER TEST =====");
      Serial.println("Enter a number from 1 to 11, then press Enter:");
      int n=readLine(15000).toInt();
      if(n>=1 && n<=11) { playAudio(n); Serial.println("Playing /MP3/"+String(n<10?"000":"00")+String(n)+".mp3 through the speaker"); }
      else Serial.println("Invalid audio number");
      break;
    }
    case '5': printTime(); Serial.println(); break;
    case 'P': Serial.println(String("[TOUCH] GPIO18=")+digitalRead(TOUCH_PIN)+" active="+TOUCH_ACTIVE+" exitAuthorized="+exitAuthorized+" unlocked="+unlocked); break;
    case 'G': {
      Serial.println("[RELAY TEST] GPIO17 HIGH for 3 seconds, then LOW");
      digitalWrite(RELAY2, DOOR_RELAY_ACTIVE_LEVEL);
      delay(DOOR_UNLOCK_DURATION_MS);
      digitalWrite(RELAY2, DOOR_RELAY_IDLE_LEVEL);
      unlocked = false;
      exitAuthorized = false;
      Serial.println("[RELAY TEST] GPIO17 LOW; relay returned to idle");
      break;
    }
    case 'M': printMenu(); break;
    default: break;
  }
}

void setup() {
  // Use the same startup relay polarity as the supplied working test.
  // Relay IN1 (GPIO4) and IN2 (GPIO17) are driven LOW at startup.
  // Only IN2 controls the solenoid; IN1 remains OFF.
  digitalWrite(RELAY1, DOOR_RELAY_IDLE_LEVEL); pinMode(RELAY1, OUTPUT);
  digitalWrite(RELAY2, DOOR_RELAY_IDLE_LEVEL); pinMode(RELAY2, OUTPUT);
  pinMode(TOUCH_PIN,INPUT); // TTP223 OUT must be 3.3V logic
  Serial.begin(115200);
  Serial.setTimeout(1000);
  delay(500);
  Serial.println("\nTechnoKeeper ESP32 Starting...");
  prefs.begin("technokeeper",false);
  loadUsers();
  Wire.begin(RTC_SDA,RTC_SCL);
  rtcOK=rtc.begin();
  if(!rtcOK) Serial.println("WARNING: DS3231 not detected");
  else if(rtc.lostPower()) Serial.println("WARNING: RTC lost power; set its time separately");

  FingerUART.begin(57600,SERIAL_8N1,FP_RX,FP_TX);
  finger.begin(57600);
  if(!finger.verifyPassword()) {
    Serial.println("ERROR: R307S not found. Registration and fingerprint scan unavailable.");
    // RFID still available, but fingerprint enrollment and matching are unavailable.
  }
  if(finger.verifyPassword()) {
    finger.getTemplateCount();
    Serial.println("R307S connected; sensor templates: "+String(finger.templateCount));
  }
  Mp3UART.begin(9600,SERIAL_8N1,MP3_RX,MP3_TX);
  delay(700);
  mp3Command(0x06,25); // DFPlayer volume 0..30

  entranceRFID.begin(9600,SWSERIAL_8N1,RFID_ENTRANCE_RX,-1,false,128);
  exitRFID.begin(9600,SWSERIAL_8N1,RFID_EXIT_RX,-1,false,128);
  entranceRFID.listen();
  Serial.println("Saved users: "+String(userCount));
  Serial.println("Door relay IN2 on GPIO17: LOW = LOCKED; HIGH = UNLOCKED.");
  Serial.println("Door starts LOCKED. No automatic lock timer.");
  Serial.println("Exit scan arms touch-to-lock until touched; touch alone does not lock.");
  Serial.println("Hold RFID card near either reader for up to 2 seconds to allow SoftwareSerial switching.");
  printMenu();
}
void loop() {
  pollTouch();
  pollRFIDs();
  pollFingerprint();
  handleMenu();
  delay(2);
}
