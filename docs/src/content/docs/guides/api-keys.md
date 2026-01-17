---
title: API Keys & Authentication
description: Managing API key groups and protecting routes
---

API keys are the primary way to control access to your functions and management APIs. This guide covers everything you need to know about creating, organizing, and using API keys in Crude Functions.

## Understanding Key Groups

API keys are organized into **groups** for access control and logical separation. Groups provide:

- **Logical organization** - Separate keys for different services (mobile app, backend, admin tools)
- **Function protection** - Functions can require specific key groups to allow execution
- **Scoped secrets** - Groups can provide secrets to all of it's API keys
- **Management API access** - Control which groups can access management endpoints

### Key Group Structure

Each group has:

| Property | Description |
|----------|-------------|
| **Name** | Unique identifier (lowercase alphanumeric with dashes/underscores) |
| **Description** | Optional human-readable description |
| **Keys** | One or more API keys belonging to the group |
| **Secrets** | Optional secrets available for all contained API keys |

Individual API keys within a group have:

| Property | Description |
|----------|-------------|
| **Name** | Unique within the group (e.g., `prod-server-1`) |
| **Value** | The actual credential (base64-encoded random string) |
| **Description** | Optional purpose description |
| **Secrets** | Each API key can define their own secrets. |

### The Three Use Cases

API key groups serve three distinct purposes:

**1. Protecting Functions**

Control which callers can execute your functions by selecting the API key group asa `Required API Key Group` when configuring a function.

![API key group selected in function configuration](../../../assets/screenshots/function-set-groups.png)

**2. Management API Access**

Control which keys can manage the platform via `/api/*` endpoints. The `API Access Groups` setting in `Security` section of settings specifies which groups can create functions, manage users, etc. By default it's the `management` API key group.

![API key group selection in Settings](../../../assets/screenshots/api-group-settings.png)

**3. Scoped Secrets**

Provide different secret values to different callers:

- Global secret `DATABASE_URL` = `postgresql://prod-db`
- Group-scoped `DATABASE_URL` for group `analytics` = `postgresql://readonly-db`

When a function is called with a key from the `analytics` group, it receives the readonly database URL. Other groups get the production URL. You can learn more about how different secret scopes interact in the [Secrets documentation page](/guides/secrets)

## The Built-in Management Group

On first startup, Crude Functions automatically creates the `management` group which is intended to be used as the API access group - it's already selected in Settings. Feel free to remove or rename said group.

**Best practice:** Only create keys in the `management` group for trusted administrators. Use separate groups for application-specific access control.

### Naming Guidelines

Group names must follow these rules:

- Lowercase letters, numbers, dashes, and underscores only
- No spaces or special characters
- Descriptive and specific (good: `backend-api`, bad: `keys1`)

**Examples:**

- `mobile-app` - Keys for mobile application
- `internal-tools` - Keys for internal tooling
- `analytics` - Keys for analytics services
- `webhooks` - Keys for webhook endpoints

### Key Properties

API keys have these characteristics:

- **Encrypted at rest** - AES-256-GCM encryption in database
- **Hash-based validation** - Constant-time comparison prevents timing attacks
- **Unique within group** - Each key name must be unique in its group

### How Function Protection Works

When a function with a required API key group is accessed:

1. Request arrives at `/run/your/function/route`
2. Router checks if route requires keys (has `keys` array)
3. Extracts API key from request
4. Validates key belongs to one of the required groups
5. If valid: executes function with `ctx.authenticatedKeyGroup` set
6. If invalid or missing: returns `401 Unauthorized`

## Using API Keys in Requests

When calling protected functions, include your API key in the request.

### X-API-Key Header (Recommended)

The standard and recommended approach:

```bash
curl http://localhost:8000/run/api/data \
  -H "X-API-Key: K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN"
```

**With POST request:**

```bash
curl -X POST http://localhost:8000/run/api/users \
  -H "X-API-Key: K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN" \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com"}'
```

### Authorization Header

API keys can also be sent via the `Authorization` header in multiple formats:

**Bearer token (common):**

```bash
curl http://localhost:8000/run/api/data \
  -H "Authorization: Bearer K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN"
```

**Plain value (no prefix):**

```bash
curl http://localhost:8000/run/api/data \
  -H "Authorization: K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN"
```

**Basic auth (key as password, empty username):**

```bash
# The -u flag formats as Basic auth
curl http://localhost:8000/run/api/data \
  -u ":K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN"
```

### Query parameter

**Note**: Key values are currently not expected to be Base64 encoded. This is a subject to change in the future.

```bash
curl http://localhost:8000/run/api/data?api_ley=K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN
```

### Key Extraction Priority

If multiple headers are present, the extraction priority is:

1. `X-API-Key` header
2. `Authorization` header (Bearer, Basic, or plain)
3. Query parameter

### Security Considerations

Be extremely careful which groups you grant management access to. Management APIs can do everything an authenticated user can do via the Web UI.

**Recommendation:**

- Keep management access limited to the `management` group only
- Only distribute `management` group keys to trusted administrators
- Use separate groups for application-specific access control

**Remember:** API keys are credentials. Treat them like passwords - keep them secret, rotate them regularly, and never commit them to version control.
