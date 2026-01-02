import { Hono } from "@hono/hono";
import type { RoutesService, FunctionRoute, NewFunctionRoute } from "../routes/routes_service.ts";
import {
  validateRouteName,
  validateRoutePath,
  validateMethods,
} from "../routes/routes_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ConsoleLog } from "../logs/types.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
} from "./templates.ts";

const ALL_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

function renderMethodBadges(methods: string[]): string {
  return methods
    .map((m) => `<span class="method-badge">${escapeHtml(m)}</span>`)
    .join(" ");
}

function renderLogLevelBadge(level: string): string {
  const levelColors: Record<string, string> = {
    error: "color: #dc3545;",
    warn: "color: #fd7e14;",
    log: "color: #6c757d;",
    debug: "color: #6c757d;",
    info: "color: #17a2b8;",
    trace: "color: #adb5bd;",
    exec_start: "color: #28a745;",
    exec_end: "color: #28a745;",
    exec_reject: "color: #dc3545;",
  };
  const style = levelColors[level] ?? "";
  return `<span style="font-weight: bold; ${style}">${escapeHtml(level.toUpperCase())}</span>`;
}

function formatTimeShort(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function formatTimestampFull(date: Date): string {
  return date.toISOString().replace("T", " ").substring(0, 23);
}

function renderLogsPage(functionName: string, routeId: number, logs: ConsoleLog[]): string {
  const logsTableStyles = `
    <style>
      .logs-table { font-size: 0.85em; }
      .logs-table th, .logs-table td { padding: 0.4em 0.6em; }
      .logs-table th:nth-child(1), .logs-table td:nth-child(1) { width: 1%; white-space: nowrap; }
      .logs-table th:nth-child(2), .logs-table td:nth-child(2) { width: 1%; white-space: nowrap; }
      .logs-table th:nth-child(3), .logs-table td:nth-child(3) { width: 1%; white-space: nowrap; }
      .logs-table th:nth-child(4), .logs-table td:nth-child(4) { width: auto; }
      .logs-table .log-message { font-family: monospace; word-break: break-word; }
      .logs-table .log-row { cursor: pointer; }
      .logs-table .log-row:hover { background: rgba(0,0,0,0.05); }
      .logs-table .log-detail { display: none; }
      .logs-table .log-detail.expanded { display: table-row; }
      .logs-table .log-detail td { padding: 0.8em; background: #1a1a2e; }
      .logs-table .log-detail pre {
        margin: 0;
        padding: 1em;
        background: #0d0d1a;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.95em;
        color: #e0e0e0;
      }
      .request-id-copy {
        cursor: pointer;
        text-decoration: underline dotted;
      }
      .request-id-copy:hover { color: #17a2b8; }
    </style>
  `;

  const logsTableScript = `
    <script>
      function toggleLogDetail(rowId) {
        const detail = document.getElementById('detail-' + rowId);
        if (detail) {
          detail.classList.toggle('expanded');
        }
      }
      function copyRequestId(event, fullId) {
        event.stopPropagation();
        navigator.clipboard.writeText(fullId).then(() => {
          const el = event.target;
          const original = el.textContent;
          el.textContent = 'copied!';
          setTimeout(() => { el.textContent = original; }, 1000);
        });
      }
    </script>
  `;

  return `
    ${logsTableStyles}
    <h1>Logs: ${escapeHtml(functionName)}</h1>
    <div class="grid" style="margin-bottom: 1rem;">
      <div>
        <a href="/web/functions" role="button" class="secondary outline">&larr; Back to Functions</a>
      </div>
      <div style="text-align: right;">
        <a href="/web/functions/logs/${routeId}" role="button" class="outline">Refresh</a>
      </div>
    </div>
    ${
      logs.length === 0
        ? "<p><em>No logs recorded for this function.</em></p>"
        : `
      <p style="color: #6c757d;">Showing ${logs.length} most recent log${logs.length === 1 ? "" : "s"}. Click a row to expand.</p>
      <table class="logs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Req ID</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${logs
            .map(
              (log, i) => {
                const fullMessage = log.args
                  ? `${log.message}\n\nArgs: ${log.args}`
                  : log.message;
                const requestIdShort = log.requestId.slice(-5);
                return `
            <tr class="log-row" onclick="toggleLogDetail(${i})">
              <td><code title="${escapeHtml(formatTimestampFull(log.timestamp))}">${formatTimeShort(log.timestamp)}</code></td>
              <td>${renderLogLevelBadge(log.level)}</td>
              <td><code class="request-id-copy" title="Click to copy: ${escapeHtml(log.requestId)}" onclick="copyRequestId(event, '${escapeHtml(log.requestId)}')">${escapeHtml(requestIdShort)}</code></td>
              <td class="log-message">${escapeHtml(log.message).substring(0, 120)}${log.message.length > 120 ? "..." : ""}</td>
            </tr>
            <tr id="detail-${i}" class="log-detail">
              <td colspan="4"><pre>${escapeHtml(fullMessage)}</pre></td>
            </tr>
          `;
              }
            )
            .join("")}
        </tbody>
      </table>
      ${logsTableScript}
    `
    }
  `;
}

