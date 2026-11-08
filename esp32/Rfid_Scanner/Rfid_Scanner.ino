/*
  Entrivo RFID scanner
  Board: ESP32 Dev Module (WROOM). GPIO 16 is the RDM6300 RX pin.

  Libraries (Arduino Library Manager):
    - Adafruit GFX Library
    - Adafruit ILI9341

  Scans go to the Railway backend over HTTPS, so each UID is saved in the
  Railway MySQL database and the Vercel sign-up page can verify it. The
  scanner only needs WiFi with internet access (WIFI_SSID / WIFI_PASS).
  To test against a local backend instead, set SERVER_URL to
  "http://<PC LAN address>:8000" (start_backend_lan.bat binds 0.0.0.0:8000).

  DEVICE_TOKEN must match RFID_DEVICE_TOKEN on the backend, or the default
  entrivo-rfid-2026 in backend/api/rfid_scan.php.

  Each accepted card is saved in rfid_scan_log with the server time.
  The screen shows the 10-character hex UID (example: 01008C62FB).
  The student types that UID on the Entrivo sign-up page.

  RDM6300 TX is a 5V signal. ESP32 pins are 3.3V. Put a divider on the
  reader TX wire (10k from TX to GPIO 16, 20k from GPIO 16 to GND).

  Buzzer: + to GPIO 13, - to GND. An active 3.3V buzzer (or a buzzer module
  with its own transistor) works as is. For a passive buzzer set
  BUZZER_PASSIVE to true. A bare 5V buzzer needs an NPN transistor: GPIO 13
  -> 1k -> base, emitter to GND, buzzer between 5V and the collector.
    1 short beep  = card read
    1 beep        = UID saved
    2 short beeps = card already registered
    1 long beep   = not saved (error)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <time.h>
#include "BrandLogos.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

const char *WIFI_SSID = "ESP32_HOTSPOT";
const char *WIFI_PASS = "onetwoeight";
const char *SERVER_URL = "https://entrivo-backend-production.up.railway.app";
const char *SERVER_PATH = "/api/rfid_scan.php";
const char *DEVICE_TOKEN = "entrivo-rfid-2026";
const char *DEVICE_LABEL = "rfid-scanner";

// Let's Encrypt root certificates (the issuer of *.up.railway.app).
// ISRG Root X1 is valid until 2035-06-04, ISRG Root X2 until 2040-09-17.
// Only servers whose certificate chains to one of these are accepted.
const char BACKEND_ROOT_CA[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
)PEM";

// Seconds allowed for the TLS handshake. ESP32 handshakes take about 1-2 s.
const int TLS_HANDSHAKE_TIMEOUT_S = 8;

#define TFT_CS 5
#define TFT_DC 2
#define TFT_RST 4
#define TFT_MOSI 23
#define TFT_MISO 19
#define TFT_SCK 18

#define T_CLK 25
#define T_CS 27
#define T_DIN 33
#define T_DO 32
#define T_IRQ 26

#define RFID_RX 16
#define RFID_TX 17

#define BUZZER_PIN 13
const bool BUZZER_PASSIVE = false;   // true for a passive buzzer (needs a tone)
const uint8_t BUZZER_ON_LEVEL = HIGH; // LOW for low-trigger buzzer modules
const uint16_t BUZZER_TONE_HZ = 2700; // passive buzzer only

#define COLOR_BG 0xFFFF
#define COLOR_HEADER 0x0A45
#define COLOR_INK 0x10C5
#define COLOR_MUTED 0x63B1
#define COLOR_LINE 0xE73D
#define COLOR_GREEN_DARK 0x0CAD
#define COLOR_RED 0xD8A2

Adafruit_ILI9341 tft(TFT_CS, TFT_DC, TFT_RST);

enum ScreenMode { SCREEN_BOOT, SCREEN_READY, SCREEN_RESULT };

struct ScanView {
  bool ok;
  bool registered;
  String uid;
  String message;
  String scannedAt;
};

ScreenMode screenMode = SCREEN_BOOT;
ScanView lastScan;
bool wifiReady = false;
bool timeReady = false;
unsigned long lastPollMs = 0;
unsigned long lastClockMs = 0;
unsigned long lastWifiTryMs = 0;
unsigned long resultUntilMs = 0;
unsigned long lastFrameMs = 0;
String lastUid = "";
char rfidFrame[16];
uint8_t rfidLen = 0;
bool touchWasDown = false;
bool cardPresent = false;
bool scanBusy = false;

String jsonField(const String &json, const char *key) {
  String quoted = String("\"") + key + "\":\"";
  int start = json.indexOf(quoted);
  if (start >= 0) {
    start += quoted.length();
    int end = json.indexOf('"', start);
    if (end < 0) {
      return "";
    }
    return json.substring(start, end);
  }
  String plain = String("\"") + key + "\":";
  start = json.indexOf(plain);
  if (start < 0) {
    return "";
  }
  start += plain.length();
  if (json.startsWith("true", start)) {
    return "true";
  }
  if (json.startsWith("false", start)) {
    return "false";
  }
  return "";
}

void applyServerClock(const String &stamp) {
  int year, month, day, hour, minute, second;
  if (sscanf(stamp.c_str(), "%d-%d-%d %d:%d:%d", &year, &month, &day, &hour, &minute, &second) != 6) {
    return;
  }
  struct tm when;
  memset(&when, 0, sizeof(when));
  when.tm_year = year - 1900;
  when.tm_mon = month - 1;
  when.tm_mday = day;
  when.tm_hour = hour;
  when.tm_min = minute;
  when.tm_sec = second;
  time_t seconds = mktime(&when);
  if (seconds < 0) {
    return;
  }
  struct timeval tv;
  tv.tv_sec = seconds;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);
  timeReady = true;
}

void drawCentered(int16_t y, const String &text, uint8_t size, uint16_t color, uint8_t maxChars) {
  String shown = text.length() == 0 ? String("-") : text;
  if (shown.length() > maxChars) {
    shown = shown.substring(0, maxChars - 1) + ".";
  }
  int16_t width = shown.length() * 6 * size;
  int16_t x = (320 - width) / 2;
  if (x < 6) {
    x = 6;
  }
  tft.setTextSize(size);
  tft.setTextColor(color);
  tft.setCursor(x, y);
  tft.print(shown);
}

void drawClock() {
  tft.fillRect(176, 0, 144, 26, COLOR_HEADER);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_BG);
  tft.setCursor(182, 10);
  if (!timeReady) {
    tft.print(wifiReady ? "Syncing time" : "No WiFi");
    return;
  }
  time_t now = time(nullptr);
  struct tm *local = localtime(&now);
  char line[28];
  strftime(line, sizeof(line), "%b %d  %I:%M %p", local);
  tft.print(line);
}

void drawBrandMarks() {
  tft.drawRGBBitmap(4, 3, kCsuLogo, kBrandLogoSize, kBrandLogoSize);
  tft.drawRGBBitmap(27, 3, kCsuccLogo, kBrandLogoSize, kBrandLogoSize);
}

void drawHeader() {
  tft.fillRect(0, 0, 320, 26, COLOR_HEADER);
  drawBrandMarks();
  tft.setTextSize(2);
  tft.setTextColor(COLOR_BG);
  tft.setCursor(53, 5);
  tft.print("Entrivo");
  drawClock();
}

void drawFooter() {
  tft.fillRect(0, 216, 320, 24, COLOR_BG);
  tft.drawFastHLine(0, 216, 320, COLOR_LINE);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_MUTED);
  tft.setCursor(10, 224);
  tft.print("RFID scanner");
  const char *link = wifiReady ? "Online" : "Offline";
  tft.setTextColor(wifiReady ? COLOR_GREEN_DARK : COLOR_MUTED);
  tft.setCursor(320 - 10 - (strlen(link) * 6), 224);
  tft.print(link);
}

void drawReadyBody() {
  tft.fillRect(0, 26, 320, 190, COLOR_BG);
  drawCentered(64, "TAP YOUR ID", 3, COLOR_HEADER, 12);
  drawCentered(104, "Hold the card on the reader", 1, COLOR_MUTED, 40);
  drawCentered(132, "YOUR UID", 1, COLOR_GREEN_DARK, 16);
  drawCentered(150, lastScan.uid.length() ? lastScan.uid : "None yet", 2, COLOR_INK, 16);
  if (lastScan.uid.length()) {
    drawCentered(178, lastScan.ok ? "Saved. Use this UID to sign up." : lastScan.message, 1, lastScan.ok ? COLOR_GREEN_DARK : COLOR_RED, 40);
  }
  drawFooter();
}

void drawResultBody() {
  uint16_t accent = COLOR_GREEN_DARK;
  String headline = "UID SAVED";
  if (!lastScan.ok) {
    accent = COLOR_RED;
    headline = "NOT SAVED";
  } else if (lastScan.registered) {
    accent = COLOR_INK;
    headline = "ALREADY REGISTERED";
  }

  tft.fillRect(0, 26, 320, 190, COLOR_BG);
  drawCentered(58, headline, 2, accent, 22);
  drawCentered(96, "UID", 1, COLOR_GREEN_DARK, 8);
  drawCentered(116, lastScan.uid.length() ? lastScan.uid : "No UID", 3, COLOR_INK, 12);
  drawCentered(156, lastScan.message.length() ? lastScan.message : "Tap again", 1, COLOR_MUTED, 42);
  if (lastScan.ok && !lastScan.registered) {
    drawCentered(180, "Type this UID on the sign-up page", 1, COLOR_INK, 40);
  }
  drawFooter();
}

void showBoot(const String &line) {
  screenMode = SCREEN_BOOT;
  tft.fillScreen(COLOR_BG);
  drawHeader();
  tft.setTextSize(1);
  tft.setTextColor(COLOR_INK);
  tft.setCursor(16, 90);
  tft.print(line);
  drawFooter();
}

void showBootDetail(const String &line, const String &detail, const String &extra) {
  showBoot(line);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_MUTED);
  tft.setCursor(16, 110);
  tft.print(detail);
  tft.setCursor(16, 128);
  tft.print(extra);
}

void showReady(bool includeHeader) {
  screenMode = SCREEN_READY;
  if (includeHeader) {
    tft.fillScreen(COLOR_BG);
    drawHeader();
  }
  drawReadyBody();
}

void buzzerSet(bool on) {
  if (BUZZER_PASSIVE) {
    if (on) {
      tone(BUZZER_PIN, BUZZER_TONE_HZ);
    } else {
      noTone(BUZZER_PIN);
    }
    return;
  }
  digitalWrite(BUZZER_PIN, on ? BUZZER_ON_LEVEL : (BUZZER_ON_LEVEL == HIGH ? LOW : HIGH));
}

// Short patterns only (at most about 0.6 s), so scanning is not held up.
void beep(uint16_t onMs, uint8_t count = 1, uint16_t gapMs = 90) {
  for (uint8_t i = 0; i < count; i++) {
    buzzerSet(true);
    delay(onMs);
    buzzerSet(false);
    if (i + 1 < count) {
      delay(gapMs);
    }
  }
}

void beepForResult() {
  if (!lastScan.ok) {
    beep(600);
  } else if (lastScan.registered) {
    beep(80, 2);
  } else {
    beep(180);
  }
}

void showResult() {
  screenMode = SCREEN_RESULT;
  resultUntilMs = millis() + 20000;
  tft.fillScreen(COLOR_BG);
  drawHeader();
  drawResultBody();
}

WiFiClientSecure secureClient;
WiFiClient plainClient;
bool secureReady = false;

// Returns the HTTP status code, or a negative value when the server could
// not be reached. The response body (JSON) is placed in body.
int requestDevice(const String &method, const String &uid, String &body) {
  body = "";
  if (WiFi.status() != WL_CONNECTED) {
    wifiReady = false;
    return -1;
  }
  HTTPClient http;
  String url = String(SERVER_URL) + SERVER_PATH;
  bool started;
  if (strncmp(SERVER_URL, "https://", 8) == 0) {
    if (!secureReady) {
      secureClient.setCACert(BACKEND_ROOT_CA);
      secureClient.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_S);
      secureReady = true;
    }
    started = http.begin(secureClient, url);
  } else {
    started = http.begin(plainClient, url);
  }
  if (!started) {
    return -1;
  }
  http.setTimeout(12000);
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code;
  if (method == "GET") {
    code = http.GET();
  } else {
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    String form = String("rfid_uid=") + uid + "&device_label=" + DEVICE_LABEL;
    code = http.POST(form);
  }
  if (code > 0) {
    body = http.getString();
  }
  Serial.printf("[RFID] %s %s -> %d %s\n", method.c_str(), url.c_str(), code, body.c_str());
  http.end();
  return code;
}

void syncClock() {
  String body;
  if (requestDevice("GET", "", body) != 200) {
    return;
  }
  applyServerClock(jsonField(body, "server_time"));
}

void flushRfid() {
  while (Serial2.available()) {
    Serial2.read();
  }
  rfidLen = 0;
}

void submitCard(const String &uid) {
  if (scanBusy) {
    return;
  }
  scanBusy = true;
  lastScan.uid = uid;
  lastScan.ok = false;
  lastScan.registered = false;
  lastScan.message = "Saving this UID";
  lastScan.scannedAt = "";
  showBootDetail("UID NUMBER", uid, "Saving this scan...");
  beep(50);

  String body;
  int code = requestDevice("POST", uid, body);
  lastScan.ok = code == 200 && jsonField(body, "ok") == "true";
  lastScan.registered = lastScan.ok && jsonField(body, "registered") == "true";
  String savedUid = jsonField(body, "uid");
  lastScan.uid = savedUid.length() ? savedUid : uid;
  lastScan.message = jsonField(body, "message");
  lastScan.scannedAt = jsonField(body, "scanned_at");
  applyServerClock(jsonField(body, "server_time"));

  if (!lastScan.ok) {
    if (code <= 0) {
      lastScan.message = wifiReady ? "Not saved. Server unreachable." : "Not saved. No WiFi.";
    } else if (code == 401) {
      lastScan.message = "Not saved. Scanner token rejected.";
    } else if (code == 422) {
      lastScan.message = "Not saved. Invalid UID. Tap again.";
    } else if (lastScan.message.length() == 0) {
      lastScan.message = String("Not saved. Server error ") + code + ".";
    }
  }
  showResult();
  beepForResult();
  scanBusy = false;
  flushRfid();
  cardPresent = true;
  lastFrameMs = millis();
}

bool connectWifi() {
  showBootDetail("Searching 2.4 GHz...", WIFI_SSID, "ESP32 cannot use 5 GHz");
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.disconnect(false, false);
  delay(200);

  int count = WiFi.scanNetworks(false, true);
  bool found = false;
  int bestRssi = -127;
  for (int i = 0; i < count; i++) {
    if (WiFi.SSID(i) == WIFI_SSID) {
      found = true;
      if (WiFi.RSSI(i) > bestRssi) {
        bestRssi = WiFi.RSSI(i);
      }
    }
  }
  WiFi.scanDelete();

  if (!found) {
    showBootDetail("Hotspot not found", "Set hotspot band", "to 2.4 GHz, then wait");
    wifiReady = false;
    return false;
  }

  showBootDetail("Joining hotspot...", WIFI_SSID, String("Signal ") + bestRssi + " dBm");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long started = millis();
  uint8_t shownSecond = 255;
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(250);
    wl_status_t state = WiFi.status();
    if (state == WL_CONNECT_FAILED) {
      break;
    }
    uint8_t second = (millis() - started) / 1000;
    if (second != shownSecond) {
      shownSecond = second;
      showBootDetail("Joining hotspot...", WIFI_SSID, String("Waiting ") + String(second) + "s");
    }
    yield();
  }

  wifiReady = WiFi.status() == WL_CONNECTED;
  if (!wifiReady) {
    showBootDetail("Could not join WiFi", "Check the password", "Band must be 2.4 GHz");
  }
  return wifiReady;
}

void xptPulse(bool bitValue) {
  digitalWrite(T_DIN, bitValue ? HIGH : LOW);
  delayMicroseconds(2);
  digitalWrite(T_CLK, HIGH);
  delayMicroseconds(2);
  digitalWrite(T_CLK, LOW);
}

uint16_t xptRead(uint8_t command) {
  digitalWrite(T_CS, LOW);
  delayMicroseconds(2);
  for (int8_t bit = 7; bit >= 0; bit--) {
    xptPulse((command >> bit) & 1);
  }
  uint16_t value = 0;
  for (uint8_t bit = 0; bit < 12; bit++) {
    digitalWrite(T_CLK, HIGH);
    delayMicroseconds(2);
    value = (value << 1) | (digitalRead(T_DO) ? 1 : 0);
    digitalWrite(T_CLK, LOW);
    delayMicroseconds(2);
  }
  digitalWrite(T_CS, HIGH);
  return value;
}

bool touchIsDown() {
  if (digitalRead(T_IRQ) == HIGH) {
    return false;
  }
  uint16_t x = xptRead(0xD0);
  uint16_t y = xptRead(0x90);
  return x > 150 && x < 3950 && y > 150 && y < 3950;
}

int hexByte(char high, char low) {
  char text[3] = {high, low, 0};
  char *end = nullptr;
  long value = strtol(text, &end, 16);
  if (end == text) {
    return -1;
  }
  return (int)value;
}

void acceptUid(const String &uid) {
  unsigned long now = millis();
  bool stillHolding = cardPresent && uid == lastUid && now - lastFrameMs < 800;
  lastFrameMs = now;
  cardPresent = true;
  lastUid = uid;
  if (stillHolding || scanBusy || screenMode != SCREEN_READY) {
    return;
  }
  submitCard(uid);
}

void takeRfidFrame() {
  if (rfidFrame[0] != 0x02 || rfidFrame[13] != 0x03) {
    return;
  }
  uint8_t data[5];
  uint8_t checksum = 0;
  char uid[11];
  for (uint8_t i = 0; i < 5; i++) {
    int value = hexByte(rfidFrame[1 + (i * 2)], rfidFrame[2 + (i * 2)]);
    if (value < 0) {
      return;
    }
    data[i] = (uint8_t)value;
    checksum ^= data[i];
    uid[i * 2] = rfidFrame[1 + (i * 2)];
    uid[(i * 2) + 1] = rfidFrame[2 + (i * 2)];
  }
  uid[10] = 0;
  int received = hexByte(rfidFrame[11], rfidFrame[12]);
  if (received < 0 || (uint8_t)received != checksum) {
    return;
  }
  for (uint8_t i = 0; i < 10; i++) {
    if (uid[i] >= 'a' && uid[i] <= 'z') {
      uid[i] = uid[i] - 'a' + 'A';
    }
  }
  acceptUid(String(uid));
}

void pollRfid() {
  while (Serial2.available()) {
    char byteIn = (char)Serial2.read();
    if (byteIn == 0x02) {
      rfidFrame[0] = byteIn;
      rfidLen = 1;
      continue;
    }
    if (rfidLen == 0) {
      continue;
    }
    rfidFrame[rfidLen++] = byteIn;
    if (rfidLen >= 14) {
      takeRfidFrame();
      rfidLen = 0;
      return;
    }
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
  delay(400);
  setenv("TZ", "PHT-8", 1);
  tzset();

  pinMode(T_CLK, OUTPUT);
  pinMode(T_DIN, OUTPUT);
  pinMode(T_CS, OUTPUT);
  pinMode(T_DO, INPUT);
  pinMode(T_IRQ, INPUT_PULLUP);
  digitalWrite(T_CS, HIGH);
  digitalWrite(T_CLK, LOW);

  SPI.begin(TFT_SCK, TFT_MISO, TFT_MOSI, TFT_CS);
  tft.begin();
  tft.setRotation(1);
  tft.fillScreen(COLOR_BG);

  pinMode(BUZZER_PIN, OUTPUT);
  buzzerSet(false);

  Serial2.begin(9600, SERIAL_8N1, RFID_RX, RFID_TX);
  showBoot("Connecting WiFi...");
  if (!connectWifi()) {
    showBoot("WiFi failed. Check SSID.");
  } else {
    showBoot("Syncing with Entrivo...");
    syncClock();
    showReady(true);
    lastPollMs = millis();
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiReady) {
      wifiReady = false;
      if (screenMode == SCREEN_READY) {
        drawHeader();
        drawFooter();
      }
    }
    if (!scanBusy && screenMode != SCREEN_RESULT && millis() - lastWifiTryMs > 12000) {
      connectWifi();
      lastWifiTryMs = millis();
      if (wifiReady) {
        syncClock();
        showReady(true);
        lastPollMs = millis();
      }
    }
  } else if (!wifiReady) {
    wifiReady = true;
    if (screenMode == SCREEN_READY) {
      drawHeader();
      drawFooter();
    }
  }

  if (cardPresent && millis() - lastFrameMs > 500) {
    cardPresent = false;
  }

  pollRfid();

  bool down = touchIsDown();
  if (down && !touchWasDown && screenMode == SCREEN_RESULT) {
    showReady(true);
  }
  touchWasDown = down;

  if (screenMode == SCREEN_RESULT && (long)(millis() - resultUntilMs) >= 0) {
    showReady(true);
  }

  if ((screenMode == SCREEN_READY || screenMode == SCREEN_RESULT) && millis() - lastClockMs > 1000) {
    lastClockMs = millis();
    drawClock();
  }

  if (wifiReady && screenMode == SCREEN_READY && millis() - lastPollMs > 30000) {
    lastPollMs = millis();
    syncClock();
  }
}
