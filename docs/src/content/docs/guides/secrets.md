---
title: Secrets Management
description: Secure storage and hierarchical secret scopes
---

Crude Functions provides a powerful secrets management system designed to store sensitive data like API keys, database credentials, and tokens securely. Secrets are encrypted at rest using AES-256-GCM and support a hierarchical scoping system that lets you override values based on execution context.

## What are Secrets?

Secrets are encrypted key-value pairs that your functions can access at runtime. Instead of hardcoding sensitive data in your function code, you store it as a secret and retrieve it using `ctx.getSecret()`.

**Common use cases:**

- Database connection strings
- Third-party API keys
- OAuth credentials
- SMTP server settings
- Webhook signing secrets
- Environment-specific configuration

## When to Use Secrets

Use secrets for any sensitive data that:

- Should not be stored in code or version control
- Needs encryption at rest
- Requires different values for different contexts (staging vs production, per-customer settings, etc.)
- Must be rotated periodically for security

**Examples:**

```typescript
// ❌ Bad: Hardcoded credentials
const apiKey = "sk_live_abc123";
const dbUrl = "postgresql://user:password@localhost/mydb";

// ✅ Good: Retrieved from secrets
const apiKey = await ctx.getSecret("STRIPE_API_KEY");
const dbUrl = await ctx.getSecret("DATABASE_URL");
```

## Secret Scopes

Secrets can be scoped at four levels, creating a flexible hierarchy. When you request a secret, Crude Functions searches from the most specific scope to the most general, returning the first match.

### The Four Scopes

1. **Key scope** - Tied to a specific API key
2. **Group scope** - Tied to an API key group
3. **Function scope** - Tied to a specific function
4. **Global scope** - Available to all functions

### Hierarchical Resolution

When you call `ctx.getSecret("SECRET_NAME")` without specifying a scope, Crude Functions uses this resolution order:

```
Key > Group > Function > Global
```

The most specific scope wins. This allows you to:

- Set default values at the global level
- Override for specific functions
- Override for specific API key groups
- Override for individual API keys

### Visual Example

```
Global:    DATABASE_URL = postgresql://shared-db.internal:5432/main
                                    ↓
Function:  DATABASE_URL = postgresql://function-specific-db:5432/analytics
                                    ↓
Group:     DATABASE_URL = postgresql://readonly-db:5432/main
                                    ↓
Key:       DATABASE_URL = postgresql://customer-specific-db:5432/client_123
```

**Result:** A function called with the specific API key gets `postgresql://customer-specific-db:5432/client_123`, the most specific value.

### Scope Selection Guide

| Scope | When to Use | Example |
|-------|-------------|---------|
| **Global** | Default values, shared configuration | `SMTP_HOST`, `LOG_LEVEL` |
| **Function** | Function-specific overrides | Analytics function uses read-replica DB |
| **Group** | Team or environment-based settings | `staging` group gets staging API keys |
| **Key** | Customer-specific or per-client data | Per-customer branding, isolated databases |

## Creating Secrets via Web UI

### Global Secrets

1. Navigate to **Secrets** in the sidebar
2. Click **"Add Secret"**
3. Enter the secret name (e.g., `DATABASE_URL`)
4. Enter the secret value
5. Select **"Global"** scope
6. Optionally add a comment (e.g., "Production database connection")
7. Click **"Create"**

### Function-Scoped Secrets

1. Navigate to **Secrets** in the sidebar
2. Click **"Add Secret"**
3. Enter the secret name
4. Enter the secret value
5. Select **"Function"** scope
6. Choose the specific function from the dropdown
7. Optionally add a comment
8. Click **"Create"**

### Group-Scoped Secrets

1. Navigate to **Secrets** in the sidebar
2. Click **"Add Secret"**
3. Enter the secret name
4. Enter the secret value
5. Select **"Group"** scope
6. Choose the API key group from the dropdown
7. Optionally add a comment
8. Click **"Create"**

### Key-Scoped Secrets

1. Navigate to **Secrets** in the sidebar
2. Click **"Add Secret"**
3. Enter the secret name
4. Enter the secret value
5. Select **"Key"** scope
6. Choose the specific API key from the dropdown
7. Optionally add a comment
8. Click **"Create"**

