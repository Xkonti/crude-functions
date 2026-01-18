import type { InstanceIdServiceOptions } from "./types.ts";

/**
 * Service that generates and holds a unique instance identifier.
 *
 * The instance ID is a UUID v4 generated at construction time.
 * It uniquely identifies this process instance for the lifetime of the application.
 *
 * Primary use case: Job queue orphan detection. When a container crashes,
 * its jobs remain marked with its instance ID. A new container with a different
 * instance ID can detect these orphaned jobs and retry them.
 *
 * @example
 * ```typescript
 * const instanceIdService = new InstanceIdService();
 * console.log(instanceIdService.getId()); // "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export class InstanceIdService {
  private readonly instanceId: string;

  constructor(_options?: InstanceIdServiceOptions) {
    this.instanceId = crypto.randomUUID();
  }

  /**
   * Get the unique identifier for this process instance.
   * @returns UUID v4 string that remains constant for the lifetime of this service
   */
  getId(): string {
    return this.instanceId;
  }
}
