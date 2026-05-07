import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { CircularBuffer } from "./circular-buffer.js";
import { loadConfig } from "./config.js";
import { detectProjectFromCwd } from "./project-detection.js";
import {
  CommandSpawnError,
  ProcessNotFoundError,
  ProcessAlreadyExitedError,
  TooManyProcessesError,
} from "./errors.js";

export type ProcessStatus = "running" | "exited" | "killed" | "failed";

export interface ProcessEntry {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  status: ProcessStatus;
  started_at: string;
  exited_at?: string;
  exit_code?: number;
  signal?: string;
  project: string;
  name?: string;
  child: ChildProcess;
  stdout_buffer: CircularBuffer;
  stderr_buffer: CircularBuffer;
  stdout_total_bytes: number;
  stderr_total_bytes: number;
}

export interface SpawnOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  shell?: string;
  name?: string;
}

export interface ProcessOutputResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  status: ProcessStatus;
  signal?: string;
}

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  spawn(options: SpawnOptions): ProcessEntry {
    const config = loadConfig();
    const runningCount = this.getRunningCount();

    if (runningCount >= config.MAX_BACKGROUND_PROCESSES) {
      throw new TooManyProcessesError(
        `Maximum concurrent background processes reached (${config.MAX_BACKGROUND_PROCESSES})`,
      );
    }

    const id = crypto.randomUUID();
    const bufferSize = config.PROCESS_OUTPUT_BUFFER_BYTES;
    const shell = options.shell ?? "/bin/bash";

    let child: ChildProcess;
    try {
      child = spawn(shell, ["-c", options.command], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      throw new CommandSpawnError(
        `Failed to spawn command: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!child.pid) {
      throw new CommandSpawnError(`Failed to get PID for command: ${options.command}`);
    }

    const entry: ProcessEntry = {
      id,
      command: options.command,
      cwd: options.cwd,
      pid: child.pid,
      status: "running",
      started_at: new Date().toISOString(),
      project: detectProjectFromCwd(options.cwd),
      name: options.name,
      child,
      stdout_buffer: new CircularBuffer(bufferSize),
      stderr_buffer: new CircularBuffer(bufferSize),
      stdout_total_bytes: 0,
      stderr_total_bytes: 0,
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      entry.stdout_total_bytes += chunk.length;
      entry.stdout_buffer.write(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      entry.stderr_total_bytes += chunk.length;
      entry.stderr_buffer.write(chunk);
    });

    child.on("exit", (code, signal) => {
      entry.exited_at = new Date().toISOString();
      entry.exit_code = code ?? undefined;
      if (signal) {
        entry.signal = signal;
        entry.status = "killed";
      } else {
        entry.status = "exited";
      }
    });

    child.on("error", (err) => {
      entry.status = "failed";
      entry.exited_at = new Date().toISOString();
      entry.stderr_buffer.write(`Process error: ${err.message}\n`);
    });

    this.processes.set(id, entry);
    return entry;
  }

  getProcess(id: string): ProcessEntry | undefined {
    return this.processes.get(id);
  }

  listProcesses(
    statusFilter?: "running" | "exited" | "all",
    projectFilter?: string,
  ): ProcessEntry[] {
    let entries = Array.from(this.processes.values());

    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "running") {
        entries = entries.filter((e) => e.status === "running");
      } else {
        entries = entries.filter((e) => e.status !== "running");
      }
    }

    if (projectFilter) {
      entries = entries.filter((e) => e.project === projectFilter);
    }

    return entries;
  }

  async kill(
    id: string,
    signal: "SIGTERM" | "SIGKILL" | "SIGINT" = "SIGTERM",
    forceAfterMs = 5000,
  ): Promise<{ status: ProcessStatus; signal_sent: string; force_killed: boolean }> {
    const entry = this.processes.get(id);
    if (!entry) {
      throw new ProcessNotFoundError(`Process not found: ${id}`);
    }

    if (entry.status !== "running") {
      throw new ProcessAlreadyExitedError(
        `Process already ${entry.status}: ${id}`,
      );
    }

    entry.child.kill(signal);

    if (signal === "SIGKILL") {
      return { status: entry.status, signal_sent: signal, force_killed: false };
    }

    const forceKilled = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        if (entry.status === "running") {
          entry.child.kill("SIGKILL");
          resolve(true);
        } else {
          resolve(false);
        }
      }, forceAfterMs);
      if (timeout.unref) timeout.unref();

      entry.child.on("exit", () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });

    return { status: entry.status, signal_sent: signal, force_killed: forceKilled };
  }

  readOutput(
    id: string,
    stream: "stdout" | "stderr" | "both" = "both",
  ): {
    stdout?: string;
    stderr?: string;
    stdout_total_bytes: number;
    stderr_total_bytes: number;
    exit_code?: number;
    status: ProcessStatus;
    signal?: string;
  } {
    const entry = this.processes.get(id);
    if (!entry) {
      throw new ProcessNotFoundError(`Process not found: ${id}`);
    }

    return {
      stdout: stream === "stderr" ? undefined : entry.stdout_buffer.read(),
      stderr: stream === "stdout" ? undefined : entry.stderr_buffer.read(),
      stdout_total_bytes: entry.stdout_total_bytes,
      stderr_total_bytes: entry.stderr_total_bytes,
      exit_code: entry.exit_code,
      status: entry.status,
      signal: entry.signal,
    };
  }

  cleanup(): void {
    const config = loadConfig();
    const now = Date.now();

    for (const [id, entry] of this.processes) {
      if (entry.status === "running") continue;
      if (!entry.exited_at) continue;

      const exitedAt = new Date(entry.exited_at).getTime();
      if (now - exitedAt > config.PROCESS_CLEANUP_DELAY_MS) {
        this.processes.delete(id);
      }
    }
  }

  getRunningCount(): number {
    let count = 0;
    for (const entry of this.processes.values()) {
      if (entry.status === "running") count++;
    }
    return count;
  }

  getTotalCount(): number {
    return this.processes.size;
  }

  async shutdownAll(): Promise<void> {
    const running = this.listProcesses("running");
    for (const entry of running) {
      entry.child.kill("SIGTERM");
    }

    if (running.length === 0) return;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        for (const entry of running) {
          if (entry.status === "running") {
            entry.child.kill("SIGKILL");
          }
        }
        resolve();
      }, 5000);
      if (timeout.unref) timeout.unref();

      let exited = 0;
      for (const entry of running) {
        entry.child.on("exit", () => {
          exited++;
          if (exited >= running.length) {
            clearTimeout(timeout);
            resolve();
          }
        });
      }
    });
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  reset(): void {
    this.processes.clear();
  }
}

let _instance: ProcessManager | undefined;

export function getProcessManager(): ProcessManager {
  if (!_instance) {
    _instance = new ProcessManager();
  }
  return _instance;
}

export function resetProcessManager(): void {
  if (_instance) {
    _instance.dispose();
    _instance = undefined;
  }
}
