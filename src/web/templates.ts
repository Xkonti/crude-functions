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
 * Wraps content in a full HTML page with PicoCSS styling.
 */
export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Functions Router</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    .actions { white-space: nowrap; }
    .actions a, .actions button { margin-right: 0.5rem; }
    .methods { display: flex; gap: 0.25rem; flex-wrap: wrap; }
    .method-badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      font-size: 0.75rem;
      font-weight: bold;
      border-radius: 0.25rem;
      background: var(--pico-secondary-background);
      color: var(--pico-secondary);
    }
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
  </style>
</head>
<body>
  <main class="container">
    <nav>
      <ul><li><strong><a href="/web">Functions Router</a></strong></li></ul>
      <ul>
        <li><a href="/web/code">Code</a></li>
        <li><a href="/web/functions">Functions</a></li>
        <li><a href="/web/keys">Keys</a></li>
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
  cancelUrl: string
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
  `
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
