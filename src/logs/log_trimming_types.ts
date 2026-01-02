/** Configuration for the log trimming service */
export interface LogTrimmingConfig {
  /** How often to run trimming in seconds (default: 300 = 5 minutes) */
  trimmingIntervalSeconds: number;
  /** Maximum number of logs to keep per route (default: 2000) */
  maxLogsPerRoute: number;
}
