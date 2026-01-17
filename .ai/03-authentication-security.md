# Authentication & Security

This guide covers how to secure your Crude Functions deployment, manage users and API keys, and understand the security model.

## Table of Contents

- [Authentication Models](#authentication-models)
- [Initial Setup & User Management](#initial-setup--user-management)
- [API Key Groups](#api-key-groups)
- [Generating & Managing API Keys](#generating--managing-api-keys)
- [Protecting Function Routes](#protecting-function-routes)
- [Using API Keys in Requests](#using-api-keys-in-requests)
- [Managing API Access to Management Endpoints](#managing-api-access-to-management-endpoints)
- [Roles & Permissions](#roles--permissions)
- [Security Best Practices](#security-best-practices)
- [Encryption Key Backup](#encryption-key-backup)
- [Understanding the Security Model](#understanding-the-security-model)

---

## Authentication Models

Crude Functions uses two authentication methods depending on the context:

### Web UI - Session Authentication

The web UI (`/web/*` routes) uses **Better Auth** with session cookies. Users log in with email and password, and the session is maintained via secure HTTP-only cookies.

- Session-based authentication only
- API keys are **NOT** accepted for web UI access
- Sessions include CSRF protection
- Automatic redirect to login when unauthenticated

### Management API - Hybrid Authentication

Management API endpoints (`/api/*` routes) accept **EITHER** session authentication OR API keys:

- **Session auth**: When accessing from the web UI (authenticated user)
- **API key auth**: When accessing programmatically via the `X-API-Key` header
- Both methods provide equivalent access to management operations

### Function Execution - Optional API Keys

User-deployed functions (`/run/*` routes) can optionally require API keys:

- Routes can be **public** (no authentication required)
- Routes can be **protected** (require specific API key groups)
- API key validation happens before function execution
- Multiple key groups can be required per route

---

## Initial Setup & User Management

### First User Creation

On first startup, the sign-up form is enabled. The first user created automatically becomes a **permanent admin**:

1. Navigate to `/web/signup`
2. Create your admin account (email + password)
3. After creating the first user, sign-up is **automatically disabled**

The first user receives the `permanent` role, which:
- Cannot be deleted
- Cannot have the `permanent` role removed
- Has full access to all management features

### Adding Additional Users

After the first user is created, sign-up is disabled. To add more users:

1. Log in as an admin user
2. Navigate to `/web/users` (User Management page)
3. Click "Add New User"
4. Provide:
   - **Email**: User's email address
   - **Password**: At least 8 characters
   - **Name**: Optional display name
   - **Role**: Comma-separated roles (e.g., `userMgmt,permanent`)

### User Roles

Roles are stored as comma-separated strings. Common roles:

- `permanent`: Cannot be deleted, permanent admin privileges
- `userMgmt`: Can manage other users (create, update, delete)

Example multi-role assignment: `permanent,userMgmt`

### Changing Passwords

Users can change their own password through the web UI. Admins with `userMgmt` role can change any user's password:

1. Go to `/web/users`
2. Find the user
3. Click "Edit"
4. Update password (minimum 8 characters)

### Deleting Users

Users with `userMgmt` role can delete users, **except**:
- Users with the `permanent` role cannot be deleted

To delete a user:
1. Go to `/web/users`
2. Find the user
3. Click "Delete"
4. Confirm deletion

---

## API Key Groups

API keys are organized into **groups**. Groups provide logical separation and allow routes to require specific key groups.

### Creating Key Groups

Via Web UI:
1. Navigate to `/web/keys`
2. Click "Create Group"
3. Provide:
   - **Name**: Lowercase alphanumeric with dashes/underscores (e.g., `mobile-app`, `internal_tools`)
   - **Description**: Optional description

Via Management API:
```bash
curl -X POST http://localhost:8000/api/keys/groups \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mobile-app",
    "description": "Keys for mobile application"
  }'
```

### Built-in Groups

One group is created automatically:

- **`management`**: Default group for managing the platform via API

### Viewing Key Groups

Via Web UI:
- Navigate to `/web/keys`
- All groups are listed with their key counts

Via Management API:
```bash
curl http://localhost:8000/api/keys/groups \
  -H "X-API-Key: your-management-key"
```

### Deleting Key Groups

Deleting a group cascades and deletes all keys in that group:

1. Navigate to `/web/keys`
2. Find the group
3. Click "Delete Group"
4. Confirm deletion (warns if keys exist)

---

## Generating & Managing API Keys

### Creating API Keys

Via Web UI:
1. Navigate to `/web/keys`
2. Select the target group
3. Click "Generate Key"
4. Provide:
   - **Name**: Unique within group (e.g., `prod-server-1`)
   - **Description**: Optional purpose description
5. **Copy the generated key immediately** - it won't be shown again in full

Via Management API:
```bash
curl -X POST http://localhost:8000/api/keys \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": 1,
    "name": "prod-server-1",
    "description": "Production server API key"
  }'
```

### Key Properties

- **Encrypted at rest**: Keys are encrypted in the database using AES-256-GCM
- **Hash-based lookup**: Keys are validated using constant-time hash comparison (prevents timing attacks)
- **Unique within group**: Each key name must be unique within its group
- **Format**: Base64-encoded random strings (32 bytes of entropy)

### Viewing API Keys

Via Web UI:
1. Navigate to `/web/keys`
2. Select a group
3. Keys are listed with names and partial values (last 6 characters)
4. Click "Show" to reveal full key value

Via Management API:
```bash
# List all keys in a group
curl http://localhost:8000/api/keys?groupId=1 \
  -H "X-API-Key: your-management-key"
```

### Rotating API Keys

To rotate a key:
1. Generate a new key with a different name
2. Update your applications to use the new key
3. Verify the new key works
4. Delete the old key

**Important**: There is no "regenerate" function - always create a new key, test it, then delete the old one.

### Deleting API Keys

Via Web UI:
1. Navigate to `/web/keys`
2. Select the group
3. Find the key
4. Click "Delete"
5. Confirm deletion

Via Management API:
```bash
curl -X DELETE http://localhost:8000/api/keys/123 \
  -H "X-API-Key: your-management-key"
```

---

## Protecting Function Routes

Function routes can optionally require API keys. Protection is configured when creating or updating a route.

### Public Routes (No Authentication)

By default, routes are public. No API key validation occurs:

```json
{
  "name": "public-hello",
  "route": "/hello",
  "handler": "code/hello.ts",
  "methods": ["GET"],
  "keys": null
}
```

### Protected Routes (Require API Keys)

To require API keys, specify one or more group IDs in the `keys` array:

```json
{
  "name": "protected-data",
  "route": "/data",
  "handler": "code/data.ts",
  "methods": ["GET", "POST"],
  "keys": [2, 3]
}
```

This route requires a valid API key from either:
- Group ID 2, OR
- Group ID 3

### Configuring Protection via Web UI

1. Navigate to `/web/functions`
2. Create or edit a route
3. Under "API Key Protection":
   - Select "None" for public routes
   - Select one or more groups for protected routes

### Configuring Protection via Management API

```bash
curl -X POST http://localhost:8000/api/functions/routes \
  -H "X-API-Key: your-management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "protected-api",
    "route": "/api/data",
    "handler": "code/data.ts",
    "methods": ["GET"],
    "keys": [2]
  }'
```

### How Protection Works

When a protected route is accessed:

1. Request arrives at `/run/api/data`
2. Router checks if route requires keys (has `keys` array)
3. Extracts API key from request headers (see next section)
4. Validates key belongs to one of the required groups
5. If valid: executes function with `ctx.authenticatedKeyGroup` set
6. If invalid: returns 401 Unauthorized

---

## Using API Keys in Requests

### X-API-Key Header (Recommended)

The standard way to send API keys:

```bash
curl http://localhost:8000/run/api/data \
  -H "X-API-Key: your-api-key-here"
```

### Authorization Header

API keys can also be sent via the `Authorization` header in multiple formats:

**Bearer token** (most common):
```bash
curl http://localhost:8000/run/api/data \
  -H "Authorization: Bearer your-api-key-here"
```

**Plain value** (no prefix):
```bash
curl http://localhost:8000/run/api/data \
  -H "Authorization: your-api-key-here"
```

**Basic auth** (key as password, empty username):
```bash
# Format: ":your-api-key-here" encoded as base64
curl http://localhost:8000/run/api/data \
  -u ":your-api-key-here"
```

### Key Extraction Priority

If multiple headers are present, the priority is:
1. `X-API-Key` header
2. `Authorization` header (Bearer, Basic, or plain)

### Accessing Key Information in Functions

When a request is authenticated with an API key, the function receives metadata:

```typescript
export default async function(c, ctx) {
  // Check if request was authenticated
  if (ctx.authenticatedKeyGroup) {
    console.log(`Authenticated with group: ${ctx.authenticatedKeyGroup}`);
  }

  // Access secrets scoped to this key
  const secret = await ctx.getSecret('api-token', 'key');

  return c.json({
    authenticated: !!ctx.authenticatedKeyGroup,
    group: ctx.authenticatedKeyGroup
  });
}
```

---

## Managing API Access to Management Endpoints

Management API endpoints (`/api/*`) can be accessed via session auth OR API keys. Which API key groups are allowed is controlled by the `api.access-groups` setting.

### Default Configuration

On first startup, the `api.access-groups` setting is automatically created with:
- Value: ID of the `management` group (typically `1`)

This means only keys from the `management` group can access management APIs.

### Viewing Current Access Groups

Via Web UI:
1. Navigate to `/web/settings` (if a settings page exists)
2. Look for `api.access-groups`

Via Database:
```sql
SELECT * FROM settings WHERE name = 'api.access-groups';
```

The value is a comma-separated list of group IDs: `1,2,3`

### Adding Groups to Management Access

To allow additional groups to access management APIs:

1. Find the group IDs you want to allow
2. Update the `api.access-groups` setting via database:

```sql
UPDATE settings
SET value = '1,2,3'
WHERE name = 'api.access-groups';
```

This allows groups 1, 2, and 3 to access management endpoints.

### Security Considerations

Be careful which groups you grant management access to:
- Management APIs can create/delete functions
- Management APIs can create/delete users
- Management APIs can read/write secrets
- Management APIs can modify routes and keys

**Recommendation**: Keep management access limited to a dedicated `management` group, and only distribute those keys to trusted administrators.

---

## Roles & Permissions

### User Roles

Roles are stored as comma-separated strings in the `user.role` field:

- **`permanent`**:
  - Cannot be deleted
  - Cannot have this role removed
  - Intended for the first admin user

- **`userMgmt`**:
  - Can create, update, and delete other users
  - Can assign roles to users
  - Cannot delete `permanent` users

### Assigning Roles

When creating a user:
```json
{
  "email": "admin@example.com",
  "password": "securepassword",
  "role": "permanent,userMgmt"
}
```

When updating a user:
```json
{
  "role": "userMgmt"
}
```

### Role Checking

Roles are primarily enforced in the web UI. The API relies on session authentication or API key validation rather than granular role-based access control.

---

## Security Best Practices

### User Accounts

1. **Strong passwords**: Minimum 8 characters, use complex passwords
2. **Limit admin users**: Only grant `userMgmt` role to trusted personnel
3. **One permanent admin**: Only the first user should have the `permanent` role
4. **Regular audits**: Review user list regularly, remove inactive accounts

### API Keys

1. **Use descriptive names**: Name keys by their purpose (`prod-server-1`, `staging-app`)
2. **Scope keys appropriately**: Create separate groups for different services
3. **Rotate regularly**: Establish a key rotation schedule (every 90 days)
4. **Limit management keys**: Only create `management` group keys for admins
5. **Never commit keys**: Don't store keys in version control
6. **Use environment variables**: Store keys in environment variables or secret managers
7. **Monitor key usage**: Review execution logs to detect unusual API key activity

### Function Routes

1. **Default to protected**: Only make routes public if they truly need to be
2. **Use specific groups**: Don't grant overly broad key group access
3. **Validate input**: Even with API keys, always validate function inputs
4. **Rate limiting**: Consider implementing rate limiting in your functions
5. **Audit route configuration**: Regularly review which routes are public vs protected

### Network Security

1. **Use HTTPS**: Always deploy behind HTTPS in production
2. **Reverse proxy**: Deploy behind nginx, Caddy, or similar
3. **Firewall**: Limit access to your server's ports
4. **VPN/Private network**: Consider deploying on a private network

### Database Security

1. **File permissions**: Ensure `./data/database.db` has restricted permissions
2. **Backup regularly**: Backup database and encryption keys separately
3. **Separate storage**: Store backups on different media/locations

---

## Encryption Key Backup

### Critical: Back Up Your Keys

API keys, secrets, and other sensitive data are encrypted at rest using encryption keys stored in:

```
./data/encryption-keys.json
```

**If you lose this file, you lose access to all encrypted data permanently.**

### What's Stored in the Key File

- `current_key`: Current encryption key (AES-256)
- `current_version`: Key version (A-Z)
- `phased_out_key`: Previous key during rotation (temporary)
- `better_auth_secret`: Better Auth session secret
- `hash_key`: API key hashing key
- `last_rotation_finished_at`: Timestamp of last rotation

### Backup Strategy

**Automated backups**:
```bash
# Create backup script
#!/bin/bash
BACKUP_DIR="/secure/backups"
DATE=$(date +%Y%m%d_%H%M%S)
cp ./data/encryption-keys.json "$BACKUP_DIR/encryption-keys-$DATE.json"
chmod 600 "$BACKUP_DIR/encryption-keys-$DATE.json"
```

**Manual backups**:
1. Stop the application
2. Copy `./data/encryption-keys.json` to secure storage
3. Store backup separately from database backups
4. Keep multiple versions (weekly rotation)
5. Restart application

**Backup locations** (store in at least 2 of these):
- Encrypted external drive
- Secure cloud storage (encrypted)
- Password manager (encrypted)
- Hardware security module (HSM)
- Offline secure location

### Key Rotation

The system automatically rotates encryption keys based on the `encryption.key-rotation.interval-days` setting (default: 90 days).

During rotation:
- A new key is generated
- All encrypted data is re-encrypted with the new key
- The old key is kept temporarily for decryption fallback
- After successful rotation, the old key is removed

**Backup during rotation**: Always create a backup before and after rotation completes.

### Disaster Recovery

If you lose `encryption-keys.json`:
1. Restore from your most recent backup
2. Restart the application
3. If data was encrypted with a newer key, you'll need that specific backup
4. If no backup exists, encrypted data is permanently lost

**You cannot decrypt data without the correct key file.**

---

## Understanding the Security Model

### Philosophy: Internal Tooling

Crude Functions is designed as **internal tooling**, not a public SaaS platform:

- **No sandboxing**: Functions run in the same process as the server
- **No resource limits**: Functions can consume arbitrary CPU/memory
- **No network isolation**: Functions have full network access
- **Trust-based**: Users can "shoot themselves in the foot" - this is intentional

### What This Means

**You are responsible for**:
- Limiting who can deploy functions
- Reviewing function code before deployment
- Securing the server environment
- Network-level access controls

**Crude Functions handles**:
- Authentication and API key validation
- Encryption of sensitive data at rest
- Session management and CSRF protection
- SQL injection prevention in system queries

### Threat Model

**Protected against**:
- Unauthorized access to management APIs (via API keys/sessions)
- SQL injection in platform code
- Timing attacks on API key validation
- Session hijacking (via HTTP-only cookies)
- Unauthorized function execution (if routes are protected)

**NOT protected against**:
- Malicious function code (functions have full system access)
- Resource exhaustion by functions
- Network attacks from functions
- Insider threats (authorized users can deploy anything)

### When to Use Crude Functions

**Good use cases**:
- Internal dashboards and tools
- Backend APIs for internal applications
- Automation scripts and webhooks
- Small team/personal projects
- Development and staging environments

**Not recommended for**:
- Public-facing APIs with untrusted users
- Multi-tenant SaaS platforms
- Environments requiring strong isolation
- Compliance-heavy industries (unless properly hardened)

### Hardening for Production

If deploying to production:

1. **Network isolation**: Deploy on a private network or VPN
2. **Reverse proxy**: Use nginx/Caddy with rate limiting and WAF
3. **OS-level security**: Use AppArmor/SELinux profiles
4. **Container isolation**: Deploy in a dedicated container/VM
5. **Monitoring**: Set up logging and alerting for suspicious activity
6. **Regular updates**: Keep Deno and dependencies up to date
7. **Backup & DR**: Implement robust backup and disaster recovery

---

## Quick Reference

### Common Operations

**Create API key**:
```bash
curl -X POST http://localhost:8000/api/keys \
  -H "X-API-Key: management-key" \
  -H "Content-Type: application/json" \
  -d '{"groupId": 1, "name": "my-key"}'
```

**Use API key**:
```bash
curl http://localhost:8000/run/my-function \
  -H "X-API-Key: your-key"
```

**Create protected route**:
```bash
curl -X POST http://localhost:8000/api/functions/routes \
  -H "X-API-Key: management-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "secure-api",
    "route": "/secure",
    "handler": "code/secure.ts",
    "methods": ["GET"],
    "keys": [2]
  }'
```

**Backup encryption keys**:
```bash
cp ./data/encryption-keys.json /secure/backup/encryption-keys-$(date +%Y%m%d).json
```

### File Locations

- **Database**: `./data/database.db`
- **Encryption keys**: `./data/encryption-keys.json`
- **User functions**: `./code/`
- **Logs**: Console output (configure system logger for persistence)

### Default Settings

- First user gets `permanent` role
- `management` group created automatically
- `api.access-groups` defaults to `management` group ID
- Session expiration: Configured by Better Auth (default ~7 days)
- Key rotation interval: 90 days

---

## Troubleshooting

### "Unauthorized" when using API key

1. Verify the key is correct (check for extra whitespace)
2. Verify the key belongs to a required group
3. Check route configuration (`keys` field)
4. Review API key group membership

### Can't create first user

1. Check database permissions (`./data/` directory must be writable)
2. Verify `encryption-keys.json` was created
3. Check logs for Better Auth errors

### Lost encryption keys file

1. Restore from backup immediately
2. If no backup exists, all encrypted data is lost
3. You'll need to regenerate all API keys and secrets

### Key rotation failed

1. Check disk space (rotation creates temporary encrypted copies)
2. Review logs for specific error
3. Restore from backup if data is corrupted
4. Rotation will retry on next check interval

---

## Related Documentation

- **Function Development**: Writing and deploying functions
- **Secrets Management**: Hierarchical secret storage and resolution
- **API Reference**: Complete API endpoint documentation

---

**Security is a shared responsibility. While Crude Functions provides the tools, securing your deployment requires careful configuration and operational practices.**
