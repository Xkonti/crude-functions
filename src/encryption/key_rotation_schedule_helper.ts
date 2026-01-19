import type { SchedulingService } from "../scheduling/scheduling_service.ts";
import type { KeyStorageService } from "./key_storage_service.ts";

/**
 * Recalculate key-rotation schedule's nextRunAt when rotation interval changes.
 *
 * Logic:
 * - newNextRunAt = lastRotation + newIntervalDays
 * - If newNextRunAt is in the past, schedule for 5 minutes from now
 *
 * @param schedulingService - The scheduling service instance
 * @param keyStorageService - The key storage service for loading encryption keys
 * @param newIntervalDays - The new rotation interval in days
 */
export async function recalculateKeyRotationSchedule(
  schedulingService: SchedulingService,
  keyStorageService: KeyStorageService,
  newIntervalDays: number
): Promise<void> {
  const keys = await keyStorageService.loadKeys();
  if (!keys) return;

  const lastRotation = new Date(keys.last_rotation_finished_at);
  const intervalMs = newIntervalDays * 24 * 60 * 60 * 1000;
  let nextRunAt = new Date(lastRotation.getTime() + intervalMs);

  // If calculated time is in the past, schedule for 5 minutes from now
  if (nextRunAt <= new Date()) {
    nextRunAt = new Date(Date.now() + 5 * 60 * 1000);
  }

  await schedulingService.updateSchedule("key-rotation", {
    nextRunAt,
  }, { nextRunAtBehavior: "explicit" });
}
