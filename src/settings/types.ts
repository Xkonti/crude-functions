/**
 * All known setting names as a const for type safety and autocomplete.
 * Setting names use dot notation to group related settings.
 */
export const SettingNames = {
  // Logging
  LOG_LEVEL: "log.level",
  LOG_TRIMMING_INTERVAL_SECONDS: "log.trimming.interval-seconds",
  LOG_TRIMMING_MAX_PER_FUNCTION: "log.trimming.max-per-function",
  LOG_TRIMMING_RETENTION_SECONDS: "log.trimming.retention-seconds",
  LOG_BATCHING_MAX_BATCH_SIZE: "log.batching.max-batch-size",
  LOG_BATCHING_MAX_DELAY_MS: "log.batching.max-delay-ms",

  // Metrics
  METRICS_AGGREGATION_INTERVAL_SECONDS: "metrics.aggregation-interval-seconds",
  METRICS_RETENTION_DAYS: "metrics.retention-days",

  // Encryption key rotation
  ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS: "encryption.key-rotation.check-interval-seconds",
  ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS: "encryption.key-rotation.interval-days",
  ENCRYPTION_KEY_ROTATION_BATCH_SIZE: "encryption.key-rotation.batch-size",
  ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS: "encryption.key-rotation.batch-sleep-ms",

  // Security
  API_ACCESS_GROUPS: "api.access-groups",

  // Files
  FILES_MAX_SIZE_BYTES: "files.max-size-bytes",

  // Jobs
  JOB_PROCESSOR_POLLING_INTERVAL_SECONDS: "job.processor.polling-interval-seconds",

  // General
  SERVER_NAME: "server.name",
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
  [SettingNames.LOG_TRIMMING_RETENTION_SECONDS]: "7776000", // 90 days
  [SettingNames.LOG_BATCHING_MAX_BATCH_SIZE]: "50",
  [SettingNames.LOG_BATCHING_MAX_DELAY_MS]: "50",
  [SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS]: "60",
  [SettingNames.METRICS_RETENTION_DAYS]: "90",
  [SettingNames.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS]: "10800",
  [SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS]: "90",
  [SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SIZE]: "100",
  [SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS]: "100",
  [SettingNames.API_ACCESS_GROUPS]: "",
  [SettingNames.FILES_MAX_SIZE_BYTES]: "52428800", // 50 MB
  [SettingNames.JOB_PROCESSOR_POLLING_INTERVAL_SECONDS]: "5",
  [SettingNames.SERVER_NAME]: "Crude Functions",
};

/**
 * Metadata for a setting, used for UI rendering and validation.
 */
export interface SettingMetadata {
  name: SettingName;
  label: string;
  description: string;
  inputType: "text" | "number" | "select" | "checkboxGroup";
  options?: readonly string[];
  min?: number;
  max?: number;
  category: "General" | "Logging" | "Metrics" | "Encryption" | "Security" | "Jobs";
}

/**
 * Metadata for all settings.
 * Defines labels, descriptions, input types, and validation rules.
 */
