# Key rotation issues

### Critical Issues

#### 1. Partial Phased-Out Key Configuration Allowed

**Location:** `src/encryption/versioned_encryption_service.ts:79-109`

The constructor validation uses `&&` logic which allows asymmetric partial configuration where `phasedOutKey` is provided without `phasedOutVersion` or vice versa. If only one field is provided, validation is skipped and both are silently set to null. This could mask configuration errors and lead to inability to decrypt data encrypted with the phased-out key.

**Impact:** Can cause data to become permanently undecryptable.

#### 2. No Validation for Identical Current and Phased-Out Versions

**Location:** `src/encryption/versioned_encryption_service.ts:79-109`

The validation never checks if `currentVersion` equals `phasedOutVersion`. If both versions are set to the same value (e.g., "A"), the encryption service would create encrypted data that is ambiguous and potentially decrypt with the wrong key.

**Impact:** Causes ambiguous key selection and potential decryption with wrong key.

#### 3. Race Condition in updateKeys() with Concurrent Encrypt/Decrypt

**Location:** `src/encryption/versioned_encryption_service.ts:236-242`

The `updateKeys()` method acquires only `keyMutex`, while `encrypt()` and `decrypt()` acquire only `rotationLock`. This creates a race condition window where encryption could occur with mismatched key/version pairs during key updates.

**Race scenario:**

1. Thread A calls `encrypt()`, acquires `rotationLock`, enters `encryptUnlocked()`
2. Thread B calls `updateKeys()`, acquires `keyMutex`, begins updating keys
3. Thread A reads `this.rawCurrentKey` which Thread B is modifying
4. Thread A may use cached key that doesn't match the new version

**Impact:** Can cause encryption with mismatched key/version pairs, making data undecryptable.

#### 4. Cache Invalidation Race in Key Rotation

**Location:** `src/encryption/versioned_encryption_service.ts:111-114, 318-349`

When `validateAndSetKeys()` sets `this.currentKey = null` and `this.phasedOutKey = null`, there's no guarantee that concurrent operations won't still be using cached references to the old CryptoKey objects. JavaScript object references are not atomic.

**Impact:** Encryption/decryption with wrong key during rotation.

#### 5. Deadlock Risk with Nested Lock Acquisition

**Location:** `src/encryption/key_rotation_service.ts:288-318`

The service has two mutexes (`keyMutex` and `rotationLock`) with no clear lock ordering hierarchy documented. While current implementation is careful, this structural vulnerability makes the code fragile and prone to deadlocks during future maintenance.

**Impact:** High risk of future deadlocks during maintenance.

#### 6. Integer Overflow in Base64 Conversion

**Location:** `src/encryption/utils.ts:31-34`

The `bytesToBase64()` function uses `String.fromCharCode(...bytes)` with spread operator, which can cause stack overflow for large byte arrays. JavaScript call stacks typically limit to ~65536 arguments, so any data larger than ~65KB will fail.

**Impact:** Prevents encryption of large values (>65KB), causing service failures.

#### 7. No Validation of Decrypted Data Length

**Location:** `src/encryption/versioned_encryption_service.ts:192-228`

After decryption, there's no validation that the combined IV+ciphertext had sufficient bytes. If corrupted data has < 12 bytes after base64 decode, the IV slice could be partial or empty, leading to cryptic errors from `crypto.subtle.decrypt()`.

**Impact:** Poor error messages obscure data corruption issues.

### Moderate Issues

#### 8. openssl Command Could Fail Silently in Unexpected Ways

**Location:** `src/encryption/key_storage_service.ts:60-77`

The `generateKey()` method only checks exit code but doesn't validate that output is valid base64 or has correct length.

**Edge cases not handled:**

- openssl not installed (code 127)
- stdout empty but exit code 0
- stdout contains warnings before the key
- Non-base64 characters in output

**Impact:** Could generate invalid keys leading to service startup failures.

#### 9. No Timeout on openssl Command Execution

**Location:** `src/encryption/key_storage_service.ts:61-67`

No timeout parameter on `Deno.Command`. If openssl hangs (insufficient entropy, buggy build, process suspension), service initialization hangs forever.

**Impact:** Service hangs indefinitely on startup.

#### 10. File System Race Condition in ensureInitialized()

