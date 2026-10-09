// Standalone hardware test for the door ESP32.
// Upload this sketch to check each part, then upload door_controller again.
// Serial monitor: 115200 baud.
//
// Pins match esp32/door_controller/Config.h.

#include <Adafruit_Fingerprint.h>
#include <WiFi.h>
#include <Wire.h>

namespace {

constexpr uint8_t FP_RX_PIN = 32;
constexpr uint8_t FP_TX_PIN = 33;
constexpr uint32_t FP_BAUDRATE = 57600;

constexpr uint8_t RFID_ENTRANCE_RX_PIN = 16;
constexpr uint8_t RFID_EXIT_RX_PIN = 27;
constexpr uint32_t RFID_BAUDRATE = 9600;

constexpr uint8_t RTC_SDA_PIN = 19;
constexpr uint8_t RTC_SCL_PIN = 21;

constexpr uint8_t DFPLAYER_RX_PIN = 25;
constexpr uint8_t DFPLAYER_TX_PIN = 26;
constexpr uint32_t DFPLAYER_BAUDRATE = 9600;

constexpr uint8_t DOOR_RELAY_PIN = 4;
constexpr uint8_t DOOR_RELAY_ACTIVE_LEVEL = HIGH;
constexpr uint8_t DOOR_RELAY_IDLE_LEVEL = LOW;
constexpr uint32_t DOOR_UNLOCK_DURATION_MS = 3000;

constexpr char WIFI_SSID[] = "ESP32_HOTSPOT";
constexpr char WIFI_PASSWORD[] = "onetwoeight";

constexpr uint32_t USER_WAIT_MS = 20000;
constexpr uint32_t WIFI_WAIT_MS = 15000;

HardwareSerial FingerPort(2);
HardwareSerial DevicePort(1);
Adafruit_Fingerprint finger(&FingerPort);

void printMenu()
{
    Serial.println();
    Serial.println("Door hardware test");
    Serial.println("Type a letter and press Enter.");
    Serial.println("A  Fingerprint sensor   GPIO 32 RX, GPIO 33 TX");
    Serial.println("B  Entrance card reader GPIO 16");
    Serial.println("C  Exit card reader     GPIO 27");
    Serial.println("D  RTC clock            GPIO 19 SDA, GPIO 21 SCL");
    Serial.println("E  DFPlayer audio       GPIO 25 RX, GPIO 26 TX");
    Serial.println("F  Door relay           GPIO 4");
    Serial.println("G  Wi-Fi");
    Serial.println("H  Test every component");
    Serial.println("M  Show this menu");
    Serial.println();
}

void printResult(const char *name, bool passed, const String &detail)
{
    Serial.print(name);
    Serial.print(": ");
    Serial.println(passed ? "PASS" : "FAIL");
    if (detail.length() > 0)
    {
        Serial.println(detail);
    }
    Serial.println();
}

bool timedOut(unsigned long startedAt, uint32_t timeoutMs)
{
    return (millis() - startedAt) >= timeoutMs;
}

void discardPendingInput()
{
    delay(30);

    while (Serial.available() > 0)
    {
        const char extra = static_cast<char>(Serial.peek());
        if (extra != '\r' && extra != '\n' && extra != ' ')
        {
            return;
        }

        Serial.read();
    }
}

bool userSkipped()
{
    if (!Serial.available())
    {
        return false;
    }

    while (Serial.available())
    {
        Serial.read();
    }

    return true;
}

bool readPortByte(HardwareSerial &port, uint8_t &value, uint32_t timeoutMs)
{
    const unsigned long startedAt = millis();

    while (!timedOut(startedAt, timeoutMs))
    {
        if (port.available() > 0)
        {
            value = static_cast<uint8_t>(port.read());
            return true;
        }

        delay(1);
    }

    return false;
}

void openFingerprintPort()
{
    FingerPort.begin(FP_BAUDRATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
    finger.begin(FP_BAUDRATE);
    FingerPort.begin(FP_BAUDRATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
}

void closeDevicePort()
{
    DevicePort.end();
    FingerPort.end();
}

uint8_t bcdToDecimal(uint8_t value)
{
    return ((value >> 4) * 10) + (value & 0x0F);
}

bool readHexNibble(uint8_t text, uint8_t &value)
{
    if (text >= '0' && text <= '9')
    {
        value = text - '0';
        return true;
    }

    if (text >= 'A' && text <= 'F')
    {
        value = text - 'A' + 10;
        return true;
    }

    if (text >= 'a' && text <= 'f')
    {
        value = text - 'a' + 10;
        return true;
    }

    return false;
}

bool readHexByte(uint8_t high, uint8_t low, uint8_t &value)
{
    uint8_t highNibble = 0;
    uint8_t lowNibble = 0;

    if (!readHexNibble(high, highNibble) || !readHexNibble(low, lowNibble))
    {
        return false;
    }

    value = (highNibble << 4) | lowNibble;
    return true;
}

bool testFingerprint()
{
    Serial.println("Fingerprint: looking for the sensor on GPIO 32 and GPIO 33.");
    discardPendingInput();
    openFingerprintPort();

    if (!finger.verifyPassword())
    {
        closeDevicePort();
        printResult(
            "Fingerprint",
            false,
            "No reply. Sensor TX must go to GPIO 32, and sensor RX must come from GPIO 33."
        );
        return false;
    }

    Serial.println("Sensor answered. Place the same finger on it. Press any key to skip.");
    const unsigned long startedAt = millis();
    bool captured = false;

    while (!timedOut(startedAt, USER_WAIT_MS))
    {
        if (userSkipped())
        {
            closeDevicePort();
            printResult("Fingerprint", true, "Sensor answered. Finger scan skipped.");
            return true;
        }

        const uint8_t imageStatus = finger.getImage();
        if (imageStatus == FINGERPRINT_NOFINGER)
        {
            delay(50);
            continue;
        }

        if (imageStatus != FINGERPRINT_OK)
        {
            closeDevicePort();
            printResult("Fingerprint", false, "The sensor answered, but it could not capture an image.");
            return false;
        }

        captured = true;
        break;
    }

    if (!captured)
    {
        closeDevicePort();
        printResult("Fingerprint", true, "Sensor answered. No finger was placed before the wait ended.");
        return true;
    }

    if (finger.image2Tz() != FINGERPRINT_OK)
    {
        closeDevicePort();
        printResult("Fingerprint", false, "A finger was seen, but the sensor could not build a template.");
        return false;
    }

    const uint8_t searchStatus = finger.fingerFastSearch();
    closeDevicePort();

    if (searchStatus == FINGERPRINT_OK)
    {
        printResult("Fingerprint", true, "Sensor answered and matched saved slot " + String(finger.fingerID) + ".");
        return true;
    }

    printResult(
        "Fingerprint",
        true,
        "Sensor answered and captured a finger. That finger is not saved in this sensor yet."
    );
    return true;
}

bool readRfidCard(HardwareSerial &port, String &cardId, String &errorMessage)
{
    const unsigned long startedAt = millis();

    while (!timedOut(startedAt, USER_WAIT_MS))
    {
        if (userSkipped())
        {
            errorMessage = "Skipped.";
            return false;
        }

        if (port.available() <= 0)
        {
            delay(10);
            continue;
        }

        if (static_cast<uint8_t>(port.read()) != 0x02)
        {
            continue;
        }

        uint8_t frame[13] = {0};
        bool frameComplete = true;

        for (size_t index = 0; index < sizeof(frame); ++index)
        {
            if (!readPortByte(port, frame[index], 50))
            {
                frameComplete = false;
                break;
            }
        }

        if (!frameComplete || frame[12] != 0x03)
        {
            continue;
        }

        uint8_t data[5] = {0};
        uint8_t checksum = 0;
        bool digitsValid = true;

        for (size_t index = 0; index < 5; ++index)
        {
            if (!readHexByte(frame[index * 2], frame[(index * 2) + 1], data[index]))
            {
                digitsValid = false;
                break;
            }

            checksum ^= data[index];
        }

        uint8_t receivedChecksum = 0;
        if (!digitsValid || !readHexByte(frame[10], frame[11], receivedChecksum))
        {
            continue;
        }

        if (checksum != receivedChecksum)
        {
            continue;
        }

        cardId = "";
        for (size_t index = 0; index < 10; ++index)
        {
            cardId += static_cast<char>(frame[index]);
        }

        return true;
    }

    errorMessage = "No valid card was read. Hold a card on the reader, with the reader TX wire on this GPIO.";
    return false;
}

bool testRfid(const char *name, uint8_t rxPin)
{
    Serial.print(name);
    Serial.print(": hold a card near the reader on GPIO ");
    Serial.print(rxPin);
    Serial.println(". Press any key to skip.");
    discardPendingInput();

    DevicePort.begin(RFID_BAUDRATE, SERIAL_8N1, rxPin, -1);
    while (DevicePort.available() > 0)
    {
        DevicePort.read();
    }

    String cardId;
    String errorMessage;
    const bool passed = readRfidCard(DevicePort, cardId, errorMessage);
    closeDevicePort();

    if (errorMessage == "Skipped.")
    {
        printResult(name, false, "Skipped before a card was read.");
        return false;
    }

    printResult(name, passed, passed ? "Card ID " + cardId : errorMessage);
    return passed;
}

bool readClockTime(uint8_t address, String &timeText)
{
    Wire.beginTransmission(address);
    Wire.write(0x00);
    if (Wire.endTransmission() != 0)
    {
        return false;
    }

    if (Wire.requestFrom(address, static_cast<uint8_t>(7)) != 7)
    {
        return false;
    }

    const uint8_t seconds = bcdToDecimal(Wire.read() & 0x7F);
    const uint8_t minutes = bcdToDecimal(Wire.read() & 0x7F);
    uint8_t hoursRaw = Wire.read();
    const uint8_t day = bcdToDecimal(Wire.read() & 0x3F);
    const uint8_t month = bcdToDecimal(Wire.read() & 0x1F);
    const uint8_t year = bcdToDecimal(Wire.read());

    uint8_t hours = hoursRaw & 0x0F;
    if ((hoursRaw & 0x40) == 0)
    {
        hours = bcdToDecimal(hoursRaw & 0x3F);
    }
    else
    {
        hours = bcdToDecimal(hoursRaw & 0x1F);
        if ((hoursRaw & 0x20) != 0 && hours < 12)
        {
            hours += 12;
        }
        if ((hoursRaw & 0x20) == 0 && hours == 12)
        {
            hours = 0;
        }
    }

    char formatted[32] = {0};
    snprintf(
        formatted,
        sizeof(formatted),
        "20%02u-%02u-%02u %02u:%02u:%02u",
        static_cast<unsigned>(year),
        static_cast<unsigned>(month),
        static_cast<unsigned>(day),
        static_cast<unsigned>(hours),
        static_cast<unsigned>(minutes),
        static_cast<unsigned>(seconds)
    );
    timeText = formatted;
    return seconds < 60 && minutes < 60 && hours < 24;
}

bool testRtc()
{
    Serial.println("RTC: scanning I2C on GPIO 19 and GPIO 21.");
    Wire.begin(RTC_SDA_PIN, RTC_SCL_PIN);
    Wire.setClock(100000);

    bool foundClock = false;
    bool foundMemory = false;
    String timeText;

    for (uint8_t address = 0x08; address < 0x78; ++address)
    {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() != 0)
        {
            continue;
        }

        if (address == 0x68)
        {
            foundClock = readClockTime(address, timeText);
        }
        else if (address == 0x51)
        {
            foundClock = true;
            timeText = "PCF8563 answered at 0x51.";
        }
        else if (address == 0x57)
        {
            foundMemory = true;
        }
    }

    Wire.end();

    if (foundClock)
    {
        printResult("RTC", true, timeText.length() > 0 ? timeText : "Clock chip answered.");
        return true;
    }

    if (foundMemory)
    {
        printResult("RTC", false, "The RTC memory chip answered, but the clock chip did not.");
        return false;
    }

    printResult("RTC", false, "No clock chip answered. Check SDA on GPIO 19, SCL on GPIO 21, and 3.3V power.");
    return false;
}

uint16_t dfChecksum(const uint8_t *packet)
{
    uint16_t sum = 0;
    for (uint8_t index = 1; index <= 6; ++index)
    {
        sum += packet[index];
    }

    return static_cast<uint16_t>(0 - sum);
}

void sendDfCommand(uint8_t command, uint16_t parameter)
{
    uint8_t packet[10] = {
        0x7E,
        0xFF,
        0x06,
        command,
        0x01,
        static_cast<uint8_t>(parameter >> 8),
        static_cast<uint8_t>(parameter & 0xFF),
        0x00,
        0x00,
        0xEF
    };
    const uint16_t checksum = dfChecksum(packet);
    packet[7] = static_cast<uint8_t>(checksum >> 8);
    packet[8] = static_cast<uint8_t>(checksum & 0xFF);

    DevicePort.write(packet, sizeof(packet));
    DevicePort.flush();
}

bool waitForDfReply()
{
    const unsigned long startedAt = millis();

    while (!timedOut(startedAt, 1500))
    {
        uint8_t value = 0;
        if (!readPortByte(DevicePort, value, 200))
        {
            continue;
        }

        if (value == 0x7E)
        {
            return true;
        }
    }

    return false;
}

bool testDfPlayer()
{
    Serial.println("DFPlayer: checking the player on GPIO 25 and GPIO 26.");
    DevicePort.begin(DFPLAYER_BAUDRATE, SERIAL_8N1, DFPLAYER_RX_PIN, DFPLAYER_TX_PIN);
    delay(300);
    while (DevicePort.available() > 0)
    {
        DevicePort.read();
    }

    sendDfCommand(0x3F, 0);
    const bool replied = waitForDfReply();

    if (replied)
    {
        sendDfCommand(0x06, 15);
        delay(100);
        sendDfCommand(0x03, 1);
    }

    closeDevicePort();

    if (!replied)
    {
        printResult(
            "DFPlayer",
            false,
            "No reply. Player TX goes to GPIO 25, and player RX comes from GPIO 26 through a 1k resistor."
        );
        return false;
    }

    printResult("DFPlayer", true, "Player answered and started track 1. Audio plays when the SD card has mp3/0001.mp3.");
    return true;
}

bool testRelay()
{
    Serial.println("Relay: GPIO 4 will go HIGH for 3 seconds. The lock should release, then lock again.");
    pinMode(DOOR_RELAY_PIN, OUTPUT);
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_ACTIVE_LEVEL);
    delay(DOOR_UNLOCK_DURATION_MS);
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);
    printResult("Relay", true, "GPIO 4 was HIGH for 3 seconds, then returned LOW. Confirm that the relay clicked.");
    return true;
}

