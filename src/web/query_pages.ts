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

      <style>
        /* CodeMirror integration with Pico CSS */
        .cm-editor {
          border: 1px solid var(--pico-form-element-border-color);
          border-radius: var(--pico-border-radius);
          background: var(--pico-form-element-background-color);
          font-size: 0.9rem;
        }
        .cm-editor.cm-focused {
          outline: none;
          border-color: var(--pico-form-element-active-border-color);
        }
        .cm-scroller {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
          overflow: auto;
        }
        .cm-gutters {
          background: var(--pico-card-background-color);
          border-right: 1px solid var(--pico-muted-border-color);
        }
        .cm-activeLineGutter, .cm-activeLine {
          background: rgba(128, 128, 128, 0.1);
        }
        .cm-selectionBackground {
          background: rgba(128, 128, 128, 0.2) !important;
        }
        #query-editor .cm-editor {
          min-height: 200px;
          max-height: 400px;
        }
        #result-editor .cm-editor {
          min-height: 100px;
          max-height: 500px;
        }
        .query-error {
          padding: 1rem;
          margin-top: 1rem;
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
          border-radius: var(--pico-border-radius);
          font-family: ui-monospace, SFMono-Regular, monospace;
          white-space: pre-wrap;
          word-break: break-word;
        }
        [data-theme="dark"] .query-error {
          background: #4a1f24;
          color: #f8d7da;
          border-color: #6b2c32;
        }
        .keyboard-hint {
          font-size: 0.85rem;
          color: var(--pico-muted-color);
          margin-top: 0.5rem;
        }
        .keyboard-hint kbd {
          background: var(--pico-card-background-color);
          color: var(--pico-color);
          border: 1px solid var(--pico-muted-border-color);
          border-radius: 3px;
          padding: 0.1rem 0.4rem;
          font-family: inherit;
          font-size: 0.85em;
        }
        /* Autocomplete tooltip styling */
        .cm-tooltip-autocomplete {
          background: var(--pico-card-background-color) !important;
          border: 1px solid var(--pico-muted-border-color) !important;
          border-radius: var(--pico-border-radius);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }
        .cm-tooltip-autocomplete ul {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 0.9rem;
        }
        .cm-tooltip-autocomplete li {
          padding: 0.25rem 0.5rem;
        }
        .cm-tooltip-autocomplete li[aria-selected] {
          background: var(--pico-primary-background) !important;
          color: var(--pico-primary-inverse) !important;
        }
        .cm-completionIcon {
          opacity: 0.7;
          padding-right: 0.5rem;
        }
      </style>

      <h1>SurrealDB Query</h1>
      <div id="flash-container"></div>
      <form id="query-form">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <label>SurrealQL Query</label>
        <div id="query-editor"></div>
        <p class="keyboard-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to execute</p>
        <button type="submit" id="submit-btn" style="margin-top: 0.5rem;">Execute Query</button>
      </form>
      <div id="result-container">
        <h2 id="result-header" style="display: none;">Result</h2>
        <div id="result-editor"></div>
        <div id="error-display" class="query-error" style="display: none;"></div>
      </div>

      <script type="module">
        import {
          basicSetup,
          EditorView,
          json,
          surrealql,
          autocompletion,
          surqlCompletionSource
        } from "/static/vendor/codemirror-surrealql.js";

        // Create query editor (editable) with autocompletion
        const queryEditor = new EditorView({
          doc: "SELECT * FROM setting LIMIT 10;",
          extensions: [
            basicSetup,
            surrealql(),
            autocompletion({ override: [surqlCompletionSource] }),
            EditorView.lineWrapping,
          ],
          parent: document.getElementById("query-editor"),
        });

        // Result editor reference
        let resultEditor = null;

        function showResult(jsonText) {
          const header = document.getElementById("result-header");
          const container = document.getElementById("result-editor");
          const errorDisplay = document.getElementById("error-display");

          header.style.display = "block";
          errorDisplay.style.display = "none";

          if (resultEditor) {
            resultEditor.destroy();
          }

          resultEditor = new EditorView({
            doc: jsonText,
            extensions: [
              basicSetup,
              json(),
              EditorView.lineWrapping,
              EditorView.editable.of(false),
            ],
            parent: container,
          });
        }

        function showError(errorMessage) {
          const header = document.getElementById("result-header");
          const container = document.getElementById("result-editor");
          const errorDisplay = document.getElementById("error-display");

          header.style.display = "none";

          if (resultEditor) {
            resultEditor.destroy();
            resultEditor = null;
          }
          container.innerHTML = "";

          errorDisplay.textContent = errorMessage;
          errorDisplay.style.display = "block";
        }

        // Form handling
        const form = document.getElementById("query-form");
        const submitBtn = document.getElementById("submit-btn");
        const flashContainer = document.getElementById("flash-container");

        async function executeQuery() {
          const query = queryEditor.state.doc.toString().trim();
          if (!query) {
            showFlash("Query cannot be empty", "error");
            return;
          }

          submitBtn.disabled = true;
          submitBtn.setAttribute("aria-busy", "true");
          submitBtn.textContent = "Executing...";
          flashContainer.innerHTML = "";

          try {
            const csrfToken = form.querySelector('input[name="_csrf"]').value;
            const response = await fetch("/web/query", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken,
              },
              body: JSON.stringify({ query }),
            });

            const data = await response.json();

            if (data.success) {
              showResult(data.result);
            } else {
              showError(data.error || "Unknown error");
            }
          } catch (err) {
            showError("Request failed: " + err.message);
          } finally {
            submitBtn.disabled = false;
            submitBtn.removeAttribute("aria-busy");
            submitBtn.textContent = "Execute Query";
          }
        }

        form.addEventListener("submit", (e) => {
          e.preventDefault();
          executeQuery();
        });

        // Ctrl/Cmd+Enter shortcut
        queryEditor.dom.addEventListener("keydown", (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            executeQuery();
          }
        });

        function showFlash(message, type) {
          const className = type === "error" ? "pico-background-red-500" : "pico-background-green-500";
          flashContainer.innerHTML = \`
            <article class="\${className}" style="margin-bottom: 1rem; padding: 0.75rem 1rem;">
              \${escapeHtml(message)}
            </article>
          \`;
        }

        function escapeHtml(text) {
          const div = document.createElement("div");
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
