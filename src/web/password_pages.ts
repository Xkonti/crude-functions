import { Hono } from "@hono/hono";
import { layout, escapeHtml, getLayoutUser } from "./templates.ts";

/**
 * Options for creating the password pages router.
 */
export interface PasswordPagesOptions {
  // No dependencies needed - uses client-side fetch to Better Auth API
}

/**
 * Creates the password change page router.
 *
 * Provides a page for authenticated users to change their password.
 * Follows the same pattern as the login page with client-side fetch.
 */
export function createPasswordPages(_options: PasswordPagesOptions = {}): Hono {
  const routes = new Hono();

  // GET /password - Password change form
  routes.get("/", (c) => {
    const callbackUrl = c.req.query("callbackUrl") ?? "/web";
    const error = c.req.query("error");
    const success = c.req.query("success");

    const content = `
      <article>
        <header>
          <h1>Change Password</h1>
        </header>

        ${success ? `<div class="alert-success" role="alert">${escapeHtml(success)}</div>` : ""}
        ${error ? `<div class="alert-error" role="alert">${escapeHtml(error)}</div>` : ""}

        <form id="password-form">
          <label>
            Current Password
            <input type="password" name="currentPassword" required autofocus />
          </label>
          <label>
            New Password
            <input type="password" name="newPassword" required minlength="8" />
            <small>Minimum 8 characters</small>
          </label>
          <label>
            Confirm New Password
            <input type="password" name="confirmPassword" required minlength="8" />
          </label>
          <button type="submit">Change Password</button>
        </form>

        <div id="password-error" class="alert-error" role="alert" style="display: none;"></div>

        <p style="margin-top: 1rem;">
          <a href="${escapeHtml(callbackUrl)}">&larr; Cancel</a>
        </p>
      </article>

      <script>
        const form = document.getElementById('password-form');
        const errorDiv = document.getElementById('password-error');
        const callbackUrl = ${JSON.stringify(callbackUrl)};

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorDiv.style.display = 'none';

          const formData = new FormData(form);
          const currentPassword = formData.get('currentPassword');
          const newPassword = formData.get('newPassword');
          const confirmPassword = formData.get('confirmPassword');

          // Client-side validation
          if (newPassword !== confirmPassword) {
            errorDiv.textContent = 'New passwords do not match';
            errorDiv.style.display = 'block';
            return;
          }

          if (newPassword.length < 8) {
            errorDiv.textContent = 'New password must be at least 8 characters';
            errorDiv.style.display = 'block';
            return;
          }

          try {
            const response = await fetch('/api/auth/change-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ currentPassword, newPassword }),
              credentials: 'include'
            });

            if (response.ok) {
              // Redirect with success message
              window.location.href = callbackUrl + (callbackUrl.includes('?') ? '&' : '?') + 'success=' + encodeURIComponent('Password changed successfully');
            } else {
              const data = await response.json();
              errorDiv.textContent = data.message || 'Failed to change password. Please check your current password.';
              errorDiv.style.display = 'block';
            }
          } catch (err) {
            errorDiv.textContent = 'An error occurred. Please try again.';
            errorDiv.style.display = 'block';
          }
        });
      </script>
    `;

    return c.html(layout("Change Password", content, getLayoutUser(c)));
  });

  return routes;
}
