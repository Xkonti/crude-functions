import type { Context } from "@hono/hono";

/**
 * Metadata about the matched route
 */
export interface RouteInfo {
  /** Function name from route configuration */
  name: string;
  /** Optional description */
  description?: string;
  /** Path to the handler file (relative to project root) */
  handler: string;
  /** The route pattern (e.g., "/users/:id") */
  route: string;
  /** Allowed HTTP methods */
  methods: string[];
  /** Required API key names (if any) */
  keys?: string[];
}

/**
 * Context object passed to function handlers
 */
export interface FunctionContext {
  /** Route configuration that matched this request */
  route: RouteInfo;
  /** Extracted path parameters (e.g., { id: "123" }) */
  params: Record<string, string>;
  /** Query parameters as key-value pairs */
  query: Record<string, string>;
  /** The validated API key group that was used (if authentication required) */
  authenticatedKeyGroup?: string;
  /** Request timestamp */
  requestedAt: Date;
  /** Unique request ID for tracing */
  requestId: string;
}

/**
 * Handler function signature
 * Handlers receive Hono Context for full request/response control
 * plus FunctionContext for route metadata and convenience
 */
export type FunctionHandler = (
  c: Context,
  ctx: FunctionContext
) => Response | Promise<Response>;

/**
 * Expected structure of a handler module
 */
export interface HandlerModule {
  default: FunctionHandler;
}
