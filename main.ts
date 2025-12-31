import { Hono } from "@hono/hono";
import "@std/dotenv/load";
import { ApiKeyService } from "./src/keys/api_key_service.ts";
import { createApiKeyRoutes } from "./src/keys/api_key_routes.ts";
import { createManagementAuthMiddleware } from "./src/middleware/management_auth.ts";

const app = new Hono();

// Initialize API key service
const apiKeyService = new ApiKeyService({
  configPath: "./config/keys.config",
  managementKeyFromEnv: Deno.env.get("MANAGEMENT_API_KEY"),
});

// Public endpoints
app.get("/ping", (c) => c.json({ pong: true }));

// Protected API key management routes
app.use("/api/keys/*", createManagementAuthMiddleware(apiKeyService));
app.route("/api/keys", createApiKeyRoutes(apiKeyService));

// Export app and service for testing
export { app, apiKeyService };

// Start server only when run directly
if (import.meta.main) {
  const port = parseInt(Deno.env.get("PORT") || "8000");
  Deno.serve({ port }, app.fetch);
}
