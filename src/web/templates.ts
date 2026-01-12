/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Encodes a string to base64, properly handling UTF-8 characters.
 * Uses TextEncoder for UTF-8 byte conversion.
 */
export function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Formats a date for display.
 */
export function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Formats file size in human-readable format.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * User info for layout.
 */
export interface LayoutUser {
  email: string;
}

/**
 * Session user type from context.
 */
interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

/**
 * Extracts layout user from Hono context.
 * Use this in route handlers to get the user for layout().
 */
// deno-lint-ignore no-explicit-any
export function getLayoutUser(c: any): LayoutUser | undefined {
  const sessionUser = c.get("user") as SessionUser | undefined;
  return sessionUser ? { email: sessionUser.email } : undefined;
}

/**
 * Wraps content in a full HTML page with PicoCSS styling.
 */
export function layout(title: string, content: string, user?: LayoutUser): string {
  const userDropdown = user
    ? `
        <li class="user-dropdown">
          <a href="#" class="user-dropdown-toggle">${escapeHtml(user.email)}</a>
          <ul class="user-dropdown-menu">
            <li><a href="/web/password">Change Password</a></li>
            <li><a href="/web/logout">Logout</a></li>
          </ul>
        </li>
      `
    : `<li><a href="/web/logout">Logout</a></li>`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Crude Functions</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    /* Compact Pico CSS overrides */
    :root {
      --pico-font-size: 92.5%;
      --pico-line-height: 1.25;
      --pico-form-element-spacing-vertical: 0.5rem;
      --pico-form-element-spacing-horizontal: 1.0rem;
    }
    @media (min-width: 576px) {
      :root {
        --pico-font-size: 92.5%;
      }
    }
    .actions { white-space: nowrap; }
    .actions a, .actions button { margin-right: 0.5rem; }
    .key-group { margin-bottom: 1.5rem; }
    .key-group h3 { margin-bottom: 0.5rem; }
    nav ul { margin-bottom: 0; }
    .alert-success {
      padding: 1rem;
      margin-bottom: 1rem;
      border-radius: 0.25rem;
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    .alert-error {
      padding: 1rem;
      margin-bottom: 1rem;
      border-radius: 0.25rem;
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    /* User dropdown styles */
    .user-dropdown {
      position: relative;
    }
    .user-dropdown-toggle {
      cursor: pointer;
    }
    .user-dropdown-menu {
      display: none;
      position: absolute;
      right: 0;
      top: 100%;
      background: var(--pico-background-color);
      border: 1px solid var(--pico-muted-border-color);
      border-radius: 0.25rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      min-width: 160px;
      z-index: 1000;
      padding: 0.5rem 0;
      flex-direction: column;
    }
    .user-dropdown-menu li {
      padding: 0;
    }
    .user-dropdown-menu a {
      display: block;
      padding: 0.5rem 1rem;
    }
    .user-dropdown:hover .user-dropdown-menu {
      display: flex;
    }
    /* Tab navigation styles */
    .tabs {
      display: flex;
      gap: 0.5rem;
      border-bottom: 2px solid var(--pico-muted-border-color);
      margin-bottom: 1.5rem;
    }
    .tabs a {
      padding: 0.75rem 1.5rem;
      text-decoration: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
    }
    .tabs a.active {
      border-bottom-color: var(--pico-primary);
      font-weight: bold;
    }
    /* Settings category card styles */
    .settings-category {
      margin-bottom: 2rem;
      padding: 1rem;
      background: var(--pico-card-background-color);
      border-radius: 0.5rem;
    }
    .settings-category h3 {
      margin-top: 0;
    }
  </style>
</head>
<body>
  <main class="container">
    <nav>
      <ul><li><strong><a href="/web">Crude Functions</a></strong></li></ul>
      <ul>
        <li><a href="/web/code" title="Code Files">📁</a></li>
        <li><a href="/web/functions" title="Functions">⚡</a></li>
        <li><a href="/web/keys" title="API Keys">🔑</a></li>
        <li><a href="/web/secrets" title="Secrets">🔒</a></li>
        <li><a href="/web/users" title="Users">👥</a></li>
        <li><a href="/web/settings" title="Settings">⚙️</a></li>
        ${userDropdown}
      </ul>
    </nav>
    ${content}
  </main>
</body>
</html>`;
}

/**
 * Creates a success or error alert message.
 */
export function alert(type: "success" | "error", message: string): string {
  return `<div class="alert-${type}" role="alert">${escapeHtml(message)}</div>`;
}

/**
 * Creates flash message HTML from query parameters.
 */
export function flashMessages(
  success: string | undefined,
  error: string | undefined
): string {
  let html = "";
  if (success) html += alert("success", success);
  if (error) html += alert("error", error);
  return html;
}

/**
 * Creates a confirmation page for delete actions.
 */
export function confirmPage(
  title: string,
  message: string,
  actionUrl: string,
  cancelUrl: string,
  user?: LayoutUser
): string {
  return layout(
    title,
    `
    <h1>${escapeHtml(title)}</h1>
    <article>
      <p>${escapeHtml(message)}</p>
      <footer>
        <form method="POST" action="${escapeHtml(actionUrl)}" style="display: inline;">
          <button type="submit" class="contrast">Delete</button>
        </form>
        <a href="${escapeHtml(cancelUrl)}" role="button" class="secondary">Cancel</a>
      </footer>
    </article>
  `,
    user
  );
}

/**
 * Creates a button link.
 */
export function buttonLink(
  href: string,
  text: string,
  className = ""
): string {
  return `<a href="${escapeHtml(href)}" role="button" class="${className}">${escapeHtml(text)}</a>`;
}

/**
 * Creates a small inline form with a button for POST actions.
 */
export function postButton(
  action: string,
  text: string,
  className = "secondary outline"
): string {
  return `<form method="POST" action="${escapeHtml(action)}" style="display: inline; margin: 0;">
    <button type="submit" class="${className}" style="padding: 0.25rem 0.5rem; font-size: 0.875rem;">${escapeHtml(text)}</button>
  </form>`;
}

/**
 * Returns JavaScript code for secret visibility toggle and copy functionality.
 * Use this in pages that display secrets with show/hide buttons.
 */
export function secretScripts(): string {
  return `<script>
    function toggleSecret(btn) {
      const container = btn.closest('td') || btn.closest('.secret-value');
      const masked = container.querySelector('.masked');
      const revealed = container.querySelector('.revealed');

      if (masked.style.display === 'none') {
        masked.style.display = '';
        revealed.style.display = 'none';
        btn.textContent = '👁️';
      } else {
        masked.style.display = 'none';
        revealed.style.display = '';
        btn.textContent = '🙈';
      }
    }

    function copySecret(btn, value) {
      navigator.clipboard.writeText(value).then(() => {
        const original = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = original, 2000);
      }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
      });
    }
  </script>`;
}

/**
 * Parse and validate secret create form data.
 */
export function parseSecretFormData(formData: FormData): {
  secretData: { name: string; value: string; comment: string };
  errors: string[];
} {
  const errors: string[] = [];

  const name = formData.get("name")?.toString().trim() ?? "";
  const value = formData.get("value")?.toString() ?? "";
  const comment = formData.get("comment")?.toString().trim() ?? "";

  if (!name) {
    errors.push("Secret name is required");
  } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    errors.push(
      "Secret name can only contain letters, numbers, underscores, and dashes"
    );
  }

  if (!value) {
    errors.push("Secret value is required");
  }

  return {
    secretData: { name, value, comment },
    errors,
  };
}

/**
 * Parse and validate secret edit form data.
 */
export function parseSecretEditFormData(formData: FormData): {
  editData: { value: string; comment: string };
  errors: string[];
} {
  const errors: string[] = [];

  const value = formData.get("value")?.toString() ?? "";
  const comment = formData.get("comment")?.toString().trim() ?? "";

  if (!value) {
    errors.push("Secret value is required");
  }

  return {
    editData: { value, comment },
    errors,
  };
}