:::tip[Screenshot Placeholder]
*TODO: Add screenshot showing the Create Secret form with scope selection*
:::

## Accessing Secrets in Handlers

### Basic Usage - Hierarchical Resolution

The most common pattern is to let Crude Functions automatically resolve the secret using the hierarchy:

```typescript
export default async function (c, ctx) {
  // Automatically resolves: Key > Group > Function > Global
  const apiKey = await ctx.getSecret("STRIPE_API_KEY");

  if (!apiKey) {
    return c.json({ error: "Stripe API key not configured" }, 500);
  }

  // Use the secret
  const response = await fetch("https://api.stripe.com/v1/charges", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });

  return c.json(await response.json());
}
```

### Fetching Multiple Secrets Efficiently

Fetch secrets in parallel for better performance:

```typescript
export default async function (c, ctx) {
  // Load multiple secrets concurrently
  const [smtpHost, smtpUser, smtpPass, smtpPort] = await Promise.all([
    ctx.getSecret("SMTP_HOST"),
    ctx.getSecret("SMTP_USER"),
    ctx.getSecret("SMTP_PASS"),
    ctx.getSecret("SMTP_PORT"),
  ]);

  // Validate required secrets
  if (!smtpHost || !smtpUser || !smtpPass) {
    return c.json({ error: "SMTP configuration incomplete" }, 500);
  }

  // Use secrets to send email
  const emailSent = await sendEmail({
    host: smtpHost,
    user: smtpUser,
    password: smtpPass,
    port: parseInt(smtpPort || "587"),
  });

  return c.json({ success: emailSent });
}
```

### Explicit Scope Selection

Access secrets from specific scopes when you need precise control:

```typescript
export default async function (c, ctx) {
  // Get secret from specific scope
  const globalDefault = await ctx.getSecret("LOG_LEVEL", "global");
  const functionOverride = await ctx.getSecret("LOG_LEVEL", "function");
  const groupOverride = await ctx.getSecret("LOG_LEVEL", "group");
  const keyOverride = await ctx.getSecret("LOG_LEVEL", "key");

  return c.json({
    global: globalDefault,         // "info" (from global scope)
    function: functionOverride,    // "debug" (function override)
    group: groupOverride,          // undefined (not set at group level)
    key: keyOverride,              // "error" (most specific)
  });
}
```

**Available scope values:**

- `"global"` - Global scope
- `"function"` - Function scope
- `"group"` - Group scope
- `"key"` - Key scope

### Complete Secret Inspection

Use `ctx.getCompleteSecret()` to see all values across all scopes with metadata:

```typescript
export default async function (c, ctx) {
  // Get complete details for a secret across all scopes
  const details = await ctx.getCompleteSecret("DATABASE_URL");

  if (!details) {
    return c.json({ error: "DATABASE_URL not found in any scope" }, 500);
  }

  // Example response shape:
  // {
  //   global: "postgresql://shared-db:5432/main",
  //   function: "postgresql://analytics-db:5432/analytics",
  //   group: {
  //     value: "postgresql://readonly-db:5432/main",
  //     groupId: 5,
  //     groupName: "readonly-users"
  //   },
  //   key: {
  //     value: "postgresql://customer-db:5432/client_123",
  //     groupId: 5,
  //     groupName: "readonly-users",
  //     keyId: 10,
  //     keyName: "client-123-key"
  //   }
  // }

  // Determine which value will be used
  const effectiveValue = details.key?.value ||
                         details.group?.value ||
                         details.function ||
                         details.global;

  return c.json({
    allSources: details,
    effectiveValue,
    resolution: details.key ? "key" :
                details.group ? "group" :
                details.function ? "function" : "global"
  });
}
```

### Handling Missing Secrets

Always check for `undefined` before using secrets:

