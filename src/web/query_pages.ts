import { Hono } from "@hono/hono";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { ErrorStateService } from "../errors/mod.ts";
import {
  layout,
  getLayoutUser,
  getCsrfToken,
} from "./templates.ts";

/**
 * Options for creating the query pages router.
 */
export interface QueryPagesOptions {
  surrealFactory: SurrealConnectionFactory;
  settingsService: SettingsService;
  errorStateService: ErrorStateService;
}

/**
 * Creates the SurrealDB query page router.
 *
 * Provides a simple interface to execute raw SurrealQL queries
 * and view the JSON response. Intended for debugging and admin use.
 */
export function createQueryPages(options: QueryPagesOptions): Hono {
  const { surrealFactory, settingsService, errorStateService } = options;
  const routes = new Hono();

  // GET / - Show query form
  routes.get("/", async (c) => {
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>SurrealDB Query</h1>
      <div id="flash-container"></div>
      <form id="query-form">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <label>
          SurrealQL Query
          <textarea
            id="query-input"
            name="query"
            rows="10"
            placeholder="SELECT * FROM setting LIMIT 10;"
            style="font-family: monospace;"
          ></textarea>
        </label>
        <button type="submit" id="submit-btn">Execute Query</button>
      </form>
      <div id="result-container"></div>

      <script>
        const form = document.getElementById('query-form');
        const queryInput = document.getElementById('query-input');
        const submitBtn = document.getElementById('submit-btn');
        const resultContainer = document.getElementById('result-container');
        const flashContainer = document.getElementById('flash-container');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          const query = queryInput.value.trim();
          if (!query) {
            showFlash('Query cannot be empty', 'error');
            return;
          }

          submitBtn.disabled = true;
          submitBtn.setAttribute('aria-busy', 'true');
          submitBtn.textContent = 'Executing...';
          flashContainer.innerHTML = '';

          try {
            const csrfToken = form.querySelector('input[name="_csrf"]').value;
            const response = await fetch('/web/query', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
              },
              body: JSON.stringify({ query }),
            });

            const data = await response.json();

            if (data.success) {
              resultContainer.innerHTML = \`
                <h2>Result</h2>
                <pre style="background: var(--pico-card-background-color); padding: 1rem; overflow-x: auto; border-radius: var(--pico-border-radius);"><code>\${escapeHtml(data.result)}</code></pre>
              \`;
            } else {
              showFlash(data.error || 'Unknown error', 'error');
              resultContainer.innerHTML = '';
            }
          } catch (err) {
            showFlash('Request failed: ' + err.message, 'error');
            resultContainer.innerHTML = '';
          } finally {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-busy');
            submitBtn.textContent = 'Execute Query';
          }
        });

        function showFlash(message, type) {
          const className = type === 'error' ? 'pico-background-red-500' : 'pico-background-green-500';
          flashContainer.innerHTML = \`
            <article class="\${className}" style="margin-bottom: 1rem; padding: 0.75rem 1rem;">
              \${escapeHtml(message)}
            </article>
          \`;
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }
      </script>
    `;

    return c.html(await layout({
      title: "SurrealDB Query",
      content,
      user: getLayoutUser(c),
      settingsService,
      errorStateService,
    }));
  });

  // POST / - Execute query (JSON API)
  routes.post("/", async (c) => {
    let body: { query?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const query = body.query?.trim() ?? "";

    if (!query) {
      return c.json({ success: false, error: "Query cannot be empty" }, 400);
    }

    try {
      const result = await surrealFactory.withSystemConnection({}, async (db) => {
        return await db.query(query);
      });

      const resultJson = JSON.stringify(result, null, 2);
      return c.json({ success: true, result: resultJson });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, error: errorMessage }, 400);
    }
  });

  return routes;
}
