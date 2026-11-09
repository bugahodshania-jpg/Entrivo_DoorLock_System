# Debug Session: Fingerprint Verification Failure (3rd scan)
**Project Root**: `c:\system\Entrivo_DoorLock_System`
**Firmware**: `esp32/Door_Controller_Enrollment`

## Symptoms
- The 3rd scan (independent verification) fails to match the newly enrolled slot (e.g., slot 26).
- 1:1 `Match (0x03)` returned `0x08` and `HiSpeedSearch (0x1B)` returns `0x09` against the new slot.
- Sometimes the 3rd scan matches an older slot (e.g., slot 21, confidence 157) instead of the new one.

## Root causes (from code review; confirm on hardware)
1. **Scan 1 was re-converted many times before RegModel.** The duplicate check rebuilt
   CharBuffer1 from the same scan-1 image before every 163-slot search window (about 7 times
   on a 1000-slot sensor) and once more before scan 2. That last rebuilt feature file became the
   scan-1 half of the model. If GenChar alters the image buffer, the stored template is weak:
   RegModel still succeeds, but a good third scan gets 0x09. Two different comparators (Match
   and HiSpeedSearch) both rejected the new slot, which points at the stored template.
2. **`0x17` was treated as "not found" in the duplicate check.** An unchecked window counted as
   clear, so a finger already stored elsewhere (slot 21) could be stored again and the 3rd scan
   then identified the old slot.
3. **The 3rd scan used only HiSpeedSearch (0x1B),** which is intended for good-quality prints,
   with no fallback. The door-access path does have a fallback.

## Fix (2026-11-07)
- `firstScanIsNotDuplicate`: upload the ORIGINAL scan-1 feature file (UpChar) before the
  duplicate search and write it back (DownChar, verified byte-for-byte) afterwards. If either
  step fails, take a fresh first scan. A rebuilt buffer never reaches RegModel.
  RegModel -> Store stays back-to-back with nothing in between.
- `searchLibraryFromCurrentImage`: on 0x17 or another sensor status, rebuild and retry that window
  once; if it still is not 0x09, stop with "could not finish checking". Nothing is saved.
- `checkFreshScanAgainstSlot`: if HiSpeedSearch misses, rebuild from the same 3rd-scan image and
  run standard Search (0x04) over the same window. Only the exact expected slot verifies.
- New `searchFingerprintWindowStandard` in `SensorTransfer.cpp`.
- Door access search (`searchFingerprintVerified`) is unchanged.

## What to check in Serial Monitor after flashing
- `Saved the original scan 1 features (N bytes)` and `Restored the original scan 1 features ... (verified byte-for-byte)`.
  If you see `Taking a fresh first scan` instead, the backup or restore failed; the reason is logged above it.
- `Verification attempt summary`: each line shows `fast <status>` and, if it ran, `standard <status>`.
- If enrollment now stops with `could not finish checking for an existing copy`, look for
  `Duplicate check window start=... returned 0x..` and report that log.

## Follow-up (2026-11-09): ANY search before RegModel breaks the model on this R307S
- Job #70 (sensor empty, so no search ran): the only extra step was UpChar + DownChar of
  CharBuffer1. RegModel/Store returned 0x00, yet all 5 verification scans got 0x09.
- After removing the round trip and searching with CharBuffer2 instead, the first enrollment on an
  empty sensor passed, but the next one (1 template stored, so the search really ran) failed the
  same way. Conclusion: on this module any Search between scan 1 and RegModel spoils CharBuffer1,
  whatever BufferID the command names.
- Fix: nothing is sent to the sensor between scan 1 and RegModel/Store (plain Adafruit enroll.ino).
  The duplicate check moved to the verification scan, after Store, where consuming the buffer is
  harmless: `sweepForMatch` first searches the new slot's window (skipping an update's previous
  slot), then searches every other occupied slot with the same image, rebuilding CharBuffer1 before
  each search. A match elsewhere means the finger is already enrolled: the new slot is rolled back.
- Check in Serial Monitor: `First scan accepted.`, `Verification scan matched slot N`, then
  `No other copy of this finger on Sensor A.` or `Duplicate: this finger is also stored at slot M`.

## Root cause found (2026-11-09): the R307S flash no longer stores new templates correctly
- `esp32/Fingerprint_Bench_Test` (stock Adafruit calls only, no door firmware) test `x`:
  model straight from createModel (sensor RAM) vs a fresh scan: MATCH, score 301 / 283.
  Same model after storeModel + loadModel (sensor flash) vs a fresh scan: NO MATCH (0x08), twice.
- Store returns 0x00 but the template written to flash is damaged. Templates stored earlier still
  match, which is why one older enrollment keeps working while every new one fails.
- Fix: replace the fingerprint sensor, then re-enroll everyone. Run bench test `x` on the new
  sensor first: A and B must both MATCH.
- The firmware changes above are not the cause and work on a healthy sensor.
