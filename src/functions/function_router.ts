import { Hono, type Context } from "@hono/hono";
import { RoutesService, type FunctionRoute } from "../routes/routes_service.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
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

export interface FunctionRouterOptions {
  routesService: RoutesService;
  apiKeyService: ApiKeyService;
  /** Base directory for code files (default: current working directory) */
  codeDirectory?: string;
}

export class FunctionRouter {
  private readonly routesService: RoutesService;
  private readonly apiKeyValidator: ApiKeyValidator;
  private readonly handlerLoader: HandlerLoader;
  private router: Hono = this.createEmptyRouter();

  constructor(options: FunctionRouterOptions) {
    this.routesService = options.routesService;
    this.apiKeyValidator = new ApiKeyValidator({ apiKeyService: options.apiKeyService });
    this.handlerLoader = new HandlerLoader({
      baseDirectory: options.codeDirectory ?? Deno.cwd(),
    });
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

      // 1. API Key Validation (if required)
      let authenticatedKeyGroup: string | undefined;

      if (route.keys && route.keys.length > 0) {
        const validation = await this.apiKeyValidator.validate(c, route.keys);

        if (!validation.valid) {
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

      const ctx: FunctionContext = {
        route: routeInfo,
        params: c.req.param() as Record<string, string>,
        query: this.parseQueryParams(c),
        authenticatedKeyGroup,
        requestedAt: new Date(),
        requestId,
      };

      // 3. Load Handler
      let handler;
      try {
        handler = await this.handlerLoader.load(route.handler);
      } catch (error) {
        return this.handleLoadError(c, error, requestId);
      }

      // 4. Execute Handler
      try {
        return await handler(c, ctx);
      } catch (error) {
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
      console.error(`Handler load error [${requestId}]:`, error.originalError);
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
    console.error(`Unknown handler error [${requestId}]:`, error);
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
    console.error(
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
