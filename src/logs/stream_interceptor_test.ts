import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import process from "node:process";
import { ConsoleLogService } from "./console_log_service.ts";
import {
  StreamInterceptor,
  originalConsole,
  originalStreams,
} from "./stream_interceptor.ts";
import { runInRequestContext } from "./request_context.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

interface StreamTestContext {
  logService: ConsoleLogService;
  interceptor: StreamInterceptor;
  functionId: string;
  cleanup: () => Promise<void>;
}

async function createStreamTestContext(): Promise<StreamTestContext> {
  const ctx = await TestSetupBuilder.create()
    .withLogs()
    .withFunction("/test-route", "test.ts", { name: "test-route" })
    .build();

  const route = await ctx.functionsService.getByName("test-route");
  const functionId = recordIdToString(route!.id);

  const interceptor = new StreamInterceptor({ logService: ctx.consoleLogService });

  return {
    logService: ctx.consoleLogService,
    interceptor,
    functionId,
    cleanup: async () => {
      interceptor.uninstall();
      await ctx.consoleLogService.shutdown();
      await ctx.cleanup();
    },
  };
}

// =====================
// StreamInterceptor tests
// =====================

integrationTest("StreamInterceptor captures console.log within request context", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        console.log("Hello from handler");
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Hello from handler");
    expect(logs[0].level).toBe("log");
    expect(logs[0].functionId).toBe(functionId);
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor captures all console methods with correct levels", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        console.log("log message");
        console.debug("debug message");
        console.info("info message");
        console.warn("warn message");
        console.error("error message");
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(5);

    const levels = logs.map((l) => l.level);
    expect(levels).toContain("log");
    expect(levels).toContain("debug");
    expect(levels).toContain("info");
    expect(levels).toContain("warn");
    expect(levels).toContain("error");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor captures process.stdout.write with stdout level", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        process.stdout.write("Direct stdout message\n");
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Direct stdout message");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor captures process.stderr.write with stderr level", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        process.stderr.write("Direct stderr message\n");
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Direct stderr message");
    expect(logs[0].level).toBe("stderr");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor does not capture logs outside request context", async () => {
  const { logService, interceptor, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    // Log outside request context - should NOT be stored
    console.log("System log outside context");
    process.stdout.write("System stdout outside context\n");

    // Ensure any pending logs are flushed to database
    await logService.flush();

    const allLogs = await logService.getRecent(100);
    expect(allLogs.length).toBe(0);
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor can be uninstalled", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        console.log("Before uninstall");
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    interceptor.uninstall();

    await runInRequestContext(
      { requestId: "test-request-2", functionId },
      () => {
        console.log("After uninstall");
      }
    );

    // Ensure any pending logs are flushed to database
    await logService.flush();

    const logs1 = await logService.getByRequestId("test-request-1");
    expect(logs1.length).toBe(1);

    const logs2 = await logService.getByRequestId("test-request-2");
    expect(logs2.length).toBe(0);
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor preserves originalConsole functions", () => {
  expect(typeof originalConsole.log).toBe("function");
  expect(typeof originalConsole.debug).toBe("function");
  expect(typeof originalConsole.info).toBe("function");
  expect(typeof originalConsole.warn).toBe("function");
  expect(typeof originalConsole.error).toBe("function");
  expect(typeof originalConsole.trace).toBe("function");
});

integrationTest("StreamInterceptor preserves originalStreams functions", () => {
  expect(typeof originalStreams.stdout).toBe("function");
  expect(typeof originalStreams.stderr).toBe("function");
});

integrationTest("StreamInterceptor install is idempotent", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();
    interceptor.install();
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        console.log("Test message");
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor installed getter returns correct state", async () => {
  const { interceptor, cleanup } = await createStreamTestContext();

  try {
    expect(interceptor.installed).toBe(false);
    interceptor.install();
    expect(interceptor.installed).toBe(true);
    interceptor.uninstall();
    expect(interceptor.installed).toBe(false);
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor handles Uint8Array input", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        const encoder = new TextEncoder();
        process.stdout.write(encoder.encode("Binary message\n"));
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Binary message");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor handles empty messages", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        // Empty newline should not be stored
        process.stdout.write("\n");
        // But message with content should
        process.stdout.write("Real message\n");
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Real message");
  } finally {
    await cleanup();
  }
});

// =====================
// Deno native stream tests
// =====================

integrationTest("StreamInterceptor captures Deno.stdout.writeSync", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        const encoder = new TextEncoder();
        Deno.stdout.writeSync(encoder.encode("Deno stdout sync\n"));
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stdout sync");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor captures Deno.stdout.write (async)", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      async () => {
        const encoder = new TextEncoder();
        await Deno.stdout.write(encoder.encode("Deno stdout async\n"));
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stdout async");
    expect(logs[0].level).toBe("stdout");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor captures Deno.stderr.writeSync", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      () => {
        const encoder = new TextEncoder();
        Deno.stderr.writeSync(encoder.encode("Deno stderr sync\n"));
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stderr sync");
    expect(logs[0].level).toBe("stderr");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor captures Deno.stderr.write (async)", async () => {
  const { logService, interceptor, functionId, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    await runInRequestContext(
      { requestId: "test-request-1", functionId },
      async () => {
        const encoder = new TextEncoder();
        await Deno.stderr.write(encoder.encode("Deno stderr async\n"));
      }
    );

    // Ensure logs are flushed to database
    await logService.flush();

    const logs = await logService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Deno stderr async");
    expect(logs[0].level).toBe("stderr");
  } finally {
    await cleanup();
  }
});

integrationTest("StreamInterceptor does not capture Deno streams outside request context", async () => {
  const { logService, interceptor, cleanup } = await createStreamTestContext();

  try {
    interceptor.install();

    const encoder = new TextEncoder();
    Deno.stdout.writeSync(encoder.encode("Outside context\n"));
    await Deno.stderr.write(encoder.encode("Also outside\n"));

    // Ensure any pending logs are flushed to database
    await logService.flush();

    const allLogs = await logService.getRecent(100);
    expect(allLogs.length).toBe(0);
  } finally {
    await cleanup();
  }
});
