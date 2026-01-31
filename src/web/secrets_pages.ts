import { Hono } from "@hono/hono";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { ErrorStateService } from "../errors/mod.ts";
import { SecretsService } from "../secrets/secrets_service.ts";
import type { Secret } from "../secrets/types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
  formatDate,
  getLayoutUser,
  getCsrfToken,
  secretScripts,
  parseSecretFormData,
  parseSecretEditFormData,
  generateValueButton,
  valueGeneratorScripts,
} from "./templates.ts";
import { csrfInput } from "../csrf/csrf_helpers.ts";

/**
 * Options for creating the secrets pages router.
 */
export interface SecretsPagesOptions {
  surrealFactory: SurrealConnectionFactory;
  encryptionService: IEncryptionService;
  settingsService: SettingsService;
  errorStateService: ErrorStateService;
}

/**
 * Creates the global secrets management page router.
 *
 * Provides CRUD operations for global-scope secrets with encryption.
 */
export function createSecretsPages(options: SecretsPagesOptions): Hono {
  const { surrealFactory, encryptionService, settingsService, errorStateService } = options;
  const routes = new Hono();

  // Initialize secrets service
  const secretsService = new SecretsService({ surrealFactory, encryptionService });

  // GET / - List all global secrets
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");

    // Load all secrets with decrypted values for show/hide functionality
    const secrets = await secretsService.getGlobalSecrets();

    const content = `
      <h1>Global Secrets</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/secrets/create", "Create New Secret")}
      </p>
      ${
        secrets.length === 0
          ? "<p>No global secrets configured. Create your first secret to get started.</p>"
          : `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th>Comment</th>
              <th>Created</th>
              <th>Modified</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${secrets
              .map(
                (secret: Secret) => {
                  const secretId = recordIdToString(secret.id);
                  return `
              <tr>
                <td><code>${escapeHtml(secret.name)}</code></td>
                <td class="secret-value">
                  ${
                    secret.decryptionError
                      ? `<span style="color: #d32f2f;" title="${escapeHtml(secret.decryptionError)}">⚠️ Decryption failed</span>`
                      : `
                    <span class="masked">••••••••</span>
                    <span class="revealed" style="display:none;">
                      <code>${escapeHtml(secret.value)}</code>
                    </span>
                    <button type="button" onclick="toggleSecret(this)"
                            class="secondary" style="padding: 0.25rem 0.5rem; margin-left: 0.5rem;">
                      👁️
                    </button>
                    <button type="button" onclick="copySecret(this, '${escapeHtml(secret.value).replace(/'/g, "\\'")}')"
                            class="secondary" style="padding: 0.25rem 0.5rem;">
                      📋
                    </button>
                  `
                  }
                </td>
                <td>${secret.comment ? escapeHtml(secret.comment) : "<em>—</em>"}</td>
                <td>${formatDate(new Date(secret.createdAt))}</td>
                <td>${formatDate(new Date(secret.updatedAt))}</td>
                <td class="actions">
                  ${secret.decryptionError ? "" : `<a href="/web/secrets/edit/${secretId}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>`}
                  <a href="/web/secrets/delete/${secretId}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
                </td>
              </tr>
            `;
                }
              )
              .join("")}
          </tbody>
        </table>

        ${secretScripts()}
      `
      }
    `;
    return c.html(await layout({ title: "Global Secrets", content, user: getLayoutUser(c), settingsService, errorStateService }));
  });

  // GET /create - Create secret form
  routes.get("/create", async (c) => {
    const error = c.req.query("error");
    const csrfToken = getCsrfToken(c);
    return c.html(
      await layout({
        title: "Create Secret",
        content: renderCreateForm("/web/secrets/create", {}, error, csrfToken),
        user: getLayoutUser(c),
        settingsService,
        errorStateService,
      })
    );
  });

  // POST /create - Handle secret creation
  routes.post("/create", async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        "/web/secrets/create?error=" + encodeURIComponent("Invalid form data")
      );
    }

    const { secretData, errors } = parseSecretFormData(formData);

    if (errors.length > 0) {
      const csrfToken = getCsrfToken(c);
      return c.html(
        await layout({
          title: "Create Secret",
          content: renderCreateForm("/web/secrets/create", secretData, errors.join(". "), csrfToken),
          user: getLayoutUser(c),
          settingsService,
          errorStateService,
        }),
        400
      );
    }

    try {
      await secretsService.createGlobalSecret(
        secretData.name,
        secretData.value,
        secretData.comment || undefined
      );

      return c.redirect(
        "/web/secrets?success=" +
          encodeURIComponent(`Secret created: ${secretData.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create secret";
      const csrfToken = getCsrfToken(c);
      return c.html(
        await layout({
          title: "Create Secret",
          content: renderCreateForm("/web/secrets/create", secretData, message, csrfToken),
          user: getLayoutUser(c),
          settingsService,
          errorStateService,
        }),
        400
      );
    }
  });

  // GET /edit/:id - Edit secret form
  routes.get("/edit/:id", async (c) => {
    const id = c.req.param("id");

    if (!id || id.trim() === "") {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Invalid secret ID")
      );
    }

    const error = c.req.query("error");
    const csrfToken = getCsrfToken(c);

    const secret = await secretsService.getGlobalSecretById(id);

    if (!secret) {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Secret not found")
      );
    }

    return c.html(
      await layout({
        title: `Edit: ${secret.name}`,
        content: renderEditForm(`/web/secrets/edit/${id}`, secret, error, csrfToken),
        user: getLayoutUser(c),
        settingsService,
        errorStateService,
      })
    );
  });

  // POST /edit/:id - Handle secret update
  routes.post("/edit/:id", async (c) => {
    const id = c.req.param("id");

    if (!id || id.trim() === "") {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Invalid secret ID")
      );
    }

    const secret = await secretsService.getGlobalSecretById(id);

    if (!secret) {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Secret not found")
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/secrets/edit/${id}?error=` +
          encodeURIComponent("Invalid form data")
      );
    }

    const { editData, errors } = parseSecretEditFormData(formData);

    if (errors.length > 0) {
      const csrfToken = getCsrfToken(c);
      return c.html(
        await layout({
          title: `Edit: ${secret.name}`,
          content: renderEditForm(
            `/web/secrets/edit/${id}`,
            { ...secret, ...editData },
            errors.join(". "),
            csrfToken
          ),
          user: getLayoutUser(c),
          settingsService,
          errorStateService,
        }),
        400
      );
    }

    try {
      await secretsService.updateGlobalSecret(
        id,
        editData.value,
        editData.comment || undefined
      );

      return c.redirect(
        "/web/secrets?success=" +
          encodeURIComponent(`Secret updated: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update secret";
      const csrfToken = getCsrfToken(c);
      return c.html(
        await layout({
          title: `Edit: ${secret.name}`,
          content: renderEditForm(
            `/web/secrets/edit/${id}`,
            { ...secret, ...editData },
            message,
            csrfToken
          ),
          user: getLayoutUser(c),
          settingsService,
          errorStateService,
        }),
        400
      );
    }
  });

  // GET /delete/:id - Delete confirmation
  routes.get("/delete/:id", async (c) => {
    const id = c.req.param("id");

    if (!id || id.trim() === "") {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Invalid secret ID")
      );
    }

    const secret = await secretsService.getGlobalSecretById(id);

    if (!secret) {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Secret not found")
      );
    }

    return c.html(
      await confirmPage({
        title: "Delete Secret",
        message: `Are you sure you want to delete the secret "<strong>${escapeHtml(secret.name)}</strong>"? This action cannot be undone.`,
        actionUrl: `/web/secrets/delete/${id}`,
        cancelUrl: "/web/secrets",
        user: getLayoutUser(c),
        settingsService,
        errorStateService,
        csrfToken: getCsrfToken(c),
      })
    );
  });

  // POST /delete/:id - Handle deletion
  routes.post("/delete/:id", async (c) => {
    const id = c.req.param("id");

    if (!id || id.trim() === "") {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Invalid secret ID")
      );
    }

    const secret = await secretsService.getGlobalSecretById(id);

    if (!secret) {
      return c.redirect(
        "/web/secrets?error=" + encodeURIComponent("Secret not found")
      );
    }

    try {
      await secretsService.deleteGlobalSecret(id);

      return c.redirect(
        "/web/secrets?success=" +
          encodeURIComponent(`Secret deleted: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete secret";
      return c.redirect("/web/secrets?error=" + encodeURIComponent(message));
    }
  });

  return routes;
}

/**
 * Renders the create secret form.
 */
function renderCreateForm(
  action: string,
  data: { name?: string; value?: string; comment?: string } = {},
  error?: string,
  csrfToken: string = ""
): string {
  return `
    <h1>Create Secret</h1>
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="${escapeHtml(action)}">
      ${csrfToken ? csrfInput(csrfToken) : ""}
      <label>
        Secret Name *
        <input type="text" name="name" value="${escapeHtml(data.name ?? "")}"
               required autofocus
               placeholder="MY_SECRET_KEY" />
        <small>Letters, numbers, underscores, and dashes only</small>
      </label>
      <label>
        Secret Value *
        <div style="display: flex; align-items: flex-start;">
          <textarea id="global-secret-value" name="value" required
                    placeholder="your-secret-value"
                    rows="4" style="flex: 1;">${escapeHtml(data.value ?? "")}</textarea>
          ${generateValueButton('global-secret-value')}
        </div>
      </label>
      <label>
        Comment
        <input type="text" name="comment" value="${escapeHtml(data.comment ?? "")}"
               placeholder="Optional description" />
        <small>Helps identify the purpose of this secret</small>
      </label>
      <div class="grid" style="margin-bottom: 0;">
        <button type="submit" style="margin-bottom: 0;">Create Secret</button>
        <a href="/web/secrets" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
    ${valueGeneratorScripts()}
  `;
}

/**
 * Renders the edit secret form.
 */
function renderEditForm(
  action: string,
  secret: { name: string; value: string; comment?: string; decryptionError?: string },
  error?: string,
  csrfToken: string = ""
): string {
  return `
    <h1>Edit Secret</h1>
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="${escapeHtml(action)}">
      ${csrfToken ? csrfInput(csrfToken) : ""}
      <label>
        Secret Name
        <input type="text" value="${escapeHtml(secret.name)}" disabled />
        <small>Secret names cannot be changed</small>
      </label>
      <label>
        Secret Value *
        <div style="display: flex; align-items: flex-start;">
          <textarea id="global-secret-edit" name="value" required
                    placeholder="your-secret-value"
                    rows="4" style="flex: 1;">${escapeHtml(secret.value)}</textarea>
          ${generateValueButton('global-secret-edit')}
        </div>
      </label>
      <label>
        Comment
        <input type="text" name="comment" value="${escapeHtml(secret.comment ?? "")}"
               placeholder="Optional description" />
        <small>Helps identify the purpose of this secret</small>
      </label>
      <div class="grid" style="margin-bottom: 0;">
        <button type="submit" style="margin-bottom: 0;">Save Changes</button>
        <a href="/web/secrets" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
    ${valueGeneratorScripts()}
  `;
}

