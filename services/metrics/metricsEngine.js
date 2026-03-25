const { EventEmitter } = require("events");

class MetricsEngine extends EventEmitter {
  constructor({
    intervalMs,
    historyLimit,
    systemCollector,
    nginxCollector,
    accessLogParser,
    analyzer,
    eventLogService,
    defenseManager
  }) {
    super();
    this.intervalMs = intervalMs;
    this.historyLimit = historyLimit;
    this.systemCollector = systemCollector;
    this.nginxCollector = nginxCollector;
    this.accessLogParser = accessLogParser;
    this.analyzer = analyzer;
    this.eventLogService = eventLogService;
    this.defenseManager = defenseManager;
    this.timer = null;
    this.history = [];
    this.current = this.buildEmptySnapshot();
    this.lastDefenseFingerprint = JSON.stringify(defenseManager.getState());
  }

  start() {
    if (this.timer) {
      return;
    }

    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getCurrent() {
    return this.current;
  }

  getHistory() {
    return this.history;
  }

  getRecentLogs(limit) {
    return this.eventLogService.getRecent(limit);
  }

  getStatus() {
    return {
      overallStatus: this.current.attack.overallStatus,
      mode: this.current.attack.mode,
      updatedAt: this.current.timestamp,
      collectors: this.current.collectors
    };
  }

  buildEmptySnapshot() {
    return {
      timestamp: new Date().toISOString(),
      system: {
        cpuPercent: 0,
        memoryPercent: 0,
        memoryUsedBytes: 0,
        memoryTotalBytes: 0,
        loadAverage: { one: 0, five: 0, fifteen: 0 },
        networkInBytesPerSec: 0,
        networkOutBytesPerSec: 0,
        diskPercent: 0,
        diskUsedBytes: 0,
        diskTotalBytes: 0
      },
      web: {
        requestsPerSec: 0,
        averageResponseTime: 0,
        activeConnections: 0,
        reading: 0,
        writing: 0,
        waiting: 0,
        successRate: 100,
        fourXxRate: 0,
        fiveXxRate: 0,
        statusCounts: { "2xx": 0, "4xx": 0, "5xx": 0, other: 0 }
      },
      attack: {
        mode: "NORMAL",
        detectedPattern: "NONE",
        overallStatus: "Healthy",
        abnormalTrafficDetected: false,
        spikeWarning: false,
        highLatency: false,
        highServerStress: false,
        uniqueSourceCount: 0,
        topSources: [],
        dominantSourceShare: 0,
        thresholds: {
          cpuAlert: 75,
          requestSpike: 25,
          latencyAlert: 0.6,
          connectionAlert: 40,
          errorRateAlert: 3
        },
        baselines: {
          rps: 1,
          latency: 0.05,
          connections: 5
        }
      },
      defense: this.defenseManager.getState(),
      collectors: {
        system: null,
        nginx: null,
        access: null
      }
    };
  }

  async tick() {
    const [systemResult, nginxResult, accessResult] = await Promise.allSettled([
      this.systemCollector.collect(),
      this.nginxCollector.collect(),
      this.accessLogParser.collect()
    ]);

    const previous = this.current;
    const system = systemResult.status === "fulfilled" ? systemResult.value : previous.system;
    const nginx = nginxResult.status === "fulfilled" ? nginxResult.value : previous.web;
    const access = accessResult.status === "fulfilled" ? accessResult.value : previous.web;
    const defense = this.defenseManager.getState();
    const attack = this.analyzer.analyze({ system, nginx, access, defense });

    const snapshot = {
      timestamp: new Date().toISOString(),
      system,
      web: {
        requestsPerSec: access.requestsPerSec || nginx.requestsPerSecFromNginx || 0,
        averageResponseTime: access.averageResponseTime || 0,
        activeConnections: nginx.activeConnections || 0,
        reading: nginx.reading || 0,
        writing: nginx.writing || 0,
        waiting: nginx.waiting || 0,
        successRate: access.successRate || 0,
        fourXxRate: access.fourXxRate || 0,
        fiveXxRate: access.fiveXxRate || 0,
        statusCounts: access.statusCounts || { "2xx": 0, "4xx": 0, "5xx": 0, other: 0 }
      },
      attack,
      defense,
      collectors: {
        system: systemResult.status === "rejected" ? systemResult.reason.message : system.collectorError || null,
        nginx: nginxResult.status === "rejected" ? nginxResult.reason.message : nginx.collectorError || null,
        access: accessResult.status === "rejected" ? accessResult.reason.message : access.collectorError || null
      }
    };

    this.current = snapshot;
    this.history.push({
      timestamp: snapshot.timestamp,
      cpuPercent: snapshot.system.cpuPercent,
      requestsPerSec: snapshot.web.requestsPerSec,
      activeConnections: snapshot.web.activeConnections,
      averageResponseTime: snapshot.web.averageResponseTime,
      errorRate: snapshot.web.fiveXxRate
    });

    if (this.history.length > this.historyLimit) {
      this.history = this.history.slice(-this.historyLimit);
    }

    this.emitStateEvents(previous, snapshot);
    this.emit("metrics", snapshot);
  }

  emitStateEvents(previous, current) {
    if (current.attack.mode !== previous.attack.mode) {
      this.eventLogService.addEvent({
        level: current.attack.mode === "NORMAL" ? "info" : "warning",
        type: "attack-state",
        message: `Mode changed to ${current.attack.mode}`
      });

      if (current.attack.mode === "UNDER DOS" || current.attack.mode === "UNDER DDOS") {
        this.eventLogService.addEvent({
          level: "critical",
          type: "attack-started",
          message: `Attack started: ${current.attack.mode}`
        });
      }
    }

    if (current.attack.spikeWarning && !previous.attack.spikeWarning) {
      this.eventLogService.addEvent({
        level: "warning",
        type: "traffic-spike",
        message: `Traffic spike detected at ${current.web.requestsPerSec} req/s`
      });
    }

    if (current.attack.highLatency && !previous.attack.highLatency) {
      this.eventLogService.addEvent({
        level: "warning",
        type: "latency",
        message: `High latency detected at ${current.web.averageResponseTime}s average response time`
      });
    }

    if (current.attack.overallStatus === "Mitigating" && previous.attack.overallStatus !== "Mitigating") {
      this.eventLogService.addEvent({
        level: "info",
        type: "mitigation",
        message: "Mitigation active"
      });
    }

    const defenseFingerprint = JSON.stringify(current.defense);
    if (defenseFingerprint !== this.lastDefenseFingerprint) {
      this.lastDefenseFingerprint = defenseFingerprint;
      this.eventLogService.addEvent({
        level: "info",
        type: "defense",
        message: `Defense state updated: rate=${current.defense.rateLimitEnabled}, conn=${current.defense.connLimitEnabled}, emergency=${current.defense.emergencyModeEnabled}`
      });
    }

    Object.entries(current.collectors).forEach(([name, error]) => {
      if (error) {
        this.eventLogService.addWithCooldown(`${name}-collector-error`, 30000, {
          level: "warning",
          type: "collector-error",
          message: `${name} collector issue: ${error}`
        });
      }
    });
  }
}

module.exports = { MetricsEngine };
