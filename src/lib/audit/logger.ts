// AuditLogger bypasses path-lock intentionally: it writes to .fms-mcp/audit/
// which is reserved (tools can't write there). It uses fs APIs directly but
// logically stays within WORKSPACE_ROOT.

import fsp from "node:fs/promises";
import type { AuditEntry } from "../../types/index.js";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { StreamManager } from "./rotation.js";

export class AuditLogger {
  private queue: { project: string; line: string }[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private streamManager: StreamManager | null = null;
  private _healthy = false;
  private _enabled = false;
  private _initialized = false;

  async init(): Promise<void> {
    const config = loadConfig();
    this._enabled = config.AUDIT_ENABLED;

    if (!this._enabled) {
      this._initialized = true;
      return;
    }

    const auditDir = config.resolvedAuditDir;

    try {
      await fsp.mkdir(auditDir, { recursive: true });
      await fsp.access(auditDir, fsp.constants.W_OK);
      this._healthy = true;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "audit directory not writable — audit degraded",
      );
      this._healthy = false;
    }

    this.streamManager = new StreamManager(auditDir, config.AUDIT_MAX_DAILY_MB);

    this.flushTimer = setInterval(
      () => this.processQueue(),
      config.AUDIT_FLUSH_INTERVAL_MS,
    );
    if (this.flushTimer.unref) this.flushTimer.unref();

    this._initialized = true;
  }

  log(entry: AuditEntry): void {
    if (!this._enabled || !this._healthy) return;

    try {
      const line = JSON.stringify(entry) + "\n";
      this.queue.push({ project: entry.project, line });
    } catch {
      // serialization failed — silently drop
    }
  }

  async flush(): Promise<void> {
    await this.processQueue();
    if (this.streamManager) {
      await this.streamManager.closeAll();
    }
  }

  isHealthy(): boolean {
    if (!this._enabled) return true;
    return this._healthy;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    const grouped = new Map<string, string[]>();

    for (const item of batch) {
      let arr = grouped.get(item.project);
      if (!arr) {
        arr = [];
        grouped.set(item.project, arr);
      }
      arr.push(item.line);
    }

    for (const [project, lines] of grouped) {
      try {
        const stream = await this.streamManager!.getStream(project);
        const chunk = lines.join("");
        const ok = stream.write(chunk);
        if (!ok) {
          await new Promise<void>((resolve) => stream.once("drain", resolve));
        }
      } catch (err) {
        this._healthy = false;
        logger.error(
          { project, error: err instanceof Error ? err.message : String(err) },
          "audit write failed",
        );
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  reset(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.queue = [];
    this.streamManager = null;
    this._healthy = false;
    this._enabled = false;
    this._initialized = false;
  }
}

let _instance: AuditLogger | undefined;

export function getAuditLogger(): AuditLogger {
  if (!_instance) {
    _instance = new AuditLogger();
  }
  return _instance;
}

export function resetAuditLogger(): void {
  if (_instance) {
    _instance.reset();
    _instance = undefined;
  }
}
