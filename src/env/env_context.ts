import { AsyncLocalStorage } from "node:async_hooks";
import type { EnvContext } from "./types.ts";

/** Singleton AsyncLocalStorage instance for tracking env context */
const envContextStorage = new AsyncLocalStorage<EnvContext>();

/**
 * Get the current env context.
 * Returns undefined if called outside a handler context.
 */
export function getCurrentEnvContext(): EnvContext | undefined {
  return envContextStorage.getStore();
}

/**
 * Run a function within an isolated env context.
 * Code within this context will see an isolated (initially empty) env store.
 */
export function runInEnvContext<T>(
  context: EnvContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return envContextStorage.run(context, fn);
}

/**
 * Create a fresh env context for handler execution.
 * The store starts empty - handlers must explicitly set values.
 */
export function createEnvContext(): EnvContext {
  return {
    store: new Map<string, string>(),
  };
}
