import type { RecordId } from "surrealdb";

/**
 * All event types in the application.
 * Add new event types here as needed.
 */
export const EventType = {
  /** Fired when a job is enqueued */
  JOB_ENQUEUED: "job.enqueued",
  /** Fired when a job completes (success, failure, or cancellation) */
  JOB_COMPLETED: "job.completed",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/**
 * Payload types for each event.
 * Maps EventType to the data structure passed to subscribers.
 */
export interface EventPayloads {
  [EventType.JOB_ENQUEUED]: {
    jobId: RecordId;
    type: string;
  };
  [EventType.JOB_COMPLETED]: {
    jobId: RecordId;
    type: string;
    status: "completed" | "failed" | "cancelled";
  };
}

/** Generic event structure */
export interface Event<T extends EventType = EventType> {
  type: T;
  payload: EventPayloads[T];
  timestamp: Date;
}

/** Subscriber callback type */
export type EventSubscriber<T extends EventType> = (
  event: Event<T>,
) => void | Promise<void>;
