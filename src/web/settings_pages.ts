import { Hono } from "@hono/hono";
import type { SettingsService } from "../settings/settings_service.ts";
import type { ApiKeyService, ApiKeyGroup } from "../keys/api_key_service.ts";
import {
  SettingNames,
  GlobalSettingDefaults,
  SettingsMetadata,
  SettingsByCategory,
  type SettingName,
} from "../settings/types.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  getLayoutUser,
} from "./templates.ts";

export interface SettingsPagesOptions {
  settingsService: SettingsService;
  apiKeyService: ApiKeyService;
}

export function createSettingsPages(options: SettingsPagesOptions): Hono {
  const { settingsService, apiKeyService } = options;
  const routes = new Hono();

  // GET / - Main settings page with tab support
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const tab = c.req.query("tab") || "server";

    if (tab === "user") {
      const content = renderUserSettingsTab();
      return c.html(await layout("User Settings", content, getLayoutUser(c), settingsService));
    }

    // Load all global settings
    const settingsData: Record<string, string> = {};
    for (const name of Object.values(SettingNames)) {
      const value = await settingsService.getGlobalSetting(name);
      settingsData[name] = value ?? GlobalSettingDefaults[name];
    }

    // Load available groups for checkboxGroup settings
    const availableGroups = await apiKeyService.getGroups();

    const content = renderServerSettingsTab(settingsData, availableGroups, success, error);
    return c.html(await layout("Server Settings", content, getLayoutUser(c), settingsService));
  });

  // Redirect routes for clean URLs
  routes.get("/user", (c) => c.redirect("/web/settings?tab=user"));
  routes.get("/server", (c) => c.redirect("/web/settings?tab=server"));

  // POST /server - Handle settings update
  routes.post("/server", async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect("/web/settings?tab=server&error=" +
        encodeURIComponent("Invalid form data"));
    }

    // Load available groups for validation and re-rendering
    const availableGroups = await apiKeyService.getGroups();

    const { updates, errors } = parseAndValidateSettings(formData, availableGroups);

    if (errors.length > 0) {
      // Load current values and merge with form data for re-display
      const settingsData: Record<string, string> = {};
      for (const name of Object.values(SettingNames)) {
        settingsData[name] = updates[name] ?? GlobalSettingDefaults[name];
      }

      return c.html(
        await layout(
          "Server Settings",
          renderServerSettingsTab(settingsData, availableGroups, undefined, errors.join(". ")),
          getLayoutUser(c),
          settingsService
        ),
        400
      );
    }

    // Apply updates - only update changed values
    let updatedCount = 0;
    for (const [name, newValue] of Object.entries(updates)) {
      const currentValue = await settingsService.getGlobalSetting(name as SettingName);
      const defaultValue = GlobalSettingDefaults[name as SettingName];

      if (newValue !== (currentValue ?? defaultValue)) {
        await settingsService.setGlobalSetting(
          name as SettingName,
          newValue,
          false // Not encrypted
        );
        updatedCount++;
      }
    }

    // Show success message regardless of whether changes were made
    const message = updatedCount > 0
      ? `Settings saved (${updatedCount} updated)`
      : "Settings saved";

    return c.redirect("/web/settings?tab=server&success=" +
      encodeURIComponent(message));
  });

  return routes;
}

// Helper: Render tab navigation
function renderTabs(activeTab: "user" | "server"): string {
  return `
    <div class="tabs">
      <a href="/web/settings?tab=server" class="${activeTab === "server" ? "active" : ""}">
        Server Settings
      </a>
      <a href="/web/settings?tab=user" class="${activeTab === "user" ? "active" : ""}">
        User Settings
      </a>
    </div>
  `;
}

// Helper: Render user settings tab (placeholder)
function renderUserSettingsTab(): string {
  return `
    <h1>Settings</h1>
    ${renderTabs("user")}
    <article>
      <header><strong>User Settings</strong></header>
      <p>User-specific settings are not yet implemented.</p>
      <small>Future user preferences will appear here.</small>
    </article>
  `;
}

