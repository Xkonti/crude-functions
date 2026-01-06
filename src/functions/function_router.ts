import { Hono, type Context } from "@hono/hono";
import { RoutesService, type FunctionRoute } from "../routes/routes_service.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import { SecretScope } from "../secrets/types.ts";
import { HandlerLoader } from "./handler_loader.ts";
import { ApiKeyValidator } from "./api_key_validator.ts";
import type { FunctionContext, RouteInfo } from "./types.ts";
import {
  HandlerNotFoundError,
  HandlerExportError,
  HandlerSyntaxError,
  HandlerLoadError,
  HandlerExecutionError,
} from "./errors.ts";
import { runInRequestContext } from "../logs/request_context.ts";
import { runInEnvContext, createEnvContext } from "../env/env_context.ts";
import { originalConsole } from "../logs/stream_interceptor.ts";

export interface FunctionRouterOptions {
  routesService: RoutesService;
  apiKeyService: ApiKeyService;
  consoleLogService: ConsoleLogService;
  executionMetricsService: ExecutionMetricsService;
  secretsService: SecretsService;
  /** Base directory for code files (default: current working directory) */
  codeDirectory?: string;
}

export class FunctionRouter {
  private readonly routesService: RoutesService;
  private readonly apiKeyValidator: ApiKeyValidator;
  private readonly handlerLoader: HandlerLoader;
  private readonly consoleLogService: ConsoleLogService;
  private readonly executionMetricsService: ExecutionMetricsService;
  private readonly secretsService: SecretsService;
  private router: Hono = this.createEmptyRouter();

  constructor(options: FunctionRouterOptions) {
    this.routesService = options.routesService;
    this.apiKeyValidator = new ApiKeyValidator({ apiKeyService: options.apiKeyService });
    this.handlerLoader = new HandlerLoader({
      baseDirectory: options.codeDirectory ?? Deno.cwd(),
    });
    this.consoleLogService = options.consoleLogService;
    this.executionMetricsService = options.executionMetricsService;
    this.secretsService = options.secretsService;
  }

