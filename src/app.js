"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const SERVICE_NAME = process.env.SERVICE_NAME || "session15-observability-demo";
const METRIC_NAMESPACE = process.env.METRIC_NAMESPACE || "Session15/ObservabilityDemo";
const SLOW_REQUEST_THRESHOLD_MS = Number(process.env.SLOW_REQUEST_THRESHOLD_MS || 1000);
const MAX_SIMULATED_DELAY_MS = 5000;
const DEMO_ENDPOINTS_ENABLED = process.env.ENABLE_DEMO_ENDPOINTS !== "false";
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const DEMO_ROUTES = new Set([
  "/",
  "/healthz",
  "/api/orders",
  "/api/checkout",
  "/api/slow",
  "/api/error",
]);

function timestamp() {
  return new Date().toISOString();
}

function writeLog(event) {
  const line = JSON.stringify(event);
  if (event.level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function normalizeRequestId(value) {
  if (typeof value === "string" && /^[a-zA-Z0-9._:-]{1,80}$/.test(value)) {
    return value;
  }
  return randomUUID();
}

function extractTraceId(traceparent) {
  if (typeof traceparent !== "string") return null;

  const match = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i.exec(traceparent.trim());
  if (!match || match[1].toLowerCase() === "ff" || /^0+$/.test(match[2])) return null;

  // This is used to correlate demo logs; it does not create/export an X-Ray trace.
  return match[2].toLowerCase();
}

function sendResponse(response, statusCode, body, contentType = "application/json") {
  response.writeHead(statusCode, {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store",
  });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

function createMetricEvent({ route, statusCode, durationMs }) {
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [["Service", "Route", "StatusCode"]],
          Metrics: [
            { Name: "RequestCount", Unit: "Count" },
            { Name: "ErrorCount", Unit: "Count" },
            { Name: "SlowRequestCount", Unit: "Count" },
            { Name: "RequestDurationMs", Unit: "Milliseconds" },
          ],
        },
      ],
    },
    timestamp: timestamp(),
    event: "cloudwatch_emf",
    Service: SERVICE_NAME,
    Route: route,
    StatusCode: String(statusCode),
    RequestCount: 1,
    ErrorCount: statusCode >= 500 ? 1 : 0,
    SlowRequestCount: durationMs >= SLOW_REQUEST_THRESHOLD_MS ? 1 : 0,
    RequestDurationMs: Number(durationMs.toFixed(2)),
  };
}

function getDelayMs(rawValue) {
  const requested = rawValue === null ? 1500 : Number(rawValue);
  if (!Number.isInteger(requested) || requested < 0) return null;
  return Math.min(requested, MAX_SIMULATED_DELAY_MS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createServer({ logger = writeLog } = {}) {
  return http.createServer(async (request, response) => {
    const startedAt = process.hrtime.bigint();
    const url = new URL(request.url || "/", "http://localhost");
    const pathname = url.pathname;
    const method = request.method || "GET";
    const route = DEMO_ROUTES.has(pathname) ? pathname : "OTHER";
    const requestId = normalizeRequestId(request.headers["x-request-id"]);
    const traceId = extractTraceId(request.headers.traceparent);

    response.setHeader("x-request-id", requestId);
    if (traceId) response.setHeader("x-trace-id", traceId);

    let statusCode = 200;
    let contentType = "application/json";
    let body;

    try {
      if (method !== "GET") {
        statusCode = 405;
        body = { error: "method_not_allowed", request_id: requestId };
      } else if (pathname === "/") {
        contentType = "text/html";
        body = INDEX_HTML;
      } else if (pathname === "/healthz") {
        body = {
          status: "ok",
          service: SERVICE_NAME,
          host: os.hostname(),
          uptime_seconds: Math.floor(process.uptime()),
        };
      } else if (pathname === "/api/orders") {
        body = {
          ok: true,
          request_id: requestId,
          orders: [
            { id: "ORD-1001", status: "processing", total: 42.5 },
            { id: "ORD-1002", status: "shipped", total: 18.0 },
          ],
        };
      } else if (pathname === "/api/checkout") {
        const dependencyStartedAt = process.hrtime.bigint();
        await sleep(75);
        const dependencyDurationMs = Number(process.hrtime.bigint() - dependencyStartedAt) / 1e6;

        logger({
          timestamp: timestamp(),
          level: "INFO",
          service: SERVICE_NAME,
          event: "dependency_call",
          dependency: "inventory-service-demo",
          request_id: requestId,
          trace_id: traceId,
          status_code: 200,
          duration_ms: Number(dependencyDurationMs.toFixed(2)),
          note: "Simulated dependency call for log-correlation practice",
        });

        body = {
          ok: true,
          order_id: `ORD-${requestId.slice(0, 8)}`,
          inventory_check: "available",
          request_id: requestId,
          trace_id: traceId,
        };
      } else if (pathname === "/api/slow") {
        if (!DEMO_ENDPOINTS_ENABLED) {
          statusCode = 404;
          body = { error: "not_found", request_id: requestId };
        } else {
          const delayMs = getDelayMs(url.searchParams.get("ms"));
          if (delayMs === null) {
            statusCode = 400;
            body = {
              error: "invalid_delay",
              message: "ms must be a non-negative integer",
              request_id: requestId,
            };
          } else {
            await sleep(delayMs);
            body = {
              ok: true,
              simulated_delay_ms: delayMs,
              max_delay_ms: MAX_SIMULATED_DELAY_MS,
              request_id: requestId,
            };
          }
        }
      } else if (pathname === "/api/error") {
        if (!DEMO_ENDPOINTS_ENABLED) {
          statusCode = 404;
          body = { error: "not_found", request_id: requestId };
        } else {
          const errorId = randomUUID();
          statusCode = 500;
          body = {
            error: "simulated_failure",
            error_id: errorId,
            request_id: requestId,
          };

          logger({
            timestamp: timestamp(),
            level: "ERROR",
            service: SERVICE_NAME,
            event: "application_error",
            error_code: "SIMULATED_FAILURE",
            error_id: errorId,
            request_id: requestId,
            trace_id: traceId,
            message: "Intentional demo error; no real data was changed",
          });
        }
      } else {
        statusCode = 404;
        body = { error: "not_found", request_id: requestId };
      }
    } catch (error) {
      statusCode = 500;
      body = { error: "internal_server_error", request_id: requestId };
      logger({
        timestamp: timestamp(),
        level: "ERROR",
        service: SERVICE_NAME,
        event: "application_error",
        error_code: "UNHANDLED_REQUEST_ERROR",
        request_id: requestId,
        trace_id: traceId,
        error_type: error && error.name ? error.name : "Error",
        message: "Request handler failed",
      });
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    // Keep load-balancer health checks out of the application metrics/log stream.
    if (pathname !== "/healthz") {
      const level = statusCode >= 500
        ? "ERROR"
        : durationMs >= SLOW_REQUEST_THRESHOLD_MS
          ? "WARN"
          : "INFO";

      logger({
        timestamp: timestamp(),
        level,
        service: SERVICE_NAME,
        event: "http_request",
        request_id: requestId,
        trace_id: traceId,
        method,
        route,
        status_code: statusCode,
        duration_ms: Number(durationMs.toFixed(2)),
      });
      logger(createMetricEvent({ route, statusCode, durationMs }));
    }

    sendResponse(response, statusCode, body, contentType);
  });
}

module.exports = {
  createServer,
  extractTraceId,
  getDelayMs,
};
