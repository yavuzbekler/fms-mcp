import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resetConfig } from "../src/lib/config.js";
import { AuditLogger, resetAuditLogger } from "../src/lib/audit/logger.js";
import { redactArgs } from "../src/lib/audit/redact.js";
import { detectProject, detectProjectFromCwd } from "../src/lib/project-detection.js";
import type { AuditEntry } from "../src/types/index.js";

let testDir: string;
let auditDir: string;
let auditLogger: AuditLogger;

beforeEach(async () => {
  resetAuditLogger();
  resetConfig();
  testDir = `/tmp/fms-integ-test-${crypto.randomBytes(6).toString("hex")}`;
  auditDir = path.join(testDir, ".fms-mcp", "audit");
  await fs.mkdir(auditDir, { recursive: true });
  await fs.mkdir(path.join(testDir, "opop"), { recursive: true });
  await fs.mkdir(path.join(testDir, "so4chat"), { recursive: true });
  process.env["WORKSPACE_ROOT"] = testDir;
  process.env["AUDIT_ENABLED"] = "true";
  process.env["AUDIT_DIR"] = auditDir;
  process.env["AUDIT_FLUSH_INTERVAL_MS"] = "10";
  auditLogger = new AuditLogger();
  await auditLogger.init();
});

afterEach(async () => {
  await auditLogger.shutdown();
  resetConfig();
  resetAuditLogger();
  delete process.env["AUDIT_DIR"];
  delete process.env["AUDIT_ENABLED"];
  delete process.env["AUDIT_FLUSH_INTERVAL_MS"];
  await fs.rm(testDir, { recursive: true, force: true });
});

async function readAuditLines(project: string): Promise<Record<string, unknown>[]> {
  const dir = path.join(auditDir, project);
  try {
    const files = await fs.readdir(dir);
    const lines: Record<string, unknown>[] = [];
    for (const f of files) {
      const content = await fs.readFile(path.join(dir, f), "utf-8");
      for (const line of content.trim().split("\n")) {
        if (line.trim()) lines.push(JSON.parse(line));
      }
    }
    return lines;
  } catch {
    return [];
  }
}

