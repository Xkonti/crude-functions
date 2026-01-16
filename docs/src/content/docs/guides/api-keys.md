---
title: API Keys & Authentication
description: Managing API key groups and protecting routes
---

API keys are the primary way to control access to your functions and management APIs. This guide covers everything you need to know about creating, organizing, and using API keys in Crude Functions.

## Understanding Key Groups

API keys are organized into **groups** for access control and logical separation. Groups provide:

- **Logical organization** - Separate keys for different services (mobile app, backend, admin tools)
- **Function protection** - Routes can require specific key groups
- **Management API access** - Control which groups can access management endpoints
- **Scoped secrets** - Different groups can receive different secret values

### Key Group Structure

Each group has:

| Property | Description |
|----------|-------------|
| **Name** | Unique identifier (lowercase alphanumeric with dashes/underscores) |
| **Description** | Optional human-readable description |
| **Keys** | One or more API keys belonging to the group |

Individual API keys within a group have:

| Property | Description |
|----------|-------------|
| **Name** | Unique within the group (e.g., `prod-server-1`) |
| **Value** | The actual credential (base64-encoded random string) |
| **Description** | Optional purpose description |

### The Three Use Cases

API key groups serve three distinct purposes:

**1. Protecting Functions**

Control which callers can execute your functions:

```json
{
  "route": "/admin/users",
  "methods": ["GET", "POST"],
  "keys": [1, 2]  // Only groups 1 and 2 can access this route
}
```

**2. Management API Access**

Control which keys can manage the platform via `/api/*` endpoints. The `api.access-groups` setting (configurable in Settings) determines which groups can create functions, manage users, etc.

**3. Scoped Secrets**

Provide different secret values to different callers:

- Global secret `DATABASE_URL` = `postgresql://prod-db`
- Group-scoped `DATABASE_URL` for group `analytics` = `postgresql://readonly-db`

When a function is called with a key from the `analytics` group, it receives the readonly database URL. Other groups get the production URL.

## The Built-in Management Group

On first startup, Crude Functions automatically creates the `management` group:

- **Cannot be deleted** - This group is permanent
- **Default API access** - The `api.access-groups` setting initially contains only this group's ID
- **Administrative keys** - Keys in this group can access all management endpoints

**Best practice:** Only create keys in the `management` group for trusted administrators. Use separate groups for application-specific access control.

## Creating Key Groups

### Via Web UI

1. Navigate to `http://localhost:8000/web/keys`
2. Click "Create Group"
3. Enter:
   - **Name**: Lowercase alphanumeric with dashes/underscores (e.g., `mobile-app`, `internal_tools`)
   - **Description**: Optional (e.g., "Keys for mobile application")
4. Click "Create"

![Screenshot: Create Key Group form](../../../assets/screenshots/keys-create-group.png)

### Via API

```bash
curl -X POST http://localhost:8000/api/key-groups \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mobile-app",
    "description": "Keys for mobile application"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "mobile-app",
    "description": "Keys for mobile application"
  }
}
```

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

## Adding API Keys

### Via Web UI

1. Navigate to `http://localhost:8000/web/keys`
2. Click on the target group (e.g., `mobile-app`)
3. Click "Generate Key"
4. Enter:
   - **Name**: Unique within group (e.g., `prod-server-1`)
   - **Description**: Optional purpose description
5. Click "Generate"
6. **Copy the generated key immediately** - It won't be shown in full again

![Screenshot: Generate API Key form](../../../assets/screenshots/keys-generate.png)

The generated key will look like: `K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN`

### Via API

```bash
curl -X POST http://localhost:8000/api/keys \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": 2,
    "name": "prod-server-1",
    "description": "Production server API key"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 5,
    "groupId": 2,
    "name": "prod-server-1",
    "description": "Production server API key",
    "value": "K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN"
  }
}
```

**Important:** The `value` field is only returned once during creation. Store it securely immediately.

### Key Properties

Generated keys have these characteristics:

- **32 bytes of entropy** - Cryptographically secure random generation
- **Base64-encoded** - URL-safe format
- **Encrypted at rest** - AES-256-GCM encryption in database
- **Hash-based validation** - Constant-time comparison prevents timing attacks
- **Unique within group** - Each key name must be unique in its group

