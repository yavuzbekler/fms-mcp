import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AuditLogger, resetAuditLogger } from "../../../src/lib/audit/logger.js";
import { resetConfig } from "../../../src/lib/config.js";
import type { AuditEntry } from "../../../src/types/index.js";

let testDir: string;
let auditDir: string;
let logger: AuditLogger;

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: new Date().toISOString(),
    tool: "read_file",
    project: "testproj",
    args: { path: "/workspace/testproj/file.ts" },
    result: "success",
    duration_ms: 5,
    ...overrides,
  };
}

beforeEach(async () => {
  resetAuditLogger();
  resetConfig();
  testDir = `/tmp/fms-audit-test-${crypto.randomBytes(6).toString("hex")}`;
  auditDir = path.join(testDir, ".fms-mcp", "audit");
  await fs.mkdir(auditDir, { recursive: true });
  process.env["WORKSPACE_ROOT"] = testDir;
  process.env["AUDIT_ENABLED"] = "true";
  process.env["AUDIT_DIR"] = auditDir;
  process.env["AUDIT_FLUSH_INTERVAL_MS"] = "10";
  logger = new AuditLogger();
});

afterEach(async () => {
  await logger.shutdown();
  resetConfig();
  resetAuditLogger();
  delete process.env["AUDIT_DIR"];
  delete process.env["AUDIT_ENABLED"];
  delete process.env["AUDIT_FLUSH_INTERVAL_MS"];
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("AuditLogger", () => {
  it("should write entry to correct project directory", async () => {
    await logger.init();
    logger.log(makeEntry({ project: "opop" }));
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "opop"));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.log$/);
  });

  it("should write valid JSONL format", async () => {
    await logger.init();
    logger.log(makeEntry({ tool: "write_file", project: "proj1" }));
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "proj1"));
    const content = await fs.readFile(path.join(auditDir, "proj1", files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.tool).toBe("write_file");
    expect(parsed.project).toBe("proj1");
  });

  it("should write multiple entries as separate lines", async () => {
    await logger.init();
    logger.log(makeEntry({ tool: "read_file", project: "proj" }));
    logger.log(makeEntry({ tool: "write_file", project: "proj" }));
    logger.log(makeEntry({ tool: "delete_file", project: "proj" }));
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "proj"));
    const content = await fs.readFile(path.join(auditDir, "proj", files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(3);

    expect(JSON.parse(lines[0]).tool).toBe("read_file");
    expect(JSON.parse(lines[1]).tool).toBe("write_file");
    expect(JSON.parse(lines[2]).tool).toBe("delete_file");
  });

  it("should separate entries by project", async () => {
    await logger.init();
    logger.log(makeEntry({ project: "opop", tool: "read_file" }));
    logger.log(makeEntry({ project: "so4chat", tool: "write_file" }));
    await logger.flush();

    const opFiles = await fs.readdir(path.join(auditDir, "opop"));
    const soFiles = await fs.readdir(path.join(auditDir, "so4chat"));
    expect(opFiles.length).toBe(1);
    expect(soFiles.length).toBe(1);
  });

  it("should write _system entries", async () => {
    await logger.init();
    logger.log(makeEntry({ project: "_system", tool: "ping" }));
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "_system"));
    expect(files.length).toBe(1);
  });

  it("log() should return immediately (fire-and-forget)", async () => {
    await logger.init();
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      logger.log(makeEntry({ project: "perf" }));
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
    await logger.flush();
  });

  it("flush should complete all pending writes", async () => {
    await logger.init();
    logger.log(makeEntry({ project: "flush-test" }));
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "flush-test"));
    expect(files.length).toBe(1);
    const content = await fs.readFile(
      path.join(auditDir, "flush-test", files[0]),
      "utf-8",
    );
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it("should be healthy after successful init", async () => {
    await logger.init();
    expect(logger.isHealthy()).toBe(true);
  });

  it("should not be healthy if audit dir is not writable", async () => {
    process.env["AUDIT_DIR"] = "/nonexistent/path/that/cannot/be/created";
    resetConfig();
    const badLogger = new AuditLogger();
    await badLogger.init();
    expect(badLogger.isHealthy()).toBe(false);
    await badLogger.shutdown();
  });

  it("should not crash when audit dir fails — silently degraded", async () => {
    process.env["AUDIT_DIR"] = "/nonexistent/path";
    resetConfig();
    const badLogger = new AuditLogger();
    await badLogger.init();
    badLogger.log(makeEntry());
    await badLogger.flush();
    // No crash — success
    await badLogger.shutdown();
  });

  it("should not write when AUDIT_ENABLED=false", async () => {
    process.env["AUDIT_ENABLED"] = "false";
    resetConfig();
    const disabledLogger = new AuditLogger();
    await disabledLogger.init();
    expect(disabledLogger.isEnabled()).toBe(false);
    expect(disabledLogger.isHealthy()).toBe(true);
    disabledLogger.log(makeEntry({ project: "should-not-exist" }));
    await disabledLogger.flush();

    const exists = await fs.access(path.join(auditDir, "should-not-exist")).then(() => true).catch(() => false);
    expect(exists).toBe(false);
    await disabledLogger.shutdown();
  });

  it("should handle error entries", async () => {
    await logger.init();
    logger.log(makeEntry({
      project: "errproj",
      result: "error",
      error: { code: "INVALID_PATH", message: "bad path" },
    }));
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "errproj"));
    const content = await fs.readFile(path.join(auditDir, "errproj", files[0]), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.result).toBe("error");
    expect(parsed.error.code).toBe("INVALID_PATH");
  });

  it("should include all AuditEntry fields in output", async () => {
    await logger.init();
    const entry = makeEntry({
      project: "full",
      size_bytes: 1024,
      exit_code: 0,
      request_id: "req-123",
    });
    logger.log(entry);
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "full"));
    const content = await fs.readFile(path.join(auditDir, "full", files[0]), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.size_bytes).toBe(1024);
    expect(parsed.exit_code).toBe(0);
    expect(parsed.request_id).toBe("req-123");
  });

  it("reset should clear all state", async () => {
    await logger.init();
    logger.log(makeEntry({ project: "reset-test" }));
    logger.reset();
    expect(logger.isEnabled()).toBe(false);
    // isHealthy returns true when disabled (no audit = no problem)
    expect(logger.isHealthy()).toBe(true);
  });

  it("should handle rapid sequential writes to same project", async () => {
    await logger.init();
    for (let i = 0; i < 50; i++) {
      logger.log(makeEntry({ project: "rapid", tool: `tool_${i}` }));
    }
    await logger.flush();

    const files = await fs.readdir(path.join(auditDir, "rapid"));
    let totalLines = 0;
    for (const f of files) {
      const content = await fs.readFile(path.join(auditDir, "rapid", f), "utf-8");
      totalLines += content.trim().split("\n").length;
    }
    expect(totalLines).toBe(50);
  });

  it("should handle concurrent writes to multiple projects", async () => {
    await logger.init();
    const projects = ["p1", "p2", "p3", "p4", "p5"];
    for (const p of projects) {
      for (let i = 0; i < 10; i++) {
        logger.log(makeEntry({ project: p }));
      }
    }
    await logger.flush();

    for (const p of projects) {
      const files = await fs.readdir(path.join(auditDir, p));
      let totalLines = 0;
      for (const f of files) {
        const content = await fs.readFile(path.join(auditDir, p, f), "utf-8");
        totalLines += content.trim().split("\n").length;
      }
      expect(totalLines).toBe(10);
    }
  });
});
