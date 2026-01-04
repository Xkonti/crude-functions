# Secrets Management System - Design Document

This document describes the design of the secrets management system for Crude Functions.

## Problem Statement

Function handlers often need access to sensitive configuration: database credentials, API tokens, service URLs, etc. Currently, handlers access these via `Deno.env.get()`, which has limitations:

- All secrets are globally available to all functions
- No per-caller customization
- Secrets must be managed outside the system (environment variables)
- With planned git-sync feature, secrets in handler code become a security risk

## Goals

1. Provide secrets to function handlers without embedding them in code
2. Support multiple scoping levels for flexibility
3. Enable per-caller customization of function behavior
4. Maintain simplicity for basic use cases while enabling advanced patterns

## Secret Scopes

The system defines four scopes of secrets, from broadest to most specific:

### 1. Global Scope

Secrets available to **all** function handlers. Use for:
- Shared infrastructure credentials (database URLs, cache connections)
- System-wide API keys for external services
- Common configuration values

### 2. Function Scope

Secrets defined for a **specific function** (route). Use for:
- Function-specific credentials
- Configuration that differs per function
- Overriding global defaults for a particular function

### 3. API Key Group Scope

Secrets associated with an **API key group**. Available when a request authenticates with any key from that group. Use for:
- Shared configuration for a category of callers
- Service credentials that multiple callers need
- Group-level customization

### 4. API Key Scope

Secrets associated with a **specific API key**. Available only when that exact key authenticates. Use for:
- Per-caller identity (account IDs, customer identifiers)
- Caller-specific configuration (template prefixes, feature flags)
- Individual caller credentials

## Scope Resolution

### Override Order

When multiple scopes define a secret with the same name, the more specific scope wins:

```
Global → Function → Group → Key
```

Each subsequent scope can override values from previous scopes.

**Example:**
- Global defines `LOG_LEVEL=info`
- Function defines `LOG_LEVEL=debug`
- Group defines nothing
- Key defines `LOG_LEVEL=warn`

Result: `LOG_LEVEL=warn` (Key scope wins)

### Public Routes (No API Key Required)

When a route does not require authentication (`keys: []` or undefined):
- Global and Function scoped secrets are available
- Group and Key scoped secrets are **empty**

This is the expected behavior - there is no caller identity to resolve group/key secrets from.

## Handler API

Secrets are accessed through methods on the function context (`ctx`). Secrets are fetched **lazily** - only when requested, not pre-computed for every request. This keeps overhead minimal when functions use few or no secrets.

### `ctx.getSecret(name, scope?): Promise<string | undefined>`

Retrieves a secret value by name.

**Parameters:**
- `name` - The secret name to look up
- `scope` (optional) - One of `'global'`, `'function'`, `'group'`, `'key'`. If omitted, returns the merged value (most specific scope wins).

**Returns:** A promise resolving to the secret value, or `undefined` if not found.

**Examples:**

```typescript
export default async function (c, ctx) {
  // Get from merged scope (most common usage)
  const smtpHost = await ctx.getSecret('SMTP_HOST');

  // Get from specific scope
  const globalDefault = await ctx.getSecret('SMTP_HOST', 'global');
  const callerOverride = await ctx.getSecret('SMTP_HOST', 'key');

  // Parallel fetching when multiple secrets needed
  const [smtpUser, smtpPass] = await Promise.all([
    ctx.getSecret('SMTP_USER'),
    ctx.getSecret('SMTP_PASS'),
  ]);

  if (!smtpHost) {
    return c.json({ error: "SMTP not configured" }, 500);
  }

  // Use the secret...
  return c.json({ ok: true });
}
```

**Optimization note:** When fetching from merged scope, the implementation can query scopes in reverse specificity order (key → group → function → global) and stop at the first hit, minimizing database lookups.

### `ctx.getCompleteSecret(name): Promise<object | undefined>`

