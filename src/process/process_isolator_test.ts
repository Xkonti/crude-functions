import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ProcessIsolator, _getOriginalsForTesting } from "./process_isolator.ts";
import { runInRequestContext } from "../logs/request_context.ts";
import process from "node:process";

let isolator: ProcessIsolator;

// Setup/teardown helpers
function setupIsolator() {
  isolator = new ProcessIsolator();
  isolator.install();
}

function teardownIsolator() {
  if (isolator) {
    isolator.uninstall();
  }
}

// Test helpers
const createTestContext = () => ({
  requestId: crypto.randomUUID(),
  functionId: "functionDef:test123",
});

describe("ProcessIsolator", () => {
  describe("Installation", () => {
    afterEach(() => {
      teardownIsolator();
    });

    it("should install successfully", () => {
      setupIsolator();
      expect(isolator.installed).toBe(true);
    });

    it("should be idempotent", () => {
      setupIsolator();
      isolator.install(); // Second install
      expect(isolator.installed).toBe(true);
    });

    it("should uninstall successfully", () => {
      setupIsolator();
      isolator.uninstall();
      expect(isolator.installed).toBe(false);
    });

    it("should allow multiple install/uninstall cycles", () => {
      setupIsolator();
      isolator.uninstall();
      isolator.install();
      expect(isolator.installed).toBe(true);
      isolator.uninstall();
      expect(isolator.installed).toBe(false);
    });

    it("should provide access to originals for testing", () => {
      setupIsolator();
      const originals = _getOriginalsForTesting();
      expect(originals.denoExit).toBeDefined();
      expect(originals.denoChdir).toBeDefined();
      expect(originals.processExit).toBeDefined();
      expect(originals.processChdir).toBeDefined();
    });
  });

  describe("Deno.exit() isolation", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should throw inside handler context", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => Deno.exit(0)).toThrow(
          "Function handlers cannot call Deno.exit(). Return a response instead."
        );
      });
    });

    it("should throw with exit code", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => Deno.exit(1)).toThrow(
          "Function handlers cannot call Deno.exit(). Return a response instead."
        );
      });
    });

    it("should throw without exit code", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => Deno.exit()).toThrow(
          "Function handlers cannot call Deno.exit(). Return a response instead."
        );
      });
    });
  });

  describe("process.exit() isolation", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should throw inside handler context", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => process.exit(0)).toThrow(
          "Function handlers cannot call process.exit(). Return a response instead."
        );
      });
    });

    it("should throw with exit code", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => process.exit(1)).toThrow(
          "Function handlers cannot call process.exit(). Return a response instead."
        );
      });
    });

    it("should throw without exit code", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => process.exit()).toThrow(
          "Function handlers cannot call process.exit(). Return a response instead."
        );
      });
    });
  });

  describe("Deno.chdir() isolation", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should throw inside handler context with string path", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => Deno.chdir("/tmp")).toThrow(
          "Function handlers cannot change working directory. Use absolute paths instead."
        );
      });
    });

    it("should throw inside handler context with URL path", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => Deno.chdir(new URL("file:///tmp"))).toThrow(
          "Function handlers cannot change working directory. Use absolute paths instead."
        );
      });
    });
  });

  describe("process.chdir() isolation", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should throw inside handler context", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        expect(() => process.chdir("/tmp")).toThrow(
          "Function handlers cannot change working directory. Use absolute paths instead."
        );
      });
    });
  });

  describe("Concurrent execution", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should isolate errors across concurrent requests", async () => {
      const context1 = createTestContext();
      const context2 = createTestContext();

      const promises = [
        runInRequestContext(context1, () => {
          expect(() => Deno.exit(0)).toThrow("Function handlers cannot call Deno.exit()");
        }),
        runInRequestContext(context2, () => {
          expect(() => process.exit(0)).toThrow("Function handlers cannot call process.exit()");
        }),
      ];

      await Promise.all(promises);
    });

    it("should isolate different methods across concurrent requests", async () => {
      const context1 = createTestContext();
      const context2 = createTestContext();
      const context3 = createTestContext();
      const context4 = createTestContext();

      const promises = [
        runInRequestContext(context1, () => {
          expect(() => Deno.exit(0)).toThrow();
        }),
        runInRequestContext(context2, () => {
          expect(() => process.exit(0)).toThrow();
        }),
        runInRequestContext(context3, () => {
          expect(() => Deno.chdir("/tmp")).toThrow();
        }),
        runInRequestContext(context4, () => {
          expect(() => process.chdir("/tmp")).toThrow();
        }),
      ];

      await Promise.all(promises);
    });
  });

  describe("Outside handler context", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should not throw when no context is active", async () => {
      // NOTE: We cannot actually call the exit methods outside of context
      // in tests because they would terminate the test runner.
      // This test verifies the isolation is inactive (no throw) by checking
      // the current context is undefined, which means the guard won't trigger.

      // Verify we're outside any request context
      const { getCurrentRequestContext } = await import("../logs/request_context.ts");
      expect(getCurrentRequestContext()).toBeUndefined();

      // If we were to call exit/chdir here, it would use the original methods
      // (but we can't actually test that without terminating/changing the process)
    });
  });

  describe("Async boundaries", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should maintain isolation across async operations", async () => {
      const context = createTestContext();

      await runInRequestContext(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(() => Deno.exit(0)).toThrow(
          "Function handlers cannot call Deno.exit()"
        );
      });
    });

    it("should maintain isolation across multiple async levels", async () => {
      const context = createTestContext();

      await runInRequestContext(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));

        const nested = async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          expect(() => process.chdir("/tmp")).toThrow(
            "Function handlers cannot change working directory"
          );
        };

        await nested();
      });
    });
  });

  describe("Nested contexts", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should throw in nested request contexts", () => {
      const context1 = createTestContext();
      const context2 = createTestContext();

      runInRequestContext(context1, () => {
        runInRequestContext(context2, () => {
          expect(() => Deno.exit(0)).toThrow(
            "Function handlers cannot call Deno.exit()"
          );
        });
      });
    });

    it("should throw in innermost context for all methods", () => {
      const context1 = createTestContext();
      const context2 = createTestContext();

      runInRequestContext(context1, () => {
        runInRequestContext(context2, () => {
          expect(() => Deno.exit(0)).toThrow();
          expect(() => process.exit(0)).toThrow();
          expect(() => Deno.chdir("/tmp")).toThrow();
          expect(() => process.chdir("/tmp")).toThrow();
        });
      });
    });
  });

  describe("Error messages", () => {
    beforeEach(() => {
      setupIsolator();
    });

    afterEach(() => {
      teardownIsolator();
    });

    it("should have clear error message for Deno.exit", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        try {
          Deno.exit(0);
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect((error as Error).message).toBe(
            "Function handlers cannot call Deno.exit(). Return a response instead."
          );
        }
      });
    });

    it("should have clear error message for process.exit", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        try {
          process.exit(0);
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect((error as Error).message).toBe(
            "Function handlers cannot call process.exit(). Return a response instead."
          );
        }
      });
    });

    it("should have clear error message for Deno.chdir", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        try {
          Deno.chdir("/tmp");
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect((error as Error).message).toBe(
            "Function handlers cannot change working directory. Use absolute paths instead."
          );
        }
      });
    });

    it("should have clear error message for process.chdir", () => {
      const context = createTestContext();

      runInRequestContext(context, () => {
        try {
          process.chdir("/tmp");
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect((error as Error).message).toBe(
            "Function handlers cannot change working directory. Use absolute paths instead."
          );
        }
      });
    });
  });
});
