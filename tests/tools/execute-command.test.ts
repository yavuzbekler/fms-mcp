import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeCommand } from "../../src/tools/execute-command.js";
import {
  createTestWorkspace,
  destroyTestWorkspace,
  parseResult,
  type TestWorkspace,
} from "./_helpers.js";

let ws: TestWorkspace;

beforeEach(async () => {
  ws = await createTestWorkspace();
});
afterEach(async () => {
  await destroyTestWorkspace(ws);
});

describe("execute_command", () => {
  it("basit echo komutu çalıştırır", async () => {
    const res = parseResult(
      await executeCommand.handler({ command: "echo hello" }),
    );
    expect(res.exit_code).toBe(0);
    expect((res.stdout as string).trim()).toBe("hello");
    expect(res.timed_out).toBe(false);
  });

  it("stderr çıktısını yakalar", async () => {
    const res = parseResult(
      await executeCommand.handler({ command: "echo err >&2" }),
    );
    expect((res.stderr as string).trim()).toBe("err");
  });

  it("exit code döner", async () => {
    const res = parseResult(
      await executeCommand.handler({ command: "exit 42" }),
    );
    expect(res.exit_code).toBe(42);
  });

  it("cwd parametresi workspace içinde çalışır", async () => {
    const res = parseResult(
      await executeCommand.handler({ command: "pwd", cwd: ws.root }),
    );
    expect((res.stdout as string).trim()).toBe(ws.root);
  });

  it("cwd path doğrulaması tool tanımında yapılandırılmış", () => {
    expect(executeCommand.requiresPathValidation).toBe(true);
    expect(executeCommand.pathFields).toContain("cwd");
    expect(executeCommand.pathOperation).toBe("read");
  });

  it("timeout ile timed_out true döner", async () => {
    const res = parseResult(
      await executeCommand.handler({
        command: "sleep 10",
        timeout_ms: 500,
      }),
    );
    expect(res.timed_out).toBe(true);
    expect(res.exit_code).toBe(-1);
  }, 10000);

  it("duration_ms pozitif", async () => {
    const res = parseResult(
      await executeCommand.handler({ command: "echo fast" }),
    );
    expect(res.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("env değişkenleri process'e geçer", async () => {
    const res = parseResult(
      await executeCommand.handler({
        command: "echo $MY_VAR",
        env: { MY_VAR: "test123" },
      }),
    );
    expect((res.stdout as string).trim()).toBe("test123");
  });

  it("büyük çıktı kesilir ve truncated true olur", async () => {
    const res = parseResult(
      await executeCommand.handler({
        command: "yes | head -n 10000",
        max_output_bytes: 100,
      }),
    );
    expect(res.stdout_truncated).toBe(true);
    expect((res.stdout as string).length).toBeLessThanOrEqual(100);
  });

  it("boş komut çalıştırır (boş çıktı)", async () => {
    const res = parseResult(
      await executeCommand.handler({ command: "true" }),
    );
    expect(res.exit_code).toBe(0);
    expect((res.stdout as string)).toBe("");
  });

  it("çok satırlı çıktı doğru döner", async () => {
    const res = parseResult(
      await executeCommand.handler({
        command: "echo line1; echo line2; echo line3",
      }),
    );
    const lines = (res.stdout as string).trim().split("\n");
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("command alanı sonuçta döner", async () => {
    const res = parseResult(
      await executeCommand.handler({ command: "echo test" }),
    );
    expect(res.command).toBe("echo test");
  });

  it("max_command_timeout_ms sınırı aşılamaz", async () => {
    process.env["MAX_COMMAND_TIMEOUT_MS"] = "1000";
    const { resetConfig } = await import("../../src/lib/config.js");
    resetConfig();

    const res = parseResult(
      await executeCommand.handler({
        command: "sleep 10",
        timeout_ms: 999999,
      }),
    );
    expect(res.timed_out).toBe(true);
  }, 10000);
});