**Location:** `src/encryption/key_storage_service.ts:101-133`

TOCTOU (Time-Of-Check-Time-Of-Use) race condition between checking if file exists and creating it. If two processes start concurrently:

1. Both check file, neither exists
2. Process A generates and writes keys
3. Process B generates DIFFERENT keys and overwrites file
4. Processes have different keys, database has encrypted data from both

**Note:** CLAUDE.md states this is intended as single-instance service, so may be acceptable risk.

**Impact:** Multiple instances could corrupt encryption keys on first startup.

#### 11. Empty String Encryption/Decryption Edge Case

**Location:** `src/encryption/versioned_encryption_service.ts:138-168, 192-228`

While tests confirm empty string encryption works, minimum encrypted string length is not validated. Empty string produces 1 version byte + base64(12 IV + 16 tag) = ~38 characters minimum.

**Impact:** Confusing behavior with very short encrypted strings, though tests show it works.

#### 12. KeyStorageService Doesn't Validate JSON Structure

**Location:** `src/encryption/key_storage_service.ts:34-44`

The `loadKeys()` method parses JSON with no validation that required fields exist or have correct types. Corrupted or manually edited JSON file could cause service to start successfully but fail on first use with unclear errors.

**Impact:** Service starts successfully but fails on first use with unclear errors.

#### 13. getNextVersion() Doesn't Handle Version Wrapping Collision Risk

**Location:** `src/encryption/key_storage_service.ts:85-94`

The method wraps Z → A but doesn't check whether wrapping would create collision with in-use phased-out version. After 26 rotations without completing previous rotation, version "A" could be reused while old "A" data exists.

**Impact:** Very unlikely but catastrophic if it occurs (requires 26 incomplete rotations).

#### 14. Rotation Service Max Failures Could Trigger Mid-Rotation

**Location:** `src/encryption/key_rotation_service.ts:99-115`

The `MAX_CONSECUTIVE_FAILURES` check stops service after 5 failures, but this could happen mid-rotation, leaving system in limbo with both keys present and no automatic recovery.

**Impact:** Could leave system in inconsistent state requiring manual intervention.

#### 15. Optimistic Concurrency in reencryptBatch() Silently Drops Updates

**Location:** `src/encryption/key_rotation_service.ts:346-387`

Logs "will retry" on optimistic concurrency conflict but doesn't actually retry. Could cause infinite loops if record is never successfully updated.

**Impact:** Could cause infinite loops or incomplete rotations.

#### 16. SecretsService Decrypt Failures Aren't Handled Gracefully

**Location:** `src/secrets/secrets_service.ts:73, 117, 234`

Calls to `encryptionService.decrypt()` don't have try-catch blocks. If any secret is corrupted or encrypted with lost key, calling `getGlobalSecretsWithValues()` fails completely - user cannot view ANY secrets, even valid ones.

**Impact:** One corrupted secret breaks entire secrets UI.

### Minor Issues

#### 17. No Limit on Plaintext Size

**Location:** `src/encryption/versioned_encryption_service.ts:138-168`

No validation or limit on plaintext size before encryption. Very large plaintexts (SQLite TEXT can hold ~1GB) could cause memory issues.

#### 18. base64ToBytes Doesn't Handle Invalid Base64 Gracefully

**Location:** `src/encryption/utils.ts:9-22`

Error wrapping loses context from original `atob()` errors.

#### 19. No Validation of IV Length in Decryption

**Location:** `src/encryption/versioned_encryption_service.ts:208`

After slicing IV, no check that it's exactly 12 bytes (covered by issue #7).

#### 20. TextEncoder/TextDecoder Not Checked for Availability

Multiple locations - assumes globals exist, which is fine for Deno but not portable.

#### 21. KeyRotationService.stop() Has Fixed 60-Second Timeout

**Location:** `src/encryption/key_rotation_service.ts:123-145`

Hard-coded timeout may be insufficient for very large databases.

#### 22. isEncryptedWithPhasedOutKey() Returns False for Empty String

**Location:** `src/encryption/versioned_encryption_service.ts:269-274`

Logic is correct but could be clearer.

### Positive Observations

The encryption service implementation has several strong patterns:

1. **Excellent use of TypeScript's `using` declaration** for automatic lock release - prevents lock leaks
2. **Comprehensive test coverage** including edge cases like empty strings and special characters
3. **Clear separation between locked and unlocked variants** prevents accidental deadlocks
4. **Proper use of AES-256-GCM** with random IVs and authenticated encryption
5. **Good logging** throughout for debugging

---

## Key Rotation Service Issues

**Total Issues Found:** 18 (5 Critical, 8 Moderate, 5 Minor)

### Critical Issues

#### 1. No Recovery from Failed Key File Write During Rotation

**Location:** `src/encryption/key_rotation_service.ts:214, 262`

In `startNewRotation()` (line 214) and `performRotation()` (line 262), if `keyStorage.saveKeys()` fails (disk full, permission error), the keys file and database will be out of sync.

**Scenarios:**

- **Line 214:** After swapping keys, if save fails, new keys loaded into memory but not persisted. On restart, old keys loaded from disk but database has records encrypted with lost key version.
- **Line 262:** When completing rotation, if save fails, database has records encrypted with current key but keys file still has `phased_out_key` set. On restart, service thinks rotation incomplete but no records left to rotate.

**Impact:** Can cause permanent data loss - records encrypted with lost keys cannot be decrypted.

#### 2. Race Condition Between Timer Check and Concurrent Access

**Location:** `src/encryption/key_rotation_service.ts:152-156, 159-163`

Gap between checking `this.isRotating` flag and loading keys allows concurrent timer ticks to both pass the check:

1. Timer check 1 passes `isRotating` check
2. Timer check 2 starts before check 1 loads keys, also passes
3. Both proceed to load keys concurrently

More likely during very short check intervals or slow file I/O.

**Impact:** Could cause two concurrent rotations attempting to re-encrypt same data with different keys.

#### 3. isRotating Flag Never Reset on Early Returns

**Location:** `src/encryption/key_rotation_service.ts:160-162, 167-169, 173-184, 188`

