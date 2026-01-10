import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";
import {
  RoutesService,
  type NewFunctionRoute,
} from "./routes_service.ts";
import {
  GetFunctionsResponseSchema,
  FunctionIdParamSchema,
  GetFunctionResponseSchema,
  CreateFunctionRequestSchema,
  CreateFunctionResponseSchema,
  UpdateFunctionRequestSchema,
  UpdateFunctionResponseSchema,
  EnableFunctionResponseSchema,
  DisableFunctionResponseSchema,
} from "../routes_schemas/functions.ts";
import { ErrorResponseSchema } from "../schemas/responses.ts";

/**
 * GET /api/functions - List all functions
 */
const getFunctionsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Functions"],
  summary: "List functions",
  description: "Retrieve all function routes in the system.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetFunctionsResponseSchema,
        },
      },
      description: "Functions retrieved successfully",
    },
  },
});

/**
 * GET /api/functions/:id - Get function by ID
 */
const getFunctionRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Functions"],
  summary: "Get function",
  description: "Retrieve a specific function route by ID.",
  request: {
    params: FunctionIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetFunctionResponseSchema,
        },
      },
      description: "Function retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid function ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function not found",
    },
  },
});

/**
 * POST /api/functions - Create new function
 */
const createFunctionRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Functions"],
  summary: "Create function",
  description:
    "Create a new function route with handler, HTTP methods, and optional API key requirements.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateFunctionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: CreateFunctionResponseSchema,
        },
      },
      description: "Function created successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function with this name or route already exists",
    },
  },
});

/**
 * PUT /api/functions/:id - Update function
 */
const updateFunctionRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["Functions"],
  summary: "Update function",
  description: "Update an existing function route's configuration.",
  request: {
    params: FunctionIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateFunctionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UpdateFunctionResponseSchema,
        },
      },
      description: "Function updated successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function with this name or route already exists",
    },
  },
});

/**
 * DELETE /api/functions/:id - Delete function
 */
const deleteFunctionRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Functions"],
  summary: "Delete function",
  description: "Permanently delete a function route. This action cannot be undone.",
  request: {
    params: FunctionIdParamSchema,
  },
  responses: {
    204: {
      description: "Function deleted successfully (no content)",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid function ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function not found",
    },
  },
});

/**
 * PUT /api/functions/:id/enable - Enable function
 */
const enableFunctionRoute = createRoute({
  method: "put",
  path: "/{id}/enable",
  tags: ["Functions"],
  summary: "Enable function",
  description: "Enable a function route so it can receive requests. Idempotent operation.",
  request: {
    params: FunctionIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: EnableFunctionResponseSchema,
        },
      },
      description: "Function enabled successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid function ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function not found",
    },
  },
});

/**
 * PUT /api/functions/:id/disable - Disable function
 */
const disableFunctionRoute = createRoute({
  method: "put",
  path: "/{id}/disable",
  tags: ["Functions"],
  summary: "Disable function",
  description:
    "Disable a function route so it no longer receives requests. Idempotent operation.",
  request: {
    params: FunctionIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DisableFunctionResponseSchema,
        },
      },
      description: "Function disabled successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid function ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function not found",
    },
  },
});

export function createFunctionsRoutes(service: RoutesService): OpenAPIHono {
  const routes = createOpenAPIApp();

  // GET /api/functions - List all functions
  routes.openapi(getFunctionsRoute, async (c) => {
    const allFunctions = await service.getAll();
    // Map to API schema format (methods cast)
    const functions = allFunctions.map((f) => ({
      ...f,
      methods: f.methods as ("GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS")[],
    }));
    return c.json({ functions }, 200);
  });

  // GET /api/functions/:id - Get function by ID
  routes.openapi(getFunctionRoute, async (c) => {
    const { id } = c.req.valid("param");

    const func = await service.getById(id);
    if (!func) {
      return c.json({ error: `Function with id '${id}' not found` }, 404);
    }

    // Map to API schema format (methods cast)
    return c.json({
      function: {
        ...func,
        methods: func.methods as ("GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS")[],
      },
    }, 200);
  });

  // POST /api/functions - Create new function
  routes.openapi(createFunctionRoute, async (c) => {
    const body = c.req.valid("json");

    const newFunction: NewFunctionRoute = {
      name: body.name,
      handler: body.handler,
      route: body.route,
      methods: body.methods,
      description: body.description,
      keys: body.keys,
    };

    try {
      const created = await service.addRoute(newFunction);
      // Map to API schema format (methods cast)
      return c.json({
        function: {
          ...created,
          methods: created.methods as ("GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS")[],
        },
      }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // PUT /api/functions/:id - Update function
  routes.openapi(updateFunctionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updatedFunction: NewFunctionRoute = {
      name: body.name,
      handler: body.handler,
      route: body.route,
      methods: body.methods,
      description: body.description,
      keys: body.keys,
    };

    try {
      const updated = await service.updateRoute(id, updatedFunction);
      // Map to API schema format (methods cast)
      return c.json({
        function: {
          ...updated,
          methods: updated.methods as ("GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS")[],
        },
      }, 200);
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

  // DELETE /api/functions/:id - Delete function
  routes.openapi(deleteFunctionRoute, async (c) => {
    const { id } = c.req.valid("param");

    const existing = await service.getById(id);
    if (!existing) {
      return c.json({ error: `Function with id '${id}' not found` }, 404);
    }

    await service.removeRouteById(id);
    return c.body(null, 204);
  });

  // PUT /api/functions/:id/enable - Enable function
  routes.openapi(enableFunctionRoute, async (c) => {
    const { id } = c.req.valid("param");

    try {
      const updated = await service.setRouteEnabled(id, true);
      // Map to API schema format (methods cast)
      return c.json({
        function: {
          ...updated,
          methods: updated.methods as ("GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS")[],
        },
      }, 200);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  // PUT /api/functions/:id/disable - Disable function
  routes.openapi(disableFunctionRoute, async (c) => {
    const { id } = c.req.valid("param");

    try {
      const updated = await service.setRouteEnabled(id, false);
      // Map to API schema format (methods cast)
      return c.json({
        function: {
          ...updated,
          methods: updated.methods as ("GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS")[],
        },
      }, 200);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  return routes;
}
