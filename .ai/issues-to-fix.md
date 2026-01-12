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

#### 12. No Handling of Database Connection Loss During Rotation

**Location:** `src/encryption/key_rotation_service.ts:234-276, 334-337, 364-369`

Database errors during rotation cause exit and resume from beginning. No distinction between transient errors (should retry) and fatal errors (should stop). Transient connection issues cause full rotation restart rather than resuming from current position.

**Impact:** Rotation may restart unnecessarily but will eventually succeed - wastes resources.