bool testWiFi()
{
    Serial.print("Wi-Fi: connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    const unsigned long startedAt = millis();
    while (WiFi.status() != WL_CONNECTED && !timedOut(startedAt, WIFI_WAIT_MS))
    {
        delay(250);
        Serial.print(".");
    }
    Serial.println();

    const bool connected = WiFi.status() == WL_CONNECTED;
    String detail = "Could not join " + String(WIFI_SSID) + ".";
    if (connected)
    {
        detail = "Connected. IP address " + WiFi.localIP().toString();
    }

    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    printResult("Wi-Fi", connected, detail);
    return connected;
}

void testAll()
{
    Serial.println();
    Serial.println("Running every component test.");
    testFingerprint();
    testRfid("Entrance RFID", RFID_ENTRANCE_RX_PIN);
    testRfid("Exit RFID", RFID_EXIT_RX_PIN);
    testRtc();
    testDfPlayer();
    testRelay();
    testWiFi();
    Serial.println("Component tests finished.");
    printMenu();
}

}  // namespace

void setup()
{
    Serial.begin(115200);
    delay(300);

    pinMode(DOOR_RELAY_PIN, OUTPUT);
    digitalWrite(DOOR_RELAY_PIN, DOOR_RELAY_IDLE_LEVEL);

    Serial.println();
    Serial.println("Upload door_controller again after these tests.");
    printMenu();
}

void loop()
{
    if (!Serial.available())
    {
        return;
    }

    const char option = static_cast<char>(toupper(Serial.read()));
    if (option == '\r' || option == '\n' || option == ' ')
    {
        return;
    }

    switch (option)
    {
        case 'A':
            testFingerprint();
            break;
        case 'B':
            testRfid("Entrance RFID", RFID_ENTRANCE_RX_PIN);
            break;
        case 'C':
            testRfid("Exit RFID", RFID_EXIT_RX_PIN);
            break;
        case 'D':
            testRtc();
            break;
        case 'E':
            testDfPlayer();
            break;
        case 'F':
            testRelay();
            break;
        case 'G':
            testWiFi();
            break;
        case 'H':
            testAll();
            break;
        case 'M':
            printMenu();
            break;
        default:
            Serial.println("Unknown option. Press M for the menu.");
            break;
    }
}
