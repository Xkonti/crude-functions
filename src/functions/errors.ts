/**
 * Base error class for handler-related errors
 */
export class HandlerError extends Error {
  constructor(
    message: string,
    public readonly handlerPath: string
  ) {
    super(message);
    this.name = "HandlerError";
  }
}

/**
 * Thrown when the handler file does not exist
 */
export class HandlerNotFoundError extends HandlerError {
  constructor(handlerPath: string) {
    super(`Handler file not found: ${handlerPath}`, handlerPath);
    this.name = "HandlerNotFoundError";
  }
}

/**
 * Thrown when the handler file doesn't have a valid default export function
 */
export class HandlerExportError extends HandlerError {
  constructor(handlerPath: string) {
    super(
      `Handler must have a default export that is a function: ${handlerPath}`,
      handlerPath
    );
    this.name = "HandlerExportError";
  }
}

/**
 * Thrown when there's a syntax error in the handler file
 */
export class HandlerSyntaxError extends HandlerError {
  public readonly originalError: SyntaxError;

  constructor(handlerPath: string, originalError: SyntaxError) {
    super(`Syntax error in handler: ${handlerPath}`, handlerPath);
    this.name = "HandlerSyntaxError";
    this.originalError = originalError;
  }
}

/**
 * Thrown when the handler file fails to load for reasons other than syntax errors
 */
export class HandlerLoadError extends HandlerError {
  public readonly originalError: unknown;

  constructor(handlerPath: string, originalError: unknown) {
    super(`Failed to load handler: ${handlerPath}`, handlerPath);
    this.name = "HandlerLoadError";
    this.originalError = originalError;
  }
}

/**
 * Thrown when the handler function throws an error during execution
 */
export class HandlerExecutionError extends HandlerError {
  public readonly originalError: unknown;

  constructor(handlerPath: string, originalError: unknown) {
    super(`Handler execution failed: ${handlerPath}`, handlerPath);
    this.name = "HandlerExecutionError";
    this.originalError = originalError;
  }
}