```typescript
export default async function (c, ctx) {
  const apiKey = await ctx.getSecret("THIRD_PARTY_API_KEY");

  // Check if secret exists
  if (!apiKey) {
    console.error("THIRD_PARTY_API_KEY is not configured");
    return c.json({
      error: "Service not configured",
      requestId: ctx.requestId
    }, 500);
  }

  // Provide defaults for optional secrets
  const logLevel = await ctx.getSecret("LOG_LEVEL") || "info";
  const timeout = parseInt(await ctx.getSecret("API_TIMEOUT") || "5000");

  // Use secrets safely
  const response = await fetch("https://api.example.com/data", {
    headers: { "Authorization": `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeout),
  });

  return c.json(await response.json());
}
```

## Scope-Specific Access Patterns

### Global Scope - Shared Configuration

Use global secrets for configuration that applies to all functions:

```typescript
export default async function (c, ctx) {
  // These are available to all functions
  const logLevel = await ctx.getSecret("LOG_LEVEL") || "info";
  const environment = await ctx.getSecret("ENVIRONMENT") || "production";
  const corsOrigin = await ctx.getSecret("CORS_ORIGIN") || "*";

  console.log(`Running in ${environment} mode with log level ${logLevel}`);

  const response = c.json({ message: "Success" });
  response.headers.set("Access-Control-Allow-Origin", corsOrigin);

  return response;
}
```

### Function Scope - Per-Function Overrides

Use function-scoped secrets when a specific function needs different settings:

```typescript
// Analytics function needs read-replica database
export default async function (c, ctx) {
  // This function has a function-scoped DATABASE_URL override
  // pointing to the read-replica
  const dbUrl = await ctx.getSecret("DATABASE_URL");
  // Returns: postgresql://readonly-replica:5432/analytics

  const data = await fetchFromDatabase(dbUrl);
  return c.json(data);
}
```

### Group Scope - Team or Environment-Based Settings

Use group-scoped secrets for environment-specific or team-specific configuration:

**Example: Staging vs Production**

```typescript
// API key group: "staging"
// Group secret: API_ENDPOINT = https://staging.api.example.com

// API key group: "production"
// Group secret: API_ENDPOINT = https://api.example.com

export default async function (c, ctx) {
  // Returns staging or production endpoint based on which API key was used
  const endpoint = await ctx.getSecret("API_ENDPOINT");

  const response = await fetch(`${endpoint}/users`, {
    headers: { "Authorization": `Bearer ${await ctx.getSecret("API_KEY")}` }
  });

  return c.json(await response.json());
}
```

### Key Scope - Per-Client or Per-User Settings

Use key-scoped secrets for customer-specific or user-specific data:

**Example: Multi-tenant Application**

```typescript
// Each customer has their own API key with key-scoped secrets:
// - Customer A's key: TENANT_ID=customer-a, DATABASE=tenant_a_db
// - Customer B's key: TENANT_ID=customer-b, DATABASE=tenant_b_db

export default async function (c, ctx) {
  // Get customer-specific configuration
  const tenantId = await ctx.getSecret("TENANT_ID");
  const database = await ctx.getSecret("DATABASE");

  if (!tenantId) {
    return c.json({ error: "Tenant not configured for this API key" }, 403);
  }

  console.log(`Processing request for tenant: ${tenantId}`);

  // Query customer-specific database
  const data = await queryDatabase(database, tenantId);

  return c.json(data);
}
```

**Example: Per-Customer Branding**

```typescript
// Key-scoped secrets per customer API key:
// - LOGO_URL = https://cdn.example.com/logos/acme.png
// - BRAND_COLOR = #FF5733
// - SENDER_NAME = ACME Corp Support

