const path = require("node:path");

const appDirectory = __dirname;

module.exports = {
  apps: [
    {
      name: "session15-observability-demo",
      cwd: appDirectory,
      script: "src/server.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      time: false,
      merge_logs: true,
      out_file: path.join(appDirectory, "logs", "app-out.log"),
      error_file: path.join(appDirectory, "logs", "app-error.log"),
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3000",
        SERVICE_NAME: "session15-observability-demo",
        METRIC_NAMESPACE: "Session15/ObservabilityDemo",
        SLOW_REQUEST_THRESHOLD_MS: "1000",
        ENABLE_DEMO_ENDPOINTS: "true",
      },
    },
  ],
};