describe("Server Audit Integration", () => {
  it("should write audit entry for successful tool call", async () => {
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      tool: "read_file",
      project: detectProject(path.join(testDir, "opop", "file.ts")),
      args: redactArgs({ path: path.join(testDir, "opop", "file.ts") }),
      result: "success",
      duration_ms: 12,
      size_bytes: 1024,
    };
    auditLogger.log(entry);
    await auditLogger.flush();

    const lines = await readAuditLines("opop");
    expect(lines.length).toBe(1);
    expect(lines[0]["tool"]).toBe("read_file");
    expect(lines[0]["result"]).toBe("success");
    expect(lines[0]["size_bytes"]).toBe(1024);
  });

  it("should write audit entry for error tool call", async () => {
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      tool: "write_file",
      project: detectProject(path.join(testDir, "opop", "file.ts")),
      args: redactArgs({ path: path.join(testDir, "opop", "file.ts"), content: "secret stuff" }),
      result: "error",
      duration_ms: 5,
      error: { code: "RESERVED_PATH", message: "Write access denied" },
    };
    auditLogger.log(entry);
    await auditLogger.flush();

    const lines = await readAuditLines("opop");
    expect(lines.length).toBe(1);
    expect(lines[0]["result"]).toBe("error");
    expect((lines[0]["error"] as Record<string, string>).code).toBe("RESERVED_PATH");
  });

  it("should redact content in write_file args", async () => {
    const args = { path: path.join(testDir, "opop", "file.ts"), content: "my secret content" };
    const redacted = redactArgs(args, ["content"]);

    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      tool: "write_file",
      project: "opop",
      args: redacted,
      result: "success",
      duration_ms: 10,
    };
    auditLogger.log(entry);
    await auditLogger.flush();

    const lines = await readAuditLines("opop");
    expect(lines[0]["args"]).toBeDefined();
    const loggedArgs = lines[0]["args"] as Record<string, unknown>;
    expect(loggedArgs["content"]).toMatch(/^\[REDACTED:\d+ bytes\]$/);
  });

  it("should route _system tools correctly", async () => {
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      tool: "ping",
      project: "_system",
      args: {},
      result: "success",
      duration_ms: 1,
    };
    auditLogger.log(entry);
    await auditLogger.flush();

    const lines = await readAuditLines("_system");
    expect(lines.length).toBe(1);
    expect(lines[0]["tool"]).toBe("ping");
  });

  it("should detect project from path correctly", () => {
    expect(detectProject(path.join(testDir, "opop", "src", "index.ts"))).toBe("opop");
    expect(detectProject(path.join(testDir, "so4chat", "package.json"))).toBe("so4chat");
    expect(detectProject(testDir)).toBe("_system");
  });

  it("should detect project from cwd", () => {
    expect(detectProjectFromCwd(path.join(testDir, "opop"))).toBe("opop");
    expect(detectProjectFromCwd(undefined)).toBe("_system");
  });

  it("should handle multiple projects in same flush", async () => {
    auditLogger.log({
      ts: new Date().toISOString(),
      tool: "read_file",
      project: "opop",
      args: {},
      result: "success",
      duration_ms: 5,
    });
    auditLogger.log({
      ts: new Date().toISOString(),
      tool: "write_file",
      project: "so4chat",
      args: {},
      result: "success",
      duration_ms: 8,
    });
    auditLogger.log({
      ts: new Date().toISOString(),
      tool: "ping",
      project: "_system",
      args: {},
      result: "success",
      duration_ms: 1,
    });
    await auditLogger.flush();

    expect((await readAuditLines("opop")).length).toBe(1);
    expect((await readAuditLines("so4chat")).length).toBe(1);
    expect((await readAuditLines("_system")).length).toBe(1);
  });

  it("should include duration_ms in audit entry", async () => {
    auditLogger.log({
      ts: new Date().toISOString(),
      tool: "execute_command",
      project: "opop",
      args: { command: "ls" },
      result: "success",
      duration_ms: 150,
      exit_code: 0,
    });
    await auditLogger.flush();

    const lines = await readAuditLines("opop");
    expect(lines[0]["duration_ms"]).toBe(150);
    expect(lines[0]["exit_code"]).toBe(0);
  });

  it("should include process metadata for start_background_process", async () => {
    auditLogger.log({
      ts: new Date().toISOString(),
      tool: "start_background_process",
      project: "opop",
      args: { command: "npm run dev" },
      result: "success",
      duration_ms: 20,
      pid: 12345,
      process_id: "abc-def",
    });
    await auditLogger.flush();

    const lines = await readAuditLines("opop");
    expect(lines[0]["pid"]).toBe(12345);
    expect(lines[0]["process_id"]).toBe("abc-def");
  });

  it("should redact env in execute_command args", () => {
    const args = { command: "ls", env: { SECRET: "value", TOKEN: "abc" } };
    const redacted = redactArgs(args);
    expect(redacted["env"]).toBe("[REDACTED:2 keys]");
    expect(redacted["command"]).toBe("ls");
  });

  it("should handle path lock rejection as error entry", async () => {
    auditLogger.log({
      ts: new Date().toISOString(),
      tool: "write_file",
      project: "_system",
      args: { path: path.join(testDir, ".fms-mcp", "audit", "test.log") },
      result: "error",
      duration_ms: 2,
      error: { code: "RESERVED_PATH", message: "Write access denied to reserved path" },
    });
    await auditLogger.flush();

    const lines = await readAuditLines("_system");
    expect(lines.length).toBe(1);
    expect(lines[0]["result"]).toBe("error");
  });

  it("each JSONL line should be parseable independently", async () => {
    for (let i = 0; i < 5; i++) {
      auditLogger.log({
        ts: new Date().toISOString(),
        tool: `tool_${i}`,
        project: "jsonl-test",
        args: {},
        result: "success",
        duration_ms: i,
      });
    }
    await auditLogger.flush();

    const lines = await readAuditLines("jsonl-test");
    expect(lines.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(lines[i]["tool"]).toBe(`tool_${i}`);
    }
  });
});
