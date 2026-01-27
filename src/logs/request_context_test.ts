import { expect } from "@std/expect";
import {
  getCurrentRequestContext,
  runInRequestContext,
} from "./request_context.ts";
import type { RequestContext } from "./types.ts";

// =====================
// Test helpers
// =====================

/**
 * Create a test RequestContext with the given values.
 */
function createContext(requestId: string, functionId: string): RequestContext {
  return { requestId, functionId };
}

// =====================
// Basic functionality tests
// =====================

Deno.test("getCurrentRequestContext returns undefined outside any context", () => {
  const result = getCurrentRequestContext();
  expect(result).toBeUndefined();
});

Deno.test("getCurrentRequestContext returns the context inside runInRequestContext", () => {
  const ctx = createContext("req-123", "42");

  runInRequestContext(ctx, () => {
    const result = getCurrentRequestContext();
    expect(result).toBe(ctx);
  });
});

Deno.test("context contains correct requestId and functionId values", () => {
  const ctx = createContext("test-request-id", "functionDef:test99");

  runInRequestContext(ctx, () => {
    const result = getCurrentRequestContext();
    expect(result?.requestId).toBe("test-request-id");
    expect(result?.functionId).toBe("functionDef:test99");
  });
});

// =====================
// Function execution tests
// =====================

Deno.test("runInRequestContext works with synchronous functions", () => {
  const ctx = createContext("sync-test", "1");

  const result = runInRequestContext(ctx, () => {
    return "sync-result";
  });

  expect(result).toBe("sync-result");
});

Deno.test("runInRequestContext works with async functions", async () => {
  const ctx = createContext("async-test", "2");

  const result = await runInRequestContext(ctx, async () => {
    await Promise.resolve();
    return "async-result";
  });

  expect(result).toBe("async-result");
});

Deno.test("return values are properly passed through", () => {
  const ctx = createContext("return-test", "3");

  const objectResult = runInRequestContext(ctx, () => ({ key: "value" }));
  expect(objectResult).toEqual({ key: "value" });

  const arrayResult = runInRequestContext(ctx, () => [1, 2, 3]);
  expect(arrayResult).toEqual([1, 2, 3]);

  const nullResult = runInRequestContext(ctx, () => null);
  expect(nullResult).toBe(null);
});

Deno.test("context is available through await points", async () => {
  const ctx = createContext("await-test", "4");

  await runInRequestContext(ctx, async () => {
    expect(getCurrentRequestContext()).toBe(ctx);
    await Promise.resolve();
    expect(getCurrentRequestContext()).toBe(ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getCurrentRequestContext()).toBe(ctx);
  });
});

// =====================
// Isolation tests
// =====================

Deno.test("concurrent executions see their own contexts", async () => {
  const results: { requestId: string; functionId: string }[] = [];

  const ctx1 = createContext("request-1", "functionDef:100");
  const ctx2 = createContext("request-2", "functionDef:200");

  const execution1 = runInRequestContext(ctx1, async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = getCurrentRequestContext();
    results.push({
      requestId: current!.requestId,
      functionId: current!.functionId,
    });
  });

  const execution2 = runInRequestContext(ctx2, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const current = getCurrentRequestContext();
    results.push({
      requestId: current!.requestId,
      functionId: current!.functionId,
    });
  });

  await Promise.all([execution1, execution2]);

  // Both executions should have seen their own contexts
  expect(results).toContainEqual({ requestId: "request-1", functionId: "functionDef:100" });
  expect(results).toContainEqual({ requestId: "request-2", functionId: "functionDef:200" });
});

Deno.test("each runInRequestContext call is isolated", () => {
  const ctx1 = createContext("first", "1");
  const ctx2 = createContext("second", "2");

  runInRequestContext(ctx1, () => {
    expect(getCurrentRequestContext()?.requestId).toBe("first");
  });

  runInRequestContext(ctx2, () => {
    expect(getCurrentRequestContext()?.requestId).toBe("second");
  });

  // Outside both contexts
  expect(getCurrentRequestContext()).toBeUndefined();
});

// =====================
// Nested context tests
// =====================

Deno.test("nested contexts use innermost context", () => {
  const outer = createContext("outer", "1");
  const inner = createContext("inner", "2");

  runInRequestContext(outer, () => {
    expect(getCurrentRequestContext()).toBe(outer);

    runInRequestContext(inner, () => {
      // Should see inner context, not outer
      expect(getCurrentRequestContext()).toBe(inner);
      expect(getCurrentRequestContext()?.requestId).toBe("inner");
    });

    // Back to outer context
    expect(getCurrentRequestContext()).toBe(outer);
  });
});

Deno.test("deeply nested contexts work correctly", () => {
  const level1 = createContext("level-1", "functionDef:1");
  const level2 = createContext("level-2", "functionDef:2");
  const level3 = createContext("level-3", "functionDef:3");

  runInRequestContext(level1, () => {
    expect(getCurrentRequestContext()?.functionId).toBe("functionDef:1");

    runInRequestContext(level2, () => {
      expect(getCurrentRequestContext()?.functionId).toBe("functionDef:2");

      runInRequestContext(level3, () => {
        expect(getCurrentRequestContext()?.functionId).toBe("functionDef:3");
      });

      expect(getCurrentRequestContext()?.functionId).toBe("functionDef:2");
    });

    expect(getCurrentRequestContext()?.functionId).toBe("functionDef:1");
  });
});

// =====================
// Error handling tests
// =====================

Deno.test("errors thrown in the function are propagated", () => {
  const ctx = createContext("error-test", "1");

  expect(() => {
    runInRequestContext(ctx, () => {
      throw new Error("test error");
    });
  }).toThrow("test error");
});

Deno.test("async errors are propagated", async () => {
  const ctx = createContext("async-error-test", "2");

  await expect(
    runInRequestContext(ctx, async () => {
      await Promise.resolve();
      throw new Error("async test error");
    })
  ).rejects.toThrow("async test error");
});

Deno.test("context is cleared after error", () => {
  const ctx = createContext("cleanup-test", "1");

  try {
    runInRequestContext(ctx, () => {
      throw new Error("intentional error");
    });
  } catch {
    // Error expected
  }

  // Context should be undefined after error
  expect(getCurrentRequestContext()).toBeUndefined();
});

Deno.test("nested context error restores outer context", () => {
  const outer = createContext("outer", "1");
  const inner = createContext("inner", "2");

  runInRequestContext(outer, () => {
    try {
      runInRequestContext(inner, () => {
        throw new Error("inner error");
      });
    } catch {
      // Error expected
    }

    // Should still have outer context
    expect(getCurrentRequestContext()).toBe(outer);
  });
});
