---
title: Metrics
description: Function execution metrics and performance monitoring
---

Crude Functions automatically collects execution metrics for all function invocations, providing insights into performance, request volumes, and execution patterns. This guide explains what metrics are collected, how they're aggregated, and how to access them.

## What Metrics Are Collected

Every function execution automatically records:

- **Execution Count** - Total number of function invocations
- **Average Execution Time** - Weighted average execution time in milliseconds
- **Maximum Execution Time** - Peak execution time in milliseconds
- **Timestamp** - When the metrics were recorded (UTC)

These metrics are collected for:
- **Per-function metrics** - Track individual function performance
- **Global metrics** - Aggregate performance across all functions

**No configuration required** - metrics collection starts automatically when you deploy functions.

## Time Resolutions

Metrics are aggregated at three time resolutions to balance detail with storage efficiency:

### Minutes
- **Granularity**: 1 data point per minute
- **Viewing window**: Last 60 minutes
- **Use case**: Real-time monitoring, immediate performance issues

### Hours
- **Granularity**: 1 data point per hour
- **Viewing window**: Last 24 hours
- **Use case**: Daily trends, hourly traffic patterns

### Days
- **Granularity**: 1 data point per day
- **Viewing window**: Configurable retention period (default: 90 days)
- **Use case**: Long-term trends, capacity planning

## How Aggregation Works

Crude Functions uses a background aggregation service to efficiently manage metrics data:

### The Aggregation Pipeline

```
Raw Executions → Minute Records → Hour Records → Day Records
     (1-60s)         (60 min)        (24 hours)     (retention)
```

**Pass 1: Execution to Minutes**
- Collects all function executions within each minute window
- Calculates weighted averages, maximums, and totals
- Creates both per-function and global minute records

**Pass 2: Minutes to Hours**
- Aggregates 60 minute records into 1 hour record
- Maintains accuracy with weighted averaging
- Deletes processed minute records to save space

**Pass 3: Hours to Days**
- Aggregates 24 hour records into 1 day record
- Preserves long-term trends
- Deletes processed hour records

### Background Processing

The aggregation service runs automatically:

- **Default interval**: Every 60 seconds
- **Catches up automatically**: Processes missed periods after restarts
- **Watermark tracking**: Remembers progress to prevent reprocessing
- **Graceful degradation**: Failures don't stop function execution

**Configuration**: Aggregation interval and retention period are set in Settings → Server Settings → Metrics.

## Viewing Metrics in the Web UI

### Per-Function Metrics

**Path**: `/web/functions` → Click 📊 next to any function

The metrics page shows:

**Summary Cards** (top of page):
- **Avg Executions / {period}** - Average requests per time unit
- **Avg Execution Time** - Overall weighted average in milliseconds
- **Max Execution Time** - Peak execution time across all periods
- **Total Executions** - Sum of all executions in the time range

**Execution Time Chart** (line graph):
- Blue line: Average execution time per period
- Red line: Maximum execution time per period
- Orange markers: Current incomplete period (live data)
- Gray dashed lines: Periods with no activity (interpolated)

**Request Count Chart** (bar graph):
- Blue bars: Number of executions per period
- Orange bars: Current incomplete period (live data)
- Hover to see exact counts

**Time Range Tabs**:
- Last Hour (minute-by-minute)
- Last 24 Hours (hour-by-hour)
- Last X Days (day-by-day, based on retention setting)

**Placeholder for screenshot: metrics-function-view.png**
*Caption: Function metrics showing execution time trends and request counts*

### Global Metrics

**Path**: `/web/functions/metrics/global`

Shows aggregated metrics across **all functions** on your server:
- Same chart types as per-function view
- Combines data from all routes
- Useful for understanding overall server load

**Placeholder for screenshot: metrics-global-view.png**
*Caption: Global metrics aggregating all function executions*

### Switching Between Functions

Use the **Source** dropdown at the top of the metrics page to:
- Switch between individual functions
- View global (server-wide) metrics
- Compare different functions without leaving the page

## Querying Metrics via API

