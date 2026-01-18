/**
 * Error classes for the scheduling service.
 */

/**
 * Base class for all scheduling-related errors.
 */
export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingError";
  }
}

/**
 * Thrown when a task with the given name already exists.
 */
export class TaskAlreadyExistsError extends SchedulingError {
  constructor(public readonly taskName: string) {
    super(`Task "${taskName}" already exists`);
    this.name = "TaskAlreadyExistsError";
  }
}

/**
 * Thrown when a task with the given name is not found.
 */
export class TaskNotFoundError extends SchedulingError {
  constructor(public readonly taskName: string) {
    super(`Task "${taskName}" not found`);
    this.name = "TaskNotFoundError";
  }
}

/**
 * Thrown when no handler is registered for a task type.
 */
export class HandlerNotFoundError extends SchedulingError {
  constructor(public readonly taskType: string) {
    super(`No handler registered for task type "${taskType}"`);
    this.name = "HandlerNotFoundError";
  }
}

/**
 * Thrown when a handler for the given type already exists.
 */
export class HandlerAlreadyExistsError extends SchedulingError {
  constructor(public readonly taskType: string) {
    super(`Handler for task type "${taskType}" already exists`);
    this.name = "HandlerAlreadyExistsError";
  }
}

/**
 * Thrown when task configuration is invalid.
 */
export class InvalidTaskConfigError extends SchedulingError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskConfigError";
  }
}

/**
 * Thrown when attempting to operate on a task that is currently running.
 */
export class TaskRunningError extends SchedulingError {
  constructor(public readonly taskName: string) {
    super(`Task "${taskName}" is currently running`);
    this.name = "TaskRunningError";
  }
}

/**
 * Thrown when the scheduling service is not in the expected state.
 */
export class ServiceStateError extends SchedulingError {
  constructor(message: string) {
    super(message);
    this.name = "ServiceStateError";
  }
}

/**
 * Thrown when task execution times out.
 */
export class TaskTimeoutError extends SchedulingError {
  constructor(
    public readonly taskName: string,
    public readonly timeoutMs: number,
  ) {
    super(`Task "${taskName}" timed out after ${timeoutMs}ms`);
    this.name = "TaskTimeoutError";
  }
}
