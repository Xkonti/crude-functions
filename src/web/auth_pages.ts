import { Hono } from "@hono/hono";
import type { Auth } from "../auth/auth.ts";
import type { UserService } from "../users/user_service.ts";

/**
 * Options for creating the auth pages router.
 */
export interface AuthPagesOptions {
  /** Better Auth instance */
  auth: Auth;
  /** User service for user existence check and auth operations */
  userService: UserService;
}

/**
 * Creates the authentication pages router.
 *
 * Provides login and logout pages for the Web UI.
 * These routes are public (no auth middleware).
 */
export function createAuthPages(options: AuthPagesOptions): Hono {
  const { userService } = options;
  const routes = new Hono();

  // GET /login - Login form
  routes.get("/login", async (c) => {
    // If no users exist, redirect to setup page
    if (!(await userService.hasUsers())) {
      return c.redirect("/web/setup");
    }

    const callbackUrl = c.req.query("callbackUrl") ?? "/web";
    const error = c.req.query("error");

    const content = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login - Functions Router</title>
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
        <h1>Login</h1>
      </header>

      ${error ? `<div class="alert-error" role="alert">${getErrorMessage(error)}</div>` : ""}

      <form id="login-form">
        <label>
          Email
          <input type="email" name="email" required autofocus />
        </label>
        <label>
          Password
          <input type="password" name="password" required />
        </label>
        <button type="submit">Sign In</button>
      </form>

      <div id="login-error" class="alert-error" role="alert" style="display: none;"></div>
    </article>

    <script>
      const form = document.getElementById('login-form');
      const errorDiv = document.getElementById('login-error');
      const callbackUrl = ${JSON.stringify(callbackUrl)};

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorDiv.style.display = 'none';

        const formData = new FormData(form);
        const email = formData.get('email');
        const password = formData.get('password');

        try {
          const response = await fetch('/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include'
          });

          if (response.ok) {
            window.location.href = callbackUrl;
          } else {
            const data = await response.json();
            errorDiv.textContent = data.message || 'Invalid email or password';
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

  // GET /logout - Logout handler
  routes.get("/logout", async (c) => {
    try {
      // Sign out via UserService
      await userService.signOut(c.req.raw.headers);
    } catch {
      // Ignore errors - user might not have a valid session
    }

    // Redirect to login page
    return c.redirect("/web/login");
  });

  return routes;
}

/**
 * Maps error codes to user-friendly messages.
 */
function getErrorMessage(error: string): string {
  switch (error) {
    case "invalid_credentials":
      return "Invalid email or password";
    case "session_expired":
      return "Your session has expired. Please sign in again.";
    default:
      return "An error occurred. Please try again.";
  }
}