The metrics API provides programmatic access for dashboards, alerting, or custom analytics.

### API Endpoint

```
GET /api/metrics
```

**Authentication**: Requires API key from an authorized group (see Settings → API Access Groups)

### Query Parameters

**Required:**
- `resolution` - Time resolution: `minutes`, `hours`, or `days`

**Optional:**
- `functionId` - Filter by function ID (omit for global metrics)

### Example: Function Metrics

```bash
# Get last 60 minutes for function ID 1
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/metrics?resolution=minutes&functionId=1"
```

Response:
```json
{
  "data": {
    "metrics": [
      {
        "timestamp": "2026-01-12T10:00:00.000Z",
        "avgTimeMs": 45.2,
        "maxTimeMs": 120,
        "executionCount": 15
      },
      {
        "timestamp": "2026-01-12T10:01:00.000Z",
        "avgTimeMs": 38.7,
        "maxTimeMs": 95,
        "executionCount": 22
      }
      // ... more data points
    ],
    "functionId": 1,
    "resolution": "minutes",
    "summary": {
      "totalExecutions": 850,
      "avgExecutionTime": 42.1,
      "maxExecutionTime": 250,
      "periodCount": 60
    }
  }
}
```

### Example: Global Metrics

```bash
# Get last 24 hours across all functions
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/metrics?resolution=hours"
```

### Example: Long-Term Trends

```bash
# Get daily metrics for last 90 days (or your retention setting)
curl -H "X-API-Key: your-management-key" \
  "http://localhost:8000/api/metrics?resolution=days&functionId=1"
```

## Understanding Performance Data

### Reading Execution Times

**Average Execution Time**:
- Weighted average across all executions in the period
- Lower is better (faster responses)
- Sudden increases may indicate:
  - Database slowdowns
  - External API latency
  - Increased payload sizes
  - Code performance issues

**Maximum Execution Time**:
- Longest single execution in the period
- Spikes are normal for:
  - First execution (cold start)
  - Database connection establishment
  - Cache misses
- Consistently high maximums may indicate:
  - Timeout-prone operations
  - Unhandled edge cases
  - Resource contention

### Reading Execution Counts

**Request Volume**:
- Shows traffic patterns and usage trends
- Compare to expected patterns:
  - Business hours vs. off-hours
  - Weekday vs. weekend
  - Seasonal variations

**Drops in volume** may indicate:
- Service interruptions
- Client-side issues
- API key problems
- Function disabled

**Spikes in volume** may indicate:
- Marketing campaigns
- Viral content
- Automated traffic (bots, scrapers)
- Retry storms

### Weighted Averages Explained

Crude Functions uses **weighted averages** to accurately represent performance:

**Example**:
- Period 1: 10 executions averaging 50ms each
- Period 2: 100 executions averaging 30ms each

**Naive average**: (50 + 30) / 2 = 40ms ← **Incorrect**

**Weighted average**: (10×50 + 100×30) / (10 + 100) = 31.8ms ← **Correct**

This ensures metrics accurately reflect real-world performance where some periods have more traffic than others.

## Metrics Retention and Storage

### Retention Policy

**Default**: 90 days of daily metrics

**Configurable**: Settings → Server Settings → Metrics Retention Days
- Minimum: 7 days
- Maximum: 365 days
- Affects storage requirements

### What Gets Deleted

The aggregation service automatically cleans up:

1. **Processed raw executions** - Deleted after aggregation to minutes
2. **Processed minute records** - Deleted after aggregation to hours
3. **Processed hour records** - Deleted after aggregation to days
4. **Old daily records** - Deleted after retention period expires

**Result**: Efficient storage with minimal overhead while preserving long-term trends.

### Storage Estimates

Approximate database size per function:

- **High-traffic function** (1000 req/min): ~500 KB/day
- **Medium-traffic function** (100 req/min): ~50 KB/day
- **Low-traffic function** (10 req/min): ~5 KB/day

With 10 functions and 90-day retention: ~50-500 MB total

## Integration Examples

### Dashboard Integration

