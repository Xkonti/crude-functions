import { Hono } from "@hono/hono";
import {
  FileService,
  isPathSafe,
  normalizePath,
  validateFilePath,
} from "./file_service.ts";

export function createFileRoutes(service: FileService): Hono {
  const routes = new Hono();

  // GET /api/files - List all files
  routes.get("/", async (c) => {
    const files = await service.listFiles();
    return c.json({ files });
  });

  // GET /api/files/content - Get file content
  routes.get("/content", async (c) => {
    const path = c.req.query("path");

    if (!path) {
      return c.json({ error: "Missing required query parameter: path" }, 400);
    }

    if (!validateFilePath(path)) {
      return c.json({ error: "Invalid path format" }, 400);
    }

    if (!isPathSafe(path)) {
      return c.json({ error: "Path traversal not allowed" }, 403);
    }

    const normalized = normalizePath(path);
    const content = await service.getFile(normalized);

    if (content === null) {
      return c.json({ error: "File not found" }, 404);
    }

    return c.json({ path: normalized, content });
  });

  // POST /api/files - Create or update file
  routes.post("/", async (c) => {
    let body: { path?: string; content?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.path) {
      return c.json({ error: "Missing required field: path" }, 400);
    }

    if (body.content === undefined) {
      return c.json({ error: "Missing required field: content" }, 400);
    }

    if (!validateFilePath(body.path)) {
      return c.json({ error: "Invalid path format" }, 400);
    }

    if (!isPathSafe(body.path)) {
      return c.json({ error: "Path traversal not allowed" }, 403);
    }

    const normalized = normalizePath(body.path);
    const created = await service.writeFile(normalized, body.content);

    return c.json({ success: true }, created ? 201 : 200);
  });

  // DELETE /api/files - Delete file
  routes.delete("/", async (c) => {
    let body: { path?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.path) {
      return c.json({ error: "Missing required field: path" }, 400);
    }

    if (!validateFilePath(body.path)) {
      return c.json({ error: "Invalid path format" }, 400);
    }

    if (!isPathSafe(body.path)) {
      return c.json({ error: "Path traversal not allowed" }, 403);
    }

    const normalized = normalizePath(body.path);

    if (!(await service.fileExists(normalized))) {
      return c.json({ error: "File not found" }, 404);
    }

    await service.deleteFile(normalized);
    return c.json({ success: true });
  });

  return routes;
}
