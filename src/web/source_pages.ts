import { Hono } from "@hono/hono";
import type { CodeSourceService } from "../sources/code_source_service.ts";
import type { SourceFileService } from "../files/source_file_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type {
  CodeSource,
  GitTypeSettings,
  SyncSettings,
  NewCodeSource,
  UpdateCodeSource,
} from "../sources/types.ts";
import {
  DuplicateSourceError,
  InvalidSourceConfigError,
  SourceNotSyncableError,
} from "../sources/errors.ts";
import { getContentType, isTextContentType } from "../files/content_type.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
  getLayoutUser,
  formatDate,
  formatSize,
  generateValueButton,
  valueGeneratorScripts,
} from "./templates.ts";

const MAX_EDITABLE_SIZE = 1024 * 1024; // 1 MB

/**
 * Creates web pages for code source management.
 * Mounted at /web/code
 */
export function createSourcePages(
  codeSourceService: CodeSourceService,
  sourceFileService: SourceFileService,
  settingsService: SettingsService
): Hono {
  const routes = new Hono();

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Badge for source type display
   */
  function sourceTypeBadge(type: "manual" | "git"): string {
    const labels = {
      manual: { text: "Manual", color: "#1565c0", bg: "#e3f2fd" },
      git: { text: "Git", color: "#7b1fa2", bg: "#f3e5f5" },
    };
    const { text, color, bg } = labels[type];
    return `<span style="display: inline-block; padding: 0.15rem 0.4rem; font-size: 0.75rem; border-radius: 0.25rem; margin-left: 0.5rem; background: ${bg}; color: ${color};">${escapeHtml(text)}</span>`;
  }

  /**
   * Badge for disabled state
   */
  function disabledBadge(): string {
    return `<span style="display: inline-block; padding: 0.15rem 0.4rem; font-size: 0.75rem; border-radius: 0.25rem; margin-left: 0.5rem; background: #ffebee; color: #c62828;">Disabled</span>`;
  }

  /**
   * Display git reference (branch/tag/commit)
   */
  function gitRefDisplay(settings: GitTypeSettings): string {
    if (settings.commit) return `Commit: <code>${escapeHtml(settings.commit.substring(0, 8))}...</code>`;
    if (settings.tag) return `Tag: <code>${escapeHtml(settings.tag)}</code>`;
    return `Branch: <code>${escapeHtml(settings.branch || "main")}</code>`;
  }

  /**
   * Determine current ref type from settings
   */
  function getRefType(settings: GitTypeSettings): "branch" | "tag" | "commit" {
    if (settings.commit) return "commit";
    if (settings.tag) return "tag";
    return "branch";
  }

  /**
   * Get current ref value from settings
   */
  function getRefValue(settings: GitTypeSettings): string {
    if (settings.commit) return settings.commit;
    if (settings.tag) return settings.tag;
    return settings.branch || "";
  }

  /**
   * Sync status display section
   */
  function syncStatusSection(source: CodeSource): string {
    if (source.lastSyncStartedAt) {
      return `<div style="padding: 1rem; margin-bottom: 1rem; border-radius: 0.25rem; background: #e3f2fd; color: #1565c0; border: 1px solid #bbdefb;">
        <strong>Sync in progress</strong> - Started ${formatDate(source.lastSyncStartedAt)}
      </div>`;
    }
    if (source.lastSyncError) {
      let msg = `<div style="padding: 1rem; margin-bottom: 1rem; border-radius: 0.25rem; background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;">
        <strong>Last sync failed:</strong> ${escapeHtml(source.lastSyncError)}`;
      if (source.lastSyncAt) {
        msg += `<br><small>Last successful sync: ${formatDate(source.lastSyncAt)}</small>`;
      }
      msg += `</div>`;
      return msg;
    }
    if (source.lastSyncAt) {
      return `<div style="padding: 1rem; margin-bottom: 1rem; border-radius: 0.25rem; background: #d4edda; color: #155724; border: 1px solid #c3e6cb;">
        <strong>Last sync:</strong> ${formatDate(source.lastSyncAt)}
      </div>`;
    }
    return `<div style="padding: 1rem; margin-bottom: 1rem; border-radius: 0.25rem; background: #fff3cd; color: #856404; border: 1px solid #ffeeba;">
      <strong>Never synced</strong> - Click "Sync Now" to fetch files from the repository.
    </div>`;
  }

  /**
   * Parse and validate source ID from route param
   */
  function parseSourceId(idParam: string): number | null {
    const id = parseInt(idParam, 10);
    return isNaN(id) ? null : id;
  }

  // ============================================================================
  // Sources List Page
  // ============================================================================

  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const sources = await codeSourceService.getAll();

    const sourceCards = sources.map((source) => {
      const gitSettings = source.type === "git" ? source.typeSettings as GitTypeSettings : null;

      let infoSection = "";
      if (source.type === "git" && gitSettings) {
        infoSection = `<p style="margin: 0.5rem 0;"><small>
          <strong>Repository:</strong> <code>${escapeHtml(gitSettings.url)}</code>
          <br><strong>Ref:</strong> ${gitRefDisplay(gitSettings)}
          ${source.lastSyncAt ? `<br><strong>Last Sync:</strong> ${formatDate(source.lastSyncAt)}` : ""}
          ${source.lastSyncError ? `<br><span style="color: #d32f2f;"><strong>Sync Error:</strong> ${escapeHtml(source.lastSyncError)}</span>` : ""}
          ${source.lastSyncStartedAt ? `<br><span style="color: #1976d2;"><strong>Syncing...</strong></span>` : ""}
        </small></p>`;
      }

      const syncButton = source.type === "git"
        ? `<form method="POST" action="/web/code/sources/${source.id}/sync" style="display: inline;">
            <button type="submit" class="outline secondary" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;" ${source.lastSyncStartedAt ? "disabled" : ""}>
              ${source.lastSyncStartedAt ? "Syncing..." : "Sync"}
            </button>
          </form>`
        : "";

      return `
        <article style="margin-bottom: 1rem;">
          <header style="padding-bottom: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong>${escapeHtml(source.name)}</strong>
                ${sourceTypeBadge(source.type)}
                ${!source.enabled ? disabledBadge() : ""}
              </div>
              <div style="display: flex; gap: 0.25rem; flex-wrap: wrap;">
                ${syncButton}
                <a href="/web/code/sources/${source.id}/edit" role="button" class="outline secondary" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Edit</a>
                <a href="/web/code/sources/${source.id}/delete" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">Delete</a>
              </div>
            </div>
          </header>
          ${infoSection}
          <footer style="padding-top: 0.5rem;">
            <a href="/web/code/sources/${source.id}" role="button" class="outline" style="padding: 0.25rem 0.75rem;">View Files</a>
          </footer>
        </article>
      `;
    }).join("");

    const content = `
      <h1>Code Sources</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/code/sources/new", "New Code Source")}
      </p>
      ${sources.length === 0
        ? `<article>
            <p>No code sources configured yet.</p>
            <p>Code sources are directories containing TypeScript handlers that can be executed as HTTP endpoints.</p>
            <footer>
              <a href="/web/code/sources/new" role="button">Create Your First Source</a>
            </footer>
          </article>`
        : sourceCards
      }
    `;

    return c.html(await layout("Code Sources", content, getLayoutUser(c), settingsService));
  });

  // ============================================================================
  // Source Type Selection
  // ============================================================================

  routes.get("/sources/new", async (c) => {
    const content = `
      <h1>New Code Source</h1>
      <p>
        <a href="/web/code" role="button" class="secondary outline">Cancel</a>
      </p>
      <p>Select the type of code source you want to create:</p>
      <div class="grid">
        <article>
          <header><strong>Manual Source</strong></header>
          <p>Upload and manage TypeScript files directly through the web interface.</p>
          <ul>
            <li>Full control over file content</li>
            <li>Upload, edit, and delete files</li>
            <li>Best for: Simple functions, quick prototypes</li>
          </ul>
          <footer>
            <a href="/web/code/sources/new/manual" role="button">Create Manual Source</a>
          </footer>
        </article>
        <article>
          <header><strong>Git Source</strong></header>
          <p>Sync code from a Git repository (GitHub, GitLab, etc.).</p>
          <ul>
            <li>Automatic sync on schedule or webhook</li>
            <li>Support for branches, tags, or commits</li>
            <li>Best for: Production code, version control</li>
          </ul>
          <footer>
            <a href="/web/code/sources/new/git" role="button">Create Git Source</a>
          </footer>
        </article>
      </div>
    `;

    return c.html(await layout("New Code Source", content, getLayoutUser(c), settingsService));
  });

  // ============================================================================
  // Manual Source Creation
  // ============================================================================

  routes.get("/sources/new/manual", async (c) => {
    const error = c.req.query("error");
    const prefilled = c.req.query("name") || "";

    const content = `
      <h1>Create Manual Source</h1>
      ${flashMessages(undefined, error)}
      <p>
        <a href="/web/code/sources/new" role="button" class="secondary outline">Back</a>
      </p>
      <form method="POST" action="/web/code/sources/new/manual">
        <label>
          Source Name *
          <input type="text" name="name" required pattern="^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$"
                 placeholder="my-functions" value="${escapeHtml(prefilled)}" autofocus>
          <small>Alphanumeric characters, hyphens, and underscores. Must start with a letter or number. This becomes the directory name.</small>
        </label>
        <div class="grid" style="margin-bottom: 0;">
          <button type="submit" style="margin-bottom: 0;">Create Source</button>
          <a href="/web/code/sources/new" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
        </div>
      </form>
    `;

    return c.html(await layout("Create Manual Source", content, getLayoutUser(c), settingsService));
  });

  routes.post("/sources/new/manual", async (c) => {
    let body: { name?: string };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect("/web/code/sources/new/manual?error=" + encodeURIComponent("Invalid form data"));
    }

    const name = (body.name as string | undefined)?.trim() ?? "";

    if (!name) {
      return c.redirect("/web/code/sources/new/manual?error=" + encodeURIComponent("Source name is required"));
    }

    const newSource: NewCodeSource = {
      name,
      type: "manual",
      typeSettings: {},
      syncSettings: {},
      enabled: true,
    };

    try {
      const source = await codeSourceService.create(newSource);
      return c.redirect(`/web/code/sources/${source.id}?success=` + encodeURIComponent(`Source '${name}' created successfully`));
    } catch (error) {
      if (error instanceof DuplicateSourceError) {
        return c.redirect(`/web/code/sources/new/manual?name=${encodeURIComponent(name)}&error=` + encodeURIComponent(`Source '${name}' already exists`));
      }
      if (error instanceof InvalidSourceConfigError) {
        return c.redirect(`/web/code/sources/new/manual?name=${encodeURIComponent(name)}&error=` + encodeURIComponent(error.message));
      }
      throw error;
    }
  });

  // ============================================================================
  // Git Source Creation
  // ============================================================================

  routes.get("/sources/new/git", async (c) => {
    const error = c.req.query("error");

    const content = `
      <h1>Create Git Source</h1>
      ${flashMessages(undefined, error)}
      <p>
        <a href="/web/code/sources/new" role="button" class="secondary outline">Back</a>
      </p>
      <form method="POST" action="/web/code/sources/new/git">
        <label>
          Source Name *
          <input type="text" name="name" required pattern="^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$"
                 placeholder="my-repo" autofocus>
          <small>Directory name for this source</small>
        </label>

        <fieldset>
          <legend>Repository Settings</legend>

          <label>
            Repository URL *
            <input type="url" name="url" required placeholder="https://github.com/user/repo.git">
            <small>HTTPS URL to the Git repository</small>
          </label>

          <label>
            Reference Type
            <select name="refType" id="refType">
              <option value="branch" selected>Branch</option>
              <option value="tag">Tag</option>
              <option value="commit">Commit</option>
            </select>
          </label>

          <label id="refValueLabel">
            <span id="refValueLabelText">Branch Name</span>
            <input type="text" name="refValue" placeholder="main">
            <small id="refValueHelp">Leave empty for default (main)</small>
          </label>

          <label>
            Authentication Token
            <input type="password" name="authToken" placeholder="ghp_xxxx..." autocomplete="new-password">
            <small>Personal access token for private repositories (optional)</small>
          </label>
        </fieldset>

        <fieldset>
          <legend>Sync Settings</legend>

          <label>
            Auto-Sync Interval (seconds)
            <input type="number" name="intervalSeconds" min="0" value="0">
            <small>0 = disabled. Minimum recommended: 300 (5 minutes)</small>
          </label>

          <label>
            Webhook Secret
            <div style="display: flex; align-items: center;">
              <input type="text" id="webhookSecret" name="webhookSecret" placeholder="Optional" style="flex: 1;">
              ${generateValueButton("webhookSecret")}
            </div>
            <small>For webhook-triggered syncs. Generate a secure random value.</small>
          </label>
        </fieldset>

        <div class="grid" style="margin-bottom: 0;">
          <button type="submit" style="margin-bottom: 0;">Create Source</button>
          <a href="/web/code/sources/new" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
        </div>
      </form>

      ${valueGeneratorScripts()}

      <script>
        document.getElementById('refType').addEventListener('change', function() {
          const labelText = document.getElementById('refValueLabelText');
          const help = document.getElementById('refValueHelp');
          const input = document.querySelector('input[name="refValue"]');

          switch(this.value) {
            case 'branch':
              labelText.textContent = 'Branch Name';
              input.placeholder = 'main';
              help.textContent = 'Leave empty for default (main)';
              break;
            case 'tag':
              labelText.textContent = 'Tag Name';
              input.placeholder = 'v1.0.0';
              help.textContent = 'Exact tag name';
              break;
            case 'commit':
              labelText.textContent = 'Commit SHA';
              input.placeholder = 'abc123...';
              help.textContent = 'Full or abbreviated commit hash';
              break;
          }
        });
      </script>
    `;

    return c.html(await layout("Create Git Source", content, getLayoutUser(c), settingsService));
  });

  routes.post("/sources/new/git", async (c) => {
    let body: {
      name?: string;
      url?: string;
      refType?: string;
      refValue?: string;
      authToken?: string;
      intervalSeconds?: string;
      webhookSecret?: string;
    };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect("/web/code/sources/new/git?error=" + encodeURIComponent("Invalid form data"));
    }

    const name = (body.name as string | undefined)?.trim() ?? "";
    const url = (body.url as string | undefined)?.trim() ?? "";
    const refType = (body.refType as string | undefined)?.trim() ?? "branch";
    const refValue = (body.refValue as string | undefined)?.trim() ?? "";
    const authToken = (body.authToken as string | undefined)?.trim() || undefined;
    const intervalSeconds = parseInt((body.intervalSeconds as string | undefined) ?? "0", 10) || 0;
    const webhookSecret = (body.webhookSecret as string | undefined)?.trim() || undefined;

    if (!name) {
      return c.redirect("/web/code/sources/new/git?error=" + encodeURIComponent("Source name is required"));
    }

    if (!url) {
      return c.redirect("/web/code/sources/new/git?error=" + encodeURIComponent("Repository URL is required"));
    }

    // Build type settings based on ref type
    const typeSettings: GitTypeSettings = { url };
    if (authToken) {
      typeSettings.authToken = authToken;
    }
    if (refValue) {
      switch (refType) {
        case "branch":
          typeSettings.branch = refValue;
          break;
        case "tag":
          typeSettings.tag = refValue;
          break;
        case "commit":
          typeSettings.commit = refValue;
          break;
      }
    }

    const syncSettings: SyncSettings = {};
    if (intervalSeconds > 0) {
      syncSettings.intervalSeconds = intervalSeconds;
    }
    if (webhookSecret) {
      syncSettings.webhookSecret = webhookSecret;
    }

    const newSource: NewCodeSource = {
      name,
      type: "git",
      typeSettings,
      syncSettings,
      enabled: true,
    };

    try {
      const source = await codeSourceService.create(newSource);
      // Trigger initial sync
      try {
        await codeSourceService.triggerManualSync(source.id);
      } catch {
        // Ignore sync trigger errors - source is created
      }
      return c.redirect(`/web/code/sources/${source.id}?success=` + encodeURIComponent(`Git source '${name}' created. Initial sync started.`));
    } catch (error) {
      if (error instanceof DuplicateSourceError) {
        return c.redirect("/web/code/sources/new/git?error=" + encodeURIComponent(`Source '${name}' already exists`));
      }
      if (error instanceof InvalidSourceConfigError) {
        return c.redirect("/web/code/sources/new/git?error=" + encodeURIComponent(error.message));
      }
      throw error;
    }
  });

  // ============================================================================
  // Source View (Manual and Git)
  // ============================================================================

  routes.get("/sources/:id", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    const success = c.req.query("success");
    const error = c.req.query("error");

    // Get files for this source
    let files: { path: string; size: number; mtime: Date }[] = [];
    try {
      files = await sourceFileService.listFilesWithMetadata(source.name);
    } catch {
      // Source directory might not exist yet
    }

    const isEditable = await codeSourceService.isEditable(id);

    let sourceInfoSection = "";
    let fileActionsSection = "";

    if (source.type === "manual") {
      sourceInfoSection = `
        <article>
          <header>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong>Manual Source</strong>
                ${!source.enabled ? disabledBadge() : ""}
              </div>
              <div style="display: flex; gap: 0.25rem;">
                <a href="/web/code/sources/${source.id}/edit" role="button" class="outline" style="padding: 0.25rem 0.5rem;">Edit</a>
                <a href="/web/code/sources/${source.id}/delete" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem;">Delete</a>
              </div>
            </div>
          </header>
          <p><small>Created: ${formatDate(source.createdAt)} | Updated: ${formatDate(source.updatedAt)}</small></p>
        </article>
      `;
      fileActionsSection = `
        <p>
          <a href="/web/code/sources/${source.id}/files/upload" role="button">Upload New File</a>
        </p>
      `;
    } else if (source.type === "git") {
      const gitSettings = source.typeSettings as GitTypeSettings;
      sourceInfoSection = `
        <article>
          <header>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong>Git Source</strong>
                ${!source.enabled ? disabledBadge() : ""}
              </div>
              <div style="display: flex; gap: 0.25rem;">
                <form method="POST" action="/web/code/sources/${source.id}/sync" style="display: inline;">
                  <button type="submit" class="outline" style="padding: 0.25rem 0.5rem;" ${source.lastSyncStartedAt ? "disabled" : ""}>
                    ${source.lastSyncStartedAt ? "Syncing..." : "Sync Now"}
                  </button>
                </form>
                <a href="/web/code/sources/${source.id}/edit" role="button" class="outline" style="padding: 0.25rem 0.5rem;">Edit</a>
                <a href="/web/code/sources/${source.id}/delete" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem;">Delete</a>
              </div>
            </div>
          </header>
          <dl style="margin-bottom: 0;">
            <dt>Repository</dt>
            <dd><code>${escapeHtml(gitSettings.url)}</code></dd>
            <dt>Reference</dt>
            <dd>${gitRefDisplay(gitSettings)}</dd>
            <dt>Auto-Sync</dt>
            <dd>${source.syncSettings.intervalSeconds && source.syncSettings.intervalSeconds > 0 ? `Every ${source.syncSettings.intervalSeconds} seconds` : "Disabled"}</dd>
            <dt>Webhook</dt>
            <dd>${source.syncSettings.webhookSecret ? "Configured" : "Not configured"}</dd>
          </dl>
          ${syncStatusSection(source)}
        </article>
      `;
      fileActionsSection = `<p><small>Files are managed by Git and cannot be edited here.</small></p>`;
    }

    const filesTable = files.length === 0
      ? `<p>No files in this source.${source.type === "git" && !source.lastSyncAt ? " Run a sync to fetch files." : ""}</p>`
      : `<table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Size</th>
              <th>Modified</th>
              ${isEditable ? '<th class="actions">Actions</th>' : ""}
            </tr>
          </thead>
          <tbody>
            ${files.map((file) => `
              <tr>
                <td><code>${escapeHtml(file.path)}</code></td>
                <td>${formatSize(file.size)}</td>
                <td>${formatDate(file.mtime)}</td>
                ${isEditable ? `
                  <td class="actions">
                    <a href="/web/code/sources/${source.id}/files/edit?path=${encodeURIComponent(file.path)}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>
                    <a href="/web/code/sources/${source.id}/files/delete?path=${encodeURIComponent(file.path)}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
                  </td>
                ` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>`;

    const content = `
      <h1>Source: ${escapeHtml(source.name)}</h1>
      <p>
        <a href="/web/code" role="button" class="secondary outline">Back to Sources</a>
      </p>
      ${flashMessages(success, error)}
      ${sourceInfoSection}
      <h2>Files${source.type === "git" ? " (Read-Only)" : ""}</h2>
      ${fileActionsSection}
      ${filesTable}
    `;

    return c.html(await layout(`Source: ${source.name}`, content, getLayoutUser(c), settingsService));
  });

  // ============================================================================
  // Source Edit
  // ============================================================================

  routes.get("/sources/:id/edit", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    const error = c.req.query("error");

    let formContent = "";

    if (source.type === "manual") {
      formContent = `
        <form method="POST" action="/web/code/sources/${source.id}/edit">
          <label>
            Source Name
            <input type="text" value="${escapeHtml(source.name)}" disabled>
            <small>Source names cannot be changed after creation</small>
          </label>

          <label>
            <input type="checkbox" name="enabled" ${source.enabled ? "checked" : ""}>
            Source Enabled
            <small>Disabled sources are not available for function routing</small>
          </label>

          <div class="grid" style="margin-bottom: 0;">
            <button type="submit" style="margin-bottom: 0;">Save Changes</button>
            <a href="/web/code/sources/${source.id}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
          </div>
        </form>
      `;
    } else if (source.type === "git") {
      const gitSettings = source.typeSettings as GitTypeSettings;
      const currentRefType = getRefType(gitSettings);
      const currentRefValue = getRefValue(gitSettings);

      formContent = `
        <form method="POST" action="/web/code/sources/${source.id}/edit">
          <label>
            Source Name
            <input type="text" value="${escapeHtml(source.name)}" disabled>
            <small>Source names cannot be changed after creation</small>
          </label>

          <fieldset>
            <legend>Repository Settings</legend>

            <label>
              Repository URL *
              <input type="url" name="url" required value="${escapeHtml(gitSettings.url)}">
            </label>

            <label>
              Reference Type
              <select name="refType" id="refType">
                <option value="branch" ${currentRefType === "branch" ? "selected" : ""}>Branch</option>
                <option value="tag" ${currentRefType === "tag" ? "selected" : ""}>Tag</option>
                <option value="commit" ${currentRefType === "commit" ? "selected" : ""}>Commit</option>
              </select>
            </label>

            <label>
              <span id="refValueLabelText">${currentRefType === "branch" ? "Branch Name" : currentRefType === "tag" ? "Tag Name" : "Commit SHA"}</span>
              <input type="text" name="refValue" value="${escapeHtml(currentRefValue)}" placeholder="${currentRefType === "branch" ? "main" : currentRefType === "tag" ? "v1.0.0" : "abc123..."}">
            </label>

            <label>
              Authentication Token
              <input type="password" name="authToken" placeholder="${gitSettings.authToken ? "(unchanged)" : "Not configured"}" autocomplete="new-password">
              <small>Leave empty to keep existing token. Enter new value to change.</small>
            </label>

            ${gitSettings.authToken ? `
              <label>
                <input type="checkbox" name="clearAuthToken">
                Remove authentication token
              </label>
            ` : ""}
          </fieldset>

          <fieldset>
            <legend>Sync Settings</legend>

            <label>
              Auto-Sync Interval (seconds)
              <input type="number" name="intervalSeconds" min="0" value="${source.syncSettings.intervalSeconds || 0}">
              <small>0 = disabled. Minimum recommended: 300 (5 minutes)</small>
            </label>

            <label>
              Webhook Secret
              <div style="display: flex; align-items: center;">
                <input type="text" id="webhookSecret" name="webhookSecret"
                       placeholder="${source.syncSettings.webhookSecret ? "(unchanged)" : "Not configured"}" style="flex: 1;">
                ${generateValueButton("webhookSecret")}
              </div>
              <small>Leave empty to keep existing. Enter new value to change.</small>
            </label>

            ${source.syncSettings.webhookSecret ? `
              <label>
                <input type="checkbox" name="clearWebhookSecret">
                Remove webhook secret
              </label>
            ` : ""}
          </fieldset>

          <label>
            <input type="checkbox" name="enabled" ${source.enabled ? "checked" : ""}>
            Source Enabled
          </label>

          <div class="grid" style="margin-bottom: 0;">
            <button type="submit" style="margin-bottom: 0;">Save Changes</button>
            <a href="/web/code/sources/${source.id}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
          </div>
        </form>

        ${valueGeneratorScripts()}

        <script>
          document.getElementById('refType').addEventListener('change', function() {
            const labelText = document.getElementById('refValueLabelText');
            const input = document.querySelector('input[name="refValue"]');

            switch(this.value) {
              case 'branch':
                labelText.textContent = 'Branch Name';
                input.placeholder = 'main';
                break;
              case 'tag':
                labelText.textContent = 'Tag Name';
                input.placeholder = 'v1.0.0';
                break;
              case 'commit':
                labelText.textContent = 'Commit SHA';
                input.placeholder = 'abc123...';
                break;
            }
          });
        </script>
      `;
    }

    const content = `
      <h1>Edit Source: ${escapeHtml(source.name)}</h1>
      ${flashMessages(undefined, error)}
      <p>
        <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
      </p>
      ${formContent}
    `;

    return c.html(await layout(`Edit Source: ${source.name}`, content, getLayoutUser(c), settingsService));
  });

  routes.post("/sources/:id/edit", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    let body: {
      enabled?: string;
      url?: string;
      refType?: string;
      refValue?: string;
      authToken?: string;
      clearAuthToken?: string;
      intervalSeconds?: string;
      webhookSecret?: string;
      clearWebhookSecret?: string;
    };
    try {
      body = (await c.req.parseBody()) as typeof body;
    } catch {
      return c.redirect(`/web/code/sources/${id}/edit?error=` + encodeURIComponent("Invalid form data"));
    }

    const enabled = body.enabled === "on";
    const updates: UpdateCodeSource = { enabled };

    if (source.type === "git") {
      const gitSettings = source.typeSettings as GitTypeSettings;
      const url = (body.url as string | undefined)?.trim() ?? gitSettings.url;
      const refType = (body.refType as string | undefined)?.trim() ?? "branch";
      const refValue = (body.refValue as string | undefined)?.trim() ?? "";
      const authToken = (body.authToken as string | undefined)?.trim();
      const clearAuthToken = body.clearAuthToken === "on";
      const intervalSeconds = parseInt((body.intervalSeconds as string | undefined) ?? "0", 10) || 0;
      const webhookSecret = (body.webhookSecret as string | undefined)?.trim();
      const clearWebhookSecret = body.clearWebhookSecret === "on";

      // Build updated type settings
      const newTypeSettings: GitTypeSettings = { url };

      // Handle auth token
      if (clearAuthToken) {
        // Don't include authToken
      } else if (authToken) {
        newTypeSettings.authToken = authToken;
      } else if (gitSettings.authToken) {
        newTypeSettings.authToken = gitSettings.authToken;
      }

      // Handle ref (only one can be set)
      if (refValue) {
        switch (refType) {
          case "branch":
            newTypeSettings.branch = refValue;
            break;
          case "tag":
            newTypeSettings.tag = refValue;
            break;
          case "commit":
            newTypeSettings.commit = refValue;
            break;
        }
      }

      updates.typeSettings = newTypeSettings;

      // Build updated sync settings
      const newSyncSettings: SyncSettings = {};
      if (intervalSeconds > 0) {
        newSyncSettings.intervalSeconds = intervalSeconds;
      }

      // Handle webhook secret
      if (clearWebhookSecret) {
        // Don't include webhookSecret
      } else if (webhookSecret) {
        newSyncSettings.webhookSecret = webhookSecret;
      } else if (source.syncSettings.webhookSecret) {
        newSyncSettings.webhookSecret = source.syncSettings.webhookSecret;
      }

      updates.syncSettings = newSyncSettings;
    }

    try {
      await codeSourceService.update(id, updates);
      return c.redirect(`/web/code/sources/${id}?success=` + encodeURIComponent("Source updated successfully"));
    } catch (error) {
      if (error instanceof InvalidSourceConfigError) {
        return c.redirect(`/web/code/sources/${id}/edit?error=` + encodeURIComponent(error.message));
      }
      throw error;
    }
  });

  // ============================================================================
  // Source Delete
  // ============================================================================

  routes.get("/sources/:id/delete", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    return c.html(
      await confirmPage(
        "Delete Source",
        `Are you sure you want to delete the source "${escapeHtml(source.name)}"? This will permanently delete all files in this source. This action cannot be undone.`,
        `/web/code/sources/${source.id}/delete`,
        `/web/code/sources/${source.id}`,
        getLayoutUser(c),
        settingsService
      )
    );
  });

  routes.post("/sources/:id/delete", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    try {
      await codeSourceService.delete(id, true);
      return c.redirect("/web/code?success=" + encodeURIComponent(`Source '${source.name}' deleted successfully`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete source";
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent(message));
    }
  });

  // ============================================================================
  // Sync Trigger (Git Sources)
  // ============================================================================

  routes.post("/sources/:id/sync", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    try {
      const job = await codeSourceService.triggerManualSync(id);
      if (job === null) {
        return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("Sync already in progress"));
      }
      return c.redirect(`/web/code/sources/${id}?success=` + encodeURIComponent("Sync started"));
    } catch (error) {
      if (error instanceof SourceNotSyncableError) {
        return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("This source type does not support syncing"));
      }
      const message = error instanceof Error ? error.message : "Failed to trigger sync";
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent(message));
    }
  });

  // ============================================================================
  // File Upload (Manual Sources Only)
  // ============================================================================

  routes.get("/sources/:id/files/upload", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    const isEditable = await codeSourceService.isEditable(id);
    if (!isEditable) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("This source does not support file uploads"));
    }

    const error = c.req.query("error");

    const content = `
      <h1>Upload File to ${escapeHtml(source.name)}</h1>
      ${flashMessages(undefined, error)}
      <p>
        <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
      </p>
      <form id="upload-form">
        <label>
          File Path
          <input type="text" name="path" id="path-input" placeholder="e.g., handlers/my-function.ts" required>
          <small>Relative path within the source directory</small>
        </label>
        <label>
          Select File
          <input type="file" id="fileInput">
          <small>Select a file to upload, or type content directly below</small>
        </label>
        <div id="file-selected-notice" style="display: none; padding: 1rem; background: var(--pico-card-background-color); border-radius: var(--pico-border-radius); margin-bottom: 1rem;">
          <strong>File selected:</strong> <span id="selected-file-name"></span> (<span id="selected-file-size"></span>)
          <br><small>The file will be uploaded directly.</small>
          <br><a href="#" id="clear-file-btn" style="font-size: 0.875rem;">Clear and type content instead</a>
        </div>
        <label id="content-label">
          Content
          <textarea name="content" id="content-input" rows="15" style="font-family: monospace;"></textarea>
        </label>
        <div class="grid" style="margin-bottom: 0;">
          <button type="submit" id="upload-btn" style="margin-bottom: 0;">Upload</button>
          <a href="/web/code/sources/${source.id}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
        </div>
      </form>
      <script>
        const sourceName = ${JSON.stringify(source.name)};
        const sourceId = ${JSON.stringify(source.id)};
        let selectedFile = null;

        function formatFileSize(bytes) {
          if (bytes < 1024) return bytes + ' B';
          if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
          return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        function showFileMode(file) {
          selectedFile = file;
          document.getElementById('content-label').style.display = 'none';
          document.getElementById('file-selected-notice').style.display = 'block';
          document.getElementById('selected-file-name').textContent = file.name;
          document.getElementById('selected-file-size').textContent = formatFileSize(file.size);
        }

        function showTextMode() {
          selectedFile = null;
          document.getElementById('fileInput').value = '';
          document.getElementById('content-label').style.display = 'block';
          document.getElementById('file-selected-notice').style.display = 'none';
        }

        document.getElementById('fileInput').addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (file) {
            showFileMode(file);
            const pathInput = document.getElementById('path-input');
            if (!pathInput.value) {
              pathInput.value = file.name;
            }
          }
        });

        document.getElementById('clear-file-btn').addEventListener('click', function(e) {
          e.preventDefault();
          showTextMode();
        });

        document.getElementById('upload-form').addEventListener('submit', async function(e) {
          e.preventDefault();
          const path = document.getElementById('path-input').value.trim();
          const btn = document.getElementById('upload-btn');

          if (!path) {
            window.location.href = '/web/code/sources/' + sourceId + '/files/upload?error=' + encodeURIComponent('File path is required');
            return;
          }

          const content = document.getElementById('content-input').value;
          if (!selectedFile && !content) {
            window.location.href = '/web/code/sources/' + sourceId + '/files/upload?error=' + encodeURIComponent('Please select a file or enter content');
            return;
          }

          btn.disabled = true;
          btn.textContent = 'Uploading...';

          try {
            let response;
            if (selectedFile) {
              const formData = new FormData();
              formData.append('file', selectedFile);
              response = await fetch('/api/sources/' + encodeURIComponent(sourceName) + '/files/' + encodeURIComponent(path), {
                method: 'PUT',
                body: formData
              });
            } else {
              response = await fetch('/api/sources/' + encodeURIComponent(sourceName) + '/files/' + encodeURIComponent(path), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
              });
            }
            const json = await response.json();

            if (!response.ok) {
              window.location.href = '/web/code/sources/' + sourceId + '/files/upload?error=' + encodeURIComponent(json.error || 'Failed to upload');
              return;
            }
            const action = json.created ? 'created' : 'updated';
            window.location.href = '/web/code/sources/' + sourceId + '?success=' + encodeURIComponent('File ' + action + ': ' + path);
          } catch (err) {
            window.location.href = '/web/code/sources/' + sourceId + '/files/upload?error=' + encodeURIComponent(err.message || 'Network error');
          }
        });
      </script>
    `;

    return c.html(await layout(`Upload File - ${source.name}`, content, getLayoutUser(c), settingsService));
  });

  // ============================================================================
  // File Edit (Manual Sources Only)
  // ============================================================================

  routes.get("/sources/:id/files/edit", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    const isEditable = await codeSourceService.isEditable(id);
    if (!isEditable) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("This source does not support file editing"));
    }

    const path = c.req.query("path");
    const error = c.req.query("error");
    const success = c.req.query("success");

    if (!path) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("No file path specified"));
    }

    const bytes = await sourceFileService.getFileBytes(source.name, path);
    if (bytes === null) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent(`File not found: ${path}`));
    }

    const contentType = getContentType(path);
    const isText = isTextContentType(contentType);
    const canEditInTextarea = isText && bytes.length <= MAX_EDITABLE_SIZE;

    let pageContent: string;

    if (canEditInTextarea) {
      const fileContent = new TextDecoder().decode(bytes);
      pageContent = `
        <h1>Edit File</h1>
        ${flashMessages(success, error)}
        <p>
          <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
        </p>
        <p><strong>Path:</strong> <code>${escapeHtml(path)}</code></p>
        <form id="edit-form">
          <label>
            Content
            <textarea name="content" id="content-input" rows="20" style="font-family: monospace;">${escapeHtml(fileContent)}</textarea>
          </label>
          <div class="grid" style="margin-bottom: 0;">
            <button type="submit" id="save-btn" style="margin-bottom: 0;">Save</button>
            <a href="/web/code/sources/${source.id}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
          </div>
        </form>
        <script>
          const sourceName = ${JSON.stringify(source.name)};
          const sourceId = ${JSON.stringify(source.id)};
          const filePath = ${JSON.stringify(path)};

          document.getElementById('edit-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const content = document.getElementById('content-input').value;
            const btn = document.getElementById('save-btn');

            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const response = await fetch('/api/sources/' + encodeURIComponent(sourceName) + '/files/' + encodeURIComponent(filePath), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
              });
              const json = await response.json();

              if (!response.ok) {
                window.location.href = '/web/code/sources/' + sourceId + '/files/edit?path=' + encodeURIComponent(filePath) +
                  '&error=' + encodeURIComponent(json.error || 'Failed to save');
                return;
              }
              window.location.href = '/web/code/sources/' + sourceId + '?success=' + encodeURIComponent('File saved: ' + filePath);
            } catch (err) {
              window.location.href = '/web/code/sources/' + sourceId + '/files/edit?path=' + encodeURIComponent(filePath) +
                '&error=' + encodeURIComponent(err.message || 'Network error');
            }
          });
        </script>
      `;
    } else {
      const reason = !isText
        ? "This is a binary file and cannot be edited in the browser."
        : "This file is too large to edit in the browser (over 1 MB).";

      pageContent = `
        <h1>Edit File</h1>
        ${flashMessages(success, error)}
        <p>
          <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
        </p>
        <article>
          <header><strong>File Information</strong></header>
          <p><strong>Path:</strong> <code>${escapeHtml(path)}</code></p>
          <p><strong>Size:</strong> ${formatSize(bytes.length)}</p>
          <p><strong>Type:</strong> ${escapeHtml(contentType)}</p>
          <p><small>${reason}</small></p>
          <footer>
            <a href="/api/sources/${encodeURIComponent(source.name)}/files/${encodeURIComponent(path)}" role="button" class="secondary" download="${escapeHtml(path.split("/").pop() || path)}">Download</a>
          </footer>
        </article>

        <article>
          <header><strong>Replace File</strong></header>
          <p>Select a new file to replace this one:</p>
          <form id="replace-form">
            <input type="file" id="fileInput" required>
            <div class="grid" style="margin-bottom: 0;">
              <button type="submit" id="replace-btn" style="margin-bottom: 0;">Replace File</button>
              <a href="/web/code/sources/${source.id}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
            </div>
          </form>
        </article>

        <script>
          const sourceName = ${JSON.stringify(source.name)};
          const sourceId = ${JSON.stringify(source.id)};
          const filePath = ${JSON.stringify(path)};

          document.getElementById('replace-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const fileInput = document.getElementById('fileInput');
            const file = fileInput.files[0];
            const btn = document.getElementById('replace-btn');

            if (!file) {
              window.location.href = '/web/code/sources/' + sourceId + '/files/edit?path=' + encodeURIComponent(filePath) +
                '&error=' + encodeURIComponent('Please select a file');
              return;
            }

            btn.disabled = true;
            btn.textContent = 'Replacing...';

            try {
              const formData = new FormData();
              formData.append('file', file);
              const response = await fetch('/api/sources/' + encodeURIComponent(sourceName) + '/files/' + encodeURIComponent(filePath), {
                method: 'PUT',
                body: formData
              });
              const json = await response.json();

              if (!response.ok) {
                window.location.href = '/web/code/sources/' + sourceId + '/files/edit?path=' + encodeURIComponent(filePath) +
                  '&error=' + encodeURIComponent(json.error || 'Failed to replace file');
                return;
              }
              window.location.href = '/web/code/sources/' + sourceId + '/files/edit?path=' + encodeURIComponent(filePath) +
                '&success=' + encodeURIComponent('File replaced successfully');
            } catch (err) {
              window.location.href = '/web/code/sources/' + sourceId + '/files/edit?path=' + encodeURIComponent(filePath) +
                '&error=' + encodeURIComponent(err.message || 'Network error');
            }
          });
        </script>
      `;
    }

    return c.html(await layout(`Edit: ${path}`, pageContent, getLayoutUser(c), settingsService));
  });

  // ============================================================================
  // File Delete (Manual Sources Only)
  // ============================================================================

  routes.get("/sources/:id/files/delete", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    const isEditable = await codeSourceService.isEditable(id);
    if (!isEditable) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("This source does not support file deletion"));
    }

    const path = c.req.query("path");
    if (!path) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("No file path specified"));
    }

    const exists = await sourceFileService.fileExists(source.name, path);
    if (!exists) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent(`File not found: ${path}`));
    }

    const pageContent = `
      <h1>Delete File</h1>
      <p>
        <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
      </p>
      <article>
        <p>Are you sure you want to delete "<code>${escapeHtml(path)}</code>" from source "${escapeHtml(source.name)}"?</p>
        <p><small>This action cannot be undone.</small></p>
        <footer>
          <form id="delete-form" style="display:inline;">
            <button type="submit" id="delete-btn" class="contrast">Delete</button>
          </form>
          <a href="/web/code/sources/${source.id}" role="button" class="secondary">Cancel</a>
        </footer>
      </article>
      <script>
        const sourceName = ${JSON.stringify(source.name)};
        const sourceId = ${JSON.stringify(source.id)};
        const filePath = ${JSON.stringify(path)};

        document.getElementById('delete-form').addEventListener('submit', async function(e) {
          e.preventDefault();
          const btn = document.getElementById('delete-btn');

          btn.disabled = true;
          btn.textContent = 'Deleting...';

          try {
            const response = await fetch('/api/sources/' + encodeURIComponent(sourceName) + '/files/' + encodeURIComponent(filePath), {
              method: 'DELETE'
            });
            const json = await response.json();

            if (!response.ok) {
              window.location.href = '/web/code/sources/' + sourceId + '?error=' + encodeURIComponent(json.error || 'Failed to delete');
              return;
            }
            window.location.href = '/web/code/sources/' + sourceId + '?success=' + encodeURIComponent('File deleted: ' + filePath);
          } catch (err) {
            window.location.href = '/web/code/sources/' + sourceId + '?error=' + encodeURIComponent(err.message || 'Network error');
          }
        });
      </script>
    `;

    return c.html(await layout("Delete File", pageContent, getLayoutUser(c), settingsService));
  });

  return routes;
}
