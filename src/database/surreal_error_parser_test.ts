import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  parseSurrealError,
  extractTaggedValue,
  type IndexViolation,
  type EventError,
  type UnknownError,
} from "./surreal_error_parser.ts";

describe("parseSurrealError", () => {
  describe("index violations", () => {
    it("parses unique name index violation", () => {
      const error = new Error(
        "Database index `unique_functionDef_name` already contains 'hello', with record `functionDef:abc123xyz`"
      );

      const result = parseSurrealError(error);

      expect(result.type).toBe("index_violation");
      const violation = result as IndexViolation;
      expect(violation.indexName).toBe("unique_functionDef_name");
      expect(violation.conflictingValue).toBe("'hello'");
      expect(violation.existingRecordId).toBe("functionDef:abc123xyz");
    });

    it("parses composite index violation with array value", () => {
      const error = new Error(
        "Database index `idx_functionDef_route_methods` already contains ['/users', {'GET',}], with record `functionDef:1yu3kwt0wz2uhcmbqfpp`"
      );

      const result = parseSurrealError(error);

      expect(result.type).toBe("index_violation");
      const violation = result as IndexViolation;
      expect(violation.indexName).toBe("idx_functionDef_route_methods");
      expect(violation.conflictingValue).toBe("['/users', {'GET',}]");
      expect(violation.existingRecordId).toBe(
        "functionDef:1yu3kwt0wz2uhcmbqfpp"
      );
    });

    it("handles string error input", () => {
      const error =
        "Database index `unique_functionDef_name` already contains 'test', with record `functionDef:xyz`";

      const result = parseSurrealError(error);

      expect(result.type).toBe("index_violation");
      const violation = result as IndexViolation;
      expect(violation.indexName).toBe("unique_functionDef_name");
    });
  });

  describe("event errors", () => {
    it("parses event error without tags", () => {
      const error = new Error(
        "Error while processing event check_route_method_overlap: An error occurred: Route collision detected"
      );

      const result = parseSurrealError(error);

      expect(result.type).toBe("event_error");
      const eventError = result as EventError;
      expect(eventError.eventName).toBe("check_route_method_overlap");
      expect(eventError.code).toBeNull();
      expect(eventError.rawMessage).toBe("Route collision detected");
    });

    it("parses event error with CODE tag", () => {
      const error = new Error(
        "Error while processing event check_route_method_overlap: An error occurred: [CODE] ROUTE_METHOD_COLLISION [CODE] Route collision detected"
      );

      const result = parseSurrealError(error);

      expect(result.type).toBe("event_error");
      const eventError = result as EventError;
      expect(eventError.code).toBe("ROUTE_METHOD_COLLISION");
    });

    it("parses event error with multiple tagged fields", () => {
      const error = new Error(
        "Error while processing event check_route_method_overlap: An error occurred: [CODE] ROUTE_METHOD_COLLISION [CODE] Route collision on [ROUTE] /users [ROUTE] for methods [METHODS] {'GET',} [METHODS] already defined by function [FUNCTION] hello [FUNCTION]"
      );

      const result = parseSurrealError(error);

      expect(result.type).toBe("event_error");
      const eventError = result as EventError;
      expect(eventError.code).toBe("ROUTE_METHOD_COLLISION");
      expect(eventError.fields.ROUTE).toBe("/users");
      expect(eventError.fields.METHODS).toBe("{'GET',}");
      expect(eventError.fields.FUNCTION).toBe("hello");
    });

    it("does not include CODE in fields", () => {
      const error = new Error(
        "Error while processing event test_event: An error occurred: [CODE] TEST_CODE [CODE] [FIELD] value [FIELD]"
      );

      const result = parseSurrealError(error);

      expect(result.type).toBe("event_error");
      const eventError = result as EventError;
      expect(eventError.code).toBe("TEST_CODE");
      expect(eventError.fields.CODE).toBeUndefined();
      expect(eventError.fields.FIELD).toBe("value");
    });
  });

  describe("unknown errors", () => {
    it("returns unknown for unrecognized format", () => {
      const error = new Error("Something went wrong");

      const result = parseSurrealError(error);

      expect(result.type).toBe("unknown");
      expect((result as UnknownError).message).toBe("Something went wrong");
    });

    it("handles non-Error objects", () => {
      const error = { message: "Custom error object" };

      const result = parseSurrealError(error);

      expect(result.type).toBe("unknown");
      expect((result as UnknownError).message).toBe("Custom error object");
    });

    it("handles primitive values", () => {
      const result = parseSurrealError(42);

      expect(result.type).toBe("unknown");
      expect((result as UnknownError).message).toBe("42");
    });
  });
});

describe("extractTaggedValue", () => {
  it("extracts value from tagged content", () => {
    const message = "[CODE] ERROR_123 [CODE] Something happened";

    const result = extractTaggedValue(message, "CODE");

    expect(result).toBe("ERROR_123");
  });

  it("extracts value with spaces", () => {
    const message = "[ROUTE] /users/:id [ROUTE]";

    const result = extractTaggedValue(message, "ROUTE");

    expect(result).toBe("/users/:id");
  });

  it("returns null when tag not found", () => {
    const message = "No tags here";

    const result = extractTaggedValue(message, "CODE");

    expect(result).toBeNull();
  });

  it("extracts first occurrence when multiple exist", () => {
    const message = "[CODE] FIRST [CODE] and [CODE] SECOND [CODE]";

    const result = extractTaggedValue(message, "CODE");

    expect(result).toBe("FIRST");
  });

  it("trims whitespace from extracted value", () => {
    const message = "[CODE]   TRIMMED   [CODE]";

    const result = extractTaggedValue(message, "CODE");

    expect(result).toBe("TRIMMED");
  });
});
