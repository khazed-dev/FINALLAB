const dom = {
  currentClock: document.getElementById("currentClock"),
  modeBadge: document.getElementById("modeBadge"),
  overallBadge: document.getElementById("overallBadge"),
  cpuValue: document.getElementById("cpuValue"),
  cpuMeta: document.getElementById("cpuMeta"),
  ramValue: document.getElementById("ramValue"),
  rpsValue: document.getElementById("rpsValue"),
  rpsMeta: document.getElementById("rpsMeta"),
  connValue: document.getElementById("connValue"),
  connMeta: document.getElementById("connMeta"),
  latencyValue: document.getElementById("latencyValue"),
  latencyMeta: document.getElementById("latencyMeta"),
  errorValue: document.getElementById("errorValue"),
  loadValue: document.getElementById("loadValue"),
  netInValue: document.getElementById("netInValue"),
  netOutValue: document.getElementById("netOutValue"),
  diskValue: document.getElementById("diskValue"),
  successValue: document.getElementById("successValue"),
  fourxxValue: document.getElementById("fourxxValue"),
  statusCountsValue: document.getElementById("statusCountsValue"),
  rwvValue: document.getElementById("rwvValue"),
  attackModeValue: document.getElementById("attackModeValue"),
  attackPatternValue: document.getElementById("attackPatternValue"),
  uniqueIpValue: document.getElementById("uniqueIpValue"),
  dominanceValue: document.getElementById("dominanceValue"),
  abnormalBadge: document.getElementById("abnormalBadge"),
  spikeBadge: document.getElementById("spikeBadge"),
  topSourcesList: document.getElementById("topSourcesList"),
  logList: document.getElementById("logList"),
  defenseBadge: document.getElementById("defenseBadge"),
  chartError: document.getElementById("chartError"),
  rateLimitState: document.getElementById("rateLimitState"),
  connLimitState: document.getElementById("connLimitState"),
  emergencyState: document.getElementById("emergencyState"),
  systemBadge: document.getElementById("systemBadge"),
  webBadge: document.getElementById("webBadge"),
  attackBadge: document.getElementById("attackBadge"),
  logoutButton: document.getElementById("logoutButton"),
  cards: {
    cpu: document.getElementById("cpuCard"),
    ram: document.getElementById("ramCard"),
    rps: document.getElementById("rpsCard"),
    conn: document.getElementById("connCard"),
    latency: document.getElementById("latencyCard"),
    error: document.getElementById("errorCard")
  }
};

const chartStore = {};
let chartsReady = false;
let pendingHistory = [];
const statusClasses = {
  Healthy: "healthy",
  Warning: "warning",
  "Under Attack": "attack",
  Mitigating: "mitigating"
};

