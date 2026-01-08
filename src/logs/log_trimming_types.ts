/** Configuration for the log trimming service */
export interface LogTrimmingConfig {
  /** How often to run trimming in seconds (default: 300 = 5 minutes) */
  trimmingIntervalSeconds: number;
  /** Maximum number of logs to keep per route (default: 2000) */
  maxLogsPerRoute: number;
  /** Retention period in seconds. 0 disables time-based deletion. (default: 7776000 = 90 days) */
  retentionSeconds: number;
}