## Protecting Routes with API Keys

Function routes can optionally require API keys. Protection is configured when creating or updating a route.

### Public Routes (No Authentication)

By default, routes are public. Anyone can access them without credentials:

```json
{
  "name": "hello-world",
  "route": "/hello",
  "handler": "hello.ts",
  "methods": ["GET"],
  "keys": null
}
```

**Testing:**

```bash
curl http://localhost:8000/run/hello
# No authentication needed
```

### Protected Routes (Require API Keys)

Specify one or more group IDs in the `keys` array to require authentication:

```json
{
  "name": "user-data",
  "route": "/users/:id",
  "handler": "users/get.ts",
  "methods": ["GET"],
  "keys": [2, 3]
}
```

This route requires a valid API key from **either** group 2 **or** group 3.

### Via Web UI

1. Navigate to `http://localhost:8000/web/functions`
2. Create or edit a route
3. Under "API Key Protection":
   - Select "None" for public routes
   - Select one or more groups for protected routes
4. Click "Save"

![Screenshot: Function route protection settings](../../../assets/screenshots/functions-protect.png)

### Via API

**Create protected route:**

```bash
curl -X POST http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "protected-api",
    "route": "/api/data",
    "handler": "data.ts",
    "methods": ["GET", "POST"],
    "keys": [2]
  }'
```

**Update existing route to add protection:**

```bash
curl -X PUT http://localhost:8000/api/functions/5 \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "keys": [2, 3]
  }'
```

**Remove protection (make public):**

```bash
curl -X PUT http://localhost:8000/api/functions/5 \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "keys": null
  }'
```

### How Protection Works

When a protected route is accessed:

1. Request arrives at `/run/api/data`
2. Router checks if route requires keys (has `keys` array)
3. Extracts API key from request (see next section)
4. Validates key belongs to one of the required groups
5. If valid: executes function with `ctx.authenticatedKeyGroup` set
6. If invalid or missing: returns 401 Unauthorized

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

### Key Extraction Priority

If multiple headers are present, the extraction priority is:

1. `X-API-Key` header
2. `Authorization` header (Bearer, Basic, or plain)

### From JavaScript

**Using fetch:**

```javascript
const response = await fetch('http://localhost:8000/run/api/data', {
  headers: {
    'X-API-Key': 'K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN'
  }
});

const data = await response.json();
```

**With axios:**

```javascript
import axios from 'axios';

const response = await axios.get('http://localhost:8000/run/api/data', {
  headers: {
    'X-API-Key': 'K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN'
  }
});
```

### From Python

```python
import requests

response = requests.get(
    'http://localhost:8000/run/api/data',
    headers={'X-API-Key': 'K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN'}
)

data = response.json()
```

### Accessing Key Information in Functions

When a request is authenticated with an API key, the function receives metadata:

```typescript
export default async function (c, ctx) {
  // Check if request was authenticated
  if (ctx.authenticatedKeyGroup) {
    console.log(`Authenticated with group: ${ctx.authenticatedKeyGroup}`);

    // Access group-specific secrets
    const groupSecret = await ctx.getSecret('API_TOKEN', 'group');
  } else {
    console.log('Public request (no API key)');
  }

  return c.json({
    authenticated: !!ctx.authenticatedKeyGroup,
    group: ctx.authenticatedKeyGroup, // e.g., "mobile-app" or undefined
    requestId: ctx.requestId
  });
}
```

## Management API Access Control

Management API endpoints (`/api/*`) can be accessed via session authentication (web UI) OR API keys. Which API key groups are allowed is controlled by the `api.access-groups` setting.

### Default Configuration

On first startup, the `api.access-groups` setting is automatically created with the ID of the `management` group (typically `1`).

This means only keys from the `management` group can access management APIs by default.

### Viewing Current Access Groups

**Via Web UI:**

1. Navigate to `http://localhost:8000/web/settings`
2. Find the `api.access-groups` setting
3. Value is a comma-separated list of group IDs (e.g., `1,2,3`)

**Via API:**

