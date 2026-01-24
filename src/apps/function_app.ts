import { Hono } from "@hono/hono";
import type { FunctionRouter } from "../functions/function_router.ts";

/**
 * Creates the function execution Hono app.
 *
 * This app handles all deployed function endpoints at /run/*. It runs on a
 * separate port from the management app, allowing network-level isolation
 * between user code execution and management operations.
 *
 * The /run prefix is intentional - it leaves room for other public endpoints
 * on this port in the future, and allows users to expose both ports at the
 * same domain if they choose (e.g., via reverse proxy).
 *
 * All /run/* requests are delegated to the FunctionRouter, which handles:
 * - Route matching from database
 * - API key validation (per-route)
 * - Handler loading and execution
 * - Console log capture
 * - Metrics collection
 */
export function createFunctionApp(functionRouter: FunctionRouter): Hono {
  const app = new Hono();

  // Function execution at /run/*
  app.all("/run/*", (c) => functionRouter.handle(c));
  app.all("/run", (c) => functionRouter.handle(c));

  return app;
}
