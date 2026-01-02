import { Hono } from "@hono/hono";
import { createWebAuthMiddleware } from "./web_auth.ts";
import { createCodePages } from "./code_pages.ts";
import { createFunctionsPages } from "./functions_pages.ts";
import { createKeysPages } from "./keys_pages.ts";
import { layout } from "./templates.ts";
import type { FileService } from "../files/file_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";

export interface WebRoutesOptions {
  fileService: FileService;
  routesService: RoutesService;
  apiKeyService: ApiKeyService;
  consoleLogService: ConsoleLogService;
}

export function createWebRoutes(options: WebRoutesOptions): Hono {
  const { fileService, routesService, apiKeyService, consoleLogService } = options;
  const routes = new Hono();

  // Apply Basic Auth to all web routes
  routes.use("/*", createWebAuthMiddleware(apiKeyService));

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
  routes.route("/code", createCodePages(fileService));
  routes.route("/functions", createFunctionsPages(routesService, consoleLogService));
  routes.route("/keys", createKeysPages(apiKeyService));

  return routes;
}
