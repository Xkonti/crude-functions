import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SurrealPoolNotInitializedError } from "./surreal_errors.ts";
import { SurrealConnectionFactory } from "./surreal_connection_factory.ts";
import { SharedSurrealManager } from "../test/shared_surreal_manager.ts";

// =============================================================================
// Connection Caching Tests
// =============================================================================

integrationTest("pool caches connections - multiple calls reuse same connection", async () => {
  const ctx = await TestSetupBuilder.create()
    .withBaseOnly()
    .build();

  try {
    // Track how many times we call the underlying connect
    let connectCallCount = 0;
    const originalConnect = ctx.surrealFactory.connect.bind(ctx.surrealFactory);
    ctx.surrealFactory.connect = (options) => {
      connectCallCount++;
      return originalConnect(options);
    };

    // First call should establish a connection
    await ctx.surrealFactory.withSystemConnection(
      { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    expect(connectCallCount).toBe(1);

    // Second call should reuse the cached connection
    await ctx.surrealFactory.withSystemConnection(
      { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    expect(connectCallCount).toBe(1); // Still 1, not 2
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("pool creates separate connections for different namespace/database", async () => {
  const manager = SharedSurrealManager.getInstance();
  await manager.ensureStarted();

  // Create two separate test contexts with different namespaces
  const testCtx1 = await manager.createTestContext();
  const testCtx2 = await manager.createTestContext();

  // Create a factory with pool
  const factory = new SurrealConnectionFactory({
    connectionUrl: manager.connectionUrl,
    username: "root",
    password: "root",
  });
  factory.initializePool({ idleTimeoutMs: 30000 });

  try {
    // Track connect calls
    let connectCallCount = 0;
    const originalConnect = factory.connect.bind(factory);
    factory.connect = (options) => {
      connectCallCount++;
      return originalConnect(options);
    };

    // Connect to first namespace
    await factory.withSystemConnection(
      { namespace: testCtx1.namespace, database: testCtx1.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    expect(connectCallCount).toBe(1);

    // Connect to second namespace (different ns+db, should create new connection)
    await factory.withSystemConnection(
      { namespace: testCtx2.namespace, database: testCtx2.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    expect(connectCallCount).toBe(2);

    // Connect to first namespace again (should reuse cached)
    await factory.withSystemConnection(
      { namespace: testCtx1.namespace, database: testCtx1.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    expect(connectCallCount).toBe(2); // Still 2, reused first connection

    // Check pool stats
    const stats = factory.getPoolStats();
    expect(stats?.activeConnections).toBe(2);
  } finally {
    await factory.closePool();
    await manager.deleteTestContext(testCtx1.namespace, testCtx1.db);
    await manager.deleteTestContext(testCtx2.namespace, testCtx2.db);
  }
});

// =============================================================================
// Concurrent Access Tests
// =============================================================================

integrationTest("pool handles concurrent access - multiple callers share one connection", async () => {
  const ctx = await TestSetupBuilder.create()
    .withBaseOnly()
    .build();

  try {
    // Track connection count
    let connectCallCount = 0;
    const originalConnect = ctx.surrealFactory.connect.bind(ctx.surrealFactory);
    ctx.surrealFactory.connect = (options) => {
      connectCallCount++;
      return originalConnect(options);
    };

    // Fire 10 concurrent requests
    const promises = Array.from({ length: 10 }, () =>
      ctx.surrealFactory.withSystemConnection(
        { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
        async (db) => {
          await db.query("RETURN 1");
          return true;
        }
      )
    );

    const results = await Promise.all(promises);

    expect(results.length).toBe(10);
    expect(results.every((r) => r === true)).toBe(true);
    expect(connectCallCount).toBe(1); // All 10 requests shared one connection

    // Check pool stats - should have 1 connection
    const stats = ctx.surrealFactory.getPoolStats();
    expect(stats?.activeConnections).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("pool handles concurrent connection establishment race", async () => {
  const manager = SharedSurrealManager.getInstance();
  await manager.ensureStarted();
  const testCtx = await manager.createTestContext();

  // Create a fresh factory (no pre-existing connections)
  const factory = new SurrealConnectionFactory({
    connectionUrl: manager.connectionUrl,
    username: "root",
    password: "root",
  });
  factory.initializePool({ idleTimeoutMs: 30000 });

  try {
    let connectCallCount = 0;
    const originalConnect = factory.connect.bind(factory);
    factory.connect = async (options) => {
      connectCallCount++;
      // Add small delay to increase chance of race
      await new Promise((r) => setTimeout(r, 10));
      return originalConnect(options);
    };

    // Fire multiple requests simultaneously before any connection exists
    const promises = Array.from({ length: 5 }, () =>
      factory.withSystemConnection(
        { namespace: testCtx.namespace, database: testCtx.database },
        async (db) => {
          await db.query("RETURN 1");
          return true;
        }
      )
    );

    const results = await Promise.all(promises);

    expect(results.length).toBe(5);
    expect(results.every((r) => r === true)).toBe(true);
    // Due to mutex protection, only one connection should be established
    expect(connectCallCount).toBe(1);
  } finally {
    await factory.closePool();
    await manager.deleteTestContext(testCtx.namespace, testCtx.db);
  }
});

// =============================================================================
// Reference Counting Tests
// =============================================================================

integrationTest("pool tracks reference count correctly", async () => {
  const ctx = await TestSetupBuilder.create()
    .withBaseOnly()
    .build();

  try {
    // Start a long-running operation
    const longRunning = ctx.surrealFactory.withSystemConnection(
      { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
      async (db) => {
        // Check refCount is 1
        const stats1 = ctx.surrealFactory.getPoolStats();
        expect(stats1?.totalRefCount).toBe(1);

        // Start another operation
        const nested = ctx.surrealFactory.withSystemConnection(
          { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
          // deno-lint-ignore require-await
          async () => {
            // Check refCount is 2
            const stats2 = ctx.surrealFactory.getPoolStats();
            expect(stats2?.totalRefCount).toBe(2);
            return "nested done";
          }
        );

        const nestedResult = await nested;
        expect(nestedResult).toBe("nested done");

        // Check refCount is back to 1
        const stats3 = ctx.surrealFactory.getPoolStats();
        expect(stats3?.totalRefCount).toBe(1);

        await db.query("RETURN 1");
        return "long done";
      }
    );

    await longRunning;

    // Check refCount is 0 after completion
    const stats4 = ctx.surrealFactory.getPoolStats();
    expect(stats4?.totalRefCount).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Idle Timeout Tests
// =============================================================================

integrationTest("pool closes connection after idle timeout", async () => {
  const manager = SharedSurrealManager.getInstance();
  await manager.ensureStarted();
  const testCtx = await manager.createTestContext();

  // Create factory with very short idle timeout for testing
  const factory = new SurrealConnectionFactory({
    connectionUrl: manager.connectionUrl,
    username: "root",
    password: "root",
  });
  factory.initializePool({ idleTimeoutMs: 100 }); // 100ms for test

  try {
    // Use connection
    await factory.withSystemConnection(
      { namespace: testCtx.namespace, database: testCtx.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    // Connection should be in pool
    let stats = factory.getPoolStats();
    expect(stats?.activeConnections).toBe(1);

    // Wait for idle timeout
    await new Promise((r) => setTimeout(r, 200));

    // Connection should be closed
    stats = factory.getPoolStats();
    expect(stats?.activeConnections).toBe(0);
  } finally {
    await factory.closePool();
    await manager.deleteTestContext(testCtx.namespace, testCtx.db);
  }
});

integrationTest("pool cancels idle timeout when connection is reused", async () => {
  const manager = SharedSurrealManager.getInstance();
  await manager.ensureStarted();
  const testCtx = await manager.createTestContext();

  const factory = new SurrealConnectionFactory({
    connectionUrl: manager.connectionUrl,
    username: "root",
    password: "root",
  });
  factory.initializePool({ idleTimeoutMs: 150 }); // 150ms

  try {
    // Use connection
    await factory.withSystemConnection(
      { namespace: testCtx.namespace, database: testCtx.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    // Wait 100ms (less than timeout)
    await new Promise((r) => setTimeout(r, 100));

    // Use connection again (should reset idle timer)
    await factory.withSystemConnection(
      { namespace: testCtx.namespace, database: testCtx.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    // Wait another 100ms
    await new Promise((r) => setTimeout(r, 100));

    // Connection should still be active (timer was reset)
    const stats = factory.getPoolStats();
    expect(stats?.activeConnections).toBe(1);

    // Wait full timeout
    await new Promise((r) => setTimeout(r, 200));

    // Now it should be closed
    const stats2 = factory.getPoolStats();
    expect(stats2?.activeConnections).toBe(0);
  } finally {
    await factory.closePool();
    await manager.deleteTestContext(testCtx.namespace, testCtx.db);
  }
});

// =============================================================================
// Graceful Shutdown Tests
// =============================================================================

integrationTest("pool closeAll closes all connections", async () => {
  const manager = SharedSurrealManager.getInstance();
  await manager.ensureStarted();
  const testCtx1 = await manager.createTestContext();
  const testCtx2 = await manager.createTestContext();

  const factory = new SurrealConnectionFactory({
    connectionUrl: manager.connectionUrl,
    username: "root",
    password: "root",
  });
  factory.initializePool({ idleTimeoutMs: 30000 });

  try {
    // Create connections to two namespaces
    await factory.withSystemConnection(
      { namespace: testCtx1.namespace, database: testCtx1.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );
    await factory.withSystemConnection(
      { namespace: testCtx2.namespace, database: testCtx2.database },
      async (db) => {
        await db.query("RETURN 1");
      }
    );

    // Verify both connections exist
    let stats = factory.getPoolStats();
    expect(stats?.activeConnections).toBe(2);

    // Close all
    await factory.closePool();

    // Pool should be empty/null
    stats = factory.getPoolStats();
    expect(stats).toBeNull();
  } finally {
    // Cleanup test contexts (pool already closed)
    await manager.deleteTestContext(testCtx1.namespace, testCtx1.db);
    await manager.deleteTestContext(testCtx2.namespace, testCtx2.db);
  }
});

// =============================================================================
// Error Handling Tests
// =============================================================================

integrationTest("withSystemConnection throws when pool not initialized", () => {
  const factory = new SurrealConnectionFactory({
    connectionUrl: "ws://localhost:8000",
    username: "root",
    password: "root",
  });

  // Don't initialize pool

  expect(() => {
    // deno-lint-ignore require-await
    factory.withSystemConnection({}, async () => {
      return "should not reach";
    });
  }).toThrow(SurrealPoolNotInitializedError);
});

integrationTest("pool handles callback errors without leaking connection", async () => {
  const ctx = await TestSetupBuilder.create()
    .withBaseOnly()
    .build();

  try {
    // First call throws an error
    await expect(
      ctx.surrealFactory.withSystemConnection(
        { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
        // deno-lint-ignore require-await
        async () => {
          throw new Error("Intentional test error");
        }
      )
    ).rejects.toThrow("Intentional test error");

    // Connection should still be in pool (callback error, not connection error)
    const stats = ctx.surrealFactory.getPoolStats();
    expect(stats?.activeConnections).toBe(1);
    expect(stats?.totalRefCount).toBe(0); // Released after error

    // Should still be usable
    const result = await ctx.surrealFactory.withSystemConnection(
      { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
      async (db) => {
        const [r] = await db.query<[number]>("RETURN 42");
        return r;
      }
    );
    expect(result).toBe(42);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Pool Stats Tests
// =============================================================================

integrationTest("getPoolStats returns correct information", async () => {
  const ctx = await TestSetupBuilder.create()
    .withBaseOnly()
    .build();

  try {
    // Initially empty
    let stats = ctx.surrealFactory.getPoolStats();
    expect(stats?.activeConnections).toBe(0);
    expect(stats?.totalRefCount).toBe(0);

    // During use
    await ctx.surrealFactory.withSystemConnection(
      { namespace: ctx.surrealNamespace, database: ctx.surrealDatabase },
      // deno-lint-ignore require-await
      async () => {
        stats = ctx.surrealFactory.getPoolStats();
        expect(stats?.activeConnections).toBe(1);
        expect(stats?.totalRefCount).toBe(1);

        const key = `${ctx.surrealNamespace}:${ctx.surrealDatabase}`;
        const connInfo = stats?.connectionsByKey.get(key as `${string}:${string}`);
        expect(connInfo?.state).toBe("connected");
        expect(connInfo?.refCount).toBe(1);
      }
    );

    // After use
    stats = ctx.surrealFactory.getPoolStats();
    expect(stats?.activeConnections).toBe(1); // Still cached
    expect(stats?.totalRefCount).toBe(0); // But not in use
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Factory Integration Tests
// =============================================================================

integrationTest("isPoolInitialized returns correct state", async () => {
  const factory = new SurrealConnectionFactory({
    connectionUrl: "ws://localhost:8000",
    username: "root",
    password: "root",
  });

  expect(factory.isPoolInitialized).toBe(false);

  factory.initializePool();

  expect(factory.isPoolInitialized).toBe(true);

  await factory.closePool();

  expect(factory.isPoolInitialized).toBe(false);
});

integrationTest("initializePool is idempotent", async () => {
  const factory = new SurrealConnectionFactory({
    connectionUrl: "ws://localhost:8000",
    username: "root",
    password: "root",
  });

  factory.initializePool({ idleTimeoutMs: 1000 });
  factory.initializePool({ idleTimeoutMs: 5000 }); // Should be ignored

  expect(factory.isPoolInitialized).toBe(true);

  await factory.closePool();
});
