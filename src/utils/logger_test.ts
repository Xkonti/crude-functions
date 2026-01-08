import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SettingNames } from "../settings/types.ts";
import {
  initializeLogger,
  logger,
  type LogLevel,
  stopLoggerRefresh,
} from "./logger.ts";

// =====================
// Console spy helpers
// =====================

interface ConsoleCall {
  method: string;
  message: string;
  args: unknown[];
}

interface ConsoleSpy {
  calls: ConsoleCall[];
  install: () => void;
  uninstall: () => void;
  clear: () => void;
}

/**
 * Creates a spy that captures console.debug/info/warn/error calls.
 * Install before testing, uninstall in finally block.
 */
function createConsoleSpy(): ConsoleSpy {
  const calls: ConsoleCall[] = [];
  const original = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  return {
    calls,
    install() {
      console.debug = (msg: string, ...args: unknown[]) =>
        calls.push({ method: "debug", message: msg, args });
      console.info = (msg: string, ...args: unknown[]) =>
        calls.push({ method: "info", message: msg, args });
      console.warn = (msg: string, ...args: unknown[]) =>
        calls.push({ method: "warn", message: msg, args });
      console.error = (msg: string, ...args: unknown[]) =>
        calls.push({ method: "error", message: msg, args });
    },
    uninstall() {
      console.debug = original.debug;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
    clear() {
      calls.length = 0;
    },
  };
}

// =====================
// Test context helpers
// =====================

interface LoggerTestContext {
  initLogger: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test context with SettingsService configured for the given log level.
 */
async function createLoggerTestContext(
  logLevel: LogLevel = "info"
): Promise<LoggerTestContext> {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withSetting(SettingNames.LOG_LEVEL, logLevel)
    .build();

  return {
    async initLogger() {
      initializeLogger(ctx.settingsService);
      // Wait for fire-and-forget refreshLogLevel() to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    async cleanup() {
      stopLoggerRefresh();
      await ctx.cleanup();
    },
  };
}

// =====================
// Log level filtering tests
// =====================

Deno.test("logger.debug outputs at debug level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("debug");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.debug("test debug message");

    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0].method).toBe("debug");
    expect(spy.calls[0].message).toContain("test debug message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.debug suppressed at info level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("info");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.debug("should not appear");

    expect(spy.calls.length).toBe(0);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.info outputs at info level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("info");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.info("test info message");

    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0].method).toBe("info");
    expect(spy.calls[0].message).toContain("test info message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.info suppressed at warn level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("warn");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.info("should not appear");

    expect(spy.calls.length).toBe(0);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.warn outputs at warn level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("warn");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.warn("test warn message");

    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0].method).toBe("warn");
    expect(spy.calls[0].message).toContain("test warn message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.warn suppressed at error level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("error");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.warn("should not appear");

    expect(spy.calls.length).toBe(0);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.error outputs at error level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("error");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.error("test error message");

    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0].method).toBe("error");
    expect(spy.calls[0].message).toContain("test error message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.error suppressed at none level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("none");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.error("should not appear");

    expect(spy.calls.length).toBe(0);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("all log methods output at debug level", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("debug");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    expect(spy.calls.length).toBe(4);
    expect(spy.calls.map((c) => c.method)).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ]);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("none level suppresses all log methods", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("none");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    expect(spy.calls.length).toBe(0);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

// =====================
// Initialization tests
// =====================

Deno.test("initializeLogger fetches log level from settings", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("debug");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    // Debug should work because we set level to debug
    logger.debug("should appear");

    expect(spy.calls.length).toBe(1);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger uses default info level before initialization", () => {
  const spy = createConsoleSpy();

  try {
    // Ensure clean state
    stopLoggerRefresh();

    spy.install();

    // Without initialization, logger should use default "info" level
    // Debug should be suppressed at default info level
    logger.debug("should not appear");
    logger.info("should appear");

    // Note: We can't guarantee clean state between tests due to module-level
    // state, but info should always work at default level
    const infoCalls = spy.calls.filter((c) => c.method === "info");
    expect(infoCalls.length).toBe(1);
  } finally {
    spy.uninstall();
    stopLoggerRefresh();
  }
});

