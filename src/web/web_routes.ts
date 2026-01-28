import { Hono } from "@hono/hono";
import { createAuthPages } from "./auth_pages.ts";
import { createSetupPages } from "./setup_pages.ts";
import { createPasswordPages } from "./password_pages.ts";
import { createUsersPages } from "./users_pages.ts";
import { createSourcePages } from "./source_pages.ts";
import { createFunctionsPages } from "./functions_pages.ts";
import { createKeysPages } from "./keys_pages.ts";
import { createSecretsPages } from "./secrets_pages.ts";
import { createSettingsPages } from "./settings_pages.ts";
import { layout, getLayoutUser } from "./templates.ts";
import { createSessionAuthMiddleware } from "../auth/auth_middleware.ts";
import type { Auth } from "../auth/auth.ts";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import { SecretsService } from "../secrets/secrets_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { UserService } from "../users/user_service.ts";
import type { CodeSourceService } from "../sources/code_source_service.ts";
import type { SourceFileService } from "../files/source_file_service.ts";

export interface WebRoutesOptions {
  auth: Auth;
  surrealFactory: SurrealConnectionFactory;
  userService: UserService;
  routesService: RoutesService;
  apiKeyService: ApiKeyService;
  consoleLogService: ConsoleLogService;
  executionMetricsService: ExecutionMetricsService;
  encryptionService: IEncryptionService;
  settingsService: SettingsService;
  codeSourceService: CodeSourceService;
  sourceFileService: SourceFileService;
}

export function createWebRoutes(options: WebRoutesOptions): Hono {
  const { auth, surrealFactory, userService, routesService, apiKeyService, consoleLogService, executionMetricsService, encryptionService, settingsService, codeSourceService, sourceFileService } = options;
  const routes = new Hono();

  // Initialize secrets service
  const secretsService = new SecretsService({ surrealFactory, encryptionService });

  // Mount setup pages (public - only accessible when no users exist)
  routes.route("/setup", createSetupPages({ auth, userService, settingsService }));

  // Mount auth pages (login/logout - no auth required)
  routes.route("/", createAuthPages({ auth, userService }));

  // Serve favicon (public - no auth required)
  routes.get("/favicon.ico", async (c) => {
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

  // Apply session auth to all other web routes
  routes.use("/*", createSessionAuthMiddleware({ auth }));

  // Dashboard
  routes.get("/", async (c) => {
    const content = `
      <h1>Dashboard</h1>
      <div class="grid">
        <article>
          <header><strong>Code Files</strong></header>
          <p>Manage TypeScript handlers and supporting files in the code directory.</p>
          <footer>
            <a href="/web/code" role="button">Manage Code</a>
          </footer>
        </article>
        <article>
          <header><strong>Functions</strong></header>
          <p>Configure HTTP routes, their handlers, and access control.</p>
          <footer>
            <a href="/web/functions" role="button">Manage Functions</a>
          </footer>
        </article>
        <article>
          <header><strong>API Keys</strong></header>
          <p>Manage authentication keys for API and function access.</p>
          <footer>
            <a href="/web/keys" role="button">Manage Keys</a>
          </footer>
        </article>
        <article>
          <header><strong>Secrets</strong></header>
          <p>Manage encrypted global secrets available to all functions.</p>
          <footer>
            <a href="/web/secrets" role="button">Manage Secrets</a>
          </footer>
        </article>
      </div>
    `;
    return c.html(await layout("Dashboard", content, getLayoutUser(c), settingsService));
  });

  // Mount sub-routers
  routes.route("/password", createPasswordPages(settingsService));
  routes.route("/users", createUsersPages({ userService, settingsService }));
  routes.route("/code", createSourcePages(codeSourceService, sourceFileService, settingsService));
  routes.route("/functions", createFunctionsPages(routesService, consoleLogService, executionMetricsService, apiKeyService, secretsService, settingsService));
  routes.route("/keys", createKeysPages(apiKeyService, secretsService, settingsService));
  routes.route("/secrets", createSecretsPages({ surrealFactory, encryptionService, settingsService }));
  routes.route("/settings", createSettingsPages({ settingsService, apiKeyService }));

  return routes;
}
