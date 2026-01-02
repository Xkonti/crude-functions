import { Hono } from "@hono/hono";
import {
  RoutesService,
  validateRouteName,
  validateRoutePath,
  validateMethods,
  type FunctionRoute,
  type NewFunctionRoute,
} from "./routes_service.ts";
import { validateId } from "../utils/validation.ts";

export function createRoutesRoutes(service: RoutesService): Hono {
  const routes = new Hono();

  // GET /api/routes - List all routes
  routes.get("/", async (c) => {
    const allRoutes = await service.getAll();
    return c.json({ routes: allRoutes });
  });

  // GET /api/routes/:name - Get route by name
  routes.get("/:name", async (c) => {
    const name = c.req.param("name");
    const route = await service.getByName(name);

    if (!route) {
      return c.json({ error: `Route '${name}' not found` }, 404);
    }

    return c.json({ route });
  });

  // POST /api/routes - Add new route
  routes.post("/", async (c) => {
    let body: Partial<FunctionRoute>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name || !validateRouteName(body.name)) {
      return c.json({ error: "Invalid or missing name" }, 400);
    }
    if (!body.handler || body.handler.trim() === "") {
      return c.json({ error: "Invalid or missing handler" }, 400);
    }
    if (!body.route || !validateRoutePath(body.route)) {
      return c.json({ error: "Invalid or missing route path" }, 400);
    }
    if (!body.methods || !validateMethods(body.methods)) {
      return c.json({ error: "Invalid or missing methods" }, 400);
    }

    const newRoute: NewFunctionRoute = {
      name: body.name,
      handler: body.handler,
      route: body.route,
      methods: body.methods,
      description: body.description,
      keys: body.keys,
    };

    try {
      await service.addRoute(newRoute);
      return c.json({ success: true }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // PUT /api/routes/:id - Update route by ID
  routes.put("/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid route ID" }, 400);
    }

    let body: Partial<FunctionRoute>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name || !validateRouteName(body.name)) {
      return c.json({ error: "Invalid or missing name" }, 400);
    }
    if (!body.handler || body.handler.trim() === "") {
      return c.json({ error: "Invalid or missing handler" }, 400);
    }
    if (!body.route || !validateRoutePath(body.route)) {
      return c.json({ error: "Invalid or missing route path" }, 400);
    }
    if (!body.methods || !validateMethods(body.methods)) {
      return c.json({ error: "Invalid or missing methods" }, 400);
    }

    const updatedRoute: NewFunctionRoute = {
      name: body.name,
      handler: body.handler,
      route: body.route,
      methods: body.methods,
      description: body.description,
      keys: body.keys,
    };

    try {
      await service.updateRoute(id, updatedRoute);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          return c.json({ error: error.message }, 404);
        }
        if (error.message.includes("already exists")) {
          return c.json({ error: error.message }, 409);
        }
      }
      throw error;
    }
  });

  // DELETE /api/routes/:identifier - Delete route by name or ID
  routes.delete("/:identifier", async (c) => {
    const identifier = c.req.param("identifier");

    // Try parsing as ID first (with full validation)
    const id = validateId(identifier);

    if (id !== null) {
      // Delete by ID
      const existing = await service.getById(id);
      if (!existing) {
        return c.json({ error: `Route with id '${id}' not found` }, 404);
      }
      await service.removeRouteById(id);
    } else {
      // Delete by name (backwards compatibility)
      const existing = await service.getByName(identifier);
      if (!existing) {
        return c.json({ error: `Route '${identifier}' not found` }, 404);
      }
      await service.removeRoute(identifier);
    }

    return c.json({ success: true });
  });

  return routes;
}
