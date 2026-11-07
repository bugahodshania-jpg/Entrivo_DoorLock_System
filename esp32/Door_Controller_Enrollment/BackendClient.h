#ifndef ENTRIVO_BACKEND_CLIENT_H
#define ENTRIVO_BACKEND_CLIENT_H

#include <Arduino.h>
#include <HTTPClient.h>

// Starts a request to SERVER_URL + path. Uses a verified HTTPS connection when
// SERVER_URL starts with https:// (Railway), or plain HTTP for a local backend.
// Call it while holding EntrivoHttpLock: the connection objects are shared.
bool beginBackendRequest(HTTPClient &http, const String &path);

#endif
