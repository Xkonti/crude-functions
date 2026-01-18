/**
 * Scheduling service module exports.
 *
 * @module scheduling
 */

// Main service
export { SchedulingService } from "./scheduling_service.ts";

// Stores (for advanced use cases)
export { PersistedScheduleStore } from "./persisted_schedule_store.ts";
export { InMemoryScheduleStore } from "./in_memory_schedule_store.ts";

// Types
export type {
  ScheduleType,
  TaskStatus,
  StorageMode,
  ScheduledTask,
  TaskExecutionResult,
  TaskHandler,
  TaskHandlerConfig,
  RegisterPersistedTaskOptions,
  RegisterInMemoryTaskOptions,
  UpdateTaskScheduleOptions,
  SchedulingServiceOptions,
  SchedulingServiceStatus,
  ScheduledTaskRow,
} from "./types.ts";

// Errors
export {
  SchedulingError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
  HandlerNotFoundError,
  HandlerAlreadyExistsError,
  InvalidTaskConfigError,
  TaskRunningError,
  ServiceStateError,
  TaskTimeoutError,
} from "./errors.ts";
