import { expect } from "@std/expect";
import { RecordId } from "surrealdb";
import { EventBus } from "./event_bus.ts";
import { EventType } from "./event_types.ts";

Deno.test("EventBus.subscribe returns unsubscribe function", () => {
  const eventBus = new EventBus();

  const unsubscribe = eventBus.subscribe(EventType.JOB_ENQUEUED, () => {});

  expect(typeof unsubscribe).toBe("function");
  expect(eventBus.getSubscriberCount(EventType.JOB_ENQUEUED)).toBe(1);

  unsubscribe();
  expect(eventBus.getSubscriberCount(EventType.JOB_ENQUEUED)).toBe(0);
});

Deno.test("EventBus.subscribe allows multiple subscribers for same event type", () => {
  const eventBus = new EventBus();

  eventBus.subscribe(EventType.JOB_ENQUEUED, () => {});
  eventBus.subscribe(EventType.JOB_ENQUEUED, () => {});
  eventBus.subscribe(EventType.JOB_ENQUEUED, () => {});

  expect(eventBus.getSubscriberCount(EventType.JOB_ENQUEUED)).toBe(3);
});

Deno.test("EventBus.publish notifies all subscribers", () => {
  const eventBus = new EventBus();
  const received: number[] = [];

  eventBus.subscribe(EventType.JOB_ENQUEUED, (event) => {
    received.push(event.payload.jobId);
  });
  eventBus.subscribe(EventType.JOB_ENQUEUED, (event) => {
    received.push(event.payload.jobId * 10);
  });

  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 5, type: "test" });

  expect(received).toEqual([5, 50]);
});

Deno.test("EventBus.publish includes timestamp in event", () => {
  const eventBus = new EventBus();
  let receivedTimestamp: Date | null = null;

  eventBus.subscribe(EventType.JOB_ENQUEUED, (event) => {
    receivedTimestamp = event.timestamp;
  });

  const before = new Date();
  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 1, type: "test" });
  const after = new Date();

  expect(receivedTimestamp).not.toBeNull();
  expect(receivedTimestamp!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  expect(receivedTimestamp!.getTime()).toBeLessThanOrEqual(after.getTime());
});

Deno.test("EventBus.publish does nothing when no subscribers", () => {
  const eventBus = new EventBus();

  // Should not throw
  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 1, type: "test" });
});

Deno.test("EventBus.publish continues notifying after sync subscriber error", () => {
  const eventBus = new EventBus();
  const received: number[] = [];

  eventBus.subscribe(EventType.JOB_ENQUEUED, () => {
    throw new Error("Subscriber error");
  });
  eventBus.subscribe(EventType.JOB_ENQUEUED, (event) => {
    received.push(event.payload.jobId);
  });

  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 42, type: "test" });

  expect(received).toEqual([42]);
});

Deno.test("EventBus.publish handles async subscribers", async () => {
  const eventBus = new EventBus();
  let called = false;

  eventBus.subscribe(EventType.JOB_ENQUEUED, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    called = true;
  });

  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 1, type: "test" });

  // Publish is fire-and-forget, so subscriber runs async
  expect(called).toBe(false);

  // Wait for async subscriber to complete
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(called).toBe(true);
});

Deno.test("EventBus.publish continues after async subscriber rejection", async () => {
  const eventBus = new EventBus();
  const received: number[] = [];

  eventBus.subscribe(EventType.JOB_ENQUEUED, () => {
    return Promise.reject(new Error("Async error"));
  });
  eventBus.subscribe(EventType.JOB_ENQUEUED, (event) => {
    received.push(event.payload.jobId);
  });

  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 99, type: "test" });

  // Sync subscriber should have been called immediately
  expect(received).toEqual([99]);

  // Wait for async error to be caught and logged (not thrown)
  await new Promise((resolve) => setTimeout(resolve, 10));
});

Deno.test("EventBus.unsubscribe only removes the specific subscriber", () => {
  const eventBus = new EventBus();
  const received: string[] = [];

  const unsub1 = eventBus.subscribe(EventType.JOB_ENQUEUED, () => {
    received.push("first");
  });
  eventBus.subscribe(EventType.JOB_ENQUEUED, () => {
    received.push("second");
  });

  unsub1();

  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 1, type: "test" });

  expect(received).toEqual(["second"]);
});

Deno.test("EventBus.clear removes all subscribers", () => {
  const eventBus = new EventBus();

  eventBus.subscribe(EventType.JOB_ENQUEUED, () => {});
  eventBus.subscribe(EventType.JOB_COMPLETED, () => {});

  eventBus.clear();

  expect(eventBus.getSubscriberCount(EventType.JOB_ENQUEUED)).toBe(0);
  expect(eventBus.getSubscriberCount(EventType.JOB_COMPLETED)).toBe(0);
});

Deno.test("EventBus subscribers receive correct event type", () => {
  const eventBus = new EventBus();
  const enqueuedEvents: string[] = [];
  const completedEvents: string[] = [];

  eventBus.subscribe(EventType.JOB_ENQUEUED, (event) => {
    enqueuedEvents.push(event.type);
  });
  eventBus.subscribe(EventType.JOB_COMPLETED, (event) => {
    completedEvents.push(event.type);
  });

  eventBus.publish(EventType.JOB_ENQUEUED, { jobId: 1, type: "test" });
  eventBus.publish(EventType.JOB_COMPLETED, { jobId: 2, type: "test", status: "completed" });

  expect(enqueuedEvents).toEqual(["job.enqueued"]);
  expect(completedEvents).toEqual(["job.completed"]);
});

Deno.test("EventBus.getSubscriberCount returns 0 for unknown event types", () => {
  const eventBus = new EventBus();

  expect(eventBus.getSubscriberCount(EventType.JOB_ENQUEUED)).toBe(0);
});
