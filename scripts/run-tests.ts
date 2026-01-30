/**
 * Test runner script with shared SurrealDB infrastructure.
 *
 * Starts a single SurrealDB instance before running tests in parallel,
 * ensuring all test files share the same database process. Each test
 * still gets its own namespace for isolation.
 *
 * Usage:
 *   deno task test              # Run all tests in parallel
 *   deno task test src/routes/  # Run specific directory
 *   deno task test src/foo.ts   # Run specific file
 */

import { SurrealProcessManager } from "../src/database/surreal_process_manager.ts";

const BIN_DIR = ".bin";
const BINARY_NAME = Deno.build.os === "windows" ? "surreal.exe" : "surreal";
const BINARY_PATH = `${BIN_DIR}/${BINARY_NAME}`;

// Configuration (can be overridden via environment)
const TEST_PORT = parseInt(Deno.env.get("SURREAL_TEST_PORT") ?? "54321");
const TEST_USER = Deno.env.get("SURREAL_TEST_USER") ?? "root";
const TEST_PASS = Deno.env.get("SURREAL_TEST_PASS") ?? "root";

/**
 * Check if the SurrealDB binary is available.
 */
async function isSurrealAvailable(): Promise<boolean> {
  try {
    const stat = await Deno.stat(BINARY_PATH);
    return stat.isFile;
  } catch {
    return false;
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = Deno.args;

  // Check for verbose flag early (used for both SurrealDB and test runner)
  const verbose = args.includes("-v") || args.includes("--verbose");
  const log = (...msg: unknown[]) => verbose && console.log(...msg);

  // Check if binary is available
  if (!(await isSurrealAvailable())) {
    console.error(
      `[test-runner] SurrealDB binary not found at ${BINARY_PATH}.`
    );
    console.error("[test-runner] Run 'deno task setup' first.");
    Deno.exit(1);
  }

  // Start SurrealDB
  log(`[test-runner] Starting SurrealDB on port ${TEST_PORT}...`);

  const processManager = new SurrealProcessManager({
    binaryPath: BINARY_PATH,
    port: TEST_PORT,
    storagePath: "/tmp/surreal-test", // Not used in memory mode
    storageMode: "memory",
    username: TEST_USER,
    password: TEST_PASS,
    readinessTimeoutMs: 30000,
    quiet: !verbose, // Suppress SurrealDB output unless verbose
  });

  try {
    await processManager.start();
  } catch (error) {
    console.error("[test-runner] Failed to start SurrealDB:", error);
    Deno.exit(1);
  }

  log(`[test-runner] SurrealDB ready at ${processManager.connectionUrl}`);

  // Create cleanup function
  let cleanupCalled = false;
  const cleanup = async (): Promise<void> => {
    if (cleanupCalled) return;
    cleanupCalled = true;

    log("\n[test-runner] Stopping SurrealDB...");
    try {
      await processManager.stop();
      log("[test-runner] SurrealDB stopped");
    } catch (error) {
      console.error("[test-runner] Error stopping SurrealDB:", error);
    }
  };

  // Register signal handlers for graceful cleanup
  const signalHandler = (signal: Deno.Signal) => {
    log(`\n[test-runner] Received ${signal}, cleaning up...`);
    cleanup().then(() => {
      Deno.exit(signal === "SIGINT" ? 130 : 143);
    });
  };

  Deno.addSignalListener("SIGINT", () => signalHandler("SIGINT"));
  Deno.addSignalListener("SIGTERM", () => signalHandler("SIGTERM"));

  // Build test command
  const hasReporterFlag = args.some((arg) => arg.startsWith("--reporter"));

  const testArgs = [
    "test",
    "--parallel",
    "--env-file=.env",
    "--allow-net",
    "--allow-env",
    "--allow-read",
    "--allow-write",
    "--allow-ffi",
    "--allow-run",
    // Use dot reporter for compact output unless user specified one or wants verbose
    ...(hasReporterFlag || verbose ? [] : ["--reporter=dot"]),
    ...args.filter((arg) => arg !== "-v" && arg !== "--verbose"),
  ];

  log(`[test-runner] Running: deno ${testArgs.join(" ")}`);

  const testCmd = new Deno.Command("deno", {
    args: testArgs,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...Deno.env.toObject(),
      // Set environment variables so test files know where to connect
      SURREAL_TEST_PORT: String(TEST_PORT),
      SURREAL_TEST_USER: TEST_USER,
      SURREAL_TEST_PASS: TEST_PASS,
    },
  });

  // Run tests
  const testProcess = testCmd.spawn();
  const status = await testProcess.status;

  // Cleanup
  await cleanup();

  // Exit with test exit code
  Deno.exit(status.code);
}

// Run
main().catch((error) => {
  console.error("[test-runner] Fatal error:", error);
  Deno.exit(1);
});
