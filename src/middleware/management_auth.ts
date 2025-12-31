import type { Context, Next } from "@hono/hono";
import type { ApiKeyService } from "../keys/api_key_service.ts";

export function createManagementAuthMiddleware(service: ApiKeyService) {
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header("X-API-Key");

    if (!apiKey || !(await service.hasKey("management", apiKey))) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
