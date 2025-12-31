import { Hono, type Context } from "@hono/hono";
import { RoutesService, type FunctionRoute } from "../routes/routes_service.ts";

export interface FunctionRouterOptions {
  routesService: RoutesService;
}

export class FunctionRouter {
  private routesService: RoutesService;
  private router: Hono | null = null;

  constructor(options: FunctionRouterOptions) {
    this.routesService = options.routesService;
  }

  async handle(c: Context): Promise<Response> {
    // Check for route changes on every request
    // (loadIfChanged is already rate-limited by FileWatcher's 10s interval)
    const updatedRoutes = await this.routesService.loadIfChanged();

    if (updatedRoutes !== null || this.router === null) {
      // Routes changed or first request - rebuild router
      const routes = updatedRoutes ?? await this.routesService.getAll();
      this.router = this.buildRouter(routes);
    }

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

  private buildRouter(routes: FunctionRoute[]): Hono {
    const router = new Hono();

    for (const route of routes) {
      // Create placeholder handler for each route
      const handler = this.createPlaceholderHandler(route);

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

  private createPlaceholderHandler(route: FunctionRoute) {
    return async (c: Context) => {
      // Placeholder: echo route info for debugging
      return c.json({
        message: "Function execution not yet implemented",
        route: {
          name: route.name,
          handler: route.handler,
          path: route.route,
          methods: route.methods,
          keys: route.keys,
        },
        request: {
          method: c.req.method,
          path: c.req.path,
          params: c.req.param(),
        },
      });
    };
  }
}