Retrieves a secret's values across all scopes. Useful for debugging, logging, or when a function needs to inspect the full override chain.

**Parameters:**
- `name` - The secret name to look up

**Returns:** A promise resolving to an object containing all scope values, or `undefined` if the secret doesn't exist in any scope.

**Return structure:**

```typescript
{
  global?: string,
  function?: string,
  group?: { value: string, group: string },
  key?: { value: string, group: string, key: string }
}
```

The `group` and `key` scopes include metadata about which API key group and key provided the value.

**Examples:**

```typescript
export default async function (c, ctx) {
  const details = await ctx.getCompleteSecret('SENDER_EMAIL');

  // Example result when called with 'customer-acme' key from 'email' group:
  // {
  //   global: "default@example.com",
  //   function: "noreply@myapp.com",
  //   group: { value: "noreply@email-service.com", group: "email" },
  //   key: { value: "noreply@acme.com", group: "email", key: "customer-acme" }
  // }

  // Example result when only some scopes have the secret:
  // {
  //   global: "default@example.com",
  //   key: { value: "noreply@acme.com", group: "email", key: "customer-acme" }
  // }

  console.log(`Using SENDER_EMAIL from ${Object.keys(details).pop()} scope`);

  return c.json({ details });
}
```

## Web UI

### Secret Configuration Locations

Secrets are configured in context-appropriate locations within the existing UI:

| Scope | Location |
|-------|----------|
| Global | Dedicated "Global Secrets" page |
| Function | "Secrets" section within the function edit page |
| Group | "Secrets" button next to each group on the API Keys page |
| Key | "Secrets" button next to each key on the API Keys page |

This approach keeps secret management close to the entity they belong to. Users think "I need to configure secrets for this function" and find them on the function page.

### Secrets Preview (Function Edit Page)

The function edit page includes a **preview feature** showing all secrets available to the function. This helps function authors understand what's available without mentally traversing multiple pages.

**Location:** Below the function-specific secrets section, a "Preview Available Secrets" button expands a read-only list.

**Display format:**

```
SMTP_HOST
  └─ via global scope

EMAIL_TEMPLATE
  └─ via function scope

SENDER_EMAIL
  └─ via global scope
  └─ via function scope
  └─ via `email` API key group
  └─ via 3 API keys (expand ▼)
       • email/customer-acme
       • email/customer-globex
       • email/customer-initech
```

**Behavior:**
- Lists all unique secret names available to this function
- Shows which scopes define each secret
- For group/key scopes, only shows groups that the function accepts (from its `keys` configuration)
- Key-level details collapsed by default with expansion option
- On hover, shows the actual value for each scope (for debugging)

**Implementation notes:**
- Requires a dedicated API endpoint to gather this data
- Global and function secrets loaded immediately
- Group and key secrets can be lazy-loaded on expansion to reduce initial query cost

## Example Use Case: Email Service

**Scenario:** Multiple functions send emails. Different callers need different sender configurations.

**Setup:**

1. **Global secrets:** (none for this example)

2. **Function secrets for `send-welcome-email`:**
   ```
   EMAIL_TEMPLATE=welcome
   ```

3. **Group secrets for `email` key group:**
   ```
   SMTP_HOST=smtp.mailservice.com
   SMTP_USER=service-account
   SMTP_PASS=secret123
   ```

4. **Key secrets for key `customer-acme` in `email` group:**
   ```
   SENDER_NAME=ACME Corp
   SENDER_EMAIL=noreply@acme.com
   REPLY_TO=support@acme.com
   ```

5. **Key secrets for key `customer-globex` in `email` group:**
   ```
   SENDER_NAME=Globex Inc
   SENDER_EMAIL=notifications@globex.com
   REPLY_TO=help@globex.com
   ```

**Handler code:**