```bash
curl http://localhost:8000/api/settings \
  -H "X-API-Key: your-management-key"
```

Look for the `api.access-groups` setting in the response:

```json
{
  "success": true,
  "data": {
    "api.access-groups": "1"
  }
}
```

### Adding Groups to Management Access

To allow additional groups to access management APIs:

**Via Web UI:**

1. Go to Settings page
2. Find `api.access-groups`
3. Click "Edit"
4. Update value to comma-separated group IDs (e.g., `1,2,3`)
5. Click "Save"

**Via API:**

```bash
curl -X PUT http://localhost:8000/api/settings \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "api.access-groups": "1,2,3"
    }
  }'
```

This allows groups 1, 2, and 3 to access management endpoints.

### Security Considerations

Be extremely careful which groups you grant management access to. Management APIs can:

- Create, modify, and delete functions
- Create, modify, and delete users
- Read and write secrets
- Modify routes and API keys
- Access logs and metrics
- Trigger encryption key rotation

**Recommendation:**

- Keep management access limited to the `management` group only
- Only distribute `management` group keys to trusted administrators
- Use separate groups for application-specific access control
- Audit the `api.access-groups` setting regularly

### Testing Management Access

**With authorized group:**

```bash
curl http://localhost:8000/api/functions \
  -H "X-API-Key: your-management-key"
# Returns list of functions
```

**With unauthorized group:**

```bash
curl http://localhost:8000/api/functions \
  -H "X-API-Key: key-from-mobile-app-group"
# Returns 403 Forbidden (if mobile-app group not in api.access-groups)
```

## Viewing and Managing Keys

### Listing Key Groups

**Via Web UI:**

Navigate to `http://localhost:8000/web/keys` to see all groups with their key counts.

**Via API:**

```bash
curl http://localhost:8000/api/key-groups \
  -H "X-API-Key: your-management-key"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "management",
      "description": "Platform management keys",
      "keyCount": 2
    },
    {
      "id": 2,
      "name": "mobile-app",
      "description": "Keys for mobile application",
      "keyCount": 5
    }
  ]
}
```

### Listing Keys in a Group

**Via Web UI:**

1. Navigate to `http://localhost:8000/web/keys`
2. Click on a group
3. Keys are listed with names and partial values (last 6 characters)
4. Click "Show" to reveal full key value

![Screenshot: Keys list with partial values](../../../assets/screenshots/keys-list.png)

**Via API:**

```bash
# List all keys in group 2
curl http://localhost:8000/api/keys?groupId=2 \
  -H "X-API-Key: your-management-key"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 5,
      "groupId": 2,
      "name": "prod-server-1",
      "description": "Production server API key",
      "partialValue": "...3oN"
    },
    {
      "id": 6,
      "groupId": 2,
      "name": "staging-server",
      "description": "Staging server API key",
      "partialValue": "...7mP"
    }
  ]
}
```

### Viewing Full Key Value

**Via Web UI:**

1. Navigate to the group containing the key
2. Find the key in the list
3. Click "Show" button to reveal full value
4. Copy the value

**Via API:**

Get a specific key by ID:

```bash
curl http://localhost:8000/api/keys/5 \
  -H "X-API-Key: your-management-key"
```

**Response includes full value:**

```json
{
  "success": true,
  "data": {
    "id": 5,
    "groupId": 2,
    "name": "prod-server-1",
    "description": "Production server API key",
    "value": "K5jQm8xPl3nRt7wVy2zAh6bDf9gHj4kMp1qSu0vXc8eYi3oN"
  }
}
```

### Updating Key Metadata

You can update the name and description of an existing key:

```bash
curl -X PUT http://localhost:8000/api/keys/5 \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "prod-server-1-updated",
    "description": "Updated production server key"
  }'
```

**Note:** You cannot change the key's value or group. To get a new value, create a new key.

### Deleting API Keys

**Via Web UI:**

1. Navigate to the group containing the key
2. Find the key in the list
3. Click "Delete"
4. Confirm deletion

**Via API:**

```bash
curl -X DELETE http://localhost:8000/api/keys/5 \
  -H "X-API-Key: your-management-key"
```

**Important:** Deletion is immediate and irreversible. Any applications using this key will immediately lose access.

