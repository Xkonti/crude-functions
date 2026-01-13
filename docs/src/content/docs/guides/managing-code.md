---
title: Managing Code Files
description: Organizing and managing function code
---

Your function code lives in the `./code/` directory. This guide covers how to create, upload, organize, and manage your TypeScript files and supporting assets.

## Understanding the Code Directory

The `./code/` directory is where all your function handlers and supporting files live. It's mounted as a volume in your Docker container:

```yaml
volumes:
  - ./code:/app/code
```

**Structure:**
```
code/
├── hello.ts              # Simple function handler
├── users/
│   ├── get.ts           # GET /users/:id handler
│   ├── create.ts        # POST /users handler
│   └── list.ts          # GET /users handler
├── lib/
│   ├── database.ts      # Shared database utilities
│   ├── validators.ts    # Input validation helpers
│   └── auth.ts          # Authentication helpers
├── types.ts             # Shared TypeScript types
└── webhooks/
    ├── stripe.ts        # Stripe webhook handler
    └── github.ts        # GitHub webhook handler
```

**Key points:**

- Organize files however makes sense for your project
- Use subdirectories for grouping related handlers
- Share code between handlers using relative imports
- All paths are relative to the `./code/` directory root

## Creating Files via Web UI

The web interface provides a visual way to manage your code files.

### Uploading a New File

**Path:** `/web/code` → **Upload New File**

**Option 1: Upload from filesystem**

1. Click **Select File**
2. Choose a `.ts`, `.js`, or other file from your computer
3. The path is auto-filled (you can edit it)
4. Click **Upload**

**Option 2: Type code directly**

1. Leave the file picker empty
2. Enter the file path (e.g., `handlers/hello.ts`)
3. Type or paste code into the **Content** textarea
4. Click **Upload**

**Example:**

```
File Path: handlers/hello.ts
Content:
export default async function (c, ctx) {
  return c.json({ message: "Hello, World!" });
}
```

![Upload file form](/screenshots/code-upload.png)

**Path rules:**

- Must be relative (no leading `/`)
- Cannot contain `..` (path traversal prevention)
- Can include subdirectories (e.g., `lib/database.ts`)
- Subdirectories are created automatically

### Editing an Existing File

**Path:** `/web/code` → Click ✏️ next to a file

**For text files under 1 MB:**

1. Content appears in an editable textarea
2. Modify the code
3. Click **Save**

**For large or binary files:**

- Editor is disabled (file too large for browser)
- Download the file instead
- Upload a replacement file using the file picker

![Edit file interface](/screenshots/code-edit.png)

### Deleting a File

**Path:** `/web/code` → Click ❌ next to a file

1. Confirmation page appears
2. Warning: "This action cannot be undone"
3. Click **Delete** to confirm

**Important:** Deleting a file doesn't delete functions that reference it. Those functions will fail with "Module not found" errors until the handler is restored or the function is updated.

## Managing Files via API

For automation, CI/CD, or programmatic deployment, use the Files API.

### List All Files

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:8000/api/files
```

**Response:**

```json
{
  "data": [
    {
      "path": "handlers/hello.ts",
      "size": 156,
      "modifiedAt": "2026-01-12T10:30:00.000Z"
    },
    {
      "path": "lib/database.ts",
      "size": 2048,
      "modifiedAt": "2026-01-11T14:20:00.000Z"
    }
  ]
}
```

### Get File Content

**For raw content:**

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:8000/api/files/handlers/hello.ts
```

Returns the raw file content with appropriate `Content-Type`.

**For JSON envelope (with metadata):**

```bash
curl -H "X-API-Key: your-key" \
  -H "Accept: application/json" \
  http://localhost:8000/api/files/handlers/hello.ts
```

**Response:**

```json
{
  "data": {
    "path": "handlers/hello.ts",
    "content": "export default async function (c, ctx) { ... }",
    "size": 156,
    "modifiedAt": "2026-01-12T10:30:00.000Z"
  }
}
```

### Create or Update a File

**POST** creates a new file (fails if exists).
**PUT** creates or overwrites.

