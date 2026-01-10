import { z } from "zod";
import { IdSchema } from "../schemas/common.ts";

/**
 * HTTP methods enum
 */
export const HttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
]);

/**
 * Function route data returned from API
 */
export const FunctionRouteSchema = z.object({
  id: IdSchema,
  name: z.string().openapi({
    example: "hello-world",
    description: "Unique function name (alphanumeric, hyphens, underscores)",
  }),
  description: z.string().optional().openapi({
    example: "Returns a greeting message",
    description: "Optional description of what the function does",
  }),
  handler: z.string().openapi({
    example: "hello.ts",
    description: "Path to the handler file relative to code directory",
  }),
  route: z.string().openapi({
    example: "/hello",
    description: "HTTP route path that triggers this function",
  }),
  methods: z.array(HttpMethodSchema).openapi({
    example: ["GET", "POST"],
    description: "HTTP methods this function responds to",
  }),
  keys: z.array(z.number().int().positive()).optional().openapi({
    example: [1, 2],
    description: "API key group IDs required to access this function",
  }),
  enabled: z.boolean().openapi({
    example: true,
    description: "Whether this function is currently enabled",
  }),
}).openapi("FunctionRoute");

/**
 * Response schema for GET /api/functions - List all functions
 */
export const GetFunctionsResponseSchema = z.object({
  functions: z.array(FunctionRouteSchema).openapi({
    description: "Array of all function routes",
  }),
}).openapi("GetFunctionsResponse");

/**
 * Path parameter for function ID
 */
export const FunctionIdParamSchema = z.object({
  id: IdSchema.openapi({
    param: {
      name: "id",
      in: "path",
    },
    description: "Function ID",
  }),
});

/**
 * Response schema for GET /api/functions/:id
 */
export const GetFunctionResponseSchema = z.object({
  function: FunctionRouteSchema,
}).openapi("GetFunctionResponse");

/**
 * Request body for POST /api/functions - Create function
 */
export const CreateFunctionRequestSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/).openapi({
    example: "hello-world",
    description: "Unique function name (alphanumeric, hyphens, underscores)",
  }),
  description: z.string().optional().openapi({
    example: "Returns a greeting message",
    description: "Optional description of what the function does",
  }),
  handler: z.string().min(1).openapi({
    example: "hello.ts",
    description: "Path to the handler file relative to code directory",
  }),
  route: z.string().startsWith("/").openapi({
    example: "/hello",
    description: "HTTP route path (must start with /)",
  }).refine(
    (path) => path === "/" || !path.includes("//"),
    { message: "Route path cannot contain double slashes" }
  ),
  methods: z.array(HttpMethodSchema).min(1).openapi({
    example: ["GET", "POST"],
    description: "HTTP methods this function responds to (at least one required)",
  }),
  keys: z.array(z.number().int().positive()).optional().openapi({
    example: [1, 2],
    description: "Optional API key group IDs required to access this function",
  }),
}).openapi("CreateFunctionRequest");

/**
 * Response schema for POST /api/functions
 */
export const CreateFunctionResponseSchema = z.object({
  function: FunctionRouteSchema,
}).openapi("CreateFunctionResponse");

/**
 * Request body for PUT /api/functions/:id - Update function
 */
export const UpdateFunctionRequestSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/).openapi({
    example: "hello-world",
    description: "Unique function name (alphanumeric, hyphens, underscores)",
  }),
  description: z.string().optional().openapi({
    example: "Returns a greeting message",
    description: "Optional description of what the function does",
  }),
  handler: z.string().min(1).openapi({
    example: "hello.ts",
    description: "Path to the handler file relative to code directory",
  }),
  route: z.string().startsWith("/").openapi({
    example: "/hello",
    description: "HTTP route path (must start with /)",
  }).refine(
    (path) => path === "/" || !path.includes("//"),
    { message: "Route path cannot contain double slashes" }
  ),
  methods: z.array(HttpMethodSchema).min(1).openapi({
    example: ["GET", "POST"],
    description: "HTTP methods this function responds to (at least one required)",
  }),
  keys: z.array(z.number().int().positive()).optional().openapi({
    example: [1, 2],
    description: "Optional API key group IDs required to access this function",
  }),
}).openapi("UpdateFunctionRequest");

/**
 * Response schema for PUT /api/functions/:id
 */
export const UpdateFunctionResponseSchema = z.object({
  function: FunctionRouteSchema,
}).openapi("UpdateFunctionResponse");

/**
 * Response schema for PUT /api/functions/:id/enable
 */
export const EnableFunctionResponseSchema = z.object({
  function: FunctionRouteSchema,
}).openapi("EnableFunctionResponse");

/**
 * Response schema for PUT /api/functions/:id/disable
 */
export const DisableFunctionResponseSchema = z.object({
  function: FunctionRouteSchema,
}).openapi("DisableFunctionResponse");
