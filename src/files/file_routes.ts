import { Hono, type Context } from "@hono/hono";
import { FileService } from "./file_service.ts";
import { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";
import { normalizePath, validateFilePath } from "../validation/files.ts";
import { getContentType, isTextContentType } from "./content_type.ts";
import { base64ToBytes, bytesToBase64 } from "../encryption/utils.ts";

export interface FileRoutesOptions {
  fileService: FileService;
  settingsService: SettingsService;
}

interface ParseResult {
  content?: Uint8Array;
  error?: string;
  status?: 400 | 413;
}

export function createFileRoutes(options: FileRoutesOptions): Hono {
  const { fileService, settingsService } = options;
  const routes = new Hono();

  // Helper: Get max file size from settings
  async function getMaxFileSize(): Promise<number> {
    const setting = await settingsService.getGlobalSetting(
      SettingNames.FILES_MAX_SIZE_BYTES
    );
    return setting ? parseInt(setting, 10) : 52428800; // 50 MB default
  }

  // Helper: Extract and validate path from route param
  function extractPath(
    c: Context
  ): { path: string | null; error: string | null } {
    const rawPath = c.req.param("path");
    if (!rawPath) {
      return { path: null, error: "Missing file path" };
    }

    // Decode URI components (handles %2F for slashes, etc.)
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      return { path: null, error: "Invalid URL encoding in path" };
    }

    if (!validateFilePath(decodedPath)) {
      return { path: null, error: "Invalid path format" };
    }

    return { path: normalizePath(decodedPath), error: null };
  }

  // Helper: Parse file content from request body
  async function parseFileContent(
    c: Context,
    maxSize: number
  ): Promise<ParseResult> {
    const contentType = c.req.header("Content-Type") || "";
    const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);

    // Check size limit upfront if Content-Length is provided
    if (contentLength > 0 && contentLength > maxSize) {
      return {
        error: `File size ${contentLength} exceeds maximum ${maxSize} bytes`,
        status: 413,
      };
    }

    // JSON body (base64 for binary, text for text)
    if (contentType.includes("application/json")) {
      return await parseJsonBody(c, maxSize);
    }

    // Multipart form-data
    if (contentType.includes("multipart/form-data")) {
      return await parseMultipartBody(c, maxSize);
    }

    // Raw binary (application/octet-stream or anything else)
    return await parseRawBody(c, maxSize);
  }

  // GET /api/files - List all files with metadata
  routes.get("/", async (c) => {
    const files = await fileService.listFilesWithMetadata();
    return c.json({ files });
  });

  // GET /api/files/:path - Get file content
  routes.get("/:path{.+}", async (c) => {
    const { path, error } = extractPath(c);
    if (error) {
      return c.json({ error }, 400);
    }

    const content = await fileService.getFileBytes(path!);
    if (content === null) {
      return c.json({ error: "File not found" }, 404);
    }

    const contentType = getContentType(path!);
    const acceptHeader = c.req.header("Accept") || "*/*";

    // If client explicitly requests JSON (and not wildcard)
    if (
      acceptHeader.includes("application/json") &&
      !acceptHeader.includes("*/*")
    ) {
      // Return JSON envelope with base64 for binary, text for text
      if (isTextContentType(contentType)) {
        return c.json({
          path: path!,
          content: new TextDecoder().decode(content),
          contentType,
          size: content.length,
          encoding: "utf-8",
        });
      } else {
        return c.json({
          path: path!,
          content: bytesToBase64(content),
          contentType,
          size: content.length,
          encoding: "base64",
        });
      }
    }

    // Return raw file with appropriate content type
    // Create a copy to ensure we have a regular ArrayBuffer (not SharedArrayBuffer)
    const responseBody = new Uint8Array(content).buffer;
    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(content.length),
      },
    });
  });

  // POST /api/files/:path - Create file (409 if exists)
  routes.post("/:path{.+}", async (c) => {
    const { path, error } = extractPath(c);
    if (error) {
      return c.json({ error }, 400);
    }

    // Check if file already exists
    if (await fileService.fileExists(path!)) {
      return c.json({ error: "File already exists", path: path! }, 409);
    }

    // Parse content based on Content-Type
    const result = await parseFileContent(c, await getMaxFileSize());
    if (result.error) {
      return c.json({ error: result.error }, result.status || 400);
    }

    try {
      await fileService.writeFileBytes(path!, result.content!);
      return c.json({ success: true, path: path!, created: true }, 201);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("escapes base directory")
      ) {
        return c.json({ error: "Path escapes base directory" }, 400);
      }
      throw err;
    }
  });

  // PUT /api/files/:path - Create or update file (upsert)
  routes.put("/:path{.+}", async (c) => {
    const { path, error } = extractPath(c);
    if (error) {
      return c.json({ error }, 400);
    }

    // Parse content based on Content-Type
    const result = await parseFileContent(c, await getMaxFileSize());
    if (result.error) {
      return c.json({ error: result.error }, result.status || 400);
    }

    try {
      const created = await fileService.writeFileBytes(path!, result.content!);
      return c.json(
        { success: true, path: path!, created },
        created ? 201 : 200
      );
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("escapes base directory")
      ) {
        return c.json({ error: "Path escapes base directory" }, 400);
      }
      throw err;
    }
  });

  // DELETE /api/files/:path - Delete file
  routes.delete("/:path{.+}", async (c) => {
    const { path, error } = extractPath(c);
    if (error) {
      return c.json({ error }, 400);
    }

    if (!(await fileService.fileExists(path!))) {
      return c.json({ error: "File not found" }, 404);
    }

    await fileService.deleteFile(path!);
    return c.json({ success: true, path: path!, deleted: true }, 200);
  });

  return routes;
}

