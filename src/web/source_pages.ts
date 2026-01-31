import { Hono } from "@hono/hono";
import type { CodeSourceService } from "../sources/code_source_service.ts";
import type { SourceFileService } from "../files/source_file_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { ErrorStateService } from "../errors/mod.ts";
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
  getCsrfToken,
  formatDate,
  formatSize,
  generateValueButton,
  valueGeneratorScripts,
} from "./templates.ts";
import { csrfInput } from "../csrf/csrf_helpers.ts";

const MAX_EDITABLE_SIZE = 1024 * 1024; // 1 MB

/**
 * CSS styles for CodeMirror integration with Pico CSS.
 * Shared across all file editor pages.
 */
const CODE_EDITOR_STYLES = `
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
    .code-editor .cm-editor {
      min-height: 300px;
      max-height: 600px;
    }
    .code-editor-readonly .cm-editor {
      background: var(--pico-form-element-disabled-background-color);
    }
  </style>
`;

/**
 * Gets the CodeMirror language extension name for a file path.
 * Returns the function name to call from the codemirror bundle.
 */
function getEditorLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "json":
    case "jsonc":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "xml":
      return "xml";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "md":
    case "markdown":
      return "markdown";
    case "surql":
      return "surrealql";
    default:
      return "plain";
  }
}

/**
 * Options for creating the source pages router.
 */
export interface SourcePagesOptions {
  codeSourceService: CodeSourceService;
  sourceFileService: SourceFileService;
  settingsService: SettingsService;
  errorStateService: ErrorStateService;
}

/**
 * Creates web pages for code source management.
 * Mounted at /web/code
 */
