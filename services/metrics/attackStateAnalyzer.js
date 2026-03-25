class AttackStateAnalyzer {
  constructor() {
    this.baselineRps = 1;
    this.baselineLatency = 0.05;
    this.baselineConnections = 5;
  }

  analyze({ system, nginx, access, defense }) {
    const defenseActive = Boolean(
      defense.rateLimitEnabled || defense.connLimitEnabled || defense.emergencyModeEnabled
    );
    const rps = access.requestsPerSec || nginx.requestsPerSecFromNginx || 0;
    const responseTime = access.averageResponseTime || 0;
    const activeConnections = nginx.activeConnections || 0;
    const uniqueSourceCount = access.uniqueSourceCount || 0;
    const dominantSourceShare = access.dominantSourceShare || 0;

    const rpsSpikeThreshold = Math.max(this.baselineRps * 5, 25);
    const latencyThreshold = Math.max(this.baselineLatency * 3, 0.6);
    const connThreshold = Math.max(this.baselineConnections * 3, 40);

    const spikeWarning = rps >= rpsSpikeThreshold || activeConnections >= connThreshold;
    const highLatency = responseTime >= latencyThreshold;
    const highServerStress =
      (system.cpuPercent || 0) >= 75 || (system.memoryPercent || 0) >= 85 || highLatency;

    let mode = "NORMAL";
    let detectedPattern = "NONE";

    if (spikeWarning && uniqueSourceCount <= 5 && dominantSourceShare >= 55) {
      mode = defenseActive ? "DEFENSE ENABLED" : "UNDER DOS";
      detectedPattern = "DOS";
    } else if (spikeWarning && uniqueSourceCount >= 10) {
      mode = defenseActive ? "DEFENSE ENABLED" : "UNDER DDOS";
      detectedPattern = "DDOS";
    } else if (defenseActive) {
      mode = "DEFENSE ENABLED";
    }

    let overallStatus = "Healthy";
    if (mode === "UNDER DOS" || mode === "UNDER DDOS") {
      overallStatus = "Under Attack";
    } else if (mode === "DEFENSE ENABLED") {
      overallStatus = spikeWarning || highServerStress ? "Mitigating" : "Warning";
    } else if (spikeWarning || highServerStress || access.fiveXxRate > 3) {
      overallStatus = "Warning";
    }

    if (mode === "NORMAL" && !spikeWarning && !highServerStress) {
      this.baselineRps = this.blend(this.baselineRps, Math.max(rps, 1), 0.12);
      this.baselineLatency = this.blend(this.baselineLatency, Math.max(responseTime, 0.01), 0.15);
      this.baselineConnections = this.blend(
        this.baselineConnections,
        Math.max(activeConnections, 1),
        0.12
      );
    }

    return {
      mode,
      detectedPattern,
      overallStatus,
      abnormalTrafficDetected: spikeWarning,
      spikeWarning,
      highLatency,
      highServerStress,
      uniqueSourceCount,
      topSources: access.topSources || [],
      dominantSourceShare,
      thresholds: {
        cpuAlert: 75,
        requestSpike: Number(rpsSpikeThreshold.toFixed(2)),
        latencyAlert: Number(latencyThreshold.toFixed(3)),
        connectionAlert: Number(connThreshold.toFixed(2)),
        errorRateAlert: 3
      },
      baselines: {
        rps: Number(this.baselineRps.toFixed(2)),
        latency: Number(this.baselineLatency.toFixed(3)),
        connections: Number(this.baselineConnections.toFixed(2))
      }
    };
  }

  blend(previous, current, weight) {
    return previous * (1 - weight) + current * weight;
  }
}

module.exports = { AttackStateAnalyzer };
