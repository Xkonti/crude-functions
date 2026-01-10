import type { OpenAPIHono } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";

/**
 * Creates an OpenAPIHono instance with the same validation error handler
 * used in production. Ensures test error responses match production format.
 */
export function createTestApp(): OpenAPIHono {
  return createOpenAPIApp();
}