export default async function (c, ctx) {
  const [logoUrl, brandColor, senderName] = await Promise.all([
    ctx.getSecret("LOGO_URL"),
    ctx.getSecret("BRAND_COLOR"),
    ctx.getSecret("SENDER_NAME"),
  ]);

  // Use customer-specific branding in email template
  const emailHtml = `
    <div style="background-color: ${brandColor}">
      <img src="${logoUrl}" alt="Logo">
      <p>Best regards,<br>${senderName}</p>
    </div>
  `;

  await sendEmail({
    to: ctx.query.email,
    subject: "Your Order Confirmation",
    html: emailHtml,
  });

  return c.json({ sent: true });
}
```

## Public Routes and Secret Access

For routes that don't require API keys (configured with `keys: []`), only **global** and **function** scopes are available:

```typescript
// Route configured with: keys: []  (public access)
export default async function (c, ctx) {
  // ✅ Works - global and function scopes are always available
  const publicApiKey = await ctx.getSecret("PUBLIC_API_KEY");
  const functionConfig = await ctx.getSecret("CONFIG", "function");

  // ❌ Returns undefined - no authenticated key group
  const groupSecret = await ctx.getSecret("GROUP_SECRET", "group");
  const keySecret = await ctx.getSecret("KEY_SECRET", "key");

  console.log(`Authenticated key group: ${ctx.authenticatedKeyGroup}`);
  // Logs: undefined

  return c.json({
    hasPublicApiKey: publicApiKey !== undefined,
    hasFunctionConfig: functionConfig !== undefined,
    hasGroupSecret: groupSecret !== undefined,  // false
    hasKeySecret: keySecret !== undefined,      // false
  });
}
```

## Encryption at Rest

All secrets are encrypted before being stored in the database.

### Encryption Details

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key Size:** 256 bits (32 bytes)
- **IV (Initialization Vector):** 12 bytes, randomly generated per encryption
- **Storage Format:** `VERSION + base64(IV || ciphertext || auth_tag)`
- **Key Rotation:** Automatic with configurable intervals (default: 90 days)

### Security Guarantees

- Each secret uses a unique random IV
- Authenticated encryption prevents tampering
- Keys are versioned for rotation
- Automatic re-encryption during key rotation
- Keys stored in `data/encryption-keys.json` (must be backed up)

### Key Rotation

Encryption keys are automatically rotated on a schedule. During rotation:

1. New encryption keys are generated
2. All existing secrets are re-encrypted with the new keys
3. Old keys are kept temporarily for backwards compatibility
4. Key rotation is atomic and safe

**Configure rotation interval:**

Navigate to **Settings** > **Encryption** and adjust `encryption.key-rotation.interval-days` (default: 90 days).

**Manual rotation:**

```bash
curl -X POST http://localhost:8000/api/encryption-keys/rotation \
  -H "X-API-Key: your-management-key"
```

:::caution[Important]
**Backup your encryption keys!** If you lose `data/encryption-keys.json`, all encrypted secrets and API keys become permanently unrecoverable.
:::

## Secret Naming Rules

Secret names must follow these rules:

- **Pattern:** `[a-zA-Z0-9_-]+` (alphanumeric, underscores, and hyphens)
- **Case-sensitive:** `API_KEY` and `api_key` are different secrets
- **Unique within scope:** Cannot have duplicate names in the same scope

**Valid examples:**

```
API_KEY
DATABASE_URL
SMTP_HOST
stripe-webhook-secret
oauth_client_id
ThirdPartyToken
```

**Invalid examples:**

```
api.key              # Contains period
my secret            # Contains space
secret@example       # Contains @
```

## Secret Size Limits

- **Maximum plaintext size:** 16 KB (16,384 bytes)
- **Encrypted size:** Approximately 21.4 KB (includes IV and auth tag)
- **Storage validation:** Attempting to store larger secrets fails with `OversizedPlaintextError`

For large configuration data, consider:

- Storing a URL/path to the data as a secret
- Breaking data into multiple smaller secrets
- Using a configuration service and storing its credentials as secrets

## Managing Secrets via API

### List Secrets

```bash
# List all global secrets
curl -H "X-API-Key: your-key" \
  "http://localhost:8000/api/secrets?scope=global"

# List secrets for a function
curl -H "X-API-Key: your-key" \
  "http://localhost:8000/api/secrets?functionId=1"

# Include decrypted values
curl -H "X-API-Key: your-key" \
  "http://localhost:8000/api/secrets?includeValues=true"
```

### Create Secret

```bash
# Global secret
curl -X POST \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DATABASE_URL",
    "value": "postgresql://localhost:5432/mydb",
    "scope": "global",
    "comment": "Production database connection"
  }' \
  http://localhost:8000/api/secrets

# Function-scoped secret
curl -X POST \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API_ENDPOINT",
    "value": "https://staging.api.example.com",
    "scope": "function",
    "functionId": 1,
    "comment": "Staging endpoint for this function"
  }' \
  http://localhost:8000/api/secrets

