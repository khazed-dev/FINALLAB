const express = require("express");

function createApiRouter({ metricsEngine, defenseManager }) {
  const router = express.Router();

  router.get("/metrics/current", (req, res) => {
    res.json(metricsEngine.getCurrent());
  });

  router.get("/metrics/history", (req, res) => {
    const points = metricsEngine.getHistory();
    res.json({
      points,
      limit: points.length
    });
  });

  router.get("/logs/recent", (req, res) => {
    const limit = Math.min(Number(req.query.limit || 40), 100);
    res.json({
      items: metricsEngine.getRecentLogs(limit)
    });
  });

  router.get("/status", (req, res) => {
    res.json({
      appName: process.env.APP_NAME || "Security Operations Mini Dashboard",
      serverTime: new Date().toISOString(),
      defense: defenseManager.getState(),
      summary: metricsEngine.getStatus()
    });
  });

  router.post("/nginx/reload", async (req, res) => {
    try {
      const result = await defenseManager.reloadOnly();
      res.json({
        ok: true,
        ...result,
        defense: defenseManager.getState(),
        summary: metricsEngine.getStatus()
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  });

  return router;
}

module.exports = { createApiRouter };
