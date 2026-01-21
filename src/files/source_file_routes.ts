import { Hono, type Context } from "@hono/hono";
import type { SourceFileService } from "./source_file_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";
import { normalizePath, validateFilePath } from "../validation/files.ts";
import { getContentType, isTextContentType } from "./content_type.ts";
import { base64ToBytes, bytesToBase64 } from "../encryption/utils.ts";
import {
  SourceNotFoundError,
  SourceNotEditableError,
} from "../sources/errors.ts";

export interface SourceFileRoutesOptions {
  sourceFileService: SourceFileService;
  settingsService: SettingsService;
}

interface ParseResult {
  content?: Uint8Array;
  error?: string;
  status?: 400 | 413;
}

/**
 * Creates source-aware file routes.
 *
 * API structure:
 * - GET    /:sourceName/files           - List files in source
 * - GET    /:sourceName/files/:path     - Get file content
 * - POST   /:sourceName/files/:path     - Create file (409 if exists)
 * - PUT    /:sourceName/files/:path     - Create or update file
 * - DELETE /:sourceName/files/:path     - Delete file
 */
export function createSourceFileRoutes(options: SourceFileRoutesOptions): Hono {
  const { sourceFileService, settingsService } = options;
  const routes = new Hono();

  // Helper: Get max file size from settings
  async function getMaxFileSize(): Promise<number> {
    const setting = await settingsService.getGlobalSetting(
      SettingNames.FILES_MAX_SIZE_BYTES
    );
    return setting ? parseInt(setting, 10) : 52428800; // 50 MB default
  }

  // Helper: Extract and validate source name from route param
  function extractSourceName(c: Context): {
    sourceName: string | null;
    error: string | null;
  } {
    const sourceName = c.req.param("sourceName");
    if (!sourceName) {
      return { sourceName: null, error: "Missing source name" };
    }
    return { sourceName, error: null };
  }

  // Helper: Extract and validate path from route param
  function extractPath(c: Context): { path: string | null; error: string | null } {
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

  // Helper: Handle source errors
  function handleSourceError(c: Context, error: unknown): Response {
    if (error instanceof SourceNotFoundError) {
      return c.json({ error: `Source not found: ${error.identifier}` }, 404);
    }
    if (error instanceof SourceNotEditableError) {
      return c.json(
        {
          error: `Source '${error.sourceName}' (type: ${error.sourceType}) is not editable`,
        },
        403
      );
    }
    throw error;
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

  // GET /:sourceName/files - List all files in source
  routes.get("/:sourceName/files", async (c) => {
    const { sourceName, error } = extractSourceName(c);
    if (error) {
      return c.json({ error }, 400);
    }

    try {
      const files = await sourceFileService.listFilesWithMetadata(sourceName!);
      return c.json({ files });
    } catch (err) {
      return handleSourceError(c, err);
    }
  });

  // GET /:sourceName/files/:path - Get file content
  routes.get("/:sourceName/files/:path{.+}", async (c) => {
    const { sourceName, error: sourceError } = extractSourceName(c);
    if (sourceError) {
      return c.json({ error: sourceError }, 400);
    }

    const { path, error: pathError } = extractPath(c);
    if (pathError) {
      return c.json({ error: pathError }, 400);
    }

    try {
      const content = await sourceFileService.getFileBytes(sourceName!, path!);
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
      const responseBody = new Uint8Array(content).buffer;
      return new Response(responseBody, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(content.length),
        },
      });
    } catch (err) {
      return handleSourceError(c, err);
    }
  });

  // POST /:sourceName/files/:path - Create file (409 if exists)
  routes.post("/:sourceName/files/:path{.+}", async (c) => {
    const { sourceName, error: sourceError } = extractSourceName(c);
    if (sourceError) {
      return c.json({ error: sourceError }, 400);
    }

    const { path, error: pathError } = extractPath(c);
    if (pathError) {
      return c.json({ error: pathError }, 400);
    }

    try {
      // Check if file already exists
      if (await sourceFileService.fileExists(sourceName!, path!)) {
        return c.json({ error: "File already exists", path: path! }, 409);
      }

      // Parse content based on Content-Type
      const result = await parseFileContent(c, await getMaxFileSize());
      if (result.error) {
        return c.json({ error: result.error }, result.status || 400);
      }

      await sourceFileService.writeFileBytes(sourceName!, path!, result.content!);
      return c.json({ success: true, path: path!, created: true }, 201);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("escapes base directory")
      ) {
        return c.json({ error: "Path escapes base directory" }, 400);
      }
      return handleSourceError(c, err);
    }
  });

  // PUT /:sourceName/files/:path - Create or update file (upsert)
  routes.put("/:sourceName/files/:path{.+}", async (c) => {
    const { sourceName, error: sourceError } = extractSourceName(c);
    if (sourceError) {
      return c.json({ error: sourceError }, 400);
    }

    const { path, error: pathError } = extractPath(c);
    if (pathError) {
      return c.json({ error: pathError }, 400);
    }

    try {
      // Parse content based on Content-Type
      const result = await parseFileContent(c, await getMaxFileSize());
      if (result.error) {
        return c.json({ error: result.error }, result.status || 400);
      }

      const created = await sourceFileService.writeFileBytes(
        sourceName!,
        path!,
        result.content!
      );
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
      return handleSourceError(c, err);
    }
  });

  // DELETE /:sourceName/files/:path - Delete file
  routes.delete("/:sourceName/files/:path{.+}", async (c) => {
    const { sourceName, error: sourceError } = extractSourceName(c);
    if (sourceError) {
      return c.json({ error: sourceError }, 400);
    }

    const { path, error: pathError } = extractPath(c);
    if (pathError) {
      return c.json({ error: pathError }, 400);
    }

    try {
      if (!(await sourceFileService.fileExists(sourceName!, path!))) {
        return c.json({ error: "File not found" }, 404);
      }

      await sourceFileService.deleteFile(sourceName!, path!);
      return c.json({ success: true, path: path!, deleted: true }, 200);
    } catch (err) {
      return handleSourceError(c, err);
    }
  });

  return routes;
}

// ============================================================================
// Content Parsing Helpers
// ============================================================================

/**
 * Parse JSON body: { content: "...", encoding?: "base64" | "utf-8" }
 */
async function parseJsonBody(
  c: Context,
  maxSize: number
): Promise<ParseResult> {
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
    return {
      error: `Unsupported encoding: ${encoding}. Use "base64" or "utf-8"`,
    };
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
async function parseRawBody(
  c: Context,
  maxSize: number
): Promise<ParseResult> {
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