function formatBytesPerSecond(bytes) {
  if (bytes < 1024) return `${bytes.toFixed(0)} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

function setPill(el, text, className) {
  el.textContent = text;
  el.className = `pill ${className || "neutral"}`;
}

function setBadge(el, text, className) {
  el.textContent = text;
  el.className = `badge ${className || "neutral"}`;
}

function applyAlert(card, level) {
  card.classList.remove("state-ok", "state-warning", "state-danger", "state-mitigating");
  card.classList.add(level);
}

function createChart(id, label, color) {
  const canvas = document.getElementById(id);
  const ctx = canvas.getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: color.replace("1)", "0.16)"),
          tension: 0.35,
          fill: true,
          borderWidth: 2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          labels: {
            color: "#d7e1f2"
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#7f93b3", maxTicksLimit: 6 },
          grid: { color: "rgba(127, 147, 179, 0.12)" }
        },
        y: {
          ticks: { color: "#7f93b3" },
          grid: { color: "rgba(127, 147, 179, 0.12)" }
        }
      }
    }
  });
}

function initCharts() {
  if (!window.Chart) {
    throw new Error("Chart.js is not available");
  }

  chartStore.cpu = createChart("cpuChart", "CPU %", "rgba(0, 224, 255, 1)");
  chartStore.rps = createChart("rpsChart", "Requests / Sec", "rgba(255, 184, 0, 1)");
  chartStore.conn = createChart("connChart", "Active Connections", "rgba(255, 92, 92, 1)");
  chartStore.latency = createChart("latencyChart", "Avg Response Time", "rgba(140, 124, 255, 1)");
  chartStore.error = createChart("errorChart", "5xx Error Rate", "rgba(255, 106, 148, 1)");
  chartsReady = true;

  if (pendingHistory.length) {
    updateCharts(pendingHistory);
  }
}

function updateCharts(points) {
  pendingHistory = Array.isArray(points) ? points : [];
  if (!chartsReady) {
    return;
  }

  const trimmed = points.slice(-60);
  const labels = trimmed.map((point) => new Date(point.timestamp).toLocaleTimeString());

  chartStore.cpu.data.labels = labels;
  chartStore.rps.data.labels = labels;
  chartStore.conn.data.labels = labels;
  chartStore.latency.data.labels = labels;
  chartStore.error.data.labels = labels;

  chartStore.cpu.data.datasets[0].data = trimmed.map((point) => point.cpuPercent);
  chartStore.rps.data.datasets[0].data = trimmed.map((point) => point.requestsPerSec);
  chartStore.conn.data.datasets[0].data = trimmed.map((point) => point.activeConnections);
  chartStore.latency.data.datasets[0].data = trimmed.map((point) => point.averageResponseTime);
  chartStore.error.data.datasets[0].data = trimmed.map((point) => point.errorRate);

  Object.values(chartStore).forEach((chart) => chart.update("none"));
}

function updateTopSources(sources) {
  dom.topSourcesList.innerHTML = "";
  if (!sources.length) {
    dom.topSourcesList.innerHTML = "<li class=\"source-item muted\">No source traffic yet</li>";
    return;
  }

  sources.forEach((source) => {
    const li = document.createElement("li");
    li.className = "source-item";
    li.innerHTML = `<span>${source.ip}</span><strong>${source.count} req (${source.share}%)</strong>`;
    dom.topSourcesList.appendChild(li);
  });
}

function updateLogs(items) {
  dom.logList.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = `log-item ${item.level}`;
    li.innerHTML = `<span>${new Date(item.timestamp).toLocaleTimeString()}</span><strong>${item.message}</strong>`;
    dom.logList.appendChild(li);
  });
}

function refreshClock() {
  dom.currentClock.textContent = new Date().toLocaleTimeString();
}

function updateDashboard(snapshot) {
  const { system, web, attack, defense } = snapshot;
  const modeClass =
    attack.mode === "UNDER DOS" || attack.mode === "UNDER DDOS"
      ? "attack"
      : attack.mode === "DEFENSE ENABLED"
        ? "mitigating"
        : "neutral";

  setPill(dom.modeBadge, attack.mode, modeClass);
  setPill(dom.overallBadge, attack.overallStatus, statusClasses[attack.overallStatus]);

  dom.cpuValue.textContent = `${system.cpuPercent.toFixed(1)}%`;
  dom.cpuMeta.textContent = `Baseline alert at ${attack.thresholds.cpuAlert}%`;
  dom.ramValue.textContent = `${system.memoryPercent.toFixed(1)}%`;
  dom.rpsValue.textContent = web.requestsPerSec.toFixed(1);
  dom.rpsMeta.textContent = `Spike threshold ${attack.thresholds.requestSpike.toFixed(1)} req/s`;
  dom.connValue.textContent = `${web.activeConnections}`;
  dom.connMeta.textContent = `${web.reading} / ${web.writing} / ${web.waiting}`;
  dom.latencyValue.textContent = `${web.averageResponseTime.toFixed(3)}s`;
  dom.latencyMeta.textContent = `Alert over ${attack.thresholds.latencyAlert.toFixed(3)}s`;
  dom.errorValue.textContent = `${web.fiveXxRate.toFixed(2)}%`;

  dom.loadValue.textContent = `${system.loadAverage.one.toFixed(2)} / ${system.loadAverage.five.toFixed(2)} / ${system.loadAverage.fifteen.toFixed(2)}`;
  dom.netInValue.textContent = formatBytesPerSecond(system.networkInBytesPerSec);
  dom.netOutValue.textContent = formatBytesPerSecond(system.networkOutBytesPerSec);
  dom.diskValue.textContent = `${system.diskPercent.toFixed(1)}%`;
  dom.successValue.textContent = `${web.successRate.toFixed(2)}%`;
  dom.fourxxValue.textContent = `${web.fourXxRate.toFixed(2)}%`;
  dom.statusCountsValue.textContent = `${web.statusCounts["2xx"]} / ${web.statusCounts["4xx"]} / ${web.statusCounts["5xx"]}`;
  dom.rwvValue.textContent = `${web.reading} / ${web.writing} / ${web.waiting}`;
  dom.attackModeValue.textContent = attack.mode;
  dom.attackPatternValue.textContent = attack.detectedPattern;
  dom.uniqueIpValue.textContent = `${attack.uniqueSourceCount}`;
  dom.dominanceValue.textContent = `${attack.dominantSourceShare.toFixed(2)}%`;

  setBadge(dom.systemBadge, system.cpuPercent >= 75 ? "System Warning" : "Healthy", system.cpuPercent >= 75 ? "danger" : "ok");
  setBadge(dom.webBadge, web.fiveXxRate > 3 ? "Service Degraded" : "Operational", web.fiveXxRate > 3 ? "danger" : "ok");
  setBadge(dom.attackBadge, attack.overallStatus, statusClasses[attack.overallStatus]);
  setBadge(dom.abnormalBadge, attack.abnormalTrafficDetected ? "Abnormal traffic detected" : "No abnormal traffic", attack.abnormalTrafficDetected ? "danger" : "neutral");
  setBadge(dom.spikeBadge, attack.spikeWarning ? "Spike warning active" : "No spike warning", attack.spikeWarning ? "warning" : "neutral");
  setBadge(
    dom.defenseBadge,
    defense.emergencyModeEnabled ? "Emergency Active" : defense.rateLimitEnabled || defense.connLimitEnabled ? "Controls Enabled" : "Idle",
    defense.emergencyModeEnabled ? "mitigating" : defense.rateLimitEnabled || defense.connLimitEnabled ? "info" : "neutral"
  );

  dom.rateLimitState.textContent = defense.rateLimitEnabled ? "ON" : "OFF";
  dom.connLimitState.textContent = defense.connLimitEnabled ? "ON" : "OFF";
  dom.emergencyState.textContent = defense.emergencyModeEnabled ? "ON" : "OFF";

  applyAlert(dom.cards.cpu, system.cpuPercent >= 75 ? "state-danger" : system.cpuPercent >= 60 ? "state-warning" : "state-ok");
  applyAlert(dom.cards.ram, system.memoryPercent >= 85 ? "state-danger" : system.memoryPercent >= 70 ? "state-warning" : "state-ok");
  applyAlert(dom.cards.rps, attack.spikeWarning ? "state-danger" : "state-ok");
  applyAlert(dom.cards.conn, web.activeConnections >= attack.thresholds.connectionAlert ? "state-danger" : "state-ok");
  applyAlert(dom.cards.latency, attack.highLatency ? "state-warning" : "state-ok");
  applyAlert(dom.cards.error, web.fiveXxRate > 3 ? "state-danger" : web.fourXxRate > 10 ? "state-warning" : "state-ok");

  updateTopSources(attack.topSources || []);
}

async function callDefenseAction(action) {
  const routeMap = {
    "rate-limit-enable": "/api/defense/rate-limit/enable",
    "rate-limit-disable": "/api/defense/rate-limit/disable",
    "conn-limit-enable": "/api/defense/conn-limit/enable",
    "conn-limit-disable": "/api/defense/conn-limit/disable",
    "emergency-enable": "/api/defense/emergency/enable",
    "emergency-disable": "/api/defense/emergency/disable",
    reload: "/api/nginx/reload"
  };

  const response = await fetch(routeMap[action], { method: "POST" });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Action failed");
  }
}

function bindDefenseButtons() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const { action } = button.dataset;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "Working...";

      try {
        await callDefenseAction(action);
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureChartLibrary() {
  if (window.Chart) {
    return;
  }

  try {
    await loadScript("/vendor/chart.js/chart.umd.js");
  } catch (error) {
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/chart.js");
    } catch (fallbackError) {
      throw new Error("Unable to load Chart.js");
    }
  }
}

function showChartError(message) {
  if (!dom.chartError) {
    return;
  }

  dom.chartError.hidden = false;
  dom.chartError.textContent = message;
}

async function boot() {
  setInterval(refreshClock, 1000);
  refreshClock();
  bindDefenseButtons();

  try {
    await ensureChartLibrary();
    initCharts();
  } catch (error) {
    showChartError("Realtime charts could not be initialized. Check Chart.js path or browser console.");
    console.error(error);
  }

  const socket = io();
  socket.on("metrics:update", updateDashboard);
  socket.on("metrics:history", updateCharts);
  socket.on("logs:update", updateLogs);
  socket.on("connect_error", () => {
    window.location.href = "/login";
  });
}

dom.logoutButton?.addEventListener("click", logout);
boot();
