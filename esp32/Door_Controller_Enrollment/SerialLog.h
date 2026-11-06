#ifndef ENTRIVO_SERIAL_LOG_H
#define ENTRIVO_SERIAL_LOG_H

// Organized Serial Monitor output for the Entrivo door controller.
//
//   ============================================================
//     ENROLLMENT JOB #66
//   ============================================================
//     Finger .............. Right Thumb
//
//   --- STEP 1/4  FIRST SCAN -----------------------------------
//     > Place finger for first scan
//         [FP] duplicate check: 0x09 Not found in library
//
//   ------------------------------------------------------------
//     RESULT : FAILED
//     Reason : ...
//     [DEBUG] Last sensor status : verification fast search -> 0x09
//     [DEBUG] Likely cause       : ...
//   ------------------------------------------------------------
//
// Header-only so every .cpp file can include it without a new build unit.

#include <Arduino.h>

namespace SerialLog {
    constexpr uint8_t WIDTH = 60;

    inline void blank() { Serial.println(); }

    inline void rule(char c = '=') {
        for (uint8_t i = 0; i < WIDTH; ++i) Serial.print(c);
        Serial.println();
    }

    inline String hex(uint8_t code) {
        String text = "0x";
        if (code < 16) text += '0';
        text += String(code, HEX);
        text.toUpperCase();
        text.replace("0X", "0x");
        return text;
    }

    // Big block: job start, boot, door access attempt.
    inline void section(const String &title) {
        blank();
        rule('=');
        Serial.print("  ");
        Serial.println(title);
        rule('=');
    }

    // Step header inside a section.
    inline void subsection(const String &title) {
        blank();
        String line = "--- " + title + " ";
        Serial.print(line);
        for (int i = line.length(); i < WIDTH; ++i) Serial.print('-');
        Serial.println();
    }

    // "  Key ............. value"
    inline void kv(const char *key, const String &value) {
        String label = String("  ") + key + " ";
        Serial.print(label);
        for (int i = label.length(); i < 22; ++i) Serial.print('.');
        Serial.print(' ');
        Serial.println(value);
    }

    inline void step(const String &message) { Serial.print("  > "); Serial.println(message); }
    inline void ok(const String &message)   { Serial.print("  [ OK ] "); Serial.println(message); }
    inline void warn(const String &message) { Serial.print("  [WARN] "); Serial.println(message); }
    inline void fail(const String &message) { Serial.print("  [FAIL] "); Serial.println(message); }
    inline void debug(const String &message) { Serial.print("  [DEBUG] "); Serial.println(message); }

    // R307S / Adafruit_Fingerprint confirmation codes.
    inline const char *statusName(uint8_t code) {
        switch (code) {
            case 0x00: return "OK";
            case 0x01: return "Packet receive error";
            case 0x02: return "No finger on sensor";
            case 0x03: return "Image capture failed";
            case 0x06: return "Image too messy";
            case 0x07: return "Too few feature points";
            case 0x08: return "No match (1:1)";
            case 0x09: return "Not found in library";
            case 0x0A: return "Scans could not be combined (RegModel)";
            case 0x0B: return "Slot ID out of range";
            case 0x0C: return "Template read / invalid template";
            case 0x0D: return "Template upload failed";
            case 0x0E: return "Sensor cannot receive data packet";
            case 0x0F: return "Image upload failed";
            case 0x10: return "Delete failed";
            case 0x11: return "Library clear failed";
            case 0x13: return "Wrong sensor password";
            case 0x15: return "No valid image in buffer";
            case 0x17: return "Feature buffer no longer valid";
            case 0x18: return "Flash write error";
            case 0x1A: return "Invalid register";
            case 0xFE: return "Host protocol failure / blocked";
            case 0xFF: return "Timeout / no response";
            default:   return "Unknown status";
        }
    }

