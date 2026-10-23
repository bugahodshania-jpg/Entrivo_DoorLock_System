#ifndef DOOR_SENSOR_MEMORY_H
#define DOOR_SENSOR_MEMORY_H

// Run only after enrollment/import work. Each call performs at most one inventory
// command or one requested template read. No sensor flash is changed.
bool serviceSensorMemory(bool sensorReady);

// An enrollment/import between inventory pages would make the snapshot unreliable.
void interruptSensorMemoryRead();

#endif
