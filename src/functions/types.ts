import type { Context } from "@hono/hono";

/**
 * CORS configuration for a function endpoint.
 * When present, CORS is automatically handled:
 * - OPTIONS preflight requests are intercepted and responded to
 * - CORS headers are added to all responses
 */
export interface CorsConfig {
  /** Allowed origins. Use ["*"] for any origin, or specific URLs like ["https://app.example.com"] */
  origins: string[];
  /** Allow credentials (cookies, auth headers). Requires specific origins, not "*" */
  credentials?: boolean;
  /** Preflight cache duration in seconds (default: 86400 = 24 hours) */
  maxAge?: number;
  /** Additional headers the client is allowed to send */
  allowHeaders?: string[];
  /** Headers the client is allowed to read from response */
  exposeHeaders?: string[];
}

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
  /** Required API key group IDs (if any) */
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

  /**
   * Get a secret value by name with hierarchical resolution
   * @param name - Secret name
   * @param scope - Optional explicit scope ('global' | 'function' | 'group' | 'key')
   * @returns Promise resolving to secret value or undefined if not found
   */
  getSecret(
    name: string,
    scope?: "global" | "function" | "group" | "key"
  ): Promise<string | undefined>;

  /**
   * Get complete secret information across all scopes
   * @param name - Secret name
   * @returns Promise resolving to object with values from all scopes, or undefined if not found
   */
  getCompleteSecret(
    name: string
  ): Promise<
    | {
        global?: string;
        function?: string;
        group?: { value: string; groupId: string; groupName: string };
        key?: {
          value: string;
          groupId: string;
          groupName: string;
          keyId: string;
          keyName: string;
        };
      }
    | undefined
  >;
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
