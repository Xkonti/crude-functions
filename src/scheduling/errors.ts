/**
 * Base error class for scheduling-related errors.
 */
export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingError";
  }
}

/**
 * Thrown when a schedule is not found by name.
 */
export class ScheduleNotFoundError extends SchedulingError {
  public readonly scheduleName: string;

  constructor(scheduleName: string) {
    super(`Schedule '${scheduleName}' not found`);
    this.name = "ScheduleNotFoundError";
    this.scheduleName = scheduleName;
  }
}

/**
 * Thrown when attempting to create a schedule that already exists.
 */
export class DuplicateScheduleError extends SchedulingError {
  public readonly scheduleName: string;

  constructor(scheduleName: string) {
    super(`Schedule '${scheduleName}' already exists`);
    this.name = "DuplicateScheduleError";
    this.scheduleName = scheduleName;
  }
}

/**
 * Thrown when schedule configuration is invalid.
 */
export class InvalidScheduleConfigError extends SchedulingError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleConfigError";
  }
}

/**
 * Thrown when attempting an operation on a schedule in an incompatible state.
 */
export class ScheduleStateError extends SchedulingError {
  public readonly scheduleName: string;
  public readonly currentStatus: string;

  constructor(scheduleName: string, currentStatus: string, operation: string) {
    super(
      `Cannot ${operation} schedule '${scheduleName}': current status is '${currentStatus}'`,
    );
    this.name = "ScheduleStateError";
    this.scheduleName = scheduleName;
    this.currentStatus = currentStatus;
  }
}
