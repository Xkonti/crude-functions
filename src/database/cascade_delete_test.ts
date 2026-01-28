/**
 * Integration tests for SurrealDB cascade delete behaviors.
 *
 * These tests verify that SurrealDB events properly cascade deletes
 * across related entities (functions, secrets, logs, metrics, API keys).
 *
 * Cascade delete events are defined in migrations/000-surreal-init.surql
 */

import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import { recordIdToString } from "./surreal_helpers.ts";

// ============== Function Deletion Cascade Tests ==============

integrationTest("Deleting function cascades to function-scoped secrets", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withSecrets()
    .build();

  try {
    // Setup: Create function and secret
    const route = await ctx.routesService.addRoute({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });
    const functionId = recordIdToString(route.id);

    const secretId = await ctx.secretsService.createFunctionSecret(
      functionId,
      "test-secret",
      "secret-value"
    );

    // Verify secret exists
    const secretBefore = await ctx.secretsService.getFunctionSecretById(
      functionId,
      recordIdToString(secretId)
    );
    expect(secretBefore).not.toBeNull();
    expect(secretBefore?.name).toBe("test-secret");

    // Action: Delete function
    await ctx.routesService.removeRouteById(functionId);

    // Verify: Secret no longer exists (cascade deleted)
    const secretAfter = await ctx.secretsService.getFunctionSecretById(
      functionId,
      recordIdToString(secretId)
    );
    expect(secretAfter).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Deleting function cascades to execution logs", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withLogs()
    .build();

  try {
    // Setup: Create function and logs
    const route = await ctx.routesService.addRoute({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });
    const functionId = recordIdToString(route.id);

    // Store logs for this function
    ctx.consoleLogService.store({
      requestId: "req-1",
      functionId: functionId,
      level: "exec_start",
      message: "Test execution",
    });
    await ctx.consoleLogService.flush(); // Ensure written

    // Verify logs exist
    const logsBefore = await ctx.consoleLogService.getByFunctionId(functionId);
    expect(logsBefore.length).toBeGreaterThan(0);

    // Action: Delete function
    await ctx.routesService.removeRouteById(functionId);

    // Verify: Logs no longer exist (cascade deleted)
    const logsAfter = await ctx.consoleLogService.getByFunctionId(functionId);
    expect(logsAfter.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Deleting function retains execution metrics", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withMetrics()
    .build();

  try {
    // Setup: Create function and metrics
    const route = await ctx.routesService.addRoute({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    // Store metrics for this function
    await ctx.executionMetricsService.store({
      functionId: route.id,
      type: "execution",
      avgTimeUs: 1000,
      maxTimeUs: 2000,
      executionCount: 1,
    });

    // Verify metrics exist
    const metricsBefore = await ctx.executionMetricsService.getByFunctionId(route.id);
    expect(metricsBefore.length).toBeGreaterThan(0);

    // Action: Delete function
    await ctx.routesService.removeRouteById(recordIdToString(route.id));

    // Verify: Metrics STILL exist (intentionally retained)
    const metricsAfter = await ctx.executionMetricsService.getByFunctionId(route.id);
    expect(metricsAfter.length).toBeGreaterThan(0);
    expect(metricsAfter.length).toBe(metricsBefore.length);
  } finally {
    await ctx.cleanup();
  }
});

// ============== API Key Deletion Cascade Tests ==============

integrationTest("Deleting API key group cascades to group-scoped secrets", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSecrets()
    .build();

  try {
    // Setup: Create group and secret
    const groupRecordId = await ctx.apiKeyService.createGroup("test-group", "Test");
    const groupId = recordIdToString(groupRecordId);

    const secretId = await ctx.secretsService.createGroupSecret(
      groupId,
      "test-secret",
      "secret-value"
    );

    // Verify secret exists
    const secretBefore = await ctx.secretsService.getGroupSecretById(
      groupId,
      recordIdToString(secretId)
    );
    expect(secretBefore).not.toBeNull();
    expect(secretBefore?.name).toBe("test-secret");

    // Action: Delete group
    await ctx.apiKeyService.deleteGroup(groupId);

    // Verify: Secret no longer exists (cascade deleted)
    const secretAfter = await ctx.secretsService.getGroupSecretById(
      groupId,
      recordIdToString(secretId)
    );
    expect(secretAfter).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Deleting API key cascades to key-scoped secrets", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSecrets()
    .build();

  try {
    // Setup: Create group, key, and secret
    const groupRecordId = await ctx.apiKeyService.createGroup("test-group", "Test");
    const groupId = recordIdToString(groupRecordId);

    const keyRecordId = await ctx.apiKeyService.addKeyToGroup(
      groupId,
      "test-key",
      "key-value-123",
      "Test key"
    );
    const keyId = recordIdToString(keyRecordId);

    const secretId = await ctx.secretsService.createKeySecret(
      keyId,
      "test-secret",
      "secret-value"
    );

    // Verify secret exists
    const secretBefore = await ctx.secretsService.getKeySecretById(
      keyId,
      recordIdToString(secretId)
    );
    expect(secretBefore).not.toBeNull();
    expect(secretBefore?.name).toBe("test-secret");

    // Action: Delete key
    await ctx.apiKeyService.removeKeyById(keyId);

    // Verify: Secret no longer exists (cascade deleted)
    const secretAfter = await ctx.secretsService.getKeySecretById(
      keyId,
      recordIdToString(secretId)
    );
    expect(secretAfter).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// ============== Cascade Scope Isolation Test ==============

integrationTest("Cascade deletes only affect correct scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withSecrets()
    .build();

  try {
    // Setup: Create 2 functions with secrets, plus global secret
    const route1 = await ctx.routesService.addRoute({
      name: "func1",
      handler: "func1.ts",
      routePath: "/func1",
      methods: ["GET"],
    });
    const func1Id = recordIdToString(route1.id);

    const route2 = await ctx.routesService.addRoute({
      name: "func2",
      handler: "func2.ts",
      routePath: "/func2",
      methods: ["GET"],
    });
    const func2Id = recordIdToString(route2.id);

    // Create secrets
    await ctx.secretsService.createFunctionSecret(func1Id, "func1-secret", "val1");
    await ctx.secretsService.createFunctionSecret(func2Id, "func2-secret", "val2");
    await ctx.secretsService.createGlobalSecret("global-secret", "global-val");

    // Verify all exist
    const func1SecretsBefore = await ctx.secretsService.getFunctionSecrets(func1Id);
    const func2SecretsBefore = await ctx.secretsService.getFunctionSecrets(func2Id);
    const globalSecretsBefore = await ctx.secretsService.getGlobalSecrets();

    expect(func1SecretsBefore.length).toBe(1);
    expect(func2SecretsBefore.length).toBe(1);
    expect(globalSecretsBefore.length).toBeGreaterThan(0);

    // Action: Delete func1
    await ctx.routesService.removeRouteById(func1Id);

    // Verify: Only func1 secrets deleted, others intact
    const func1SecretsAfter = await ctx.secretsService.getFunctionSecrets(func1Id);
    const func2SecretsAfter = await ctx.secretsService.getFunctionSecrets(func2Id);
    const globalSecretsAfter = await ctx.secretsService.getGlobalSecrets();

    expect(func1SecretsAfter.length).toBe(0); // Deleted
    expect(func2SecretsAfter.length).toBe(1); // Intact
    expect(globalSecretsAfter.length).toBeGreaterThan(0); // Intact

    // Verify func2 secret is the correct one
    expect(func2SecretsAfter[0].name).toBe("func2-secret");
  } finally {
    await ctx.cleanup();
  }
});
