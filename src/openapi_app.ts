import { OpenAPIHono } from "@hono/zod-openapi";

/**
 * Creates an OpenAPIHono instance with a custom validation error handler.
 * Converts Zod validation errors from detailed format into simple { error: "message" } format.
 *
 * Example error output:
 * - Single error: { error: "functionId: Expected number, received nan" }
 * - Multiple errors: { error: "name: Required, email: Invalid email" }
 */
export function createOpenAPIApp(): OpenAPIHono {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: result.error.issues
              .map((issue) => {
                const path = issue.path.join(".");
                return path ? `${path}: ${issue.message}` : issue.message;
              })
              .join(", "),
          },
          400
        );
      }
    },
  });
}
