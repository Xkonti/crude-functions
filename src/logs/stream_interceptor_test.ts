import { expect } from "@std/expect";
import process from "node:process";
import { DatabaseService } from "../database/database_service.ts";
import { ConsoleLogService } from "./console_log_service.ts";
import {
  StreamInterceptor,
  originalConsole,
  originalStreams,
} from "./stream_interceptor.ts";
import { runInRequestContext } from "./request_context.ts";
import { SettingsService } from "../settings/settings_service.ts";
import { EncryptionService } from "../encryption/encryption_service.ts";

const TEST_ENCRYPTION_KEY = "YzJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";

const TEST_SCHEMA = `
  CREATE TABLE executionLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requestId TEXT NOT NULL,
    routeId INTEGER,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    args TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_executionLogs_requestId ON executionLogs(requestId);

  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    userId TEXT,
    value TEXT,
    isEncrypted INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_settings_name_user ON settings(name, COALESCE(userId, ''));
`;

async function createTestSetup(): Promise<{
  logService: ConsoleLogService;
  interceptor: StreamInterceptor;
  db: DatabaseService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(TEST_SCHEMA);

  const encryptionService = new EncryptionService({
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  const settingsService = new SettingsService({ db, encryptionService });
  await settingsService.bootstrapGlobalSettings();

  const logService = new ConsoleLogService({ db, settingsService });
  const interceptor = new StreamInterceptor({ logService });

  return { logService, interceptor, db, tempDir };
}

async function cleanup(
  logService: ConsoleLogService,
  interceptor: StreamInterceptor,
  db: DatabaseService,
  tempDir: string
): Promise<void> {
  interceptor.uninstall();
  await logService.shutdown();
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// =====================
// StreamInterceptor tests
// =====================

Deno.test("StreamInterceptor captures console.log within request context", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log("Hello from handler");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Hello from handler");
    expect(logs[0].level).toBe("log");
    expect(logs[0].routeId).toBe(1);
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor captures all console methods with correct levels", async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

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
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor captures process.stdout.write with stdout level", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        process.stdout.write("Direct stdout message\n");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Direct stdout message");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor captures process.stderr.write with stderr level", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        process.stderr.write("Direct stderr message\n");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Direct stderr message");
    expect(logs[0].level).toBe("stderr");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor does not capture logs outside request context", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    // Log outside request context - should NOT be stored
    console.log("System log outside context");
    process.stdout.write("System stdout outside context\n");

    await new Promise((resolve) => setTimeout(resolve, 100));

    const allLogs = await logService.getRecent(100);
    expect(allLogs.length).toBe(0);
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor can be uninstalled", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        console.log("Before uninstall");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    interceptor.uninstall();

    await runInRequestContext(
      { requestId: "test-request-2", routeId: 1 },
      async () => {
        console.log("After uninstall");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs1 = await logService.getByRequestId("test-request-1");
    expect(logs1.length).toBe(1);

    const logs2 = await logService.getByRequestId("test-request-2");
    expect(logs2.length).toBe(0);
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor preserves originalConsole functions", () => {
  expect(typeof originalConsole.log).toBe("function");
  expect(typeof originalConsole.debug).toBe("function");
  expect(typeof originalConsole.info).toBe("function");
  expect(typeof originalConsole.warn).toBe("function");
  expect(typeof originalConsole.error).toBe("function");
  expect(typeof originalConsole.trace).toBe("function");
});

Deno.test("StreamInterceptor preserves originalStreams functions", () => {
  expect(typeof originalStreams.stdout).toBe("function");
  expect(typeof originalStreams.stderr).toBe("function");
});

Deno.test("StreamInterceptor install is idempotent", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
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

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor installed getter returns correct state", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    expect(interceptor.installed).toBe(false);
    interceptor.install();
    expect(interceptor.installed).toBe(true);
    interceptor.uninstall();
    expect(interceptor.installed).toBe(false);
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor handles Uint8Array input", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        const encoder = new TextEncoder();
        process.stdout.write(encoder.encode("Binary message\n"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Binary message");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor handles empty messages", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        // Empty newline should not be stored
        process.stdout.write("\n");
        // But message with content should
        process.stdout.write("Real message\n");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Real message");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

// =====================
// Deno native stream tests
// =====================

Deno.test("StreamInterceptor captures Deno.stdout.writeSync", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        const encoder = new TextEncoder();
        Deno.stdout.writeSync(encoder.encode("Deno stdout sync\n"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stdout sync");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor captures Deno.stdout.write (async)", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        const encoder = new TextEncoder();
        await Deno.stdout.write(encoder.encode("Deno stdout async\n"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stdout async");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor captures Deno.stderr.writeSync", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        const encoder = new TextEncoder();
        Deno.stderr.writeSync(encoder.encode("Deno stderr sync\n"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stderr sync");
    expect(logs[0].level).toBe("stderr");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor captures Deno.stderr.write (async)", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", routeId: 1 },
      async () => {
        const encoder = new TextEncoder();
        await Deno.stderr.write(encoder.encode("Deno stderr async\n"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stderr async");
    expect(logs[0].level).toBe("stderr");
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});

Deno.test("StreamInterceptor does not capture Deno streams outside request context", async () => {
  const { logService, interceptor, db, tempDir } = await createTestSetup();

  try {
    interceptor.install();

    const encoder = new TextEncoder();
    Deno.stdout.writeSync(encoder.encode("Outside context\n"));
    await Deno.stderr.write(encoder.encode("Also outside\n"));

    await new Promise((resolve) => setTimeout(resolve, 100));

    const allLogs = await logService.getRecent(100);
    expect(allLogs.length).toBe(0);
  } finally {
    await cleanup(logService, interceptor, db, tempDir);
  }
});
