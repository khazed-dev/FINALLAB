const express = require("express");

function createDefenseRouter({ defenseManager, metricsEngine }) {
  const router = express.Router();

  const wrap = (handler) => async (req, res) => {
    try {
      const result = await handler(req, res);
      res.json({
        ok: true,
        ...result,
        defense: defenseManager.getState(),
        status: metricsEngine.getStatus()
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  };

  router.post("/rate-limit/enable", wrap(() => defenseManager.enableRateLimit()));
  router.post("/rate-limit/disable", wrap(() => defenseManager.disableRateLimit()));
  router.post("/conn-limit/enable", wrap(() => defenseManager.enableConnLimit()));
  router.post("/conn-limit/disable", wrap(() => defenseManager.disableConnLimit()));
  router.post("/emergency/enable", wrap(() => defenseManager.enableEmergencyMode()));
  router.post("/emergency/disable", wrap(() => defenseManager.disableEmergencyMode()));
  router.post("/nginx/reload", wrap(() => defenseManager.reloadOnly()));

  return router;
}

module.exports = { createDefenseRouter };
