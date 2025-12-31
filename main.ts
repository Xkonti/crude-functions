import { Hono } from "@hono/hono";
import "@std/dotenv/load";

const app = new Hono();

app.get("/ping", (c) => c.json({ pong: true }));

// Export app for testing
export { app };

// Start server only when run directly
if (import.meta.main) {
  const port = parseInt(Deno.env.get("PORT") || "8000");
  Deno.serve({ port }, app.fetch);
}
