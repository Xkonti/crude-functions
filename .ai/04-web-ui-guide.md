# Web UI Guide

This guide provides a comprehensive walkthrough of the Crude Functions Web UI. It covers everything from initial setup to day-to-day management of your functions, code, secrets, and users.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Code Management](#code-management)
4. [Functions Management](#functions-management)
5. [API Keys Management](#api-keys-management)
6. [Secrets Management](#secrets-management)
7. [User Management](#user-management)
8. [Settings](#settings)
9. [Account Settings](#account-settings)
10. [Navigation Tips](#navigation-tips)
11. [Common Workflows](#common-workflows)

---

## Getting Started

### First-Time Setup

When you first deploy Crude Functions, you'll need to create an admin account.

**Path:** `/web/setup`

**What you see:**
- A welcome screen: "Welcome to Functions Router"
- A form to create your admin account

**Form fields:**
1. **Name** - Your display name (e.g., "Admin")
2. **Email** - Your email address (e.g., "admin@example.com")
3. **Password** - At least 8 characters
4. **Confirm Password** - Must match your password

**What happens:**
1. Fill in all fields
2. Click **Create Account**
3. The system creates your admin account with the `permanent` and `userMgmt` roles
4. You're automatically logged in and redirected to the dashboard

**Note:** After the first user is created, the setup page becomes inaccessible. New users must be created by existing users through the Users management page.

### Logging In

**Path:** `/web/login`

**What you see:**
- A simple login form

**Form fields:**
1. **Email** - Your registered email address
2. **Password** - Your password

**Actions:**
- Click **Sign In** to log in
- On success, you're redirected to the dashboard (or the page you were trying to access)
- On failure, you see an error message (e.g., "Invalid email or password")

---

## Dashboard Overview

**Path:** `/web`

The dashboard is your home base. It provides quick access to all major sections of the application.

**What you see:**

### Top Navigation Bar
The navigation bar appears on every page and includes:
- **Server Name** (clickable, returns to dashboard)
- Icon shortcuts:
  - 📁 Code Files
  - ⚡ Functions
  - 🔑 API Keys
  - 🔒 Secrets
  - 👥 Users
  - ⚙️ Settings
- **User dropdown** (your email) with options:
  - Change Password
  - Logout

### Main Content
Four cards providing quick access to main sections:

1. **Code Files**
   - Description: "Manage TypeScript handlers and supporting files in the code directory."
   - Button: **Manage Code**

2. **Functions**
   - Description: "Configure HTTP routes, their handlers, and access control."
   - Button: **Manage Functions**

3. **API Keys**
   - Description: "Manage authentication keys for API and function access."
   - Button: **Manage Keys**

4. **Secrets**
   - Description: "Manage encrypted global secrets available to all functions."
   - Button: **Manage Secrets**

---

## Code Management

**Path:** `/web/code`

This section manages all TypeScript files and assets in your `code/` directory.

### Viewing Files

**What you see:**
- Page title: "Code Files"
- Button: **Upload New File**
- A table with all code files showing:
  - **Path** - Relative path within code directory (e.g., `handlers/my-function.ts`)
  - **Size** - File size in human-readable format (B, KB, MB)
  - **Modified** - Last modification timestamp
  - **Actions** - Edit (✏️) and Delete (❌) buttons

**File types displayed:**
- TypeScript files (.ts)
- JavaScript files (.js)
- JSON, text, and other supporting files
- Binary assets (images, etc.)

### Uploading a New File

**Path:** `/web/code/upload`

**What you see:**
1. **File Path** field - Where the file should be saved (e.g., `handlers/my-function.ts`)
   - Must be a relative path within the code directory
2. **Select File** button - Click to browse and select a file from your computer
3. **Content** textarea - Alternative: type code directly instead of uploading

**Two upload modes:**

**Mode 1: Upload from file system**
1. Click **Select File**
2. Choose a file from your computer
3. The "Content" textarea is hidden
4. The file path is auto-filled with the selected filename (you can change it)
5. Click **Upload**

**Mode 2: Type content directly**
1. Leave the file picker empty
2. Type or paste code into the **Content** textarea
3. Enter a path in the **File Path** field
4. Click **Upload**

**Buttons:**
- **Upload** - Save the file
- **Cancel** - Return to file list

**What happens:**
- File is saved to the specified path
- You're redirected to the file list with a success message
- If the path already exists, the file is overwritten

### Editing a File

**Path:** `/web/code/edit?path={filepath}`

**For small text files (under 1 MB):**

**What you see:**
1. Page title: "Edit File"
2. File path display
3. **Content** textarea with the current file contents
4. Syntax highlighting (monospace font)
5. Buttons:
   - **Save** - Save changes
   - **Cancel** - Return without saving

**How to edit:**
1. Modify the text in the textarea
2. Click **Save**
3. You're redirected to the file list with a success message

**For large text files or binary files:**

**What you see:**
1. **File Information** section showing:
   - Path
   - Size
   - Type (MIME type)
   - Explanation why editing isn't available
2. **Download** button - Download the file to your computer
3. **Replace File** section with:
   - File picker to select a replacement file
   - **Replace File** button
   - **Cancel** button

**Why editing is disabled:**
- Binary files can't be edited as text
- Text files over 1 MB are too large for the browser editor

### Deleting a File

**Path:** `/web/code/delete?path={filepath}`

**What you see:**
1. Page title: "Delete File"
2. Confirmation message: "Are you sure you want to delete `{filepath}`?"
3. Warning: "This action cannot be undone."
4. Buttons:
   - **Delete** - Confirm deletion
   - **Cancel** - Return without deleting

**What happens:**
- File is permanently removed from the filesystem
- Associated database entry is deleted
- You're redirected to the file list with a success message

---

## Functions Management

**Path:** `/web/functions`

Functions are HTTP routes that execute your TypeScript handlers. Each function maps a URL pattern to a handler file.

### Viewing Functions

**What you see:**
- Page title: "Functions"
- Button: **Create New Function**
- A table with all functions showing:
  - **Status** - Toggle switch (✅ enabled / ❌ disabled)
  - **Name** - Function identifier
  - **Route** - URL pattern (e.g., `/api/users/:id`)
  - **Methods** - HTTP methods (GET, POST, etc.)
  - **Keys** - Required API key groups (or "none")
  - **Description** - Optional description
  - **Actions** - Quick action icons:
    - 📝 Logs
    - 📊 Metrics
    - 🔐 Secrets
    - ✏️ Edit
    - ❌ Delete

### Enabling/Disabling Functions

**How it works:**
1. Click the status icon (✅ or ❌) in the Status column
2. The icon changes to ⏳ (loading)
3. The function is toggled via API
4. Icon updates to reflect new state

**What happens:**
- **Enabled (✅)**: Function is active and accepts requests
- **Disabled (❌)**: Function returns 404 Not Found for all requests

**Use case:** Temporarily disable a function without deleting it

### Creating a New Function

**Path:** `/web/functions/create`

**Form fields:**

1. **Name*** - Unique identifier (e.g., "my-function")
   - Required
   - Used for internal reference

2. **Description** - Optional description (e.g., "Fetches user data from database")
   - Displayed in the function list

3. **Handler Path*** - Path to TypeScript file (e.g., "handlers/my-function.ts")
   - Required
   - Relative to the code directory
   - File must exist

4. **Route Path*** - URL pattern (e.g., "/api/users/:id")
   - Required
   - Must start with /
   - Supports parameters (`:id`, `:name`, etc.)
   - Must not contain //

5. **HTTP Methods*** - Select at least one:
   - ☐ GET
   - ☐ POST
   - ☐ PUT
   - ☐ DELETE
   - ☐ PATCH
   - ☐ HEAD
   - ☐ OPTIONS

6. **Required API Key Groups** - Optional access control
   - Select which API key groups can access this function
   - If none selected, function is publicly accessible
   - Multiple groups can be selected

**Buttons:**
- **Create Function** - Save and return to function list
- **Cancel** - Return without saving

**What happens:**
- Function is registered in the database
- Router is rebuilt with the new route
- You're redirected to the function list with a success message

### Editing a Function

**Path:** `/web/functions/edit/{id}`

**What you see:**
- Same form as creating, but pre-filled with current values
- Additional feature: **Show Secrets Preview** button

**Form fields:**
- All the same fields as creation
- Values are pre-filled

**Secrets Preview:**
1. Click **Show Secrets Preview** button
2. A list appears showing all secrets available to this function:
   - Global secrets
   - Function-scoped secrets
   - Group-scoped secrets (for selected API key groups)
   - Key-scoped secrets (organized by group, expandable)
3. Each secret shows:
   - Name
   - Masked value (•••••)
   - 👁️ button to reveal
   - 📋 button to copy
4. Button changes to **Refresh Preview** for subsequent clicks

**Buttons:**
- **Save Changes** - Update the function
- **Cancel** - Return without saving

**What happens:**
- Function configuration is updated in the database
- Router is rebuilt with updated route
- Existing logs and metrics are preserved
- You're redirected to the function list with a success message

### Deleting a Function

**Path:** `/web/functions/delete/{id}`

**What you see:**
1. Page title: "Delete Function"
2. Confirmation message with function name
3. Warning: "This action cannot be undone."
4. Buttons:
   - **Delete** - Confirm deletion
   - **Cancel** - Return without deleting

**What happens:**
- Function is removed from the database
- Route is removed from the router
- Logs and metrics are preserved (historical data)
- Function-scoped secrets are deleted
- You're redirected to the function list with a success message

### Viewing Function Logs

**Path:** `/web/functions/logs/{id}`

**What you see:**
- Page title: "Logs: {function name}"
- Controls:
  - **← Back to Functions** button
  - **Show:** dropdown (50, 100, 250, 500, 1000 logs)
  - **Reset to Newest** button (when viewing older logs)
  - **Refresh** button
- Status line: "Showing X logs (newest): {oldest timestamp} to {newest timestamp}"
- A table with log entries:
  - **Time** - HH:MM:SS.mmm format
  - **Level** - LOG, ERROR, WARN, INFO, DEBUG, TRACE, EXEC_START, EXEC_END, EXEC_REJECT
  - **Req ID** - Last 5 characters of request ID (click to copy full ID)
  - **Message** - Log message (click row to expand)

**Log levels and colors:**
- **ERROR** - Red
- **WARN** - Orange
- **INFO** - Blue
- **LOG** - Gray
- **DEBUG** - Gray
- **TRACE** - Light gray
- **EXEC_START** - Green (function execution started)
- **EXEC_END** - Green (function execution completed)
- **EXEC_REJECT** - Red (function execution failed)

**Features:**
- **ANSI color support** - Console colors are preserved (e.g., chalk output)
- **Click to expand** - Click any row to see full message with arguments
- **Copy request ID** - Click the Req ID to copy the full request UUID
- **Pagination** - Load older logs with **Load Older Logs →** button
- **Auto-truncation** - Long messages are truncated in the table view (expand to see full text)

**Workflow:**
1. Select page size (default 100)
2. Logs are displayed newest first
3. Click a row to expand and see full details
4. Click **Load Older Logs →** to paginate
5. Click **Reset to Newest** to return to most recent logs

### Viewing Metrics

**Paths:**
- Per-function: `/web/functions/metrics/{id}`
- Server-wide: `/web/functions/metrics/global`

**What you see:**
- Page title: "Metrics: {function name}" or "Metrics: Server Stats"
- Controls:
  - **← Back to Functions** button
  - **Refresh** button
  - **Source** dropdown (switch between functions and global)
- Time range tabs:
  - **Last Hour** (60 minutes, minute granularity)
  - **Last 24 Hours** (24 hours, hour granularity)
  - **Last X Days** (configurable retention, day granularity)

**Charts:**

1. **Summary Cards** (at the top):
   - **Avg Executions / {period}** - Average requests per time period
   - **Avg Execution Time** - Weighted average execution time in ms
   - **Max Execution Time** - Peak execution time in ms
   - **Total Executions** - Total number of executions in the time range

2. **Execution Time Chart** (line chart):
   - **Blue line** - Average execution time (ms)
   - **Red line** - Maximum execution time (ms)
   - **Orange points** - Current period (live data)
   - **Gray dashed lines** - Interpolated periods (no activity)
   - Hover to see exact values

3. **Request Count Chart** (bar chart):
   - **Blue bars** - Number of executions per time period
   - **Orange bars** - Current period (live data)
   - Hover to see exact count

**Time periods explained:**
- **Last Hour**: 60 data points (1 per minute)
- **Last 24 Hours**: 24 data points (1 per hour)
- **Last X Days**: X data points (1 per day, where X is the retention setting)

**Data freshness:**
- Current period shows **live data** that updates on page refresh
- Historical periods show **aggregated data** from the metrics database
- Periods with no activity are interpolated (shown as dashed gray lines)

**Switching sources:**
1. Use the **Source** dropdown at the top
2. Select "Server Stats" for global metrics across all functions
3. Select a specific function name to view per-function metrics
4. The URL updates but the page doesn't reload

### Managing Function Secrets

**Path:** `/web/functions/secrets/{id}`

**What you see:**
- Page title: "Secrets for {function name}"
- Button: **← Back to Functions**
- Button: **Create New Secret**
- A table with secrets (if any exist):
  - **Name** - Secret identifier (e.g., "DATABASE_URL")
  - **Value** - Masked (•••••) with 👁️ (reveal) and 📋 (copy) buttons
  - **Comment** - Optional description
  - **Created** - Timestamp
  - **Modified** - Timestamp
  - **Actions** - ✏️ Edit, ❌ Delete

**Scope:**
- These are **function-scoped secrets**
- Only available to this specific function
- Not shared with other functions

**See also:** [Secrets Management](#secrets-management) for full details on secret operations

---

## API Keys Management

**Path:** `/web/keys`

API keys authenticate external access to your functions. Keys are organized into groups for easier management.

### Viewing Keys

**What you see:**
- Page title: "API Keys"
- Buttons:
  - **Create New Group**
  - **Create New Key**
- Cards for each group showing:
  - **Group name** (e.g., "management")
  - **Description** (if provided)
  - Group action buttons:
    - 🔐 Manage Secrets
    - ✏️ Edit Group
    - ➕ Add Key
    - 🗑️ Delete Group (not shown for "management" group)
  - Table of keys in this group (if any):
    - **ID** - Numeric key ID
    - **Name** - Key identifier
    - **Value** - Masked (•••••) with 👁️ (reveal) and 📋 (copy) buttons
    - **Description** - Optional description
    - **Actions** - 🔐 Secrets, ❌ Delete

### Creating a New Group

**Path:** `/web/keys/create-group`

**Form fields:**

1. **Group Name*** - Lowercase identifier (e.g., "mobile-app")
   - Required
   - Must be lowercase letters, numbers, dashes, and underscores only
   - Must be unique

2. **Description** - Optional description (e.g., "Keys for mobile application")

**Buttons:**
- **Create Group** - Save and return to keys list
- **Cancel** - Return without saving

**What happens:**
- Group is created in the database
- Group appears as a new card in the keys list
- You're redirected with a success message

### Editing a Group

**Path:** `/web/keys/edit-group/{id}`

**Form fields:**

1. **Group Name** - Displayed but read-only (cannot be changed)
2. **Description** - Editable

**Buttons:**
- **Save Changes** - Update description
- **Cancel** - Return without saving

**What happens:**
- Group description is updated
- You're redirected to the keys list with a success message

### Creating a New API Key

**Path:** `/web/keys/create?group={groupname}` (optional pre-selection)

**Form fields:**

1. **Key Group*** - Either:
   - Pre-filled if coming from a group card (read-only)
   - Dropdown to select existing group
   - Option to create a new group

   **If creating new group:**
   - Select "+ Create new group..." from dropdown
   - New field appears: **New Group Name**

2. **Key Name*** - Unique identifier within the group (e.g., "mobile-prod-key")
   - Required
   - Lowercase letters, numbers, dashes, and underscores only
   - Must be unique within the group

3. **Key Value*** - The actual API key string (e.g., "sk_prod_abc123xyz")
   - Required
   - Letters, numbers, dashes, and underscores only
   - This is what clients send in the `X-API-Key` header

4. **Description** - Optional description (e.g., "Production mobile app key")

**Buttons:**
- **Create Key** - Save and return to keys list
- **Cancel** - Return without saving

**What happens:**
- Key is saved to the database (encrypted)
- If creating a new group, group is created first
- You're redirected to the keys list with a success message

**Important:** Copy the key value immediately! While you can reveal it later, it's encrypted at rest.

### Showing/Hiding Key Values

**How it works:**
1. Keys are masked by default: ••••••••
2. Click the 👁️ button to reveal the value
3. The value is displayed as `<code>actual-key-value</code>`
4. Click the 🙈 button to hide it again

**What happens:**
- JavaScript toggles visibility
- No network request is made (value is already in the page)

### Copying Key Values

**How it works:**
1. Click the 📋 button next to a key value
2. The value is copied to your clipboard
3. Button briefly shows ✓ to confirm

**Use case:** Quickly copy keys to configure clients

### Deleting a Key

**Path:** `/web/keys/delete?id={keyid}`

**What you see:**
1. Page title: "Delete API Key"
2. Confirmation message with key ID
3. Warning: "This action cannot be undone."
4. Buttons:
   - **Delete** - Confirm deletion
   - **Cancel** - Return without deleting

**What happens:**
- Key is removed from the database
- Any key-scoped secrets are also deleted
- You're redirected to the keys list with a success message

### Deleting a Group

**Path:** `/web/keys/delete-group?id={groupid}`

**Requirements:**
- Group must have no keys
- Group cannot be "management" (protected)

**What you see:**
1. Page title: "Delete Group"
2. Confirmation message with group name
3. Warning: "This action cannot be undone."
4. Buttons:
   - **Delete** - Confirm deletion
   - **Cancel** - Return without deleting

**If group has keys:**
- Deletion is blocked
- Error message: "Cannot delete group with X existing key(s). Delete keys first."

**What happens:**
- Group is removed from the database
- Group-scoped secrets are also deleted
- You're redirected to the keys list with a success message

### Managing Group Secrets

**Path:** `/web/keys/secrets/{groupid}`

**What you see:**
- Page title: "Secrets for {group name}"
- Button: **← Back to Keys**
- Button: **Create New Secret**
- A table with secrets (same format as function secrets)

**Scope:**
- These are **group-scoped secrets**
- Available to all keys in this group
- Available to functions that accept this group

**See also:** [Secrets Management](#secrets-management) for full details

### Managing Key Secrets

**Path:** `/web/keys/{keyid}/secrets`

**What you see:**
- Page title: "Secrets for Key: {key name}"
- Button: **← Back to Keys**
- Button: **Create New Secret**
- A table with secrets (same format as function secrets)

**Scope:**
- These are **key-scoped secrets**
- Only available when this specific key is used
- Most specific level of secret scoping

**See also:** [Secrets Management](#secrets-management) for full details

---

## Secrets Management

**Path:** `/web/secrets`

Secrets are encrypted key-value pairs available to your functions via the `ctx.getSecret()` API. Crude Functions supports multiple scopes of secrets.

### Secret Scopes Explained

Secrets cascade based on specificity:

1. **Global scope** (`/web/secrets`)
   - Available to ALL functions
   - Not tied to any API key

2. **Function scope** (`/web/functions/secrets/{functionid}`)
   - Available only to the specific function
   - Not tied to any API key

3. **Group scope** (`/web/keys/secrets/{groupid}`)
   - Available to functions that accept this group
   - Available when any key from this group is used

4. **Key scope** (`/web/keys/{keyid}/secrets`)
   - Available only when this specific key is used
   - Most specific, highest priority

**Priority order** (when multiple secrets with the same name exist):
1. Key-scoped (highest priority)
2. Group-scoped
3. Function-scoped
4. Global-scoped (lowest priority)

### Viewing Global Secrets

**What you see:**
- Page title: "Global Secrets"
- Button: **Create New Secret**
- A table with all global secrets:
  - **Name** - Secret identifier (e.g., "DATABASE_URL")
  - **Value** - Masked (•••••) with 👁️ (reveal) and 📋 (copy) buttons
  - **Comment** - Optional description
  - **Created** - Timestamp
  - **Modified** - Timestamp
  - **Actions** - ✏️ Edit, ❌ Delete

**If decryption fails:**
- Value shows: ⚠️ Decryption failed (with error tooltip)
- Edit button is hidden (cannot edit if value cannot be read)

### Creating a Secret

**Path:** `/web/secrets/create` (and similar paths for other scopes)

**Form fields:**

1. **Secret Name*** - Identifier (e.g., "DATABASE_URL")
   - Required
   - Letters, numbers, underscores, and dashes only
   - Case-sensitive
   - Convention: UPPER_SNAKE_CASE

2. **Secret Value*** - The actual secret
   - Required
   - Multi-line textarea (supports long values)
   - Encrypted at rest using AES-256-GCM
   - Can contain any characters

3. **Comment** - Optional description (e.g., "PostgreSQL connection string")
   - Not encrypted (metadata)
   - Helps identify the secret's purpose

**Buttons:**
- **Create Secret** - Save and return to secrets list
- **Cancel** - Return without saving

**What happens:**
- Value is encrypted using the current encryption key
- Secret is saved to the database
- You're redirected with a success message

### Editing a Secret

**Path:** `/web/secrets/edit/{id}` (and similar paths for other scopes)

**Form fields:**

1. **Secret Name** - Displayed but read-only (cannot be changed)
2. **Secret Value*** - Current decrypted value (editable)
3. **Comment** - Current comment (editable)

**Buttons:**
- **Save Changes** - Update secret
- **Cancel** - Return without saving

**What happens:**
- Value is re-encrypted with the current encryption key
- Modified timestamp is updated
- You're redirected with a success message

**Note:** You cannot rename secrets. If you need a different name, create a new secret and delete the old one.

### Showing/Hiding Secret Values

**How it works:**
1. Secrets are masked by default: ••••••••
2. Click the 👁️ button to reveal the value
3. The decrypted value is displayed as `<code>actual-secret</code>`
4. Click the 🙈 button to hide it again

**Security note:** Values are decrypted server-side and sent to the browser when the page loads. Only users with web access can see secrets.

### Copying Secret Values

**How it works:**
1. Click the 📋 button next to a secret
2. The decrypted value is copied to your clipboard
3. Button briefly shows ✓ to confirm

**Use case:** Quickly copy secrets to configure functions or external tools

### Deleting a Secret

**Path:** `/web/secrets/delete/{id}` (and similar paths for other scopes)

**What you see:**
1. Page title: "Delete Secret"
2. Confirmation message with secret name
3. Warning: "This action cannot be undone."
4. Buttons:
   - **Delete** - Confirm deletion
   - **Cancel** - Return without deleting

**What happens:**
- Secret is permanently removed from the database
- Encrypted value is deleted
- You're redirected with a success message

---

## User Management

**Path:** `/web/users`

User management controls who can access the Web UI. All web users authenticate with email and password.

### Viewing Users

**What you see:**
- Page title: "Users"
- Button: **Create New User**
- A table with all users:
  - **Email** - User's email address
  - **Name** - Display name (if provided)
  - **Role** - Comma-separated role list (e.g., "permanent, userMgmt")
  - **Created** - Account creation timestamp
  - **Actions** - ✏️ Edit, ❌ Delete

**Your own account:**
- Shows "(you)" next to your email
- Delete button is hidden (cannot delete yourself)

### Understanding Roles

Crude Functions uses a simple role-based system:

1. **userMgmt** - Can create, edit, and delete users
   - Grants access to the Users management page
   - Required to manage other users

2. **permanent** - Cannot be deleted by other users
   - Protects admin accounts from accidental deletion
   - Useful for the primary admin

**Role combinations:**
- No roles: Basic access to Web UI (can use all features except user management)
- `userMgmt`: Can manage users
- `permanent`: Protected from deletion
- `permanent,userMgmt`: Full admin (typical for first user)

**Access control:**
- Everyone with a web account can access all features EXCEPT user management
- Only users with `userMgmt` role can access `/web/users`

### Creating a User

**Path:** `/web/users/create`

**Form fields:**

1. **Email*** - User's email address (e.g., "user@example.com")
   - Required
   - Must be valid email format
   - Must be unique

2. **Name** - Display name (e.g., "John Doe")
   - Optional
   - Used in the Web UI

3. **Password*** - Initial password
   - Required
   - Minimum 8 characters

4. **Confirm Password*** - Repeat password
   - Required
   - Must match Password field

5. **Role** - Role string (e.g., "userMgmt" or "permanent,userMgmt")
   - Optional
   - Comma-separated for multiple roles
   - Leave blank for no roles (basic access)

**Buttons:**
- **Create User** - Save and return to users list
- **Cancel** - Return without saving

**What happens:**
- User is created in the database (password is hashed)
- Email confirmation is NOT sent (manual setup)
- You're redirected with a success message
- New user can immediately log in

**Note:** Share the initial password with the user securely. They can change it via the "Change Password" option.

### Editing a User

**Path:** `/web/users/edit/{userid}`

**Form fields:**

1. **Email** - Displayed but read-only (cannot be changed)

2. **New Password** - Change user's password
   - Optional (leave blank to keep current password)
   - Minimum 8 characters if provided

3. **Confirm New Password** - Repeat new password
   - Required if New Password is provided
   - Must match New Password field

4. **Role** - Role string (e.g., "userMgmt" or "permanent,userMgmt")
   - Editable
   - Comma-separated for multiple roles
   - Leave blank to remove all roles

**Buttons:**
- **Save Changes** - Update user
- **Cancel** - Return without saving

**What happens:**
- User's password is updated (if provided)
- User's roles are updated
- You're redirected with a success message

**Use cases:**
- Reset a user's password
- Grant or revoke `userMgmt` role
- Add `permanent` role to protect accounts

### Deleting a User

**Path:** `/web/users/delete/{userid}`

**Requirements:**
- Cannot delete yourself
- Cannot delete users with `permanent` role (protected)

**What you see:**
1. Page title: "Delete User"
2. Confirmation message with user's email
3. Warning: "This action cannot be undone."
4. Buttons:
   - **Delete** - Confirm deletion
   - **Cancel** - Return without deleting

**If user has permanent role:**
- Deletion is blocked
- Error message: "Cannot delete permanent user"

**What happens:**
- User is removed from the database
- User's sessions are invalidated
- User can no longer log in
- You're redirected with a success message

---

## Settings

**Path:** `/web/settings`

Settings control server-wide configuration and user preferences.

### Tab Navigation

The settings page has two tabs:

1. **Server Settings** (`?tab=server`) - Global configuration
2. **User Settings** (`?tab=user`) - Per-user preferences (not yet implemented)

### Server Settings

**Path:** `/web/settings?tab=server`

**What you see:**
- Two main sections:
  1. Encryption Key Rotation
  2. Server Settings Form

#### Encryption Key Rotation

**Purpose:** Manually trigger re-encryption of all secrets and API keys with new keys

**What you see:**
1. Explanation of what key rotation does
2. Status display:
   - "Last rotation: X days ago (timestamp)"
   - OR "⟳ Key rotation in progress..." (during rotation)
3. Button: **Rotate Encryption Keys Now** (disabled during rotation)
4. Status message area (appears after triggering rotation)

**How it works:**
1. Click **Rotate Encryption Keys Now**
2. Confirm in the browser dialog
3. Button becomes disabled and shows "Rotating Keys..."
4. API endpoint generates new encryption keys
5. All encrypted data is re-encrypted with new keys
6. Success/error message appears
7. Status updates automatically

**When to use:**
- Regular security hygiene (rotate keys periodically)
- After suspected key compromise
- Before backup/restore operations

**Duration:** May take several minutes depending on the amount of encrypted data

#### Server Settings Form

**Categories:**

**1. General Settings**

- **Server Name**
  - Type: Text
  - Default: "Functions Router"
  - Description: "Name displayed in the Web UI header and page titles"
  - Used in the navigation bar and browser tab titles

**2. Logs Settings**

- **Log Retention Days**
  - Type: Number
  - Default: 30
  - Min: 1, Max: 365
  - Description: "Number of days to retain function execution logs before automatic cleanup"
  - Affects log pruning job

**3. Metrics Settings**

- **Metrics Retention Days**
  - Type: Number
  - Default: 90
  - Min: 7, Max: 365
  - Description: "Number of days to retain metrics data before automatic cleanup"
  - Affects metrics charts (Last X Days view)

**4. API Settings**

- **API Access Groups**
  - Type: Checkbox group (list of API key groups)
  - Default: (none selected)
  - Description: "API key groups allowed to access the management API (`/api/*` endpoints)"
  - Controls which keys can use management APIs
  - If no groups selected, API endpoints are only accessible via web session

**Buttons:**
- **Save Settings** - Update all settings
- **Cancel** - Return to dashboard

**What happens:**
1. Form is validated
2. Only changed settings are updated
3. Success message shows count: "Settings saved (X updated)"
4. Settings take effect immediately

### User Settings

**Path:** `/web/settings?tab=user`

**What you see:**
- Message: "User-specific settings are not yet implemented."
- Placeholder for future per-user preferences

**Planned features:**
- Theme preferences (light/dark mode)
- Notification settings
- Display preferences (logs page size, etc.)

---

## Account Settings

### Changing Your Password

**Path:** `/web/password`

**Access:** Click your email in the top navigation bar → **Change Password**

**What you see:**
- Page title: "Change Password"
- Form with three fields

**Form fields:**

1. **Current Password*** - Your existing password
   - Required
   - Used to verify your identity

2. **New Password*** - Your new password
   - Required
   - Minimum 8 characters

3. **Confirm New Password*** - Repeat new password
   - Required
   - Must match New Password field

**Button:**
- **Change Password** - Submit the form

**What happens:**
1. Client-side validation checks:
   - New passwords match
   - New password is at least 8 characters
2. Request is sent to `/api/auth/change-password`
3. Better Auth verifies current password
4. New password is hashed and stored
5. On success:
   - You're redirected back with a success message
   - Your session remains active (no re-login required)
6. On failure:
   - Error message appears
   - Common errors: "Current password is incorrect"

**Security notes:**
- Current password is required (prevents session hijacking)
- Password is sent over HTTPS
- Password is hashed with bcrypt before storage
- No password history is maintained

### Logging Out

**Access:** Click your email in the top navigation bar → **Logout**

**What happens:**
1. Session is invalidated via Better Auth
2. You're redirected to the login page
3. Cannot access protected pages until logging in again

---

## Navigation Tips

### Icon Shortcuts

The top navigation bar provides quick access via icons:

- 📁 **Code Files** → `/web/code`
- ⚡ **Functions** → `/web/functions`
- 🔑 **API Keys** → `/web/keys`
- 🔒 **Secrets** → `/web/secrets`
- 👥 **Users** → `/web/users` (only visible with `userMgmt` role)
- ⚙️ **Settings** → `/web/settings`

### Breadcrumb Navigation

Most pages have contextual back links:

- **← Back to Functions** (from logs, metrics, function secrets)
- **← Back to Keys** (from group secrets)
- **← Back to Secrets** (from key/group secret management)

### Flash Messages

Success and error messages appear at the top of pages:

**Success messages** (green box):
- "Function created: my-function"
- "Settings saved (3 updated)"
- "Secret deleted: DATABASE_URL"

**Error messages** (red box):
- "Invalid form data"
- "File not found: handlers/missing.ts"
- "Cannot delete permanent user"

Messages are passed via URL query parameters and displayed once.

### Confirmation Dialogs

Destructive actions require confirmation:

**Browser-level confirmations:**
- Key rotation: "Are you sure you want to rotate encryption keys now?"

**Page-level confirmations:**
- Delete file
- Delete function
- Delete API key
- Delete group
- Delete secret
- Delete user

Each shows:
- Item being deleted
- Warning: "This action cannot be undone"
- Delete and Cancel buttons

---

## Common Workflows

### Deploying a New Function

**End-to-end workflow:**

1. **Upload the handler code**
   - Go to `/web/code`
   - Click **Upload New File**
   - Enter path: `handlers/hello.ts`
   - Paste code or select file
   - Click **Upload**

2. **Create the function**
   - Go to `/web/functions`
   - Click **Create New Function**
   - Fill in:
     - Name: `hello`
     - Handler Path: `handlers/hello.ts`
     - Route Path: `/hello`
     - Methods: Check GET
   - Click **Create Function**

3. **Test the function**
   - Visit `http://your-server/run/hello`
   - Check logs: `/web/functions` → Click 📝 next to "hello"

### Setting Up API Key Protection

**Workflow:**

1. **Create an API key group**
   - Go to `/web/keys`
   - Click **Create New Group**
   - Name: `mobile-app`
   - Description: "Keys for mobile clients"
   - Click **Create Group**

2. **Create an API key**
   - Click **Create New Key**
   - Group: Select "mobile-app"
   - Name: `mobile-prod`
   - Value: `sk_prod_abc123`
   - Click **Create Key**

3. **Protect a function**
   - Go to `/web/functions`
   - Click ✏️ next to the function
   - In "Required API Key Groups", check "mobile-app"
   - Click **Save Changes**

4. **Test access**
   - Without key: `curl /run/your-function` → 401 Unauthorized
   - With key: `curl -H "X-API-Key: sk_prod_abc123" /run/your-function` → Success

### Configuring Secrets for a Function

**Workflow:**

1. **Create a global secret** (optional, for database URLs, etc.)
   - Go to `/web/secrets`
   - Click **Create New Secret**
   - Name: `DATABASE_URL`
   - Value: `postgresql://...`
   - Click **Create Secret**

2. **Create a function secret**
   - Go to `/web/functions`
   - Click 🔐 next to the function
   - Click **Create New Secret**
   - Name: `API_ENDPOINT`
   - Value: `https://api.example.com`
   - Click **Create Secret**

3. **Use in handler code**
   ```typescript
   export default async function(c, ctx) {
     const dbUrl = await ctx.getSecret('DATABASE_URL');
     const apiEndpoint = await ctx.getSecret('API_ENDPOINT');
     // ...
   }
   ```

4. **Verify secrets available**
   - Go to `/web/functions`
   - Click ✏️ next to the function
   - Click **Show Secrets Preview**
   - Confirm both secrets appear

### Debugging Function Issues

**Workflow:**

1. **Check function is enabled**
   - Go to `/web/functions`
   - Verify function has ✅ status (not ❌)

2. **Review execution logs**
   - Click 📝 next to the function
   - Look for:
     - EXEC_START (function started)
     - ERROR (uncaught errors)
     - EXEC_REJECT (function threw an error)
   - Click rows to see full error messages

3. **Check metrics for patterns**
   - Click 📊 next to the function
   - Look for:
     - Execution time spikes
     - Request count drops
     - Error rate patterns

4. **Verify handler file exists**
   - Go to `/web/code`
   - Find the handler path from function config
   - Confirm file exists and is readable

5. **Test API key (if protected)**
   - Copy the key value from `/web/keys`
   - Test with curl: `curl -H "X-API-Key: ..." /run/your-function`

### Managing Multiple Environments

**Recommended structure:**

1. **Create environment-specific groups**
   - `dev-keys` (development)
   - `staging-keys` (staging)
   - `prod-keys` (production)

2. **Create keys per environment**
   - Group: dev-keys
     - Key: dev-key-1, dev-key-2
   - Group: staging-keys
     - Key: staging-key-1
   - Group: prod-keys
     - Key: prod-key-1, prod-key-2

3. **Configure secrets per group**
   - dev-keys secrets: Development database URL
   - staging-keys secrets: Staging database URL
   - prod-keys secrets: Production database URL

4. **Assign groups to functions**
   - Development functions: Accept only dev-keys
   - Staging functions: Accept only staging-keys
   - Production functions: Accept only prod-keys

**Benefits:**
- Clear separation of environments
- Different secrets per environment
- Easy to rotate keys per environment
- Reduced risk of using prod keys in dev

---

## Tips and Best Practices

### Security

1. **Use strong API key values**
   - Random strings with sufficient entropy
   - Consider using UUIDs or cryptographically random strings

2. **Rotate API keys regularly**
   - Create new keys
   - Update clients
   - Delete old keys

3. **Use encryption key rotation**
   - Rotate keys periodically (e.g., every 90 days)
   - Especially after staff turnover

4. **Protect your first user account**
   - Keep the `permanent` role on your admin account
   - Use a strong password
   - Change password regularly

5. **Grant userMgmt role sparingly**
   - Only give to trusted administrators
   - Create dedicated accounts for automation if needed

### Organization

1. **Use descriptive names**
   - Functions: `user-login`, `fetch-orders`, `webhook-stripe`
   - Files: `handlers/user-login.ts`, `lib/database.ts`
   - Secrets: `DATABASE_URL`, `STRIPE_API_KEY`

2. **Add descriptions everywhere**
   - Functions: Explain what the function does
   - API keys: Note which application uses the key
   - Groups: Describe the purpose of the group
   - Secrets: Explain what the secret is for

3. **Use consistent naming conventions**
   - Functions: kebab-case
   - Files: kebab-case
   - Secrets: UPPER_SNAKE_CASE
   - Groups: kebab-case

4. **Organize files in directories**
   - `handlers/` - HTTP endpoint handlers
   - `lib/` - Shared utilities
   - `types/` - TypeScript type definitions

### Monitoring

1. **Check logs regularly**
   - Review error logs
   - Look for unusual patterns
   - Monitor EXEC_REJECT events

2. **Monitor metrics**
   - Track execution time trends
   - Watch for request count changes
   - Set up alerts (external tools) based on metrics API

3. **Test functions after changes**
   - Edit handler code → Test immediately
   - Change function config → Verify behavior
   - Update secrets → Confirm functions still work

### Maintenance

1. **Clean up old files**
   - Delete unused handlers
   - Remove obsolete helper files

2. **Remove unused functions**
   - Disable first (set to ❌)
   - Monitor logs to ensure nothing breaks
   - Delete after confirming no longer needed

3. **Prune old keys**
   - Review key usage (via logs)
   - Delete keys that haven't been used in months

4. **Review settings periodically**
   - Adjust log retention based on disk space
   - Adjust metrics retention based on needs
   - Update server name if rebranding

---

## Troubleshooting

### Login Issues

**"Invalid email or password"**
- Verify email and password are correct
- Check Caps Lock is off
- If forgotten, ask an admin to reset your password

**Redirected to /web/setup**
- No users exist in the database
- Create the first admin account
- If users should exist, check database integrity

### Upload Issues

**"Invalid form data"**
- Check file size (very large files may fail)
- Try uploading smaller files
- For large files, use the text editor mode

**"Path traversal detected"**
- File path contains `..` or absolute paths
- Use relative paths only (e.g., `handlers/my-function.ts`)

### Function Issues

**Function returns 404**
- Verify function is enabled (✅ not ❌)
- Check route path matches request URL
- Confirm HTTP method is allowed

**Function returns 401 Unauthorized**
- Function requires an API key
- Include `X-API-Key` header with valid key
- Verify key's group is in function's "Required API Key Groups"

**Function returns 500 Internal Server Error**
- Check logs: Click 📝 next to the function
- Look for EXEC_REJECT or ERROR entries
- Review error messages for details

**Handler not found**
- Verify handler file exists: Go to `/web/code`
- Check handler path in function config matches file path
- Ensure file has proper TypeScript syntax

### Secret Issues

**"⚠️ Decryption failed"**
- Encryption keys have changed and old secrets cannot be decrypted
- Delete and recreate the secret
- Consider running key rotation to prevent this

**Secret not available in function**
- Check secret scope (global, function, group, key)
- Verify function accepts the group (for group secrets)
- Verify correct key is being used (for key secrets)
- Use "Show Secrets Preview" in function editor

### Permission Issues

**Cannot access /web/users**
- User account needs `userMgmt` role
- Ask an admin to grant the role via Edit User

**Cannot delete user**
- Cannot delete yourself
- Cannot delete users with `permanent` role
- Have another admin remove the `permanent` role first

---

This guide covers all major features of the Crude Functions Web UI. For API documentation and handler development, see the other documentation files in the `.ai/` directory.
