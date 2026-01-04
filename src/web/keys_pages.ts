import { Hono } from "@hono/hono";
import type { ApiKeyService, ApiKeyGroup } from "../keys/api_key_service.ts";
import { validateKeyGroup, validateKeyValue } from "../keys/api_key_service.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
  getLayoutUser,
} from "./templates.ts";

export function createKeysPages(apiKeyService: ApiKeyService): Hono {
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
                      ${groupInfo ? `<a href="/web/keys/edit-group/${groupInfo.id}" role="button" class="outline" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Edit Group</a>` : ""}
                      <a href="/web/keys/create?group=${encodeURIComponent(groupName)}" role="button" class="outline" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Add Key</a>
                      ${
                        groupName !== "management"
                          ? `<a href="/web/keys/delete-group?group=${encodeURIComponent(groupName)}" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Delete Group</a>`
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
                </table>`
                }
              </article>
            `;
              })
              .join("")
      }
    `;
    return c.html(layout("API Keys", content, getLayoutUser(c)));
  });

  // Create group form
  routes.get("/create-group", (c) => {
    const error = c.req.query("error");

    const content = `
      <h1>Create API Key Group</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/keys/create-group">
        <label>
          Group Name
          <input type="text" name="name" required placeholder="my-api-group"
                 pattern="[a-z0-9_-]+">
          <small>Lowercase letters, numbers, dashes, and underscores only</small>
        </label>
        <label>
          Description
          <input type="text" name="description" placeholder="Optional description for this group">
        </label>
        <div class="grid">
          <button type="submit">Create Group</button>
          <a href="/web/keys" role="button" class="secondary">Cancel</a>
        </div>
      </form>
    `;
    return c.html(layout("Create API Key Group", content, getLayoutUser(c)));
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
    const idStr = c.req.param("id");
    const id = parseInt(idStr, 10);
    const error = c.req.query("error");

    if (isNaN(id)) {
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
        <label>
          Group Name
          <input type="text" value="${escapeHtml(group.name)}" readonly disabled>
          <small>Group names cannot be changed</small>
        </label>
        <label>
          Description
          <input type="text" name="description" value="${escapeHtml(group.description ?? "")}" placeholder="Optional description for this group">
        </label>
        <div class="grid">
          <button type="submit">Save Changes</button>
          <a href="/web/keys" role="button" class="secondary">Cancel</a>
        </div>
      </form>
    `;
    return c.html(layout(`Edit Group: ${group.name}`, content, getLayoutUser(c)));
  });

  // Handle edit group
  routes.post("/edit-group/:id", async (c) => {
    const idStr = c.req.param("id");
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
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
    const preselectedGroup = c.req.query("group") ?? "";
    const error = c.req.query("error");
    const groups = await apiKeyService.getGroups();

    const content = `
      <h1>Create API Key</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/keys/create">
        <label>
          Key Group
          ${
            preselectedGroup
              ? `<input type="text" name="group" value="${escapeHtml(preselectedGroup)}" readonly>
                 <small>Adding to existing group</small>`
              : `<select name="group" required>
                   <option value="">-- Select a group or create new --</option>
                   ${groups.map((g) => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)}${g.description ? ` - ${escapeHtml(g.description)}` : ""}</option>`).join("")}
                   <option value="__new__">+ Create new group...</option>
                 </select>
                 <small>Select an existing group or create a new one</small>`
          }
        </label>
        <div id="new-group-name" style="display: none;">
          <label>
            New Group Name
            <input type="text" name="newGroupName" placeholder="my-new-group" pattern="[a-z0-9_-]+">
            <small>Lowercase letters, numbers, dashes, and underscores only</small>
          </label>
        </div>
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
      <script>
        const groupSelect = document.querySelector('select[name="group"]');
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
    `;
    return c.html(layout("Create API Key", content, getLayoutUser(c)));
  });

  // Handle create
  routes.post("/create", async (c) => {
    let body: { group?: string; newGroupName?: string; value?: string; description?: string };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect("/web/keys/create?error=" + encodeURIComponent("Invalid form data"));
    }

    let group = (body.group as string | undefined)?.trim().toLowerCase() ?? "";
    const newGroupName = (body.newGroupName as string | undefined)?.trim().toLowerCase() ?? "";
    const value = (body.value as string | undefined)?.trim() ?? "";
    const description = (body.description as string | undefined)?.trim() || undefined;

    // Handle "create new group" option
    if (group === "__new__") {
      if (!newGroupName) {
        return c.redirect("/web/keys/create?error=" + encodeURIComponent("New group name is required"));
      }
      if (!validateKeyGroup(newGroupName)) {
        return c.redirect(
          `/web/keys/create?error=` +
            encodeURIComponent("Invalid new group name format (use lowercase a-z, 0-9, -, _)")
        );
      }
      group = newGroupName;
    }

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
  routes.get("/delete", (c) => {
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
        "/web/keys",
        getLayoutUser(c)
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
    const groupName = c.req.query("group");

    if (!groupName) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key group specified"));
    }

    const group = await apiKeyService.getGroupByName(groupName);
    const keys = await apiKeyService.getKeys(groupName);

    if (!group && (!keys || keys.length === 0)) {
      return c.redirect("/web/keys?error=" + encodeURIComponent(`Key group not found: ${groupName}`));
    }

    if (groupName.toLowerCase() === "management") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Cannot delete management group")
      );
    }

    const keyCount = keys?.length ?? 0;

    return c.html(
      confirmPage(
        "Delete Group",
        `Are you sure you want to delete the group "${groupName}" and ALL its keys? This will remove ${keyCount} key(s). This action cannot be undone.`,
        `/web/keys/delete-group?group=${encodeURIComponent(groupName)}`,
        "/web/keys",
        getLayoutUser(c)
      )
    );
  });

  // Handle delete group
  routes.post("/delete-group", async (c) => {
    const groupName = c.req.query("group");

    if (!groupName) {
      return c.redirect("/web/keys?error=" + encodeURIComponent("No key group specified"));
    }

    if (groupName.toLowerCase() === "management") {
      return c.redirect(
        "/web/keys?error=" + encodeURIComponent("Cannot delete management group")
      );
    }

    try {
      await apiKeyService.removeGroupEntirely(groupName);
      return c.redirect(
        "/web/keys?success=" + encodeURIComponent(`Group and all keys deleted: ${groupName}`)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete group";
      return c.redirect("/web/keys?error=" + encodeURIComponent(message));
    }
  });

  return routes;
}
