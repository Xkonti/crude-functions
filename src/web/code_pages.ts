import { Hono } from "@hono/hono";
import type { FileService } from "../files/file_service.ts";
import { getContentType, isTextContentType } from "../files/content_type.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  formatDate,
  formatSize,
  buttonLink,
  getLayoutUser,
} from "./templates.ts";

const MAX_EDITABLE_SIZE = 1024 * 1024; // 1 MB

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
                  <a href="/web/code/edit?path=${encodeURIComponent(file.path)}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>
                  <a href="/web/code/delete?path=${encodeURIComponent(file.path)}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
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
    const success = c.req.query("success");

    if (!path) {
      return c.redirect("/web/code?error=" + encodeURIComponent("No file path specified"));
    }

    const bytes = await fileService.getFileBytes(path);
    if (bytes === null) {
      return c.redirect("/web/code?error=" + encodeURIComponent(`File not found: ${path}`));
    }

    const contentType = getContentType(path);
    const isText = isTextContentType(contentType);
    const isEditable = isText && bytes.length <= MAX_EDITABLE_SIZE;

    let pageContent: string;

    if (isEditable) {
      // Text file under size limit - show textarea editor
      const content = new TextDecoder().decode(bytes);
      pageContent = `
        <h1>Edit File</h1>
        ${error ? flashMessages(undefined, error) : ""}
        <p><strong>Path:</strong> <code>${escapeHtml(path)}</code></p>
        <form id="edit-form">
          <label>
            Content
            <textarea name="content" id="content-input" rows="20" style="font-family: monospace;">${escapeHtml(content)}</textarea>
          </label>
          <div class="grid">
            <button type="submit" id="save-btn">Save</button>
            <a href="/web/code" role="button" class="secondary">Cancel</a>
          </div>
        </form>
        <script>
          document.getElementById('edit-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const content = document.getElementById('content-input').value;
            const path = ${JSON.stringify(path)};
            const btn = document.getElementById('save-btn');

            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const response = await fetch('/api/files/' + encodeURIComponent(path), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
              });
              const json = await response.json();

              if (!response.ok) {
                window.location.href = '/web/code/edit?path=' + encodeURIComponent(path) +
                  '&error=' + encodeURIComponent(json.error || 'Failed to save');
                return;
              }
              window.location.href = '/web/code?success=' + encodeURIComponent('File saved: ' + path);
            } catch (err) {
              window.location.href = '/web/code/edit?path=' + encodeURIComponent(path) +
                '&error=' + encodeURIComponent(err.message || 'Network error');
            }
          });
        </script>
      `;
    } else {
      // Binary file or large text file - show file info and replace option
      const reason = !isText
        ? "This is a binary file and cannot be edited in the browser."
        : "This file is too large to edit in the browser (over 1 MB).";

      pageContent = `
        <h1>Edit File</h1>
        ${flashMessages(success, error)}
        <article>
          <header><strong>File Information</strong></header>
          <p><strong>Path:</strong> <code>${escapeHtml(path)}</code></p>
          <p><strong>Size:</strong> ${formatSize(bytes.length)}</p>
          <p><strong>Type:</strong> ${escapeHtml(contentType)}</p>
          <p><small>${reason}</small></p>
          <footer>
            <a href="/api/files/${encodeURIComponent(path)}" role="button" class="secondary" download="${escapeHtml(path.split("/").pop() || path)}">Download</a>
          </footer>
        </article>

        <article>
          <header><strong>Replace File</strong></header>
          <p>Select a new file to replace this one:</p>
          <form id="replace-form">
            <input type="file" id="fileInput" required>
            <div class="grid">
              <button type="submit" id="replace-btn">Replace File</button>
              <a href="/web/code" role="button" class="secondary">Cancel</a>
            </div>
          </form>
        </article>

        <script>
          document.getElementById('replace-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const fileInput = document.getElementById('fileInput');
            const file = fileInput.files[0];
            const path = ${JSON.stringify(path)};
            const btn = document.getElementById('replace-btn');

            if (!file) {
              window.location.href = '/web/code/edit?path=' + encodeURIComponent(path) +
                '&error=' + encodeURIComponent('Please select a file');
              return;
            }

            btn.disabled = true;
            btn.textContent = 'Replacing...';

            try {
              const formData = new FormData();
              formData.append('file', file);
              const response = await fetch('/api/files/' + encodeURIComponent(path), {
                method: 'PUT',
                body: formData
              });
              const json = await response.json();

              if (!response.ok) {
                window.location.href = '/web/code/edit?path=' + encodeURIComponent(path) +
                  '&error=' + encodeURIComponent(json.error || 'Failed to replace file');
                return;
              }
              window.location.href = '/web/code/edit?path=' + encodeURIComponent(path) +
                '&success=' + encodeURIComponent('File replaced successfully');
            } catch (err) {
              window.location.href = '/web/code/edit?path=' + encodeURIComponent(path) +
                '&error=' + encodeURIComponent(err.message || 'Network error');
            }
          });
        </script>
      `;
    }

    return c.html(layout(`Edit: ${path}`, pageContent, getLayoutUser(c)));
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

    const pageContent = `
      <h1>Delete File</h1>
      <article>
        <p>Are you sure you want to delete "<code>${escapeHtml(path)}</code>"?</p>
        <p><small>This action cannot be undone.</small></p>
        <footer>
          <form id="delete-form" style="display:inline;">
            <button type="submit" id="delete-btn" class="contrast">Delete</button>
          </form>
          <a href="/web/code" role="button" class="secondary">Cancel</a>
        </footer>
      </article>
      <script>
        document.getElementById('delete-form').addEventListener('submit', async function(e) {
          e.preventDefault();
          const path = ${JSON.stringify(path)};
          const btn = document.getElementById('delete-btn');

          btn.disabled = true;
          btn.textContent = 'Deleting...';

          try {
            const response = await fetch('/api/files/' + encodeURIComponent(path), {
              method: 'DELETE'
            });
            const json = await response.json();

            if (!response.ok) {
              window.location.href = '/web/code?error=' + encodeURIComponent(json.error || 'Failed to delete');
              return;
            }
            window.location.href = '/web/code?success=' + encodeURIComponent('File deleted: ' + path);
          } catch (err) {
            window.location.href = '/web/code?error=' + encodeURIComponent(err.message || 'Network error');
          }
        });
      </script>
    `;
    return c.html(layout("Delete File", pageContent, getLayoutUser(c)));
  });

  // Upload form
  routes.get("/upload", (c) => {
    const error = c.req.query("error");

    const content = `
      <h1>Upload New File</h1>
      ${error ? flashMessages(undefined, error) : ""}
      <form id="upload-form">
        <label>
          File Path
          <input type="text" name="path" id="path-input" placeholder="e.g., handlers/my-function.ts" required>
          <small>Relative path within the code directory</small>
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
        <div class="grid">
          <button type="submit" id="upload-btn">Upload</button>
          <a href="/web/code" role="button" class="secondary">Cancel</a>
        </div>
      </form>
      <script>
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

        // File picker handler
        document.getElementById('fileInput').addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (file) {
            showFileMode(file);
            // Auto-fill path if empty
            const pathInput = document.getElementById('path-input');
            if (!pathInput.value) {
              pathInput.value = file.name;
            }
          }
        });

        // Clear file button
        document.getElementById('clear-file-btn').addEventListener('click', function(e) {
          e.preventDefault();
          showTextMode();
        });

        // Form submit handler
        document.getElementById('upload-form').addEventListener('submit', async function(e) {
          e.preventDefault();
          const path = document.getElementById('path-input').value.trim();
          const btn = document.getElementById('upload-btn');

          if (!path) {
            window.location.href = '/web/code/upload?error=' + encodeURIComponent('File path is required');
            return;
          }

          // Require either a file or content
          const content = document.getElementById('content-input').value;
          if (!selectedFile && !content) {
            window.location.href = '/web/code/upload?error=' + encodeURIComponent('Please select a file or enter content');
            return;
          }

          btn.disabled = true;
          btn.textContent = 'Uploading...';

          try {
            let response;
            if (selectedFile) {
              // Upload file directly via multipart/form-data
              const formData = new FormData();
              formData.append('file', selectedFile);
              response = await fetch('/api/files/' + encodeURIComponent(path), {
                method: 'PUT',
                body: formData
              });
            } else {
              // Upload text content via JSON
              response = await fetch('/api/files/' + encodeURIComponent(path), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
              });
            }
            const json = await response.json();

            if (!response.ok) {
              window.location.href = '/web/code/upload?error=' + encodeURIComponent(json.error || 'Failed to upload');
              return;
            }
            const action = json.created ? 'created' : 'updated';
            window.location.href = '/web/code?success=' + encodeURIComponent('File ' + action + ': ' + path);
          } catch (err) {
            window.location.href = '/web/code/upload?error=' + encodeURIComponent(err.message || 'Network error');
          }
        });
      </script>
    `;
    return c.html(layout("Upload File", content, getLayoutUser(c)));
  });

  return routes;
}
