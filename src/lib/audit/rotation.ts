import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface RotationState {
  currentDate: string;
  hourlyFallback: boolean;
  stream: fs.WriteStream | null;
  currentPath: string | null;
  sizeCache: { size: number; checkedAt: number } | null;
}

const SIZE_CACHE_TTL_MS = 10_000;

function utcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function utcHourString(date: Date = new Date()): string {
  return String(date.getUTCHours()).padStart(2, "0");
}

export function buildLogPath(
  auditDir: string,
  project: string,
  date: Date,
  hourly: boolean,
): string {
  const dateStr = utcDateString(date);
  const fileName = hourly
    ? `${dateStr}-${utcHourString(date)}.log`
    : `${dateStr}.log`;
  return path.join(auditDir, project, fileName);
}

export class StreamManager {
  private streams = new Map<string, RotationState>();
  private maxDailyBytes: number;

  constructor(
    private auditDir: string,
    maxDailyMB: number,
  ) {
    this.maxDailyBytes = maxDailyMB * 1024 * 1024;
  }

  async getStream(project: string, now: Date = new Date()): Promise<fs.WriteStream> {
    const dateStr = utcDateString(now);
    let state = this.streams.get(project);

    if (state && state.currentDate !== dateStr) {
      await this.closeStream(state);
      state = undefined;
      this.streams.delete(project);
    }

    if (!state) {
      state = {
        currentDate: dateStr,
        hourlyFallback: false,
        stream: null,
        currentPath: null,
        sizeCache: null,
      };
      this.streams.set(project, state);
    }

    if (!state.hourlyFallback && state.stream) {
      const size = await this.getCachedSize(state);
      if (size >= this.maxDailyBytes) {
        await this.closeStream(state);
        state.hourlyFallback = true;
      }
    }

    const targetPath = buildLogPath(this.auditDir, project, now, state.hourlyFallback);

    if (state.currentPath !== targetPath) {
      await this.closeStream(state);
      const dir = path.dirname(targetPath);
      await fsp.mkdir(dir, { recursive: true });
      state.stream = fs.createWriteStream(targetPath, { flags: "a" });
      state.currentPath = targetPath;
      state.sizeCache = null;
    }

    return state.stream!;
  }

  private async getCachedSize(state: RotationState): Promise<number> {
    const now = Date.now();
    if (state.sizeCache && now - state.sizeCache.checkedAt < SIZE_CACHE_TTL_MS) {
      return state.sizeCache.size;
    }
    if (!state.currentPath) return 0;
    try {
      const stat = await fsp.stat(state.currentPath);
      state.sizeCache = { size: stat.size, checkedAt: now };
      return stat.size;
    } catch {
      return 0;
    }
  }

  private async closeStream(state: RotationState): Promise<void> {
    if (state.stream) {
      await new Promise<void>((resolve, reject) => {
        state.stream!.end(() => resolve());
        state.stream!.on("error", reject);
      }).catch(() => {});
      state.stream = null;
      state.currentPath = null;
      state.sizeCache = null;
    }
  }

  async closeAll(): Promise<void> {
    for (const state of this.streams.values()) {
      await this.closeStream(state);
    }
    this.streams.clear();
  }

  getOpenStreamCount(): number {
    let count = 0;
    for (const state of this.streams.values()) {
      if (state.stream) count++;
    }
    return count;
  }
}
