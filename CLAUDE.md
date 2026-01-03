# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
deno task dev       # Run with hot reload (--watch)
deno task test      # Run all tests
deno lint           # Lint codebase
deno check main.ts  # Type check entry point
```

Run a single test file:

```bash
deno test --env-file=.env --allow-net --allow-env --allow-read --allow-write --allow-ffi src/database/database_service_test.ts
```

## Architecture Overview

This is a Deno-based serverless function router called Crude Functions. It a barebones equivalent of Val Town intended to be deployed as a single Docker container. Functions are TypeScript files in `code/` that get dynamically loaded and executed as HTTP endpoints. SQLite for database, Better Auth for web UI auth, custom API keys for function protection. SSR web UI using Pico CSS.

### Request Flow for deployed functions

```
Request → /run/* → FunctionRouter → HandlerLoader → Execute handler → Response
```

Function router handles API key verification (if route requires keys) and handles capturing console and metrics.

### Core Services (src/)

| Service | Location | Purpose |
|---------|----------|---------|
| `DatabaseService` | `database/` | SQLite with WAL mode, mutex-protected writes |
| `MigrationService` | `database/` | Forward-only migrations from `migrations/` |
| `FunctionRouter` | `functions/` | Dynamic routing, handler execution, context injection |
| `HandlerLoader` | `functions/` | Hot-reload handlers (tracks file mtime) |
| `ApiKeyService` | `keys/` | Key group management, no caching |
| `RoutesService` | `routes/` | Route CRUD, dirty-flag pattern for rebuilds |
| `FileService` | `files/` | Code file management, path traversal prevention |
| `ConsoleLogService` | `logs/` | Capture console.* calls per request |
| `ExecutionMetricsService` | `metrics/` | Timing and count tracking |

### Authentication

- **Web UI**: Better Auth with session cookies only - no API keys accepted for the UI endpoints.
- **API**: The JWT token from Better Auth or special `management` API key via `X-API-Key` header
- **Function execution**: Optional per-route API key requirements
- Sign-up disabled after first user is created - existing users can add new ones on dedicated user management page

Claude, be a good team member and report encounter discrepancies to the user IMMEDIATELY.

### Key Patterns

- **Service architecture**: Constructor dependency injection, services assume db always open
- **Concurrency**: `@core/asyncutil/mutex` for write serialization. This service is expected to fully own the DB and have only a single instance running. Stateful web service, not ephemeral.
- **Philosophy**: Intended as internal tooling. "Crude" in name means that it's a simple service to get things done without deploying or configure many things. Not intended to be a public service. No sandboxing, no extra security to lock secrets... User can shoot themselves in a foot and that's a feature.

### Database

SQLite in WAL mode at `./data/database.db`. Schema defined in `migrations/`

### Endpoints Structure

- `/ping` - Health check
- `/api/auth/*` - Better Auth handlers
- `/api/keys/*` - API key management (protected)
- `/api/routes/*` - Route management (protected)
- `/api/files/*` - Code file management (protected)
- `/web/*` - Web UI (session auth)
- `/run/*` - Function execution

## Function Handlers

Handlers in `code/` export a default async function receiving Hono context (`c`) and function context (`ctx`):

```typescript
export default async function (c, ctx) {
  // ctx.params, ctx.query, ctx.requestId, ctx.route, ctx.authenticatedKeyGroup
  return c.json({ message: "Hello" });
}
```

External packages require full specifiers: `npm:lodash-es`, `jsr:@zod/zod`, or full URLs.

## Environment Variables

See `.env.example` for all options. Key variables:

- `MANAGEMENT_API_KEY` - Required for admin access
- `BETTER_AUTH_SECRET` - Session signing (generate random for production)
- `BETTER_AUTH_BASE_URL` - Application URL for redirects
