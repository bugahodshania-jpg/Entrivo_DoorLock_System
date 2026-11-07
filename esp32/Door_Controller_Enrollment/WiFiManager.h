#ifndef DIRECT_WIFI_MANAGER_H
#define DIRECT_WIFI_MANAGER_H

void connectWiFi();
void ensureWiFiConnected();
// True while a connection attempt is still in progress (not yet failed).
bool isWiFiConnecting();

#endif
