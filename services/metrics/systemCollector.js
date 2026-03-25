const fs = require("fs");
const os = require("os");
const { promisify } = require("util");
const { execFile } = require("child_process");

const execFileAsync = promisify(execFile);

class SystemCollector {
  constructor({ networkInterface } = {}) {
    this.networkInterface = networkInterface || null;
    this.previousCpu = null;
    this.previousNet = null;
    this.cachedDisk = null;
    this.lastDiskCheck = 0;
  }

  async collect() {
    const [cpuStat, memInfo, loadAvg, netDev, diskUsage] = await Promise.all([
      this.readCpuStat(),
      this.readMemInfo(),
      this.readLoadAvg(),
      this.readNetworkDev(),
      this.readDiskUsage()
    ]);

    return {
      cpuPercent: this.calculateCpuUsage(cpuStat),
      memoryPercent: memInfo.memoryPercent,
      memoryUsedBytes: memInfo.usedBytes,
      memoryTotalBytes: memInfo.totalBytes,
      loadAverage: loadAvg,
      networkInBytesPerSec: netDev.inBytesPerSec,
      networkOutBytesPerSec: netDev.outBytesPerSec,
      diskPercent: diskUsage.percent,
      diskUsedBytes: diskUsage.usedBytes,
      diskTotalBytes: diskUsage.totalBytes
    };
  }

  async readCpuStat() {
    try {
      const content = await fs.promises.readFile("/proc/stat", "utf8");
      const firstLine = content.split("\n")[0];
      const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);
      const idle = (parts[3] || 0) + (parts[4] || 0);
      const total = parts.reduce((sum, value) => sum + value, 0);
      return { idle, total };
    } catch (error) {
      const cpus = os.cpus();
      const aggregate = cpus.reduce(
        (acc, cpu) => {
          Object.values(cpu.times).forEach((value) => {
            acc.total += value;
          });
          acc.idle += cpu.times.idle;
          return acc;
        },
        { idle: 0, total: 0 }
      );
      return aggregate;
    }
  }

  calculateCpuUsage(current) {
    if (!this.previousCpu) {
      this.previousCpu = { ...current };
      return 0;
    }

    const idleDiff = current.idle - this.previousCpu.idle;
    const totalDiff = current.total - this.previousCpu.total;
    this.previousCpu = { ...current };

    if (totalDiff <= 0) {
      return 0;
    }

    return Number((((totalDiff - idleDiff) / totalDiff) * 100).toFixed(2));
  }

  async readMemInfo() {
    try {
      const content = await fs.promises.readFile("/proc/meminfo", "utf8");
      const lines = content.split("\n");
      const map = {};
      lines.forEach((line) => {
        const match = line.match(/^(\w+):\s+(\d+)/);
        if (match) {
          map[match[1]] = Number(match[2]) * 1024;
        }
      });

      const totalBytes = map.MemTotal || os.totalmem();
      const available = map.MemAvailable || os.freemem();
      const usedBytes = Math.max(totalBytes - available, 0);

      return {
        totalBytes,
        usedBytes,
        memoryPercent: Number(((usedBytes / totalBytes) * 100).toFixed(2))
      };
    } catch (error) {
      const totalBytes = os.totalmem();
      const usedBytes = totalBytes - os.freemem();
      return {
        totalBytes,
        usedBytes,
        memoryPercent: Number(((usedBytes / totalBytes) * 100).toFixed(2))
      };
    }
  }

  async readLoadAvg() {
    try {
      const content = await fs.promises.readFile("/proc/loadavg", "utf8");
      const [one, five, fifteen] = content.trim().split(/\s+/).slice(0, 3).map(Number);
      return { one, five, fifteen };
    } catch (error) {
      const [one, five, fifteen] = os.loadavg();
      return { one, five, fifteen };
    }
  }

  async readNetworkDev() {
    const content = await fs.promises.readFile("/proc/net/dev", "utf8");
    const lines = content.split("\n").slice(2).filter(Boolean);
    const interfaces = lines
      .map((line) => {
        const [namePart, dataPart] = line.split(":");
        const name = namePart.trim();
        const parts = dataPart.trim().split(/\s+/).map(Number);
        return {
          name,
          receiveBytes: parts[0] || 0,
          transmitBytes: parts[8] || 0
        };
      })
      .filter((item) => !["lo", "docker0"].includes(item.name));

    const chosen = this.networkInterface
      ? interfaces.find((item) => item.name === this.networkInterface)
      : interfaces[0];

    if (!chosen) {
      return {
        interface: null,
        inBytesPerSec: 0,
        outBytesPerSec: 0
      };
    }

    const now = Date.now();
    const current = {
      interface: chosen.name,
      receiveBytes: chosen.receiveBytes,
      transmitBytes: chosen.transmitBytes,
      timestamp: now
    };

    if (!this.previousNet) {
      this.previousNet = current;
      return {
        interface: chosen.name,
        inBytesPerSec: 0,
        outBytesPerSec: 0
      };
    }

    const elapsedSeconds = Math.max((now - this.previousNet.timestamp) / 1000, 1);
    const inBytesPerSec = Math.max(
      (current.receiveBytes - this.previousNet.receiveBytes) / elapsedSeconds,
      0
    );
    const outBytesPerSec = Math.max(
      (current.transmitBytes - this.previousNet.transmitBytes) / elapsedSeconds,
      0
    );
    this.previousNet = current;

    return {
      interface: chosen.name,
      inBytesPerSec: Number(inBytesPerSec.toFixed(2)),
      outBytesPerSec: Number(outBytesPerSec.toFixed(2))
    };
  }

  async readDiskUsage() {
    const now = Date.now();
    if (this.cachedDisk && now - this.lastDiskCheck < 30000) {
      return this.cachedDisk;
    }

    try {
      const { stdout } = await execFileAsync("df", ["-kP", "/"]);
      const line = stdout.trim().split("\n")[1];
      const parts = line.trim().split(/\s+/);
      const totalBytes = Number(parts[1]) * 1024;
      const usedBytes = Number(parts[2]) * 1024;
      const percent = Number(String(parts[4]).replace("%", ""));
      this.cachedDisk = { totalBytes, usedBytes, percent };
      this.lastDiskCheck = now;
      return this.cachedDisk;
    } catch (error) {
      this.cachedDisk = this.cachedDisk || {
        totalBytes: 0,
        usedBytes: 0,
        percent: 0
      };
      return this.cachedDisk;
    }
  }
}

module.exports = { SystemCollector };
