import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestContext } from "./types.ts";

/** Singleton AsyncLocalStorage instance for tracking request context */
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context.
 * Returns undefined if called outside a request context.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Run a function within a request context.
 * Console calls made within this context will be captured.
 */
export function runInRequestContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return requestContextStorage.run(context, fn);
}
