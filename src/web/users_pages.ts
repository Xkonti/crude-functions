import { Hono } from "@hono/hono";
import type { UserService } from "../users/user_service.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
  formatDate,
  getLayoutUser,
} from "./templates.ts";

/**
 * Session user type from Better Auth context.
 */
interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

/**
 * Options for creating the users pages router.
 */
export interface UsersPagesOptions {
  userService: UserService;
}

/**
 * Creates the users management page router.
 *
 * Provides CRUD operations for user management.
 */
export function createUsersPages(options: UsersPagesOptions): Hono {
  const { userService } = options;
  const routes = new Hono();

  /**
   * Helper to get session user from context.
   */
  // deno-lint-ignore no-explicit-any
  function getSessionUser(c: any): SessionUser | undefined {
    return c.get("user") as SessionUser | undefined;
  }

  // GET / - List all users
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const currentUser = getSessionUser(c);

    const users = await userService.getAll();

    const content = `
      <h1>Users</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/users/create", "Create New User")}
      </p>
      ${
        users.length === 0
          ? "<p>No users found.</p>"
          : `
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Created</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (user) => `
              <tr>
                <td><strong>${escapeHtml(user.email)}</strong>${user.id === currentUser?.id ? " <em>(you)</em>" : ""}</td>
                <td>${user.name ? escapeHtml(user.name) : "<em>-</em>"}</td>
                <td><code>${user.roles.length > 0 ? escapeHtml(user.roles.join(", ")) : "<em>none</em>"}</code></td>
                <td>${formatDate(user.createdAt)}</td>
                <td class="actions">
                  <a href="/web/users/edit/${encodeURIComponent(user.id)}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>
                  ${user.id !== currentUser?.id ? `<a href="/web/users/delete/${encodeURIComponent(user.id)}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>` : ""}
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
    return c.html(layout("Users", content, getLayoutUser(c)));
  });

  // GET /create - Create user form
  routes.get("/create", (c) => {
    const error = c.req.query("error");
    return c.html(layout("Create User", renderUserForm("/web/users/create", {}, error), getLayoutUser(c)));
  });

  // POST /create - Handle user creation
  routes.post("/create", async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect("/web/users/create?error=" + encodeURIComponent("Invalid form data"));
    }

    const { userData, errors } = parseCreateFormData(formData);

    if (errors.length > 0) {
      return c.html(
        layout("Create User", renderUserForm("/web/users/create", userData, errors.join(". ")), getLayoutUser(c)),
        400
      );
    }

    try {
      // Create user via UserService
      await userService.createUser({
        email: userData.email,
        password: userData.password,
        name: userData.name || undefined,
        role: userData.role || undefined,
      }, c.req.raw.headers);

      return c.redirect("/web/users?success=" + encodeURIComponent(`User created: ${userData.email}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create user";
      return c.html(
        layout("Create User", renderUserForm("/web/users/create", userData, message), getLayoutUser(c)),
        400
      );
    }
  });

  // GET /edit/:id - Edit user form
  routes.get("/edit/:id", async (c) => {
    const userId = c.req.param("id");
    const error = c.req.query("error");

    const user = await userService.getById(userId);

    if (!user) {
      return c.redirect("/web/users?error=" + encodeURIComponent("User not found"));
    }

    return c.html(
      layout(
        `Edit: ${user.email}`,
        renderEditForm(`/web/users/edit/${encodeURIComponent(userId)}`, user, error),
        getLayoutUser(c)
      )
    );
  });

  // POST /edit/:id - Handle user update
  routes.post("/edit/:id", async (c) => {
    const userId = c.req.param("id");

    const user = await userService.getById(userId);

    if (!user) {
      return c.redirect("/web/users?error=" + encodeURIComponent("User not found"));
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/users/edit/${encodeURIComponent(userId)}?error=` + encodeURIComponent("Invalid form data")
      );
    }

    const { editData, errors } = parseEditFormData(formData);

    if (errors.length > 0) {
      return c.html(
        layout(
          `Edit: ${user.email}`,
          renderEditForm(`/web/users/edit/${encodeURIComponent(userId)}`, { ...user, ...editData }, errors.join(". ")),
          getLayoutUser(c)
        ),
        400
      );
    }

    try {
      // Update user via UserService
      await userService.updateUser(userId, {
        password: editData.password || undefined,
        role: editData.role,
      }, c.req.raw.headers);

      return c.redirect("/web/users?success=" + encodeURIComponent(`User updated: ${user.email}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update user";
      return c.html(
        layout(
          `Edit: ${user.email}`,
          renderEditForm(`/web/users/edit/${encodeURIComponent(userId)}`, { ...user, ...editData }, message),
          getLayoutUser(c)
        ),
        400
      );
    }
  });

  // GET /delete/:id - Delete confirmation
  routes.get("/delete/:id", async (c) => {
    const userId = c.req.param("id");
    const currentUser = getSessionUser(c);

    // Prevent deleting yourself
    if (userId === currentUser?.id) {
      return c.redirect("/web/users?error=" + encodeURIComponent("You cannot delete your own account"));
    }

    const user = await userService.getById(userId);

    if (!user) {
      return c.redirect("/web/users?error=" + encodeURIComponent("User not found"));
    }

    return c.html(
      confirmPage(
        "Delete User",
        `Are you sure you want to delete the user "${user.email}"? This action cannot be undone.`,
        `/web/users/delete/${encodeURIComponent(userId)}`,
        "/web/users",
        getLayoutUser(c)
      )
    );
  });

  // POST /delete/:id - Handle deletion
  routes.post("/delete/:id", async (c) => {
    const userId = c.req.param("id");
    const currentUser = getSessionUser(c);

    // Prevent deleting yourself
    if (userId === currentUser?.id) {
      return c.redirect("/web/users?error=" + encodeURIComponent("You cannot delete your own account"));
    }

    try {
      // Delete user via UserService (handles permanent role check)
      await userService.deleteUser(userId, c.req.raw.headers);

      const user = await userService.getById(userId);
      return c.redirect("/web/users?success=" + encodeURIComponent(`User deleted`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete user";
      return c.redirect("/web/users?error=" + encodeURIComponent(message));
    }
  });

  return routes;
}

/**
 * Renders the create user form.
 */
function renderUserForm(
  action: string,
  data: { email?: string; name?: string; role?: string } = {},
  error?: string
): string {
  return `
    <h1>Create User</h1>
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="${escapeHtml(action)}">
      <label>
        Email
        <input type="email" name="email" value="${escapeHtml(data.email ?? "")}"
               required autofocus placeholder="user@example.com" />
      </label>
      <label>
        Name
        <input type="text" name="name" value="${escapeHtml(data.name ?? "")}"
               placeholder="Optional display name" />
      </label>
      <label>
        Password
        <input type="password" name="password" required minlength="8" />
        <small>Minimum 8 characters</small>
      </label>
      <label>
        Confirm Password
        <input type="password" name="confirmPassword" required minlength="8" />
      </label>
      <label>
        Role
        <input type="text" name="role" value="${escapeHtml(data.role ?? "")}"
               placeholder="e.g., userMgmt or permanent,userMgmt" />
        <small>Role string (e.g., "userMgmt" for user management access, comma-separated for multiple roles)</small>
      </label>
      <div class="grid">
        <button type="submit">Create User</button>
        <a href="/web/users" role="button" class="secondary">Cancel</a>
      </div>
    </form>
  `;
}

/**
 * Renders the edit user form.
 */
function renderEditForm(
  action: string,
  user: { email: string; name?: string; roles?: string[] },
  error?: string
): string {
  const roleString = user.roles ? user.roles.join(",") : "";
  return `
    <h1>Edit User</h1>
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="${escapeHtml(action)}">
      <label>
        Email
        <input type="email" value="${escapeHtml(user.email)}" disabled />
        <small>Email cannot be changed</small>
      </label>
      <label>
        New Password
        <input type="password" name="password" minlength="8" placeholder="Leave blank to keep current" />
        <small>Leave blank to keep current password</small>
      </label>
      <label>
        Confirm New Password
        <input type="password" name="confirmPassword" minlength="8" placeholder="Leave blank to keep current" />
      </label>
      <label>
        Role
        <input type="text" name="role" value="${escapeHtml(roleString)}"
               placeholder="e.g., userMgmt or permanent,userMgmt" />
        <small>Role string (e.g., "userMgmt" for user management access, comma-separated for multiple roles)</small>
      </label>
      <div class="grid">
        <button type="submit">Save Changes</button>
        <a href="/web/users" role="button" class="secondary">Cancel</a>
      </div>
    </form>
  `;
}

/**
 * Parse and validate create form data.
 */
function parseCreateFormData(formData: FormData): {
  userData: { email: string; name: string; password: string; role: string };
  errors: string[];
} {
  const errors: string[] = [];

  const email = formData.get("email")?.toString().trim() ?? "";
  const name = formData.get("name")?.toString().trim() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? "";
  const role = formData.get("role")?.toString().trim() ?? "";

  if (!email) {
    errors.push("Email is required");
  } else if (!email.includes("@")) {
    errors.push("Invalid email format");
  }

  if (!password) {
    errors.push("Password is required");
  } else if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }

  if (password !== confirmPassword) {
    errors.push("Passwords do not match");
  }

  return {
    userData: { email, name, password, role },
    errors,
  };
}

/**
 * Parse and validate edit form data.
 */
function parseEditFormData(formData: FormData): {
  editData: { password: string; role: string };
  errors: string[];
} {
  const errors: string[] = [];

  const password = formData.get("password")?.toString() ?? "";
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? "";
  const role = formData.get("role")?.toString().trim() ?? "";

  if (password) {
    if (password.length < 8) {
      errors.push("Password must be at least 8 characters");
    }
    if (password !== confirmPassword) {
      errors.push("Passwords do not match");
    }
  }

  return {
    editData: { password, role },
    errors,
  };
}