// Helper: Render server settings tab
function renderServerSettingsTab(
  data: Record<string, string>,
  availableGroups: ApiKeyGroup[],
  success?: string,
  error?: string
): string {
  return `
    <h1>Settings</h1>
    ${renderTabs("server")}
    ${flashMessages(success, error)}

    <div id="rotation-status-message" style="display: none;"></div>

    <article>
      <h3>Encryption Key Rotation</h3>
      <p>
        Manually trigger encryption key rotation. This will generate new encryption keys
        and re-encrypt all secrets, API keys, and settings. This process may take several
        minutes depending on the amount of encrypted data.
      </p>
      <p id="rotation-info">
        <em>Loading rotation status...</em>
      </p>
      <button type="button" id="rotate-keys-btn" class="secondary" disabled>
        Rotate Encryption Keys Now
      </button>
    </article>

    <article>
      <h3>Server Settings</h3>
      <form method="POST" action="/web/settings/server">
        ${renderSettingsForm(data, availableGroups)}
        <div class="grid">
          <button type="submit">Save Settings</button>
          <a href="/web" role="button" class="secondary">Cancel</a>
        </div>
      </form>
    </article>

    <script>
    (async function() {
      const statusEl = document.getElementById('rotation-info');
      const btnEl = document.getElementById('rotate-keys-btn');
      const messageEl = document.getElementById('rotation-status-message');

      // Fetch rotation status
      async function loadStatus() {
        try {
          const response = await fetch('/api/encryption-keys/rotation');
          const data = await response.json();

          if (data.error) {
            statusEl.innerHTML = '<em style="color: var(--pico-del-color);">Failed to load rotation status</em>';
            return;
          }

          const { daysSinceRotation, isInProgress, lastRotationAt } = data;
          const lastRotationDate = new Date(lastRotationAt).toLocaleString();

          if (isInProgress) {
            statusEl.innerHTML = '<strong style="color: var(--pico-primary);">⟳ Key rotation in progress...</strong>';
            btnEl.disabled = true;
          } else {
            statusEl.innerHTML = \`Last rotation: <strong>\${daysSinceRotation} days ago</strong> (\${lastRotationDate})\`;
            btnEl.disabled = false;
          }
        } catch (error) {
          console.error('Failed to load rotation status:', error);
          statusEl.innerHTML = '<em style="color: var(--pico-del-color);">Failed to load rotation status</em>';
        }
      }

      // Trigger rotation
      btnEl.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to rotate encryption keys now? This will re-encrypt all secrets, API keys, and settings.')) {
          return;
        }

        btnEl.disabled = true;
        btnEl.textContent = 'Rotating Keys...';
        messageEl.style.display = 'none';

        try {
          const response = await fetch('/api/encryption-keys/rotation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          const data = await response.json();

          if (response.ok) {
            messageEl.innerHTML = '<article style="background-color: var(--pico-ins-color);"><strong>✓ Success:</strong> ' + data.message + '</article>';
            messageEl.style.display = 'block';
            await loadStatus();
          } else {
            messageEl.innerHTML = '<article style="background-color: var(--pico-del-color);"><strong>✗ Error:</strong> ' + (data.error || 'Unknown error') + '</article>';
            messageEl.style.display = 'block';
            btnEl.disabled = false;
            btnEl.textContent = 'Rotate Encryption Keys Now';
          }
        } catch (error) {
          messageEl.innerHTML = '<article style="background-color: var(--pico-del-color);"><strong>✗ Error:</strong> Network error: ' + error.message + '</article>';
          messageEl.style.display = 'block';
          btnEl.disabled = false;
          btnEl.textContent = 'Rotate Encryption Keys Now';
        }
      });

      // Initial load
      await loadStatus();

      // Refresh status every 10 seconds if rotation in progress
      setInterval(async () => {
        await loadStatus();
      }, 10000);
    })();
    </script>
  `;
}

