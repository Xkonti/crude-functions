---
title: First-Time Setup
description: Initial configuration and admin user creation
---

After deploying Crude Functions for the first time, you'll need to create an admin user and configure initial settings. This guide walks through the essential first-time setup steps.

## What Happens on First Run

On first startup, Crude Functions automatically:

1. Creates SQLite database at `./data/database.db`
2. Generates encryption keys at `./data/encryption-keys.json`
3. Runs database migrations
4. Enables the sign-up page for admin user creation

The server is now ready for you to create your admin account.

## Creating Your Admin User

### Access the Web UI

Navigate to the web interface:

```
http://localhost:8000/web
```

If deploying remotely, replace `localhost:8000` with your server's address.

![Web UI login page](../../../assets/screenshots/first-login.png)

### Complete the Sign-Up Form

1. Enter your email address
2. Create a strong password (minimum 8 characters)
3. Click "Create Account"

**Important:** After this first user is created, you cannot use the sign-up page again. Additional users must be added through the *Users* page in the web UI.

## Initial Settings Overview

After logging in, visit the Settings page to review default configuration:

Navigate to: `http://localhost:8000/web/settings`

![Settings overview](../../../assets/screenshots/settings-page.png)

### Key Settings to Review

**Logging:**

- `log.level` - Default: `info` (options: debug, info, warn, error)
- `log.capture-enabled` - Default: `true` (captures console.* calls from functions)
- `log.retention-entries` - Default: `1000` entries per function

**Metrics:**

- `metrics.capture-enabled` - Default: `true` (tracks execution time and counts)
- `metrics.retention-days` - Default: `90` days

**Encryption:**

- `encryption.key-rotation.interval-days` - Default: `90` days
- Automatic key rotation for API keys and secrets

**API Access:**

- `api.access-groups` - Default: `1` (the management group ID)
- Controls which API key groups can access `/api/*` endpoints

Most defaults work well for initial use. You can adjust these later as needed.

## Creating Management API Keys

To use the management API programmatically, you'll need an API key.

### Navigate to API Keys Page

Go to: `http://localhost:8000/web/keys`

![API keys page](../../../assets/screenshots/api-keys-page.png)

### Find the Management Group

The `management` group is created automatically on first startup. This is the default group for platform administration.

1. Click on the `management` group
2. Click "Add Key" or "Generate Key"
3. Provide a name (e.g., `ci-deploy`, `admin-cli`)
4. Optional: Add a description
5. Click "Create"

![Creating an API key](../../../assets/screenshots/create-api-key.png)

### Copy Your API Key

**Important:** The full API key is shown only once. Copy it immediately.

The web UI will show partial keys (last 6 characters) after creation for security.

![API key created](../../../assets/screenshots/api-key-created.png)

### Test Your API Key

Verify the key works:

```bash
curl -H "X-API-Key: your-key-here" \
  http://localhost:8000/api/functions
```

You should receive a JSON response listing functions (empty array if none exist yet).

## Adding Additional Users

Since sign-up is disabled after the first user, add new users through the Users page.

### Navigate to Users Page

Go to: `http://localhost:8000/web/users`

![Users management page](../../../assets/screenshots/users-page.png)

### Create a New User

1. Click "Add New User"
2. Enter email address
3. Set password (minimum 8 characters)
4. Optional: Add display name
5. Optional: Assign roles (comma-separated)
6. Click "Create"

![Adding a new user](../../../assets/screenshots/add-user.png)

### User Roles

Roles are comma-separated strings:

- `permanent` - Cannot be deleted, permanent admin (only for first user)
- `userMgmt` - Can manage other users (create, update, delete)

Example multi-role: `userMgmt,permanent`

**Best practice:** Only assign `userMgmt` to trusted administrators. Regular users don't need any roles.

## Understanding the Data Directory

Everything persistent lives in `./data/`:

```
data/
├── database.db           # Routes, functions, API keys, users, secrets, logs, metrics
└── encryption-keys.json  # AES-256-GCM keys for encrypting API keys and secrets
```

### Critical: Back Up Your Encryption Keys

**If you lose `encryption-keys.json`, you lose access to all encrypted data permanently.**

Create a backup immediately after first setup:

```bash
# Stop the container
docker compose down

# Backup both files
tar -czf crude-functions-backup-$(date +%Y%m%d).tar.gz data/

# Restart
docker compose up -d
```

Store the backup in a secure location separate from your server.

## Next Steps

Now that initial setup is complete:

1. **Create your first function** - See [Writing Functions](/guides/writing-functions)
2. **Explore the web UI** - Familiarize yourself with all pages
3. **Set up backups** - Automate backups of the `data/` directory
4. **Review security** - See [Authentication & Security](/guides/authentication)
5. **Deploy behind a reverse proxy** - Add TLS termination for production

## Troubleshooting

### Can't Access Web UI

- Verify the container is running: `docker compose ps`
- Check logs: `docker compose logs`
- Ensure port 8000 is not blocked by firewall
- Try accessing from the server: `curl http://localhost:8000/web`

### Can't Create First User

- Check database permissions: `./data/` directory must be writable
- Verify `encryption-keys.json` was created
- Review logs for Better Auth errors: `docker compose logs`
- Check disk space

### Sign-Up Page Still Shows After Creating User

- Verify the user was actually created (check Users page after logging in)
- Check database: The sign-up page disables automatically when users exist
- Review logs for database write errors

### Lost Encryption Keys File

- Restore from backup immediately
- If no backup exists, all encrypted data (API keys, secrets) is permanently lost
- You'll need to regenerate all API keys and secrets from scratch
