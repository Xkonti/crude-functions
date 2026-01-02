import { Hono } from "@hono/hono";
import type { RoutesService, FunctionRoute, NewFunctionRoute } from "../routes/routes_service.ts";
import {
  validateRouteName,
  validateRoutePath,
  validateMethods,
} from "../routes/routes_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ConsoleLog } from "../logs/types.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import type { ExecutionMetric, MetricType } from "../metrics/types.ts";
import {
  layout,
  escapeHtml,
  flashMessages,
  confirmPage,
  buttonLink,
} from "./templates.ts";
import { validateId } from "../utils/validation.ts";

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
    .map((m) => `<span class="method-badge">${escapeHtml(m)}</span>`)
    .join(" ");
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

function formatTimestampFull(date: Date): string {
  return date.toISOString().replace("T", " ").substring(0, 23);
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
 */
async function calculateCurrentPeriodMetric(
  metricsService: ExecutionMetricsService,
  routeId: number,
  mode: MetricsDisplayMode,
  now: Date
): Promise<ExecutionMetric | null> {
  const allMetrics: ExecutionMetric[] = [];

  // Use end time slightly in the future to include records at exactly 'now'
  // (getByRouteIdTypeAndTimeRange uses exclusive end: timestamp < end)
  const endTime = new Date(now.getTime() + 1000);

  // Always get execution records for current minute (unprocessed raw executions)
  const currentMinuteStart = floorToMinute(now);
  const executionRecords = await metricsService.getByRouteIdTypeAndTimeRange(
    routeId,
    "execution",
    currentMinuteStart,
    endTime
  );
  allMetrics.push(...executionRecords);

  if (mode === "day" || mode === "days") {
    // For day/days mode: also get minute records for current hour
    const currentHourStart = floorToHour(now);
    const minuteRecords = await metricsService.getByRouteIdTypeAndTimeRange(
      routeId,
      "minute",
      currentHourStart,
      endTime
    );
    allMetrics.push(...minuteRecords);
  }

  if (mode === "days") {
    // For days mode: also get hour records for current day
    const currentDayStart = floorToDay(now);
    const hourRecords = await metricsService.getByRouteIdTypeAndTimeRange(
      routeId,
      "hour",
      currentDayStart,
      endTime
    );
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
 * Fetch metrics data for the specified mode and prepare chart data points.
 */
async function fetchMetricsData(
  metricsService: ExecutionMetricsService,
  routeId: number,
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

  // Fetch historical data
  const metrics = await metricsService.getByRouteIdTypeAndTimeRange(
    routeId,
    sourceType,
    startTime,
    now
  );

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

  // Generate all expected time slots
  const dataPoints: ChartDataPoint[] = [];
  for (let i = expectedPoints - 1; i >= 0; i--) {
    const slotTime = getSlotTime(now, mode, i);
    const key = getTimePeriodKey(slotTime, mode);
    const metric = dataMap.get(key);
    const isCurrent = i === 0;

    if (isCurrent && currentMetric) {
      dataPoints.push({
        label: formatMetricsTimeLabel(slotTime, mode),
        timestamp: slotTime,
        avgTimeMs: currentMetric.avgTimeMs,
        maxTimeMs: currentMetric.maxTimeMs,
        executionCount: currentMetric.executionCount,
        isCurrent: true,
      });
    } else if (metric) {
      dataPoints.push({
        label: formatMetricsTimeLabel(slotTime, mode),
        timestamp: slotTime,
        avgTimeMs: metric.avgTimeMs,
        maxTimeMs: metric.maxTimeMs,
        executionCount: metric.executionCount,
        isCurrent: false,
      });
    } else {
      // Empty period - show as 0
      dataPoints.push({
        label: formatMetricsTimeLabel(slotTime, mode),
        timestamp: slotTime,
        avgTimeMs: 0,
        maxTimeMs: 0,
        executionCount: 0,
        isCurrent: isCurrent,
      });
    }
  }

  return dataPoints;
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
        <strong>${formatTimestampFull(logs[logs.length - 1].timestamp)}</strong> to <strong>${formatTimestampFull(logs[0].timestamp)}</strong>.
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
                return `
            <tr class="log-row" onclick="toggleLogDetail(${i})">
              <td><code title="${escapeHtml(formatTimestampFull(log.timestamp))}">${formatTimeShort(log.timestamp)}</code></td>
              <td>${renderLogLevelBadge(log.level)}</td>
              <td><code class="request-id-copy" title="Click to copy: ${escapeHtml(log.requestId)}" onclick="copyRequestId(event, '${escapeHtml(log.requestId)}')">${escapeHtml(requestIdShort)}</code></td>
              <td class="log-message">${escapeHtml(log.message).substring(0, 120)}${log.message.length > 120 ? "..." : ""}</td>
            </tr>
            <tr id="detail-${i}" class="log-detail">
              <td colspan="4"><pre>${escapeHtml(fullMessage)}</pre></td>
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
  routeId: number,
  mode: MetricsDisplayMode,
  dataPoints: ChartDataPoint[],
  summary: MetricsSummary,
  retentionDays: number
): string {
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
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.1)',
                tension: 0.1,
                fill: true,
                pointBackgroundColor: currentFlags.map((c) => c ? 'rgb(255, 159, 64)' : 'rgb(75, 192, 192)'),
                pointBorderColor: currentFlags.map((c) => c ? 'rgb(255, 159, 64)' : 'rgb(75, 192, 192)'),
                pointRadius: currentFlags.map((c) => c ? 6 : 3),
              },
              {
                label: 'Max Time (ms)',
                data: maxTimes,
                borderColor: 'rgb(255, 99, 132)',
                backgroundColor: 'rgba(255, 99, 132, 0.1)',
                tension: 0.1,
                fill: false,
                pointBackgroundColor: currentFlags.map((c) => c ? 'rgb(255, 159, 64)' : 'rgb(255, 99, 132)'),
                pointBorderColor: currentFlags.map((c) => c ? 'rgb(255, 159, 64)' : 'rgb(255, 99, 132)'),
                pointRadius: currentFlags.map((c) => c ? 6 : 3),
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

        // Request Count Chart
        const countCtx = document.getElementById('requestCountChart').getContext('2d');
        new Chart(countCtx, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [{
              label: 'Executions',
              data: execCounts,
              backgroundColor: currentFlags.map((c) => c ? 'rgba(255, 159, 64, 0.8)' : 'rgba(54, 162, 235, 0.8)'),
              borderColor: currentFlags.map((c) => c ? 'rgb(255, 159, 64)' : 'rgb(54, 162, 235)'),
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

  return `
    ${styles}
    <h1>Metrics: ${escapeHtml(functionName)}</h1>

    <div class="grid" style="margin-bottom: 1rem;">
      <div>
        <a href="/web/functions" role="button" class="secondary outline">&larr; Back to Functions</a>
      </div>
      <div style="text-align: right;">
        <a href="/web/functions/metrics/${routeId}?mode=${mode}" role="button" class="outline">Refresh</a>
      </div>
    </div>

    <div class="metrics-tabs">
      <a href="/web/functions/metrics/${routeId}?mode=hour" class="${mode === "hour" ? "active" : ""}">Last Hour</a>
      <a href="/web/functions/metrics/${routeId}?mode=day" class="${mode === "day" ? "active" : ""}">Last 24 Hours</a>
      <a href="/web/functions/metrics/${routeId}?mode=days" class="${mode === "days" ? "active" : ""}">Last ${retentionDays} Days</a>
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
        Empty periods show as 0 values.
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
  error?: string
): string {
  const isEdit = route.id !== undefined;

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
      <label>
        Required API Keys
        <input type="text" name="keys" value="${escapeHtml((route.keys ?? []).join(", "))}"
               placeholder="api-key, admin-key">
        <small>Comma-separated list of key names required to access this function (optional)</small>
      </label>
      <div class="grid">
        <button type="submit">${isEdit ? "Save Changes" : "Create Function"}</button>
        <a href="/web/functions" role="button" class="secondary">Cancel</a>
      </div>
    </form>
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
  const keysStr = formData.get("keys")?.toString().trim() ?? "";

  // Handle methods - use getAll for multiple checkbox values
  const methods = formData.getAll("methods").map((m) => m.toString());

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

  // Parse keys
  const keys = keysStr
    ? keysStr.split(",").map((k) => k.trim()).filter((k) => k.length > 0)
    : undefined;

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

export function createFunctionsPages(
  routesService: RoutesService,
  consoleLogService: ConsoleLogService,
  executionMetricsService: ExecutionMetricsService
): Hono {
  const routes = new Hono();

  // List all functions
  routes.get("/", async (c) => {
    const success = c.req.query("success");
    const error = c.req.query("error");
    const allRoutes = await routesService.getAll();

    const content = `
      <h1>Functions</h1>
      ${flashMessages(success, error)}
      <p>
        ${buttonLink("/web/functions/create", "Create New Function")}
      </p>
      ${
        allRoutes.length === 0
          ? "<p>No functions registered.</p>"
          : `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Route</th>
              <th>Methods</th>
              <th>Keys</th>
              <th>Description</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${allRoutes
              .map(
                (fn) => `
              <tr>
                <td><strong>${escapeHtml(fn.name)}</strong></td>
                <td><code>${escapeHtml(fn.route)}</code></td>
                <td><div class="methods">${renderMethodBadges(fn.methods)}</div></td>
                <td>${fn.keys ? escapeHtml(fn.keys.join(", ")) : "<em>none</em>"}</td>
                <td>${fn.description ? escapeHtml(fn.description) : ""}</td>
                <td class="actions">
                  <a href="/web/functions/logs/${fn.id}">Logs</a>
                  <a href="/web/functions/metrics/${fn.id}">Metrics</a>
                  <a href="/web/functions/edit/${fn.id}">Edit</a>
                  <a href="/web/functions/delete/${fn.id}">Delete</a>
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      `
      }
    `;
    return c.html(layout("Functions", content));
  });

  // Create form
  routes.get("/create", (c) => {
    const error = c.req.query("error");
    return c.html(layout("Create Function", renderFunctionForm("/web/functions/create", {}, error)));
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

    if (errors.length > 0) {
      return c.html(
        layout("Create Function", renderFunctionForm("/web/functions/create", route, errors.join(". "))),
        400
      );
    }

    try {
      await routesService.addRoute(route);
      return c.redirect("/web/functions?success=" + encodeURIComponent(`Function created: ${route.name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create function";
      return c.html(
        layout("Create Function", renderFunctionForm("/web/functions/create", route, message)),
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

    return c.html(
      layout(
        `Edit: ${route.name}`,
        renderFunctionForm(`/web/functions/edit/${id}`, route, error)
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

    if (errors.length > 0) {
      // Need to include id for the form template to detect edit mode
      const routeWithId = { ...route, id };
      return c.html(
        layout(
          `Edit: ${existingRoute.name}`,
          renderFunctionForm(`/web/functions/edit/${id}`, routeWithId, errors.join(". "))
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
          renderFunctionForm(`/web/functions/edit/${id}`, routeWithId, message)
        ),
        400
      );
    }
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
        "/web/functions"
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
    return c.html(layout(`Logs: ${route.name}`, content));
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

    // Get retention days from environment (matching main.ts)
    const retentionDays = parseInt(Deno.env.get("METRICS_RETENTION_DAYS") || "90");

    // Fetch metrics data
    const dataPoints = await fetchMetricsData(
      executionMetricsService,
      id,
      mode,
      retentionDays
    );

    // Calculate summary
    const summary = calculateSummary(dataPoints);

    const content = renderMetricsPage(
      route.name,
      id,
      mode,
      dataPoints,
      summary,
      retentionDays
    );

    return c.html(layout(`Metrics: ${route.name}`, content));
  });

  return routes;
}
