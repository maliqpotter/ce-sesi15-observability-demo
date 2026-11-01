"use strict";

const os = require("node:os");
const { createServer } = require("./app");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const service = process.env.SERVICE_NAME || "session15-observability-demo";
const server = createServer();

server.listen(port, host, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    event: "application_started",
    service,
    host,
    port,
    instance_hostname: os.hostname(),
    node_version: process.version,
  }));
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    event: "application_shutdown_started",
    service,
    signal,
  }));

  const forceExit = setTimeout(() => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      event: "application_shutdown_timeout",
      service,
    }));
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        event: "application_shutdown_error",
        service,
        message: "HTTP server failed to close cleanly",
      }));
      process.exit(1);
      return;
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      event: "application_shutdown_complete",
      service,
    }));
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
