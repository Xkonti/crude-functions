import { expect } from "@std/expect";
import {
  createEnvContext,
  getCurrentEnvContext,
  runInEnvContext,
} from "./env_context.ts";

// =====================
// createEnvContext tests
// =====================

Deno.test("createEnvContext returns object with empty store", () => {
  const ctx = createEnvContext();
  expect(ctx.store).toBeInstanceOf(Map);
  expect(ctx.store.size).toBe(0);
});

Deno.test("createEnvContext returns independent instances", () => {
  const ctx1 = createEnvContext();
  const ctx2 = createEnvContext();

  // Should be different objects
  expect(ctx1).not.toBe(ctx2);
  expect(ctx1.store).not.toBe(ctx2.store);

  // Modifying one should not affect the other
  ctx1.store.set("KEY", "value1");
  expect(ctx2.store.has("KEY")).toBe(false);
});

Deno.test("createEnvContext store accepts string key-value pairs", () => {
  const ctx = createEnvContext();

  ctx.store.set("KEY1", "value1");
  ctx.store.set("KEY2", "value2");

  expect(ctx.store.get("KEY1")).toBe("value1");
  expect(ctx.store.get("KEY2")).toBe("value2");
  expect(ctx.store.size).toBe(2);
});

// =====================
// getCurrentEnvContext tests
// =====================

Deno.test("getCurrentEnvContext returns undefined outside context", () => {
  const result = getCurrentEnvContext();
  expect(result).toBeUndefined();
});

Deno.test("getCurrentEnvContext returns context inside runInEnvContext", () => {
  const ctx = createEnvContext();
  ctx.store.set("MARKER", "test-value");

  runInEnvContext(ctx, () => {
    const current = getCurrentEnvContext();
    expect(current).toBe(ctx);
    expect(current?.store.get("MARKER")).toBe("test-value");
  });
});

Deno.test("getCurrentEnvContext returns innermost context when nested", () => {
  const outerCtx = createEnvContext();
  const innerCtx = createEnvContext();
  outerCtx.store.set("LEVEL", "outer");
  innerCtx.store.set("LEVEL", "inner");

  runInEnvContext(outerCtx, () => {
    // Verify outer context is active
    expect(getCurrentEnvContext()).toBe(outerCtx);

    runInEnvContext(innerCtx, () => {
      // Inner context should shadow outer
      expect(getCurrentEnvContext()).toBe(innerCtx);
      expect(getCurrentEnvContext()?.store.get("LEVEL")).toBe("inner");
    });

    // Back to outer context
    expect(getCurrentEnvContext()).toBe(outerCtx);
    expect(getCurrentEnvContext()?.store.get("LEVEL")).toBe("outer");
  });
});

// =====================
// runInEnvContext tests
// =====================

Deno.test("runInEnvContext executes synchronous function", () => {
  const ctx = createEnvContext();
  const result = runInEnvContext(ctx, () => 42);
  expect(result).toBe(42);
});

Deno.test("runInEnvContext executes async function", async () => {
  const ctx = createEnvContext();
  const result = await runInEnvContext(ctx, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "async-result";
  });
  expect(result).toBe("async-result");
});

Deno.test("runInEnvContext preserves generic return type", () => {
  const ctx = createEnvContext();

  // String return
  const strResult = runInEnvContext(ctx, () => "hello");
  expect(typeof strResult).toBe("string");

  // Object return
  const objResult = runInEnvContext(ctx, () => ({ key: "value" }));
  expect(objResult).toEqual({ key: "value" });

  // Array return
  const arrResult = runInEnvContext(ctx, () => [1, 2, 3]);
  expect(arrResult).toEqual([1, 2, 3]);
});

Deno.test("runInEnvContext propagates exceptions", () => {
  const ctx = createEnvContext();

  expect(() => {
    runInEnvContext(ctx, () => {
      throw new Error("test error");
    });
  }).toThrow("test error");
});

Deno.test("runInEnvContext propagates async rejections", async () => {
  const ctx = createEnvContext();

  await expect(
    runInEnvContext(ctx, async () => {
      await Promise.reject(new Error("async error"));
    })
  ).rejects.toThrow("async error");
});

Deno.test("runInEnvContext restores previous context after completion", () => {
  const outerCtx = createEnvContext();
  const innerCtx = createEnvContext();

  runInEnvContext(outerCtx, () => {
    expect(getCurrentEnvContext()).toBe(outerCtx);

    runInEnvContext(innerCtx, () => {
      expect(getCurrentEnvContext()).toBe(innerCtx);
    });

    // Should be back to outer
    expect(getCurrentEnvContext()).toBe(outerCtx);
  });

  // Outside all contexts
  expect(getCurrentEnvContext()).toBeUndefined();
});

Deno.test("runInEnvContext restores context after exception", () => {
  const outerCtx = createEnvContext();
  const innerCtx = createEnvContext();

  runInEnvContext(outerCtx, () => {
    expect(getCurrentEnvContext()).toBe(outerCtx);

    try {
      runInEnvContext(innerCtx, () => {
        throw new Error("inner error");
      });
    } catch {
      // Ignore the error
    }

    // Should still be back to outer context
    expect(getCurrentEnvContext()).toBe(outerCtx);
  });
});

Deno.test("runInEnvContext isolates concurrent executions", async () => {
  const results: string[] = [];

  const ctx1 = createEnvContext();
  const ctx2 = createEnvContext();
  ctx1.store.set("ID", "context-1");
  ctx2.store.set("ID", "context-2");

  const task1 = runInEnvContext(ctx1, async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = getCurrentEnvContext();
    results.push(current?.store.get("ID") ?? "none");
  });

  const task2 = runInEnvContext(ctx2, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const current = getCurrentEnvContext();
    results.push(current?.store.get("ID") ?? "none");
  });

  await Promise.all([task1, task2]);

  // Each task should see its own context
  expect(results).toContain("context-1");
  expect(results).toContain("context-2");
});

// =====================
// Context store tests
// =====================

Deno.test("context store is accessible within runInEnvContext", () => {
  const ctx = createEnvContext();
  ctx.store.set("PRE_SET", "before");

  runInEnvContext(ctx, () => {
    const current = getCurrentEnvContext();
    expect(current?.store.get("PRE_SET")).toBe("before");
  });
});

Deno.test("context store modifications persist within same context", () => {
  const ctx = createEnvContext();

  runInEnvContext(ctx, () => {
    const current = getCurrentEnvContext();
    current?.store.set("NEW_KEY", "new-value");
  });

  // Value should persist in the context object
  expect(ctx.store.get("NEW_KEY")).toBe("new-value");
});

Deno.test("context store is isolated between contexts", () => {
  const ctx1 = createEnvContext();
  const ctx2 = createEnvContext();

  runInEnvContext(ctx1, () => {
    getCurrentEnvContext()?.store.set("ISOLATED", "ctx1-value");
  });

  runInEnvContext(ctx2, () => {
    // ctx2 should not see ctx1's value
    expect(getCurrentEnvContext()?.store.get("ISOLATED")).toBeUndefined();

    getCurrentEnvContext()?.store.set("ISOLATED", "ctx2-value");
  });

  // Each context maintains its own value
  expect(ctx1.store.get("ISOLATED")).toBe("ctx1-value");
  expect(ctx2.store.get("ISOLATED")).toBe("ctx2-value");
});
