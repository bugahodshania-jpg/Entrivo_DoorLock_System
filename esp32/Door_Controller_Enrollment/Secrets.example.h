// Private values for this sketch. Secrets.h is git-ignored: never commit it.
// To set up: copy Secrets.example.h to Secrets.h and fill in the values.
#ifndef DOOR_CONTROLLER_ENROLLMENT_SECRETS_H
#define DOOR_CONTROLLER_ENROLLMENT_SECRETS_H

// WiFi password of WIFI_SSID.
#define SECRET_WIFI_PASSWORD "your-wifi-password"

// Must equal DOOR_DEVICE_TOKEN in the backend environment.
#define SECRET_DOOR_DEVICE_TOKEN "set-the-same-value-as-backend-DOOR_DEVICE_TOKEN"

// Emergency card used only when the backend is unreachable (10 hex digits). "" disables it.
#define SECRET_OFFLINE_ACCESS_CARD_UID ""

#endif