### Deleting Key Groups

Groups can only be deleted if they contain no keys and are not the `management` group.

**Via Web UI:**

1. Navigate to `http://localhost:8000/web/keys`
2. Ensure the group has no keys (delete them first)
3. Click "Delete Group"
4. Confirm deletion

**Via API:**

```bash
curl -X DELETE http://localhost:8000/api/key-groups/2 \
  -H "X-API-Key: your-management-key"
```

**Errors:**

- `400` - Group still contains keys
- `403` - Cannot delete `management` group
- `404` - Group not found

## Key Rotation Best Practices

There is no "regenerate" function for API keys. To rotate a key, follow this process:

### Rotation Process

1. **Generate a new key** with a different name:

```bash
curl -X POST http://localhost:8000/api/keys \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": 2,
    "name": "prod-server-2",
    "description": "Production server API key (new)"
  }'
```

2. **Update your applications** to use the new key:

```bash
# Update environment variable
export API_KEY="new-key-value"

# Restart application
systemctl restart myapp
```

3. **Verify the new key works**:

```bash
curl http://localhost:8000/run/api/data \
  -H "X-API-Key: new-key-value"
# Should return expected response
```

4. **Monitor for errors** - Check logs to ensure no applications are still using the old key

5. **Delete the old key**:

```bash
curl -X DELETE http://localhost:8000/api/keys/5 \
  -H "X-API-Key: your-management-key"
```

### Rotation Schedule

**Recommended intervals:**

- **Production keys**: Every 90 days
- **Development keys**: Every 180 days
- **Compromised keys**: Immediately

**After compromise:**

If a key is compromised:

1. Generate a new key immediately
2. Update all applications
3. Delete the compromised key
4. Review logs for unauthorized access
5. Rotate any secrets the key could access

### Naming Convention for Rotation

Use version suffixes to track rotations:

- `prod-server-1` (original)
- `prod-server-2` (first rotation)
- `prod-server-3` (second rotation)

Or use dates:

- `prod-server-2026-01`
- `prod-server-2026-04`
- `prod-server-2026-07`

### Automation

Automate key rotation with a script:

```bash
#!/bin/bash
# rotate-key.sh

GROUP_ID=2
OLD_KEY_ID=5
NEW_KEY_NAME="prod-server-$(date +%Y-%m)"
MGMT_KEY="your-management-key"

# Generate new key
RESPONSE=$(curl -s -X POST http://localhost:8000/api/keys \
  -H "X-API-Key: $MGMT_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"groupId\":$GROUP_ID,\"name\":\"$NEW_KEY_NAME\"}")

NEW_KEY=$(echo $RESPONSE | jq -r '.data.value')

echo "New key: $NEW_KEY"
echo "Update your applications with this key, then delete the old one:"
echo "curl -X DELETE http://localhost:8000/api/keys/$OLD_KEY_ID -H 'X-API-Key: $MGMT_KEY'"
```

### Monitoring Key Usage

Check execution logs to identify which keys are being used:

```bash
curl http://localhost:8000/api/logs?limit=100 \
  -H "X-API-Key: your-management-key"
```

Look for `authenticatedKeyGroup` in log entries to track which groups are actively calling functions.

## Security Best Practices

### Key Management

1. **Use descriptive names** - Name keys by their purpose and location (e.g., `aws-lambda-prod`, `mobile-ios-prod`)
2. **Document key usage** - Use descriptions to track where each key is deployed
3. **Limit key distribution** - Only create keys when necessary
4. **One key per service** - Don't share keys across multiple applications
5. **Rotate regularly** - Establish a rotation schedule (90 days for production)

### Group Organization

1. **Separate by trust level** - Create different groups for admin, internal, and external access
2. **Scope groups narrowly** - Create specific groups for specific purposes
3. **Limit management access** - Keep the `api.access-groups` setting minimal
4. **Review group membership** - Audit which groups can access which routes

### Storage and Distribution

1. **Never commit keys to version control** - Use `.gitignore` for key files
2. **Use environment variables** - Store keys in environment variables or secret managers
3. **Encrypt at rest** - If storing keys in files, encrypt them
4. **Use secret managers** - Consider AWS Secrets Manager, HashiCorp Vault, etc.
5. **Limit access** - Only authorized personnel should see key values

