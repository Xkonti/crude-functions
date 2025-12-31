import { expect } from "@std/expect";
import { app } from "./main.ts";

Deno.test("GET /ping returns pong", async () => {
  const res = await app.request("/ping");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ pong: true });
});
