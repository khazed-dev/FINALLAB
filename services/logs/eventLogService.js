const { EventEmitter } = require("events");

class EventLogService extends EventEmitter {
  constructor({ capacity = 300 } = {}) {
    super();
    this.capacity = capacity;
    this.events = [];
    this.cooldowns = new Map();
  }

  addEvent({ level = "info", type = "info", message, meta = {} }) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      type,
      message,
      meta
    };

    this.events.unshift(entry);
    if (this.events.length > this.capacity) {
      this.events = this.events.slice(0, this.capacity);
    }

    this.emit("log", entry);
    return entry;
  }

  addWithCooldown(key, cooldownMs, event) {
    const last = this.cooldowns.get(key) || 0;
    const now = Date.now();
    if (now - last < cooldownMs) {
      return null;
    }

    this.cooldowns.set(key, now);
    return this.addEvent(event);
  }

  getRecent(limit = 40) {
    return this.events.slice(0, limit);
  }
}

module.exports = { EventLogService };
