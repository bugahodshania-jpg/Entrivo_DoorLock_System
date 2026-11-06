# Debug Session: Fingerprint Verification Failure
**Session ID**: fingerprint-verify-failure
**Project Root**: `c:\system\Entrivo_DoorLock_System`
**Debug Evidence Dir**: `c:\system\_entrivo_debug\fingerprint-verify-failure`

## Symptoms
- 3rd scan verification fails to match the newly enrolled slot (e.g., slot 26).
- One-to-one `Match (0x03)` returns `status=0x8` (no match) even though the template was just stored.
- Sometimes matches an older slot (e.g., slot 21) instead of the new one.

## Hypotheses
1. **[HYP-1] Poor Scan Consistency**: The 3rd scan features differ too much from the combined RegModel template.
2. **[HYP-2] Matching Level Strictness**: The sensor's security level makes the one-to-one `Match` command too restrictive compared to `Search`.
3. **[HYP-3] Template Loading Issue**: The `LoadChar` or buffer management before `Match` is failing to present the correct features to the comparator.
4. **[HYP-4] Latency/Timing**: The sensor needs more time between `Store` and `LoadChar/Match` to stabilize the flash memory.

## Evidence Gate
| Hypothesis | Evidence Source | Status | Conclusion |
|------------|-----------------|--------|------------|
| HYP-1      | Serial Logs     | PENDING|            |
| HYP-2      | Serial Logs     | PENDING|            |
| HYP-3      | Serial Logs     | PENDING|            |
| HYP-4      | Serial Logs     | PENDING|            |

## Progress
- [x] Initialized debug record.
- [x] Added instrumentation to `initFingerprint` to log Security Level.
- [x] Modified `verifyEnrolledFingerprint` to perform **Targeted Verification** (1:1 Match) before general Search.
- [x] Increased verification attempts to 5.

## Findings
- In the user's log, `Match occupied slot=26 status=0x8` occurred on the first attempt, meaning the finger didn't match the newly stored slot even in a 1:1 comparison.
- On the second attempt, a general `HiSpeedSearch` matched slot 21 (confidence 157).
- The new targeted verification strategy ensures that if the finger matches the new slot, it succeeds immediately, bypassing the duplicate match at slot 21.
- If it still fails to match the new slot, the general search will identify the duplicate at slot 21 and provide a specific error message.

## Next Steps
- User needs to flash the new firmware and test enrollment.
- Observe Serial output for "Verifying specifically against slot X" and the matching result.
