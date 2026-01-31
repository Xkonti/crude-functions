import { assertEquals } from "@std/assert";
import { ErrorStateService } from "./error_state_service.ts";

Deno.test("ErrorStateService", async (t) => {
  await t.step("starts with no errors", () => {
    const service = new ErrorStateService();

    assertEquals(service.hasErrors(), false);
    assertEquals(service.getMigrationError(), null);
  });

  await t.step("setMigrationError stores the error", () => {
    const service = new ErrorStateService();

    service.setMigrationError({
      version: 5,
      filename: "005-add-metrics.surql",
      message: "Parse error at line 12",
    });

    assertEquals(service.hasErrors(), true);
    assertEquals(service.getMigrationError(), {
      version: 5,
      filename: "005-add-metrics.surql",
      message: "Parse error at line 12",
    });
  });

  await t.step("clearMigrationError removes the error", () => {
    const service = new ErrorStateService();

    service.setMigrationError({
      version: 5,
      filename: "005-add-metrics.surql",
      message: "Parse error at line 12",
    });
    service.clearMigrationError();

    assertEquals(service.hasErrors(), false);
    assertEquals(service.getMigrationError(), null);
  });

  await t.step("subsequent setMigrationError calls replace the error", () => {
    const service = new ErrorStateService();

    service.setMigrationError({
      version: 5,
      filename: "005-add-metrics.surql",
      message: "First error",
    });

    service.setMigrationError({
      version: 6,
      filename: "006-new-feature.surql",
      message: "Second error",
    });

    assertEquals(service.getMigrationError()?.version, 6);
    assertEquals(service.getMigrationError()?.filename, "006-new-feature.surql");
  });
});
