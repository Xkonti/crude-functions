---
name: crude-functions-testing
description: Testing best practices for Crude Functions project - includes TestSetupBuilder usage patterns, test structure guidelines, mocking approaches, and anti-patterns to avoid. Use when writing or modifying tests in the Crude Functions codebase, or when questions arise about testing strategy, test setup, or test organization.
---

# Testing in Crude Functions

## Overview

This skill documents testing best practices specific to the Crude Functions project. Testing in this codebase follows a philosophy of **real infrastructure over mocks** - preferring real databases, migrations, and services when practical. The centerpiece is **TestSetupBuilder**, a fluent API for creating isolated test environments that mirror production initialization.

**All tests run in parallel** against a single shared SurrealDB instance for ~10x speedup. This requires careful attention to avoid race conditions - see [Parallel Test Execution](#parallel-test-execution).

**Key Principles:**
- Use real infrastructure (database, migrations, services) via TestSetupBuilder for integration tests
- Use simple helper functions for focused unit tests
- Minimize mocking - only mock at boundaries (auth, external systems)
- Always cleanup resources with try-finally pattern
- Test pure functions separately without setup overhead
- Avoid timing-based synchronization - use polling or Promise-based signaling
- Never modify process-global state without mutex coordination

## TestSetupBuilder

**Location:** `src/test/test_setup_builder.ts`

### What It Is

TestSetupBuilder provides isolated test environments with:
- Real SurrealDB database (isolated namespace)
- Full migration execution
- Multiple services with automatic dependency resolution
- Deferred data insertion (API keys, routes, settings, users)
- Guaranteed cleanup

**Why it exists:** Mirrors production initialization flow from `main.ts` to prevent schema and initialization drift between tests and production.

### When to Use TestSetupBuilder

Use TestSetupBuilder for:
- **Integration tests** - Multiple services working together
- **Database-dependent tests** - Tests requiring real schema and migrations
- **Production flow validation** - Ensuring initialization matches production

### When NOT to Use TestSetupBuilder

Skip TestSetupBuilder for:
- **Pure function tests** - Logic with no infrastructure dependencies
- **Single-class unit tests** - Testing one service in isolation
- **Low-level utilities** - Simple helpers, validators, formatters

### integrationTest() Helper

**Location:** `src/test/test_helpers.ts`

When using TestSetupBuilder, you **must use `integrationTest()`** instead of `Deno.test()`.

**Why:** TestSetupBuilder uses a shared SurrealDB process for performance. Deno's test sanitizer treats this shared infrastructure as a "leak" since it persists across tests. The `integrationTest()` wrapper disables the resource and ops sanitizers to allow this.

```typescript
import { integrationTest } from "@/test/test_helpers.ts";
import { TestSetupBuilder } from "@/test/test_setup_builder.ts";
import { expect } from "@std/expect";

// ✓ Correct - uses integrationTest for TestSetupBuilder tests
integrationTest("RoutesService.getAll returns empty initially", async () => {
  const ctx = await TestSetupBuilder.create().withRoutes().build();
  try {
    const routes = await ctx.routesService.getAll();
    expect(routes).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

// ✗ Wrong - Deno.test will fail with sanitizer errors
Deno.test("This will fail", async () => {
  const ctx = await TestSetupBuilder.create().withRoutes().build();
  // ... sanitizer errors about leaked resources
});
```

**When to use `integrationTest()`:**
- Any test using TestSetupBuilder
- Tests with long-lived shared infrastructure
- Tests needing disabled sanitizers

**When to use `Deno.test()`:**
- Pure function tests (no infrastructure)
- Simple helper-based unit tests that don't use TestSetupBuilder
- Tests that fully clean up all resources

### How to Use TestSetupBuilder

#### Basic Pattern

```typescript
import { integrationTest } from "@/test/test_helpers.ts";
import { TestSetupBuilder } from "@/test/test_setup_builder.ts";
import { expect } from "@std/expect";

integrationTest("RoutesService.getAll returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()  // All services
    .build();

  try {
    const routes = await ctx.routesService.getAll();
    expect(routes).toEqual([]);
  } finally {
    await ctx.cleanup();  // Always cleanup
  }
});
```

#### Convenience Methods (Recommended)

```typescript
// Minimal - just metrics
.withMetrics()  // → ExecutionMetricsService + MetricsStateService

// Encryption only
.withEncryption()  // → EncryptionService + HashService

// Settings (auto-enables encryption)
.withSettings()  // → SettingsService + EncryptionService + HashService

// Logs (auto-enables settings)
.withLogs()  // → ConsoleLogService + SettingsService + encryption

// Routes (auto-enables files)
.withRoutes()  // → RoutesService + FileService

// Files only
.withFiles()  // → FileService

// API Keys (auto-enables encryption)
.withApiKeys()  // → ApiKeyService + EncryptionService + HashService

// Secrets (auto-enables encryption)
.withSecrets()  // → SecretsService + EncryptionService

// Users (auto-enables auth)
.withUsers()  // → UserService + Auth + encryption

// Instance ID
.withInstanceId()  // → InstanceIdService

// Job Queue (auto-enables instanceId)
.withJobQueue()  // → JobQueueService + InstanceIdService

// Scheduling (auto-enables jobQueue)
.withScheduling()  // → SchedulingService + JobQueueService + InstanceIdService

// Code Sources (auto-enables scheduling, encryption)
.withCodeSources()  // → CodeSourceService + SchedulingService + encryption

// Everything
.withAll()  // → All services
```

#### Individual Methods (Fine-Grained Control)

```typescript
.withExecutionMetricsService()
.withMetricsStateService()
.withEncryptionService()
.withHashService()
.withSettingsService()
.withConsoleLogService()
.withRoutesService()
.withFileService()
.withApiKeyService()
.withSecretsService()
.withAuth()
.withUserService()
.withInstanceIdService()
.withJobQueueService()
.withSchedulingService()
.withCodeSourceService()
```

#### Deferred Data Pattern

Create data during build phase with automatic dependency ordering:

```typescript
const ctx = await TestSetupBuilder.create()
  .withApiKeyGroup("management", "Admin keys")
  .withApiKey("management", "test-api-key-123")
  .withRoute("/hello", "hello.ts", { methods: ["GET"] })
  .withSetting("api.access-groups", "management")
  .build();

// All data created in correct order with FK constraints satisfied
const routes = await ctx.routesService.getAll();
expect(routes.length).toBe(1);
```

**Available deferred data methods:**

```typescript
// Users
.withAdminUser("admin@example.com", "password123", ["admin"])

// API Keys
.withApiKeyGroup("group-name", "optional description")
.withApiKey("group-name", "key-value", "optional-name", "optional-description")

// Routes and Files
.withRoute("/path", "filename.ts", { methods: ["GET", "POST"] })
.withFile("filename.ts", "export default () => 'Hello'")

// Settings
.withSetting("setting.name", "value")

// Logs and Metrics
.withConsoleLog({ routeName: "test", level: "info", message: "log message" })
.withMetric({ routeName: "test", executionTimeMs: 100, success: true })

// Jobs
.withJob({ name: "test-job", ... })
```

#### Auto-Dependency Resolution

TestSetupBuilder automatically enables dependent services:

```typescript
// This...
.withSettings()

// Automatically enables:
// - EncryptionService (settings needs encryption)
// - HashService (encryption needs hashing)

// This...
.withLogs()

// Automatically enables:
// - ConsoleLogService
// - SettingsService (logs need settings)
// - EncryptionService + HashService (settings dependencies)
```

**Location:** Dependency graph defined in `src/test/dependency_graph.ts`

### Minimal Context Construction

Request only what you need:

```typescript
// Metrics test - only metrics services
const ctx = await TestSetupBuilder.create()
  .withMetrics()
  .build();

// Routes test - routes + file service (auto-enabled)
const ctx = await TestSetupBuilder.create()
  .withRoutes()
  .build();

// Full integration - everything
const ctx = await TestSetupBuilder.create()
  .withAll()
  .build();
```

## SurrealDB Testing

### Overview

Tests use a **shared SurrealDB process** managed by `SharedSurrealManager`:
- **Singleton process** - One SurrealDB instance shared across all tests for performance
- **Namespace isolation** - Each test gets a unique namespace (UUID-based) for data isolation
- **Memory mode** - Runs in memory for speed
- **Auto-cleanup** - Namespaces are deleted per-test, process cleaned up on exit

**Location:** `src/test/shared_surreal_manager.ts`

### SurrealDB Context Properties

All test contexts include these SurrealDB-related properties:

```typescript
interface BaseTestContext {
  // SurrealDB properties (always available)
  surrealDb: Surreal;              // Raw Surreal SDK connection to test namespace
  surrealFactory: SurrealConnectionFactory;  // Factory for creating new connections
  surrealNamespace: string;        // Unique namespace (e.g., "test_abc123...")
  surrealDatabase: string;         // Database name (same as namespace)

  cleanup: () => Promise<void>;    // Cleans up namespace and resources
}
```

### Infrastructure Control Methods

For testing migration logic or customizing the test environment:

```typescript
// Custom migrations directory (default: ./migrations)
.withMigrationsDir("/path/to/migrations")

// Skip SurrealDB migrations during build
.withoutSurrealMigrations()

// Only base context - no services enabled
.withBaseOnly()
```

### Typical SurrealDB Test Pattern

From `src/database/surreal_migration_service_test.ts`:

```typescript
import { integrationTest } from "@/test/test_helpers.ts";
import { TestSetupBuilder } from "@/test/test_setup_builder.ts";
import { expect } from "@std/expect";

integrationTest("migrate applies all migrations on fresh database", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    // Write test migration files
    await Deno.writeTextFile(
      `${tempMigrationsDir}/000-init.surql`,
      `
      DEFINE TABLE users SCHEMAFULL;
      DEFINE FIELD name ON users TYPE string;
      `
    );

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
      .withoutSurrealMigrations()      // Don't auto-run SurrealDB migrations
      .withBaseOnly()                  // Just base context, no services
      .build();

    try {
      // Create migration service with SurrealDB context
      const migrationService = new SurrealMigrationService({
        connectionFactory: ctx.surrealFactory,
        migrationsDir: tempMigrationsDir,
        namespace: ctx.surrealNamespace,
        database: ctx.surrealDatabase,
      });

      // Run migrations
      const result = await migrationService.migrate();
      expect(result.appliedCount).toBe(1);

      // Query SurrealDB directly to verify
      const [users] = await ctx.surrealDb.query<[unknown[]]>("SELECT * FROM users");
      expect(Array.isArray(users)).toBe(true);
    } finally {
      await ctx.cleanup();  // Inner cleanup - SurrealDB namespace
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });  // Outer cleanup - temp dir
  }
});
```

### Best Practices for SurrealDB Tests

1. **Always use `integrationTest()`** - Required for shared SurrealDB infrastructure
2. **Use nested try-finally** - Outer for temp resources, inner for ctx.cleanup()
3. **Use `.withBaseOnly()` for migration tests** - Prevents auto-running migrations you're testing
4. **Query `ctx.surrealDb` directly** - Verify state after operations
5. **Namespace isolation is automatic** - No manual cleanup needed beyond `ctx.cleanup()`

## Parallel Test Execution

### Overview

**All tests run in parallel** against a single shared SurrealDB instance. This provides ~10x speedup over sequential execution but requires careful attention to avoid race conditions.

**Key facts:**
- Tests run via `deno task test` which starts one SurrealDB and runs `deno test --parallel`
- Each test file runs in its own Deno isolate (separate memory space)
- All tests share the same SurrealDB process via namespace isolation
- Process-global state (console, Deno.exit, environment variables) is shared across tests within a file

### Race Condition Patterns to Avoid

#### ❌ Pattern 1: Timing-Based Synchronization

**Problem:** Using `setTimeout` or fixed delays to wait for async operations.

```typescript
// BAD - timing-based, flaky under load
processor.start();
await new Promise((r) => setTimeout(r, 100));  // Hope it started
expect(processor.isRunning()).toBe(true);

// BAD - waiting for handler to be called
await new Promise((r) => setTimeout(r, 500));  // Hope handler ran
expect(handlerCalled).toBe(true);
```

**Why it fails:** Under parallel execution with CPU load, 100ms may not be enough. Tests become flaky.

**Solution A: Polling for state changes**

```typescript
// GOOD - poll until condition is met or timeout
processor.start();

const deadline = Date.now() + 5000;  // 5 second timeout
while (!processor.isRunning() && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10));  // Short poll interval
}

expect(processor.isRunning()).toBe(true);
```

**Solution B: Promise-based signaling**

```typescript
// GOOD - wait for actual event, not arbitrary time
let handlerResolve: () => void;
const handlerPromise = new Promise<void>((resolve) => {
  handlerResolve = resolve;
});

processor.registerHandler("job-type", (_job, _token) => {
  handlerCalled = true;
  handlerResolve();  // Signal completion
  return { done: true };
});

processor.start();
await handlerPromise;  // Wait for actual handler call

expect(handlerCalled).toBe(true);
```

**Solution C: Explicit flush/sync methods**

```typescript
// GOOD - use service's flush method instead of delay
await runInRequestContext(ctx, async () => {
  console.log("log message");
});

await logService.flush();  // Wait for actual flush, not arbitrary delay
const logs = await logService.getByRequestId(requestId);
```

#### ❌ Pattern 2: Process-Global State Mutations

**Problem:** Modifying process-global state that affects other parallel tests.

```typescript
// BAD - Deno.chdir affects ALL parallel tests
Deno.chdir(tempDir);
// ... test code ...
Deno.chdir(originalDir);  // Too late - other tests already broken

// BAD - Deno.env.set without coordination
Deno.env.set("MY_VAR", "test-value");
// Other tests may see this value unexpectedly

// BAD - modifying global console without synchronization
console.log = myCustomLogger;
// Other tests' console output goes to your custom logger
```

**Solution: Use absolute paths instead of chdir**

```typescript
// GOOD - use absolute paths, never change working directory
const tempDir = await Deno.makeTempDir();
const filePath = `${tempDir}/file.txt`;
await Deno.writeTextFile(filePath, content);

// GOOD - resolve paths absolutely
const result = await resolveAndValidatePath(tempDir, "file.ts");
expect(result).toBe(`${tempDir}/file.ts`);
```

**Solution: Use mutex for tests that must modify global state**

```typescript
import { Mutex } from "@core/asyncutil/mutex";

// Tests that modify process-global state MUST serialize
const globalStateMutex = new Mutex();

async function setupIsolator() {
  using _lock = await globalStateMutex.acquire();
  isolator = new ProcessIsolator();
  isolator.install();  // Modifies Deno.exit, process.exit, etc.
}

async function teardownIsolator() {
  using _lock = await globalStateMutex.acquire();
  isolator?.uninstall();
}
```

#### ❌ Pattern 3: Module-Level Singleton State

**Problem:** Tests modifying module-level singletons (like a logger) conflict with each other.

```typescript
// BAD - multiple tests initializing the same logger concurrently
integrationTest("test 1", async () => {
  initializeLogger(settingsService);  // Modifies module-level state
  // ...
});

integrationTest("test 2", async () => {
  initializeLogger(otherSettingsService);  // Race condition!
  // ...
});
```

**Solution: Sequential test wrapper with mutex**

```typescript
const loggerTestMutex = new Mutex();

function sequentialLoggerTest(
  name: string,
  fn: () => Promise<void> | void
): void {
  integrationTest(name, async () => {
    using _lock = await loggerTestMutex.acquire();
    await fn();
  });
}

// All logger tests use the wrapper
sequentialLoggerTest("logger outputs at debug level", async () => {
  // Guaranteed to run sequentially with other logger tests
  initializeLogger(settingsService);
  // ...
});
```

### When Fixed Delays ARE Acceptable

Some tests legitimately need timing delays:

1. **Testing time-based behavior** (e.g., idle timeout, retention periods)
   ```typescript
   // OK - testing actual time-based retention
   const service = new LogTrimmingService({ retentionMs: 1000 });
   await new Promise((r) => setTimeout(r, 2000));  // Wait for retention period
   // Verify old logs were trimmed
   ```

2. **Simulating work inside handlers** (not for synchronization)
   ```typescript
   // OK - delay is the test's subject, not synchronization
   processor.registerHandler("job", async () => {
     await new Promise((r) => setTimeout(r, 50));  // Simulate work
     return { done: true };
   });
   ```

3. **Small delays to ensure async operation has started** (with comment explaining why)
   ```typescript
   // OK when necessary - but prefer Promise-based signaling
   const rotation1Promise = service.triggerManualRotation();
   // Give first rotation time to acquire lock before starting second
   await new Promise((r) => setTimeout(r, 10));
   await expect(service.triggerManualRotation()).rejects.toThrow();
   ```

### Summary: Parallel-Safe Test Checklist

Before writing a test, ask:

1. ✅ Does it use `TestSetupBuilder`? → Automatic namespace isolation
2. ✅ Does it await actual completion (Promises, flush methods)?
3. ✅ Does it avoid `Deno.chdir()`, `Deno.env.set()`, global mutations?
4. ✅ Does it use absolute paths instead of relative paths?
5. ✅ If it MUST modify global state, does it use a mutex?
6. ✅ Does it have proper cleanup in `finally` blocks?

## Test Structure Patterns

### File Naming

All test files follow pattern: `*_test.ts`

Example: `routes_service_test.ts`, `encryption_service_test.ts`

### Standard Test Organization

Organize tests in logical groups:

```typescript
// Group 1: Pure function validation (no DB needed)
Deno.test("validateRouteName accepts valid names", () => {
  expect(validateRouteName("hello")).toBe(true);
  expect(validateRouteName("hello-world")).toBe(true);
  expect(validateRouteName("hello_world")).toBe(true);
});

Deno.test("validateRouteName rejects invalid names", () => {
  expect(validateRouteName("")).toBe(false);
  expect(validateRouteName("Hello")).toBe(false);  // Uppercase
  expect(validateRouteName("hello world")).toBe(false);  // Space
});

// Group 2: Basic CRUD operations (uses integrationTest for TestSetupBuilder)
integrationTest("RoutesService.addRoute creates new route", async () => {
  const ctx = await TestSetupBuilder.create().withRoutes().build();
  try {
    await ctx.routesService.addRoute("test", "test.ts", { methods: ["GET"] });
    const routes = await ctx.routesService.getAll();
    expect(routes.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

// Group 3: Edge cases and errors
integrationTest("RoutesService.addRoute rejects duplicate names", async () => {
  const ctx = await TestSetupBuilder.create().withRoutes().build();
  try {
    await ctx.routesService.addRoute("test", "test.ts", { methods: ["GET"] });
    await expect(
      ctx.routesService.addRoute("test", "other.ts", { methods: ["POST"] })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

// Group 4: Concurrency and state management
integrationTest("concurrent rebuildIfNeeded calls share single rebuild", async () => {
  const ctx = await TestSetupBuilder.create().withRoutes().build();
  try {
    // Test concurrent access patterns
    const results = await Promise.all([
      ctx.routesService.rebuildIfNeeded(),
      ctx.routesService.rebuildIfNeeded(),
    ]);
    // Assertions about shared state
  } finally {
    await ctx.cleanup();
  }
});

// Group 5: Integration scenarios
integrationTest("full workflow: create route, execute, log metrics", async () => {
  const ctx = await TestSetupBuilder.create().withAll().build();
  try {
    // Multi-service integration test
  } finally {
    await ctx.cleanup();
  }
});
```

**Example:** See `src/routes/routes_service_test.ts` (722 lines covering all groups)

### Assertion Patterns

Use `@std/expect` from Deno standard library:

```typescript
import { expect } from "@std/expect";

// Basic assertions
expect(value).toBe(expectedValue);
expect(array).toEqual([1, 2, 3]);
expect(result).toBeUndefined();
expect(length).toBeGreaterThan(0);

// Promise rejections
await expect(promise).rejects.toThrow("error message");

// Object matching
expect(route).toEqual({
  name: "hello",
  fileName: "hello.ts",
  methods: ["GET"],
});
```

## Mocking Guidelines

Prefer **real implementations** over mocks. Only mock when necessary.

### Approach A: Simple Helper Functions (Preferred for Unit Tests)

For single-service or low-level tests, create lightweight test context helpers:

```typescript
interface TestContext {
  service: MyService;
  cleanup: () => void;
}

function createTestContext(): TestContext {
  const tempDir = Deno.makeTempDirSync();
  const service = new MyService({ path: tempDir });

  return {
    service,
    cleanup: () => {
      Deno.removeSync(tempDir, { recursive: true });
    },
  };
}

// Optional: Wrapper helper to reduce boilerplate
async function withTestContext(
  testFn: (ctx: TestContext) => void | Promise<void>
): Promise<void> {
  const ctx = createTestContext();
  try {
    await testFn(ctx);
  } finally {
    ctx.cleanup();
  }
}

// Usage
Deno.test("MyService processes data correctly", async () => {
  await withTestContext(async ({ service }) => {
    const result = await service.process("data");
    expect(result).toBe("processed");
  });
});
```

**When to use:** Low-level utilities, encryption tests, file I/O tests

**Examples:**
- `src/env/env_isolator_test.ts` - Environment isolation tests
- `src/encryption/key_storage_service_test.ts` - File-based key storage tests

### Approach B: Real Services via TestSetupBuilder (Preferred for Integration)

For multi-service tests, use TestSetupBuilder to get real implementations:

```typescript
integrationTest("Routes and files work together", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()  // Also enables FileService
    .build();

  try {
    // Use real services - no mocking needed
    await ctx.fileService.createFile("hello.ts", "export default ...");
    await ctx.routesService.addRoute("hello", "hello.ts", { methods: ["GET"] });

    const routes = await ctx.routesService.getAll();
    expect(routes.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});
```

**When to use:** Integration tests, multi-service scenarios

**Examples:**
- `src/routes/routes_service_test.ts` - Routes with file service
- `src/logs/console_log_service_test.ts` - Logs with settings and routes

### Approach C: Manual Mocks (Only When Necessary)

For external boundaries (auth, external APIs), create focused manual mocks:

```typescript
function createMockAuth(options: { authenticated: boolean }): Auth {
  return {
    api: {
      getSession: () => {
        if (options.authenticated) {
          return {
            user: { id: "test-user", email: "test@example.com" },
            session: { id: "test-session", token: "test-token" },
          };
        }
        return null;
      },
    },
  } as unknown as Auth;
}

// Usage
Deno.test("Middleware rejects unauthenticated requests", async () => {
  const auth = createMockAuth({ authenticated: false });
  const app = new Hono();
  app.use(requireAuth(auth));

  const res = await app.request("/protected");
  expect(res.status).toBe(401);
});
```

**When to use:** Authentication, external APIs, third-party services

**Example:** `src/auth/auth_middleware_test.ts` - Auth middleware tests

### General Mocking Principle

**Preference order:**
1. **Real services** (via TestSetupBuilder) - Best for integration
2. **Simple helpers** (lightweight context) - Best for unit tests
3. **Manual mocks** (only at boundaries) - Last resort

## Best Practices

### Always Use Try-Finally Cleanup

```typescript
integrationTest("Example test", async () => {
  const ctx = await TestSetupBuilder.create().withAll().build();
  try {
    // Test logic here
    expect(result).toBe(value);
  } finally {
    await ctx.cleanup();  // ALWAYS cleanup, even on failure
  }
});
```

**Why:** Ensures database connections, temp directories, and file handles are released.

### Request Only Needed Services

```typescript
// Bad - requests everything when only needing metrics
const ctx = await TestSetupBuilder.create().withAll().build();

// Good - minimal context
const ctx = await TestSetupBuilder.create().withMetrics().build();
```

**Why:** Faster tests, clearer dependencies, less setup overhead.

### Use Deferred Data for FK Constraints

```typescript
// Good - route created during build with file dependency satisfied
const ctx = await TestSetupBuilder.create()
  .withRoute("/hello", "hello.ts", { methods: ["GET"] })
  .build();

// Bad - manual creation risks FK violations
const ctx = await TestSetupBuilder.create().withRoutes().build();
await ctx.routesService.addRoute("hello", "hello.ts", { methods: ["GET"] });
// Risk: File might not exist, FK constraint fails
```

### Test Pure Functions Separately

```typescript
// No setup needed - test pure validation logic directly
Deno.test("validateEmail accepts valid emails", () => {
  expect(validateEmail("user@example.com")).toBe(true);
  expect(validateEmail("invalid")).toBe(false);
});
```

**Why:** Faster, simpler, no cleanup overhead.

### Async/Await Properly

```typescript
// Good - proper async/await
await expect(
  routesService.addRoute("duplicate", "test.ts", { methods: ["GET"] })
).rejects.toThrow("already exists");

// Bad - missing await on async assertion
expect(
  routesService.addRoute("duplicate", "test.ts", { methods: ["GET"] })
).rejects.toThrow("already exists");  // Won't work!
```

### Comprehensive Concurrency Coverage

For services with concurrent access patterns, test thoroughly:

```typescript
integrationTest("concurrent writes are serialized", async () => {
  const ctx = await TestSetupBuilder.create().withRoutes().build();
  try {
    const writes = Array.from({ length: 10 }, (_, i) =>
      ctx.routesService.addRoute(`route${i}`, `file${i}.ts`, { methods: ["GET"] })
    );

    await Promise.all(writes);

    const routes = await ctx.routesService.getAll();
    expect(routes.length).toBe(10);  // All writes succeeded
  } finally {
    await ctx.cleanup();
  }
});
```

## Anti-Patterns to Avoid

### ❌ No Test-Only Methods in Production Code

```typescript
// Bad - polluting production class with test-only method
class RoutesService {
  async getAllForTesting() {  // ❌
    return this.getAll();
  }
}

// Good - use public API
const routes = await routesService.getAll();
```

### ❌ No Excessive Mocking of Internal Services

```typescript
// Bad - mocking internal service instead of using real one
const mockFileService = {
  getFile: () => Promise.resolve("content"),
};

// Good - use TestSetupBuilder for real services
const ctx = await TestSetupBuilder.create()
  .withRoutes()  // Includes real FileService
  .build();
```

### ❌ No Skipped Cleanup

```typescript
// Bad - missing cleanup on early return
integrationTest("Bad test", async () => {
  const ctx = await TestSetupBuilder.create().withAll().build();
  if (someCondition) {
    return;  // ❌ Leaked resources!
  }
  await ctx.cleanup();
});

// Good - try-finally ensures cleanup
integrationTest("Good test", async () => {
  const ctx = await TestSetupBuilder.create().withAll().build();
  try {
    if (someCondition) {
      return;  // ✅ Cleanup still happens
    }
  } finally {
    await ctx.cleanup();
  }
});
```

### ❌ No Hardcoded Schemas in Tests

```typescript
// Bad - duplicating schema in test
await db.exec(`
  CREATE TABLE routes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`);

// Good - use migrations via TestSetupBuilder
const ctx = await TestSetupBuilder.create()
  .withRoutes()  // Uses real migrations
  .build();
```

**Exception:** Tests for migration logic itself may use inline schemas for comparison.

### ❌ No Timing-Dependent Synchronization

See [Parallel Test Execution](#parallel-test-execution) for comprehensive coverage.

```typescript
// Bad - arbitrary timeout for synchronization
processor.start();
await new Promise(resolve => setTimeout(resolve, 100));
expect(processor.isRunning()).toBe(true);  // ❌ Flaky!

// Good - poll for state change
processor.start();
const deadline = Date.now() + 5000;
while (!processor.isRunning() && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10));
}
expect(processor.isRunning()).toBe(true);  // ✅ Deterministic

// Good - Promise-based signaling
let resolveHandler: () => void;
const handlerPromise = new Promise<void>((r) => { resolveHandler = r; });
processor.registerHandler("type", () => { resolveHandler(); return {}; });
processor.start();
await handlerPromise;  // ✅ Wait for actual event
```

### ❌ No Process-Global State Mutations Without Coordination

```typescript
// Bad - affects all parallel tests
Deno.chdir(tempDir);  // ❌ Process-global!

// Good - use absolute paths
const filePath = `${tempDir}/file.ts`;  // ✅ No global state change

// Bad - modifying console without mutex
console.log = myLogger;  // ❌ Affects other tests!

// Good - use mutex when global state modification is unavoidable
const mutex = new Mutex();
using _lock = await mutex.acquire();
console.log = myLogger;
// ... test code ...
console.log = originalLog;
```

## Related Files

- **TestSetupBuilder:** `src/test/test_setup_builder.ts`
- **Type definitions:** `src/test/types.ts`
- **Service factories:** `src/test/service_factories.ts`
- **Dependency graph:** `src/test/dependency_graph.ts`
- **SharedSurrealManager:** `src/test/shared_surreal_manager.ts`
- **Test helpers:** `src/test/test_helpers.ts`
- **Test runner script:** `scripts/run-tests.ts` (starts SurrealDB, runs parallel tests)

## Example Test Files

- **Integration test:** `src/routes/routes_service_test.ts` (comprehensive, covers all test groups)
- **Unit test (helper pattern):** `src/env/env_isolator_test.ts`
- **Unit test (encryption):** `src/encryption/encryption_service_test.ts`
- **Manual mocking:** `src/auth/auth_middleware_test.ts`
- **Deferred data pattern:** `src/logs/console_log_service_test.ts`
- **SurrealDB migration test:** `src/database/surreal_migration_service_test.ts`
- **Parallel-safe patterns:**
  - **Polling pattern:** `src/jobs/job_processor_service_test.ts`
  - **Promise signaling:** `src/events/event_bus_test.ts`
  - **Explicit flush:** `src/logs/stream_interceptor_test.ts`
  - **Mutex for global state:** `src/process/process_isolator_test.ts`, `src/utils/logger_test.ts`
