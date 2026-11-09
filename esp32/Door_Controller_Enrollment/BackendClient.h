#ifndef ENTRIVO_BACKEND_CLIENT_H
#define ENTRIVO_BACKEND_CLIENT_H

#include <Arduino.h>
#include <HTTPClient.h>

// Starts a request to SERVER_URL + path. Uses a verified HTTPS connection when
// SERVER_URL starts with https:// (Railway), or plain HTTP for a local backend.
// Call it while holding EntrivoHttpLock: the connection objects are shared.
bool beginBackendRequest(HTTPClient &http, const String &path);

// One HTTPClient for every backend request, so the TLS connection to Railway
// stays open between requests (a fresh ESP32 TLS handshake costs ~1-2 s).
// Use it only while holding EntrivoHttpLock.
HTTPClient &backendHttp();

// Ends a request started with beginBackendRequest. responseCode <= 0 (transport
// failure) closes the connection so the next request starts a fresh one.
void endBackendRequest(HTTPClient &http, int responseCode);

#endif
