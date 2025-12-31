import { basicAuth } from "@hono/hono/basic-auth";
import type { ApiKeyService } from "../keys/api_key_service.ts";

/**
 * Creates HTTP Basic Auth middleware for web routes.
 * Username is ignored, password must match a valid management API key.
 */
export function createWebAuthMiddleware(apiKeyService: ApiKeyService) {
  return basicAuth({
    verifyUser: async (_username, password, _c) => {
      return await apiKeyService.hasKey("management", password);
    },
    realm: "Functions Router",
  });
}