// Helper: Render settings form grouped by category
function renderSettingsForm(
  data: Record<string, string>,
  availableGroups: ApiKeyGroup[]
): string {
  const categories = Object.entries(SettingsByCategory);

  return categories.map(([categoryName, settingNames]) => {
    const settingsHtml = settingNames.map((name) => {
      const metadata = SettingsMetadata[name];
      const value = data[name] ?? GlobalSettingDefaults[name];

      let inputHtml = "";

      if (metadata.inputType === "select") {
        inputHtml = `
          <select name="${escapeHtml(name)}" required>
            ${metadata.options!.map((opt) => `
              <option value="${escapeHtml(opt)}" ${value === opt ? "selected" : ""}>
                ${escapeHtml(opt)}
              </option>
            `).join("")}
          </select>
        `;
      } else if (metadata.inputType === "number") {
        const attrs = [
          `type="number"`,
          `name="${escapeHtml(name)}"`,
          `value="${escapeHtml(value)}"`,
          `required`,
          metadata.min !== undefined ? `min="${metadata.min}"` : "",
          metadata.max !== undefined ? `max="${metadata.max}"` : "",
        ].filter(Boolean).join(" ");

        inputHtml = `<input ${attrs} />`;
      } else if (metadata.inputType === "checkboxGroup") {
        // Parse currently selected IDs from comma-separated string
        const selectedIds = value
          ? value.split(",").map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id))
          : [];

        if (availableGroups.length === 0) {
          inputHtml = `
            <p><em>No API key groups defined. <a href="/web/keys/create-group">Create a group</a> first.</em></p>
          `;
        } else {
          inputHtml = `
            <fieldset>
              ${availableGroups.map((group) => `
                <label>
                  <input type="checkbox" name="${escapeHtml(name)}" value="${group.id}"
                         ${selectedIds.includes(group.id) ? "checked" : ""}>
                  <strong>${escapeHtml(group.name)}</strong>${group.description ? `: ${escapeHtml(group.description)}` : ""}
                </label>
              `).join("")}
            </fieldset>
          `;
        }
      } else {
        inputHtml = `
          <input type="text"
                 name="${escapeHtml(name)}"
                 value="${escapeHtml(value)}"
                 required />
        `;
      }

      return `
        <label>
          ${escapeHtml(metadata.label)}
          ${inputHtml}
          <small>${escapeHtml(metadata.description)}</small>
        </label>
      `;
    }).join("");

    return `
      <div class="settings-category">
        <h3>${escapeHtml(categoryName)}</h3>
        ${settingsHtml}
      </div>
    `;
  }).join("");
}

// Helper: Parse and validate form data
function parseAndValidateSettings(
  formData: FormData,
  availableGroups: ApiKeyGroup[]
): {
  updates: Record<string, string>;
  errors: string[];
} {
  const updates: Record<string, string> = {};
  const errors: string[] = [];

  // Get valid group IDs for validation
  const validGroupIds = new Set(availableGroups.map((g) => g.id));

  for (const name of Object.values(SettingNames)) {
    const metadata = SettingsMetadata[name];

    if (metadata.inputType === "checkboxGroup") {
      // Handle checkbox groups - getAll for multiple values
      const selectedValues = formData.getAll(name).map((v) => v.toString().trim());
      const selectedIds = selectedValues
        .map((v) => parseInt(v, 10))
        .filter((id) => !isNaN(id) && validGroupIds.has(id));

      // Checkbox groups are optional (empty = no groups selected)
      updates[name] = selectedIds.join(",");
      continue;
    }

    const value = formData.get(name)?.toString().trim() ?? "";

    if (!value) {
      errors.push(`${metadata.label} is required`);
      continue;
    }

    // Type-specific validation
    if (metadata.inputType === "number") {
      const error = validateNumber(value, metadata.label, metadata.min, metadata.max);
      if (error) {
        errors.push(error);
        continue;
      }
    } else if (metadata.inputType === "select") {
      if (!metadata.options?.includes(value as never)) {
        errors.push(`${metadata.label}: Invalid value "${value}"`);
        continue;
      }
    }

    updates[name] = value;
  }

  return { updates, errors };
}

// Helper: Validate number field
function validateNumber(
  value: string,
  label: string,
  min?: number,
  max?: number
): string | null {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return `${label}: Must be a valid number`;
  }
  if (min !== undefined && num < min) {
    return `${label}: Must be at least ${min}`;
  }
  if (max !== undefined && num > max) {
    return `${label}: Must be at most ${max}`;
  }
  return null;
}