# Group-scoped secret
curl -X POST \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "LOG_LEVEL",
    "value": "debug",
    "scope": "group",
    "groupId": 2,
    "comment": "Debug logging for staging group"
  }' \
  http://localhost:8000/api/secrets

# Key-scoped secret
curl -X POST \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TENANT_ID",
    "value": "customer-123",
    "scope": "key",
    "keyId": 5,
    "comment": "Customer identifier for this API key"
  }' \
  http://localhost:8000/api/secrets
```

### Update Secret

```bash
curl -X PUT \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "new-secret-value",
    "comment": "Updated credentials"
  }' \
  http://localhost:8000/api/secrets/1
```

### Delete Secret

```bash
curl -X DELETE \
  -H "X-API-Key: your-key" \
  http://localhost:8000/api/secrets/1
```

### Search Secrets by Name

```bash
# Search across all scopes
curl -H "X-API-Key: your-key" \
  "http://localhost:8000/api/secrets/by-name/DATABASE_URL"

# Search in specific scope
curl -H "X-API-Key: your-key" \
  "http://localhost:8000/api/secrets/by-name/DATABASE_URL?scope=global"
```

## Best Practices

### 1. Use Hierarchical Resolution

Let Crude Functions handle scope resolution automatically unless you need specific behavior:

```typescript
// ✅ Good: Simple and automatic
const apiKey = await ctx.getSecret("API_KEY");

// ⚠️ Only when needed: Explicit scope
const globalKey = await ctx.getSecret("API_KEY", "global");
```

### 2. Always Check for Undefined

Secrets might not exist, so always validate:

```typescript
// ✅ Good: Graceful handling
const apiKey = await ctx.getSecret("API_KEY");
if (!apiKey) {
  return c.json({ error: "API_KEY not configured" }, 500);
}

// ❌ Bad: Assumes secret exists
const response = await fetch(url, {
  headers: { "Authorization": `Bearer ${await ctx.getSecret("API_KEY")}` }
});
```

### 3. Fetch Secrets in Parallel

Use `Promise.all()` for better performance:

```typescript
// ✅ Good: Parallel fetching
const [host, user, pass] = await Promise.all([
  ctx.getSecret("SMTP_HOST"),
  ctx.getSecret("SMTP_USER"),
  ctx.getSecret("SMTP_PASS"),
]);

// ❌ Slower: Sequential fetching
const host = await ctx.getSecret("SMTP_HOST");
const user = await ctx.getSecret("SMTP_USER");
const pass = await ctx.getSecret("SMTP_PASS");
```

### 4. Provide Defaults for Optional Secrets

Use the OR operator for non-critical configuration:

```typescript
const logLevel = await ctx.getSecret("LOG_LEVEL") || "info";
const timeout = parseInt(await ctx.getSecret("TIMEOUT") || "5000");
const corsOrigin = await ctx.getSecret("CORS_ORIGIN") || "*";
```

### 5. Use Comments for Documentation

Add comments when creating secrets to document their purpose:

```json
{
  "name": "WEBHOOK_SECRET",
  "value": "whsec_abc123",
  "scope": "global",
  "comment": "GitHub webhook signing secret - rotate monthly"
}
```

### 6. Rotate Secrets Regularly

- Configure automatic key rotation (default: 90 days)
- Manually update secret values when needed
- Document rotation procedures in comments
- Test rotation in staging before production

### 7. Use Scopes Strategically

Choose the right scope for each secret:

- **Global:** Shared infrastructure (SMTP, logging, monitoring)
- **Function:** Function-specific overrides (database replicas)
- **Group:** Environment separation (staging vs production)
- **Key:** Customer isolation (multi-tenant data)

## Complete Example

Here's a comprehensive example showing secrets usage across all scopes:

```typescript
/**
 * Multi-tenant webhook handler
 *
 * Global secrets:
 * - WEBHOOK_SIGNING_ALGORITHM = "sha256"
 * - DEFAULT_TIMEOUT_MS = "5000"
 *
 * Function secrets:
 * - ALLOWED_EVENTS = "payment,refund"
 *
 * Group secrets (per environment):
 * - NOTIFICATION_ENDPOINT = "https://staging.notifications.internal" (staging group)
 * - NOTIFICATION_ENDPOINT = "https://notifications.internal" (production group)
 *
 * Key secrets (per customer):
 * - TENANT_ID = "customer-123"
 * - WEBHOOK_SECRET = "whsec_customer123secret"
 * - NOTIFICATION_EMAIL = "alerts@customer123.com"
 */

