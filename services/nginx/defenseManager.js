const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { promisify } = require("util");
const { exec } = require("child_process");

const execAsync = promisify(exec);

class DefenseManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.state = {
      rateLimitEnabled: false,
      connLimitEnabled: false,
      emergencyModeEnabled: false,
      lastUpdatedAt: null,
      lastAction: "initialized"
    };
  }

  async initialize() {
    await fs.promises.mkdir(path.dirname(this.options.stateFile), { recursive: true });
    this.state = await this.loadState();
  }

  getState() {
    return { ...this.state };
  }

  async loadState() {
    try {
      const raw = await fs.promises.readFile(this.options.stateFile, "utf8");
      return {
        ...this.state,
        ...JSON.parse(raw)
      };
    } catch (error) {
      await this.persistState(this.state);
      return this.state;
    }
  }

  async persistState(nextState) {
    this.state = {
      rateLimitEnabled: Boolean(nextState.rateLimitEnabled),
      connLimitEnabled: Boolean(nextState.connLimitEnabled),
      emergencyModeEnabled: Boolean(nextState.emergencyModeEnabled),
      lastAction: nextState.lastAction || this.state.lastAction,
      lastUpdatedAt: new Date().toISOString()
    };
    await fs.promises.writeFile(this.options.stateFile, JSON.stringify(this.state, null, 2));
    this.emit("stateChanged", this.getState());
  }

  async enableRateLimit() {
    return this.updateState(
      { rateLimitEnabled: true, lastAction: "enable-rate-limit" },
      "Rate limiting enabled"
    );
  }

  async disableRateLimit() {
    return this.updateState(
      { rateLimitEnabled: false, lastAction: "disable-rate-limit" },
      "Rate limiting disabled"
    );
  }

  async enableConnLimit() {
    return this.updateState(
      { connLimitEnabled: true, lastAction: "enable-conn-limit" },
      "Connection limiting enabled"
    );
  }

  async disableConnLimit() {
    return this.updateState(
      { connLimitEnabled: false, lastAction: "disable-conn-limit" },
      "Connection limiting disabled"
    );
  }

  async enableEmergencyMode() {
    return this.updateState(
      { emergencyModeEnabled: true, lastAction: "enable-emergency-mode" },
      "Emergency mode enabled"
    );
  }

  async disableEmergencyMode() {
    return this.updateState(
      { emergencyModeEnabled: false, lastAction: "disable-emergency-mode" },
      "Emergency mode disabled"
    );
  }

  async reloadOnly() {
    await this.runReloadFlow([]);
    return { message: "Nginx reloaded" };
  }

  async updateState(patch, message) {
    const previousState = this.getState();
    const nextState = {
      ...previousState,
      ...patch
    };
    const filesToManage = [
      this.options.nginxDefenseSnippetPath,
      this.options.nginxRateZonePath,
      this.options.nginxConnZonePath,
      this.options.nginxEmergencyPagePath
    ];
    const backups = await this.createBackups(filesToManage);

    try {
      await this.writeManagedFiles(nextState);
      await this.runReloadFlow(backups);
      await this.cleanupBackups(backups);
      await this.persistState(nextState);
      return { message };
    } catch (error) {
      await this.restoreBackups(backups);
      throw error;
    }
  }

  async writeManagedFiles(state) {
    const {
      nginxDefenseSnippetPath,
      nginxRateZonePath,
      nginxConnZonePath,
      nginxEmergencyPagePath,
      rateLimitZoneName,
      rateLimitRps,
      rateLimitBurst,
      rateLimitStatus,
      connLimitZoneName,
      connLimitPerIp,
      emergencyRateLimitRps,
      emergencyRateLimitBurst,
      emergencyConnLimitPerIp,
      emergencyStatusCode
    } = this.options;

    await fs.promises.mkdir(path.dirname(nginxDefenseSnippetPath), { recursive: true });
    await fs.promises.mkdir(path.dirname(nginxRateZonePath), { recursive: true });
    await fs.promises.mkdir(path.dirname(nginxConnZonePath), { recursive: true });
    await fs.promises.mkdir(path.dirname(nginxEmergencyPagePath), { recursive: true });

    const snippetLines = ["# Managed by Security Operations Mini Dashboard"];

    if (state.rateLimitEnabled || state.emergencyModeEnabled) {
      const effectiveRps = state.emergencyModeEnabled ? emergencyRateLimitRps : rateLimitRps;
      const effectiveBurst = state.emergencyModeEnabled ? emergencyRateLimitBurst : rateLimitBurst;
      await fs.promises.writeFile(
        nginxRateZonePath,
        [
          "# Managed by Security Operations Mini Dashboard",
          `limit_req_zone $binary_remote_addr zone=${rateLimitZoneName}:20m rate=${effectiveRps};`,
          ""
        ].join("\n")
      );
      snippetLines.push(
        `limit_req zone=${rateLimitZoneName} burst=${effectiveBurst} nodelay;`,
        `limit_req_status ${state.emergencyModeEnabled ? emergencyStatusCode : rateLimitStatus};`
      );
    } else {
      await this.safeUnlink(nginxRateZonePath);
    }

    if (state.connLimitEnabled || state.emergencyModeEnabled) {
      const effectiveConnLimit = state.emergencyModeEnabled
        ? emergencyConnLimitPerIp
        : connLimitPerIp;
      await fs.promises.writeFile(
        nginxConnZonePath,
        [
          "# Managed by Security Operations Mini Dashboard",
          `limit_conn_zone $binary_remote_addr zone=${connLimitZoneName}:20m;`,
          ""
        ].join("\n")
      );
      snippetLines.push(`limit_conn ${connLimitZoneName} ${effectiveConnLimit};`);
    } else {
      await this.safeUnlink(nginxConnZonePath);
    }

    if (state.emergencyModeEnabled) {
      await fs.promises.writeFile(
        nginxEmergencyPagePath,
        [
          "<!doctype html>",
          "<html><head><meta charset=\"utf-8\"><title>Service Protection Active</title></head>",
          "<body style=\"background:#09111f;color:#e5edf9;font-family:Arial,sans-serif;padding:48px;\">",
          "<h1>Service Protection Active</h1>",
          "<p>The system is under heavy load. Mitigation controls are enabled.</p>",
          "<p>Please retry in a few moments.</p>",
          "</body></html>",
          ""
        ].join("\n")
      );
      snippetLines.push(`error_page ${emergencyStatusCode} /security-dashboard-emergency.html;`);
      snippetLines.push("proxy_intercept_errors on;");
    } else {
      await this.safeUnlink(nginxEmergencyPagePath);
    }

    snippetLines.push("");
    await fs.promises.writeFile(nginxDefenseSnippetPath, snippetLines.join("\n"));
  }

  async runReloadFlow(backups) {
    try {
      await execAsync(this.options.nginxTestCommand);
      await execAsync(this.options.nginxReloadCommand);
    } catch (error) {
      if (backups.length) {
        await this.restoreBackups(backups);
      }
      const stderr = error.stderr || error.stdout || error.message;
      throw new Error(`Nginx validation/reload failed: ${stderr}`);
    }
  }

  async createBackups(files) {
    const uniqueTimestamp = Date.now();
    const backups = [];
    for (const file of files) {
      try {
        await fs.promises.access(file, fs.constants.F_OK);
        const backupPath = `${file}.bak-${uniqueTimestamp}`;
        await fs.promises.copyFile(file, backupPath);
        backups.push({ file, backupPath, existed: true });
      } catch (error) {
        backups.push({ file, backupPath: null, existed: false });
      }
    }
    return backups;
  }

  async restoreBackups(backups) {
    for (const backup of backups) {
      if (backup.existed && backup.backupPath) {
        await fs.promises.copyFile(backup.backupPath, backup.file);
        await this.safeUnlink(backup.backupPath);
      } else if (!backup.existed) {
        await this.safeUnlink(backup.file);
      }
    }
  }

  async cleanupBackups(backups) {
    for (const backup of backups) {
      if (backup.backupPath) {
        await this.safeUnlink(backup.backupPath);
      }
    }
  }

  async safeUnlink(filePath) {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

module.exports = { DefenseManager };
