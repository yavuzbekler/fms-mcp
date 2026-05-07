import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startBackgroundProcess } from "../../src/tools/start-background-process.js";
import { readProcessOutput } from "../../src/tools/read-process-output.js";
import { killProcess } from "../../src/tools/kill-process.js";
import { listProcesses } from "../../src/tools/list-processes.js";
import {
  ProcessNotFoundError,
  ProcessAlreadyExitedError,
  TooManyProcessesError,
} from "../../src/lib/errors.js";
import {
  resetProcessManager,
  getProcessManager,
} from "../../src/lib/process-manager.js";
import {
  createTestWorkspace,
  destroyTestWorkspace,
  parseResult,
  type TestWorkspace,
} from "./_helpers.js";

let ws: TestWorkspace;

beforeEach(async () => {
  resetProcessManager();
  ws = await createTestWorkspace();
});

afterEach(async () => {
  const pm = getProcessManager();
  await pm.shutdownAll();
  resetProcessManager();
  await destroyTestWorkspace(ws);
});

describe("start_background_process", () => {
  it("process başlatır ve id döner", async () => {
    const res = parseResult(
      await startBackgroundProcess.handler({ command: "sleep 10" }),
    );
    expect(res.id).toBeTruthy();
    expect(res.pid).toBeGreaterThan(0);
    expect(res.command).toBe("sleep 10");
    expect(res.started_at).toBeTruthy();
  });

  it("name parametresi geçirilir", async () => {
    const res = parseResult(
      await startBackgroundProcess.handler({
        command: "sleep 10",
        name: "dev-server",
      }),
    );
    expect(res.id).toBeTruthy();
  });

  it("eşzamanlı limit aşılırsa hata verir", async () => {
    process.env["MAX_BACKGROUND_PROCESSES"] = "2";
    const { resetConfig } = await import("../../src/lib/config.js");
    resetConfig();

    await startBackgroundProcess.handler({ command: "sleep 60" });
    await startBackgroundProcess.handler({ command: "sleep 60" });

    await expect(
      startBackgroundProcess.handler({ command: "sleep 60" }),
    ).rejects.toThrow(TooManyProcessesError);
  });
});

describe("read_process_output", () => {
  it("process çıktısını okur", async () => {
    const startRes = parseResult(
      await startBackgroundProcess.handler({
        command: "echo hello-from-bg",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));

    const readRes = parseResult(
      await readProcessOutput.handler({ id: startRes.id as string }),
    );
    expect((readRes.stdout as string)).toContain("hello-from-bg");
  });

  it("wait_ms parametresi bekler", async () => {
    const startRes = parseResult(
      await startBackgroundProcess.handler({
        command: "echo waited",
      }),
    );

    const readRes = parseResult(
      await readProcessOutput.handler({
        id: startRes.id as string,
        wait_ms: 300,
      }),
    );
    expect((readRes.stdout as string)).toContain("waited");
  });

  it("sadece stderr okur", async () => {
    const startRes = parseResult(
      await startBackgroundProcess.handler({
        command: "echo errdata >&2",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));

    const readRes = parseResult(
      await readProcessOutput.handler({
        id: startRes.id as string,
        stream: "stderr",
      }),
    );
    expect((readRes.stderr as string)).toContain("errdata");
    expect(readRes.stdout).toBeUndefined();
  });

  it("olmayan process hata verir", async () => {
    await expect(
      readProcessOutput.handler({ id: "fake-id" }),
    ).rejects.toThrow(ProcessNotFoundError);
  });

  it("exit code ve status döner", async () => {
    const startRes = parseResult(
      await startBackgroundProcess.handler({
        command: "exit 7",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));

    const readRes = parseResult(
      await readProcessOutput.handler({ id: startRes.id as string }),
    );
    expect(readRes.exit_code).toBe(7);
    expect(readRes.status).toBe("exited");
  });
});

describe("kill_process", () => {
  it("çalışan process'i öldürür", async () => {
    const startRes = parseResult(
      await startBackgroundProcess.handler({ command: "sleep 60" }),
    );

    const killRes = parseResult(
      await killProcess.handler({ id: startRes.id as string }),
    );
    expect(killRes.signal_sent).toBe("SIGTERM");
    expect(killRes.id).toBe(startRes.id);
  });

  it("SIGKILL sinyali gönderir", async () => {
    const startRes = parseResult(
      await startBackgroundProcess.handler({ command: "sleep 60" }),
    );

    const killRes = parseResult(
      await killProcess.handler({
        id: startRes.id as string,
        signal: "SIGKILL",
      }),
    );
    expect(killRes.signal_sent).toBe("SIGKILL");
  });

  it("olmayan process hata verir", async () => {
    await expect(
      killProcess.handler({ id: "fake-id" }),
    ).rejects.toThrow(ProcessNotFoundError);
  });

  it("zaten bitmiş process hata verir", async () => {
    const startRes = parseResult(
      await startBackgroundProcess.handler({ command: "echo done" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));

    await expect(
      killProcess.handler({ id: startRes.id as string }),
    ).rejects.toThrow(ProcessAlreadyExitedError);
  });
});

describe("list_processes", () => {
  it("tüm process'leri listeler", async () => {
    await startBackgroundProcess.handler({ command: "sleep 10" });
    await startBackgroundProcess.handler({ command: "sleep 10" });

    const res = parseResult(await listProcesses.handler({}));
    expect(res.total_count).toBe(2);
    expect((res.processes as unknown[]).length).toBe(2);
  });

  it("running filtresi çalışır", async () => {
    await startBackgroundProcess.handler({ command: "sleep 60" });
    await startBackgroundProcess.handler({ command: "echo fast" });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const res = parseResult(
      await listProcesses.handler({ status_filter: "running" }),
    );
    expect(res.total_count).toBe(1);
  });

  it("exited filtresi çalışır", async () => {
    await startBackgroundProcess.handler({ command: "echo done" });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const res = parseResult(
      await listProcesses.handler({ status_filter: "exited" }),
    );
    expect(res.total_count).toBe(1);
  });

  it("boş liste döner", async () => {
    const res = parseResult(await listProcesses.handler({}));
    expect(res.total_count).toBe(0);
  });

  it("process bilgileri doğru alanlar içerir", async () => {
    await startBackgroundProcess.handler({ command: "sleep 10" });

    const res = parseResult(await listProcesses.handler({}));
    const procs = res.processes as Array<Record<string, unknown>>;
    expect(procs[0]).toHaveProperty("id");
    expect(procs[0]).toHaveProperty("pid");
    expect(procs[0]).toHaveProperty("command");
    expect(procs[0]).toHaveProperty("status");
    expect(procs[0]).toHaveProperty("started_at");
    expect(procs[0]).toHaveProperty("duration_ms");
  });
});
