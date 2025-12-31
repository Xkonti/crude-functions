import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { createManagementAuthMiddleware } from "./management_auth.ts";

async function createTestApp(initialContent = "", envKey = "env-mgmt-key") {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;
  await Deno.writeTextFile(configPath, initialContent);

  const service = new ApiKeyService({
    configPath,
    managementKeyFromEnv: envKey,
  });

  const app = new Hono();
  app.use("/*", createManagementAuthMiddleware(service));
  app.get("/protected", (c) => c.json({ message: "success" }));

  return { app, tempDir, service };
}

async function cleanup(tempDir: string) {
  await Deno.remove(tempDir, { recursive: true });
}

Deno.test("returns 401 when no X-API-Key header provided", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/protected");
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("returns 401 when invalid API key provided", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "invalid-key" },
    });
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("allows request with valid env management key", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "env-mgmt-key" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.message).toBe("success");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("allows request with valid file-based management key", async () => {
  const { app, tempDir } = await createTestApp("management=file-key");

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "file-key" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.message).toBe("success");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("rejects non-management keys", async () => {
  const { app, tempDir } = await createTestApp("email=some-key");

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "some-key" },
    });
    expect(res.status).toBe(401);
  } finally {
    await cleanup(tempDir);
  }
});