export function createSourcePages(options: SourcePagesOptions): Hono {
  const { codeSourceService, sourceFileService, settingsService, errorStateService } = options;
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
   * Checks if a file path is hidden.
   * A path is hidden if any segment starts with a dot.
   * Examples: .env, .git/config, config/.private/key.json
   */
  function isHiddenFile(path: string): boolean {
    const segments = path.split('/');
    return segments.some(segment => segment.startsWith('.'));
  }

  /**
   * Checks if a file is a Git-related file.
   * Git files include: .git/* (entire directory), .gitignore, .gitkeep, .gitattributes
   */
  function isGitFile(path: string): boolean {
    // Check if path starts with .git/ (contents of .git directory)
    if (path.startsWith('.git/')) {
      return true;
    }

    // Check if path is one of the specific git files
    const gitFiles = ['.gitignore', '.gitkeep', '.gitattributes'];
    return gitFiles.includes(path);
  }

  /**
   * Builds URL with query parameters for filter toggles.
   * Preserves other query parameters that should persist.
   */
  function buildFilterUrl(
    sourceId: string,
    currentShowHidden: boolean,
    currentShowGit: boolean,
    toggleFilter: "hidden" | "git"
  ): string {
    const baseUrl = `/web/code/sources/${sourceId}`;
    const params: string[] = [];

    // Toggle the requested filter
    const newShowHidden = toggleFilter === "hidden" ? !currentShowHidden : currentShowHidden;
    const newShowGit = toggleFilter === "git" ? !currentShowGit : currentShowGit;

    // Add params only if they're true (default is false)
    if (newShowHidden) params.push("showhidden=true");
    if (newShowGit) params.push("showgit=true");

    return params.length > 0 ? `${baseUrl}?${params.join("&")}` : baseUrl;
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
   * Parse source ID from route param.
   * Returns null if ID is empty/missing.
   */
  function parseSourceId(idParam: string): string | null {
    return idParam ? idParam : null;
  }

  // ============================================================================
  // Sources List Page
  // ============================================================================

  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const sources = await codeSourceService.getAll();

    const sourceRows = sources.map((source) => {
      // Last sync column content
      let lastSyncContent = "-";
      if (source.type === "git") {
        if (source.lastSyncStartedAt) {
          lastSyncContent = `<span style="color: #1976d2;" title="Sync in progress">Syncing...</span>`;
        } else if (source.lastSyncError) {
          lastSyncContent = `<span style="color: #d32f2f;" title="${escapeHtml(source.lastSyncError)}">Error</span>`;
        } else if (source.lastSyncAt) {
          lastSyncContent = formatDate(source.lastSyncAt);
        } else {
          lastSyncContent = `<span style="color: #856404;">Never</span>`;
        }
      }

      // Action buttons (icons)
      const csrfToken = getCsrfToken(c);
      const syncButton = source.type === "git"
        ? `<form method="POST" action="/web/code/sources/${source.id}/sync" style="display: inline-block; margin: 0; width: auto;">
            ${csrfInput(csrfToken)}
            <button type="submit" class="outline secondary" style="padding: 0.25rem 0.5rem; font-size: 1rem; line-height: 1; width: auto; min-width: auto;" title="Sync" ${source.lastSyncStartedAt ? "disabled" : ""}>
              🔄
            </button>
          </form>`
        : "";

      return `
        <tr>
          <td>
            <a href="/web/code/sources/${source.id}" style="text-decoration: none;">
              <strong>${escapeHtml(source.name)}</strong>
            </a>
            ${!source.enabled ? disabledBadge() : ""}
          </td>
          <td>${sourceTypeBadge(source.type)}</td>
          <td>${lastSyncContent}</td>
          <td style="white-space: nowrap;">
            <a href="/web/code/sources/${source.id}" class="outline" role="button" style="padding: 0.25rem 0.5rem; font-size: 1rem; line-height: 1;" title="View Files">📁</a>
            ${syncButton}
            <a href="/web/code/sources/${source.id}/edit" class="outline secondary" role="button" style="padding: 0.25rem 0.5rem; font-size: 1rem; line-height: 1;" title="Edit">✏️</a>
            <a href="/web/code/sources/${source.id}/delete" class="outline contrast" role="button" style="padding: 0.25rem 0.5rem; font-size: 1rem; line-height: 1;" title="Delete">🗑️</a>
          </td>
        </tr>
      `;
    }).join("");

    const tableContent = sources.length > 0
      ? `<table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Last Sync</th>
              <th style="width: 1%;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${sourceRows}
          </tbody>
        </table>`
      : `<article>
          <p>No code sources configured yet.</p>
          <p>Code sources are directories containing TypeScript handlers that can be executed as HTTP endpoints.</p>
          <footer>
            <a href="/web/code/sources/new" role="button">Create Your First Source</a>
          </footer>
        </article>`;

    const content = `
      <h1>Code Sources</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/code/sources/new", "New Code Source")}
      </p>
      ${tableContent}
    `;

    return c.html(await layout({ title: "Code Sources", content, user: getLayoutUser(c), settingsService, errorStateService }));
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

    return c.html(await layout({ title: "New Code Source", content, user: getLayoutUser(c), settingsService, errorStateService }));
  });

  // ============================================================================
  // Manual Source Creation
  // ============================================================================

  routes.get("/sources/new/manual", async (c) => {
    const error = c.req.query("error");
    const prefilled = c.req.query("name") || "";
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>Create Manual Source</h1>
      ${flashMessages(undefined, error)}
      <p>
        <a href="/web/code/sources/new" role="button" class="secondary outline">Back</a>
      </p>
      <form method="POST" action="/web/code/sources/new/manual">
        ${csrfInput(csrfToken)}
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

    return c.html(await layout({ title: "Create Manual Source", content, user: getLayoutUser(c), settingsService, errorStateService }));
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
    const csrfToken = getCsrfToken(c);

    const content = `
      <h1>Create Git Source</h1>
      ${flashMessages(undefined, error)}
      <p>
        <a href="/web/code/sources/new" role="button" class="secondary outline">Back</a>
      </p>
      <form method="POST" action="/web/code/sources/new/git">
        ${csrfInput(csrfToken)}
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
            <small>HTTPS URL to the Git repository. SSH URLs (git@...) are not supported.</small>
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
            <input type="checkbox" id="intervalEnabled" name="intervalEnabled">
            Enable Scheduled Sync
          </label>
          <small>Automatically sync at regular intervals</small>

          <div id="intervalSettings" style="display: none; margin-left: 1.5rem;">
            <label>
              Sync Interval (seconds)
              <input type="number" name="intervalSeconds" min="60" value="300">
              <small>Minimum recommended: 300 (5 minutes)</small>
            </label>
          </div>

          <label style="margin-top: 1rem;">
            <input type="checkbox" id="webhookEnabled" name="webhookEnabled">
            Enable Webhook Sync
          </label>
          <small>Allow external services (GitHub, GitLab) to trigger syncs via webhook URL</small>

          <div id="webhookSettings" style="display: none; margin-left: 1.5rem;">
            <label>
              Webhook Secret
              <div style="display: flex; align-items: center;">
                <input type="text" id="webhookSecret" name="webhookSecret" placeholder="Optional" style="flex: 1;">
                ${generateValueButton("webhookSecret")}
              </div>
              <small>Optional authentication. Leave empty to allow unauthenticated triggers.</small>
            </label>
          </div>
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

        // Toggle interval settings visibility
        const intervalCheckbox = document.getElementById('intervalEnabled');
        const intervalSettings = document.getElementById('intervalSettings');
        intervalCheckbox.addEventListener('change', function() {
          intervalSettings.style.display = this.checked ? 'block' : 'none';
        });

        // Toggle webhook settings visibility
        const webhookCheckbox = document.getElementById('webhookEnabled');
        const webhookSettings = document.getElementById('webhookSettings');
        webhookCheckbox.addEventListener('change', function() {
          webhookSettings.style.display = this.checked ? 'block' : 'none';
        });
      </script>
    `;

    return c.html(await layout({ title: "Create Git Source", content, user: getLayoutUser(c), settingsService, errorStateService }));
  });

  routes.post("/sources/new/git", async (c) => {
    let body: {
      name?: string;
      url?: string;
      refType?: string;
      refValue?: string;
      authToken?: string;
      intervalEnabled?: string;
      intervalSeconds?: string;
      webhookEnabled?: string;
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
    const intervalEnabled = body.intervalEnabled === "on";
    const intervalSeconds = intervalEnabled ? (parseInt((body.intervalSeconds as string | undefined) ?? "300", 10) || 300) : 0;
    const webhookEnabled = body.webhookEnabled === "on";
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
    if (webhookEnabled) {
      syncSettings.webhookEnabled = true;
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
    const showHidden = c.req.query("showhidden") === "true";
    const showGit = c.req.query("showgit") === "true";

    // Get files for this source
    let allFiles: { path: string; size: number; mtime: Date }[] = [];
    try {
      allFiles = await sourceFileService.listFilesWithMetadata(source.name);
    } catch {
      // Source directory might not exist yet
    }

    // Apply filters based on query parameters
    let files = allFiles;

    if (source.type === "git") {
      // For Git sources: git files are controlled by showGit, other hidden files by showHidden
      files = files.filter(file => {
        const isHidden = isHiddenFile(file.path);
        const isGit = isGitFile(file.path);

        // Git files: respect showGit flag (even if they're hidden)
        if (isGit) {
          return showGit;
        }

        // Non-git hidden files: respect showHidden flag
        if (isHidden) {
          return showHidden;
        }

        // Regular files: always show
        return true;
      });
    } else {
      // For non-Git sources: only apply hidden files filter
      if (!showHidden) {
        files = files.filter(file => !isHiddenFile(file.path));
      }
    }

    const isEditable = await codeSourceService.isEditable(id);
    const csrfToken = getCsrfToken(c);

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
                <form method="POST" action="/web/code/sources/${source.id}/sync" style="display: inline; margin: 0;">
                  ${csrfInput(csrfToken)}
                  <button type="submit" class="outline" style="padding: 0.25rem 0.5rem; margin: 0; line-height: 1.5;" ${source.lastSyncStartedAt ? "disabled" : ""}>
                    ${source.lastSyncStartedAt ? "Syncing..." : "Sync Now"}
                  </button>
                </form>
                <a href="/web/code/sources/${source.id}/edit" role="button" class="outline" style="padding: 0.25rem 0.5rem; margin: 0; line-height: 1.5; display: inline-block;">Edit</a>
                <a href="/web/code/sources/${source.id}/delete" role="button" class="outline contrast" style="padding: 0.25rem 0.5rem; margin: 0; line-height: 1.5; display: inline-block;">Delete</a>
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
            <dd>${source.syncSettings.webhookEnabled
              ? (source.syncSettings.webhookSecret ? "Enabled (with secret)" : "Enabled (no secret)")
              : "Disabled"}</dd>
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
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${files.map((file) => `
              <tr>
                <td><code>${escapeHtml(file.path)}</code></td>
                <td>${formatSize(file.size)}</td>
                <td>${formatDate(file.mtime)}</td>
                <td class="actions">
                  <a href="/web/code/sources/${source.id}/files/view?path=${encodeURIComponent(file.path)}" title="View" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">👁️</a>
                  ${isEditable ? `
                    <a href="/web/code/sources/${source.id}/files/edit?path=${encodeURIComponent(file.path)}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>
                    <a href="/web/code/sources/${source.id}/files/delete?path=${encodeURIComponent(file.path)}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
                  ` : ""}
                </td>
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
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h2 style="margin-bottom: 0;">Files${source.type === "git" ? " (Read-Only)" : ""}</h2>
        <div style="display: flex; gap: 0.25rem;">
          <a href="${buildFilterUrl(source.id, showHidden, showGit, "hidden")}"
             role="button"
             class="outline"
             style="padding: 0.25rem 0.5rem; margin: 0; line-height: 1.5; display: inline-block;">
            ${showHidden ? "Hide hidden files" : "Show hidden files"}
          </a>
          ${source.type === "git" ? `
            <a href="${buildFilterUrl(source.id, showHidden, showGit, "git")}"
               role="button"
               class="outline"
               style="padding: 0.25rem 0.5rem; margin: 0; line-height: 1.5; display: inline-block;">
              ${showGit ? "Hide git files" : "Show git files"}
            </a>
          ` : ""}
        </div>
      </div>
      ${fileActionsSection}
      ${filesTable}
    `;

    return c.html(await layout({ title: `Source: ${source.name}`, content, user: getLayoutUser(c), settingsService, errorStateService }));
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
    const csrfToken = getCsrfToken(c);

    let formContent = "";

    if (source.type === "manual") {
      formContent = `
        <form method="POST" action="/web/code/sources/${source.id}/edit">
          ${csrfInput(csrfToken)}
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
          ${csrfInput(csrfToken)}
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
              <small>HTTPS URL only. SSH URLs (git@...) are not supported.</small>
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
              <input type="checkbox" id="intervalEnabled" name="intervalEnabled" ${source.syncSettings.intervalSeconds && source.syncSettings.intervalSeconds > 0 ? "checked" : ""}>
              Enable Scheduled Sync
            </label>
            <small>Automatically sync at regular intervals</small>

            <div id="intervalSettings" style="display: ${source.syncSettings.intervalSeconds && source.syncSettings.intervalSeconds > 0 ? "block" : "none"}; margin-left: 1.5rem;">
              <label>
                Sync Interval (seconds)
                <input type="number" name="intervalSeconds" min="60" value="${source.syncSettings.intervalSeconds || 300}">
                <small>Minimum recommended: 300 (5 minutes)</small>
              </label>
            </div>

            <label style="margin-top: 1rem;">
              <input type="checkbox" id="webhookEnabled" name="webhookEnabled" ${source.syncSettings.webhookEnabled ? "checked" : ""}>
              Enable Webhook Sync
            </label>
            <small>Allow external services (GitHub, GitLab) to trigger syncs via webhook URL</small>

            <div id="webhookSettings" style="display: ${source.syncSettings.webhookEnabled ? "block" : "none"}; margin-left: 1.5rem;">
              <label>
                Webhook Secret
                <div style="display: flex; align-items: center;">
                  <input type="text" id="webhookSecret" name="webhookSecret"
                         placeholder="${source.syncSettings.webhookSecret ? "(unchanged)" : "Not configured"}" style="flex: 1;">
                  ${generateValueButton("webhookSecret")}
                </div>
                <small>Optional authentication. Leave empty to keep existing or allow unauthenticated triggers.</small>
              </label>

              ${source.syncSettings.webhookSecret ? `
                <label>
                  <input type="checkbox" name="clearWebhookSecret">
                  Remove webhook secret
                </label>
              ` : ""}
            </div>
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

          // Toggle interval settings visibility
          const intervalCheckbox = document.getElementById('intervalEnabled');
          const intervalSettings = document.getElementById('intervalSettings');
          intervalCheckbox.addEventListener('change', function() {
            intervalSettings.style.display = this.checked ? 'block' : 'none';
          });

          // Toggle webhook settings visibility
          const webhookCheckbox = document.getElementById('webhookEnabled');
          const webhookSettings = document.getElementById('webhookSettings');
          webhookCheckbox.addEventListener('change', function() {
            webhookSettings.style.display = this.checked ? 'block' : 'none';
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

    return c.html(await layout({ title: `Edit Source: ${source.name}`, content, user: getLayoutUser(c), settingsService, errorStateService }));
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
      intervalEnabled?: string;
      intervalSeconds?: string;
      webhookEnabled?: string;
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
      const intervalEnabled = body.intervalEnabled === "on";
      const intervalSeconds = intervalEnabled ? (parseInt((body.intervalSeconds as string | undefined) ?? "300", 10) || 300) : 0;
      const webhookEnabled = body.webhookEnabled === "on";
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

      // Handle webhook enabled (checkbox unchecked = explicitly disabled)
      if (webhookEnabled) {
        newSyncSettings.webhookEnabled = true;
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
      await confirmPage({
        title: "Delete Source",
        message: `Are you sure you want to delete the source "${escapeHtml(source.name)}"? This will permanently delete all files in this source. This action cannot be undone.`,
        actionUrl: `/web/code/sources/${source.id}/delete`,
        cancelUrl: `/web/code/sources/${source.id}`,
        user: getLayoutUser(c),
        settingsService,
        errorStateService,
        csrfToken: getCsrfToken(c),
      })
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
    const csrfToken = getCsrfToken(c);

    const content = `
      ${CODE_EDITOR_STYLES}
      <h1>Upload File to ${escapeHtml(source.name)}</h1>
      ${flashMessages(undefined, error)}
      <p>
        <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
      </p>
      <form id="upload-form">
        <label>
          File Path
          <input type="text" name="path" id="path-input" placeholder="e.g., handlers/my-function.ts" required>
          <small>Relative path within the source directory. Syntax highlighting updates based on extension.</small>
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
        <div id="content-label">
          <label>Content</label>
          <div id="code-editor" class="code-editor"></div>
        </div>
        <div class="grid" style="margin-bottom: 0;">
          <button type="submit" id="upload-btn" style="margin-bottom: 0;">Upload</button>
          <a href="/web/code/sources/${source.id}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
        </div>
      </form>
      <script type="module">
        import {
          basicSetup,
          EditorView,
          javascript,
          json,
          yaml,
          toml,
          xml,
          html,
          css,
          markdown,
          surrealql,
          StreamLanguage,
        } from "/static/vendor/codemirror-surrealql.js";

        const sourceId = ${JSON.stringify(source.id)};
        const csrfToken = ${JSON.stringify(csrfToken)};
        let selectedFile = null;
        let editor = null;
        let currentLang = "plain";

        function getLanguageFromPath(filePath) {
          const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
          switch (ext) {
            case "js": case "jsx": case "mjs": case "cjs": return "javascript";
            case "ts": case "tsx": case "mts": case "cts": return "typescript";
            case "json": case "jsonc": return "json";
            case "yaml": case "yml": return "yaml";
            case "toml": return "toml";
            case "xml": return "xml";
            case "html": case "htm": return "html";
            case "css": return "css";
            case "md": case "markdown": return "markdown";
            case "surql": return "surrealql";
            default: return "plain";
          }
        }

        function getLanguageExtension(lang) {
          switch (lang) {
            case "javascript": return javascript();
            case "typescript": return javascript({ typescript: true });
            case "json": return json();
            case "yaml": return yaml();
            case "toml": return StreamLanguage.define(toml);
            case "xml": return xml();
            case "html": return html();
            case "css": return css();
            case "markdown": return markdown();
            case "surrealql": return surrealql();
            default: return [];
          }
        }

        function createEditor(lang) {
          const content = editor ? editor.state.doc.toString() : "";
          if (editor) {
            editor.destroy();
          }
          editor = new EditorView({
            doc: content,
            extensions: [
              basicSetup,
              getLanguageExtension(lang),
              EditorView.lineWrapping,
            ],
            parent: document.getElementById("code-editor"),
          });
          currentLang = lang;
        }

        // Initialize editor
        createEditor("plain");

        // Update language on path change
        let pathDebounce = null;
        document.getElementById('path-input').addEventListener('input', function(e) {
          clearTimeout(pathDebounce);
          pathDebounce = setTimeout(() => {
            const newLang = getLanguageFromPath(e.target.value);
            if (newLang !== currentLang) {
              createEditor(newLang);
            }
          }, 300);
        });

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

          const content = editor.state.doc.toString();
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
              response = await fetch('/api/sources/' + encodeURIComponent(sourceId) + '/files/' + encodeURIComponent(path), {
                method: 'PUT',
                headers: { 'X-CSRF-Token': csrfToken },
                body: formData
              });
            } else {
              response = await fetch('/api/sources/' + encodeURIComponent(sourceId) + '/files/' + encodeURIComponent(path), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
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

    return c.html(await layout({ title: `Upload File - ${source.name}`, content, user: getLayoutUser(c), settingsService, errorStateService }));
  });

  // ============================================================================
  // File View (All Sources)
  // ============================================================================

  routes.get("/sources/:id/files/view", async (c) => {
    const id = parseSourceId(c.req.param("id"));
    if (id === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Invalid source ID"));
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.redirect("/web/code?error=" + encodeURIComponent("Source not found"));
    }

    const path = c.req.query("path");

    if (!path) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent("No file path specified"));
    }

    const bytes = await sourceFileService.getFileBytes(source.name, path);
    if (bytes === null) {
      return c.redirect(`/web/code/sources/${id}?error=` + encodeURIComponent(`File not found: ${path}`));
    }

    const contentType = getContentType(path);
    const isText = isTextContentType(contentType);
    const canViewInTextarea = isText && bytes.length <= MAX_EDITABLE_SIZE;
    const isEditable = await codeSourceService.isEditable(id);

    let pageContent: string;

    if (canViewInTextarea) {
      const fileContent = new TextDecoder().decode(bytes);
      const editButton = isEditable
        ? `<a href="/web/code/sources/${source.id}/files/edit?path=${encodeURIComponent(path)}" role="button" class="secondary">Edit File</a>`
        : "";
      const language = getEditorLanguage(path);

      pageContent = `
        ${CODE_EDITOR_STYLES}
        <h1>View File</h1>
        <p>
          <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
          ${editButton}
        </p>
        <p><strong>Path:</strong> <code>${escapeHtml(path)}</code></p>
        <p><strong>Size:</strong> ${formatSize(bytes.length)}</p>
        <div id="code-editor" class="code-editor code-editor-readonly"></div>
        <p>
          <a href="/api/sources/${encodeURIComponent(source.name)}/files/${encodeURIComponent(path)}" role="button" class="outline" download="${escapeHtml(path.split("/").pop() || path)}">Download</a>
        </p>
        <script type="module">
          import {
            basicSetup,
            EditorView,
            javascript,
            json,
            yaml,
            toml,
            xml,
            html,
            css,
            markdown,
            surrealql,
            StreamLanguage,
          } from "/static/vendor/codemirror-surrealql.js";

          const content = ${JSON.stringify(fileContent)};
          const lang = ${JSON.stringify(language)};

          function getLanguageExtension(lang) {
            switch (lang) {
              case "javascript": return javascript();
              case "typescript": return javascript({ typescript: true });
              case "json": return json();
              case "yaml": return yaml();
              case "toml": return StreamLanguage.define(toml);
              case "xml": return xml();
              case "html": return html();
              case "css": return css();
              case "markdown": return markdown();
              case "surrealql": return surrealql();
              default: return [];
            }
          }

          new EditorView({
            doc: content,
            extensions: [
              basicSetup,
              getLanguageExtension(lang),
              EditorView.lineWrapping,
              EditorView.editable.of(false),
            ],
            parent: document.getElementById("code-editor"),
          });
        </script>
      `;
    } else {
      const reason = !isText
        ? "This is a binary file and cannot be previewed in the browser."
        : "This file is too large to preview in the browser (over 1 MB).";

      const editButton = isEditable
        ? `<a href="/web/code/sources/${source.id}/files/edit?path=${encodeURIComponent(path)}" role="button" class="secondary">Replace File</a>`
        : "";

      pageContent = `
        <h1>View File</h1>
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
            ${editButton}
          </footer>
        </article>
      `;
    }

    return c.html(await layout({ title: `View File - ${source.name}`, content: pageContent, user: getLayoutUser(c), settingsService, errorStateService }));
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
    const csrfToken = getCsrfToken(c);

    let pageContent: string;

    if (canEditInTextarea) {
      const fileContent = new TextDecoder().decode(bytes);
      const language = getEditorLanguage(path);
      pageContent = `
        ${CODE_EDITOR_STYLES}
        <h1>Edit File</h1>
        ${flashMessages(success, error)}
        <p>
          <a href="/web/code/sources/${source.id}" role="button" class="secondary outline">Back</a>
        </p>
        <p><strong>Path:</strong> <code>${escapeHtml(path)}</code></p>
        <form id="edit-form">
          <label>Content</label>
          <div id="code-editor" class="code-editor"></div>
          <p class="keyboard-hint" style="margin-top: 0.5rem;"><kbd>Ctrl</kbd>+<kbd>S</kbd> to save</p>
          <div class="grid" style="margin-bottom: 0;">
            <button type="submit" id="save-btn" style="margin-bottom: 0;">Save</button>
            <a href="/web/code/sources/${source.id}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
          </div>
        </form>
        <style>
          .keyboard-hint {
            font-size: 0.85rem;
            color: var(--pico-muted-color);
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
        </style>
        <script type="module">
          import {
            basicSetup,
            EditorView,
            javascript,
            json,
            yaml,
            toml,
            xml,
            html,
            css,
            markdown,
            surrealql,
            StreamLanguage,
          } from "/static/vendor/codemirror-surrealql.js";

          const initialContent = ${JSON.stringify(fileContent)};
          const lang = ${JSON.stringify(language)};
          const sourceId = ${JSON.stringify(source.id)};
          const filePath = ${JSON.stringify(path)};
          const csrfToken = ${JSON.stringify(csrfToken)};

          function getLanguageExtension(lang) {
            switch (lang) {
              case "javascript": return javascript();
              case "typescript": return javascript({ typescript: true });
              case "json": return json();
              case "yaml": return yaml();
              case "toml": return StreamLanguage.define(toml);
              case "xml": return xml();
              case "html": return html();
              case "css": return css();
              case "markdown": return markdown();
              case "surrealql": return surrealql();
              default: return [];
            }
          }

          const editor = new EditorView({
            doc: initialContent,
            extensions: [
              basicSetup,
              getLanguageExtension(lang),
              EditorView.lineWrapping,
            ],
            parent: document.getElementById("code-editor"),
          });

          async function saveFile() {
            const content = editor.state.doc.toString();
            const btn = document.getElementById('save-btn');

            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const response = await fetch('/api/sources/' + encodeURIComponent(sourceId) + '/files/' + encodeURIComponent(filePath), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
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
          }

          document.getElementById('edit-form').addEventListener('submit', function(e) {
            e.preventDefault();
            saveFile();
          });

          // Ctrl/Cmd+S shortcut
          editor.dom.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault();
              saveFile();
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
          const sourceId = ${JSON.stringify(source.id)};
          const filePath = ${JSON.stringify(path)};
          const csrfToken = ${JSON.stringify(csrfToken)};

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
              const response = await fetch('/api/sources/' + encodeURIComponent(sourceId) + '/files/' + encodeURIComponent(filePath), {
                method: 'PUT',
                headers: { 'X-CSRF-Token': csrfToken },
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

    return c.html(await layout({ title: `Edit: ${path}`, content: pageContent, user: getLayoutUser(c), settingsService, errorStateService }));
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

    const csrfToken = getCsrfToken(c);

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
        const sourceId = ${JSON.stringify(source.id)};
        const filePath = ${JSON.stringify(path)};
        const csrfToken = ${JSON.stringify(csrfToken)};

        document.getElementById('delete-form').addEventListener('submit', async function(e) {
          e.preventDefault();
          const btn = document.getElementById('delete-btn');

          btn.disabled = true;
          btn.textContent = 'Deleting...';

          try {
            const response = await fetch('/api/sources/' + encodeURIComponent(sourceId) + '/files/' + encodeURIComponent(filePath), {
              method: 'DELETE',
              headers: { 'X-CSRF-Token': csrfToken }
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

    return c.html(await layout({ title: "Delete File", content: pageContent, user: getLayoutUser(c), settingsService, errorStateService }));
  });

  return routes;
}
