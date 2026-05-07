import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { getWorkspaceInfo } from "../../src/tools/get-workspace-info.js";
import { tailFile } from "../../src/tools/tail-file.js";
import { healthCheck } from "../../src/tools/health-check.js";
import { FileNotFoundError, IsDirectoryError } from "../../src/lib/errors.js";
import { resetProcessManager } from "../../src/lib/process-manager.js";
import {
  createTestWorkspace,
  destroyTestWorkspace,
  seedFile,
  seedDir,
  parseResult,
  type TestWorkspace,
} from "./_helpers.js";

let ws: TestWorkspace;

beforeEach(async () => {
  resetProcessManager();
  ws = await createTestWorkspace();
});

afterEach(async () => {
  resetProcessManager();
  await destroyTestWorkspace(ws);
});

describe("get_workspace_info", () => {
  it("boş workspace listeler", async () => {
    const res = parseResult(await getWorkspaceInfo.handler({}));
    expect(res.workspace_root).toBe(ws.root);
    expect(res.total_projects).toBe(0);
    expect((res.projects as unknown[]).length).toBe(0);
  });

  it("proje klasörlerini tespit eder", async () => {
    await seedDir(ws, "project-a");
    await seedFile(ws, "project-a/index.ts", "console.log('a')");
    await seedDir(ws, "project-b");

    const res = parseResult(await getWorkspaceInfo.handler({}));
    expect(res.total_projects).toBe(2);
    const projects = res.projects as Array<Record<string, unknown>>;
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["project-a", "project-b"]);
  });

  it("dot ile başlayan klasörleri atlar", async () => {
    await seedDir(ws, ".hidden");
    await seedDir(ws, "visible");

    const res = parseResult(await getWorkspaceInfo.handler({}));
    expect(res.total_projects).toBe(1);
  });

  it("has_git ve has_package_json tespit eder", async () => {
    await seedDir(ws, "myapp/.git");
    await seedFile(ws, "myapp/package.json", "{}");

    const res = parseResult(await getWorkspaceInfo.handler({}));
    const projects = res.projects as Array<Record<string, unknown>>;
    expect(projects[0].has_git).toBe(true);
    expect(projects[0].has_package_json).toBe(true);
  });

  it("has_git false olur .git yoksa", async () => {
    await seedDir(ws, "simple");
    await seedFile(ws, "simple/readme.txt", "hello");

    const res = parseResult(await getWorkspaceInfo.handler({}));
    const projects = res.projects as Array<Record<string, unknown>>;
    expect(projects[0].has_git).toBe(false);
    expect(projects[0].has_package_json).toBe(false);
  });

  it("file_count ve size_bytes pozitif", async () => {
    await seedFile(ws, "proj/a.txt", "aaa");
    await seedFile(ws, "proj/b.txt", "bbb");

    const res = parseResult(await getWorkspaceInfo.handler({}));
    const projects = res.projects as Array<Record<string, unknown>>;
    expect(projects[0].file_count).toBeGreaterThanOrEqual(2);
    expect(projects[0].size_bytes).toBeGreaterThan(0);
  });

  it("generated_at ISO timestamp döner", async () => {
    const res = parseResult(await getWorkspaceInfo.handler({}));
    expect(typeof res.generated_at).toBe("string");
    expect(() => new Date(res.generated_at as string)).not.toThrow();
  });
});

