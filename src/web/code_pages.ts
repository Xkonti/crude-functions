import { Hono } from "@hono/hono";
import type { FileService } from "../files/file_service.ts";
import {
  validateFilePath,
  isPathSafe,
  normalizePath,
} from "../files/file_service.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  formatDate,
  formatSize,
  buttonLink,
  getLayoutUser,
} from "./templates.ts";

export function createCodePages(fileService: FileService): Hono {
  const routes = new Hono();

  // List all files
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const files = await fileService.listFilesWithMetadata();

    const content = `
      <h1>Code Files</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/code/upload", "Upload New File")}
      </p>
      ${
        files.length === 0
          ? "<p>No files found.</p>"
          : `
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Size</th>
              <th>Modified</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${files
              .map(
                (file) => `
              <tr>
                <td><code>${escapeHtml(file.path)}</code></td>
                <td>${formatSize(file.size)}</td>
                <td>${formatDate(file.mtime)}</td>
                <td class="actions">
                  <a href="/web/code/edit?path=${encodeURIComponent(file.path)}">Edit</a>
                  <a href="/web/code/delete?path=${encodeURIComponent(file.path)}">Delete</a>
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      `
      }
    `;
    return c.html(layout("Code Files", content, getLayoutUser(c)));
  });

  // Edit file form
  routes.get("/edit", async (c) => {
    const path = c.req.query("path");
    const error = c.req.query("error");

    if (!path) {
      return c.redirect("/web/code?error=" + encodeURIComponent("No file path specified"));
    }

    const content = await fileService.getFile(path);
    if (content === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent(`File not found: ${path}`));
    }

    const pageContent = `
      <h1>Edit File</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <p><strong>Path:</strong> <code>${escapeHtml(path)}</code></p>
      <form method="POST" action="/web/code/edit?path=${encodeURIComponent(path)}">
        <label>
          Content
          <textarea name="content" rows="20" style="font-family: monospace;">${escapeHtml(content)}</textarea>
        </label>
        <div class="grid">
          <button type="submit">Save</button>
          <a href="/web/code" role="button" class="secondary">Cancel</a>
        </div>
      </form>
    `;
    return c.html(layout(`Edit: ${path}`, pageContent, getLayoutUser(c)));
  });

  // Save file
  routes.post("/edit", async (c) => {
    const path = c.req.query("path");

    if (!path) {
      return c.redirect("/web/code?error=" + encodeURIComponent("No file path specified"));
    }

    // Validate and normalize path (matching upload endpoint validation)
    const normalizedPath = normalizePath(path);

    if (!validateFilePath(normalizedPath)) {
      return c.redirect(
        "/web/code?error=" + encodeURIComponent("Invalid file path format")
      );
    }

    if (!isPathSafe(normalizedPath)) {
      return c.redirect(
        "/web/code?error=" + encodeURIComponent("Path contains invalid characters or traversal")
      );
    }

    let body: { content?: string };
    try {
      body = await c.req.parseBody();
    } catch {
      return c.redirect(
        `/web/code/edit?path=${encodeURIComponent(normalizedPath)}&error=` +
          encodeURIComponent("Invalid form data")
      );
    }

    const content = body.content;
    if (content === undefined) {
      return c.redirect(
        `/web/code/edit?path=${encodeURIComponent(normalizedPath)}&error=` +
          encodeURIComponent("Content is required")
      );
    }

    try {
      await fileService.writeFile(normalizedPath, content as string);
      return c.redirect("/web/code?success=" + encodeURIComponent(`File saved: ${normalizedPath}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save file";
      return c.redirect(
        `/web/code/edit?path=${encodeURIComponent(normalizedPath)}&error=` +
          encodeURIComponent(message)
      );
    }
  });

  // Delete confirmation
  routes.get("/delete", async (c) => {
    const path = c.req.query("path");

    if (!path) {
      return c.redirect("/web/code?error=" + encodeURIComponent("No file path specified"));
    }

    const exists = await fileService.fileExists(path);
    if (!exists) {
      return c.redirect("/web/code?error=" + encodeURIComponent(`File not found: ${path}`));
    }

    return c.html(
      confirmPage(
        "Delete File",
        `Are you sure you want to delete "${path}"? This action cannot be undone.`,
        `/web/code/delete?path=${encodeURIComponent(path)}`,
        "/web/code",
        getLayoutUser(c)
      )
    );
  });

  // Delete file
  routes.post("/delete", async (c) => {
    const path = c.req.query("path");

    if (!path) {
      return c.redirect("/web/code?error=" + encodeURIComponent("No file path specified"));
    }

    try {
      await fileService.deleteFile(path);
      return c.redirect("/web/code?success=" + encodeURIComponent(`File deleted: ${path}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete file";
      return c.redirect("/web/code?error=" + encodeURIComponent(message));
    }
  });

  // Upload form
  routes.get("/upload", (c) => {
    const error = c.req.query("error");

    const content = `
      <h1>Upload New File</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form method="POST" action="/web/code/upload">
        <label>
          File Path
          <input type="text" name="path" placeholder="e.g., handlers/my-function.ts" required>
          <small>Relative path within the code directory</small>
        </label>
        <label>
          Content Source
          <input type="file" id="fileInput" accept=".ts,.js,.json,.css,.html,.txt,.md">
          <small>Select a file to load its contents, or type directly below</small>
        </label>
        <label>
          Content
          <textarea name="content" id="contentArea" rows="15" style="font-family: monospace;" required></textarea>
        </label>
        <div class="grid">
          <button type="submit">Upload</button>
          <a href="/web/code" role="button" class="secondary">Cancel</a>
        </div>
      </form>
      <script>
        document.getElementById('fileInput').addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
              document.getElementById('contentArea').value = e.target.result;
            };
            reader.readAsText(file);
            // Auto-fill path if empty
            const pathInput = document.querySelector('input[name="path"]');
            if (!pathInput.value) {
              pathInput.value = file.name;
            }
          }
        });
      </script>
    `;
    return c.html(layout("Upload File", content, getLayoutUser(c)));
  });

  // Handle upload
  routes.post("/upload", async (c) => {
    let body: { path?: string; content?: string };
    try {
      body = await c.req.parseBody();
    } catch {
      return c.redirect("/web/code/upload?error=" + encodeURIComponent("Invalid form data"));
    }

    const path = body.path as string | undefined;
    const content = body.content as string | undefined;

    if (!path || path.trim() === "") {
      return c.redirect("/web/code/upload?error=" + encodeURIComponent("File path is required"));
    }

    if (content === undefined) {
      return c.redirect("/web/code/upload?error=" + encodeURIComponent("Content is required"));
    }

    const normalizedPath = normalizePath(path);

    if (!validateFilePath(normalizedPath)) {
      return c.redirect(
        "/web/code/upload?error=" + encodeURIComponent("Invalid file path format")
      );
    }

    if (!isPathSafe(normalizedPath)) {
      return c.redirect(
        "/web/code/upload?error=" + encodeURIComponent("Path contains invalid characters or traversal")
      );
    }

    try {
      const created = await fileService.writeFile(normalizedPath, content);
      const action = created ? "created" : "updated";
      return c.redirect(
        "/web/code?success=" + encodeURIComponent(`File ${action}: ${normalizedPath}`)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload file";
      return c.redirect("/web/code/upload?error=" + encodeURIComponent(message));
    }
  });

  return routes;
}