Use the metrics API to build custom dashboards:

```javascript
// Fetch metrics for display
async function fetchMetrics(functionId, resolution) {
  const response = await fetch(
    `/api/metrics?functionId=${functionId}&resolution=${resolution}`,
    {
      headers: { 'X-API-Key': API_KEY }
    }
  );
  const data = await response.json();
  return data.data;
}

// Display in chart library (Chart.js, etc.)
const metricsData = await fetchMetrics(1, 'hours');
const chartData = {
  labels: metricsData.metrics.map(m => m.timestamp),
  datasets: [{
    label: 'Avg Execution Time',
    data: metricsData.metrics.map(m => m.avgTimeMs)
  }]
};
```

### Alerting Integration

Monitor metrics and trigger alerts:

```javascript
// Check for performance degradation
async function checkPerformance(functionId, threshold) {
  const data = await fetchMetrics(functionId, 'minutes');
  const recentAvg = data.summary.avgExecutionTime;

  if (recentAvg > threshold) {
    await sendAlert({
      message: `Function ${functionId} slow: ${recentAvg}ms`,
      severity: 'warning'
    });
  }
}

// Run every 5 minutes
setInterval(() => checkPerformance(1, 100), 5 * 60 * 1000);
```

### Capacity Planning

Analyze trends for capacity decisions:

```javascript
// Get long-term daily metrics
const data = await fetchMetrics(1, 'days');

// Calculate growth rate
const first7Days = data.metrics.slice(0, 7);
const last7Days = data.metrics.slice(-7);

const oldAvg = average(first7Days.map(m => m.executionCount));
const newAvg = average(last7Days.map(m => m.executionCount));

const growthRate = ((newAvg - oldAvg) / oldAvg) * 100;
console.log(`Traffic growth: ${growthRate.toFixed(1)}%`);
```

## Troubleshooting

### No Metrics Showing

**Possible causes**:
1. Function hasn't been executed yet
2. Aggregation service hasn't run yet (wait up to 60 seconds)
3. Viewing wrong time range (try "Last Hour")

**Solution**: Execute the function and refresh after ~60 seconds.

### Gaps in Metrics

**Cause**: No executions during that period

**Chart behavior**: Dashed gray lines indicate interpolated data (no actual executions)

**Normal for**:
- Scheduled jobs that run periodically
- Low-traffic functions
- Off-hours periods

### Metrics Not Updating

**Check**:
1. Container logs: `docker compose logs -f`
2. Look for `[MetricsAggregation]` messages
3. Check for database errors

**Recovery**: Restart the container - aggregation will catch up automatically.

### High Storage Usage

**If metrics database is too large**:

1. Reduce retention: Settings → Metrics Retention Days
2. Delete old metrics: Reduction takes effect on next cleanup
3. Monitor per-function metrics: High-traffic functions contribute more

**Disable metrics** (not recommended): Currently not supported - metrics are always collected.

## Best Practices

### Monitoring Strategy

1. **Start with global metrics** - Understand overall server health
2. **Drill down to functions** - Identify performance bottlenecks
3. **Compare time ranges** - Look for patterns (hourly, daily, weekly)
4. **Set baselines** - Know your normal performance ranges
5. **Monitor trends, not absolutes** - Watch for changes over time

### Performance Optimization

Use metrics to guide optimization efforts:

1. **High average time** → Profile code, optimize queries
2. **High maximum time** → Investigate edge cases, add timeouts
3. **Increasing trends** → Address before issues occur
4. **Traffic spikes** → Consider rate limiting, caching

### Alert Thresholds

Recommended alert levels:

- **Warning**: 2x normal average execution time
- **Critical**: 5x normal average execution time
- **Volume**: 3x normal request count (potential abuse)

Adjust based on your specific functions and requirements.

## Related Topics

- **Logs**: See [Execution Logs](/guides/logs) for detailed function output
- **API Reference**: Complete endpoint documentation in [API Endpoints](/reference/api)
- **Settings**: Configure retention in [Settings Guide](/guides/settings)
