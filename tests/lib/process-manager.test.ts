import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProcessManager } from "../../src/lib/process-manager.js";
import {
  ProcessNotFoundError,
  ProcessAlreadyExitedError,
  TooManyProcessesError,
} from "../../src/lib/errors.js";
import { resetConfig } from "../../src/lib/config.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";

let pm: ProcessManager;
let testRoot: string;

beforeEach(async () => {
  const id = crypto.randomBytes(6).toString("hex");
  testRoot = `/tmp/fms-pm-test-${id}`;
  await fs.mkdir(testRoot, { recursive: true });
  resetConfig();
  process.env["WORKSPACE_ROOT"] = testRoot;
  pm = new ProcessManager();
});

afterEach(async () => {
  await pm.shutdownAll();
  pm.dispose();
  resetConfig();
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe("ProcessManager", () => {
  it("komutu spawn eder ve entry döner", () => {
    const entry = pm.spawn({ command: "echo hi", cwd: testRoot });
    expect(entry.id).toBeTruthy();
    expect(entry.pid).toBeGreaterThan(0);
    expect(entry.command).toBe("echo hi");
    expect(entry.status).toBe("running");
  });

  it("exit sonrası status güncellenir", async () => {
    const entry = pm.spawn({ command: "echo done", cwd: testRoot });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });
    expect(entry.status).toBe("exited");
    expect(entry.exit_code).toBe(0);
  });

  it("stdout output buffer'a yazılır", async () => {
    const entry = pm.spawn({ command: "echo hello-world", cwd: testRoot });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });
    const output = pm.readOutput(entry.id);
    expect(output.stdout).toContain("hello-world");
    expect(output.status).toBe("exited");
  });

  it("stderr output buffer'a yazılır", async () => {
    const entry = pm.spawn({
      command: "echo errdata >&2",
      cwd: testRoot,
    });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });
    const output = pm.readOutput(entry.id);
    expect(output.stderr).toContain("errdata");
  });

  it("sadece stdout stream okur", async () => {
    const entry = pm.spawn({
      command: "echo out; echo err >&2",
      cwd: testRoot,
    });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });
    const output = pm.readOutput(entry.id, "stdout");
    expect(output.stdout).toContain("out");
    expect(output.stderr).toBeUndefined();
  });

  it("process listeler", () => {
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    const all = pm.listProcesses();
    expect(all.length).toBe(2);
  });

  it("running filtresi çalışır", async () => {
    const entry = pm.spawn({ command: "echo x", cwd: testRoot });
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });
    const running = pm.listProcesses("running");
    expect(running.length).toBe(1);
  });

  it("process kill eder", async () => {
    const entry = pm.spawn({ command: "sleep 60", cwd: testRoot });
    const result = await pm.kill(entry.id);
    expect(result.signal_sent).toBe("SIGTERM");
    expect(["killed", "exited"]).toContain(entry.status);
  });

  it("SIGKILL ile anında öldürür", async () => {
    const entry = pm.spawn({ command: "sleep 60", cwd: testRoot });
    const result = await pm.kill(entry.id, "SIGKILL");
    expect(result.signal_sent).toBe("SIGKILL");
  });

  it("olmayan process'i kill etmek hata verir", async () => {
    await expect(pm.kill("nonexistent-id")).rejects.toThrow(ProcessNotFoundError);
  });

  it("zaten bitmiş process kill edilemez", async () => {
    const entry = pm.spawn({ command: "echo x", cwd: testRoot });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });
    await expect(pm.kill(entry.id)).rejects.toThrow(ProcessAlreadyExitedError);
  });

  it("olmayan process output okumak hata verir", () => {
    expect(() => pm.readOutput("fake")).toThrow(ProcessNotFoundError);
  });

  it("getProcess var olan entry döner", () => {
    const entry = pm.spawn({ command: "sleep 10", cwd: testRoot });
    expect(pm.getProcess(entry.id)).toBe(entry);
  });

  it("getProcess olmayan id undefined döner", () => {
    expect(pm.getProcess("fake")).toBeUndefined();
  });

  it("running count doğru", () => {
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    expect(pm.getRunningCount()).toBe(2);
    expect(pm.getTotalCount()).toBe(2);
  });

  it("eşzamanlı limit aşılırsa hata verir", () => {
    process.env["MAX_BACKGROUND_PROCESSES"] = "2";
    resetConfig();
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    expect(() =>
      pm.spawn({ command: "sleep 10", cwd: testRoot }),
    ).toThrow(TooManyProcessesError);
  });

  it("cleanup eski exited process'leri siler", async () => {
    process.env["PROCESS_CLEANUP_DELAY_MS"] = "1";
    resetConfig();

    const entry = pm.spawn({ command: "echo x", cwd: testRoot });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    pm.cleanup();
    expect(pm.getProcess(entry.id)).toBeUndefined();
  });

  it("cleanup running process'leri silmez", () => {
    pm.spawn({ command: "sleep 10", cwd: testRoot });
    pm.cleanup();
    expect(pm.getTotalCount()).toBe(1);
  });

  it("shutdownAll tüm running process'leri öldürür", async () => {
    pm.spawn({ command: "sleep 60", cwd: testRoot });
    pm.spawn({ command: "sleep 60", cwd: testRoot });
    await pm.shutdownAll();
    expect(pm.getRunningCount()).toBe(0);
  });

  it("name parametresi entry'de saklanır", () => {
    const entry = pm.spawn({
      command: "sleep 10",
      cwd: testRoot,
      name: "test-proc",
    });
    expect(entry.name).toBe("test-proc");
  });

  it("hatalı komut failed status alır", async () => {
    const entry = pm.spawn({
      command: "exit 42",
      cwd: testRoot,
    });
    await new Promise<void>((resolve) => {
      entry.child.on("exit", () => resolve());
    });
    expect(entry.exit_code).toBe(42);
  });

  it("project detection cwd'den çalışır", async () => {
    const projectDir = `${testRoot}/myproject`;
    await fs.mkdir(projectDir, { recursive: true });
    const entry = pm.spawn({
      command: "echo x",
      cwd: projectDir,
    });
    expect(entry.project).toBe("myproject");
  });
});
