import { Hono } from "@hono/hono";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  getLayoutUser,
  getCsrfToken,
} from "./templates.ts";
import { csrfInput } from "../csrf/csrf_helpers.ts";

/**
 * Options for creating the query pages router.
 */
export interface QueryPagesOptions {
  surrealFactory: SurrealConnectionFactory;
  settingsService: SettingsService;
}

/**
 * Creates the SurrealDB query page router.
 *
 * Provides a simple interface to execute raw SurrealQL queries
 * and view the JSON response. Intended for debugging and admin use.
 */
export function createQueryPages(options: QueryPagesOptions): Hono {
  const { surrealFactory, settingsService } = options;
  const routes = new Hono();

  // GET / - Show query form
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const csrfToken = getCsrfToken(c);

    // Get query from query string (for pre-filling after POST)
    const lastQuery = c.req.query("query") ?? "";
    const lastResult = c.req.query("result") ?? "";

    const content = `
      <h1>SurrealDB Query</h1>
      ${flashMessages(success, error)}
      <form method="POST" action="/web/query">
        ${csrfInput(csrfToken)}
        <label>
          SurrealQL Query
          <textarea
            name="query"
            rows="10"
            placeholder="SELECT * FROM setting LIMIT 10;"
            style="font-family: monospace;"
          >${escapeHtml(lastQuery)}</textarea>
        </label>
        <button type="submit">Execute Query</button>
      </form>
      ${lastResult ? `
        <h2>Result</h2>
        <pre style="background: var(--pico-card-background-color); padding: 1rem; overflow-x: auto; border-radius: var(--pico-border-radius);"><code>${escapeHtml(lastResult)}</code></pre>
      ` : ""}
    `;

    return c.html(await layout("SurrealDB Query", content, getLayoutUser(c), settingsService));
  });

  // POST / - Execute query
  routes.post("/", async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect("/web/query?error=" + encodeURIComponent("Invalid form data"));
    }

    const query = formData.get("query")?.toString() ?? "";

    if (!query.trim()) {
      return c.redirect("/web/query?error=" + encodeURIComponent("Query cannot be empty"));
    }

    try {
      const result = await surrealFactory.withSystemConnection({}, async (db) => {
        return await db.query(query);
      });

      const resultJson = JSON.stringify(result, null, 2);

      // Redirect back to GET with results (using POST-redirect-GET pattern)
      // Note: For very large results, this might hit URL length limits
      const params = new URLSearchParams({
        query: query,
        result: resultJson,
      });

      return c.redirect("/web/query?" + params.toString());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const params = new URLSearchParams({
        query: query,
        error: errorMessage,
      });
      return c.redirect("/web/query?" + params.toString());
    }
  });

  return routes;
}