```typescript
export default async function (c, ctx) {
  // Get merged values - picks most specific scope automatically
  const [smtpHost, template, senderName, senderEmail] = await Promise.all([
    ctx.getSecret('SMTP_HOST'),       // from group
    ctx.getSecret('EMAIL_TEMPLATE'),  // from function
    ctx.getSecret('SENDER_NAME'),     // from key
    ctx.getSecret('SENDER_EMAIL'),    // from key
  ]);

  // Send email using these values...

  return c.json({
    sent: true,
    from: `${senderName} <${senderEmail}>`
  });
}
```

**When called with `customer-acme` API key:**
- `SMTP_HOST` = "smtp.mailservice.com" (from group)
- `EMAIL_TEMPLATE` = "welcome" (from function)
- `SENDER_NAME` = "ACME Corp" (from key)
- `SENDER_EMAIL` = "noreply@acme.com" (from key)

**When called with `customer-globex` API key:**
- `SMTP_HOST` = "smtp.mailservice.com" (from group - same)
- `EMAIL_TEMPLATE` = "welcome" (from function - same)
- `SENDER_NAME` = "Globex Inc" (from key - different)
- `SENDER_EMAIL` = "notifications@globex.com" (from key - different)

**Benefits:**
- SMTP credentials managed once at group level, shared by all email-related keys
- Per-caller branding without code changes
- Function-specific defaults (template name) isolated to the function
- Adding a new customer = adding a new API key with their secrets

## Design Principles

### Lazy Evaluation

Secrets are fetched on-demand, not pre-computed. A function that uses zero secrets pays zero cost. A function that uses one secret performs one lookup (or fewer with caching).

### Least Surprise

- If you only use global secrets, the system behaves like simple environment variables
- Advanced scopes are opt-in complexity
- `getSecret()` without scope parameter does the intuitive thing (returns merged value)

### Explicit Over Implicit

- Scope parameter makes access explicit when needed
- `getCompleteSecret()` provides full visibility for debugging

### Fail-Safe for Public Routes

- Missing caller context (no API key) results in empty group/key secrets, not errors
- Functions can check for presence and handle accordingly

## Implementation

### Database Schema

All secrets are stored in a single `secrets` table. This simplifies the implementation compared to separate tables per scope, while still allowing efficient queries for any scope.

#### Table Definition

```sql
CREATE TABLE secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  comment TEXT,
  scope INTEGER NOT NULL,
  function_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
  api_group_id INTEGER REFERENCES api_key_groups(id) ON DELETE CASCADE,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### Column Details

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `name` | TEXT | Secret name. Allowed characters: `a-zA-Z0-9_-` |
| `value` | TEXT | Encrypted secret value (see Encryption section) |
| `comment` | TEXT | Optional description for UI display |
| `scope` | INTEGER | Scope discriminator: 0=global, 1=function, 2=group, 3=key |
| `function_id` | INTEGER | Foreign key to `routes.id`. Set when scope=1, NULL otherwise |
| `api_group_id` | INTEGER | Foreign key to `api_key_groups.id`. Set when scope=2, NULL otherwise |
| `api_key_id` | INTEGER | Foreign key to `api_keys.id`. Set when scope=3, NULL otherwise |
| `created_at` | TEXT | Creation timestamp |
| `modified_at` | TEXT | Last modification timestamp |

#### Scope Values

```
0 = global     (no reference needed)
1 = function   (function_id required)
2 = group      (api_group_id required)
3 = key        (api_key_id required)
```

#### Foreign Key Behavior

All foreign keys use `ON DELETE CASCADE` for automatic cleanup:

- `function_id` - when a route is deleted, its secrets are automatically removed
- `api_group_id` - when an API key group is deleted, its secrets are automatically removed
- `api_key_id` - when an API key is deleted, its secrets are automatically removed

#### Indexes

**Current Implementation: No Indexes**

The initial implementation includes no indexes on the `secrets` table. This decision is based on expected dataset size and query patterns:

**Dataset Size Analysis:**
- Global secrets: ~50
- Function secrets: ~100 functions × 3 secrets = ~300
- Group secrets: ~30 groups × 5 secrets = ~150
- Key secrets: ~30 groups × 10 keys × 3 secrets = ~900
- **Total: ~1,400 secrets** (up to ~5,000 expected)

At this scale, full table scans are measured in microseconds. The overhead of maintaining indexes (write performance, storage, schema complexity) outweighs the negligible query performance gains.

**When to Add Indexes:**

If the dataset grows beyond ~10,000 secrets or query performance becomes measurable, consider adding:

```sql
-- Primary lookup: find secrets by name across relevant scopes
CREATE INDEX idx_secrets_name_scope ON secrets(name, scope);