// ============================================================================
// Content Parsing Helpers
// ============================================================================

/**
 * Parse JSON body: { content: "...", encoding?: "base64" | "utf-8" }
 */
async function parseJsonBody(c: Context, maxSize: number): Promise<ParseResult> {
  let body: { content?: string; encoding?: string };
  try {
    body = await c.req.json();
  } catch {
    return { error: "Invalid JSON body" };
  }

  if (body.content === undefined) {
    return { error: "Missing required field: content" };
  }

  const encoding = body.encoding || "utf-8";

  if (encoding === "base64") {
    try {
      const bytes = base64ToBytes(body.content);
      if (bytes.length > maxSize) {
        return {
          error: `File size ${bytes.length} exceeds maximum ${maxSize} bytes`,
          status: 413,
        };
      }
      return { content: bytes };
    } catch {
      return { error: "Invalid base64 content" };
    }
  } else if (encoding === "utf-8" || encoding === "text") {
    const bytes = new TextEncoder().encode(body.content);
    if (bytes.length > maxSize) {
      return {
        error: `File size ${bytes.length} exceeds maximum ${maxSize} bytes`,
        status: 413,
      };
    }
    return { content: bytes };
  } else {
    return { error: `Unsupported encoding: ${encoding}. Use "base64" or "utf-8"` };
  }
}

/**
 * Parse multipart form-data: file field named "file" or "content"
 */
async function parseMultipartBody(
  c: Context,
  maxSize: number
): Promise<ParseResult> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return { error: "Invalid multipart form-data" };
  }

  // Look for file in common field names
  const file = formData.get("file") || formData.get("content");

  if (!file) {
    return {
      error: "Missing file field in form-data (expected 'file' or 'content')",
    };
  }

  if (file instanceof File) {
    if (file.size > maxSize) {
      return {
        error: `File size ${file.size} exceeds maximum ${maxSize} bytes`,
        status: 413,
      };
    }
    const buffer = await file.arrayBuffer();
    return { content: new Uint8Array(buffer) };
  }

  // String value (treat as text)
  if (typeof file === "string") {
    const bytes = new TextEncoder().encode(file);
    if (bytes.length > maxSize) {
      return {
        error: `Content size ${bytes.length} exceeds maximum ${maxSize} bytes`,
        status: 413,
      };
    }
    return { content: bytes };
  }

  return { error: "Invalid file field type" };
}

/**
 * Parse raw binary body (application/octet-stream or any other content type)
 */
async function parseRawBody(c: Context, maxSize: number): Promise<ParseResult> {
  try {
    const buffer = await c.req.arrayBuffer();
    if (buffer.byteLength > maxSize) {
      return {
        error: `File size ${buffer.byteLength} exceeds maximum ${maxSize} bytes`,
        status: 413,
      };
    }
    return { content: new Uint8Array(buffer) };
  } catch {
    return { error: "Failed to read request body" };
  }
}
