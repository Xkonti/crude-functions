---
title: Deployment
description: How to deploy Crude Functions
---

## Image Variants

Two image variants are available:

- `standard` - Full Debian base with shell. Use this for debugging or if you need to exec into the container or execute shell commands from within your functions.
- `hardened` - Uses [Docker Hardened Image](https://dhi.io) - Near-zero CVEs, no shell, runs as non-root. Use this for production.

**Hardened variant** (default in examples):

- Near-zero CVEs, minimal attack surface
- SLSA Level 3 provenance, signed SBOM
- No shell or package manager
- Runs as non-root user

**Hardened image limitations for function handlers:**

- ❌ Shell commands (`Deno.Command()`, subprocess spawning) will fail
- ❌ NPM packages with native bindings or lifecycle scripts won't work
- ❌ Direct FFI access to system libraries (libc, libm, etc.) mostly unavailable
- ✅ Pure TypeScript/JavaScript, JSR packages, and most NPM packages work fine

**Standard variant**:

- Full Debian base with shell access
- Easier debugging in production
- Use when you need to exec into container

To switch variants, change the image tag:

```yaml
xkonti/crude-functions:latest           # Standard
xkonti/crude-functions:latest-hardened  # Hardened (recommended)
```

These images follow the semver conventions and one can specify more specific versions of the image, for example:

- `:0.4.3`/`:0.4.3-hardened`
- `:0.4`/`:0.4-hardened`
- `:0`/`:0-hardened`

## Prerequisites

To be able to deploy Crude Functions all you need is Docker and preferably Docker Compose.

### Using Docker Run

```bash
mkdir -p data code
docker run -d \
  -p 8000:8000 \
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
      - 8000:8000
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

The server should be running on `http://localhost:8000`.
