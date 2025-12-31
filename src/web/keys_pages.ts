import { Hono } from "@hono/hono";
import type { ApiKeyService, ApiKey } from "../keys/api_key_service.ts";
import { validateKeyName, validateKeyValue } from "../keys/api_key_service.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
} from "./templates.ts";

export function createKeysPages(apiKeyService: ApiKeyService): Hono {
  const routes = new Hono();

  // List all keys grouped by name
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const allKeys = await apiKeyService.getAll();

    // Sort key names
    const sortedNames = [...allKeys.keys()].sort();

    const content = `
      <h1>API Keys</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/keys/create", "Create New Key")}
      </p>
      ${
        sortedNames.length === 0
          ? "<p>No API keys found.</p>"
          : sortedNames
              .map((name) => {
                const keys = allKeys.get(name)!;
                return `
              <article class="key-group">
                <header>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong>${escapeHtml(name)}</strong>
                    <div>
                      <a href="/web/keys/create?name=${encodeURIComponent(name)}" role="button" class="outline" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Add Key</a>
                      ${
                        name !== "management"
                          ? `<a href="/web/keys/delete?name=${encodeURIComponent(name)}" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Delete All</a>`
                          : ""
                      }
                    </div>
                  </div>
                </header>
                <table>
                  <thead>
                    <tr>
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
                        <td><code>${escapeHtml(key.value)}</code></td>
                        <td>${key.description ? escapeHtml(key.description) : "<em>none</em>"}</td>
                        <td class="actions">
                          ${
                            key.description === "from environment"
                              ? "<em>env</em>"
                              : `<a href="/web/keys/delete?name=${encodeURIComponent(name)}&value=${encodeURIComponent(key.value)}">Delete</a>`
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
    const name = c.req.query("name") ?? "";
    const error = c.req.query("error");

    const content = `
      <h1>Create API Key</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/keys/create">
        <label>
          Key Name
          <input type="text" name="name" value="${escapeHtml(name)}"
                 ${name ? "readonly" : "required"} placeholder="my-api-key"
                 pattern="[a-z0-9_-]+">
          <small>Lowercase letters, numbers, dashes, and underscores only${name ? " (pre-filled)" : ""}</small>
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
    let body: { name?: string; value?: string; description?: string };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect("/web/keys/create?error=" + encodeURIComponent("Invalid form data"));
    }

    const name = (body.name as string | undefined)?.trim().toLowerCase() ?? "";
    const value = (body.value as string | undefined)?.trim() ?? "";
    const description = (body.description as string | undefined)?.trim() || undefined;

    if (!name) {
      return c.redirect("/web/keys/create?error=" + encodeURIComponent("Key name is required"));
    }

    if (!validateKeyName(name)) {
      return c.redirect(
        `/web/keys/create?name=${encodeURIComponent(name)}&error=` +
          encodeURIComponent("Invalid key name format (use lowercase a-z, 0-9, -, _)")
      );
    }

    if (!value) {
      return c.redirect(
        `/web/keys/create?name=${encodeURIComponent(name)}&error=` +
          encodeURIComponent("Key value is required")
      );
    }

    if (!validateKeyValue(value)) {
      return c.redirect(
        `/web/keys/create?name=${encodeURIComponent(name)}&error=` +
          encodeURIComponent("Invalid key value format (use a-z, A-Z, 0-9, -, _)")
      );
    }

    try {
      await apiKeyService.addKey(name, value, description);
      return c.redirect("/web/keys?success=" + encodeURIComponent(`Key created for: ${name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create key";
      return c.redirect(
        `/web/keys/create?name=${encodeURIComponent(name)}&error=` + encodeURIComponent(message)
      );
    }
  });

  // Delete confirmation
  routes.get("/delete", async (c) => {
    const name = c.req.query("name");
    const value = c.req.query("value");

    if (!name) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key name specified"));
    }

    const keys = await apiKeyService.getKeys(name);
    if (!keys) {
      return c.redirect("/web/keys?error=" + encodeURIComponent(`Key name not found: ${name}`));
    }

    if (value) {
      // Delete specific key
      const key = keys.find((k) => k.value === value);
      if (!key) {
        return c.redirect("/web/keys?error=" + encodeURIComponent(`Key value not found for: ${name}`));
      }

      if (key.description === "from environment") {
        return c.redirect(
          "/web/keys?error=" + encodeURIComponent("Cannot delete environment-provided management key")
        );
      }

      return c.html(
        confirmPage(
          "Delete API Key",
          `Are you sure you want to delete the key "${value}" from "${name}"? This action cannot be undone.`,
          `/web/keys/delete?name=${encodeURIComponent(name)}&value=${encodeURIComponent(value)}`,
          "/web/keys"
        )
      );
    } else {
      // Delete all keys for name
      if (name.toLowerCase() === "management") {
        return c.redirect(
          "/web/keys?error=" + encodeURIComponent("Cannot delete all management keys")
        );
      }

      return c.html(
        confirmPage(
          "Delete All Keys",
          `Are you sure you want to delete ALL keys for "${name}"? This will remove ${keys.length} key(s). This action cannot be undone.`,
          `/web/keys/delete?name=${encodeURIComponent(name)}`,
          "/web/keys"
        )
      );
    }
  });

  // Handle delete
  routes.post("/delete", async (c) => {
    const name = c.req.query("name");
    const value = c.req.query("value");

    if (!name) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key name specified"));
    }

    try {
      if (value) {
        // Delete specific key
        await apiKeyService.removeKey(name, value);
        return c.redirect(
          "/web/keys?success=" + encodeURIComponent(`Key deleted from: ${name}`)
        );
      } else {
        // Delete all keys for name
        if (name.toLowerCase() === "management") {
          return c.redirect(
            "/web/keys?error=" + encodeURIComponent("Cannot delete all management keys")
          );
        }
        await apiKeyService.removeName(name);
        return c.redirect(
          "/web/keys?success=" + encodeURIComponent(`All keys deleted for: ${name}`)
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete key";
      return c.redirect("/web/keys?error=" + encodeURIComponent(message));
    }
  });

  return routes;
}
