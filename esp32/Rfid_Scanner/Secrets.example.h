// Private values for this sketch. Secrets.h is git-ignored: never commit it.
// To set up: copy Secrets.example.h to Secrets.h and fill in the values.
#ifndef RFID_SCANNER_SECRETS_H
#define RFID_SCANNER_SECRETS_H

// WiFi password of WIFI_SSID.
#define SECRET_WIFI_PASSWORD "your-wifi-password"

// Must equal RFID_DEVICE_TOKEN in the backend environment.
#define SECRET_RFID_DEVICE_TOKEN "set-the-same-value-as-backend-RFID_DEVICE_TOKEN"

#endif