export const SettingsMetadata: Record<SettingName, SettingMetadata> = {
  [SettingNames.LOG_LEVEL]: {
    name: SettingNames.LOG_LEVEL,
    label: "Log Level",
    description: "Minimum log level to capture",
    inputType: "select",
    options: ["debug", "info", "warn", "error", "none"],
    category: "Logging",
  },
  [SettingNames.LOG_TRIMMING_INTERVAL_SECONDS]: {
    name: SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    label: "Log Trimming Interval",
    description: "How often to trim old logs (seconds)",
    inputType: "number",
    min: 1,
    max: 86400,
    category: "Logging",
  },
  [SettingNames.LOG_TRIMMING_MAX_PER_FUNCTION]: {
    name: SettingNames.LOG_TRIMMING_MAX_PER_FUNCTION,
    label: "Max Logs Per Function",
    description: "Maximum number of logs to keep per function",
    inputType: "number",
    min: 100,
    max: 100000,
    category: "Logging",
  },
  [SettingNames.LOG_TRIMMING_RETENTION_SECONDS]: {
    name: SettingNames.LOG_TRIMMING_RETENTION_SECONDS,
    label: "Log Retention Period",
    description: "How long to keep logs (seconds). Set to 0 to disable time-based deletion.",
    inputType: "number",
    min: 0,
    max: 31536000, // 365 days
    category: "Logging",
  },
  [SettingNames.LOG_BATCHING_MAX_BATCH_SIZE]: {
    name: SettingNames.LOG_BATCHING_MAX_BATCH_SIZE,
    label: "Log Batch Size",
    description: "Maximum logs to buffer before writing to database",
    inputType: "number",
    min: 1,
    max: 500,
    category: "Logging",
  },
  [SettingNames.LOG_BATCHING_MAX_DELAY_MS]: {
    name: SettingNames.LOG_BATCHING_MAX_DELAY_MS,
    label: "Log Batch Delay",
    description: "Maximum delay before flushing buffered logs (milliseconds)",
    inputType: "number",
    min: 10,
    max: 5000,
    category: "Logging",
  },
  [SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS]: {
    name: SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS,
    label: "Metrics Aggregation Interval",
    description: "How often to aggregate metrics (seconds)",
    inputType: "number",
    min: 10,
    max: 3600,
    category: "Metrics",
  },
  [SettingNames.METRICS_RETENTION_DAYS]: {
    name: SettingNames.METRICS_RETENTION_DAYS,
    label: "Metrics Retention Period",
    description: "Days to retain aggregated metrics",
    inputType: "number",
    min: 1,
    max: 365,
    category: "Metrics",
  },
  [SettingNames.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS]: {
    name: SettingNames.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS,
    label: "Key Rotation Check Interval",
    description: "How often to check if key rotation is needed (seconds)",
    inputType: "number",
    min: 3600,
    max: 86400,
    category: "Encryption",
  },
  [SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS]: {
    name: SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS,
    label: "Key Rotation Interval",
    description: "Days between automatic key rotations",
    inputType: "number",
    min: 1,
    max: 365,
    category: "Encryption",
  },
  [SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SIZE]: {
    name: SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SIZE,
    label: "Key Rotation Batch Size",
    description: "Records to re-encrypt per batch during rotation",
    inputType: "number",
    min: 10,
    max: 1000,
    category: "Encryption",
  },
  [SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS]: {
    name: SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS,
    label: "Key Rotation Batch Sleep",
    description: "Sleep between re-encryption batches (milliseconds)",
    inputType: "number",
    min: 0,
    max: 5000,
    category: "Encryption",
  },
  [SettingNames.API_ACCESS_GROUPS]: {
    name: SettingNames.API_ACCESS_GROUPS,
    label: "API Access Groups",
    description: "API key groups allowed to access server management API endpoints",
    inputType: "checkboxGroup",
    category: "Security",
  },
  [SettingNames.FILES_MAX_SIZE_BYTES]: {
    name: SettingNames.FILES_MAX_SIZE_BYTES,
    label: "Maximum File Size",
    description: "Maximum allowed file size in bytes (default: 50 MB)",
    inputType: "number",
    min: 1024,
    max: 524288000,
    category: "Security",
  },
  [SettingNames.JOB_PROCESSOR_POLLING_INTERVAL_SECONDS]: {
    name: SettingNames.JOB_PROCESSOR_POLLING_INTERVAL_SECONDS,
    label: "Job Processor Polling Interval",
    description: "How often the job processor checks for pending jobs (seconds)",
    inputType: "number",
    min: 1,
    max: 60,
    category: "Jobs",
  },
  [SettingNames.SERVER_NAME]: {
    name: SettingNames.SERVER_NAME,
    label: "Server Name",
    description: "Display name shown in the web UI title and navigation",
    inputType: "text",
    category: "General",
  },
};

/**
 * Settings grouped by category for UI display.
 */
export const SettingsByCategory = {
  General: [
    SettingNames.SERVER_NAME,
  ],
  Logging: [
    SettingNames.LOG_LEVEL,
    SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    SettingNames.LOG_TRIMMING_MAX_PER_FUNCTION,
    SettingNames.LOG_TRIMMING_RETENTION_SECONDS,
    SettingNames.LOG_BATCHING_MAX_BATCH_SIZE,
    SettingNames.LOG_BATCHING_MAX_DELAY_MS,
  ],
  Metrics: [
    SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS,
    SettingNames.METRICS_RETENTION_DAYS,
  ],
  Encryption: [
    SettingNames.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS,
    SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS,
    SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SIZE,
    SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS,
  ],
  Security: [
    SettingNames.API_ACCESS_GROUPS,
    SettingNames.FILES_MAX_SIZE_BYTES,
  ],
  Jobs: [
    SettingNames.JOB_PROCESSOR_POLLING_INTERVAL_SECONDS,
  ],
} as const;
