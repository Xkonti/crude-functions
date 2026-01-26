import { Hono } from "@hono/hono";

import type { Auth } from "../auth/auth.ts";
import type { DatabaseService } from "../database/database_service.ts";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import type { VersionedEncryptionService } from "../encryption/versioned_encryption_service.ts";
import type { KeyStorageService } from "../encryption/key_storage_service.ts";
import type { KeyRotationService } from "../encryption/key_rotation_service.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { UserService } from "../users/user_service.ts";
import type { CodeSourceService } from "../sources/code_source_service.ts";
import type { SourceFileService } from "../files/source_file_service.ts";
import type { SchedulingService } from "../scheduling/scheduling_service.ts";
import type { CsrfService } from "../csrf/csrf_service.ts";

import { createHybridAuthMiddleware } from "../auth/auth_middleware.ts";
import { createSecurityHeadersMiddleware, createWebCacheHeadersMiddleware } from "../middleware/security_headers.ts";
import { createCsrfMiddleware } from "../csrf/csrf_middleware.ts";
import { createApiKeyRoutes, createApiKeyGroupRoutes } from "../keys/api_key_routes.ts";
import { createFunctionsRoutes } from "../routes/functions_routes.ts";
import { createSourceRoutes, createSourceWebhookRoute } from "../sources/source_routes.ts";
import { createSourceFileRoutes } from "../files/source_file_routes.ts";
import { createRotationRoutes } from "../encryption/rotation_routes.ts";
import { createSettingsRoutes } from "../settings/settings_routes.ts";
import { createSecretsRoutes } from "../secrets/secrets_routes.ts";
import { createLogsRoutes } from "../logs/logs_routes.ts";
import { createMetricsRoutes } from "../metrics/metrics_routes.ts";
import { createUserRoutes } from "../users/user_routes.ts";
import { createWebRoutes } from "../web/web_routes.ts";

/**
 * Dependencies required by the management app.
 */
export interface ManagementAppDeps {
  auth: Auth;
  db: DatabaseService;
  surrealFactory: SurrealConnectionFactory;
  apiKeyService: ApiKeyService;
  routesService: RoutesService;
  consoleLogService: ConsoleLogService;
  executionMetricsService: ExecutionMetricsService;
  encryptionService: VersionedEncryptionService;
  keyStorageService: KeyStorageService;
  keyRotationService: KeyRotationService;
  secretsService: SecretsService;
  settingsService: SettingsService;
  userService: UserService;
  codeSourceService: CodeSourceService;
  sourceFileService: SourceFileService;
  schedulingService: SchedulingService;
  csrfService: CsrfService;
}

/**
 * Creates the management Hono app.
 *
 * This app handles all management operations:
 * - /api/auth/* - Authentication (Better Auth, public)
 * - /api/* - Management API (protected by hybrid auth)
 * - /web/* - Web UI (protected by session auth)
 *
 * Runs on a separate port from the function app, allowing network-level
 * isolation between management operations and user code execution.
 */
export function createManagementApp(deps: ManagementAppDeps): Hono {
  const app = new Hono();

  // ============================================================================
  // Security Headers (applied to ALL responses)
  // ============================================================================
  app.use("/*", createSecurityHeadersMiddleware());

  // Create hybrid auth middleware (accepts session OR API key)
  const hybridAuth = createHybridAuthMiddleware({
    auth: deps.auth,
    apiKeyService: deps.apiKeyService,
    settingsService: deps.settingsService,
  });

  // Create CSRF middleware (validates tokens on state-changing requests)
  const csrfMiddleware = createCsrfMiddleware(deps.csrfService);

  // ============================================================================
  // Auth Endpoints (public - no CSRF, these are JSON API calls)
  // ============================================================================
  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  // ============================================================================
  // Webhook Endpoint (public - uses its own secret validation)
  // Must be registered BEFORE the protected API routes
  // ============================================================================
  app.route("/api/sources", createSourceWebhookRoute({
    codeSourceService: deps.codeSourceService,
  }));

  // ============================================================================
  // Protected API Routes
  // ============================================================================
  // Create a sub-router for all protected API endpoints
  const api = new Hono();

  // Apply hybrid auth to all API routes (sets authMethod in context)
  api.use("/*", hybridAuth);

  // Apply CSRF protection after auth (skips for API key authenticated requests)
  api.use("/*", csrfMiddleware);

  // API Key management
  api.route("/key-groups", createApiKeyGroupRoutes(deps.apiKeyService));
  api.route("/keys", createApiKeyRoutes(deps.apiKeyService));

  // Function route management
  api.route("/functions", createFunctionsRoutes(deps.routesService));

  // Code source management (webhook already registered above)
  api.route("/sources", createSourceRoutes({
    codeSourceService: deps.codeSourceService,
  }));

  // Source file management
  api.route("/sources", createSourceFileRoutes({
    sourceFileService: deps.sourceFileService,
    settingsService: deps.settingsService,
    codeSourceService: deps.codeSourceService,
  }));

  // Encryption key rotation
  api.route("/encryption-keys", createRotationRoutes({
    keyRotationService: deps.keyRotationService,
    keyStorageService: deps.keyStorageService,
    settingsService: deps.settingsService,
    schedulingService: deps.schedulingService,
  }));

  // Settings management
  api.route("/settings", createSettingsRoutes({
    settingsService: deps.settingsService,
    schedulingService: deps.schedulingService,
    keyStorageService: deps.keyStorageService,
  }));

  // Secrets management
  api.route("/secrets", createSecretsRoutes(deps.secretsService));

  // Logs API
  api.route("/logs", createLogsRoutes({
    consoleLogService: deps.consoleLogService,
    routesService: deps.routesService,
  }));

  // Metrics API
  api.route("/metrics", createMetricsRoutes({
    executionMetricsService: deps.executionMetricsService,
    routesService: deps.routesService,
    settingsService: deps.settingsService,
  }));

  // User management
  api.route("/users", createUserRoutes(deps.userService));

  // Mount the protected API router
  app.route("/api", api);

  // ============================================================================
  // Favicon (public)
  // ============================================================================
  app.get("/favicon.ico", async (c) => {
    try {
      const faviconPath = new URL("../../docs/public/favicon.svg", import.meta.url);
      const content = await Deno.readFile(faviconPath);

      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Content-Length": String(content.length),
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (error) {
      console.error("Failed to serve favicon:", error);
      return c.text("Favicon not found", 404);
    }
  });

  // ============================================================================
  // Web UI (session auth applied internally by createWebRoutes)
  // ============================================================================
  // Apply CSRF middleware to web routes (validates tokens, sets csrfToken in context)
  app.use("/web/*", csrfMiddleware);

  // Apply cache headers to prevent caching of sensitive admin pages
  app.use("/web/*", createWebCacheHeadersMiddleware());

  app.route("/web", createWebRoutes({
    auth: deps.auth,
    db: deps.db,
    surrealFactory: deps.surrealFactory,
    userService: deps.userService,
    routesService: deps.routesService,
    apiKeyService: deps.apiKeyService,
    consoleLogService: deps.consoleLogService,
    executionMetricsService: deps.executionMetricsService,
    encryptionService: deps.encryptionService,
    settingsService: deps.settingsService,
    codeSourceService: deps.codeSourceService,
    sourceFileService: deps.sourceFileService,
  }));

  return app;
}