function renderFunctionForm(
  action: string,
  route: Partial<FunctionRoute> = {},
  error?: string
): string {
  const isEdit = !!route.name;

  return `
    <h1>${isEdit ? "Edit" : "Create"} Function</h1>
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="${escapeHtml(action)}">
      <label>
        Name
        <input type="text" name="name" value="${escapeHtml(route.name ?? "")}"
               ${isEdit ? "readonly" : "required"} placeholder="my-function">
        <small>Unique identifier for this function${isEdit ? " (cannot be changed)" : ""}</small>
      </label>
      <label>
        Description
        <textarea name="description" rows="2" placeholder="Optional description">${escapeHtml(route.description ?? "")}</textarea>
      </label>
      <label>
        Handler Path
        <input type="text" name="handler" value="${escapeHtml(route.handler ?? "")}"
               required placeholder="handlers/my-function.ts">
        <small>Path to the TypeScript handler file in the code directory</small>
      </label>
      <label>
        Route Path
        <input type="text" name="route" value="${escapeHtml(route.route ?? "")}"
               required placeholder="/api/users/:id">
        <small>URL path pattern (must start with /)</small>
      </label>
      <fieldset>
        <legend>HTTP Methods</legend>
        ${ALL_METHODS.map(
          (method) => `
          <label>
            <input type="checkbox" name="methods" value="${method}"
                   ${(route.methods ?? []).includes(method) ? "checked" : ""}>
            ${method}
          </label>
        `
        ).join("")}
      </fieldset>
      <label>
        Required API Keys
        <input type="text" name="keys" value="${escapeHtml((route.keys ?? []).join(", "))}"
               placeholder="api-key, admin-key">
        <small>Comma-separated list of key names required to access this function (optional)</small>
      </label>
      <div class="grid">
        <button type="submit">${isEdit ? "Save Changes" : "Create Function"}</button>
        <a href="/web/functions" role="button" class="secondary">Cancel</a>
      </div>
    </form>
  `;
}

function parseFormData(formData: FormData): {
  route: NewFunctionRoute;
  errors: string[];
} {
  const errors: string[] = [];

  const name = formData.get("name")?.toString().trim() ?? "";
  const description = formData.get("description")?.toString().trim() || undefined;
  const handler = formData.get("handler")?.toString().trim() ?? "";
  const routePath = formData.get("route")?.toString().trim() ?? "";
  const keysStr = formData.get("keys")?.toString().trim() ?? "";

  // Handle methods - use getAll for multiple checkbox values
  const methods = formData.getAll("methods").map((m) => m.toString());

  // Validation
  if (!validateRouteName(name)) {
    errors.push("Name is required");
  }

  if (!handler) {
    errors.push("Handler path is required");
  }

  if (!validateRoutePath(routePath)) {
    errors.push("Route path must start with / and not contain //");
  }

  if (!validateMethods(methods)) {
    errors.push("At least one valid HTTP method must be selected");
  }

  // Parse keys
  const keys = keysStr
    ? keysStr.split(",").map((k) => k.trim()).filter((k) => k.length > 0)
    : undefined;

  const route: NewFunctionRoute = {
    name,
    description,
    handler,
    route: routePath,
    methods,
    keys,
  };

  return { route, errors };
}