  async handle(c: Context): Promise<Response> {
    // Check if routes need rebuilding - handles all concurrency internally
    await this.routesService.rebuildIfNeeded((routes) => {
      this.router = this.buildRouter(routes);
    });

    // Delegate to internal router
    // Strip /run prefix before passing to internal router
    const path = c.req.path.replace(/^\/run/, "") || "/";
    const url = new URL(c.req.url);
    url.pathname = path;

    const newRequest = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    });

    return this.router.fetch(newRequest);
  }

  private createEmptyRouter(): Hono {
    const router = new Hono();
    router.all("*", (c) => c.json({ error: "Function not found" }, 404));
    return router;
  }

  private buildRouter(routes: FunctionRoute[]): Hono {
    const router = new Hono();

    for (const route of routes) {
      // Create actual handler for each route
      const handler = this.createHandler(route);

      // Register handler for each allowed method
      for (const method of route.methods) {
        const m = method.toLowerCase();
        if (m === "get") router.get(route.route, handler);
        else if (m === "post") router.post(route.route, handler);
        else if (m === "put") router.put(route.route, handler);
        else if (m === "delete") router.delete(route.route, handler);
        else if (m === "patch") router.patch(route.route, handler);
        else if (m === "head" || m === "options") {
          // Use .on() for less common methods
          router.on(method.toUpperCase(), route.route, handler);
        }
      }
    }

    // Catch-all for unmatched routes (404)
    router.all("*", (c) => c.json({ error: "Function not found" }, 404));

    return router;
  }

  private createHandler(route: FunctionRoute) {
    return async (c: Context): Promise<Response> => {
      const requestId = crypto.randomUUID();
      const method = c.req.method;
      const fullUrl = c.req.url;

      // 1. API Key Validation (if required)
      let authenticatedKeyGroup: string | undefined;
      let keyGroupId: number | undefined;
      let keyId: number | undefined;

      if (route.keys && route.keys.length > 0) {
        const validation = await this.apiKeyValidator.validate(c, route.keys);

        if (!validation.valid) {
          // Log rejected request
          this.consoleLogService.store({
            requestId,
            routeId: route.id,
            level: "exec_reject",
            message: `${method} ${fullUrl}`,
            args: JSON.stringify({ reason: "invalid_api_key" }),
          }).catch((error) => {
            globalThis.console.error("[FunctionRouter] Failed to store console log:", error);
          });

          return c.json(
            {
              error: "Unauthorized",
              message: validation.error,
              requestId,
            },
            401
          );
        }

        authenticatedKeyGroup = validation.keyGroup;
        keyGroupId = validation.keyGroupId;
        keyId = validation.keyId;
      }

      // 2. Build FunctionContext
      const routeInfo: RouteInfo = {
        name: route.name,
        description: route.description,
        handler: route.handler,
        route: route.route,
        methods: route.methods,
        keys: route.keys,
      };

      // Capture functionId for secret closures
      const functionId = route.id;

      const ctx: FunctionContext = {
        route: routeInfo,
        params: c.req.param() as Record<string, string>,
        query: this.parseQueryParams(c),
        authenticatedKeyGroup,
        requestedAt: new Date(),
        requestId,

        // Secret accessor closures with embedded IDs
        getSecret: async (
          name: string,
          scope?: "global" | "function" | "group" | "key"
        ): Promise<string | undefined> => {
          if (scope) {
            // Convert scope string to enum
            let scopeEnum: SecretScope;
            switch (scope) {
              case "global":
                scopeEnum = SecretScope.Global;
                break;
              case "function":
                scopeEnum = SecretScope.Function;
                break;
              case "group":
                scopeEnum = SecretScope.Group;
                break;
              case "key":
                scopeEnum = SecretScope.Key;
                break;
              default:
                throw new Error(`Invalid secret scope: ${scope}. Must be one of: global, function, group, key`);
            }

            return await this.secretsService.getSecretByNameAndScope(
              name,
              scopeEnum,
              functionId,
              keyGroupId,
              keyId
            );
          }

          // No scope specified - use hierarchical resolution
          return await this.secretsService.getSecretHierarchical(
            name,
            functionId,
            keyGroupId,
            keyId
          );
        },

        getCompleteSecret: async (name: string) => {
          return await this.secretsService.getCompleteSecret(
            name,
            functionId,
            keyGroupId,
            keyId
          );
        },
      };

      // 3. Execute Handler within request context (for console log capture)
      // Handler loading happens INSIDE the env context so module-level code
      // sees the isolated environment, not the real system environment.
      const requestContext = { requestId, routeId: route.id };

      // Prepare execution logging data
      const origin = c.req.header("origin") || c.req.header("referer") || "";
      const contentLength = c.req.header("content-length") || "0";
      const keyGroup = authenticatedKeyGroup || "";

      // Log execution start
      const startTime = performance.now();
      this.consoleLogService.store({
        requestId,
        routeId: route.id,
        level: "exec_start",
        message: `${method} ${fullUrl}`,
        args: JSON.stringify({ origin, keyGroup, contentLength }),
      }).catch((error) => {
        globalThis.console.error("[FunctionRouter] Failed to store console log:", error);
      });

      try {
        const response = await runInRequestContext(requestContext, async () => {
          // Create isolated env context - handler loading and execution both happen inside
          // This ensures module-level code in handlers sees isolated env (empty by default)
          const envContext = createEnvContext();
          return await runInEnvContext(envContext, async () => {
            // Load handler INSIDE the env context
            const handler = await this.handlerLoader.load(route.handler);
            return await handler(c, ctx);
          });
        });

        // Log execution end (success)
        const durationMs = Math.round(performance.now() - startTime);
        this.consoleLogService.store({
          requestId,
          routeId: route.id,
          level: "exec_end",
          message: `${durationMs}ms`,
        }).catch((error) => {
          globalThis.console.error("[FunctionRouter] Failed to store console log:", error);
        });

        // Store execution metric
        this.executionMetricsService.store({
          routeId: route.id,
          type: "execution",
          avgTimeMs: durationMs,
          maxTimeMs: durationMs,
          executionCount: 1,
        }).catch((error) => {
          globalThis.console.error("[FunctionRouter] Failed to store metric:", error);
        });

        return response;
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);

        // Check if this is a handler load error (not an execution error)
        if (
          error instanceof HandlerNotFoundError ||
          error instanceof HandlerExportError ||
          error instanceof HandlerSyntaxError ||
          error instanceof HandlerLoadError
        ) {
          // Log execution end (load error) - no metrics for load failures
          this.consoleLogService.store({
            requestId,
            routeId: route.id,
            level: "exec_end",
            message: `${durationMs}ms (load error)`,
          }).catch((logError) => {
            globalThis.console.error("[FunctionRouter] Failed to store console log:", logError);
          });

          return this.handleLoadError(c, error, requestId);
        }

        // Log execution end (execution error)
        this.consoleLogService.store({
          requestId,
          routeId: route.id,
          level: "exec_end",
          message: `${durationMs}ms (error)`,
        }).catch((logError) => {
          globalThis.console.error("[FunctionRouter] Failed to store console log:", logError);
        });

        // Store metric for failed executions
        this.executionMetricsService.store({
          routeId: route.id,
          type: "execution",
          avgTimeMs: durationMs,
          maxTimeMs: durationMs,
          executionCount: 1,
        }).catch((metricError) => {
          globalThis.console.error("[FunctionRouter] Failed to store metric:", metricError);
        });

        const executionError = new HandlerExecutionError(route.handler, error);
        return this.handleExecutionError(c, executionError, requestId);
      }
    };
  }

  private parseQueryParams(c: Context): Record<string, string> {
    const url = new URL(c.req.url);
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      query[key] = value;
    }
    return query;
  }

  private handleLoadError(
    c: Context,
    error: unknown,
    requestId: string
  ): Response {
    if (error instanceof HandlerNotFoundError) {
      return c.json(
        {
          error: "Handler not found",
          message: `Handler file does not exist: ${error.handlerPath}`,
          requestId,
        },
        404
      );
    }

    if (error instanceof HandlerExportError) {
      return c.json(
        {
          error: "Invalid handler",
          message: "Handler must export a default function",
          requestId,
        },
        500
      );
    }

    if (error instanceof HandlerSyntaxError) {
      return c.json(
        {
          error: "Handler syntax error",
          message: error.originalError.message,
          requestId,
        },
        500
      );
    }

    if (error instanceof HandlerLoadError) {
      originalConsole.error(`Handler load error [${requestId}]:`, error.originalError);
      return c.json(
        {
          error: "Handler load failed",
          message: "An error occurred while loading the handler",
          requestId,
        },
        500
      );
    }

    // Unknown error
    originalConsole.error(`Unknown handler error [${requestId}]:`, error);
    return c.json(
      {
        error: "Internal server error",
        requestId,
      },
      500
    );
  }

  private handleExecutionError(
    c: Context,
    error: HandlerExecutionError,
    requestId: string
  ): Response {
    originalConsole.error(
      `Handler execution error [${requestId}] in ${error.handlerPath}:`,
      error.originalError
    );

    // Include error message in development, hide in production
    const isDev = Deno.env.get("DENO_ENV") !== "production";
    const originalError = error.originalError;

    return c.json(
      {
        error: "Handler execution failed",
        message:
          isDev && originalError instanceof Error
            ? originalError.message
            : "An error occurred while executing the handler",
        requestId,
      },
      500
    );
  }
}
