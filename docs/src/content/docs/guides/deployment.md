---
title: Deployment
description: How to deploy Crude Functions
---

Two image variants are available:

- `standard` - Full Debian base with shell. Use this if you need to exec into the container or execute shell commands from within your functions.
- `hardened` - Uses [Docker Hardened Image](https://dhi.io) - Near-zero CVEs, no shell or package manager, runs as non-root. Use this for production.

**Hardened image limitations for function handlers:**

- Shell commands (`Deno.Command()`, subprocess spawning) will fail
- NPM packages with native bindings or lifecycle scripts won't work
- Direct FFI access to system libraries (libc, libm, etc.) mostly unavailable
- Some packages might not work if they rely on some system libraries or shell commands

To switch variants, change the image tag:

```yaml
xkonti/crude-functions:latest           # Standard
xkonti/crude-functions:latest-hardened  # Hardened (recommended)
```

These images follow the semantic version conventions and one can specify more specific versions of the image, for example:

- `:0.4.3`/`:0.4.3-hardened`
- `:0.4`/`:0.4-hardened`
- `:0`/`:0-hardened`

## Prerequisites

To be able to deploy Crude Functions all you need is Docker and optionally Docker Compose.

### Using Docker Run

```bash
mkdir -p data code
docker run -d \
  -p 8000:8000 \
  -p 9000:9000 \
  -v ./data:/app/data \
  -v ./code:/app/code \
  --name crude-functions \
  xkonti/crude-functions:latest-hardened
```

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    ports:
      - 8000:8000  # Function execution (/run/*)
      - 9000:9000  # Management (API, Web UI)
    volumes:
      # Database and encryption keys
      - ./data:/app/data
      # Your function code
      - ./code:/app/code
    restart: unless-stopped
```

Create directories and start:

```bash
mkdir -p data code
docker compose up -d
```

The servers should be running on:

- `http://localhost:8000` - Function execution (`/run/*`)
- `http://localhost:9000` - Management API and Web UI (`/api/*`, `/web/*`)

## Understanding AUTH_BASE_URL

In most deployments, Crude Functions auto-detects the correct base URL for authentication redirects. However, you may need to set `AUTH_BASE_URL` environment variable in these scenarios:

**When to set it:**

- Deploying behind a reverse proxy with complex routing
- Auto-detection fails (rare)
- Using a custom domain or non-standard port mapping

**How to set it:**

Add to your `docker-compose.yml`:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    ports:
      - 8000:8000
    environment:
      - AUTH_BASE_URL=https://functions.yourdomain.com
    volumes:
      - ./data:/app/data
      - ./code:/app/code
    restart: unless-stopped
```

Or with `docker run`:

```bash
docker run -d \
  -p 8000:8000 \
  -e AUTH_BASE_URL=https://functions.yourdomain.com \
  -v ./data:/app/data \
  -v ./code:/app/code \
  --name crude-functions \
  xkonti/crude-functions:latest-hardened
```

**Format:**

- `https://your-domain.com` (with HTTPS in production)
- `http://localhost:9000` (local development, management port)
- No trailing slash

## Port Configuration

Crude Functions runs on two ports by default:

| Port | Environment Variable | Default | Endpoints |
|------|---------------------|---------|-----------|
| Function | `FUNCTION_PORT` | 8000 | `/run/*` - deployed function handlers |
| Management | `MANAGEMENT_PORT` | 9000 | `/api/*`, `/web/*` - API and Web UI |

This separation allows you to:

- Expose only the function port to the public internet
- Keep the management port on an internal network or behind a VPN
- Apply different firewall rules or rate limits per port

### Single Port Mode

If you prefer running everything on a single port, set both variables to the same value:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    ports:
      - 8000:8000
    environment:
      - FUNCTION_PORT=8000
      - MANAGEMENT_PORT=8000
    volumes:
      - ./data:/app/data
      - ./code:/app/code
    restart: unless-stopped
```

In single port mode, all endpoints are available on the same port:

- `/run/*` - Function execution
- `/api/*` - Management API
- `/web/*` - Web UI

### Reverse Proxy Example

When exposing both ports through a reverse proxy at the same domain:

```nginx
# Function execution - public
location /run/ {
    proxy_pass http://crude-functions:8000;
}

# Management - internal/authenticated
location /api/ {
    proxy_pass http://crude-functions:9000;
    # Add IP restrictions, etc.
}

location /web/ {
    proxy_pass http://crude-functions:9000;
}
```