The `isRotating` flag is only managed in `performRotation()`. Multiple code paths in `checkAndRotate()` can throw errors or return early before reaching it. If flag is set early (to fix issue #2), errors in early paths leave flag stuck.

**Impact:** Service becomes permanently stuck, unable to perform any future rotations until restart.

#### 4. No Transaction Wrapper for Multi-Table Rotation

**Location:** `src/encryption/key_rotation_service.ts:244-250`

Rotation processes multiple tables sequentially without transaction. If rotation completes for `secrets` but fails for `api_keys`, tables are in inconsistent states. Issues:

- If error is persistent (corrupted record), rotation never completes
- `phased_out_key` remains in memory forever
- Better Auth secret updated (line 259) even though rotation didn't complete

**Impact:** Can lead to rotation getting stuck indefinitely and inconsistent session state.

#### 5. File System Permission Error Leaves Service Broken

**Location:** `src/encryption/key_storage_service.ts:50-54`

`saveKeys()` has no permission checking or specific permission error handling. If file becomes read-only during rotation:

1. Rotation updates encryption service with new keys (in memory)
2. Tries to save keys to file
3. Permission denied error
4. Keys not saved to disk
5. Database partially re-encrypted with new key
6. Service crashes/restarts
7. Loads old keys from disk (new keys lost)
8. Cannot decrypt records encrypted with lost keys

**Impact:** Can cause permanent data loss if combined with service restart.

### Moderate Issues

#### 6. Optimistic Concurrency Retry Logic Missing

**Location:** `src/encryption/key_rotation_service.ts:363-377`

Logs "will retry" on optimistic concurrency conflict but doesn't implement retry logic. Record remains with old version and is picked up in next batch. If another process keeps updating the record, it may never succeed.

**Impact:** Rotation eventually succeeds in most cases but could get stuck on frequently-updated records.

#### 7. Stop Timeout Can Leave Rotation Lock Held

**Location:** `src/encryption/key_rotation_service.ts:131-145`

If stop timeout (60s) is exceeded, service logs warning and resets `stopRequested` flag, but rotation continues in background with lock held. On restart, database connection may close while rotation still accessing it.

**Impact:** Could cause database errors and lock contention on shutdown.

#### 8. No Validation of Rotation Completion Before Clearing Phased Out Key

**Location:** `src/encryption/key_rotation_service.ts:252-269`

After processing all tables, service immediately clears `phased_out_key` without verifying all records were successfully re-encrypted. Records that failed due to errors remain with old version but old key is discarded, making them permanently unreadable.

**Impact:** Can cause data loss for records that failed to re-encrypt.

#### 9. Better Auth Secret Updated During Rotation, Not After

**Location:** `src/encryption/key_rotation_service.ts:197-212, 259`

New `better_auth_secret` generated and saved at START of rotation (line 197-199, 211), not completion. All user sessions invalidated immediately even though rotation may take minutes/hours. If rotation fails, users logged out unnecessarily.

**Impact:** Causes unnecessary user disruption but doesn't affect data integrity.

#### 10. No Handling of Modified_At Format Inconsistencies

**Location:** `src/encryption/key_rotation_service.ts:364-369`

Optimistic concurrency check compares `modified_at` as string. SQLite's `CURRENT_TIMESTAMP` format can vary based on timezone settings. If format changes between read and write (DST transition, timezone change), comparison fails causing false-positive conflicts.

**Impact:** Could cause unnecessary retries but won't cause data corruption.

#### 11. SQL Injection Risk from Unvalidated Table Names

**Location:** `src/encryption/key_rotation_service.ts:26, 328-332, 365-367`

Table names interpolated directly into SQL queries using template strings. While `ENCRYPTED_TABLES` is currently a hardcoded constant, the pattern is vulnerable if ever made configurable.

**Impact:** Not currently exploitable but dangerous pattern - security vulnerability if refactored.

#### 12. Key Generation Failure Leaves Service in Inconsistent State

**Location:** `src/encryption/key_rotation_service.ts:197-200`

Key generation uses external `openssl` command. If openssl not installed or fails, error propagates and failure counter increments. After 5 consecutive failures, service auto-stops permanently with no alerting.

**Impact:** Service fails safely but becomes permanently disabled until manual restart.

#### 13. No Handling of Database Connection Loss During Rotation

**Location:** `src/encryption/key_rotation_service.ts:234-276, 334-337, 364-369`

Database errors during rotation cause exit and resume from beginning. No distinction between transient errors (should retry) and fatal errors (should stop). Transient connection issues cause full rotation restart rather than resuming from current position.

**Impact:** Rotation may restart unnecessarily but will eventually succeed - wastes resources.

### Minor Issues

#### 14. Timer Interval Not Cleared on Start Failure

**Location:** `src/encryption/key_rotation_service.ts:83-116`

Timer scheduled after initial check starts but before it completes. If initial check fails, timer continues running. More semantic issue than functional bug.

#### 15. Rotation Interval Calculation Doesn't Account for Leap Seconds/DST

**Location:** `src/encryption/key_rotation_service.ts:173-178`

Simple millisecond arithmetic doesn't account for DST transitions or leap seconds. Given rotation intervals measured in days (default 90), error is negligible (<0.001%).

#### 16. No Rate Limiting on Encryption Service Lock Acquisition

**Location:** `src/encryption/key_rotation_service.ts:291-312`

No timeout on lock acquisition. If another process holds rotation lock indefinitely, could hang. Unlikely given current usage patterns (only rotation service uses this lock).

#### 17. Version Wrapping from Z to A Not Explicitly Tested in Service

**Location:** `src/encryption/key_rotation_service.ts:202`

After 26 rotations, version wraps Z → A. By design, old keys are discarded, so data older than 2 rotation cycles (180 days default) cannot be decrypted. Should be documented but isn't a bug.

#### 18. No Atomic Write Pattern for Key File

**Location:** `src/encryption/key_storage_service.ts:50-54`

Direct write to key file without atomic write pattern (write to temp, then rename). Partial writes possible if process crashes mid-write.

### Positive Observations

The key rotation service has several good patterns:

1. **Proper lock usage** - Uses `using` disposable pattern for automatic lock release
2. **Graceful shutdown** - `stop()` method waits for in-progress rotation with timeout
3. **Resumption logic** - Correctly detects incomplete rotations and resumes
4. **Batch processing** - Batches with sleep intervals prevent overwhelming database
5. **Optimistic concurrency** - Using `modified_at` is correct pattern for long-running operations
6. **Idempotent start** - Prevents duplicate timers correctly

---

## Summary by Severity

### Encryption Service

- **Critical:** 7 issues - partial config validation, version collision, race conditions, deadlock risk, stack overflow, length validation
- **Moderate:** 9 issues - openssl validation, timeouts, file system races, JSON validation, retry logic
- **Minor:** 6 issues - size limits, error wrapping, portability

### Key Rotation Service

- **Critical:** 5 issues - failed writes, race conditions, flag management, transaction handling, permission errors
- **Moderate:** 8 issues - retry logic, lock handling, validation, session handling, error recovery
- **Minor:** 5 issues - timer cleanup, time calculations, lock timeouts, version wrapping, atomic writes

## Recommended Priority Order for Fixes

1. **Encryption Service Issue #3** - Race condition in updateKeys() (most likely to cause production issues)
2. **Key Rotation Issue #1** - Failed key file write recovery (data loss risk)
3. **Key Rotation Issue #5** - File permission error handling (data loss risk)
4. **Encryption Service Issue #1** - Partial phased-out key config (data loss risk)
5. **Encryption Service Issue #2** - Version collision check (silent corruption risk)
6. **Encryption Service Issue #6** - Stack overflow in base64 conversion (breaks large values)
7. **Key Rotation Issue #4** - Multi-table transaction wrapper (consistency)
8. **Key Rotation Issue #2** - Timer check race condition (concurrency)
9. **Encryption Service Issue #7** - Length validation in decrypt (better errors)
10. **Key Rotation Issue #8** - Validation before clearing phased out key (data loss prevention)

# Architecture issues

  🟡 Major Consistency Issues

  Error Handling Inconsistency

- Some methods return null on not found
- Some throw errors
- Some silently succeed
- Fix: Document and enforce consistent patterns across services

  Validation Scattered Everywhere

- API key validators in service file
- Route validators in service file
- File validators in service file
- Fix: Consolidate to src/validation/ directory

  Query Pattern Duplication

- ExecutionMetricsService.getByRouteId() has 4 identical SQL queries
- Fix: Build queries dynamically (~25 lines saved)

# Database inconsistencies

ID Type Inconsistencies

  You're absolutely correct! There's a major inconsistency:

  INTEGER IDs (most tables):

- api_keys - INTEGER PRIMARY KEY AUTOINCREMENT
- routes - INTEGER PRIMARY KEY AUTOINCREMENT
- console_logs - INTEGER PRIMARY KEY AUTOINCREMENT
- execution_metrics - INTEGER PRIMARY KEY AUTOINCREMENT
- api_key_groups - INTEGER PRIMARY KEY AUTOINCREMENT
- secrets - INTEGER PRIMARY KEY AUTOINCREMENT
- settings - INTEGER PRIMARY KEY AUTOINCREMENT

  TEXT IDs (Better Auth tables only):

- user - TEXT PRIMARY KEY
- session - TEXT PRIMARY KEY
- account - TEXT PRIMARY KEY
- verification - TEXT PRIMARY KEY

  Other Schema Inconsistencies Found

  1. Naming Convention Conflicts (snake_case vs camelCase)

  Better Auth tables use camelCase:

- createdAt, updatedAt (user, session, account)
- emailVerified, banReason, banExpires (user)
- userId, expiresAt, ipAddress, userAgent, impersonatedBy (session)
- userId, accountId, providerId, accessToken, refreshToken, etc. (account)

  Custom tables use snake_case:

- created_at, modified_at, key_group, route_id, request_id, avg_time_ms, max_time_ms, execution_count, group_id, function_id, api_group_id, api_key_id, user_id, is_encrypted

  2. Timestamp Field Naming

  Three different patterns:

- created_at / modified_at - custom tables (migrations 000, 003, 004, 005)
- createdAt / updatedAt - Better Auth tables (migration 002)
- timestamp - console_logs, execution_metrics (migration 001)

  3. Boolean Field Conventions

- Better Auth: emailVerified INTEGER, banned INTEGER (camelCase, no prefix)
- Custom: is_encrypted INTEGER (snake_case with is_ prefix)

  4. Foreign Key References to User Table

  The settings table references user(id) which is TEXT, making settings.user_id a TEXT field while all other FKs in the schema are INTEGER references.
