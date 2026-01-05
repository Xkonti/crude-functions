import { expect } from "@std/expect";
import process from "node:process";
import { EnvIsolator, _getOriginalDenoEnvForTesting } from "./env_isolator.ts";
import { runInEnvContext, createEnvContext } from "./env_context.ts";

// =====================
// Test setup/teardown helpers
// =====================

function setup(): EnvIsolator {
  const isolator = new EnvIsolator();
  isolator.install();
  return isolator;
}

function cleanup(isolator: EnvIsolator): void {
  isolator.uninstall();
}

// =====================
// Basic isolation tests
// =====================

Deno.test("EnvIsolator returns undefined for all keys inside handler context", () => {
  const isolator = setup();

  try {
    // Set a real env var first (outside context)
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("TEST_REAL_VAR", "real-value");

    const result = runInEnvContext(createEnvContext(), () => {
      // Inside handler - should not see real env
      return Deno.env.get("TEST_REAL_VAR");
    });

    expect(result).toBe(undefined);

    // Cleanup
    originalEnv.delete("TEST_REAL_VAR");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator allows setting and getting values inside handler context", () => {
  const isolator = setup();

  try {
    const result = runInEnvContext(createEnvContext(), () => {
      Deno.env.set("HANDLER_VAR", "handler-value");
      return Deno.env.get("HANDLER_VAR");
    });

    expect(result).toBe("handler-value");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator isolates between concurrent handler executions", async () => {
  const isolator = setup();

  try {
    const results: string[] = [];

    const handler1 = runInEnvContext(createEnvContext(), async () => {
      Deno.env.set("SHARED_KEY", "value-1");
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push(Deno.env.get("SHARED_KEY") ?? "undefined");
    });

    const handler2 = runInEnvContext(createEnvContext(), async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      Deno.env.set("SHARED_KEY", "value-2");
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push(Deno.env.get("SHARED_KEY") ?? "undefined");
    });

    await Promise.all([handler1, handler2]);

    // Each handler should see its own value
    expect(results).toContain("value-1");
    expect(results).toContain("value-2");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator returns real env outside handler context", () => {
  const isolator = setup();

  try {
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("SYSTEM_VAR", "system-value");

    // Outside any handler context
    const result = Deno.env.get("SYSTEM_VAR");

    expect(result).toBe("system-value");

    // Cleanup
    originalEnv.delete("SYSTEM_VAR");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator has() returns correct values", () => {
  const isolator = setup();

  try {
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("REAL_VAR", "exists");

    runInEnvContext(createEnvContext(), () => {
      // Should not have real var
      expect(Deno.env.has("REAL_VAR")).toBe(false);

      // Set a handler var
      Deno.env.set("HANDLER_VAR", "exists");
      expect(Deno.env.has("HANDLER_VAR")).toBe(true);
    });

    // Cleanup
    originalEnv.delete("REAL_VAR");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator delete() works correctly", () => {
  const isolator = setup();

  try {
    runInEnvContext(createEnvContext(), () => {
      Deno.env.set("DELETE_ME", "value");
      expect(Deno.env.has("DELETE_ME")).toBe(true);

      Deno.env.delete("DELETE_ME");
      expect(Deno.env.has("DELETE_ME")).toBe(false);
    });
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator toObject() returns isolated store contents", () => {
  const isolator = setup();

  try {
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("REAL_VAR", "real");

    const result = runInEnvContext(createEnvContext(), () => {
      Deno.env.set("HANDLER_A", "a");
      Deno.env.set("HANDLER_B", "b");
      return Deno.env.toObject();
    }) as { [key: string]: string };

    // Should only contain handler vars, not real vars
    expect(result).toEqual({ HANDLER_A: "a", HANDLER_B: "b" });
    expect(result["REAL_VAR"]).toBeUndefined();

    // Cleanup
    originalEnv.delete("REAL_VAR");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator toObject() returns real env outside context", () => {
  const isolator = setup();

  try {
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("SYSTEM_VAR", "system");

    // Outside context should return real env
    const result = Deno.env.toObject();
    expect(result.SYSTEM_VAR).toBe("system");

    // Cleanup
    originalEnv.delete("SYSTEM_VAR");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator install is idempotent", () => {
  const isolator = setup();

  try {
    // Install again - should not throw or double-wrap
    isolator.install();
    isolator.install();

    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("TEST_VAR", "value");

    // Should still work correctly
    expect(Deno.env.get("TEST_VAR")).toBe("value");

    // Cleanup
    originalEnv.delete("TEST_VAR");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator can be uninstalled", () => {
  const isolator = setup();

  try {
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("RESTORE_TEST", "original");

    // Verify isolation works
    runInEnvContext(createEnvContext(), () => {
      expect(Deno.env.get("RESTORE_TEST")).toBe(undefined);
    });

    // Uninstall
    isolator.uninstall();

    // Now should see real env directly
    expect(Deno.env.get("RESTORE_TEST")).toBe("original");

    // Cleanup
    originalEnv.delete("RESTORE_TEST");
  } finally {
    // Already uninstalled, but ensure cleanup
    if (isolator.installed) {
      cleanup(isolator);
    }
  }
});

Deno.test("EnvIsolator installed property reflects state", () => {
  const isolator = new EnvIsolator();

  expect(isolator.installed).toBe(false);

  isolator.install();
  expect(isolator.installed).toBe(true);

  isolator.uninstall();
  expect(isolator.installed).toBe(false);
});

// =====================
// process.env tests
// =====================

Deno.test("process.env mirrors Deno.env isolation", () => {
  const isolator = setup();

  try {
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("PROCESS_TEST", "real");

    runInEnvContext(createEnvContext(), () => {
      // process.env should also be isolated
      expect(process.env.PROCESS_TEST).toBe(undefined);

      // Set via Deno.env, read via process.env
      Deno.env.set("CROSS_SET", "value");
      expect(process.env.CROSS_SET).toBe("value");

      // Set via process.env, read via Deno.env
      process.env.REVERSE_SET = "reverse";
      expect(Deno.env.get("REVERSE_SET")).toBe("reverse");
    });

    // Cleanup
    originalEnv.delete("PROCESS_TEST");
  } finally {
    cleanup(isolator);
  }
});

Deno.test("process.env assignment works in isolated context", () => {
  const isolator = setup();

  try {
    runInEnvContext(createEnvContext(), () => {
      process.env.MY_CONFIG = "my-value";
      expect(process.env.MY_CONFIG).toBe("my-value");
      expect(Deno.env.get("MY_CONFIG")).toBe("my-value");
    });
  } finally {
    cleanup(isolator);
  }
});

Deno.test("process.env is isolated outside handler context uses real env", () => {
  const isolator = setup();

  try {
    const originalEnv = _getOriginalDenoEnvForTesting();
    originalEnv.set("SYSTEM_PROCESS_VAR", "system-value");

    // Outside context, process.env should see real env
    expect(process.env.SYSTEM_PROCESS_VAR).toBe("system-value");

    // Cleanup
    originalEnv.delete("SYSTEM_PROCESS_VAR");
  } finally {
    cleanup(isolator);
  }
});

// =====================
// Edge cases
// =====================

Deno.test("EnvIsolator handles empty keys gracefully", () => {
  const isolator = setup();

  try {
    runInEnvContext(createEnvContext(), () => {
      // These shouldn't throw
      Deno.env.set("", "empty-key-value");
      expect(Deno.env.get("")).toBe("empty-key-value");
      expect(Deno.env.has("")).toBe(true);
      Deno.env.delete("");
      expect(Deno.env.has("")).toBe(false);
    });
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator handles special characters in values", () => {
  const isolator = setup();

  try {
    runInEnvContext(createEnvContext(), () => {
      const specialValue = "value with spaces\nand\ttabs\r\nand=equals";
      Deno.env.set("SPECIAL", specialValue);
      expect(Deno.env.get("SPECIAL")).toBe(specialValue);
    });
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator context is fresh for each createEnvContext call", () => {
  const isolator = setup();

  try {
    // First context
    runInEnvContext(createEnvContext(), () => {
      Deno.env.set("VAR", "first");
    });

    // Second context should be fresh
    const result = runInEnvContext(createEnvContext(), () => {
      return Deno.env.get("VAR");
    });

    expect(result).toBe(undefined);
  } finally {
    cleanup(isolator);
  }
});

Deno.test("EnvIsolator nested contexts use innermost store", () => {
  const isolator = setup();

  try {
    runInEnvContext(createEnvContext(), () => {
      Deno.env.set("OUTER", "outer-value");

      runInEnvContext(createEnvContext(), () => {
        // Inner context should NOT see outer context's vars
        expect(Deno.env.get("OUTER")).toBe(undefined);

        Deno.env.set("INNER", "inner-value");
        expect(Deno.env.get("INNER")).toBe("inner-value");
      });

      // Back to outer context, should see OUTER but not INNER
      expect(Deno.env.get("OUTER")).toBe("outer-value");
      expect(Deno.env.get("INNER")).toBe(undefined);
    });
  } finally {
    cleanup(isolator);
  }
});
