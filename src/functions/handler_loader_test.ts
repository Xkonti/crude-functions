import { assertEquals, assertRejects } from "@std/assert";
import { HandlerLoader } from "./handler_loader.ts";
import { HandlerError } from "./errors.ts";

Deno.test("HandlerLoader - Path Traversal Prevention", async (t) => {
  const testBase = await Deno.makeTempDir();

  try {
    const loader = new HandlerLoader({ baseDirectory: testBase });

    await t.step("rejects simple .. traversal", async () => {
      await assertRejects(
        () => loader.load("../etc/passwd"),
        HandlerError,
        "escapes base directory"
      );
    });

    await t.step("rejects nested .. traversal", async () => {
      await assertRejects(
        () => loader.load("code/../../../etc/passwd"),
        HandlerError,
        "escapes base directory"
      );
    });

    await t.step("rejects symlink escape attempts", async () => {
      // Create a directory structure with a symlink pointing outside
      const codeDir = `${testBase}/code`;
      await Deno.mkdir(codeDir);

      // Create symlink pointing outside base directory
      const symlinkPath = `${codeDir}/evil`;
      await Deno.symlink("/etc", symlinkPath);

      // Try to access through symlink - should be rejected
      await assertRejects(
        () => loader.load("code/evil/passwd"),
        HandlerError,
        "escapes base directory"
      );
    });

    await t.step("allows valid relative paths within base", async () => {
      const codeDir = `${testBase}/code`;
      await Deno.mkdir(codeDir, { recursive: true });
      const handlerPath = `${codeDir}/test.ts`;

      // Create a valid handler file
      await Deno.writeTextFile(
        handlerPath,
        "export default async (c) => c.text('ok')"
      );

      // This should not throw a path traversal error
      // (it may fail for other reasons like syntax, but not path security)
      try {
        await loader.load("code/test.ts");
        // If it loads successfully, that's fine
      } catch (e) {
        // Verify it's NOT a path traversal error
        const error = e as HandlerError;
        assertEquals(
          error.message.includes("escapes"),
          false,
          "Valid path should not trigger path traversal protection"
        );
      }
    });
  } finally {
    // Cleanup
    await Deno.remove(testBase, { recursive: true });
  }
});