// =====================
// Stop refresh tests
// =====================

Deno.test("stopLoggerRefresh is idempotent", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("info");

  try {
    await initLogger();

    // Multiple calls should not throw
    stopLoggerRefresh();
    stopLoggerRefresh();
    stopLoggerRefresh();

    // Should complete without error
  } finally {
    await cleanup();
  }
});

Deno.test("stopLoggerRefresh allows re-initialization", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("debug");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.debug("first init");
    expect(spy.calls.length).toBe(1);

    stopLoggerRefresh();
    spy.clear();

    // Re-initialize
    await initLogger();

    logger.debug("second init");
    expect(spy.calls.length).toBe(1);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

// =====================
// Message formatting tests
// =====================

Deno.test("logger.debug prefixes with [DEBUG]", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("debug");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.debug("test message");

    expect(spy.calls[0].message).toBe("[DEBUG] test message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.info prefixes with [INFO]", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("info");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.info("test message");

    expect(spy.calls[0].message).toBe("[INFO] test message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.warn prefixes with [WARN]", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("warn");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.warn("test message");

    expect(spy.calls[0].message).toBe("[WARN] test message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger.error prefixes with [ERROR]", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("error");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.error("test message");

    expect(spy.calls[0].message).toBe("[ERROR] test message");
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger passes additional args to console", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("debug");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    const extraData = { key: "value", count: 42 };
    logger.debug("message with data", extraData);

    expect(spy.calls[0].args).toEqual([extraData]);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

Deno.test("logger passes multiple args to console", async () => {
  const { initLogger, cleanup } = await createLoggerTestContext("info");
  const spy = createConsoleSpy();

  try {
    spy.install();
    await initLogger();

    logger.info("multi args", "arg1", 123, { nested: true });

    expect(spy.calls[0].args).toEqual(["arg1", 123, { nested: true }]);
  } finally {
    spy.uninstall();
    await cleanup();
  }
});

// =====================
// Settings integration tests
// =====================

Deno.test("logger updates level when settings change", async () => {
  // Start with info level
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withSetting(SettingNames.LOG_LEVEL, "info")
    .build();

  const spy = createConsoleSpy();

  try {
    spy.install();
    initializeLogger(ctx.settingsService);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Debug should be suppressed at info level
    logger.debug("should not appear");
    expect(spy.calls.length).toBe(0);

    // Change setting to debug
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "debug");

    // Stop current interval before re-initializing
    stopLoggerRefresh();

    // Re-initialize to trigger refresh
    initializeLogger(ctx.settingsService);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now debug should work
    logger.debug("should appear now");
    expect(spy.calls.length).toBe(1);
  } finally {
    spy.uninstall();
    stopLoggerRefresh();
    await ctx.cleanup();
  }
});

Deno.test("logger handles invalid log level gracefully", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withSetting(SettingNames.LOG_LEVEL, "debug")
    .build();

  const spy = createConsoleSpy();

  try {
    spy.install();
    initializeLogger(ctx.settingsService);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Confirm debug level is active
    logger.debug("before invalid");
    expect(spy.calls.length).toBe(1);
    spy.clear();

    // Set an invalid log level
    await ctx.settingsService.setGlobalSetting(
      SettingNames.LOG_LEVEL,
      "invalid_level"
    );

    // Stop current interval before re-initializing
    stopLoggerRefresh();

    // Re-initialize to trigger refresh
    initializeLogger(ctx.settingsService);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should keep previous valid level (debug) since invalid is ignored
    logger.debug("after invalid");
    expect(spy.calls.length).toBe(1);
  } finally {
    spy.uninstall();
    stopLoggerRefresh();
    await ctx.cleanup();
  }
});
