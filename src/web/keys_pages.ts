import { Hono } from "@hono/hono";
import type { ApiKeyService, ApiKey } from "../keys/api_key_service.ts";
import { validateKeyGroup, validateKeyValue } from "../keys/api_key_service.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
} from "./templates.ts";

export function createKeysPages(apiKeyService: ApiKeyService): Hono {
  const routes = new Hono();

  // List all keys grouped by group
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const allKeys = await apiKeyService.getAll();

    // Sort key groups
    const sortedGroups = [...allKeys.keys()].sort();

    const content = `
      <h1>API Keys</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/keys/create", "Create New Key")}
      </p>
      ${
        sortedGroups.length === 0
          ? "<p>No API keys found.</p>"
          : sortedGroups
              .map((group) => {
                const keys = allKeys.get(group)!;
                return `
              <article class="key-group">
                <header>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong>${escapeHtml(group)}</strong>
                    <div>
                      <a href="/web/keys/create?group=${encodeURIComponent(group)}" role="button" class="outline" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Add Key</a>
                      ${
                        group !== "management"
                          ? `<a href="/web/keys/delete-group?group=${encodeURIComponent(group)}" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Delete All</a>`
                          : ""
                      }
                    </div>
                  </div>
                </header>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Value</th>
                      <th>Description</th>
                      <th class="actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${keys
                      .map(
                        (key) => `
                      <tr>
                        <td><code>${key.id === -1 ? "env" : key.id}</code></td>
                        <td><code>${escapeHtml(key.value)}</code></td>
                        <td>${key.description ? escapeHtml(key.description) : "<em>none</em>"}</td>
                        <td class="actions">
                          ${
                            key.id === -1
                              ? "<em>env</em>"
                              : `<a href="/web/keys/delete?id=${key.id}">Delete</a>`
                          }
                        </td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
              </article>
            `;
              })
              .join("")
      }
    `;
    return c.html(layout("API Keys", content));
  });

  // Create key form
  routes.get("/create", (c) => {
    const group = c.req.query("group") ?? "";
    const error = c.req.query("error");

    const content = `
      <h1>Create API Key</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/keys/create">
        <label>
          Key Group
          <input type="text" name="group" value="${escapeHtml(group)}"
                 ${group ? "readonly" : "required"} placeholder="my-api-key"
                 pattern="[a-z0-9_-]+">
          <small>Lowercase letters, numbers, dashes, and underscores only${group ? " (pre-filled)" : ""}</small>
        </label>
        <label>
          Key Value
          <input type="text" name="value" required placeholder="your-secret-key-value"
                 pattern="[a-zA-Z0-9_-]+">
          <small>Letters, numbers, dashes, and underscores only</small>
        </label>
        <label>
          Description
          <input type="text" name="description" placeholder="Optional description">
        </label>
        <div class="grid">
          <button type="submit">Create Key</button>
          <a href="/web/keys" role="button" class="secondary">Cancel</a>
        </div>
      </form>
    `;
    return c.html(layout("Create API Key", content));
  });

  // Handle create
  routes.post("/create", async (c) => {
    let body: { group?: string; value?: string; description?: string };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect("/web/keys/create?error=" + encodeURIComponent("Invalid form data"));
    }

    const group = (body.group as string | undefined)?.trim().toLowerCase() ?? "";
    const value = (body.value as string | undefined)?.trim() ?? "";
    const description = (body.description as string | undefined)?.trim() || undefined;

    if (!group) {
      return c.redirect("/web/keys/create?error=" + encodeURIComponent("Key group is required"));
    }

    if (!validateKeyGroup(group)) {
      return c.redirect(
        `/web/keys/create?group=${encodeURIComponent(group)}&error=` +
          encodeURIComponent("Invalid key group format (use lowercase a-z, 0-9, -, _)")
      );
    }

    if (!value) {
      return c.redirect(
        `/web/keys/create?group=${encodeURIComponent(group)}&error=` +
          encodeURIComponent("Key value is required")
      );
    }

    if (!validateKeyValue(value)) {
      return c.redirect(
        `/web/keys/create?group=${encodeURIComponent(group)}&error=` +
          encodeURIComponent("Invalid key value format (use a-z, A-Z, 0-9, -, _)")
      );
    }

    try {
      await apiKeyService.addKey(group, value, description);
      return c.redirect("/web/keys?success=" + encodeURIComponent(`Key created for group: ${group}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create key";
      return c.redirect(
        `/web/keys/create?group=${encodeURIComponent(group)}&error=` + encodeURIComponent(message)
      );
    }
  });

  // Delete key by ID confirmation
  routes.get("/delete", async (c) => {
    const idStr = c.req.query("id");

    if (!idStr) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key ID specified"));
    }

    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Invalid key ID"));
    }

    if (id === -1) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Cannot delete environment-provided management key")
      );
    }

    return c.html(
      confirmPage(
        "Delete API Key",
        `Are you sure you want to delete the key with ID ${id}? This action cannot be undone.`,
        `/web/keys/delete?id=${id}`,
        "/web/keys"
      )
    );
  });

  // Handle delete by ID
  routes.post("/delete", async (c) => {
    const idStr = c.req.query("id");

    if (!idStr) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key ID specified"));
    }

    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Invalid key ID"));
    }

    try {
      await apiKeyService.removeKeyById(id);
      return c.redirect("/web/keys?success=" + encodeURIComponent("Key deleted successfully"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete key";
      return c.redirect("/web/keys?error=" + encodeURIComponent(message));
    }
  });

  // Delete group confirmation
  routes.get("/delete-group", async (c) => {
    const group = c.req.query("group");

    if (!group) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key group specified"));
    }

    const keys = await apiKeyService.getKeys(group);
    if (!keys) {
      return c.redirect("/web/keys?error=" + encodeURIComponent(`Key group not found: ${group}`));
    }

    if (group.toLowerCase() === "management") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Cannot delete all management keys")
      );
    }

    return c.html(
      confirmPage(
        "Delete All Keys",
        `Are you sure you want to delete ALL keys for group "${group}"? This will remove ${keys.length} key(s). This action cannot be undone.`,
        `/web/keys/delete-group?group=${encodeURIComponent(group)}`,
        "/web/keys"
      )
    );
  });

  // Handle delete group
  routes.post("/delete-group", async (c) => {
    const group = c.req.query("group");

    if (!group) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key group specified"));
    }

    if (group.toLowerCase() === "management") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Cannot delete all management keys")
      );
    }

    try {
      await apiKeyService.removeGroup(group);
      return c.redirect(
        "/web/keys?success=" + encodeURIComponent(`All keys deleted for group: ${group}`)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete keys";
      return c.redirect("/web/keys?error=" + encodeURIComponent(message));
    }
  });

  return routes;
}
