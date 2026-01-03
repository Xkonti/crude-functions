import { Hono } from "@hono/hono";
import { createAuthPages } from "./auth_pages.ts";
import { createSetupPages } from "./setup_pages.ts";
import { createPasswordPages } from "./password_pages.ts";
import { createUsersPages } from "./users_pages.ts";
import { createCodePages } from "./code_pages.ts";
import { createFunctionsPages } from "./functions_pages.ts";
import { createKeysPages } from "./keys_pages.ts";
import { layout } from "./templates.ts";
import { createSessionAuthMiddleware } from "../auth/auth_middleware.ts";
import type { Auth } from "../auth/auth.ts";
import type { DatabaseService } from "../database/database_service.ts";
import type { FileService } from "../files/file_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";

export interface WebRoutesOptions {
  auth: Auth;
  db: DatabaseService;
  fileService: FileService;
  routesService: RoutesService;
  apiKeyService: ApiKeyService;
  consoleLogService: ConsoleLogService;
  executionMetricsService: ExecutionMetricsService;
}

export function createWebRoutes(options: WebRoutesOptions): Hono {
  const { auth, db, fileService, routesService, apiKeyService, consoleLogService, executionMetricsService } = options;
  const routes = new Hono();

  // Mount setup pages (public - only accessible when no users exist)
  routes.route("/setup", createSetupPages({ db }));

  // Mount auth pages (login/logout - no auth required)
  routes.route("/", createAuthPages({ auth, db }));

  // Apply session auth to all other web routes
  routes.use("/*", createSessionAuthMiddleware({ auth }));

  // Dashboard
  routes.get("/", (c) => {
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
      </div>
    `;
    return c.html(layout("Dashboard", content));
  });

  // Mount sub-routers
  routes.route("/password", createPasswordPages());
  routes.route("/users", createUsersPages({ db }));
  routes.route("/code", createCodePages(fileService));
  routes.route("/functions", createFunctionsPages(routesService, consoleLogService, executionMetricsService));
  routes.route("/keys", createKeysPages(apiKeyService));

  return routes;
}