export function createFunctionsPages(
  routesService: RoutesService,
  consoleLogService: ConsoleLogService
): Hono {
  const routes = new Hono();

  // List all functions
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const allRoutes = await routesService.getAll();

    const content = `
      <h1>Functions</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/functions/create", "Create New Function")}
      </p>
      ${
        allRoutes.length === 0
          ? "<p>No functions registered.</p>"
          : `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Route</th>
              <th>Methods</th>
              <th>Keys</th>
              <th>Description</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${allRoutes
              .map(
                (fn) => `
              <tr>
                <td><strong>${escapeHtml(fn.name)}</strong></td>
                <td><code>${escapeHtml(fn.route)}</code></td>
                <td><div class="methods">${renderMethodBadges(fn.methods)}</div></td>
                <td>${fn.keys ? escapeHtml(fn.keys.join(", ")) : "<em>none</em>"}</td>
                <td>${fn.description ? escapeHtml(fn.description) : ""}</td>
                <td class="actions">
                  <a href="/web/functions/logs/${fn.id}">Logs</a>
                  <a href="/web/functions/edit?name=${encodeURIComponent(fn.name)}">Edit</a>
                  <a href="/web/functions/delete?name=${encodeURIComponent(fn.name)}">Delete</a>
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      `
      }
    `;
    return c.html(layout("Functions", content));
  });

  // Create form
  routes.get("/create", (c) => {
    const error = c.req.query("error");
    return c.html(layout("Create Function", renderFunctionForm("/web/functions/create", {}, error)));
  });

  // Handle create
  routes.post("/create", async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect("/web/functions/create?error=" + encodeURIComponent("Invalid form data"));
    }

    const { route, errors } = parseFormData(formData);

    if (errors.length > 0) {
      return c.html(
        layout("Create Function", renderFunctionForm("/web/functions/create", route, errors.join(". "))),
        400
      );
    }

    try {
      await routesService.addRoute(route);
      return c.redirect("/web/functions?success=" + encodeURIComponent(`Function created: ${route.name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create function";
      return c.html(
        layout("Create Function", renderFunctionForm("/web/functions/create", route, message)),
        400
      );
    }
  });

  // Edit form
  routes.get("/edit", async (c) => {
    const name = c.req.query("name");
    const error = c.req.query("error");

    if (!name) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("No function name specified"));
    }

    const route = await routesService.getByName(name);
    if (!route) {
      return c.redirect("/web/functions?error=" + encodeURIComponent(`Function not found: ${name}`));
    }

    return c.html(
      layout(
        `Edit: ${name}`,
        renderFunctionForm(`/web/functions/edit?name=${encodeURIComponent(name)}`, route, error)
      )
    );
  });

  // Handle edit (delete + create)
  routes.post("/edit", async (c) => {
    const originalName = c.req.query("name");

    if (!originalName) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("No function name specified"));
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/functions/edit?name=${encodeURIComponent(originalName)}&error=` +
          encodeURIComponent("Invalid form data")
      );
    }

    const { route, errors } = parseFormData(formData);
    // Use original name for edits
    route.name = originalName;

    if (errors.length > 0) {
      return c.html(
        layout(
          `Edit: ${originalName}`,
          renderFunctionForm(
            `/web/functions/edit?name=${encodeURIComponent(originalName)}`,
            route,
            errors.join(". ")
          )
        ),
        400
      );
    }

    try {
      // Delete old route first
      await routesService.removeRoute(originalName);
      // Create new route
      await routesService.addRoute(route);
      return c.redirect("/web/functions?success=" + encodeURIComponent(`Function updated: ${route.name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update function";
      return c.html(
        layout(
          `Edit: ${originalName}`,
          renderFunctionForm(
            `/web/functions/edit?name=${encodeURIComponent(originalName)}`,
            route,
            message
          )
        ),
        400
      );
    }
  });

  // Delete confirmation
  routes.get("/delete", async (c) => {
    const name = c.req.query("name");

    if (!name) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("No function name specified"));
    }

    const route = await routesService.getByName(name);
    if (!route) {
      return c.redirect("/web/functions?error=" + encodeURIComponent(`Function not found: ${name}`));
    }

    return c.html(
      confirmPage(
        "Delete Function",
        `Are you sure you want to delete the function "${name}"? This action cannot be undone.`,
        `/web/functions/delete?name=${encodeURIComponent(name)}`,
        "/web/functions"
      )
    );
  });

  // Handle delete
  routes.post("/delete", async (c) => {
    const name = c.req.query("name");

    if (!name) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("No function name specified"));
    }

    try {
      await routesService.removeRoute(name);
      return c.redirect("/web/functions?success=" + encodeURIComponent(`Function deleted: ${name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete function";
      return c.redirect("/web/functions?error=" + encodeURIComponent(message));
    }
  });

  // View logs for a function
  routes.get("/logs/:id", async (c) => {
    const idStr = c.req.param("id");
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Invalid function ID"));
    }

    const route = await routesService.getById(id);
    if (!route) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Function not found"));
    }

    // Get last 200 logs, newest first
    const logs = await consoleLogService.getByRouteId(id, 200);
    logs.reverse(); // getByRouteId returns oldest first, we want newest first

    const content = renderLogsPage(route.name, id, logs);
    return c.html(layout(`Logs: ${route.name}`, content));
  });

  return routes;
}
