---
title: Secrets Management
description: Secrets and their scopes
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

1. **Key scope** - Tied to a specific API key used to authenticate the request
2. **Group scope** - Tied to an API key group used to authenticate the request
3. **Function scope** - Tied to a specific function
4. **Global scope** - Available to all functions

### Global Secrets

Global secrets are managed from a dedicated secrets page available via 🔒 in navigation panel.

Global secrets are intended for values that are commonly used by multiple functions and are not specifically related to any API key groups. In most Crude Function deployments global secrets are all that one actually needs when it comes to secrets management.

Examples of global secrets:

- `SupportEmail` with value of `support@xkonti.tech` - A support email shared between all deployed functions. Makes it easy to change it in the future
- `N8N-URL` and `N8N-API-KEY` - URL and API keys to the N8N deployment, so that all functions can easily reach it
- `email-processing-debug-level` - intended debug level for all email processing functions - easy to change in one place

### Function Secrets

Function secrets can be specified by going to the Function Management Page ⚡ and clicking the 🔐 button on the function. Each function can have any number of secrets.

Function secrets are mostly intended to provide necessary secrets into the function. There are multiple reasons for this:

- Prevents littering the global secrets list with large numbers or secrets and playing with the secret naming gymnastics
- Other functions don't risk accessing other's secrets - lessens the risk of typos and other oopsies causing damage
- Let's a function to override a global secret value just within it's own scope

Examples of function secrets:

- `DB_CONNECTION_STRING` - Function-scoped database connection string. Each function can easily have it's own without risk of naming collisions.
- `email-processing-debug-level` - a specific function can override the global value to speed up debugging process

### API Key Group and API Key Secrets

Both API Key Group Secrets and API Key Secrets are managed from the API Key Management Page 🔑. Each group and each key has a 🔐 button which opens it's secrets management page. Each API Key Group and API Key can have any number of secrets.

API Key Group and API Key secrets are less used types. They are intended to provide different values of secrets into the function depending on who/what is calling it.

Let's say that we have a function for sending notification emails. This function requires API keys belonging to either `shipping` or `manufacturing` groups. The function can then use the `recipient-email` secret to decide where to send the email. The `shipping` group can specify it as `shipping-updates@example.com`, while `manufacturing` group can set it to `manufacturing-updates@example.com`. Furthermore each group can have a specific API key for various services from within shipping or manufacturing services. Each of those keys can then define their own value for `service-name` - the function can then easily adjust the subject of an email to include the service name.

Another scenario that showcases usage of API Key secrets involves making debugging of production deployments a bit easier. Let's say we have a function called by multiple services and fully in-production. We want to have an option of bypassing some security checks to be able to provide support to our customers. Exposing this functionality via the API would quickly increase complexity and potentially introduce security vulnerabilities. Instead, we can make the function look for a specific `BYPASS_CHECKS` secret with a specific value. By default this secret is not defined - the value is `undefined`. What this allows us to do is to create a specific API key which defines this secret. This way we can call the function using that key and don't have to expose any of the testing functionality to the API definition itself.

## Hierarchical Resolution

When you call `ctx.getSecret("SECRET_NAME")` without specifying a scope, Crude Functions uses this resolution order:

```
Key > Group > Function > Global
```

The most specific scope wins. This allows you to:

- Set default values at the global level
- Override for specific functions
- Override for specific API key groups
- Override for individual API keys

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
  ...
```

The value of `details` has the following format:

```js
{
  global: "postgresql://shared-db:5432/main",
  function: "postgresql://analytics-db:5432/analytics",
  group: {
    value: "postgresql://readonly-db:5432/main",
    groupId: 5,
    groupName: "readonly-users"
  },
  key: {
    value: "postgresql://customer-db:5432/client_123",
    groupId: 5,
    groupName: "readonly-users",
    keyId: 10,
    keyName: "client-123-key"
  }
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