describe("tail_file", () => {
  it("dosyanın son satırlarını okur", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`);
    const fp = await seedFile(ws, "proj/log.txt", lines.join("\n") + "\n");

    const res = parseResult(await tailFile.handler({ path: fp, lines: 5 }));
    const resultLines = res.lines as string[];
    expect(resultLines.length).toBe(5);
    expect(resultLines[4]).toBe("line-99");
  });

  it("from_end false ile baştan okur", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    const fp = await seedFile(ws, "proj/log.txt", lines.join("\n") + "\n");

    const res = parseResult(
      await tailFile.handler({ path: fp, lines: 3, from_end: false }),
    );
    const resultLines = res.lines as string[];
    expect(resultLines.length).toBe(3);
    expect(resultLines[0]).toBe("line-0");
  });

  it("dosya satır sayısından fazla istenirse tüm satırlar döner", async () => {
    const fp = await seedFile(ws, "proj/small.txt", "a\nb\nc\n");

    const res = parseResult(
      await tailFile.handler({ path: fp, lines: 100 }),
    );
    const resultLines = res.lines as string[];
    expect(resultLines.length).toBe(3);
  });

  it("total_lines doğru döner", async () => {
    const fp = await seedFile(ws, "proj/ten.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");

    const res = parseResult(await tailFile.handler({ path: fp }));
    expect(res.total_lines).toBe(10);
  });

  it("boş dosya boş array döner", async () => {
    const fp = await seedFile(ws, "proj/empty.txt", "");

    const res = parseResult(await tailFile.handler({ path: fp }));
    expect((res.lines as string[]).length).toBe(0);
  });

  it("olmayan dosya hata verir", async () => {
    await expect(
      tailFile.handler({ path: ws.resolve("proj/nope.txt") }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("dizin path hata verir", async () => {
    const dir = await seedDir(ws, "proj/adir");
    await expect(
      tailFile.handler({ path: dir }),
    ).rejects.toThrow(IsDirectoryError);
  });

  it("tek satırlık dosya çalışır", async () => {
    const fp = await seedFile(ws, "proj/one.txt", "single");

    const res = parseResult(await tailFile.handler({ path: fp }));
    const resultLines = res.lines as string[];
    expect(resultLines).toEqual(["single"]);
    expect(res.total_lines).toBe(1);
  });

  it("newline ile bitmeyen dosya doğru çalışır", async () => {
    const fp = await seedFile(ws, "proj/nonl.txt", "a\nb\nc");

    const res = parseResult(await tailFile.handler({ path: fp, lines: 2 }));
    const resultLines = res.lines as string[];
    expect(resultLines).toEqual(["b", "c"]);
  });
});

describe("health_check", () => {
  it("status ok döner erişilebilir workspace ile", async () => {
    const res = parseResult(await healthCheck.handler({}));
    expect(res.status).toBe("ok");
    expect(res.workspace_accessible).toBe(true);
    expect(res.audit_dir_writable).toBe(true);
  });

  it("audit_dir_writable true döner dizin varsa", async () => {
    await seedDir(ws, ".fms-mcp/audit");
    const res = parseResult(await healthCheck.handler({}));
    expect(res.audit_dir_writable).toBe(true);
    expect(res.status).toBe("ok");
  });

  it("version string döner", async () => {
    const res = parseResult(await healthCheck.handler({}));
    expect(typeof res.version).toBe("string");
  });

  it("uptime_seconds sayı döner", async () => {
    const res = parseResult(await healthCheck.handler({}));
    expect(typeof res.uptime_seconds).toBe("number");
    expect(res.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("node_version döner", async () => {
    const res = parseResult(await healthCheck.handler({}));
    expect((res.node_version as string).startsWith("v")).toBe(true);
  });

  it("memory_usage alanları pozitif", async () => {
    const res = parseResult(await healthCheck.handler({}));
    const mem = res.memory_usage as Record<string, number>;
    expect(mem.rss_bytes).toBeGreaterThan(0);
    expect(mem.heap_used_bytes).toBeGreaterThan(0);
    expect(mem.heap_total_bytes).toBeGreaterThan(0);
  });

  it("running_processes ve total_processes sayı döner", async () => {
    const res = parseResult(await healthCheck.handler({}));
    expect(typeof res.running_processes).toBe("number");
    expect(typeof res.total_processes).toBe("number");
  });

  it("timestamp ISO format döner", async () => {
    const res = parseResult(await healthCheck.handler({}));
    expect(typeof res.timestamp).toBe("string");
    const d = new Date(res.timestamp as string);
    expect(d.getTime()).not.toBeNaN();
  });
});