```bash
curl -X PUT \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "export default async function (c, ctx) {\n  return c.json({ message: \"Hello!\" });\n}"
  }' \
  http://localhost:8000/api/files/handlers/hello.ts
```

**Alternative: Upload binary files**

Use `Content-Type: application/octet-stream` and send raw bytes:

```bash
curl -X PUT \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @my-file.ts \
  http://localhost:8000/api/files/handlers/my-file.ts
```

### Delete a File

```bash
curl -X DELETE \
  -H "X-API-Key: your-key" \
  http://localhost:8000/api/files/handlers/hello.ts
```

**Note:** File paths in URLs are URL-encoded. Special characters like spaces become `%20`.

## Organizing with Subdirectories

Use subdirectories to organize your code logically.

### By Feature

Group related handlers together:

```
code/
├── users/
│   ├── get.ts
│   ├── create.ts
│   ├── update.ts
│   ├── delete.ts
│   └── list.ts
├── posts/
│   ├── get.ts
│   ├── create.ts
│   └── list.ts
└── webhooks/
    ├── stripe.ts
    └── github.ts
```

### By Resource Type

Separate handlers from utilities:

```
code/
├── handlers/
│   ├── user-login.ts
│   ├── fetch-orders.ts
│   └── webhook-stripe.ts
├── lib/
│   ├── database.ts
│   ├── validators.ts
│   └── logger.ts
├── types/
│   ├── user.ts
│   └── order.ts
└── config/
    └── constants.ts
```

### Hybrid Approach

Combine feature-based and resource-based:

```
code/
├── api/
│   ├── users/
│   │   ├── get.ts
│   │   └── create.ts
│   └── orders/
│       ├── get.ts
│       └── create.ts
├── webhooks/
│   ├── stripe.ts
│   └── github.ts
├── lib/
│   └── database.ts
└── types.ts
```

**Best practice:** Choose a structure early and stick to it. Consistency makes navigation easier.

## Shared Utilities and Types

Avoid code duplication by creating shared modules.

### Shared Utilities

Create reusable functions in `lib/`:

**File:** `code/lib/database.ts`

```typescript
import { Client } from "npm:pg";

export class Database {
  constructor(private connectionString: string) {}

  async getUser(id: string) {
    const client = new Client(this.connectionString);
    await client.connect();
    const result = await client.query("SELECT * FROM users WHERE id = $1", [id]);
    await client.end();
    return result.rows[0];
  }
}
```

**File:** `code/lib/validators.ts`

```typescript
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateUserId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
```

### Importing Shared Code

Use **relative imports** to reference other files in `code/`:

**File:** `code/users/get.ts`

```typescript
import { Database } from "../lib/database.ts";
import { validateUserId } from "../lib/validators.ts";

export default async function (c, ctx) {
  const userId = ctx.params.id;

  if (!validateUserId(userId)) {
    return c.json({ error: "Invalid user ID" }, 400);
  }

  const dbUrl = await ctx.getSecret("DATABASE_URL");
  const db = new Database(dbUrl);
  const user = await db.getUser(userId);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
}
```

**Import rules:**

- Use relative paths: `./`, `../`
- Include `.ts` extension
- Paths are resolved at runtime by Deno

### Shared Types

Define TypeScript types once, use everywhere:

**File:** `code/types.ts`

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Post {
  id: string;
  userId: string;
  title: string;
  content: string;
  publishedAt: string;
}
```

**File:** `code/users/get.ts`

```typescript
import type { User } from "../types.ts";

