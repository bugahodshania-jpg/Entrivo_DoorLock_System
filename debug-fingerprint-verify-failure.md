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
