import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import { ConsoleLogService } from "./console_log_service.ts";

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
  CREATE INDEX idx_console_logs_route_id ON console_logs(route_id, id);
  CREATE INDEX idx_console_logs_route_level ON console_logs(route_id, level, id);
  CREATE INDEX idx_console_logs_timestamp ON console_logs(timestamp);
`;

async function createTestSetup(): Promise<{
  service: ConsoleLogService;
  db: DatabaseService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(CONSOLE_LOGS_SCHEMA);

  const service = new ConsoleLogService({ db });
  return { service, db, tempDir };
}

async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// =====================
// ConsoleLogService tests
// =====================

Deno.test("ConsoleLogService stores log entry", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({
      requestId: "test-request-1",
      routeId: 1,
      level: "log",
      message: "Test message",
    });

    const logs = await service.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].requestId).toBe("test-request-1");
    expect(logs[0].routeId).toBe(1);
    expect(logs[0].level).toBe("log");
    expect(logs[0].message).toBe("Test message");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService stores log with args", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({
      requestId: "test-request-1",
      routeId: 1,
      level: "debug",
      message: "Debug message",
      args: JSON.stringify([{ key: "value" }, 42]),
    });

    const logs = await service.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].args).toBe('[{"key":"value"},42]');
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService retrieves logs by requestId", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store logs for different requests
    await service.store({
      requestId: "request-1",
      routeId: 1,
      level: "log",
      message: "Message 1",
    });
    await service.store({
      requestId: "request-2",
      routeId: 1,
      level: "log",
      message: "Message 2",
    });
    await service.store({
      requestId: "request-1",
      routeId: 1,
      level: "warn",
      message: "Message 3",
    });

    const logs = await service.getByRequestId("request-1");
    expect(logs.length).toBe(2);
    expect(logs[0].message).toBe("Message 1");
    expect(logs[1].message).toBe("Message 3");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService retrieves logs by routeId", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store logs for different routes
    await service.store({
      requestId: "request-1",
      routeId: 1,
      level: "log",
      message: "Route 1 - Message 1",
    });
    await service.store({
      requestId: "request-2",
      routeId: 2,
      level: "log",
      message: "Route 2 - Message 1",
    });
    await service.store({
      requestId: "request-3",
      routeId: 1,
      level: "warn",
      message: "Route 1 - Message 2",
    });

    const logs = await service.getByRouteId(1);
    expect(logs.length).toBe(2);
    // Results are ordered newest to oldest (DESC)
    expect(logs[0].message).toBe("Route 1 - Message 2");
    expect(logs[1].message).toBe("Route 1 - Message 1");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService retrieves logs by routeId with limit", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store multiple logs
    for (let i = 0; i < 5; i++) {
      await service.store({
        requestId: `request-${i}`,
        routeId: 1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    const logs = await service.getByRouteId(1, 3);
    expect(logs.length).toBe(3);
    // Results are ordered newest to oldest (DESC), limit 3 gets most recent
    expect(logs[0].message).toBe("Message 4");
    expect(logs[2].message).toBe("Message 2");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService getRecent returns most recent logs", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store logs
    for (let i = 0; i < 5; i++) {
      await service.store({
        requestId: `request-${i}`,
        routeId: 1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    const logs = await service.getRecent(3);
    expect(logs.length).toBe(3);
    // Most recent first (DESC order)
    expect(logs[0].message).toBe("Message 4");
    expect(logs[1].message).toBe("Message 3");
    expect(logs[2].message).toBe("Message 2");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService deletes logs older than date", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store a log
    await service.store({
      requestId: "old-request",
      routeId: 1,
      level: "log",
      message: "Old message",
    });

    // Delete logs older than 1 second from now
    const futureDate = new Date(Date.now() + 1000);
    const deleted = await service.deleteOlderThan(futureDate);

    expect(deleted).toBe(1);

    const logs = await service.getByRequestId("old-request");
    expect(logs.length).toBe(0);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService deletes logs by routeId", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store logs for different routes
    await service.store({
      requestId: "request-1",
      routeId: 1,
      level: "log",
      message: "Route 1 message",
    });
    await service.store({
      requestId: "request-2",
      routeId: 2,
      level: "log",
      message: "Route 2 message",
    });

    const deleted = await service.deleteByRouteId(1);
    expect(deleted).toBe(1);

    const logsRoute1 = await service.getByRouteId(1);
    expect(logsRoute1.length).toBe(0);

    const logsRoute2 = await service.getByRouteId(2);
    expect(logsRoute2.length).toBe(1);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ConsoleLogService stores all log levels", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const levels = ["log", "debug", "info", "warn", "error", "trace"] as const;

    for (const level of levels) {
      await service.store({
        requestId: "request-1",
        routeId: 1,
        level,
        message: `${level} message`,
      });
    }

    const logs = await service.getByRequestId("request-1");
    expect(logs.length).toBe(6);

    for (let i = 0; i < levels.length; i++) {
      expect(logs[i].level).toBe(levels[i]);
      expect(logs[i].message).toBe(`${levels[i]} message`);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});
