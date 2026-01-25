/**
 * Test helpers for integration tests using shared infrastructure.
 *
 * Tests using TestSetupBuilder create shared resources (SurrealDB process,
 * admin connections) that persist across tests for performance. Deno's test
 * sanitizer treats these as "leaks" because they weren't cleaned up within
 * each individual test.
 *
 * This module provides helpers that disable sanitizers for such tests.
 */

/**
 * Register an integration test that uses TestSetupBuilder.
 *
 * This is equivalent to Deno.test but with resource and op sanitizers
 * disabled to allow shared infrastructure (SurrealDB process, etc.).
 *
 * Supports all Deno.test signatures:
 * - `integrationTest("name", fn)`
 * - `integrationTest("name", async (t) => { t.step(...) })`
 * - `integrationTest({ name: "...", fn: ... })`
 *
 * Use this for tests that:
 * - Use TestSetupBuilder
 * - Create long-lived resources that are cleaned up on process exit
 * - Need to share infrastructure across test runs
 *
 * @example
 * ```typescript
 * import { integrationTest } from "@/test/test_helpers.ts";
 * import { TestSetupBuilder } from "@/test/test_setup_builder.ts";
 *
 * integrationTest("My test with shared infra", async () => {
 *   const ctx = await TestSetupBuilder.create().withSettings().build();
 *   try {
 *     // test logic
 *   } finally {
 *     await ctx.cleanup();
 *   }
 * });
 *
 * // With subtests
 * integrationTest("Group of tests", async (t) => {
 *   const ctx = await TestSetupBuilder.create().withSettings().build();
 *   try {
 *     await t.step("subtest 1", async () => { ... });
 *     await t.step("subtest 2", async () => { ... });
 *   } finally {
 *     await ctx.cleanup();
 *   }
 * });
 * ```
 */
export function integrationTest(
  nameOrOptions: string | Deno.TestDefinition,
  fn?: (t: Deno.TestContext) => Promise<void> | void
): void {
  if (typeof nameOrOptions === "string") {
    // Simple form: integrationTest("name", fn)
    Deno.test({
      name: nameOrOptions,
      fn: fn!,
      sanitizeResources: false,
      sanitizeOps: false,
    });
  } else {
    // Object form: integrationTest({ name: "...", fn: ... })
    Deno.test({
      ...nameOrOptions,
      sanitizeResources: false,
      sanitizeOps: false,
    });
  }
}

/**
 * Test options for integration tests using shared infrastructure.
 *
 * Alternative approach that returns Deno.TestDefinition options,
 * allowing more flexibility in test configuration.
 *
 * @example
 * ```typescript
 * import { integrationTestOptions } from "@/test/test_helpers.ts";
 *
 * Deno.test({
 *   ...integrationTestOptions("My test"),
 *   fn: async () => {
 *     // test logic
 *   },
 * });
 * ```
 */
export function integrationTestOptions(name: string): Omit<Deno.TestDefinition, "fn"> {
  return {
    name,
    sanitizeResources: false,
    sanitizeOps: false,
  };
}
