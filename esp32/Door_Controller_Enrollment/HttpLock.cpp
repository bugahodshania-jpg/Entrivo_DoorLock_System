#include "HttpLock.h"

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace {
    SemaphoreHandle_t mutex = nullptr;
}

void initHttpLock() {
    if (mutex == nullptr) mutex = xSemaphoreCreateMutex();
}

EntrivoHttpLock::EntrivoHttpLock() {
    initHttpLock();
    if (mutex != nullptr) xSemaphoreTake(mutex, portMAX_DELAY);
}

EntrivoHttpLock::~EntrivoHttpLock() {
    if (mutex != nullptr) xSemaphoreGive(mutex);
}
