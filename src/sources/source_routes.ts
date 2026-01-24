import { Hono } from "@hono/hono";
import { CodeSourceService } from "./code_source_service.ts";
import { validateId } from "../validation/common.ts";
import {
  DuplicateSourceError,
  InvalidSourceConfigError,
  SourceNotFoundError,
  SourceNotSyncableError,
  WebhookAuthError,
  WebhookDisabledError,
} from "./errors.ts";
import type {
  CodeSource,
  CodeSourceType,
  GitTypeSettings,
  NewCodeSource,
  SyncSettings,
  TypeSettings,
  UpdateCodeSource,
} from "./types.ts";
import { isCodeSourceType } from "./types.ts";

export interface SourceRoutesOptions {
  codeSourceService: CodeSourceService;
}

/**
 * Sanitize type settings for API response (redact sensitive fields).
 */
function sanitizeTypeSettings(
  settings: TypeSettings,
  type: CodeSourceType,
): TypeSettings {
  if (type === "git") {
    const gitSettings = settings as GitTypeSettings;
    return {
      ...gitSettings,
      authToken: gitSettings.authToken ? "***REDACTED***" : undefined,
    };
  }
  return settings;
}

/**
 * Sanitize sync settings for API response (redact sensitive fields).
 */
function sanitizeSyncSettings(settings: SyncSettings): SyncSettings {
  return {
    ...settings,
    webhookSecret: settings.webhookSecret ? "***REDACTED***" : undefined,
  };
}

/**
 * Transform CodeSource entity to API response format.
 */
