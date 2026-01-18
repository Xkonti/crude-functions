# Handler Loading Impact Research

## Summary

The existing handler loading system is **well-suited** for source-prefixed paths with minimal changes needed. File content changes are automatically picked up via mtime-based cache invalidation. Route rebuilds are triggered by database changes only, not file system changes.

---

## Research Questions & Findings

### 1. Does HandlerLoader work with source-prefixed paths?

**Status: ✅ Works out of the box**

The `HandlerLoader` class (`src/functions/handler_loader.ts`) already supports source-prefixed paths like `my-source/handler.ts`.

**How it works:**

```typescript
// Constructor accepts a base directory (defaults to cwd)
constructor(options: HandlerLoaderOptions = {}) {
  this.baseDirectory = options.baseDirectory ?? Deno.cwd();
}

// load() accepts relative paths like "source/handler.ts"
async load(handlerPath: string, forceReload = false): Promise<FunctionHandler>

// Resolves to absolute: /path/to/code/source/handler.ts
private resolveAbsolutePath(handlerPath: string): string {
  const resolvedPath = resolve(this.baseDirectory, normalized);
  // Security: validates resolved path stays within base directory
}
```

**Current configuration** (`main.ts:262-269`):
```typescript
const functionRouter = new FunctionRouter({
  // ...
  codeDirectory: "./code",  // Base for all handler paths
});
```

**Existing tests confirm this works** (`handler_loader_test.ts:44-68`):
- Creates subdirectories like `${testBase}/code/`
- Successfully loads handlers at `code/test.ts`

**No changes needed** - handler paths stored in routes table can already be `sourceName/handler.ts` format.

---

### 2. Does cache invalidation work when git sync changes files?

**Status: ✅ Works automatically**

The handler cache uses file modification time (`mtime`) for invalidation.

**How cache invalidation works** (`handler_loader.ts:49-91`):

```typescript
async load(handlerPath: string, forceReload = false): Promise<FunctionHandler> {
  // 1. Get file stats including mtime
  const stat = await this.getFileStat(absolutePath);
  const fileModTime = stat.mtime?.getTime() ?? 0;

  const cached = this.cache.get(handlerPath);

  // 2. Use cache only if file hasn't been modified
  if (!forceReload && cached && cached.fileModTime === fileModTime) {
    return cached.handler;  // Cached version
  }

  // 3. If mtime changed, re-import with cache-busting
  const cacheBuster = Date.now();
  const importUrl = `file://${absolutePath}?v=${cacheBuster}`;
  const module = await import(importUrl);

  // 4. Update cache with new mtime
  this.cache.set(handlerPath, {
    handler,
    fileModTime,  // Track new mtime for next comparison
    filePath: absolutePath,
  });
}
```

**Why this works for git sync:**
- Git operations (clone, pull, checkout) update file mtimes
- Next request to that handler sees changed mtime
- Handler is re-imported automatically
- No explicit cache invalidation call needed

**Cache-busting mechanism:**
- Uses `?v=${Date.now()}` query parameter
- Forces Deno to re-evaluate the module
- Bypasses Deno's internal module cache

**Manual invalidation also available if needed:**
```typescript
invalidate(handlerPath: string): void    // Single handler
invalidateAll(): void                    // All handlers
```

---

### 3. Do route rebuilds trigger on file changes?

**Status: ⚠️ Only database changes trigger rebuilds (by design)**

The routing system uses a **dirty flag pattern** that only responds to route configuration changes, not file system changes.

**How route rebuilding works** (`routes_service.ts:43-94`):

```typescript
class RoutesService {
  private dirty = true;  // Start dirty to force initial build

  // Called on every request by FunctionRouter
  async rebuildIfNeeded(rebuilder: (routes: FunctionRoute[]) => void): Promise<void> {
    if (!this.dirty) return;  // Fast path: no rebuild needed

    // ... mutex-protected rebuild ...
    const routes = await this.getAll();
    rebuilder(routes);
    this.dirty = false;
  }

  // Only these operations mark dirty:
  private markDirty(): void { this.dirty = true; }

  // addRoute(), removeRoute(), updateRoute(), setRouteEnabled()
  // all call markDirty() after database changes
}
```

**What this means for Code Sources:**

| Scenario | Rebuild Triggered? | Handler Reloaded? |
|----------|-------------------|-------------------|
| Route added/removed via API | ✅ Yes | N/A |
| Route config changed via API | ✅ Yes | N/A |
| Handler file content changed | ❌ No | ✅ Yes (via mtime) |
| New file added by git sync | ❌ No | ❌ No route exists |
| File deleted by git sync | ❌ No | ❌ Returns 404 |

**Key insight:** Route rebuild and handler reload are **separate concerns**:
- **Route rebuild**: Updates which URL patterns map to which handler files
- **Handler reload**: Re-imports the actual TypeScript module

The current design is intentional - file changes don't create new routes automatically. Routes are explicit configuration stored in the database.

---

## Implications for Code Sources Implementation

### What Works Without Changes

1. **Handler paths with source prefix**: `mysource/api/handler.ts` works today
2. **Hot-reload of handler content**: mtime-based invalidation handles this
3. **Path security**: Traversal protection already validates against base directory

### What Needs Consideration

1. **No auto-discovery of new files**
   - If git sync adds `newsource/newhandler.ts`, no route automatically points to it
   - This is correct behavior - routes are explicit configuration
   - Users must create routes after syncing new files

2. **Deleted file handling**
   - If git sync removes a file, existing routes still reference it
   - Handler loading will return 404 (HandlerNotFoundError)
   - Routes remain in database until manually removed
   - Consider: Should we auto-disable routes when handlers are missing?

3. **Bulk file changes**
   - Git sync may update many files at once
   - Each affected handler reloads on next request (lazy)
   - No thundering herd - reloads happen per-request, not all at once
   - `invalidateAll()` could force immediate reload if desired

### Recommendations

1. **No changes needed to HandlerLoader** - it already handles source-prefixed paths

2. **No changes needed to cache invalidation** - mtime-based invalidation is sufficient

3. **No changes needed to route rebuild logic** - file-based routing is not the design goal

4. **Consider adding** (optional, for future):
   - `SyncService` could call `handlerLoader.invalidateAll()` after sync completes
   - This forces immediate reload of all handlers rather than lazy reload
   - Probably unnecessary since lazy reload is efficient

5. **Consider adding** (optional, for UX):
   - After git sync, UI could show which routes point to missing handlers
   - Route health check: validate handler files exist
   - This is a UI/reporting concern, not core functionality

---

## Code References

| File | Lines | Purpose |
|------|-------|---------|
| `src/functions/handler_loader.ts` | 28-220 | Handler loading, caching, path validation |
| `src/functions/function_router.ts` | 32-418 | Route building, request handling |
| `src/routes/routes_service.ts` | 43-386 | Route CRUD, dirty flag pattern |
| `main.ts` | 262-269 | FunctionRouter initialization with code directory |

---

## Conclusion

The handler loading system is **ready for source-prefixed paths** with no code changes needed. The separation of concerns between route configuration (database) and handler content (filesystem) is a good architectural pattern that should be preserved. File changes are automatically picked up via mtime-based cache invalidation, and route changes trigger rebuilds via the dirty flag pattern.
