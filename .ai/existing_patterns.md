# Existing Patterns Reference

This document captures the key patterns used in the Crude Functions codebase for reference when implementing the Code Sources feature.

---

## 1. Background Service Pattern

Reference files: `src/logs/log_trimming_service.ts`, `src/metrics/metrics_aggregation_service.ts`

### Structure

```typescript
export interface ServiceOptions {
  dependency: SomeDependency;
  config: ServiceConfig;
}

export class BackgroundService {
  private readonly dependency: SomeDependency;
  private readonly config: ServiceConfig;
  private timerId: number | null = null;
  private isProcessing = false;
  private stopRequested = false;
  private consecutiveFailures = 0;

  private static readonly MAX_CONSECUTIVE_FAILURES = 5;
  private static readonly STOP_TIMEOUT_MS = 30000;

  constructor(options: ServiceOptions) {
    this.dependency = options.dependency;
    this.config = options.config;
  }
}
```

### Key Patterns

**Start method:**
- Guard against double-start: `if (this.timerId !== null) return;`
- Log startup with config info
- Run immediately on start, then schedule interval
- Reset `consecutiveFailures` on success
- Auto-stop after `MAX_CONSECUTIVE_FAILURES`

```typescript
start(): void {
  if (this.timerId !== null) {
    logger.warn("[ServiceName] Already running");
    return;
  }

  logger.info(`[ServiceName] Starting with interval ${this.config.intervalSeconds}s`);

  // Run immediately, then schedule interval
  this.runTask()
    .then(() => { this.consecutiveFailures = 0; })
    .catch((error) => {
      this.consecutiveFailures++;
      logger.error("[ServiceName] Initial task failed:", error);
    });

  this.timerId = setInterval(() => {
    this.runTask()
      .then(() => { this.consecutiveFailures = 0; })
      .catch((error) => {
        this.consecutiveFailures++;
        logger.error(`[ServiceName] Task failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, error);

        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.error("[ServiceName] Max failures reached, stopping");
          if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
          }
        }
      });
  }, this.config.intervalSeconds * 1000);
}
```

**Stop method:**
- Clear interval first
- Set `stopRequested = true`
- Wait for in-progress work with timeout
- Reset `stopRequested` after completion

```typescript
async stop(): Promise<void> {
  if (this.timerId !== null) {
    clearInterval(this.timerId);
    this.timerId = null;
  }

  this.stopRequested = true;

  const startTime = Date.now();
  while (this.isProcessing) {
    if (Date.now() - startTime > STOP_TIMEOUT_MS) {
      logger.warn("[ServiceName] Stop timeout exceeded");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  this.stopRequested = false;
  logger.info("[ServiceName] Stopped");
}
```

**Processing method:**
- Guard against concurrent execution: `if (this.isProcessing) return;`
- Set `isProcessing = true` in try, reset in finally
- Check `stopRequested` between steps for graceful shutdown

```typescript
private async runTask(): Promise<void> {
  if (this.isProcessing) {
    logger.debug("[ServiceName] Skipping, already processing");
    return;
  }

  this.isProcessing = true;
  try {
    // Step 1
    await this.doStep1();
    if (this.stopRequested) return;

    // Step 2
    await this.doStep2();
    if (this.stopRequested) return;

    // ... more steps
  } finally {
    this.isProcessing = false;
  }
}
```

---

## 2. Encryption Pattern

Reference files: `src/encryption/versioned_encryption_service.ts`, `src/secrets/secrets_service.ts`

### VersionedEncryptionService Interface

```typescript
interface IEncryptionService {
  encrypt(plaintext: string): Promise<string>;
  decrypt(encrypted: string): Promise<string>;
}
```

### Key Features

- **AES-256-GCM** for authenticated encryption
- **Version prefix**: Single char (A-Z) prepended to encrypted data for key identification
- **Format**: `VERSION_CHAR + base64(IV || ciphertext || auth_tag)`
- **Key rotation support**: `currentKey` + optional `phasedOutKey`
- **Mutex protection**: `rotationLock` blocks encrypt/decrypt during key updates

### Consumer Pattern (SecretsService)

Services that handle encrypted data follow this pattern:

```typescript
export class SecretsService {
  private readonly db: DatabaseService;
  private readonly encryptionService: IEncryptionService;

  constructor(options: { db: DatabaseService; encryptionService: IEncryptionService }) {
    this.db = options.db;
    this.encryptionService = options.encryptionService;
  }

  // Writing encrypted data
  async create(name: string, value: string): Promise<void> {
    const encryptedValue = await this.encryptionService.encrypt(value);
    await this.db.execute(
      `INSERT INTO secrets (name, value) VALUES (?, ?)`,
      [name, encryptedValue]
    );
  }

  // Reading encrypted data
  async get(id: number): Promise<Secret | null> {
    const row = await this.db.queryOne<{ value: string }>(`SELECT value FROM secrets WHERE id = ?`, [id]);
    if (!row) return null;

    let decryptedValue = "";
    let decryptionError: string | undefined;
    try {
      decryptedValue = await this.encryptionService.decrypt(row.value);
    } catch (error) {
      decryptionError = error instanceof Error ? error.message : "Decryption failed";
    }

    return { value: decryptedValue, decryptionError };
  }
}
```

### Encryption Keys Storage

Keys are stored in `./data/encryption-keys.json` via `KeyStorageService`:

```typescript
interface EncryptionKeys {
  current_key: string;       // Base64-encoded 32 bytes
  current_version: string;   // Single char A-Z
  phased_out_key?: string;   // During rotation
  phased_out_version?: string;
  hash_key: string;          // For API key hashing
  better_auth_secret: string;
}
```

---

## 3. Service Ownership Pattern

Reference files: `src/database/database_service.ts`, `src/routes/routes_service.ts`

### Core Principle

**Services own database access.** Never query the database directly from routes or other code.

### DatabaseService Interface

```typescript
interface DatabaseService {
  // Writes (mutex-protected)
  execute(sql: string, params?: BindValue[]): Promise<ExecuteResult>;
  exec(sql: string): Promise<number>;

  // Reads (no mutex, WAL mode)
  queryAll<T>(sql: string, params?: BindValue[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: BindValue[]): Promise<T | null>;

  // Transactions
  transaction<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
```

### Service Constructor Pattern

All services use options object with `db: DatabaseService`:

```typescript
export interface ServiceOptions {
  db: DatabaseService;
  // other dependencies...
}

export class SomeService {
  private readonly db: DatabaseService;

  constructor(options: ServiceOptions) {
    this.db = options.db;
  }
}
```

### Mutex Usage

- **Write operations**: Automatically mutex-protected via `db.execute()`
- **Read operations**: No mutex needed (WAL mode allows concurrent reads)
- **Custom synchronization**: Use `@core/asyncutil/mutex` for service-level coordination

```typescript
import { Mutex } from "@core/asyncutil/mutex";

class ServiceWithCustomSync {
  private readonly rebuildMutex = new Mutex();

  async rebuildIfNeeded(): Promise<void> {
    using _lock = await this.rebuildMutex.acquire();
    // ... synchronized work
  }
}
```

### Startup Initialization Order (from main.ts)

1. `KeyStorageService` - encryption keys
2. `VersionedEncryptionService` - encryption
3. `HashService` - API key hashing
4. `DatabaseService.open()` - database connection
5. `MigrationService.migrate()` - schema migrations
6. `SettingsService.bootstrapGlobalSettings()` - settings
7. Better Auth creation
8. `UserService`
9. `ConsoleLogService`
10. `ExecutionMetricsService`, `MetricsStateService`
11. `MetricsAggregationService.start()` - background service
12. `LogTrimmingService.start()` - background service

---

## 4. TestSetupBuilder Pattern

Reference file: `src/test/test_setup_builder.ts`

### Purpose

- Use real migrations instead of hardcoded schemas
- Match production initialization order
- Modular service selection
- Auto-dependency resolution

### Basic Usage

```typescript
// Minimal context
const ctx = await TestSetupBuilder.create()
  .withMetrics()
  .build();

// With specific services
const ctx = await TestSetupBuilder.create()
  .withSettings()
  .withApiKeys()
  .build();

// Full context (all services)
const ctx = await TestSetupBuilder.create().build();
```

### API Levels

1. **Convenience methods** (recommended): `withMetrics()`, `withSettings()`, `withLogs()`
2. **Individual methods**: `withExecutionMetricsService()`, `withSettingsService()`

### Deferred Data

```typescript
const ctx = await TestSetupBuilder.create()
  .withApiKeyGroup("management", "Test keys")
  .withApiKey("management", "test-api-key")
  .withRoute("/hello", "hello.ts", { methods: ["GET"] })
  .withFile("hello.ts", `export default async () => ...`)
  .withSetting(SettingNames.LOG_LEVEL, "debug")
  .build();
```

### Context Cleanup

Always call `cleanup()` in finally block:

```typescript
const ctx = await TestSetupBuilder.create().withMetrics().build();
try {
  // ... test code
} finally {
  await ctx.cleanup();
}
```

### Adding New Services

1. Add flag to `ServiceFlags` in `dependency_graph.ts`
2. Add to dependency graph if service has dependencies
3. Add `with*()` method to `TestSetupBuilder`
4. Add creation logic in `build()` method following the initialization order
5. Add factory function in `service_factories.ts`

---

## 5. Quick Reference

### Constructor Options Pattern

```typescript
export interface ServiceOptions {
  db: DatabaseService;
  encryptionService?: IEncryptionService;
  config?: ServiceConfig;
}

export class Service {
  private readonly db: DatabaseService;

  constructor(options: ServiceOptions) {
    this.db = options.db;
    // ...
  }
}
```

### Logger Usage

```typescript
import { logger } from "../utils/logger.ts";

logger.info("[ServiceName] Message");
logger.warn("[ServiceName] Warning");
logger.error("[ServiceName] Error:", error);
logger.debug("[ServiceName] Debug info");
```

### Error Handling Pattern

Custom errors are defined per module (e.g., `database/errors.ts`, `encryption/errors.ts`):

```typescript
export class CustomError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "CustomError";
  }
}
```

### Async Resource Cleanup

Use `using` declaration with `Disposable`:

```typescript
using _lock = await this.mutex.acquire();
// lock automatically released when scope exits
```