function sourceToResponse(source: CodeSource) {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    typeSettings: sanitizeTypeSettings(source.typeSettings, source.type),
    syncSettings: sanitizeSyncSettings(source.syncSettings),
    enabled: source.enabled,
    lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    lastSyncStartedAt: source.lastSyncStartedAt?.toISOString() ?? null,
    lastSyncError: source.lastSyncError,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

/**
 * Check if a string looks like a numeric ID.
 * Used to differentiate between ID routes and sourceName routes.
 */
function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Create the webhook route for code sources.
 * This is exported separately because webhook endpoints require no auth
 * (they use their own secret validation).
 *
 * Mounted at /api/sources before auth middleware.
 */
export function createSourceWebhookRoute(options: SourceRoutesOptions): Hono {
  const { codeSourceService } = options;
  const routes = new Hono();

  // POST /api/sources/:id/webhook - Webhook trigger (no auth - uses secret)
  routes.post("/:id/webhook", async (c) => {
    const idParam = c.req.param("id");
    if (!isNumericId(idParam)) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const id = validateId(idParam);
    if (id === null) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    // Get secret from header or query param (optional - only validated if source requires it)
    const secret =
      c.req.header("X-Webhook-Secret") ?? c.req.query("secret") ?? "";

    try {
      const job = await codeSourceService.triggerWebhookSync(id, secret);
      if (job === null) {
        return c.json({
          message: "Sync skipped (source disabled or already in progress)",
        });
      }
      return c.json({ message: "Sync triggered", jobId: job.id });
    } catch (error) {
      if (error instanceof SourceNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof WebhookDisabledError) {
        return c.json({ error: "Webhooks disabled for this source" }, 403);
      }
      if (error instanceof WebhookAuthError) {
        return c.json({ error: "Invalid webhook secret" }, 401);
      }
      throw error;
    }
  });

  return routes;
}

/**
 * Create routes for code source management.
 * Mounted at /api/sources
 */
export function createSourceRoutes(options: SourceRoutesOptions): Hono {
  const { codeSourceService } = options;
  const routes = new Hono();

  // GET /api/sources - List all sources
  routes.get("/", async (c) => {
    const sources = await codeSourceService.getAll();
    return c.json({
      sources: sources.map(sourceToResponse),
    });
  });

  // GET /api/sources/:id - Get source by ID
  routes.get("/:id", async (c) => {
    const idParam = c.req.param("id");

    // Skip if this looks like a sourceName (not numeric) - let file routes handle it
    if (!isNumericId(idParam)) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const id = validateId(idParam);
    if (id === null) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    return c.json(sourceToResponse(source));
  });

  // POST /api/sources - Create new source
  routes.post("/", async (c) => {
    let body: {
      name?: string;
      type?: string;
      typeSettings?: TypeSettings;
      syncSettings?: SyncSettings;
      enabled?: boolean;
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name) {
      return c.json({ error: "Missing required field: name" }, 400);
    }
    if (!body.type) {
      return c.json({ error: "Missing required field: type" }, 400);
    }
    if (!isCodeSourceType(body.type)) {
      return c.json(
        { error: `Invalid source type: ${body.type}. Must be 'manual' or 'git'` },
        400,
      );
    }

    const newSource: NewCodeSource = {
      name: body.name,
      type: body.type,
      typeSettings: body.typeSettings,
      syncSettings: body.syncSettings,
      enabled: body.enabled,
    };

    try {
      const source = await codeSourceService.create(newSource);
      return c.json(sourceToResponse(source), 201);
    } catch (error) {
      if (error instanceof DuplicateSourceError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof InvalidSourceConfigError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  // PUT /api/sources/:id - Update source
  routes.put("/:id", async (c) => {
    const idParam = c.req.param("id");
    if (!isNumericId(idParam)) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const id = validateId(idParam);
    if (id === null) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    let body: {
      typeSettings?: TypeSettings;
      syncSettings?: SyncSettings;
      enabled?: boolean;
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Detect if git URL/ref changed (for auto-sync)
    let needsSync = false;
    if (source.type === "git" && body.typeSettings) {
      const oldSettings = source.typeSettings as GitTypeSettings;
      const newSettings = body.typeSettings as GitTypeSettings;

      needsSync =
        oldSettings.url !== newSettings.url ||
        oldSettings.branch !== newSettings.branch ||
        oldSettings.tag !== newSettings.tag ||
        oldSettings.commit !== newSettings.commit;
    }

    const updates: UpdateCodeSource = {
      typeSettings: body.typeSettings,
      syncSettings: body.syncSettings,
      enabled: body.enabled,
    };

    try {
      const updated = await codeSourceService.update(id, updates);

      // Auto-trigger sync if URL/ref changed
      let syncTriggered = false;
      if (needsSync && updated.enabled) {
        try {
          await codeSourceService.triggerManualSync(id);
          syncTriggered = true;
        } catch {
          // Sync trigger failure shouldn't fail the update
        }
      }

      return c.json({
        ...sourceToResponse(updated),
        syncTriggered,
      });
    } catch (error) {
      if (error instanceof SourceNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof InvalidSourceConfigError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  // DELETE /api/sources/:id - Delete source
  routes.delete("/:id", async (c) => {
    const idParam = c.req.param("id");
    if (!isNumericId(idParam)) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const id = validateId(idParam);
    if (id === null) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    try {
      await codeSourceService.delete(id);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof SourceNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  // POST /api/sources/:id/sync - Trigger manual sync
  routes.post("/:id/sync", async (c) => {
    const idParam = c.req.param("id");
    if (!isNumericId(idParam)) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const id = validateId(idParam);
    if (id === null) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    try {
      const job = await codeSourceService.triggerManualSync(id);
      if (job === null) {
        return c.json({ message: "Sync already in progress" }, 409);
      }
      return c.json({ message: "Sync triggered", jobId: job.id });
    } catch (error) {
      if (error instanceof SourceNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof SourceNotSyncableError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  // GET /api/sources/:id/status - Get sync status
  routes.get("/:id/status", async (c) => {
    const idParam = c.req.param("id");
    if (!isNumericId(idParam)) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const id = validateId(idParam);
    if (id === null) {
      return c.json({ error: "Invalid source ID" }, 400);
    }

    const source = await codeSourceService.getById(id);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    const isSyncable = await codeSourceService.isSyncable(id);
    const isEditable = await codeSourceService.isEditable(id);

    return c.json({
      isSyncable,
      isEditable,
      lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
      lastSyncStartedAt: source.lastSyncStartedAt?.toISOString() ?? null,
      lastSyncError: source.lastSyncError,
      isSyncing: source.lastSyncStartedAt !== null,
    });
  });

  return routes;
}
