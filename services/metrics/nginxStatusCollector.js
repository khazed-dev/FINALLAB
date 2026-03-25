const http = require("http");
const https = require("https");

class NginxStatusCollector {
  constructor({ statusUrl }) {
    this.statusUrl = statusUrl || "http://127.0.0.1/nginx_status";
    this.previousRequests = null;
    this.previousTimestamp = null;
  }

  async collect() {
    try {
      const body = await this.fetchStatus();
      return this.parseStubStatus(body);
    } catch (error) {
      return {
        activeConnections: 0,
        accepts: 0,
        handled: 0,
        totalRequests: 0,
        reading: 0,
        writing: 0,
        waiting: 0,
        requestsPerSecFromNginx: 0,
        collectorError: error.message
      };
    }
  }

  fetchStatus() {
    const target = new URL(this.statusUrl);
    const client = target.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const request = client.get(
        this.statusUrl,
        {
          timeout: 2500
        },
        (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`nginx status returned ${response.statusCode}`));
            response.resume();
            return;
          }

          let data = "";
          response.on("data", (chunk) => {
            data += chunk.toString("utf8");
          });
          response.on("end", () => resolve(data));
        }
      );

      request.on("timeout", () => request.destroy(new Error("nginx status timeout")));
      request.on("error", reject);
    });
  }

  parseStubStatus(body) {
    const activeMatch = body.match(/Active connections:\s+(\d+)/i);
    const totalsMatch = body.match(/server accepts handled requests\s+(\d+)\s+(\d+)\s+(\d+)/i);
    const ioMatch = body.match(/Reading:\s+(\d+)\s+Writing:\s+(\d+)\s+Waiting:\s+(\d+)/i);
    const totalRequests = Number(totalsMatch?.[3] || 0);
    const now = Date.now();
    let requestsPerSecFromNginx = 0;

    if (this.previousRequests !== null && this.previousTimestamp !== null) {
      const elapsed = Math.max((now - this.previousTimestamp) / 1000, 1);
      requestsPerSecFromNginx = Number(
        Math.max((totalRequests - this.previousRequests) / elapsed, 0).toFixed(2)
      );
    }

    this.previousRequests = totalRequests;
    this.previousTimestamp = now;

    return {
      activeConnections: Number(activeMatch?.[1] || 0),
      accepts: Number(totalsMatch?.[1] || 0),
      handled: Number(totalsMatch?.[2] || 0),
      totalRequests,
      reading: Number(ioMatch?.[1] || 0),
      writing: Number(ioMatch?.[2] || 0),
      waiting: Number(ioMatch?.[3] || 0),
      requestsPerSecFromNginx
    };
  }
}

module.exports = { NginxStatusCollector };