    inline const char *statusHint(uint8_t code) {
        switch (code) {
            case 0x01: case 0x0E: case 0xFF:
                return "UART problem. Check sensor TX/RX wiring (pins in Config.h), 3.3V/5V power and FP_BAUDRATE.";
            case 0x02: return "The finger was lifted too early. Hold it still until the next prompt.";
            case 0x03: case 0x06: case 0x07:
                return "Poor image. Clean the glass, dry/moisten the finger, press the center of the pad flat.";
            case 0x08: return "The live scan does not match the compared template. Same finger, same position?";
            case 0x09: return "No stored template matches this scan. Different finger, weak model, or a consumed buffer.";
            case 0x0A: return "Scan 1 and scan 2 are too different. Use the same finger and the same placement.";
            case 0x0B: return "The reserved slot is beyond the sensor capacity.";
            case 0x0C: case 0x0D: case 0x18:
                return "Sensor flash/template error. Delete the slot in Sensor Memory and enroll again.";
            case 0x15: return "No image to convert. A new getImage() is required before image2Tz().";
            case 0x17: return "The sensor already used this scan for a Search/Match. Rebuild it with image2Tz() before searching again.";
            case 0xFE: return "The door was unlocked, the request was invalid, or no valid ACK packet arrived.";
            default:   return "";
        }
    }

    // Last non-trivial sensor status, so a failure summary can explain it.
    struct LastStatus { String stage; uint8_t code = 0; bool set = false; };
    inline LastStatus &last() { static LastStatus value; return value; }
    inline void recordStatus(const char *stage, uint8_t code) {
        if (code == 0x00 || code == 0x02) return; // OK / no finger are normal.
        last().stage = stage;
        last().code = code;
        last().set = true;
    }
    inline void clearStatus() { last() = LastStatus{}; }

    // One indented sensor line plus a [DEBUG] hint for real errors.
    inline void sensorStatus(const char *stage, uint8_t code) {
        Serial.print("      [FP] ");
        Serial.print(stage);
        Serial.print(": ");
        Serial.print(hex(code));
        Serial.print(' ');
        Serial.println(statusName(code));
        recordStatus(stage, code);
        const char *hint = statusHint(code);
        if (code != 0x00 && code != 0x02 && hint[0] != '\0') {
            Serial.print("      [DEBUG] ");
            Serial.println(hint);
        }
    }

    // ESP32 HTTPClient negative codes and common backend statuses.
    inline String httpMeaning(int code) {
        switch (code) {
            case 0:   return "no request was sent";
            case -1:  return "connection refused - backend not running or wrong SERVER_URL/IP";
            case -2:  return "send header failed";
            case -3:  return "send payload failed";
            case -4:  return "not connected - check WiFi";
            case -5:  return "connection lost";
            case -7:  return "no HTTP server at SERVER_URL";
            case -8:  return "ESP32 out of RAM";
            case -11: return "read timeout - backend busy or slow";
            case 400: return "bad request - firmware sent missing/invalid fields";
            case 401: case 403: return "rejected - DOOR_DEVICE_TOKEN differs from backend/.env";
            case 404: return "job/endpoint not found";
            case 409: return "conflict - job was cancelled, closed, or changed state";
            case 422: return "backend rejected the data (template/verification)";
            case 500: case 503: return "backend error - check the PHP server window";
            default:  return code < 0 ? "network error" : "unexpected HTTP status";
        }
    }

    inline void httpFailure(const String &endpoint, int code, const String &detail) {
        Serial.print("  [HTTP] ");
        Serial.print(endpoint);
        Serial.print(" -> ");
        Serial.print(code);
        Serial.print(" (");
        Serial.print(httpMeaning(code));
        Serial.println(")");
        if (detail.length()) debug("Backend says: " + detail);
    }

    // Closing box for a job or door access attempt.
    inline void result(bool success, const String &title, const String &reason) {
        blank();
        rule('-');
        kv("RESULT", success ? String("SUCCESS - ") + title : String("FAILED - ") + title);
        if (reason.length()) kv("Reason", reason);
        if (!success && last().set) {
            kv("Last sensor status", last().stage + " -> " + hex(last().code) + " " + statusName(last().code));
            const char *hint = statusHint(last().code);
            if (hint[0] != '\0') kv("Likely cause", hint);
        }
        rule('-');
        blank();
    }
}

#endif
