const { createRuntime } = require("./app");

async function start() {
  const runtime = await createRuntime();
  const { server, metricsEngine, port } = runtime;

  server.listen(port, () => {
    console.log(`[security-dashboard] listening on port ${port}`);
  });

  metricsEngine.start();

  const shutdown = async (signal) => {
    console.log(`[security-dashboard] received ${signal}, shutting down`);
    metricsEngine.stop();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error) => {
  console.error("[security-dashboard] failed to start", error);
  process.exit(1);
});
