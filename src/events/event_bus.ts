import { logger } from "../utils/logger.ts";
import type {
  Event,
  EventPayloads,
  EventSubscriber,
  EventType,
} from "./event_types.ts";

/**
 * Simple in-memory event bus for decoupled service communication.
 *
 * Features:
 * - Type-safe events with defined payloads
 * - Fire-and-forget publishing (doesn't block on subscribers)
 * - Multiple subscribers per event type
 * - Unsubscribe support
 *
 * @example
 * ```typescript
 * const eventBus = new EventBus();
 *
 * // Subscribe
 * const unsubscribe = eventBus.subscribe(EventType.JOB_ENQUEUED, (event) => {
 *   console.log("Job enqueued:", event.payload.jobId);
 * });
 *
 * // Publish
 * eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 123, type: "my-job" });
 *
 * // Cleanup
 * unsubscribe();
 * ```
 */
export class EventBus {
  private readonly subscribers = new Map<
    EventType,
    EventSubscriber<EventType>[]
  >();

  /**
   * Subscribe to events of a specific type.
   *
   * @param type - The event type to subscribe to
   * @param subscriber - Callback function invoked when event fires
   * @returns Unsubscribe function
   */
  subscribe<T extends EventType>(
    type: T,
    subscriber: EventSubscriber<T>,
  ): () => void {
    const subscribers = this.subscribers.get(type) ?? [];
    subscribers.push(subscriber as EventSubscriber<EventType>);
    this.subscribers.set(type, subscribers);

    return () => {
      const current = this.subscribers.get(type) ?? [];
      const index = current.indexOf(subscriber as EventSubscriber<EventType>);
      if (index !== -1) {
        current.splice(index, 1);
        if (current.length === 0) {
          this.subscribers.delete(type);
        }
      }
    };
  }

  /**
   * Publish an event to all subscribers.
   *
   * Fire-and-forget: doesn't wait for subscribers to complete.
   * Errors in subscribers are logged but don't affect other subscribers.
   *
   * @param type - The event type
   * @param payload - Event data
   */
  publish<T extends EventType>(type: T, payload: EventPayloads[T]): void {
    const event: Event<T> = {
      type,
      payload,
      timestamp: new Date(),
    };

    const subscribers = this.subscribers.get(type) ?? [];

    for (const subscriber of subscribers) {
      try {
        const result = subscriber(event as Event<EventType>);
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error(`[EventBus] Subscriber error for ${type}:`, error);
          });
        }
      } catch (error) {
        logger.error(`[EventBus] Subscriber error for ${type}:`, error);
      }
    }
  }

  /**
   * Get subscriber count for an event type (for testing/debugging).
   */
  getSubscriberCount(type: EventType): number {
    return this.subscribers.get(type)?.length ?? 0;
  }

  /**
   * Clear all subscribers (for testing).
   */
  clear(): void {
    this.subscribers.clear();
  }
}
