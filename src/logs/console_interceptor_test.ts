import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import { ConsoleLogService } from "./console_log_service.ts";
import { ConsoleInterceptor, originalConsole } from "./console_interceptor.ts";
import { runInRequestContext } from "./request_context.ts";

const CONSOLE_LOGS_SCHEMA = `
  CREATE TABLE console_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    route_id INTEGER,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    args TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_console_logs_request_id ON console_logs(request_id);
`;

async function createTestSetup(): Promise<{
  logService: ConsoleLogService;
  interceptor: ConsoleInterceptor;
  db: DatabaseService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(CONSOLE_LOGS_SCHEMA);

  const logService = new ConsoleLogService({ db });
  const interceptor = new ConsoleInterceptor({ logService });

  return { logService, interceptor, db, tempDir };
}

async function cleanup(
  interceptor: ConsoleInterceptor,
  db: DatabaseService,
  tempDir: string
): Promise<void> {
  interceptor.uninstall();
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// =====================
// ConsoleInterceptor tests
// =====================

Deno.test("ConsoleInterceptor captures logs within request context", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log("Hello from handler");
        // Give time for async storage
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    // Give time for async log storage
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Hello from handler");
    expect(logs[0].level).toBe("log");
    expect(logs[0].routeId).toBe(1);
  } finally {
    await cleanup(interceptor, db, tempDir);
  }
});

Deno.test("ConsoleInterceptor captures all console methods", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log("log message");
        console.debug("debug message");
        console.info("info message");
        console.warn("warn message");
        console.error("error message");
        // Note: trace is handled but may include stack trace
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    // Give time for async log storage
    await new Promise((resolve) => setTimeout(resolve, 150));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(5);

    const levels = logs.map((l) => l.level);
    expect(levels).toContain("log");
    expect(levels).toContain("debug");
    expect(levels).toContain("info");
    expect(levels).toContain("warn");
    expect(levels).toContain("error");
  } finally {
    await cleanup(interceptor, db, tempDir);
  }
});

Deno.test("ConsoleInterceptor captures logs with multiple arguments", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log("Message", { key: "value" }, 42);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    // Give time for async log storage
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Message");
    expect(logs[0].args).toBe('[{"key":"value"},42]');
  } finally {
    await cleanup(interceptor, db, tempDir);
  }
});

Deno.test("ConsoleInterceptor does not store logs outside request context", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    // Log outside request context - should NOT be stored
    console.log("System log outside context");

    // Give time for any async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify no logs were stored (since we're outside request context)
    const allLogs = await logService.getRecent(100);
    const systemLogs = allLogs.filter(
      (l) => l.message === "System log outside context"
    );
    expect(systemLogs.length).toBe(0);
  } finally {
    await cleanup(interceptor, db, tempDir);
  }
});

Deno.test("ConsoleInterceptor can be uninstalled", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    // Log while installed
    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log("Before uninstall");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    // Give time for async log storage
    await new Promise((resolve) => setTimeout(resolve, 100));

    interceptor.uninstall();

    // Log after uninstalled - should not be captured
    await runInRequestContext(
      { requestId: "test-request-2", routeId: 1 },
      async () => {
        console.log("After uninstall");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    // Give time
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs1 = await logService.getByRequestId("test-request-1");
    expect(logs1.length).toBe(1);

    const logs2 = await logService.getByRequestId("test-request-2");
    expect(logs2.length).toBe(0);
  } finally {
    await cleanup(interceptor, db, tempDir);
  }
});

Deno.test("ConsoleInterceptor handles non-string messages", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log({ object: true });
        console.log(42);
        console.log(null);
        console.log(undefined);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    // Give time for async log storage
    await new Promise((resolve) => setTimeout(resolve, 150));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(4);
    expect(logs[0].message).toBe('{"object":true}');
    expect(logs[1].message).toBe("42");
    expect(logs[2].message).toBe("null");
    expect(logs[3].message).toBe("undefined");
  } finally {
    await cleanup(interceptor, db, tempDir);
  }
});

Deno.test("ConsoleInterceptor preserves originalConsole functions", () => {
  // originalConsole should have all the expected methods
  expect(typeof originalConsole.log).toBe("function");
  expect(typeof originalConsole.debug).toBe("function");
  expect(typeof originalConsole.info).toBe("function");
  expect(typeof originalConsole.warn).toBe("function");
  expect(typeof originalConsole.error).toBe("function");
  expect(typeof originalConsole.trace).toBe("function");
});

Deno.test("ConsoleInterceptor install is idempotent", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    // Install multiple times
    interceptor.install();
    interceptor.install();
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log("Test message");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    // Give time for async log storage
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should still only capture once
    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
  } finally {
    await cleanup(interceptor, db, tempDir);
  }
});
