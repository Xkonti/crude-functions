/**
 * All known setting names as a const for type safety and autocomplete.
 * Setting names use dot notation to group related settings.
 */
export const SettingNames = {
  // Logging
  LOG_LEVEL: "log.level",
  LOG_TRIMMING_INTERVAL_SECONDS: "log.trimming.interval-seconds",
  LOG_TRIMMING_MAX_PER_FUNCTION: "log.trimming.max-per-function",

  // Metrics
  METRICS_AGGREGATION_INTERVAL_SECONDS: "metrics.aggregation-interval-seconds",
  METRICS_RETENTION_DAYS: "metrics.retention-days",

  // Encryption key rotation
  ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS: "encryption.key-rotation.check-interval-seconds",
  ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS: "encryption.key-rotation.interval-days",
  ENCRYPTION_KEY_ROTATION_BATCH_SIZE: "encryption.key-rotation.batch-size",
  ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS: "encryption.key-rotation.batch-sleep-ms",
} as const;

/**
 * Type representing any valid setting name.
 * Use this for type-safe setting access.
 */
export type SettingName = typeof SettingNames[keyof typeof SettingNames];

/**
 * Default values for all global settings.
 * These are inserted during bootstrap if the setting doesn't exist.
 */
export const GlobalSettingDefaults: Record<SettingName, string> = {
  [SettingNames.LOG_LEVEL]: "info",
  [SettingNames.LOG_TRIMMING_INTERVAL_SECONDS]: "300",
  [SettingNames.LOG_TRIMMING_MAX_PER_FUNCTION]: "2000",
  [SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS]: "60",
  [SettingNames.METRICS_RETENTION_DAYS]: "90",
  [SettingNames.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS]: "10800",
  [SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS]: "90",
  [SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SIZE]: "100",
  [SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS]: "100",
};