-- Scope-specific lookups with partial indexes (smaller, faster)
CREATE INDEX idx_secrets_function
  ON secrets(function_id)
  WHERE function_id IS NOT NULL;

CREATE INDEX idx_secrets_group
  ON secrets(api_group_id)
  WHERE api_group_id IS NOT NULL;

CREATE INDEX idx_secrets_key
  ON secrets(api_key_id)
  WHERE api_key_id IS NOT NULL;
```

These can be added later without migration complexity using simple `CREATE INDEX` statements.

#### Uniqueness

SQLite doesn't handle `UNIQUE` constraints well with multiple nullable columns. Uniqueness is enforced at the application level:

- Before inserting a global secret: check `WHERE name = ? AND scope = 0`
- Before inserting a function secret: check `WHERE name = ? AND scope = 1 AND function_id = ?`
- Before inserting a group secret: check `WHERE name = ? AND scope = 2 AND api_group_id = ?`
- Before inserting a key secret: check `WHERE name = ? AND scope = 3 AND api_key_id = ?`

#### Query Patterns

**Single scope lookup:**

```sql
SELECT value FROM secrets
WHERE name = ? AND scope = 0;  -- global

SELECT value FROM secrets
WHERE name = ? AND scope = 1 AND function_id = ?;  -- function
```

**Merged scope lookup (all applicable scopes at once):**

```sql
SELECT scope, value, function_id, api_group_id, api_key_id
FROM secrets
WHERE name = ?
  AND (
    scope = 0
    OR (scope = 1 AND function_id = ?)
    OR (scope = 2 AND api_group_id = ?)
    OR (scope = 3 AND api_key_id = ?)
  );
```

The application then picks the most specific scope (highest scope value) from the results.

### Encryption

Secret values are encrypted at rest using AES-256-GCM. This protects against database file exposure while maintaining query capability on non-sensitive columns (name, scope, references).

#### Encryption Key

The encryption key is provided via environment variable:

```
SECRETS_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
```

Generate a key:

```bash
openssl rand -base64 32
```

**Startup behavior:** If `SECRETS_ENCRYPTION_KEY` is not set, the server refuses to start with a clear error message. There is no fallback or unencrypted mode.

#### Storage Format

Each encrypted value is stored as base64-encoded bytes containing:

```
base64(IV || ciphertext || auth_tag)
```

- **IV (Initialization Vector):** 12 bytes, randomly generated per encryption
- **Ciphertext:** Variable length, the encrypted secret
- **Auth tag:** 16 bytes, included automatically by AES-GCM

#### EncryptionService

```typescript
export interface EncryptionServiceOptions {
  /** Base64-encoded 256-bit (32-byte) key */
  encryptionKey: string;
}

export class EncryptionService {
  private key: CryptoKey | null = null;
  private readonly rawKey: Uint8Array;

  constructor(options: EncryptionServiceOptions) {
    this.rawKey = base64ToBytes(options.encryptionKey);
    if (this.rawKey.length !== 32) {
      throw new Error("Encryption key must be 32 bytes (256 bits)");
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );

    // Combine: IV + ciphertext (auth tag is appended by GCM)
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return bytesToBase64(combined);
  }

