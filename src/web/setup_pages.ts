import { Hono } from "@hono/hono";
import type { DatabaseService } from "../database/database_service.ts";

/**
 * Options for creating the setup pages router.
 */
export interface SetupPagesOptions {
  /** Database service for user existence check and role update */
  db: DatabaseService;
}

/**
 * Creates the initial setup pages router.
 *
 * Provides the first-run setup wizard for creating the initial admin user.
 * Only accessible when no users exist in the database.
 */
export function createSetupPages(options: SetupPagesOptions): Hono {
  const { db } = options;
  const routes = new Hono();

  // GET /setup - Setup form (only accessible when no users exist)
  routes.get("/", async (c) => {
    // Guard: If users already exist, redirect to login
    const userExists = await db.queryOne<{ id: string }>("SELECT id FROM user LIMIT 1");
    if (userExists) {
      return c.redirect("/web/login");
    }

    const error = c.req.query("error");

    const content = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Setup - Functions Router</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
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
    <article>
      <header>
        <h1>Welcome to Functions Router</h1>
        <p>Create your admin account to get started.</p>
      </header>

      ${error ? `<div class="alert-error" role="alert">${getErrorMessage(error)}</div>` : ""}

      <form id="setup-form">
        <label>
          Name
          <input type="text" name="name" required autofocus placeholder="Admin" />
        </label>
        <label>
          Email
          <input type="email" name="email" required placeholder="admin@example.com" />
        </label>
        <label>
          Password
          <input type="password" name="password" required minlength="8" placeholder="At least 8 characters" />
        </label>
        <button type="submit">Create Account</button>
      </form>

      <div id="setup-error" class="alert-error" role="alert" style="display: none;"></div>
    </article>

    <script>
      const form = document.getElementById('setup-form');
      const errorDiv = document.getElementById('setup-error');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorDiv.style.display = 'none';

        const formData = new FormData(form);
        const name = formData.get('name');
        const email = formData.get('email');
        const password = formData.get('password');

        try {
          // Create account via Better Auth sign-up
          const response = await fetch('/api/auth/sign-up/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password }),
            credentials: 'include'
          });

          if (response.ok) {
            const data = await response.json();
            // Set admin role for the new user
            await fetch('/web/setup/finalize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: data.user.id }),
              credentials: 'include'
            });
            window.location.href = '/web';
          } else {
            const data = await response.json();
            errorDiv.textContent = data.message || 'Failed to create account';
            errorDiv.style.display = 'block';
          }
        } catch (err) {
          errorDiv.textContent = 'An error occurred. Please try again.';
          errorDiv.style.display = 'block';
        }
      });
    </script>
  </main>
</body>
</html>`;

    return c.html(content);
  });

  // POST /setup/finalize - Set admin role after account creation
  routes.post("/finalize", async (c) => {
    // Guard: If more than one user exists, this is not a first-run setup
    const userCount = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM user"
    );
    if (userCount && userCount.count > 1) {
      return c.json({ error: "Setup already complete" }, 403);
    }

    try {
      const body = await c.req.json();
      const userId = body.userId;

      if (!userId) {
        return c.json({ error: "Missing user ID" }, 400);
      }

      // Set permanent userMgmt role for the first user
      await db.execute(
        "UPDATE user SET role = ? WHERE id = ?",
        ["permanent,userMgmt", userId]
      );

      return c.json({ success: true });
    } catch {
      return c.json({ error: "Failed to finalize setup" }, 500);
    }
  });

  return routes;
}

/**
 * Maps error codes to user-friendly messages.
 */
function getErrorMessage(error: string): string {
  switch (error) {
    case "email_exists":
      return "This email is already registered";
    case "weak_password":
      return "Password is too weak. Please use at least 8 characters.";
    default:
      return "An error occurred. Please try again.";
  }
}