### Route Protection

1. **Default to protected** - Only make routes public if they truly need to be
2. **Use specific groups** - Don't grant overly broad access
3. **Review regularly** - Audit which routes are public vs protected
4. **Test access control** - Verify protection works before deploying

### Monitoring and Auditing

1. **Review logs** - Check execution logs regularly for unauthorized access attempts
2. **Track key usage** - Monitor which keys are actively being used
3. **Alert on failures** - Set up alerts for repeated authentication failures
4. **Audit group changes** - Review changes to `api.access-groups` setting
5. **Document key lifecycle** - Keep records of when keys were created, rotated, and deleted

### Network Security

1. **Use HTTPS** - Always deploy behind HTTPS in production
2. **Restrict access** - Use firewall rules to limit which IPs can reach your server
3. **Rate limiting** - Implement rate limiting at the reverse proxy level
4. **VPN/Private network** - Consider deploying on a private network

## Troubleshooting

### "Unauthorized" when using API key

**Symptoms:** 401 error when calling a protected function

**Causes and solutions:**

1. **Key is incorrect**
   - Check for extra whitespace or typos
   - Verify you copied the complete key value
   - Try generating a new key and testing with it

2. **Key group doesn't match route requirements**
   - Check which groups the route requires (`keys` field)
   - Verify your key belongs to one of those groups
   - Use the web UI to see which group your key belongs to

3. **Header format is incorrect**
   - Use `X-API-Key: value` (no quotes around value)
   - If using Authorization, ensure proper format: `Bearer value`
   - Check for header name typos (`X-API-Key`, not `X-Api-Key`)

4. **Key was deleted**
   - Verify the key still exists in the web UI
   - Check if it was rotated and old key deleted

### "Forbidden" when accessing management API

**Symptoms:** 403 error when calling `/api/*` endpoints

**Cause:** Your key's group is not in the `api.access-groups` setting

**Solution:**

1. Check current allowed groups:
```bash
curl http://localhost:8000/api/settings -H "X-API-Key: your-key"
```

2. Verify your key's group ID:
```bash
curl http://localhost:8000/api/keys -H "X-API-Key: your-key"
```

3. Add your group to allowed groups (requires existing management key):
```bash
curl -X PUT http://localhost:8000/api/settings \
  -H "X-API-Key: management-key" \
  -d '{"settings":{"api.access-groups":"1,2"}}'
```

### Cannot delete key group

**Error:** "Group still contains keys"

**Solution:** Delete all keys in the group first:

1. List keys in group:
```bash
curl http://localhost:8000/api/keys?groupId=2 \
  -H "X-API-Key: your-management-key"
```

2. Delete each key:
```bash
curl -X DELETE http://localhost:8000/api/keys/5 \
  -H "X-API-Key: your-management-key"
```

3. Now delete the group:
```bash
curl -X DELETE http://localhost:8000/api/key-groups/2 \
  -H "X-API-Key: your-management-key"
```

### Key not showing in web UI

**Cause:** Browser cache or session issue

**Solutions:**

1. Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
2. Clear browser cache
3. Log out and log back in
4. Try a different browser or incognito mode

### Lost all management keys

**Symptoms:** Cannot access management API, no valid keys

**Recovery:**

If you've lost all keys in the `management` group:

1. Stop the application
2. Access the database directly:
```bash
sqlite3 ./data/database.db
```

3. Create a temporary admin user via Better Auth
4. Log in to web UI with that user (session auth doesn't require API keys)
5. Generate a new management key via web UI
6. Delete temporary user if needed

## Related Documentation

- [Writing Functions](/guides/writing-functions) - How to access authenticated key groups in your handlers
- [Secrets Management](/guides/secrets) - Using group-scoped and key-scoped secrets
- [API Reference](/reference/api) - Complete API endpoint documentation
- [Authentication & Security](/guides/authentication) - Comprehensive security guide

---

**Remember:** API keys are credentials. Treat them like passwords - keep them secret, rotate them regularly, and never commit them to version control.
