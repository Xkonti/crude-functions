import { Hono } from "@hono/hono";
import type { RoutesService, FunctionRoute, NewFunctionRoute } from "../routes/routes_service.ts";
import {
  validateRouteName,
  validateRoutePath,
  validateMethods,
} from "../validation/routes.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ConsoleLog } from "../logs/types.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import type { ExecutionMetric, MetricType } from "../metrics/types.ts";
import type { ApiKeyService, ApiKeyGroup } from "../keys/api_key_service.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import type { Secret, SecretPreview } from "../secrets/types.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";
import { formatForDisplay } from "../utils/datetime.ts";
import {
  layout,
  escapeHtml,
  toBase64,
  flashMessages,
  confirmPage,
  buttonLink,
  getLayoutUser,
  formatDate,
  secretScripts,
  parseSecretFormData,
  parseSecretEditFormData,
} from "./templates.ts";
import { validateId } from "../validation/common.ts";

const ALL_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

// Metrics display types
type MetricsDisplayMode = "hour" | "day" | "days";

interface ChartDataPoint {
  label: string;
  timestamp: Date;
  avgTimeMs: number;
  maxTimeMs: number;
  executionCount: number;
  isCurrent: boolean;
  isInterpolated: boolean;
}

interface MetricsSummary {
  avgExecutionsPerPeriod: number;
  avgExecutionTime: number;
  maxExecutionTime: number;
  totalExecutions: number;
  periodCount: number;
}

function renderMethodBadges(methods: string[]): string {
  return methods
    .map((m) => escapeHtml(m))
    .join(", ");
}

/**
 * Renders the secrets preview HTML fragment.
 * Groups individual API key secrets with collapsible expansion.
 */
