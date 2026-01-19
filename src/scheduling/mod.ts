/**
 * Scheduling Module
 *
 * Provides time-based job scheduling capabilities for Crude Functions:
 * - One-off schedules at specific times
 * - Dynamic recurring schedules with handler-determined intervals
 * - Fixed interval schedules (sequential or concurrent)
 * - Transient vs persistent schedules
 *
 * The SchedulingService manages WHEN to execute tasks while delegating
 * actual execution to the existing JobQueueService and JobProcessorService.
 *
 * @example
 * ```typescript
 * import { SchedulingService } from "./scheduling/mod.ts";
 *
 * const schedulingService = new SchedulingService({
 *   db,
 *   jobQueueService,
 * });
 *
 * // Create a one-off schedule
 * await schedulingService.registerSchedule({
 *   name: "send-report",
 *   type: "one_off",
 *   nextRunAt: new Date("2024-12-25T09:00:00Z"),
 *   jobType: "send-email",
 *   jobPayload: { to: "admin@example.com" },
 * });
 *
 * // Create a recurring schedule
 * await schedulingService.registerSchedule({
 *   name: "cleanup-logs",
 *   type: "sequential_interval",
 *   intervalMs: 60 * 60 * 1000, // 1 hour
 *   jobType: "log-cleanup",
 * });
 *
 * schedulingService.start();
 * ```
 */

// Service
export { SchedulingService } from "./scheduling_service.ts";

// Errors
export {
  SchedulingError,
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidScheduleConfigError,
  ScheduleStateError,
} from "./errors.ts";

// Types
export type {
  Schedule,
  NewSchedule,
  ScheduleType,
  ScheduleStatus,
  CancelScheduleOptions,
  DynamicScheduleResult,
  SchedulingServiceConfig,
  SchedulingServiceOptions,
  ScheduleRow,
} from "./types.ts";
