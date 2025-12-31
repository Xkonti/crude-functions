import { Hono } from "@hono/hono";
import "@std/dotenv/load";
import { ApiKeyService } from "./src/keys/api_key_service.ts";
import { createApiKeyRoutes } from "./src/keys/api_key_routes.ts";
import { createManagementAuthMiddleware } from "./src/middleware/management_auth.ts";
import { RoutesService } from "./src/routes/routes_service.ts";
import { createRoutesRoutes } from "./src/routes/routes_routes.ts";
import { FunctionRouter } from "./src/functions/function_router.ts";
import { FileService } from "./src/files/file_service.ts";
import { createFileRoutes } from "./src/files/file_routes.ts";

const app = new Hono();

// Initialize API key service
const apiKeyService = new ApiKeyService({
  configPath: "./config/keys.config",
  managementKeyFromEnv: Deno.env.get("MANAGEMENT_API_KEY"),
});

// Initialize routes service
const routesService = new RoutesService({
  configPath: "./config/routes.json",
});

// Initialize function router
const functionRouter = new FunctionRouter({
  routesService,
  apiKeyService,
});

// Public endpoints
app.get("/ping", (c) => c.json({ pong: true }));

// Protected API management routes
app.use("/api/keys/*", createManagementAuthMiddleware(apiKeyService));
app.use("/api/keys", createManagementAuthMiddleware(apiKeyService));
app.route("/api/keys", createApiKeyRoutes(apiKeyService));

app.use("/api/routes/*", createManagementAuthMiddleware(apiKeyService));
app.use("/api/routes", createManagementAuthMiddleware(apiKeyService));
app.route("/api/routes", createRoutesRoutes(routesService));

// Initialize file service
const fileService = new FileService({
  basePath: "./code",
});

// Protected file management routes
app.use("/api/files/*", createManagementAuthMiddleware(apiKeyService));
app.use("/api/files", createManagementAuthMiddleware(apiKeyService));
app.route("/api/files", createFileRoutes(fileService));

// Dynamic function router - catch all /run/* requests
app.all("/run/*", (c) => functionRouter.handle(c));
app.all("/run", (c) => functionRouter.handle(c));

// Export app and services for testing
export { app, apiKeyService, routesService, functionRouter, fileService };

// Start server only when run directly
if (import.meta.main) {
  const port = parseInt(Deno.env.get("PORT") || "8000");
  Deno.serve({ port }, app.fetch);
}
