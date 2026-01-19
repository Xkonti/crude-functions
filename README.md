# Crude Functions

![Crude Functions Logo](https://raw.githubusercontent.com/Xkonti/crude-functions/main/docs/public/logo.svg)

[Documentation](https://crude-functions.xkonti.tech) | [Docker Hub](https://hub.docker.com/r/xkonti/crude-functions) | [GitHub](https://github.com/Xkonti/crude-functions)

Crude Functions is a minimal, self-hosted serverless function platform that runs in a single Docker container. Write TypeScript functions, deploy them as HTTP endpoints, manage everything through a web UI or API. That's it.

**Philosophy:** Simple, pragmatic, and designed for internal use. No complex deployment pipelines, no sandboxing theater, no scaling nonsense. You want to run some functions on your network? Done.

**Target use case:** Internal network services with low-to-moderate traffic. Think internal APIs, webhooks, automation scripts, or small tools for your team.

🚨 ENTIRELY VIBE CODED INCLUDING THIS DOCUMENT 🚨

## Who Should Use This?

You should use Crude Functions if you:

- Want a simple way to deploy and manage serverless-style functions internally
- Trust the code you're running (no sandboxing - this is for internal use)
- Don't need massive scale or complex orchestration
- Want to avoid cloud vendor lock-in for internal tooling
- Value simplicity over enterprise features

You should NOT use this if you:

- Need to run untrusted code (no sandbox)
- Expect high traffic
- Want a production-ready public API platform
- Need multi-tenancy or advanced isolation

## Features

- **Minimal footprint:** Single Deno process, ~25MB RAM idle
- **Zero-downtime deploys:** Hot-reload functions without restarting the server
- **No build step:** Deno runs TypeScript directly
- **Web UI:** Browser-based management interface
- **API-first:** Full REST API for programmatic management
- **API key authentication:** Flexible key-based access control with groups
- **Secrets management:** Hierarchical scoping (global, function, group, key)
- **Encryption at rest:** AES-256-GCM for API keys and secrets

## Quick Start

### Prerequisites

- Docker (and optionally Docker Compose)

### Deploy with Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  app:
    image: xkonti/crude-functions:latest-hardened
    ports:
      - 8000:8000
    volumes:
      - ./data:/app/data
      - ./code:/app/code
    restart: unless-stopped
```

Start it:

```bash
mkdir -p data code
docker compose up -d
```

The server is now running at `http://localhost:8000`.

### First-Time Setup

1. Navigate to `http://localhost:8000/web`
2. Create your admin account
3. Start deploying functions

## Your First Function

Create `code/hello.ts`:

```typescript
export default async function (c, ctx) {
  return c.json({
    message: "Hello from Crude Functions!",
    timestamp: new Date().toISOString(),
    requestId: ctx.requestId,
  });
}
```

Register the route via the web UI at `http://localhost:8000/web/functions`, then test it:

```bash
curl http://localhost:8000/run/hello
```

Changes to your function files are hot-reloaded automatically.

## Image Variants

Two Docker image variants are available:

| Variant | Tag | Use Case |
|---------|-----|----------|
| **Hardened** | `latest-hardened` | Production - near-zero CVEs, no shell, runs as non-root |
| **Standard** | `latest` | Debugging - full Debian base with shell access |

Semver tags are also available: `:0.4.3-hardened`, `:0.4-hardened`, `:0-hardened`

**Hardened image limitations:** No shell commands, no NPM packages with native bindings, no FFI. Pure TypeScript/JavaScript works fine.

## Security Considerations

- Designed for **internal network use** with trusted code
- No sandboxing - functions have full Deno permissions
- API keys and secrets encrypted with AES-256-GCM
- Automatic encryption key rotation
- **Important:** Back up `./data/encryption-keys.json` - loss means encrypted data cannot be recovered

## Documentation

Full documentation is available at **[crude-functions.xkonti.tech](https://crude-functions.xkonti.tech)**

## Development

```bash
deno task dev       # Run with hot reload
deno task test      # Run all tests
deno lint           # Lint codebase
```

## License

MIT
