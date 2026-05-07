import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchFiles } from "../../src/tools/search-files.js";
import {
  FileNotFoundError,
  NotDirectoryError,
} from "../../src/lib/errors.js";
import {
  createTestWorkspace,
  destroyTestWorkspace,
  seedFile,
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

describe("search_files", () => {
  it("glob pattern ile dosya bulur", async () => {
    await seedFile(ws, "project/src/app.ts", "ts");
    await seedFile(ws, "project/src/style.css", "css");
    await seedFile(ws, "project/src/utils/helper.ts", "ts");
    const res = parseResult(
      await searchFiles.handler({
        path: ws.resolve("project"),
        pattern: "**/*.ts",
      }),
    );
    const matches = res.matches as string[];
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.endsWith(".ts"))).toBe(true);
  });

  it("max_results ile sınırlar", async () => {
    for (let i = 0; i < 10; i++) {
      await seedFile(ws, `project/file${i}.txt`, `content${i}`);
    }
    const res = parseResult(
      await searchFiles.handler({
        path: ws.resolve("project"),
        pattern: "*.txt",
        max_results: 3,
      }),
    );
    const matches = res.matches as string[];
    expect(matches).toHaveLength(3);
    expect(res.truncated).toBe(true);
    expect(res.total_count).toBe(10);
  });

  it("hidden dosyaları include_hidden=false ile atlar", async () => {
    await seedFile(ws, "project/.env", "secret");
    await seedFile(ws, "project/app.ts", "code");
    const res = parseResult(
      await searchFiles.handler({
        path: ws.resolve("project"),
        pattern: "**/*",
        include_hidden: false,
      }),
    );
    const matches = res.matches as string[];
    expect(matches.some((m) => m.includes(".env"))).toBe(false);
  });

  it("include_hidden=true ile hidden dosyaları bulur", async () => {
    await seedFile(ws, "project/.env", "secret");
    const res = parseResult(
      await searchFiles.handler({
        path: ws.resolve("project"),
        pattern: "**/.env",
        include_hidden: true,
      }),
    );
    const matches = res.matches as string[];
    expect(matches).toHaveLength(1);
  });

  it("olmayan dizinde FileNotFoundError fırlatır", async () => {
    await expect(
      searchFiles.handler({
        path: ws.resolve("nope"),
        pattern: "*.ts",
      }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("dosya verilirse NotDirectoryError fırlatır", async () => {
    const fp = await seedFile(ws, "project/f.txt", "x");
    await expect(
      searchFiles.handler({ path: fp, pattern: "*.ts" }),
    ).rejects.toThrow(NotDirectoryError);
  });

  it("tool metadata doğru", () => {
    expect(searchFiles.requiresPathValidation).toBe(true);
    expect(searchFiles.pathOperation).toBe("read");
  });
});