export default async function (c, ctx) {
  // Load all required secrets in parallel
  const [
    tenantId,
    webhookSecret,
    notificationEmail,
    notificationEndpoint,
    allowedEvents,
    algorithm,
    timeout,
  ] = await Promise.all([
    ctx.getSecret("TENANT_ID"),           // Key scope
    ctx.getSecret("WEBHOOK_SECRET"),      // Key scope
    ctx.getSecret("NOTIFICATION_EMAIL"),  // Key scope
    ctx.getSecret("NOTIFICATION_ENDPOINT"), // Group scope
    ctx.getSecret("ALLOWED_EVENTS"),      // Function scope
    ctx.getSecret("WEBHOOK_SIGNING_ALGORITHM"), // Global scope
    ctx.getSecret("DEFAULT_TIMEOUT_MS"),  // Global scope
  ]);

  // Validate required secrets
  if (!tenantId || !webhookSecret) {
    console.error(`Missing tenant configuration for API key`);
    return c.json({ error: "Tenant not configured" }, 403);
  }

  // Verify webhook signature
  const signature = c.req.header("X-Webhook-Signature");
  const body = await c.req.text();
  const valid = await verifySignature(body, signature, webhookSecret, algorithm || "sha256");

  if (!valid) {
    console.warn(`Invalid webhook signature for tenant ${tenantId}`);
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse and validate payload
  const payload = JSON.parse(body);
  const events = (allowedEvents || "payment,refund").split(",");

  if (!events.includes(payload.event)) {
    console.log(`Ignoring event ${payload.event} for tenant ${tenantId}`);
    return c.json({ received: true, processed: false });
  }

  // Process webhook
  console.log(`Processing ${payload.event} for tenant ${tenantId}`);

  // Send notification with customer-specific settings
  try {
    await fetch(notificationEndpoint || "https://notifications.internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant: tenantId,
        event: payload.event,
        email: notificationEmail,
        data: payload,
      }),
      signal: AbortSignal.timeout(parseInt(timeout || "5000")),
    });
  } catch (error) {
    console.error(`Failed to send notification for ${tenantId}:`, error);
  }

  return c.json({
    received: true,
    processed: true,
    tenant: tenantId,
    event: payload.event,
  });
}

async function verifySignature(
  body: string,
  signature: string | undefined,
  secret: string,
  algorithm: string
): Promise<boolean> {
  // Implementation details...
  return true;
}
```

## Troubleshooting

### Secret Returns Undefined

**Possible causes:**

1. Secret doesn't exist in any scope
2. Secret exists but in a scope that's not accessible (e.g., trying to access key-scoped secret on a public route)
3. Decryption failed (check for `decryptionError` field)
4. Secret name is misspelled (names are case-sensitive)

**Solution:**

- Verify secret exists: `GET /api/secrets/by-name/:name`
- Check scope is appropriate for the route
- Use `ctx.getCompleteSecret()` to see all available scopes
- Check encryption keys file exists

### Decryption Failed Error

**Possible causes:**

1. Encryption keys file is missing or corrupted
2. Secret was encrypted with a different key
3. Secret data is corrupted

**Solution:**

- Verify `data/encryption-keys.json` exists
- Restore from backup if keys were lost
- Re-create the secret if data is corrupted
- Check server logs for detailed error messages

### Secret Too Large Error

**Cause:** Secret value exceeds 16 KB limit

**Solution:**

- Store large data elsewhere and use a URL/path as the secret
- Break data into multiple smaller secrets
- Use a configuration service and store credentials as secrets

## Related Topics

- [Writing Functions](/guides/writing-functions) - Learn how to access secrets in your function handlers
- [API Keys](/guides/api-keys) - Understand API key groups and how they relate to group-scoped secrets
- [API Reference](/reference/api) - Full API documentation for secrets endpoints
- [Security](/guides/security) - Learn about encryption, key rotation, and security best practices