function renderSecretsPreview(previews: SecretPreview[]): string {
  if (previews.length === 0) {
    return `
      <article style="margin-top: 1rem;">
        <p><em>No secrets available to this function.</em></p>
        <small>Secrets can be defined at global, function, or API key group scope.</small>
      </article>
    `;
  }

  return `
    <article style="margin-top: 1rem; background: #f8f9fa; padding: 1rem;">
      <header><strong>Available Secrets</strong></header>
      <div style="font-family: monospace; font-size: 0.9em;">
        ${previews.map((preview, previewIdx) => {
          // Group key-level sources by group
          const keySources = preview.sources.filter(s => s.scope === 'key');
          const keysByGroup = new Map<string, typeof keySources>();
          for (const keySource of keySources) {
            const groupKey = keySource.groupName || 'unknown';
            if (!keysByGroup.has(groupKey)) {
              keysByGroup.set(groupKey, []);
            }
            keysByGroup.get(groupKey)!.push(keySource);
          }

          return `
          <div style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #dee2e6;">
            <div style="font-weight: bold; margin-bottom: 0.5rem;">
              ${escapeHtml(preview.name)}
            </div>
            ${preview.sources.filter(s => s.scope !== 'key').map(source => {
              const scopeLabel = source.scope === 'global'
                ? 'via global scope'
                : source.scope === 'function'
                ? 'via function scope'
                : `via '${escapeHtml(source.groupName || '')}' API key group`;

              return `
                <div class="secret-value" style="margin-left: 1rem; margin-bottom: 0.25rem;">
                  <span style="color: #6c757d;">└─ ${scopeLabel}:</span>
                  <span class="masked">••••••••</span>
                  <span class="revealed" style="display:none;">
                    <code>${escapeHtml(source.value)}</code>
                  </span>
                  <button type="button" onclick="toggleSecret(this)"
                          class="secondary" style="padding: 0.25rem 0.5rem; margin-left: 0.5rem;">
                    👁️
                  </button>
                  <button type="button" onclick="copySecret(this, '${escapeHtml(source.value).replace(/'/g, "\\'")}')"
                          class="secondary" style="padding: 0.25rem 0.5rem;">
                    📋
                  </button>
                </div>
              `;
            }).join('')}
            ${Array.from(keysByGroup.entries()).map(([groupName, keys]) => `
              <div style="margin-left: 1rem; margin-bottom: 0.25rem;">
                <span style="color: #6c757d;">└─ via ${keys.length} API key${keys.length !== 1 ? 's' : ''} in '${escapeHtml(groupName)}' group</span>
                <button type="button" onclick="toggleKeyExpansion('keys-${previewIdx}-${escapeHtml(groupName)}')"
                        class="secondary" style="padding: 0.25rem 0.5rem; margin-left: 0.5rem;">
                  ▼
                </button>
                <div id="keys-${previewIdx}-${escapeHtml(groupName)}" style="display: none; margin-left: 1rem; margin-top: 0.5rem;">
                  ${keys.map(keySource => `
                    <div class="secret-value" style="margin-bottom: 0.25rem;">
                      <span style="color: #6c757d;">• ${escapeHtml(groupName)}/${escapeHtml(keySource.keyName || '')}:</span>
                      <span class="masked">••••••••</span>
                      <span class="revealed" style="display:none;">
                        <code>${escapeHtml(keySource.value)}</code>
                      </span>
                      <button type="button" onclick="toggleSecret(this)"
                              class="secondary" style="padding: 0.25rem 0.5rem; margin-left: 0.5rem;">
                        👁️
                      </button>
                      <button type="button" onclick="copySecret(this, '${escapeHtml(keySource.value).replace(/'/g, "\\'")}')"
                              class="secondary" style="padding: 0.25rem 0.5rem;">
                        📋
                      </button>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        `;
        }).join('')}
      </div>
    </article>
  `;
}

function renderLogLevelBadge(level: string): string {
  const levelColors: Record<string, string> = {
    error: "color: #dc3545;",
    warn: "color: #fd7e14;",
    log: "color: #6c757d;",
    debug: "color: #6c757d;",
    info: "color: #17a2b8;",
    trace: "color: #adb5bd;",
    exec_start: "color: #28a745;",
    exec_end: "color: #28a745;",
    exec_reject: "color: #dc3545;",
  };
  const style = levelColors[level] ?? "";
  return `<span style="font-weight: bold; ${style}">${escapeHtml(level.toUpperCase())}</span>`;
}

function formatTimeShort(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

// Time flooring utilities for metrics
function floorToMinute(date: Date): Date {
  const result = new Date(date);
  result.setUTCSeconds(0, 0);
  return result;
}

function floorToHour(date: Date): Date {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

function floorToDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Get a unique key for a time period based on mode.
 */
function getTimePeriodKey(date: Date, mode: MetricsDisplayMode): string {
  switch (mode) {
    case "hour":
      return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}-${date.getUTCMinutes()}`;
    case "day":
      return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`;
    case "days":
      return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
  }
}

/**
 * Get the start time for a slot index going back from now.
 */
function getSlotTime(now: Date, mode: MetricsDisplayMode, slotsBack: number): Date {
  const result = new Date(now);
  switch (mode) {
    case "hour":
      result.setTime(result.getTime() - slotsBack * 60 * 1000);
      return floorToMinute(result);
    case "day":
      result.setTime(result.getTime() - slotsBack * 60 * 60 * 1000);
      return floorToHour(result);
    case "days":
      result.setTime(result.getTime() - slotsBack * 24 * 60 * 60 * 1000);
      return floorToDay(result);
  }
}

/**
 * Format time label for chart X-axis.
 */
function formatMetricsTimeLabel(date: Date, mode: MetricsDisplayMode): string {
  switch (mode) {
    case "hour":
      return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`;
    case "day":
      return `${date.getUTCHours().toString().padStart(2, "0")}:00`;
    case "days":
      return `${(date.getUTCMonth() + 1).toString().padStart(2, "0")}/${date.getUTCDate().toString().padStart(2, "0")}`;
  }
}

/**
 * Aggregate a list of metrics into a single summary.
 */
function aggregateMetrics(metrics: ExecutionMetric[]): {
  avgTimeMs: number;
  maxTimeMs: number;
  executionCount: number;
} {
  if (metrics.length === 0) {
    return { avgTimeMs: 0, maxTimeMs: 0, executionCount: 0 };
  }

  let totalWeightedSum = 0;
  let totalCount = 0;
  let maxTime = 0;

  for (const record of metrics) {
    totalWeightedSum += record.avgTimeMs * record.executionCount;
    totalCount += record.executionCount;
    maxTime = Math.max(maxTime, record.maxTimeMs);
  }

  return {
    avgTimeMs: totalCount > 0 ? totalWeightedSum / totalCount : 0,
    maxTimeMs: maxTime,
    executionCount: totalCount,
  };
}

/**
 * Calculate the "current" period metric by aggregating unprocessed records.
 * This cascades through all levels to include all unprocessed data:
 * - hour mode: execution records for current minute
 * - day mode: minute records for current hour + execution records for current minute
 * - days mode: hour records for current day + minute records for current hour + execution records for current minute
 *
 * For global metrics (routeId = null), aggregates data across ALL routes.
 */
async function calculateCurrentPeriodMetric(
  metricsService: ExecutionMetricsService,
  routeId: number | null,
  mode: MetricsDisplayMode,
  now: Date
): Promise<ExecutionMetric | null> {
  const allMetrics: ExecutionMetric[] = [];

  // Use end time slightly in the future to include records at exactly 'now'
  // (getByRouteIdTypeAndTimeRange uses exclusive end: timestamp < end)
  const endTime = new Date(now.getTime() + 1000);

  // Helper to fetch records based on whether this is global or per-route
  const fetchRecords = (type: MetricType, start: Date, end: Date) => {
    if (routeId === null) {
      // Global: aggregate all per-route records
      return metricsService.getAllPerRouteMetricsByTypeAndTimeRange(type, start, end);
    } else {
      // Per-route: fetch for specific route
      return metricsService.getByRouteIdTypeAndTimeRange(routeId, type, start, end);
    }
  };

  // Always get execution records for current minute (unprocessed raw executions)
  const currentMinuteStart = floorToMinute(now);
  const executionRecords = await fetchRecords("execution", currentMinuteStart, endTime);
  allMetrics.push(...executionRecords);

  if (mode === "day" || mode === "days") {
    // For day/days mode: also get minute records for current hour
    const currentHourStart = floorToHour(now);
    const minuteRecords = await fetchRecords("minute", currentHourStart, endTime);
    allMetrics.push(...minuteRecords);
  }

  if (mode === "days") {
    // For days mode: also get hour records for current day
    const currentDayStart = floorToDay(now);
    const hourRecords = await fetchRecords("hour", currentDayStart, endTime);
    allMetrics.push(...hourRecords);
  }

  if (allMetrics.length === 0) return null;

  const aggregated = aggregateMetrics(allMetrics);

  // Determine the period start based on mode
  let periodStart: Date;
  switch (mode) {
    case "hour":
      periodStart = currentMinuteStart;
      break;
    case "day":
      periodStart = floorToHour(now);
      break;
    case "days":
      periodStart = floorToDay(now);
      break;
  }

  return {
    id: 0, // Not a real record
    routeId,
    type: "execution", // Doesn't matter for display purposes
    avgTimeMs: aggregated.avgTimeMs,
    maxTimeMs: aggregated.maxTimeMs,
    executionCount: aggregated.executionCount,
    timestamp: periodStart,
  };
}

/**
 * Apply time interpolation to data points for avgTimeMs and maxTimeMs.
 * - Before first real data: use first real value
 * - Between real data points: linear interpolation
 * - After last real data: use last real value
 * Execution count is NOT interpolated (remains 0 for empty periods).
 */
function applyTimeInterpolation(dataPoints: ChartDataPoint[]): ChartDataPoint[] {
  // Find all indices with real data (executionCount > 0)
  const realIndices = dataPoints
    .map((p, i) => (p.executionCount > 0 ? i : -1))
    .filter((i) => i !== -1);

  if (realIndices.length === 0) {
    // No real data - return as-is (all zeros, all interpolated)
    return dataPoints.map((p) => ({ ...p, isInterpolated: true }));
  }

  const firstReal = realIndices[0];
  const lastReal = realIndices[realIndices.length - 1];

  return dataPoints.map((point, i) => {
    if (point.executionCount > 0) {
      // Real data point - keep as-is
      return { ...point, isInterpolated: false };
    }

    // Interpolated point
    let avgTimeMs: number;
    let maxTimeMs: number;

    if (i < firstReal) {
      // Before first real: use first real value
      avgTimeMs = dataPoints[firstReal].avgTimeMs;
      maxTimeMs = dataPoints[firstReal].maxTimeMs;
    } else if (i > lastReal) {
      // After last real: use last real value
      avgTimeMs = dataPoints[lastReal].avgTimeMs;
      maxTimeMs = dataPoints[lastReal].maxTimeMs;
    } else {
      // Between real points: linear interpolation
      const prevReal = realIndices.filter((idx) => idx < i).pop()!;
      const nextReal = realIndices.find((idx) => idx > i)!;
      const ratio = (i - prevReal) / (nextReal - prevReal);

      avgTimeMs =
        dataPoints[prevReal].avgTimeMs +
        ratio * (dataPoints[nextReal].avgTimeMs - dataPoints[prevReal].avgTimeMs);
      maxTimeMs =
        dataPoints[prevReal].maxTimeMs +
        ratio * (dataPoints[nextReal].maxTimeMs - dataPoints[prevReal].maxTimeMs);
    }

    return {
      ...point,
      avgTimeMs,
      maxTimeMs,
      isInterpolated: true,
    };
  });
}

/**
 * Fetch metrics data for the specified mode and prepare chart data points.
 */
async function fetchMetricsData(
  metricsService: ExecutionMetricsService,
  routeId: number | null,
  mode: MetricsDisplayMode,
  retentionDays: number
): Promise<ChartDataPoint[]> {
  const now = new Date();
  let expectedPoints: number;
  let sourceType: MetricType;
  let startTime: Date;

  switch (mode) {
    case "hour":
      // Last 60 minutes of minute-aggregated data
      sourceType = "minute";
      expectedPoints = 60;
      startTime = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case "day":
      // Last 24 hours of hour-aggregated data
      sourceType = "hour";
      expectedPoints = 24;
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "days":
      // Last X days of day-aggregated data
      sourceType = "day";
      expectedPoints = retentionDays;
      startTime = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      break;
  }

  // Fetch historical data - use appropriate method based on routeId
  const metrics =
    routeId === null
      ? await metricsService.getGlobalMetricsByTypeAndTimeRange(sourceType, startTime, now)
      : await metricsService.getByRouteIdTypeAndTimeRange(routeId, sourceType, startTime, now);

  // Build data points map for easy lookup
  const dataMap = new Map<string, ExecutionMetric>();
  for (const m of metrics) {
    const key = getTimePeriodKey(m.timestamp, mode);
    dataMap.set(key, m);
  }

  // Calculate current period metric
  const currentMetric = await calculateCurrentPeriodMetric(
    metricsService,
    routeId,
    mode,
    now
  );

  // Generate all expected time slots (isInterpolated will be set by applyTimeInterpolation)
  const rawDataPoints: ChartDataPoint[] = [];
  for (let i = expectedPoints - 1; i >= 0; i--) {
    const slotTime = getSlotTime(now, mode, i);
    const key = getTimePeriodKey(slotTime, mode);
    const metric = dataMap.get(key);
    const isCurrent = i === 0;

    if (isCurrent && currentMetric) {
      rawDataPoints.push({
        label: formatMetricsTimeLabel(slotTime, mode),
        timestamp: slotTime,
        avgTimeMs: currentMetric.avgTimeMs,
        maxTimeMs: currentMetric.maxTimeMs,
        executionCount: currentMetric.executionCount,
        isCurrent: true,
        isInterpolated: false,
      });
    } else if (metric) {
      rawDataPoints.push({
        label: formatMetricsTimeLabel(slotTime, mode),
        timestamp: slotTime,
        avgTimeMs: metric.avgTimeMs,
        maxTimeMs: metric.maxTimeMs,
        executionCount: metric.executionCount,
        isCurrent: false,
        isInterpolated: false,
      });
    } else {
      // Empty period - show as 0 (will be interpolated later)
      rawDataPoints.push({
        label: formatMetricsTimeLabel(slotTime, mode),
        timestamp: slotTime,
        avgTimeMs: 0,
        maxTimeMs: 0,
        executionCount: 0,
        isCurrent: isCurrent,
        isInterpolated: false, // Will be set true by applyTimeInterpolation
      });
    }
  }

  // Apply interpolation to fill in missing time values with smooth transitions
  return applyTimeInterpolation(rawDataPoints);
}

/**
 * Calculate summary statistics from chart data.
 */
function calculateSummary(dataPoints: ChartDataPoint[]): MetricsSummary {
  const nonZeroPoints = dataPoints.filter((p) => p.executionCount > 0);

  if (nonZeroPoints.length === 0) {
    return {
      avgExecutionsPerPeriod: 0,
      avgExecutionTime: 0,
      maxExecutionTime: 0,
      totalExecutions: 0,
      periodCount: dataPoints.length,
    };
  }

  let totalExecutions = 0;
  let weightedTimeSum = 0;
  let maxTime = 0;

  for (const point of nonZeroPoints) {
    totalExecutions += point.executionCount;
    weightedTimeSum += point.avgTimeMs * point.executionCount;
    maxTime = Math.max(maxTime, point.maxTimeMs);
  }

  return {
    avgExecutionsPerPeriod: totalExecutions / dataPoints.length,
    avgExecutionTime: totalExecutions > 0 ? weightedTimeSum / totalExecutions : 0,
    maxExecutionTime: maxTime,
    totalExecutions,
    periodCount: dataPoints.length,
  };
}

interface LogsPaginationOptions {
  limit: number;
  beforeId: number | null;
  oldestLogId: number | null;
  hasMore: boolean;
}

function renderLogsPage(
  functionName: string,
  routeId: number,
  logs: ConsoleLog[],
  pagination: LogsPaginationOptions
): string {
  const logsTableStyles = `
    <script src="https://cdn.jsdelivr.net/npm/ansi_up@4.0.4/ansi_up.js"></script>
    <style>
      .logs-table { font-size: 0.85em; }
      .logs-table th, .logs-table td { padding: 0.4em 0.6em; }
      .logs-table th:nth-child(1), .logs-table td:nth-child(1) { width: 1%; white-space: nowrap; }
      .logs-table th:nth-child(2), .logs-table td:nth-child(2) { width: 1%; white-space: nowrap; }
      .logs-table th:nth-child(3), .logs-table td:nth-child(3) { width: 1%; white-space: nowrap; }
      .logs-table th:nth-child(4), .logs-table td:nth-child(4) { width: auto; }
      .logs-table .log-message { font-family: monospace; word-break: break-word; }
      .logs-table .log-row { cursor: pointer; }
      .logs-table .log-row:hover { background: rgba(0,0,0,0.05); }
      .logs-table .log-detail { display: none; }
      .logs-table .log-detail.expanded { display: table-row; }
      .logs-table .log-detail td { padding: 0.8em; background: #1a1a2e; }
      .logs-table .log-detail pre {
        margin: 0;
        padding: 1em;
        background: #0d0d1a;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.95em;
        color: #e0e0e0;
      }
      .request-id-copy {
        cursor: pointer;
        text-decoration: underline dotted;
      }
      .request-id-copy:hover { color: #17a2b8; }
      .logs-controls { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
      .logs-controls select { width: auto; margin: 0; padding: 0.4em 0.6em; }
    </style>
  `;

  const logsTableScript = `
    <script>
      // Initialize ANSI to HTML converter
      const ansiUp = new AnsiUp();
      ansiUp.use_classes = false;

      // Decode base64 with proper UTF-8 handling
      function decodeBase64Utf8(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
      }

      // Convert all log messages on page load
      document.addEventListener('DOMContentLoaded', function() {
        // Convert table cell messages
        document.querySelectorAll('.log-message[data-raw]').forEach(function(el) {
          const raw = el.getAttribute('data-raw');
          if (raw) {
            const decoded = decodeBase64Utf8(raw);
            el.innerHTML = ansiUp.ansi_to_html(decoded);
          }
        });
        // Convert expanded detail messages
        document.querySelectorAll('.log-detail-content[data-raw]').forEach(function(el) {
          const raw = el.getAttribute('data-raw');
          if (raw) {
            const decoded = decodeBase64Utf8(raw);
            el.innerHTML = ansiUp.ansi_to_html(decoded);
          }
        });
      });

      function toggleLogDetail(rowId) {
        const detail = document.getElementById('detail-' + rowId);
        if (detail) {
          detail.classList.toggle('expanded');
        }
      }
      function copyRequestId(event, fullId) {
        event.stopPropagation();
        navigator.clipboard.writeText(fullId).then(() => {
          const el = event.target;
          const original = el.textContent;
          el.textContent = 'copied!';
          setTimeout(() => { el.textContent = original; }, 1000);
        });
      }
      function changePageSize(select) {
        const limit = select.value;
        window.location.href = '/web/functions/logs/${routeId}?limit=' + limit;
      }
      function goToNextPage() {
        const beforeId = ${pagination.oldestLogId ?? "null"};
        if (beforeId) {
          window.location.href = '/web/functions/logs/${routeId}?limit=${pagination.limit}&before_id=' + beforeId;
        }
      }
      function resetToNewest() {
        window.location.href = '/web/functions/logs/${routeId}?limit=${pagination.limit}';
      }
    </script>
  `;

  const pageSizeOptions = [50, 100, 250, 500, 1000];
  const isViewingOlder = pagination.beforeId !== null;

  return `
    ${logsTableStyles}
    <h1>Logs: ${escapeHtml(functionName)}</h1>
    <div class="grid" style="margin-bottom: 1rem;">
      <div>
        <a href="/web/functions" role="button" class="secondary outline">&larr; Back to Functions</a>
      </div>
      <div style="text-align: right;" class="logs-controls">
        <label style="margin: 0;">Show:</label>
        <select onchange="changePageSize(this)">
          ${pageSizeOptions.map((size) => `<option value="${size}"${size === pagination.limit ? " selected" : ""}>${size}</option>`).join("")}
        </select>
        ${isViewingOlder ? `<button class="outline" onclick="resetToNewest()">Reset to Newest</button>` : ""}
        <a href="/web/functions/logs/${routeId}?limit=${pagination.limit}${isViewingOlder ? "&before_id=" + pagination.beforeId : ""}" role="button" class="outline">Refresh</a>
      </div>
    </div>
    ${
      logs.length === 0
        ? "<p><em>No logs recorded for this function.</em></p>"
        : `
      <p style="color: #6c757d;">
        Showing ${logs.length} log${logs.length === 1 ? "" : "s"}${isViewingOlder ? " (viewing older)" : " (newest)"}:
        <strong>${formatForDisplay(logs[logs.length - 1].timestamp)}</strong> to <strong>${formatForDisplay(logs[0].timestamp)}</strong>.
        Click a row to expand.
      </p>
      <table class="logs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Req ID</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${logs
            .map(
              (log, i) => {
                const fullMessage = log.args
                  ? `${log.message}\n\nArgs: ${log.args}`
                  : log.message;
                const requestIdShort = log.requestId.slice(-5);
                // Truncate for table cell display (before encoding)
                const truncatedMessage = log.message.substring(0, 120) + (log.message.length > 120 ? "..." : "");
                // Base64 encode messages for safe transmission (handles ANSI codes and special chars)
                const truncatedBase64 = toBase64(truncatedMessage);
                const fullBase64 = toBase64(fullMessage);
                return `
            <tr class="log-row" onclick="toggleLogDetail(${i})">
              <td><code title="${escapeHtml(formatForDisplay(log.timestamp))}">${formatTimeShort(log.timestamp)}</code></td>
              <td>${renderLogLevelBadge(log.level)}</td>
              <td><code class="request-id-copy" title="Click to copy: ${escapeHtml(log.requestId)}" onclick="copyRequestId(event, '${escapeHtml(log.requestId)}')">${escapeHtml(requestIdShort)}</code></td>
              <td class="log-message" data-raw="${truncatedBase64}"></td>
            </tr>
            <tr id="detail-${i}" class="log-detail">
              <td colspan="4"><pre class="log-detail-content" data-raw="${fullBase64}"></pre></td>
            </tr>
          `;
              }
            )
            .join("")}
        </tbody>
      </table>
      ${pagination.hasMore ? `
        <div style="margin-top: 1rem; text-align: center;">
          <button onclick="goToNextPage()">Load Older Logs &rarr;</button>
        </div>
      ` : `
        <p style="margin-top: 1rem; text-align: center; color: #6c757d;"><em>No more logs</em></p>
      `}
      ${logsTableScript}
    `
    }
  `;
}

function renderMetricsPage(
  functionName: string,
  routeId: number | null,
  mode: MetricsDisplayMode,
  dataPoints: ChartDataPoint[],
  summary: MetricsSummary,
  retentionDays: number,
  allFunctions: FunctionRoute[]
): string {
  const isGlobal = routeId === null;
  const metricsBaseUrl = isGlobal ? "/web/functions/metrics/global" : `/web/functions/metrics/${routeId}`;
  const refreshUrl = `${metricsBaseUrl}?mode=${mode}`;
  const modeLabels: Record<MetricsDisplayMode, string> = {
    hour: "Last Hour",
    day: "Last 24 Hours",
    days: `Last ${retentionDays} Days`,
  };

  const periodLabels: Record<MetricsDisplayMode, string> = {
    hour: "minute",
    day: "hour",
    days: "day",
  };

  // Prepare data for Chart.js
  const labels = JSON.stringify(dataPoints.map((p) => p.label));
  const avgTimes = JSON.stringify(dataPoints.map((p) => Number(p.avgTimeMs.toFixed(2))));
  const maxTimes = JSON.stringify(dataPoints.map((p) => Number(p.maxTimeMs.toFixed(2))));
  const execCounts = JSON.stringify(dataPoints.map((p) => p.executionCount));
  const currentFlags = JSON.stringify(dataPoints.map((p) => p.isCurrent));
  const interpolatedFlags = JSON.stringify(dataPoints.map((p) => p.isInterpolated));

  const styles = `
    <style>
      .metrics-tabs {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }
      .metrics-tabs a {
        padding: 0.5rem 1rem;
        border-radius: 4px;
        text-decoration: none;
        background: var(--pico-secondary-background);
        color: var(--pico-secondary);
      }
      .metrics-tabs a.active {
        background: var(--pico-primary-background);
        color: var(--pico-primary-inverse);
      }
      .chart-container {
        position: relative;
        width: 100%;
        height: 300px;
        margin-bottom: 2rem;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 2rem;
      }
      .summary-card {
        padding: 1rem;
        background: var(--pico-card-background-color);
        border-radius: 8px;
        text-align: center;
      }
      .summary-card h3 {
        margin: 0 0 0.5rem 0;
        font-size: 0.9rem;
        color: var(--pico-muted-color);
      }
      .summary-card .value {
        font-size: 1.5rem;
        font-weight: bold;
      }
      .no-data-message {
        text-align: center;
        padding: 2rem;
        color: var(--pico-muted-color);
      }
      .source-selector {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }
      .source-selector label {
        margin: 0;
        font-weight: bold;
      }
      .source-selector select {
        margin: 0;
        width: auto;
        min-width: 200px;
      }
    </style>
  `;

  const chartScript = `
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        const labels = ${labels};
        const avgTimes = ${avgTimes};
        const maxTimes = ${maxTimes};
        const execCounts = ${execCounts};
        const currentFlags = ${currentFlags};
        const interpolatedFlags = ${interpolatedFlags};

        // Color helpers for interpolated vs real data
        const avgColor = 'rgb(75, 192, 192)';
        const avgColorInterp = 'rgba(150, 150, 150, 0.5)';
        const maxColor = 'rgb(255, 99, 132)';
        const maxColorInterp = 'rgba(150, 150, 150, 0.5)';
        const currentColor = 'rgb(255, 159, 64)';

        // Helper to get point color based on current/interpolated flags
        function getPointColor(index, normalColor) {
          if (currentFlags[index]) return currentColor;
          if (interpolatedFlags[index]) return avgColorInterp;
          return normalColor;
        }

        // Execution Time Chart
        const timeCtx = document.getElementById('executionTimeChart').getContext('2d');
        new Chart(timeCtx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'Avg Time (ms)',
                data: avgTimes,
                borderColor: avgColor,
                backgroundColor: 'rgba(75, 192, 192, 0.1)',
                tension: 0.1,
                fill: true,
                // Segment styling for interpolated regions (grey + dashed)
                segment: {
                  borderColor: function(ctx) {
                    const p0Interp = interpolatedFlags[ctx.p0DataIndex];
                    const p1Interp = interpolatedFlags[ctx.p1DataIndex];
                    // Both points interpolated = grey segment
                    if (p0Interp && p1Interp) return avgColorInterp;
                    return avgColor;
                  },
                  borderDash: function(ctx) {
                    const p0Interp = interpolatedFlags[ctx.p0DataIndex];
                    const p1Interp = interpolatedFlags[ctx.p1DataIndex];
                    // Both points interpolated = dashed line
                    if (p0Interp && p1Interp) return [5, 5];
                    return [];
                  }
                },
                pointBackgroundColor: avgTimes.map((_, i) => getPointColor(i, avgColor)),
                pointBorderColor: avgTimes.map((_, i) => getPointColor(i, avgColor)),
                pointRadius: avgTimes.map((_, i) => currentFlags[i] ? 6 : (interpolatedFlags[i] ? 2 : 3)),
              },
              {
                label: 'Max Time (ms)',
                data: maxTimes,
                borderColor: maxColor,
                backgroundColor: 'rgba(255, 99, 132, 0.1)',
                tension: 0.1,
                fill: false,
                // Segment styling for interpolated regions (grey + dashed)
                segment: {
                  borderColor: function(ctx) {
                    const p0Interp = interpolatedFlags[ctx.p0DataIndex];
                    const p1Interp = interpolatedFlags[ctx.p1DataIndex];
                    if (p0Interp && p1Interp) return maxColorInterp;
                    return maxColor;
                  },
                  borderDash: function(ctx) {
                    const p0Interp = interpolatedFlags[ctx.p0DataIndex];
                    const p1Interp = interpolatedFlags[ctx.p1DataIndex];
                    if (p0Interp && p1Interp) return [5, 5];
                    return [];
                  }
                },
                pointBackgroundColor: maxTimes.map((_, i) => getPointColor(i, maxColor)),
                pointBorderColor: maxTimes.map((_, i) => getPointColor(i, maxColor)),
                pointRadius: maxTimes.map((_, i) => currentFlags[i] ? 6 : (interpolatedFlags[i] ? 2 : 3)),
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Time (ms)'
                }
              }
            },
            plugins: {
              tooltip: {
                callbacks: {
                  afterLabel: function(context) {
                    const msgs = [];
                    if (currentFlags[context.dataIndex]) {
                      msgs.push('(Current period - live data)');
                    }
                    if (interpolatedFlags[context.dataIndex]) {
                      msgs.push('(No activity - interpolated)');
                    }
                    return msgs.join('\\n');
                  }
                }
              }
            }
          }
        });

        // Request Count Chart
        const countCtx = document.getElementById('requestCountChart').getContext('2d');
        new Chart(countCtx, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [{
              label: 'Executions',
              data: execCounts,
              backgroundColor: execCounts.map((_, i) => currentFlags[i] ? 'rgba(255, 159, 64, 0.8)' : 'rgba(54, 162, 235, 0.8)'),
              borderColor: execCounts.map((_, i) => currentFlags[i] ? 'rgb(255, 159, 64)' : 'rgb(54, 162, 235)'),
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Execution Count'
                }
              }
            },
            plugins: {
              tooltip: {
                callbacks: {
                  afterLabel: function(context) {
                    if (currentFlags[context.dataIndex]) {
                      return '(Current period - live data)';
                    }
                    return '';
                  }
                }
              }
            }
          }
        });
      });
    </script>
  `;

  const hasData = dataPoints.some((p) => p.executionCount > 0);

  // Build source selector options
  const sourceOptions = [
    `<option value="/web/functions/metrics/global?mode=${mode}" ${isGlobal ? "selected" : ""}>Global metrics</option>`,
    ...allFunctions.map(
      (fn) =>
        `<option value="/web/functions/metrics/${fn.id}?mode=${mode}" ${fn.id === routeId ? "selected" : ""}>Function: ${escapeHtml(fn.name)}</option>`
    ),
  ].join("");

  return `
    ${styles}
    <h1>Metrics: ${escapeHtml(functionName)}</h1>

    <div class="grid" style="margin-bottom: 1rem;">
      <div>
        <a href="/web/functions" role="button" class="secondary outline">&larr; Back to Functions</a>
      </div>
      <div style="text-align: right;">
        <a href="${refreshUrl}" role="button" class="outline">Refresh</a>
      </div>
    </div>

    <div class="source-selector">
      <label>Source:</label>
      <select onchange="window.location.href = this.value">
        ${sourceOptions}
      </select>
    </div>

    <div class="metrics-tabs">
      <a href="${metricsBaseUrl}?mode=hour" class="${mode === "hour" ? "active" : ""}">Last Hour</a>
      <a href="${metricsBaseUrl}?mode=day" class="${mode === "day" ? "active" : ""}">Last 24 Hours</a>
      <a href="${metricsBaseUrl}?mode=days" class="${mode === "days" ? "active" : ""}">Last ${retentionDays} Days</a>
    </div>

    <h2>${escapeHtml(modeLabels[mode])}</h2>

    ${
      hasData
        ? `
      <div class="summary-grid">
        <div class="summary-card">
          <h3>Avg Executions / ${escapeHtml(periodLabels[mode])}</h3>
          <div class="value">${summary.avgExecutionsPerPeriod.toFixed(1)}</div>
        </div>
        <div class="summary-card">
          <h3>Avg Execution Time</h3>
          <div class="value">${summary.avgExecutionTime.toFixed(1)} ms</div>
        </div>
        <div class="summary-card">
          <h3>Max Execution Time</h3>
          <div class="value">${summary.maxExecutionTime.toFixed(1)} ms</div>
        </div>
        <div class="summary-card">
          <h3>Total Executions</h3>
          <div class="value">${summary.totalExecutions}</div>
        </div>
      </div>

      <h3>Execution Time</h3>
      <div class="chart-container">
        <canvas id="executionTimeChart"></canvas>
      </div>

      <h3>Request Count</h3>
      <div class="chart-container">
        <canvas id="requestCountChart"></canvas>
      </div>

      <p style="color: var(--pico-muted-color); font-size: 0.85em;">
        <strong>Note:</strong> Orange data points indicate the current ${escapeHtml(periodLabels[mode])} (live data that updates on refresh).
        Dashed grey lines indicate periods with no recorded activity (values interpolated from adjacent data).
      </p>

      ${chartScript}
    `
        : `
      <div class="no-data-message">
        <p><em>No metrics recorded for this function yet.</em></p>
        <p>Metrics will appear here after the function receives some requests.</p>
      </div>
    `
    }
  `;
}

function renderFunctionForm(
  action: string,
  route: Partial<FunctionRoute> = {},
  availableGroups: ApiKeyGroup[] = [],
  error?: string
): string {
  const isEdit = route.id !== undefined;
  const selectedKeys = route.keys ?? [];

  return `
    <h1>${isEdit ? "Edit" : "Create"} Function</h1>
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="${escapeHtml(action)}">
      <label>
        Name
        <input type="text" name="name" value="${escapeHtml(route.name ?? "")}"
               required placeholder="my-function">
        <small>Unique identifier for this function</small>
      </label>
      <label>
        Description
        <textarea name="description" rows="2" placeholder="Optional description">${escapeHtml(route.description ?? "")}</textarea>
      </label>
      <label>
        Handler Path
        <input type="text" name="handler" value="${escapeHtml(route.handler ?? "")}"
               required placeholder="handlers/my-function.ts">
        <small>Path to the TypeScript handler file in the code directory</small>
      </label>
      <label>
        Route Path
        <input type="text" name="route" value="${escapeHtml(route.route ?? "")}"
               required placeholder="/api/users/:id">
        <small>URL path pattern (must start with /)</small>
      </label>
      <fieldset>
        <legend>HTTP Methods</legend>
        ${ALL_METHODS.map(
          (method) => `
          <label>
            <input type="checkbox" name="methods" value="${method}"
                   ${(route.methods ?? []).includes(method) ? "checked" : ""}>
            ${method}
          </label>
        `
        ).join("")}
      </fieldset>
      <fieldset>
        <legend>Required API Key Groups</legend>
        <small>Select which API key groups are allowed to access this function (optional)</small>
        ${
          availableGroups.length === 0
            ? '<p><em>No API key groups defined. <a href="/web/keys/create-group">Create a group</a> first.</em></p>'
            : availableGroups.map(
                (group) => `
                <label>
                  <input type="checkbox" name="keys" value="${group.id}"
                         ${selectedKeys.includes(group.id) ? "checked" : ""}>
                  <strong>${escapeHtml(group.name)}</strong>${group.description ? `: ${escapeHtml(group.description)}` : ""}
                </label>
              `
              ).join("")
        }
      </fieldset>
      ${isEdit ? `
      <div style="margin: 1rem 0;">
        <button type="button" id="secrets-preview-btn"
                onclick="loadSecretsPreview(${route.id})"
                class="secondary">
          Show Secrets Preview
        </button>
      </div>
      <div id="secrets-preview-container"></div>
      ` : `
      <div style="margin: 1rem 0;">
        <p style="color: #6c757d; font-size: 0.9em;">
          <em>Save this function first to preview available secrets.</em>
        </p>
      </div>
      `}
      <div class="grid" style="margin-bottom: 0;">
        <button type="submit" style="margin-bottom: 0;">${isEdit ? "Save Changes" : "Create Function"}</button>
        <a href="/web/functions" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>

    ${isEdit ? `
    ${secretScripts()}
    <script>
    // Key group expansion toggle (used by dynamically loaded secrets preview)
    function toggleKeyExpansion(id) {
      const container = document.getElementById(id);
      const btn = event.target;
      if (container.style.display === 'none') {
        container.style.display = 'block';
        btn.textContent = '▲';
      } else {
        container.style.display = 'none';
        btn.textContent = '▼';
      }
    }

    async function loadSecretsPreview(functionId) {
      const btn = document.getElementById('secrets-preview-btn');
      const container = document.getElementById('secrets-preview-container');

      // Show loading state
      btn.disabled = true;
      btn.textContent = 'Loading...';
      container.innerHTML = '<p><em>Loading secrets preview...</em></p>';

      try {
        const response = await fetch('/web/functions/preview-secrets/' + functionId);

        if (!response.ok) {
          throw new Error('Failed to load secrets preview');
        }

        const html = await response.text();
        container.innerHTML = html;

        // Update button to "Refresh"
        btn.textContent = 'Refresh Preview';
        btn.setAttribute('data-loaded', 'true');
      } catch (error) {
        console.error('Error loading secrets preview:', error);
        container.innerHTML = '<p style="color: #dc3545;"><em>Error loading secrets preview. Please try again.</em></p>';
        btn.textContent = 'Show Secrets Preview';
      } finally {
        btn.disabled = false;
      }
    }
    </script>
    ` : ''}
  `;
}

function parseFormData(formData: FormData): {
  route: NewFunctionRoute;
  errors: string[];
} {
  const errors: string[] = [];

  const name = formData.get("name")?.toString().trim() ?? "";
  const description = formData.get("description")?.toString().trim() || undefined;
  const handler = formData.get("handler")?.toString().trim() ?? "";
  const routePath = formData.get("route")?.toString().trim() ?? "";

  // Handle methods - use getAll for multiple checkbox values
  const methods = formData.getAll("methods").map((m) => m.toString());

  // Handle keys - use getAll for multiple checkbox values (values are group IDs)
  const keysArray = formData.getAll("keys")
    .map((k) => parseInt(k.toString(), 10))
    .filter((id) => !isNaN(id) && id > 0);

  // Validation
  if (!validateRouteName(name)) {
    errors.push("Name is required");
  }

  if (!handler) {
    errors.push("Handler path is required");
  }

  if (!validateRoutePath(routePath)) {
    errors.push("Route path must start with / and not contain //");
  }

  if (!validateMethods(methods)) {
    errors.push("At least one valid HTTP method must be selected");
  }

  // Keys are optional - only include if any selected
  const keys = keysArray.length > 0 ? keysArray : undefined;

  const route: NewFunctionRoute = {
    name,
    description,
    handler,
    route: routePath,
    methods,
    keys,
  };

  return { route, errors };
}

/**
 * Renders the secrets table with show/hide and copy functionality
 */
function renderSecretsTable(secrets: Secret[], functionId: number): string {
  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th>Comment</th>
          <th>Created</th>
          <th>Modified</th>
          <th class="actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${secrets
          .map(
            (secret) => `
          <tr>
            <td><code>${escapeHtml(secret.name)}</code></td>
            <td class="secret-value">
              ${
                secret.decryptionError
                  ? `<span style="color: #d32f2f;" title="${escapeHtml(secret.decryptionError)}">⚠️ Decryption failed</span>`
                  : `
                <span class="masked">••••••••</span>
                <span class="revealed" style="display:none;">
                  <code>${escapeHtml(secret.value)}</code>
                </span>
                <button type="button" onclick="toggleSecret(this)"
                        class="secondary" style="padding: 0.25rem 0.5rem; margin-left: 0.5rem;">
                  👁️
                </button>
                <button type="button" onclick="copySecret(this, '${escapeHtml(secret.value).replace(/'/g, "\\'")}')"
                        class="secondary" style="padding: 0.25rem 0.5rem;">
                  📋
                </button>
              `
              }
            </td>
            <td>${secret.comment ? escapeHtml(secret.comment) : "<em>—</em>"}</td>
            <td>${formatDate(new Date(secret.createdAt))}</td>
            <td>${formatDate(new Date(secret.updatedAt))}</td>
            <td class="actions">
              ${secret.decryptionError ? "" : `<a href="/web/functions/secrets/${functionId}/edit/${secret.id}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>`}
              <a href="/web/functions/secrets/${functionId}/delete/${secret.id}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>

    ${secretScripts()}
  `;
}

/**
 * Renders the create secret form
 */
function renderFunctionSecretCreateForm(
  functionId: number,
  data: { name?: string; value?: string; comment?: string } = {},
  error?: string
): string {
  return `
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="/web/functions/secrets/${functionId}/create">
      <label>
        Secret Name *
        <input type="text" name="name" value="${escapeHtml(data.name ?? "")}"
               required autofocus
               placeholder="MY_SECRET_KEY" />
        <small>Letters, numbers, underscores, and dashes only</small>
      </label>
      <label>
        Secret Value *
        <textarea name="value" required
                  placeholder="your-secret-value"
                  rows="4">${escapeHtml(data.value ?? "")}</textarea>
        <small>Encrypted at rest using AES-256-GCM</small>
      </label>
      <label>
        Comment
        <input type="text" name="comment" value="${escapeHtml(data.comment ?? "")}"
               placeholder="Optional description" />
        <small>Helps identify the purpose of this secret</small>
      </label>
      <div class="grid" style="margin-bottom: 0;">
        <button type="submit" style="margin-bottom: 0;">Create Secret</button>
        <a href="/web/functions/secrets/${functionId}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
  `;
}

/**
 * Renders the edit secret form
 */
function renderFunctionSecretEditForm(
  functionId: number,
  secret: { id: number; name: string; value: string; comment: string | null; decryptionError?: string },
  error?: string
): string {
  return `
    ${error ? flashMessages(undefined, error) : ""}
    <form method="POST" action="/web/functions/secrets/${functionId}/edit/${secret.id}">
      <label>
        Secret Name
        <input type="text" value="${escapeHtml(secret.name)}" disabled />
        <small>Secret names cannot be changed</small>
      </label>
      <label>
        Secret Value *
        <textarea name="value" required
                  placeholder="your-secret-value"
                  rows="4">${escapeHtml(secret.value)}</textarea>
        <small>Encrypted at rest using AES-256-GCM</small>
      </label>
      <label>
        Comment
        <input type="text" name="comment" value="${escapeHtml(secret.comment ?? "")}"
               placeholder="Optional description" />
        <small>Helps identify the purpose of this secret</small>
      </label>
      <div class="grid" style="margin-bottom: 0;">
        <button type="submit" style="margin-bottom: 0;">Save Changes</button>
        <a href="/web/functions/secrets/${functionId}" role="button" class="secondary" style="margin-bottom: 0;">Cancel</a>
      </div>
    </form>
  `;
}

export function createFunctionsPages(
  routesService: RoutesService,
  consoleLogService: ConsoleLogService,
  executionMetricsService: ExecutionMetricsService,
  apiKeyService: ApiKeyService,
  secretsService: SecretsService,
  settingsService: SettingsService
): Hono {
  const routes = new Hono();

  // Helper function to render key group names for a function route
  async function renderKeyGroupNames(keyIds: number[] | undefined): Promise<string> {
    if (!keyIds || keyIds.length === 0) {
      return "<em>none</em>";
    }

    const groupNames = await Promise.all(
      keyIds.map(async (id) => {
        const group = await apiKeyService.getGroupById(id);
        return group ? group.name : `Unknown(${id})`;
      })
    );

    return escapeHtml(groupNames.join(", "));
  }

  // List all functions
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const allRoutes = await routesService.getAll();

    // Pre-render key group names for all routes
    const routesWithGroupNames = await Promise.all(
      allRoutes.map(async (route) => ({
        ...route,
        keyGroupNames: await renderKeyGroupNames(route.keys),
      }))
    );

    const content = `
      <style>
        .toggle-switch {
          cursor: pointer;
          user-select: none;
          font-size: 1.5rem;
          transition: opacity 0.2s;
        }
        .toggle-switch:hover {
          opacity: 0.7;
        }
        .status-badge {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.85rem;
          font-weight: bold;
        }
        .status-enabled {
          background-color: #d4edda;
          color: #155724;
        }
        .status-disabled {
          background-color: #f8d7da;
          color: #721c24;
        }
      </style>
      <h1>Functions</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/functions/create", "Create New Function")}
      </p>
      ${
        routesWithGroupNames.length === 0
          ? "<p>No functions registered.</p>"
          : `
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Route</th>
              <th>Methods</th>
              <th>Keys</th>
              <th>Description</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${routesWithGroupNames
              .map(
                (fn) => `
              <tr id="route-row-${fn.id}">
                <td style="text-align: center;">
                  <span
                    class="toggle-switch"
                    id="toggle-${fn.id}"
                    onclick="toggleRoute(${fn.id})"
                    title="Click to ${fn.enabled ? 'disable' : 'enable'}"
                  >${fn.enabled ? '✅' : '❌'}</span>
                </td>
                <td><strong>${escapeHtml(fn.name)}</strong></td>
                <td><code>${escapeHtml(fn.route)}</code></td>
                <td>${renderMethodBadges(fn.methods)}</td>
                <td>${fn.keyGroupNames}</td>
                <td>${fn.description ? escapeHtml(fn.description) : ""}</td>
                <td class="actions">
                  <a href="/web/functions/logs/${fn.id}" title="Logs" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">📝</a>
                  <a href="/web/functions/metrics/${fn.id}" title="Metrics" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">📊</a>
                  <a href="/web/functions/secrets/${fn.id}" title="Secrets" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">🔐</a>
                  <a href="/web/functions/edit/${fn.id}" title="Edit" style="text-decoration: none; font-size: 1.2rem; margin-right: 0.5rem;">✏️</a>
                  <a href="/web/functions/delete/${fn.id}" title="Delete" style="color: #d32f2f; text-decoration: none; font-size: 1.2rem;">❌</a>
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        <script>
          async function toggleRoute(id) {
            const toggleEl = document.getElementById('toggle-' + id);
            const originalContent = toggleEl.textContent;

            // Determine current state and calculate new state
            const currentEnabled = originalContent === '✅';
            const newEnabled = !currentEnabled;

            // Show loading state
            toggleEl.textContent = '⏳';
            toggleEl.style.cursor = 'wait';

            try {
              const endpoint = newEnabled
                ? '/api/functions/' + id + '/enable'
                : '/api/functions/' + id + '/disable';
              const response = await fetch(endpoint, { method: 'PUT' });

              if (!response.ok) {
                throw new Error('Failed to update function');
              }

              const data = await response.json();

              // Update UI
              toggleEl.textContent = data.function.enabled ? '✅' : '❌';
              toggleEl.title = 'Click to ' + (data.function.enabled ? 'disable' : 'enable');
              toggleEl.style.cursor = 'pointer';
            } catch (error) {
              console.error('Error toggling function:', error);
              alert('Failed to toggle function. Please try again.');
              toggleEl.textContent = originalContent;
              toggleEl.style.cursor = 'pointer';
            }
          }
        </script>
      `
      }
    `;
    return c.html(await layout("Functions", content, getLayoutUser(c), settingsService));
  });

  // Create form
  routes.get("/create", async (c) => {
    const error = c.req.query("error");
    const groups = await apiKeyService.getGroups();
    return c.html(await layout("Create Function", renderFunctionForm("/web/functions/create", {}, groups, error), getLayoutUser(c), settingsService));
  });

  // Handle create
  routes.post("/create", async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect("/web/functions/create?error=" + encodeURIComponent("Invalid form data"));
    }

    const { route, errors } = parseFormData(formData);
    const groups = await apiKeyService.getGroups();

    if (errors.length > 0) {
      return c.html(
        layout("Create Function", renderFunctionForm("/web/functions/create", route, groups, errors.join(". ")), getLayoutUser(c), settingsService),
        400
      );
    }

    try {
      await routesService.addRoute(route);
      return c.redirect("/web/functions?success=" + encodeURIComponent(`Function created: ${route.name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create function";
      return c.html(
        layout("Create Function", renderFunctionForm("/web/functions/create", route, groups, message), getLayoutUser(c), settingsService),
        400
      );
    }
  });

  // Edit form
  routes.get("/edit/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    const error = c.req.query("error");

    if (id === null) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Invalid function ID"));
    }

    const route = await routesService.getById(id);
    if (!route) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Function not found"));
    }

    const groups = await apiKeyService.getGroups();
    return c.html(
      layout(
        `Edit: ${route.name}`,
        renderFunctionForm(`/web/functions/edit/${id}`, route, groups, error),
        getLayoutUser(c), settingsService
      )
    );
  });

  // Handle edit (update in place)
  routes.post("/edit/:id", async (c) => {
    const id = validateId(c.req.param("id"));

    if (id === null) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Invalid function ID"));
    }

    // Verify route exists
    const existingRoute = await routesService.getById(id);
    if (!existingRoute) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Function not found"));
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/functions/edit/${id}?error=` + encodeURIComponent("Invalid form data")
      );
    }

    const { route, errors } = parseFormData(formData);
    const groups = await apiKeyService.getGroups();

    if (errors.length > 0) {
      // Need to include id for the form template to detect edit mode
      const routeWithId = { ...route, id };
      return c.html(
        layout(
          `Edit: ${existingRoute.name}`,
          renderFunctionForm(`/web/functions/edit/${id}`, routeWithId, groups, errors.join(". ")),
          getLayoutUser(c), settingsService
        ),
        400
      );
    }

    try {
      // Update route in place - preserves ID and associated logs/metrics
      await routesService.updateRoute(id, route);
      return c.redirect("/web/functions?success=" + encodeURIComponent(`Function updated: ${route.name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update function";
      const routeWithId = { ...route, id };
      return c.html(
        layout(
          `Edit: ${existingRoute.name}`,
          renderFunctionForm(`/web/functions/edit/${id}`, routeWithId, groups, message),
          getLayoutUser(c), settingsService
        ),
        400
      );
    }
  });

  // Preview secrets for a function (returns HTML fragment)
  routes.get("/preview-secrets/:id", async (c) => {
    const id = validateId(c.req.param("id"));

    if (id === null) {
      return c.text("Invalid function ID", 400);
    }

    // Get the function route to determine accepted groups
    const route = await routesService.getById(id);
    if (!route) {
      return c.text("Function not found", 404);
    }

    // Get secrets preview
    const acceptedGroups = route.keys || [];
    const previews = await secretsService.getSecretsPreviewForFunction(id, acceptedGroups);

    // Return HTML fragment (not full page layout)
    return c.html(renderSecretsPreview(previews));
  });

  // Delete confirmation
  routes.get("/delete/:id", async (c) => {
    const id = validateId(c.req.param("id"));

    if (id === null) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Invalid function ID"));
    }

    const route = await routesService.getById(id);
    if (!route) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Function not found"));
    }

    return c.html(
      confirmPage(
        "Delete Function",
        `Are you sure you want to delete the function "${route.name}"? This action cannot be undone.`,
        `/web/functions/delete/${id}`,
        "/web/functions",
        getLayoutUser(c), settingsService
      )
    );
  });

  // Handle delete
  routes.post("/delete/:id", async (c) => {
    const id = validateId(c.req.param("id"));

    if (id === null) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Invalid function ID"));
    }

    // Get the route name for the success message before deletion
    const route = await routesService.getById(id);
    const routeName = route?.name ?? `ID ${id}`;

    try {
      await routesService.removeRouteById(id);
      return c.redirect("/web/functions?success=" + encodeURIComponent(`Function deleted: ${routeName}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete function";
      return c.redirect("/web/functions?error=" + encodeURIComponent(message));
    }
  });

  // View logs for a function
  routes.get("/logs/:id", async (c) => {
    const id = validateId(c.req.param("id"));

    if (id === null) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Invalid function ID"));
    }

    const route = await routesService.getById(id);
    if (!route) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Function not found"));
    }

    // Parse pagination params
    const limitParam = c.req.query("limit");
    const beforeIdParam = c.req.query("before_id");
    const validLimits = [50, 100, 250, 500, 1000];
    const limit = limitParam && validLimits.includes(parseInt(limitParam, 10))
      ? parseInt(limitParam, 10)
      : 100;
    const beforeId = beforeIdParam ? parseInt(beforeIdParam, 10) : null;

    // Get logs - either newest or before a specific log id
    const logs = beforeId
      ? await consoleLogService.getByRouteIdBeforeId(id, beforeId, limit)
      : await consoleLogService.getByRouteId(id, limit);

    // Get oldest log id for next page navigation
    const oldestLogId = logs.length > 0
      ? logs[logs.length - 1].id
      : null;

    const content = renderLogsPage(route.name, id, logs, {
      limit,
      beforeId,
      oldestLogId,
      hasMore: logs.length === limit,
    });
    return c.html(await layout(`Logs: ${route.name}`, content, getLayoutUser(c), settingsService));
  });

  // View global (server-wide) metrics
  routes.get("/metrics/global", async (c) => {
    const modeParam = c.req.query("mode") || "hour";

    // Validate mode
    const validModes: MetricsDisplayMode[] = ["hour", "day", "days"];
    const mode: MetricsDisplayMode = validModes.includes(modeParam as MetricsDisplayMode)
      ? (modeParam as MetricsDisplayMode)
      : "hour";

    // Get retention days from settings
    const retentionDaysStr = await settingsService.getGlobalSetting(SettingNames.METRICS_RETENTION_DAYS);
    const retentionDays = retentionDaysStr ? parseInt(retentionDaysStr, 10) : 90;

    // Fetch global metrics data (routeId = null)
    const dataPoints = await fetchMetricsData(
      executionMetricsService,
      null,
      mode,
      retentionDays
    );

    // Calculate summary
    const summary = calculateSummary(dataPoints);

    // Get all functions for source selector
    const allFunctions = await routesService.getAll();

    const content = renderMetricsPage(
      "Global metrics",
      null,
      mode,
      dataPoints,
      summary,
      retentionDays,
      allFunctions
    );

    return c.html(await layout("Metrics: Global metrics", content, getLayoutUser(c), settingsService));
  });

  // View metrics for a function
  routes.get("/metrics/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    const modeParam = c.req.query("mode") || "hour";

    // Validate mode
    const validModes: MetricsDisplayMode[] = ["hour", "day", "days"];
    const mode: MetricsDisplayMode = validModes.includes(modeParam as MetricsDisplayMode)
      ? (modeParam as MetricsDisplayMode)
      : "hour";

    if (id === null) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Invalid function ID"));
    }

    const route = await routesService.getById(id);
    if (!route) {
      return c.redirect("/web/functions?error=" + encodeURIComponent("Function not found"));
    }

    // Get retention days from settings
    const retentionDaysStr = await settingsService.getGlobalSetting(SettingNames.METRICS_RETENTION_DAYS);
    const retentionDays = retentionDaysStr ? parseInt(retentionDaysStr, 10) : 90;

    // Fetch metrics data
    const dataPoints = await fetchMetricsData(
      executionMetricsService,
      id,
      mode,
      retentionDays
    );

    // Calculate summary
    const summary = calculateSummary(dataPoints);

    // Get all functions for source selector
    const allFunctions = await routesService.getAll();

    const content = renderMetricsPage(
      route.name,
      id,
      mode,
      dataPoints,
      summary,
      retentionDays,
      allFunctions
    );

    return c.html(await layout(`Metrics: ${route.name}`, content, getLayoutUser(c), settingsService));
  });

  // ============== Function Secrets Management ==============

  // GET /secrets/:id - List secrets for function
  routes.get("/secrets/:id", async (c) => {
    const idParam = c.req.param("id");
    const functionId = parseInt(idParam);

    if (isNaN(functionId)) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Invalid function ID")
      );
    }

    // Verify function exists
    const route = await routesService.getById(functionId);
    if (!route) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Function not found")
      );
    }

    const success = c.req.query("success");
    const error = c.req.query("error");

    // Load secrets for this function
    const secrets = await secretsService.getFunctionSecrets(functionId);

    const content = `
      <h1>Secrets for ${escapeHtml(route.name)}</h1>
      <p>
        <a href="/web/functions" role="button" class="secondary">
          ← Back to Functions
        </a>
      </p>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink(
          `/web/functions/secrets/${functionId}/create`,
          "Create New Secret"
        )}
      </p>
      ${
        secrets.length === 0
          ? "<p>No secrets configured for this function. Create your first secret to get started.</p>"
          : renderSecretsTable(secrets, functionId)
      }
    `;

    return c.html(
      layout(`Secrets: ${route.name}`, content, getLayoutUser(c), settingsService)
    );
  });

  // GET /secrets/:id/create - Create secret form
  routes.get("/secrets/:id/create", async (c) => {
    const idParam = c.req.param("id");
    const functionId = parseInt(idParam);

    if (isNaN(functionId)) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Invalid function ID")
      );
    }

    const route = await routesService.getById(functionId);
    if (!route) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Function not found")
      );
    }

    const error = c.req.query("error");

    const content = `
      <h1>Create Secret for ${escapeHtml(route.name)}</h1>
      <p>
        <a href="/web/functions/secrets/${functionId}" role="button" class="secondary">
          ← Back to Secrets
        </a>
      </p>
      ${renderFunctionSecretCreateForm(functionId, {}, error)}
    `;

    return c.html(
      layout(`Create Secret: ${route.name}`, content, getLayoutUser(c), settingsService)
    );
  });

  // POST /secrets/:id/create - Handle secret creation
  routes.post("/secrets/:id/create", async (c) => {
    const idParam = c.req.param("id");
    const functionId = parseInt(idParam);

    if (isNaN(functionId)) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Invalid function ID")
      );
    }

    const route = await routesService.getById(functionId);
    if (!route) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Function not found")
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/functions/secrets/${functionId}/create?error=` +
          encodeURIComponent("Invalid form data")
      );
    }

    const { secretData, errors } = parseSecretFormData(formData);

    if (errors.length > 0) {
      const content = `
        <h1>Create Secret for ${escapeHtml(route.name)}</h1>
        <p>
          <a href="/web/functions/secrets/${functionId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderFunctionSecretCreateForm(functionId, secretData, errors.join(". "))}
      `;
      return c.html(
        layout(`Create Secret: ${route.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }

    try {
      await secretsService.createFunctionSecret(
        functionId,
        secretData.name,
        secretData.value,
        secretData.comment || undefined
      );

      return c.redirect(
        `/web/functions/secrets/${functionId}?success=` +
          encodeURIComponent(`Secret created: ${secretData.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create secret";
      const content = `
        <h1>Create Secret for ${escapeHtml(route.name)}</h1>
        <p>
          <a href="/web/functions/secrets/${functionId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderFunctionSecretCreateForm(functionId, secretData, message)}
      `;
      return c.html(
        layout(`Create Secret: ${route.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }
  });

  // GET /secrets/:id/edit/:secretId - Edit secret form
  routes.get("/secrets/:id/edit/:secretId", async (c) => {
    const idParam = c.req.param("id");
    const secretIdParam = c.req.param("secretId");
    const functionId = parseInt(idParam);
    const secretId = parseInt(secretIdParam);

    if (isNaN(functionId) || isNaN(secretId)) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const route = await routesService.getById(functionId);
    if (!route) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Function not found")
      );
    }

    const secret = await secretsService.getFunctionSecretById(
      functionId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/functions/secrets/${functionId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    const error = c.req.query("error");

    const content = `
      <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
      <p>
        <a href="/web/functions/secrets/${functionId}" role="button" class="secondary">
          ← Back to Secrets
        </a>
      </p>
      ${renderFunctionSecretEditForm(functionId, secret, error)}
    `;

    return c.html(
      layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService)
    );
  });

  // POST /secrets/:id/edit/:secretId - Handle secret update
  routes.post("/secrets/:id/edit/:secretId", async (c) => {
    const idParam = c.req.param("id");
    const secretIdParam = c.req.param("secretId");
    const functionId = parseInt(idParam);
    const secretId = parseInt(secretIdParam);

    if (isNaN(functionId) || isNaN(secretId)) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const route = await routesService.getById(functionId);
    if (!route) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Function not found")
      );
    }

    const secret = await secretsService.getFunctionSecretById(
      functionId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/functions/secrets/${functionId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.redirect(
        `/web/functions/secrets/${functionId}/edit/${secretId}?error=` +
          encodeURIComponent("Invalid form data")
      );
    }

    const { editData, errors } = parseSecretEditFormData(formData);

    if (errors.length > 0) {
      const content = `
        <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
        <p>
          <a href="/web/functions/secrets/${functionId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderFunctionSecretEditForm(
          functionId,
          { ...secret, ...editData },
          errors.join(". ")
        )}
      `;
      return c.html(
        layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }

    try {
      await secretsService.updateFunctionSecret(
        functionId,
        secretId,
        editData.value,
        editData.comment || undefined
      );

      return c.redirect(
        `/web/functions/secrets/${functionId}?success=` +
          encodeURIComponent(`Secret updated: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update secret";
      const content = `
        <h1>Edit Secret: ${escapeHtml(secret.name)}</h1>
        <p>
          <a href="/web/functions/secrets/${functionId}" role="button" class="secondary">
            ← Back to Secrets
          </a>
        </p>
        ${renderFunctionSecretEditForm(
          functionId,
          { ...secret, ...editData },
          message
        )}
      `;
      return c.html(
        layout(`Edit Secret: ${secret.name}`, content, getLayoutUser(c), settingsService),
        400
      );
    }
  });

  // GET /secrets/:id/delete/:secretId - Delete confirmation
  routes.get("/secrets/:id/delete/:secretId", async (c) => {
    const idParam = c.req.param("id");
    const secretIdParam = c.req.param("secretId");
    const functionId = parseInt(idParam);
    const secretId = parseInt(secretIdParam);

    if (isNaN(functionId) || isNaN(secretId)) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const route = await routesService.getById(functionId);
    if (!route) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Function not found")
      );
    }

    const secret = await secretsService.getFunctionSecretById(
      functionId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/functions/secrets/${functionId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    return c.html(
      confirmPage(
        "Delete Secret",
        `Are you sure you want to delete the secret "<strong>${escapeHtml(secret.name)}</strong>" from function "${escapeHtml(route.name)}"? This action cannot be undone.`,
        `/web/functions/secrets/${functionId}/delete/${secretId}`,
        `/web/functions/secrets/${functionId}`,
        getLayoutUser(c), settingsService
      )
    );
  });

  // POST /secrets/:id/delete/:secretId - Handle deletion
  routes.post("/secrets/:id/delete/:secretId", async (c) => {
    const idParam = c.req.param("id");
    const secretIdParam = c.req.param("secretId");
    const functionId = parseInt(idParam);
    const secretId = parseInt(secretIdParam);

    if (isNaN(functionId) || isNaN(secretId)) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Invalid ID")
      );
    }

    const route = await routesService.getById(functionId);
    if (!route) {
      return c.redirect(
        "/web/functions?error=" + encodeURIComponent("Function not found")
      );
    }

    const secret = await secretsService.getFunctionSecretById(
      functionId,
      secretId
    );
    if (!secret) {
      return c.redirect(
        `/web/functions/secrets/${functionId}?error=` +
          encodeURIComponent("Secret not found")
      );
    }

    try {
      await secretsService.deleteFunctionSecret(functionId, secretId);

      return c.redirect(
        `/web/functions/secrets/${functionId}?success=` +
          encodeURIComponent(`Secret deleted: ${secret.name}`)
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete secret";
      return c.redirect(
        `/web/functions/secrets/${functionId}?error=` +
          encodeURIComponent(message)
      );
    }
  });

  return routes;
}
