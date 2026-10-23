#ifndef DOOR_SENSOR_MEMORY_H
#define DOOR_SENSOR_MEMORY_H

// Run only after enrollment/import work. Each call performs at most one inventory
// command, one requested template read, or one full library erase.
bool serviceSensorMemory(bool sensorReady);

// An enrollment/import between inventory pages would make the snapshot unreliable.
void interruptSensorMemoryRead();

#endif
