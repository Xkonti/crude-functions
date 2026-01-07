# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
deno task dev       # Run with hot reload (--watch)
deno task test      # Run all tests
deno lint           # Lint codebase
deno check main.ts  # Type check entry point
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
- **API**: Better Auth session OR API key via `X-API-Key` header (groups configured in `api.access-groups` setting)
- **Function execution**: Optional per-route API key requirements
- Sign-up disabled after first user is created - existing users can add new ones on dedicated user management page

### Key Patterns

#### Service Ownership (Critical Pattern)

**Services own database access.** Never query the database directly from routes or other code - always go through the appropriate service.

**Why:**
- **Single source of truth**: All queries for a domain live in one place
- **Easier refactoring**: Change query logic once, affects all callers
- **Caching layer**: Services can add caching without changing consumers
- **Type safety**: Services provide typed interfaces over raw SQL
- **Business logic**: Validation and domain rules stay in services, not scattered

**Examples:**
- Routes need API keys? → Use `ApiKeyService`, not direct DB queries
- Need to create a function route? → Use `RoutesService.addRoute()`, not `db.execute()`
- File management? → Use `FileService`, which handles both DB and filesystem

**Service architecture**:
- Constructor dependency injection pattern throughout
- Services assume database is already open (validated at startup)
- All services take `{ db: DatabaseService, ... }` options object

**Concurrency**:
- `@core/asyncutil/mutex` for write serialization
- Single-instance design (stateful web service, not ephemeral)
- WAL mode allows concurrent reads during writes

**Philosophy**:
Intended as internal tooling. "Crude" means simple and pragmatic - get things done without complex deployment. Not intended as a public service. No sandboxing, no excessive security theater. User can shoot themselves in the foot and that's a feature.

### Database

SQLite in WAL mode at `./data/database.db`. Schema defined in `migrations/`. Access exclusively through services - never query directly.

### Endpoints Structure

- `/ping` - Health check
- `/api/auth/*` - Better Auth handlers
- `/api/keys/*` - API key management (protected)
- `/api/routes/*` - Route management (protected)
- `/api/files/*` - Code file management (protected)
- `/web/*` - Web UI (session auth)
- `/run/*` - Function execution

## Function Handlers

User-deployed handlers in `code/` directory are TypeScript files that export a default async function:

```typescript
export default async function (c, ctx) {
  // c = Hono context (request, response helpers)
  // ctx = Function context (params, query, requestId, route, authenticatedKeyGroup, getSecret)
  return c.json({ message: "Hello" });
}
```

**Important**: Handlers use Deno imports. External packages need full specifiers:
- NPM: `npm:lodash-es`
- JSR: `jsr:@std/path`
- URLs: `https://esm.sh/zod`

## Configuration

- Environment variables in `.env` (see `.env.example`)
- Application settings stored in database via `SettingsService`
- API access controlled by `api.access-groups` database setting
- Create API keys via web UI after initial admin setup

## Testing

**Philosophy**: Tests should be simple and focused on tested intent. Minimize infrastructure overhead.

**TestSetupBuilder** (`src/test/test_setup_builder.ts`):
- Use for service tests needing real database, migrations, and multiple services
- Mirrors production initialization flow to prevent schema/initialization drift
- Examples: `routes_service_test.ts`, `api_key_service_test.ts`

**Simple helpers** (in-file functions):
- Use for file-specific setup needs
- Preferred for low-level utilities and simple unit tests
- Examples: `env_isolator_test.ts`, `key_storage_service_test.ts`

See `test_setup_builder.ts` header for detailed guidelines on when to use each approach.
