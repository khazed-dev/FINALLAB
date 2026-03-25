const fs = require("fs");

class AccessLogParser {
  constructor({ logPath }) {
    this.logPath = logPath || "/var/log/nginx/security_dashboard_access.log";
    this.position = 0;
    this.fileSignature = null;
    this.partialLine = "";
    this.entries = [];
    this.lastTickCount = 0;
    this.lastCollectTime = Date.now();
  }

  async collect() {
    try {
      await this.readNewLines();
      this.pruneEntries();
      const now = Date.now();
      const elapsed = Math.max((now - this.lastCollectTime) / 1000, 1);
      this.lastCollectTime = now;

      const last10Seconds = this.entries.filter((entry) => now - entry.ts <= 10000);
      const last60Seconds = this.entries.filter((entry) => now - entry.ts <= 60000);
      const statusCounts = { "2xx": 0, "4xx": 0, "5xx": 0, other: 0 };
      const topCounts = new Map();

      last60Seconds.forEach((entry) => {
        topCounts.set(entry.ip, (topCounts.get(entry.ip) || 0) + 1);
        if (entry.status >= 200 && entry.status < 300) {
          statusCounts["2xx"] += 1;
        } else if (entry.status >= 400 && entry.status < 500) {
          statusCounts["4xx"] += 1;
        } else if (entry.status >= 500 && entry.status < 600) {
          statusCounts["5xx"] += 1;
        } else {
          statusCounts.other += 1;
        }
      });

      const topSources = [...topCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ip, count]) => ({
          ip,
          count,
          share: last60Seconds.length ? Number(((count / last60Seconds.length) * 100).toFixed(2)) : 0
        }));

      const totalWindowRequests = last60Seconds.length;
      const successRate = totalWindowRequests
        ? Number(((statusCounts["2xx"] / totalWindowRequests) * 100).toFixed(2))
        : 100;
      const fourXxRate = totalWindowRequests
        ? Number(((statusCounts["4xx"] / totalWindowRequests) * 100).toFixed(2))
        : 0;
      const fiveXxRate = totalWindowRequests
        ? Number(((statusCounts["5xx"] / totalWindowRequests) * 100).toFixed(2))
        : 0;

      return {
        requestsPerSec: Number((this.lastTickCount / elapsed).toFixed(2)),
        requestsLast10Seconds: last10Seconds.length,
        requestsLast60Seconds: totalWindowRequests,
        averageResponseTime: last10Seconds.length
          ? Number(
              (
                last10Seconds.reduce((sum, entry) => sum + entry.requestTime, 0) /
                last10Seconds.length
              ).toFixed(3)
            )
          : 0,
        successRate,
        fourXxRate,
        fiveXxRate,
        statusCounts,
        topSources,
        uniqueSourceCount: new Set(last60Seconds.map((entry) => entry.ip)).size,
        dominantSourceShare: topSources[0]?.share || 0,
        collectorError: null
      };
    } catch (error) {
      return {
        requestsPerSec: 0,
        requestsLast10Seconds: 0,
        requestsLast60Seconds: 0,
        averageResponseTime: 0,
        successRate: 100,
        fourXxRate: 0,
        fiveXxRate: 0,
        statusCounts: { "2xx": 0, "4xx": 0, "5xx": 0, other: 0 },
        topSources: [],
        uniqueSourceCount: 0,
        dominantSourceShare: 0,
        collectorError: error.message
      };
    } finally {
      this.lastTickCount = 0;
    }
  }

  async readNewLines() {
    const stat = await fs.promises.stat(this.logPath);
    const signature = `${stat.dev}-${stat.ino}`;

    if (this.fileSignature && this.fileSignature !== signature) {
      this.position = 0;
      this.partialLine = "";
    }

    if (stat.size < this.position) {
      this.position = 0;
      this.partialLine = "";
    }

    this.fileSignature = signature;

    if (stat.size === this.position) {
      return;
    }

    const handle = await fs.promises.open(this.logPath, "r");
    try {
      const length = stat.size - this.position;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, this.position);
      this.position = stat.size;
      this.parseChunk(buffer.toString("utf8"));
    } finally {
      await handle.close();
    }
  }

  parseChunk(chunk) {
    const combined = `${this.partialLine}${chunk}`;
    const lines = combined.split(/\r?\n/);
    this.partialLine = lines.pop() || "";

    lines.forEach((line) => {
      const parsed = this.parseLine(line);
      if (parsed) {
        this.entries.push(parsed);
        this.lastTickCount += 1;
      }
    });
  }

  parseLine(line) {
    if (!line.trim()) {
      return null;
    }

    const match = line.match(
      /^(?<ip>\S+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"(?<request>[^"]*)"\s+(?<status>\d{3})\s+\S+\s+"[^"]*"\s+"[^"]*"(?:\s+rt=(?<rt>[\d.]+))?/
    );

    if (!match?.groups) {
      return null;
    }

    return {
      ts: Date.now(),
      ip: match.groups.ip,
      request: match.groups.request,
      status: Number(match.groups.status),
      requestTime: Number(match.groups.rt || 0)
    };
  }

  pruneEntries() {
    const cutoff = Date.now() - 60000;
    this.entries = this.entries.filter((entry) => entry.ts >= cutoff);
  }
}

module.exports = { AccessLogParser };