export default async function (c, ctx): Promise<Response> {
  const user: User = await getUser(ctx.params.id);
  return c.json(user);
}
```

**Benefits:**

- Type safety across handlers
- Easier refactoring
- Better IDE autocomplete
- Single source of truth

## Hot-Reload Behavior

Crude Functions reloads handlers automatically when files change.

### How It Works

1. **File modification detected** - Handler loader tracks file modification time (`mtime`)
2. **Module cache invalidated** - Deno's import cache is cleared for that file
3. **Next request reloads** - Fresh import on the next function execution
4. **No server restart needed** - Changes take effect immediately

**Example workflow:**

1. Edit `code/hello.ts` and save
2. File's `mtime` updates
3. Next request to `/run/hello` reloads the handler
4. New code executes

### What Triggers Reload

- **File content changes** - Saving the file updates `mtime`
- **Manual touch** - `touch code/hello.ts` forces reload
- **Volume sync** - Docker volume updates trigger reload

### What Doesn't Trigger Reload

- **Unchanged files** - No reload if `mtime` hasn't changed
- **Shared modules** - Changing `lib/database.ts` doesn't reload handlers that import it (handlers must be touched to pick up the change)
- **Configuration changes** - Editing function routes doesn't reload handlers

### Best Practices

**Developing a handler:**

1. Edit the file in your editor
2. Save
3. Test with `curl` or browser
4. Repeat

**Updating shared utilities:**

1. Edit `lib/database.ts`
2. Save
3. Touch all handlers that import it: `touch code/users/*.ts`
4. Or restart the container to clear all caches

**Avoiding stale imports:**

- If a handler seems to use old code, touch the file: `touch code/handlers/my-function.ts`
- Or restart: `docker compose restart`

## Adding External Dependencies

Handlers can import external packages using full specifiers.

### NPM Packages

Prefix with `npm:`:

```typescript
import { camelCase } from "npm:lodash-es";
import dayjs from "npm:dayjs";
import { z } from "npm:zod@3.22.4"; // Pinned version
```

### JSR Packages

Prefix with `jsr:`:

```typescript
import { parse } from "jsr:@std/yaml";
import * as path from "jsr:@std/path";
```

### URL Imports

Use full URLs:

```typescript
import { z } from "https://deno.land/x/zod/mod.ts";
import { marked } from "https://esm.sh/marked@12.0.0";
```

### Local Imports

Use relative paths:

```typescript
import { db } from "./lib/database.ts";
import type { User } from "./types.ts";
```

**Important:** Deno downloads and caches dependencies on first import. This happens inside the container automatically.

For more details, see [External Dependencies](/getting-started#adding-external-dependencies).

## Path Traversal Prevention

Crude Functions prevents path traversal attacks by validating file paths.

### Blocked Patterns

The following are rejected:

- **Absolute paths:** `/etc/passwd`
- **Parent references:** `../../../etc/passwd`
- **Hidden files:** `.env`, `.git/config`
- **System files:** `/proc/self/environ`

### Allowed Patterns

- **Relative paths:** `handlers/hello.ts`
- **Subdirectories:** `lib/database.ts`, `users/get.ts`
- **Nested paths:** `api/v1/users/get.ts`

### How It Works

1. Path is normalized (removes `.`, `..`, duplicate slashes)
2. Checked for absolute paths (starts with `/`)
3. Checked for parent directory references (`..`)
4. Resolved against `./code/` directory
5. Verified to stay within `./code/` boundary

**Example validations:**

| Input | Result |
|-------|--------|
| `hello.ts` | ✅ Allowed |
| `lib/database.ts` | ✅ Allowed |
| `../config.ts` | ❌ Blocked (path traversal) |
| `/etc/passwd` | ❌ Blocked (absolute path) |
| `handlers/../../etc/passwd` | ❌ Blocked (escapes code/) |

**Security note:** This is basic path sanitization for preventing accidental misuse. Crude Functions is designed for trusted internal use, not for running untrusted code.

## File Upload Limits

### Web UI

- **Text files:** Up to 1 MB can be edited in-browser
- **Large files:** Download and re-upload instead of editing
- **Binary files:** Upload via file picker

### API

- **No hard limit** - Constrained by HTTP body size limits
- **Recommended:** Keep individual files under 10 MB
- **Large assets:** Consider storing externally and referencing by URL

## Common Patterns

### Function Handler Template

**File:** `code/handlers/template.ts`

```typescript
export default async function (c, ctx) {
  // 1. Extract parameters
  const id = ctx.params.id;
  const query = ctx.query.search;

  // 2. Validate input
  if (!id) {
    return c.json({ error: "Missing ID" }, 400);
  }

  // 3. Get secrets
  const apiKey = await ctx.getSecret("API_KEY");

  // 4. Business logic
  try {
    const result = await doSomething(id, apiKey);
    return c.json(result);
  } catch (error) {
    console.error(`[${ctx.requestId}] Error:`, error);
    return c.json({ error: "Operation failed" }, 500);
  }
}
```

### Shared Database Connection

**File:** `code/lib/db.ts`

```typescript
import { Client } from "npm:pg";

let globalClient: Client | null = null;

export async function getDbClient(connectionString: string): Promise<Client> {
  if (!globalClient) {
    globalClient = new Client(connectionString);
    await globalClient.connect();
  }
  return globalClient;
}
```

**Usage in handler:**

```typescript
import { getDbClient } from "../lib/db.ts";

export default async function (c, ctx) {
  const dbUrl = await ctx.getSecret("DATABASE_URL");
  const client = await getDbClient(dbUrl);
  const result = await client.query("SELECT * FROM users");
  return c.json(result.rows);
}
```

### Error Handling Wrapper

**File:** `code/lib/error-handler.ts`

```typescript
export async function withErrorHandling(
  handler: (c: any, ctx: any) => Promise<Response>,
  c: any,
  ctx: any
): Promise<Response> {
  try {
    return await handler(c, ctx);
  } catch (error) {
    console.error(`[${ctx.requestId}] Unhandled error:`, error);
    return c.json({
      error: "Internal server error",
      requestId: ctx.requestId,
    }, 500);
  }
}
```

**Usage:**

```typescript
import { withErrorHandling } from "../lib/error-handler.ts";

export default async function (c, ctx) {
  return withErrorHandling(async (c, ctx) => {
    // Your logic here
    return c.json({ success: true });
  }, c, ctx);
}
```

## Deployment Workflows

### Local Development

1. Edit files directly in `./code/` directory
2. Files are synced via Docker volume
3. Hot-reload picks up changes automatically
4. Test with `curl` or browser

### CI/CD Pipeline

Use the Files API to deploy:

```bash
#!/bin/bash
# deploy.sh

API_KEY="your-management-key"
BASE_URL="https://functions.example.com"

# Upload all .ts files
for file in code/**/*.ts; do
  path="${file#code/}"
  echo "Uploading $path..."
  curl -X PUT \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$file" \
    "$BASE_URL/api/files/$path"
