import { z } from "zod";

/**
 * File metadata returned in list endpoint
 */
export const FileMetadataSchema = z.object({
  path: z.string().openapi({
    example: "hello.ts",
    description: "File path relative to code directory",
  }),
  size: z.number().int().openapi({
    example: 1234,
    description: "File size in bytes",
  }),
  modifiedAt: z.string().datetime().openapi({
    example: "2026-01-10T12:34:56.789Z",
    description: "Last modification timestamp",
  }),
}).openapi("FileMetadata");

/**
 * Response schema for GET /api/files - List files
 */
export const GetFilesResponseSchema = z.object({
  files: z.array(FileMetadataSchema).openapi({
    description: "Array of files with metadata",
  }),
}).openapi("GetFilesResponse");

/**
 * Path parameter for file operations
 */
export const FilePathParamSchema = z.object({
  path: z.string().openapi({
    param: {
      name: "path",
      in: "path",
    },
    example: "hello.ts",
    description: "File path relative to code directory",
  }),
});

/**
 * JSON request body for creating/updating files
 */
export const FileJsonBodySchema = z.object({
  content: z.string().openapi({
    example: "export default async function(c, ctx) { return c.text('Hello'); }",
    description: "File content as string",
  }),
  encoding: z.enum(["base64", "utf-8", "text"]).default("utf-8").openapi({
    example: "utf-8",
    description: "Content encoding (base64 for binary, utf-8 for text)",
  }),
}).openapi("FileJsonBody");

/**
 * Response schema for GET /api/files/:path with Accept: application/json
 */
export const GetFileJsonResponseSchema = z.object({
  path: z.string().openapi({
    example: "hello.ts",
    description: "File path",
  }),
  content: z.string().openapi({
    example: "export default async function(c, ctx) { return c.text('Hello'); }",
    description: "File content (base64 for binary files, utf-8 for text)",
  }),
  contentType: z.string().openapi({
    example: "text/typescript",
    description: "MIME type of the file",
  }),
  size: z.number().int().openapi({
    example: 1234,
    description: "File size in bytes",
  }),
  encoding: z.enum(["base64", "utf-8"]).openapi({
    example: "utf-8",
    description: "Encoding used for content field",
  }),
}).openapi("GetFileJsonResponse");

/**
 * Response schema for POST /api/files/:path
 */
export const CreateFileResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
  path: z.string().openapi({
    example: "hello.ts",
    description: "Created file path",
  }),
  created: z.boolean().openapi({
    example: true,
    description: "Always true for POST",
  }),
}).openapi("CreateFileResponse");

/**
 * Response schema for PUT /api/files/:path
 */
export const UpsertFileResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
  path: z.string().openapi({
    example: "hello.ts",
    description: "File path",
  }),
  created: z.boolean().openapi({
    example: false,
    description: "True if file was created, false if updated",
  }),
}).openapi("UpsertFileResponse");

/**
 * Response schema for DELETE /api/files/:path
 */
export const DeleteFileResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
  path: z.string().openapi({
    example: "hello.ts",
    description: "Deleted file path",
  }),
  deleted: z.boolean().openapi({
    example: true,
  }),
}).openapi("DeleteFileResponse");

/**
 * Placeholder schema for binary/multipart content
 * Actual parsing is done manually in the route handler
 */
export const BinaryFileSchema = z.any().openapi({
  type: "string",
  format: "binary",
  description: "Raw binary file content",
});

export const MultipartFileSchema = z.object({
  file: BinaryFileSchema.openapi({
    description: "File upload field (can be named 'file' or 'content')",
  }),
}).openapi("MultipartFileUpload");
