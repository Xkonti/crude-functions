import { Hono } from "@hono/hono";
import type { SettingsService } from "../settings/settings_service.ts";
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
}

export function createSettingsPages(options: SettingsPagesOptions): Hono {
  const { settingsService } = options;
  const routes = new Hono();

  // GET / - Main settings page with tab support
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const tab = c.req.query("tab") || "server";

    if (tab === "user") {
      const content = renderUserSettingsTab();
      return c.html(layout("User Settings", content, getLayoutUser(c)));
    }

    // Load all global settings
    const settingsData: Record<string, string> = {};
    for (const name of Object.values(SettingNames)) {
      const value = await settingsService.getGlobalSetting(name);
      settingsData[name] = value ?? GlobalSettingDefaults[name];
    }

    const content = renderServerSettingsTab(settingsData, success, error);
    return c.html(layout("Server Settings", content, getLayoutUser(c)));
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

    const { updates, errors } = parseAndValidateSettings(formData);

    if (errors.length > 0) {
      // Load current values and merge with form data for re-display
      const settingsData: Record<string, string> = {};
      for (const name of Object.values(SettingNames)) {
        settingsData[name] = updates[name] ?? GlobalSettingDefaults[name];
      }

      return c.html(
        layout(
          "Server Settings",
          renderServerSettingsTab(settingsData, undefined, errors.join(". ")),
          getLayoutUser(c)
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
  success?: string,
  error?: string
): string {
  return `
    <h1>Settings</h1>
    ${renderTabs("server")}
    ${flashMessages(success, error)}
    <form method="POST" action="/web/settings/server">
      ${renderSettingsForm(data)}
      <div class="grid">
        <button type="submit">Save Settings</button>
        <a href="/web" role="button" class="secondary">Cancel</a>
      </div>
    </form>
  `;
}

// Helper: Render settings form grouped by category
function renderSettingsForm(data: Record<string, string>): string {
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
function parseAndValidateSettings(formData: FormData): {
  updates: Record<string, string>;
  errors: string[];
} {
  const updates: Record<string, string> = {};
  const errors: string[] = [];

  for (const name of Object.values(SettingNames)) {
    const value = formData.get(name)?.toString().trim() ?? "";
    const metadata = SettingsMetadata[name];

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