done
```

### Git Integration

Keep code in version control:

```
your-project/
├── .git/
├── code/              # Your functions
│   ├── handlers/
│   ├── lib/
│   └── types.ts
├── docker-compose.yml
└── .gitignore
```

**.gitignore:**

```
data/                  # Exclude database and encryption keys
!code/                 # Include code directory
```

## Troubleshooting

### "Module not found" errors

**Cause:** Handler file doesn't exist or path is wrong

**Fix:**
1. Verify file exists: Check `/web/code`
2. Check function's handler path matches file path
3. Ensure path is relative to `code/` directory

### Shared module changes not taking effect

**Cause:** Handlers cache imported modules

**Fix:**
1. Touch handlers that import the module: `touch code/handlers/*.ts`
2. Or restart container: `docker compose restart`

### "Path traversal detected"

**Cause:** File path contains `..` or absolute paths

**Fix:** Use relative paths only (e.g., `lib/database.ts`, not `../lib/database.ts`)

### Files not syncing in Docker

**Cause:** Volume mount issue

**Fix:**
1. Verify docker-compose.yml volume mount: `- ./code:/app/code`
2. Check file permissions on host
3. Restart container: `docker compose restart`

### Imports fail with "Cannot find module"

**Cause:** Incorrect import specifier

**Fix:**
- Local imports: Use relative paths with `.ts` extension
- NPM packages: Use `npm:` prefix
- JSR packages: Use `jsr:` prefix
- URLs: Use full URL

**Examples:**

```typescript
// ✅ Correct
import { db } from "./lib/database.ts";
import { z } from "npm:zod";

// ❌ Wrong
import { db } from "./lib/database";     // Missing .ts
import { z } from "zod";                 // Missing npm: prefix
```

## Next Steps

- [Writing Functions](/guides/writing-functions) - Learn to write function handlers
- [API Reference](/reference/api) - Complete API documentation
- [Best Practices](/guides/best-practices) - Code organization tips
