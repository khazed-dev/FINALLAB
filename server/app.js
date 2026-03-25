const fs = require("fs");
const path = require("path");
const http = require("http");
const dotenv = require("dotenv");
const express = require("express");
const { Server } = require("socket.io");
const { createSessionAuth } = require("../services/auth/sessionAuth");
const { EventLogService } = require("../services/logs/eventLogService");
const { SystemCollector } = require("../services/metrics/systemCollector");
const { NginxStatusCollector } = require("../services/metrics/nginxStatusCollector");
const { AccessLogParser } = require("../services/metrics/accessLogParser");
const { AttackStateAnalyzer } = require("../services/metrics/attackStateAnalyzer");
const { MetricsEngine } = require("../services/metrics/metricsEngine");
const { DefenseManager } = require("../services/nginx/defenseManager");
const { createApiRouter } = require("../routes/api");
const { createDefenseRouter } = require("../routes/defense");

dotenv.config();

async function createRuntime() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: false
    }
  });

  const publicDir = path.join(__dirname, "../public");
  const vendorChartDir = path.join(__dirname, "../node_modules/chart.js/dist");
  const port = Number(process.env.PORT || 3000);
  const historyLimit = Number(process.env.METRICS_HISTORY_LIMIT || 120);
  const metricsIntervalMs = Number(process.env.METRICS_INTERVAL_MS || 1000);
  const defenseStateFile = path.resolve(process.env.DEFENSE_STATE_FILE || "./config/runtime/defense-state.json");

  await fs.promises.mkdir(path.dirname(defenseStateFile), { recursive: true });

  const auth = createSessionAuth({
    user: process.env.DASHBOARD_USER,
    pass: process.env.DASHBOARD_PASS,
    sessionSecret: process.env.SESSION_SECRET,
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
    cookieSecure: String(process.env.COOKIE_SECURE || "false") === "true"
  });

  const eventLogService = new EventLogService({ capacity: 300 });
  const defenseManager = new DefenseManager({
    stateFile: defenseStateFile,
    nginxDefenseSnippetPath: process.env.NGINX_DEFENSE_SNIPPET_PATH || "/etc/nginx/snippets/security-dashboard-defense.conf",
    nginxRateZonePath: process.env.NGINX_RATE_ZONE_PATH || "/etc/nginx/conf.d/security-dashboard-rate-zone.conf",
    nginxConnZonePath: process.env.NGINX_CONN_ZONE_PATH || "/etc/nginx/conf.d/security-dashboard-conn-zone.conf",
    nginxEmergencyPagePath: process.env.NGINX_EMERGENCY_PAGE_PATH || "/var/www/html/security-dashboard-emergency.html",
    nginxTestCommand: process.env.NGINX_TEST_COMMAND || "sudo nginx -t",
    nginxReloadCommand: process.env.NGINX_RELOAD_COMMAND || "sudo systemctl reload nginx",
    rateLimitZoneName: process.env.RATE_LIMIT_ZONE_NAME || "soc_ratelimit",
    rateLimitRps: process.env.RATE_LIMIT_RPS || "15r/s",
    rateLimitBurst: Number(process.env.RATE_LIMIT_BURST || 25),
    rateLimitStatus: Number(process.env.RATE_LIMIT_STATUS || 429),
    connLimitZoneName: process.env.CONN_LIMIT_ZONE_NAME || "soc_connlimit",
    connLimitPerIp: Number(process.env.CONN_LIMIT_PER_IP || 30),
    emergencyRateLimitRps: process.env.EMERGENCY_RATE_LIMIT_RPS || "5r/s",
    emergencyRateLimitBurst: Number(process.env.EMERGENCY_RATE_LIMIT_BURST || 5),
    emergencyConnLimitPerIp: Number(process.env.EMERGENCY_CONN_LIMIT_PER_IP || 8),
    emergencyStatusCode: Number(process.env.EMERGENCY_STATUS_CODE || 503)
  });

  await defenseManager.initialize();

  const systemCollector = new SystemCollector({
    networkInterface: process.env.NETWORK_INTERFACE
  });
  const nginxCollector = new NginxStatusCollector({
    statusUrl: process.env.NGINX_STATUS_URL
  });
  const accessLogParser = new AccessLogParser({
    logPath: process.env.NGINX_ACCESS_LOG_PATH
  });
  const analyzer = new AttackStateAnalyzer();

  const metricsEngine = new MetricsEngine({
    intervalMs: metricsIntervalMs,
    historyLimit,
    systemCollector,
    nginxCollector,
    accessLogParser,
    analyzer,
    eventLogService,
    defenseManager
  });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(auth.cookieParserMiddleware);
  app.use(
    "/static",
    (req, res, next) => {
      if (req.path.endsWith(".html")) {
        return res.status(404).end();
      }
      return next();
    },
    express.static(publicDir)
  );
  app.use("/vendor/chart.js", express.static(vendorChartDir));

  app.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get("/login", (req, res) => {
    if (auth.isAuthenticated(req)) {
      return res.redirect("/dashboard");
    }
    return res.sendFile(path.join(publicDir, "login.html"));
  });

  app.post("/auth/login", auth.handleLogin);
  app.post("/auth/logout", auth.requireApiAuth, auth.handleLogout);

  app.get("/dashboard", auth.requirePageAuth, (req, res) => {
    res.sendFile(path.join(publicDir, "dashboard.html"));
  });

  app.get("/api/ping", (req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      message: "pong"
    });
  });

  app.use("/api", auth.requireApiAuth, createApiRouter({ metricsEngine, defenseManager }));
  app.use("/api/defense", auth.requireApiAuth, createDefenseRouter({ defenseManager, metricsEngine }));

  io.use((socket, next) => auth.socketAuth(socket, next));

  io.on("connection", (socket) => {
    socket.emit("metrics:update", metricsEngine.getCurrent());
    socket.emit("metrics:history", metricsEngine.getHistory());
    socket.emit("logs:update", eventLogService.getRecent(40));
    socket.emit("defense:update", defenseManager.getState());
  });

  metricsEngine.on("metrics", (payload) => {
    io.emit("metrics:update", payload);
    io.emit("metrics:history", metricsEngine.getHistory());
  });

  eventLogService.on("log", () => {
    io.emit("logs:update", eventLogService.getRecent(40));
  });

  defenseManager.on("stateChanged", (state) => {
    io.emit("defense:update", state);
  });

  return { app, server, io, metricsEngine, defenseManager, port };
}

module.exports = { createRuntime };