  async decrypt(encrypted: string): Promise<string> {
    const key = await this.getKey();
    const combined = base64ToBytes(encrypted);

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  private async getKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = await crypto.subtle.importKey(
        "raw",
        this.rawKey,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    }
    return this.key;
  }
}
```

#### Security Properties

**What encryption protects:**
- Database file stolen or leaked
- Database backups exposed
- SQL injection attacks reading raw values

**What encryption does not protect:**
- Compromised server with access to both database and environment variables
- Memory inspection of running process
- Authorized access through the API

For internal tooling, this threat model is appropriate.

### API Design

Secrets are managed through a unified `/api/secrets` resource. All endpoints require management authentication (session or `X-API-Key` with management group).

#### Endpoints

**List secrets by scope:**

```
GET /api/secrets?scope=global
GET /api/secrets?scope=function&functionId=123
GET /api/secrets?scope=group&groupId=456
GET /api/secrets?scope=key&keyId=789
```

Returns array of secrets (values are decrypted for display):

```json
[
  {
    "id": 1,
    "name": "SMTP_HOST",
    "value": "smtp.example.com",
    "comment": "Production mail server",
    "scope": "global",
    "createdAt": "2024-01-15T10:30:00Z",
    "modifiedAt": "2024-01-15T10:30:00Z"
  }
]
```

**Create a secret:**

```
POST /api/secrets
```

Request body:

```json
{
  "name": "SMTP_HOST",
  "value": "smtp.example.com",
  "comment": "Production mail server",
  "scope": "global"
}
```

For scoped secrets, include the reference:

```json
{
  "name": "EMAIL_TEMPLATE",
  "value": "welcome",
  "scope": "function",
  "functionId": 123
}
```

```json
{
  "name": "SMTP_HOST",
  "value": "smtp.mailservice.com",
  "scope": "group",
  "groupId": 456
}
```

```json
{
  "name": "SENDER_NAME",
  "value": "ACME Corp",
  "scope": "key",
  "keyId": 789
}
```

**Update a secret:**

```
PUT /api/secrets/:id
```

```json
{
  "value": "new-value",
  "comment": "Updated comment"
}
```

Only `value` and `comment` can be updated. To change scope or name, delete and recreate.

**Delete a secret:**

```
DELETE /api/secrets/:id
```

#### Preview Endpoint

For the function edit page preview feature:

```
GET /api/secrets/preview?functionId=123
```

Returns all secrets available to the function, grouped by source:

```json
{
  "secrets": [
    {
      "name": "SMTP_HOST",
      "sources": [
        { "scope": "global", "value": "smtp.default.com" },
        { "scope": "group", "groupId": 5, "groupName": "email", "value": "smtp.email.com" }
      ]
    },
    {
      "name": "SENDER_EMAIL",
      "sources": [
        { "scope": "global", "value": "noreply@default.com" },
        { "scope": "key", "keyId": 10, "groupName": "email", "keyValue": "customer-acme", "value": "noreply@acme.com" },
        { "scope": "key", "keyId": 11, "groupName": "email", "keyValue": "customer-globex", "value": "noreply@globex.com" }
      ]
    }
  ]
}
```

This endpoint only includes groups that the function accepts (from its `keys` configuration).

## Future Considerations

These items are out of scope for initial implementation but noted for future reference:

1. **Optional API key authentication:** Routes where API key is optional - public access with enhanced behavior when authenticated
2. **Secret validation:** Declaring required secrets per route for fail-fast configuration validation
3. **Deno.env / process.env integration:** Patching environment variable access to return merged secrets for library compatibility
4. **Audit logging:** Tracking which secrets were accessed by which functions/callers
5. **Caching:** Request-scoped and global caches to reduce database lookups for frequently accessed secrets
6. **Unified secrets management page:** Single page showing all scopes with navigation (for future SPA interface)
7. **Simulate with specific key:** Preview feature allowing selection of a specific API key to see exact resolved values
8. **Encryption key rotation:** Add `key_version` column to support rotating encryption keys without downtime
