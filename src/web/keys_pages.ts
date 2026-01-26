import { Hono } from "@hono/hono";
import type { ApiKeyService, ApiKeyGroup } from "../keys/api_key_service.ts";
import { validateKeyGroup, validateKeyName, validateKeyValue } from "../validation/keys.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import type { Secret } from "../secrets/types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
  getLayoutUser,
  getCsrfToken,
  formatDate,
  secretScripts,
  parseSecretFormData,
  parseSecretEditFormData,
  generateValueButton,
  valueGeneratorScripts,
} from "./templates.ts";
import { csrfInput } from "../csrf/csrf_helpers.ts";

export function createKeysPages(
  apiKeyService: ApiKeyService,
  secretsService: SecretsService,
  settingsService: SettingsService
): Hono {
  const routes = new Hono();

  // List all keys grouped by group
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const allKeys = await apiKeyService.getAll();
    const groups = await apiKeyService.getGroups();

    // Create a map of group name -> group for description lookup
    const groupMap = new Map<string, ApiKeyGroup>();
    for (const g of groups) {
      groupMap.set(g.name, g);
    }

    // Merge group names from keys and empty groups, then sort
    const groupNamesFromKeys = [...allKeys.keys()];
    const groupNamesFromGroups = groups.map((g) => g.name);
    const allGroupNames = new Set([...groupNamesFromKeys, ...groupNamesFromGroups]);
    const sortedGroupNames = [...allGroupNames].sort();

    const content = `
      <h1>API Keys</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/keys/create-group", "Create New Group")}
        ${buttonLink("/web/keys/create", "Create New Key")}
      </p>
      ${
        sortedGroupNames.length === 0
          ? "<p>No API key groups found.</p>"
          : sortedGroupNames
              .map((groupName) => {
                const keys = allKeys.get(groupName) ?? [];
                const groupInfo = groupMap.get(groupName);
                return `
              <article class="key-group">
                <header>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <strong>${escapeHtml(groupName)}</strong>
                      ${groupInfo?.description ? `<br><small style="color: var(--pico-muted-color);">${escapeHtml(groupInfo.description)}</small>` : ""}
                    </div>
                    <div>
                      ${groupInfo ? `<a href="/web/keys/secrets/${groupInfo.id}" role="button" class="outline" style="padding: 0.25rem 0.5rem; font-size: 1rem;" title="Manage Secrets">🔐</a>` : ""}
                      ${groupInfo ? `<a href="/web/keys/edit-group/${groupInfo.id}" role="button" class="outline" style="padding: 0.25rem 0.5rem; font-size: 1rem;" title="Edit Group">✏️</a>` : ""}
                      ${groupInfo ? `<a href="/web/keys/create?group=${groupInfo.id}" role="button" class="outline" style="padding: 0.25rem 0.5rem; font-size: 1rem;" title="Add Key">➕</a>` : ""}
                      ${
                        groupName !== "management" && groupInfo
                          ? `<a href="/web/keys/delete-group?id=${groupInfo.id}" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem; font-size: 1rem;" title="Delete Group">🗑️</a>`
                          : ""
                      }
                    </div>
                  </div>
                </header>
                ${
                  keys.length === 0
                    ? `<p style="color: var(--pico-muted-color); margin: 0;"><em>No keys in this group</em></p>`
                    : `<table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
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
                        <td><code>${key.id}</code></td>
                        <td><strong>${escapeHtml(key.name)}</strong></td>
                        <td class="secret-value">
                          <span class="masked">••••••••</span>
                          <span class="revealed" style="display:none;">
                            <code>${escapeHtml(key.value)}</code>
                          </span>
                          <button type="button" onclick="toggleSecret(this)"
                                  class="secondary" style="padding: 0.25rem 0.5rem; margin-left: 0.5rem;">
                            👁️
                          </button>
                          <button type="button" onclick="copySecret(this, '${escapeHtml(key.value).replace(/'/g, "\\'")}')"
                                  class="secondary" style="padding: 0.25rem 0.5rem;">
                            📋
                          </button>
                        </td>
                        <td>${key.description ? escapeHtml(key.description) : "<em>none</em>"}</td>
                        <td class="actions">
                          <a href="/web/keys/${key.id}/secrets" title="Manage Secrets" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">🔐</a><a href="/web/keys/delete?id=${key.id}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
                        </td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>`
                }
              </article>
            `;
              })
              .join("")
      }

      ${secretScripts()}
    `;
    return c.html(await layout("API Keys", content, getLayoutUser(c), settingsService));
  });

  // Create group form
  routes.get("/create-group", async (c) => {
    const error = c.req.query("error");
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>Create API Key Group</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/keys/create-group">
        ${csrfInput(csrfToken)}
        <label>
          Group Name
          <input type="text" name="name" required placeholder="my-api-group">
          <small>Lowercase letters, numbers, dashes, and underscores only</small>
        </label>
        <label>
          Description
          <input type="text" name="description" placeholder="Optional description for this group">
        </label>
        <div class="grid" style="margin-bottom: 0;">
          <button type="submit" style="margin-bottom: 0;">Create Group</button>
          <a href="/web/keys" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
        </div>
      </form>
    `;
    return c.html(await layout("Create API Key Group", content, getLayoutUser(c), settingsService));
  });

  // Handle create group
  routes.post("/create-group", async (c) => {
    let body: { name?: string; description?: string };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect("/web/keys/create-group?error=" + encodeURIComponent("Invalid form data"));
    }

    const name = (body.name as string | undefined)?.trim().toLowerCase() ?? "";
    const description = (body.description as string | undefined)?.trim() || undefined;

    if (!name) {
      return c.redirect("/web/keys/create-group?error=" + encodeURIComponent("Group name is required"));
    }

    if (!validateKeyGroup(name)) {
      return c.redirect(
        `/web/keys/create-group?error=` +
          encodeURIComponent("Invalid group name format (use lowercase a-z, 0-9, -, _)")
      );
    }

    // Check if group already exists
    const existing = await apiKeyService.getGroupByName(name);
    if (existing) {
      return c.redirect(
        `/web/keys/create-group?error=` + encodeURIComponent(`Group '${name}' already exists`)
      );
    }

    try {
      await apiKeyService.createGroup(name, description);
      return c.redirect("/web/keys?success=" + encodeURIComponent(`Group created: ${name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create group";
      return c.redirect(`/web/keys/create-group?error=` + encodeURIComponent(message));
    }
  });

  // Edit group form
  routes.get("/edit-group/:id", async (c) => {
    const id = c.req.param("id");
    const error = c.req.query("error");
    const csrfToken = getCsrfToken(c);

    if (!id) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Invalid group ID"));
    }

    const group = await apiKeyService.getGroupById(id);
    if (!group) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Group not found"));
    }

    const content = `
      <h1>Edit Group: ${escapeHtml(group.name)}</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/keys/edit-group/${id}">
        ${csrfInput(csrfToken)}
        <label>
          Group Name
          <input type="text" value="${escapeHtml(group.name)}" readonly disabled>
          <small>Group names cannot be changed</small>
        </label>
        <label>
          Description
          <input type="text" name="description" value="${escapeHtml(group.description ?? "")}" placeholder="Optional description for this group">
        </label>
        <div class="grid" style="margin-bottom: 0;">
          <button type="submit" style="margin-bottom: 0;">Save Changes</button>
          <a href="/web/keys" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
        </div>
      </form>
    `;
    return c.html(await layout(`Edit Group: ${group.name}`, content, getLayoutUser(c), settingsService));
  });

  // Handle edit group
  routes.post("/edit-group/:id", async (c) => {
    const id = c.req.param("id");

    if (!id) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Invalid group ID"));
    }

    const group = await apiKeyService.getGroupById(id);
    if (!group) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Group not found"));
    }

    let body: { description?: string };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect(`/web/keys/edit-group/${id}?error=` + encodeURIComponent("Invalid form data"));
    }

    const description = (body.description as string | undefined)?.trim() ?? "";

    try {
      await apiKeyService.updateGroup(id, description);
      return c.redirect("/web/keys?success=" + encodeURIComponent(`Group updated: ${group.name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update group";
      return c.redirect(`/web/keys/edit-group/${id}?error=` + encodeURIComponent(message));
    }
  });

  // Create key form
  routes.get("/create", async (c) => {
    const preselectedGroupId = c.req.query("group") ?? "";
    let preselectedGroup: ApiKeyGroup | null = null;

    if (preselectedGroupId) {
      preselectedGroup = await apiKeyService.getGroupById(preselectedGroupId);
    }

    const error = c.req.query("error");
    const groups = await apiKeyService.getGroups();
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>Create API Key</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/keys/create">
        ${csrfInput(csrfToken)}
        <label>
          Key Group
          ${
            preselectedGroup
              ? `<input type="text" name="groupName" value="${escapeHtml(preselectedGroup.name)}" readonly>
                 <input type="hidden" name="groupId" value="${preselectedGroup.id}">
                 <small>Adding to group: ${escapeHtml(preselectedGroup.name)}</small>`
              : `<select name="groupId" required>
                   <option value="">-- Select a group or create new --</option>
                   ${groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}${g.description ? ` - ${escapeHtml(g.description)}` : ""}</option>`).join("")}
                   <option value="__new__">+ Create new group...</option>
                 </select>
                 <small>Select an existing group or create a new one</small>`
          }
        </label>
        <div id="new-group-name" style="display: none;">
          <label>
            New Group Name
            <input type="text" name="newGroupName" placeholder="my-new-group">
            <small>Lowercase letters, numbers, dashes, and underscores only</small>
          </label>
        </div>
        <label>
          Key Name *
          <input type="text" name="name" required placeholder="my-api-key">
          <small>Lowercase letters, numbers, dashes, and underscores only. Must be unique within the group.</small>
        </label>
        <label>
          Key Value
          <div style="display: flex; align-items: center;">
            <input type="text" id="key-value-input" name="value" required
                   placeholder="your-secret-key-value" style="flex: 1;">
            ${generateValueButton('key-value-input')}
          </div>
          <small>Letters, numbers, dashes, and underscores only</small>
        </label>
        <label>
          Description
          <input type="text" name="description" placeholder="Optional description">
        </label>
        <div class="grid" style="margin-bottom: 0;">
          <button type="submit" style="margin-bottom: 0;">Create Key</button>
          <a href="/web/keys" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
        </div>
      </form>
      <script>
        const groupSelect = document.querySelector('select[name="groupId"]');
        const newGroupDiv = document.getElementById('new-group-name');
        const newGroupInput = document.querySelector('input[name="newGroupName"]');
        if (groupSelect && newGroupDiv && newGroupInput) {
          groupSelect.addEventListener('change', function() {
            if (this.value === '__new__') {
              newGroupDiv.style.display = 'block';
              newGroupInput.required = true;
            } else {
              newGroupDiv.style.display = 'none';
              newGroupInput.required = false;
            }
          });
        }
      </script>
      ${valueGeneratorScripts()}
    `;
    return c.html(await layout("Create API Key", content, getLayoutUser(c), settingsService));
  });

  // Handle create
  routes.post("/create", async (c) => {
    let body: { groupId?: string; newGroupName?: string; name?: string; value?: string; description?: string };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect("/web/keys/create?error=" + encodeURIComponent("Invalid form data"));
    }

    const groupIdStr = (body.groupId as string | undefined)?.trim() ?? "";
    const newGroupName = (body.newGroupName as string | undefined)?.trim().toLowerCase() ?? "";
    const name = (body.name as string | undefined)?.trim().toLowerCase() ?? "";
    const value = (body.value as string | undefined)?.trim() ?? "";
    const description = (body.description as string | undefined)?.trim() || undefined;

    let groupId: string;
    let groupName: string;

    // Handle "create new group" option
    if (groupIdStr === "__new__") {
      if (!newGroupName) {
        return c.redirect("/web/keys/create?error=" + encodeURIComponent("New group name is required"));
      }
      if (!validateKeyGroup(newGroupName)) {
        return c.redirect(
          `/web/keys/create?error=` +
            encodeURIComponent("Invalid new group name format (use lowercase a-z, 0-9, -, _)")
        );
      }

      try {
        groupId = await apiKeyService.createGroup(newGroupName);
        groupName = newGroupName;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create group";
        return c.redirect(`/web/keys/create?error=` + encodeURIComponent(message));
      }
    } else {
      // Use existing group
      if (!groupIdStr) {
        return c.redirect("/web/keys/create?error=" + encodeURIComponent("Invalid group selection"));
      }

      const group = await apiKeyService.getGroupById(groupIdStr);
      if (!group) {
        return c.redirect("/web/keys/create?error=" + encodeURIComponent("Selected group not found"));
      }

      groupId = groupIdStr;
      groupName = group.name;
    }

    // Validate key name
    if (!name) {
      return c.redirect(
        `/web/keys/create?group=${groupId}&error=` +
          encodeURIComponent("Key name is required")
      );
    }

    if (!validateKeyName(name)) {
      return c.redirect(
        `/web/keys/create?group=${groupId}&error=` +
          encodeURIComponent("Invalid key name format (use lowercase a-z, 0-9, -, _)")
      );
    }

    // Validate key value
    if (!value) {
      return c.redirect(
        `/web/keys/create?group=${groupId}&error=` +
          encodeURIComponent("Key value is required")
      );
    }

    if (!validateKeyValue(value)) {
      return c.redirect(
        `/web/keys/create?group=${groupId}&error=` +
          encodeURIComponent("Invalid key value format (use a-z, A-Z, 0-9, -, _)")
      );
    }

    try {
      await apiKeyService.addKeyToGroup(groupId, name, value, description);
      return c.redirect("/web/keys?success=" + encodeURIComponent(`Key '${name}' created for group: ${groupName}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create key";
      return c.redirect(
        `/web/keys/create?group=${groupId}&error=` + encodeURIComponent(message)
      );
    }
  });

  // Delete key by ID confirmation
  routes.get("/delete", (c) => {
    const id = c.req.query("id");

    if (!id) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key ID specified"));
    }

    return c.html(
      confirmPage(
        "Delete API Key",
        `Are you sure you want to delete the key with ID ${id}? This action cannot be undone.`,
        `/web/keys/delete?id=${id}`,
        "/web/keys",
        getLayoutUser(c),
        settingsService,
        getCsrfToken(c)
      )
    );
  });

  // Handle delete by ID
  routes.post("/delete", async (c) => {
    const id = c.req.query("id");

    if (!id) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key ID specified"));
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
    const groupId = c.req.query("id");

    if (!groupId) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No group ID specified"));
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Group not found"));
    }

    if (group.name === "management") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Cannot delete management group")
      );
    }

    // Check if group has keys
    const keyCount = await apiKeyService.getKeyCountForGroup(groupId);
    if (keyCount > 0) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent(`Cannot delete group with ${keyCount} existing key(s). Delete keys first.`)
      );
    }

    return c.html(
      confirmPage(
        "Delete Group",
        `Are you sure you want to delete the group "${group.name}"? This action cannot be undone.`,
        `/web/keys/delete-group?id=${groupId}`,
        "/web/keys",
        getLayoutUser(c),
        settingsService,
        getCsrfToken(c)
      )
    );
  });

  // Handle delete group
  routes.post("/delete-group", async (c) => {
    const groupId = c.req.query("id");

    if (!groupId) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No group ID specified"));
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("Group not found"));
    }

    if (group.name === "management") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Cannot delete management group")
      );
    }

    // Check if group has keys
    const keyCount = await apiKeyService.getKeyCountForGroup(groupId);
    if (keyCount > 0) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent(`Cannot delete group with ${keyCount} existing key(s). Delete keys first.`)
      );
    }

    try {
      await apiKeyService.deleteGroup(groupId);
      return c.redirect(
        "/web/keys?success=" + encodeURIComponent(`Group deleted: ${group.name}`)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete group";
      return c.redirect("/web/keys?error=" + encodeURIComponent(message));
    }
  });

  // ============== Group Secrets Management ==============

  // GET /secrets/:groupId - List secrets for group
  routes.get("/secrets/:groupId", async (c) => {
    const groupId = c.req.param("groupId");

    if (!groupId) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid group ID")
      );
    }

    // Verify group exists
    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Group not found")
      );
    }

    const success = c.req.query("success");
    const error = c.req.query("error");

    // Load secrets for this group
    const secrets = await secretsService.getGroupSecrets(groupId);

    const content = `
      <h1>Secrets for ${escapeHtml(group.name)}</h1>
      <p>
        <a href="/web/keys" role="button" class="secondary">
          ← Back to Keys
        </a>
      </p>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink(
          `/web/keys/secrets/${groupId}/create`,
          "Create New Secret"
        )}
      </p>
      ${
        secrets.length === 0
          ? "<p>No secrets configured for this group. Create your first secret to get started.</p>"
          : renderGroupSecretsTable(secrets, groupId)
      }
    `;

    return c.html(
      layout(`Secrets: ${group.name}`, content, getLayoutUser(c), settingsService)
    );
  });

  // GET /secrets/:groupId/create - Create secret form
  routes.get("/secrets/:groupId/create", async (c) => {
    const groupId = c.req.param("groupId");

    if (!groupId) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid group ID")
      );
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Group not found")
      );
    }

    const error = c.req.query("error");
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>Create Secret for ${escapeHtml(group.name)}</h1>
      <p>
        <a href="/web/keys/secrets/${groupId}" role="button" class="secondary">
          ← Back to Secrets
        </a>
      </p>
      ${renderGroupSecretCreateForm(groupId, {}, error, csrfToken)}
    `;

    return c.html(
      layout(`Create Secret: ${group.name}`, content, getLayoutUser(c), settingsService)
    );
  });

  // POST /secrets/:groupId/create - Handle secret creation
  routes.post("/secrets/:groupId/create", async (c) => {
    const groupId = c.req.param("groupId");

    if (!groupId) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid group ID")
      );
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Group not found")
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/keys/secrets/${groupId}/create?error=` +
          encodeURIComponent("Invalid form data")
      );
    }

    const { secretData, errors } = parseSecretFormData(formData);

    if (errors.length > 0) {
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Create Secret for ${escapeHtml(group.name)}</h1>
        <p>
          <a href="/web/keys/secrets/${groupId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderGroupSecretCreateForm(groupId, secretData, errors.join(". "), csrfToken)}
      `;
      return c.html(
        layout(`Create Secret: ${group.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }

    try {
      await secretsService.createGroupSecret(
        groupId,
        secretData.name,
        secretData.value,
        secretData.comment || undefined
      );

      return c.redirect(
        `/web/keys/secrets/${groupId}?success=` +
          encodeURIComponent(`Secret created: ${secretData.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create secret";
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Create Secret for ${escapeHtml(group.name)}</h1>
        <p>
          <a href="/web/keys/secrets/${groupId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderGroupSecretCreateForm(groupId, secretData, message, csrfToken)}
      `;
      return c.html(
        layout(`Create Secret: ${group.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }
  });

  // GET /secrets/:groupId/edit/:secretId - Edit secret form
  routes.get("/secrets/:groupId/edit/:secretId", async (c) => {
    const groupId = c.req.param("groupId");
    const secretId = c.req.param("secretId");

    if (!groupId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Group not found")
      );
    }

    const secret = await secretsService.getGroupSecretById(
      groupId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/keys/secrets/${groupId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    const error = c.req.query("error");
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
      <p>
        <a href="/web/keys/secrets/${groupId}" role="button" class="secondary">
          ← Back to Secrets
        </a>
      </p>
      ${renderGroupSecretEditForm(groupId, secret, error, csrfToken)}
    `;

    return c.html(
      layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService)
    );
  });

  // POST /secrets/:groupId/edit/:secretId - Handle secret update
  routes.post("/secrets/:groupId/edit/:secretId", async (c) => {
    const groupId = c.req.param("groupId");
    const secretId = c.req.param("secretId");

    if (!groupId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Group not found")
      );
    }

    const secret = await secretsService.getGroupSecretById(
      groupId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/keys/secrets/${groupId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/keys/secrets/${groupId}/edit/${secretId}?error=` +
          encodeURIComponent("Invalid form data")
      );
    }

    const { editData, errors } = parseSecretEditFormData(formData);

    if (errors.length > 0) {
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
        <p>
          <a href="/web/keys/secrets/${groupId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderGroupSecretEditForm(
          groupId,
          { ...secret, ...editData },
          errors.join(". "),
          csrfToken
        )}
      `;
      return c.html(
        layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }

    try {
      await secretsService.updateGroupSecret(
        groupId,
        secretId,
        editData.value,
        editData.comment || undefined
      );

      return c.redirect(
        `/web/keys/secrets/${groupId}?success=` +
          encodeURIComponent(`Secret updated: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update secret";
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
        <p>
          <a href="/web/keys/secrets/${groupId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderGroupSecretEditForm(
          groupId,
          { ...secret, ...editData },
          message,
          csrfToken
        )}
      `;
      return c.html(
        layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }
  });

  // GET /secrets/:groupId/delete/:secretId - Delete confirmation
  routes.get("/secrets/:groupId/delete/:secretId", async (c) => {
    const groupId = c.req.param("groupId");
    const secretId = c.req.param("secretId");

    if (!groupId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Group not found")
      );
    }

    const secret = await secretsService.getGroupSecretById(
      groupId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/keys/secrets/${groupId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    return c.html(
      confirmPage(
        "Delete Secret",
        `Are you sure you want to delete the secret "<strong>${escapeHtml(secret.name)}</strong>"? This action cannot be undone.`,
        `/web/keys/secrets/${groupId}/delete/${secretId}`,
        `/web/keys/secrets/${groupId}`,
        getLayoutUser(c),
        settingsService,
        getCsrfToken(c)
      )
    );
  });

  // POST /secrets/:groupId/delete/:secretId - Handle deletion
  routes.post("/secrets/:groupId/delete/:secretId", async (c) => {
    const groupId = c.req.param("groupId");
    const secretId = c.req.param("secretId");

    if (!groupId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const group = await apiKeyService.getGroupById(groupId);
    if (!group) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Group not found")
      );
    }

    const secret = await secretsService.getGroupSecretById(
      groupId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/keys/secrets/${groupId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    try {
      await secretsService.deleteGroupSecret(groupId, secretId);

      return c.redirect(
        `/web/keys/secrets/${groupId}?success=` +
          encodeURIComponent(`Secret deleted: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete secret";
      return c.redirect(
        `/web/keys/secrets/${groupId}?error=` + encodeURIComponent(message)
      );
    }
  });

  // ============== Key Secrets Routes ==============

  // GET /:keyId/secrets - List secrets for an API key
  routes.get("/:keyId/secrets", async (c) => {
    const keyId = c.req.param("keyId");

    if (!keyId) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid key ID")
      );
    }

    // Verify key exists
    const result = await apiKeyService.getById(keyId);
    if (!result) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("API key not found")
      );
    }

    const { key } = result;
    const success = c.req.query("success");
    const error = c.req.query("error");

    // Load secrets for this key
    const secrets = await secretsService.getKeySecrets(keyId);

    const keyDisplay = key.name;

    const content = `
      <h1>Secrets for Key: ${escapeHtml(keyDisplay)}</h1>
      <p>
        <a href="/web/keys" role="button" class="secondary">
          ← Back to Keys
        </a>
      </p>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink(
          `/web/keys/${keyId}/secrets/create`,
          "Create New Secret"
        )}
      </p>
      ${
        secrets.length === 0
          ? "<p>No secrets configured for this API key. Create your first secret to get started.</p>"
          : renderKeySecretsTable(secrets, keyId)
      }
    `;

    return c.html(
      layout(`Secrets: ${keyDisplay}`, content, getLayoutUser(c), settingsService)
    );
  });

  // GET /:keyId/secrets/create - Create secret form
  routes.get("/:keyId/secrets/create", async (c) => {
    const keyId = c.req.param("keyId");

    if (!keyId) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid key ID")
      );
    }

    // Verify key exists
    const result = await apiKeyService.getById(keyId);
    if (!result) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("API key not found")
      );
    }

    const { key } = result;
    const keyDisplay = key.name;
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>Create Secret for ${escapeHtml(keyDisplay)}</h1>
      <p>
        <a href="/web/keys/${keyId}/secrets" role="button" class="secondary">
          ← Back to Secrets
        </a>
      </p>
      ${renderKeySecretCreateForm(keyId, {}, undefined, csrfToken)}
    `;

    return c.html(
      layout(`Create Secret: ${keyDisplay}`, content, getLayoutUser(c), settingsService)
    );
  });

  // POST /:keyId/secrets/create - Handle secret creation
  routes.post("/:keyId/secrets/create", async (c) => {
    const keyId = c.req.param("keyId");

    if (!keyId) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid key ID")
      );
    }

    // Verify key exists
    const result = await apiKeyService.getById(keyId);
    if (!result) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("API key not found")
      );
    }

    const { key } = result;
    const keyDisplay = key.name;

    const formData = await c.req.formData();
    const { secretData, errors } = parseSecretFormData(formData);

    if (errors.length > 0) {
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Create Secret for ${escapeHtml(keyDisplay)}</h1>
        <p>
          <a href="/web/keys/${keyId}/secrets" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderKeySecretCreateForm(keyId, secretData, errors.join(", "), csrfToken)}
      `;
      return c.html(
        layout(`Create Secret: ${keyDisplay}`, content, getLayoutUser(c), settingsService)
      );
    }

    try {
      await secretsService.createKeySecret(
        keyId,
        secretData.name,
        secretData.value,
        secretData.comment
      );

      return c.redirect(
        `/web/keys/${keyId}/secrets?success=` +
          encodeURIComponent(`Secret created: ${secretData.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create secret";
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Create Secret for ${escapeHtml(keyDisplay)}</h1>
        <p>
          <a href="/web/keys/${keyId}/secrets" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderKeySecretCreateForm(keyId, secretData, message, csrfToken)}
      `;
      return c.html(
        layout(`Create Secret: ${keyDisplay}`, content, getLayoutUser(c), settingsService)
      );
    }
  });

  // GET /:keyId/secrets/edit/:secretId - Edit secret form
  routes.get("/:keyId/secrets/edit/:secretId", async (c) => {
    const keyId = c.req.param("keyId");
    const secretId = c.req.param("secretId");

    if (!keyId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    // Verify key exists
    const result = await apiKeyService.getById(keyId);
    if (!result) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("API key not found")
      );
    }

    // Load secret
    const secret = await secretsService.getKeySecretById(keyId, secretId);
    if (!secret) {
      return c.redirect(
        `/web/keys/${keyId}/secrets?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    const csrfToken = getCsrfToken(c);
    const content = `
      <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
      <p>
        <a href="/web/keys/${keyId}/secrets" role="button" class="secondary">
          ← Back to Secrets
        </a>
      </p>
      ${renderKeySecretEditForm(keyId, secret, undefined, csrfToken)}
    `;

    return c.html(
      layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService)
    );
  });

  // POST /:keyId/secrets/edit/:secretId - Handle secret update
  routes.post("/:keyId/secrets/edit/:secretId", async (c) => {
    const keyId = c.req.param("keyId");
    const secretId = c.req.param("secretId");

    if (!keyId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    // Verify key exists
    const result = await apiKeyService.getById(keyId);
    if (!result) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("API key not found")
      );
    }

    // Load secret to get the name for the title
    const secret = await secretsService.getKeySecretById(keyId, secretId);
    if (!secret) {
      return c.redirect(
        `/web/keys/${keyId}/secrets?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    const formData = await c.req.formData();
    const { editData, errors } = parseSecretEditFormData(formData);

    if (errors.length > 0) {
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
        <p>
          <a href="/web/keys/${keyId}/secrets" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderKeySecretEditForm(keyId, { ...secret, ...editData }, errors.join(", "), csrfToken)}
      `;
      return c.html(
        layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService)
      );
    }

    try {
      await secretsService.updateKeySecret(
        keyId,
        secretId,
        editData.value,
        editData.comment
      );

      return c.redirect(
        `/web/keys/${keyId}/secrets?success=` +
          encodeURIComponent(`Secret updated: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update secret";
      const csrfToken = getCsrfToken(c);
      const content = `
        <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
        <p>
          <a href="/web/keys/${keyId}/secrets" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderKeySecretEditForm(keyId, { ...secret, ...editData }, message, csrfToken)}
      `;
      return c.html(
        layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService)
      );
    }
  });

  // GET /:keyId/secrets/delete/:secretId - Delete confirmation
  routes.get("/:keyId/secrets/delete/:secretId", async (c) => {
    const keyId = c.req.param("keyId");
    const secretId = c.req.param("secretId");

    if (!keyId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    // Verify key exists
    const result = await apiKeyService.getById(keyId);
    if (!result) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("API key not found")
      );
    }

    // Load secret
    const secret = await secretsService.getKeySecretById(keyId, secretId);
    if (!secret) {
      return c.redirect(
        `/web/keys/${keyId}/secrets?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    return c.html(
      confirmPage(
        `Delete Secret: ${escapeHtml(secret.name)}`,
        `Are you sure you want to delete the secret <strong>${escapeHtml(secret.name)}</strong>? This action cannot be undone.`,
        `/web/keys/${keyId}/secrets/delete/${secretId}`,
        `/web/keys/${keyId}/secrets`,
        getLayoutUser(c),
        settingsService,
        getCsrfToken(c)
      )
    );
  });

  // POST /:keyId/secrets/delete/:secretId - Handle secret deletion
  routes.post("/:keyId/secrets/delete/:secretId", async (c) => {
    const keyId = c.req.param("keyId");
    const secretId = c.req.param("secretId");

    if (!keyId || !secretId || secretId.trim() === "") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Invalid ID")
      );
    }

    // Verify key exists
    const result = await apiKeyService.getById(keyId);
    if (!result) {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("API key not found")
      );
    }

    // Load secret to get the name for success message
    const secret = await secretsService.getKeySecretById(keyId, secretId);
    if (!secret) {
      return c.redirect(
        `/web/keys/${keyId}/secrets?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    try {
      await secretsService.deleteKeySecret(keyId, secretId);

      return c.redirect(
        `/web/keys/${keyId}/secrets?success=` +
          encodeURIComponent(`Secret deleted: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete secret";
      return c.redirect(
        `/web/keys/${keyId}/secrets?error=` + encodeURIComponent(message)
      );
    }
  });

  return routes;
}

// ============== Helper Functions for Group Secrets ==============

/**
 * Renders the secrets table with show/hide and copy functionality
 */
function renderGroupSecretsTable(secrets: Secret[], groupId: string): string {
  return `
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
            (secret) => `
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
              ${secret.decryptionError ? "" : `<a href="/web/keys/secrets/${groupId}/edit/${secret.id}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>`}
              <a href="/web/keys/secrets/${groupId}/delete/${secret.id}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>

    ${secretScripts()}
  `;
}

/**
 * Renders the create secret form for a group
 */
function renderGroupSecretCreateForm(
  groupId: string,
  data: { name?: string; value?: string; comment?: string } = {},
  error?: string,
  csrfToken: string = ""
): string {
  return `
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="/web/keys/secrets/${groupId}/create">
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
          <textarea id="group-secret-value-${groupId}" name="value" required
                    placeholder="your-secret-value"
                    rows="4" style="flex: 1;">${escapeHtml(data.value ?? "")}</textarea>
          ${generateValueButton(`group-secret-value-${groupId}`)}
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
        <a href="/web/keys/secrets/${groupId}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
    ${valueGeneratorScripts()}
  `;
}

/**
 * Renders the edit secret form for a group.
 * Accepts Secret type with RecordId, converts to string for URLs.
 */
function renderGroupSecretEditForm(
  groupId: string,
  secret: Secret,
  error?: string,
  csrfToken: string = ""
): string {
  const secretId = recordIdToString(secret.id);
  return `
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="/web/keys/secrets/${groupId}/edit/${secretId}">
      ${csrfToken ? csrfInput(csrfToken) : ""}
      <label>
        Secret Name
        <input type="text" value="${escapeHtml(secret.name)}" disabled />
        <small>Secret names cannot be changed</small>
      </label>
      <label>
        Secret Value *
        <div style="display: flex; align-items: flex-start;">
          <textarea id="group-secret-edit-${groupId}-${secretId}" name="value" required
                    placeholder="your-secret-value"
                    rows="4" style="flex: 1;">${escapeHtml(secret.value)}</textarea>
          ${generateValueButton(`group-secret-edit-${groupId}-${secretId}`)}
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
        <a href="/web/keys/secrets/${groupId}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
    ${valueGeneratorScripts()}
  `;
}

// ============== Helper Functions for Key Secrets ==============

/**
 * Renders the secrets table for an individual API key with show/hide and copy functionality
 */
function renderKeySecretsTable(secrets: Secret[], keyId: string): string {
  return `
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
            (secret) => `
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
              ${secret.decryptionError ? "" : `<a href="/web/keys/${keyId}/secrets/edit/${secret.id}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>`}
              <a href="/web/keys/${keyId}/secrets/delete/${secret.id}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>

    ${secretScripts()}
  `;
}

/**
 * Renders the create secret form for an API key
 */
function renderKeySecretCreateForm(
  keyId: string,
  data: { name?: string; value?: string; comment?: string } = {},
  error?: string,
  csrfToken: string = ""
): string {
  return `
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="/web/keys/${keyId}/secrets/create">
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
          <textarea id="key-secret-value-${keyId}" name="value" required
                    placeholder="your-secret-value"
                    rows="4" style="flex: 1;">${escapeHtml(data.value ?? "")}</textarea>
          ${generateValueButton(`key-secret-value-${keyId}`)}
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
        <a href="/web/keys/${keyId}/secrets" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
    ${valueGeneratorScripts()}
  `;
}

/**
 * Renders the edit secret form for an API key.
 * Accepts Secret type with RecordId, converts to string for URLs.
 */
function renderKeySecretEditForm(
  keyId: string,
  secret: Secret,
  error?: string,
  csrfToken: string = ""
): string {
  const secretId = recordIdToString(secret.id);
  return `
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="/web/keys/${keyId}/secrets/edit/${secretId}">
      ${csrfToken ? csrfInput(csrfToken) : ""}
      <label>
        Secret Name
        <input type="text" value="${escapeHtml(secret.name)}" disabled />
        <small>Secret names cannot be changed</small>
      </label>
      <label>
        Secret Value *
        <div style="display: flex; align-items: flex-start;">
          <textarea id="key-secret-edit-${keyId}-${secretId}" name="value" required
                    placeholder="your-secret-value"
                    rows="4" style="flex: 1;">${escapeHtml(secret.value)}</textarea>
          ${generateValueButton(`key-secret-edit-${keyId}-${secretId}`)}
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
        <a href="/web/keys/${keyId}/secrets" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
    ${valueGeneratorScripts()}
  `;
}
