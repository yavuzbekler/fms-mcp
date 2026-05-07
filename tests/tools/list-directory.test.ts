import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listDirectory } from "../../src/tools/list-directory.js";
import {
  FileNotFoundError,
  NotDirectoryError,
} from "../../src/lib/errors.js";
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
  ws = await createTestWorkspace();
});
afterEach(async () => {
  await destroyTestWorkspace(ws);
});

describe("list_directory", () => {
  it("dizin içeriğini listeler", async () => {
    await seedFile(ws, "project/a.txt", "a");
    await seedFile(ws, "project/b.txt", "b");
    await seedDir(ws, "project/sub");
    const res = parseResult(
      await listDirectory.handler({ path: ws.resolve("project") }),
    );
    const entries = res.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);
    const names = entries.map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("sub");
  });

  it("recursive modda alt dizinleri tarar", async () => {
    await seedFile(ws, "project/top.txt", "t");
    await seedFile(ws, "project/sub/deep.txt", "d");
    const res = parseResult(
      await listDirectory.handler({
        path: ws.resolve("project"),
        recursive: true,
      }),
    );
    const entries = res.entries as Array<Record<string, unknown>>;
    const names = entries.map((e) => e.name);
    expect(names).toContain("deep.txt");
    expect(names).toContain("sub");
  });

  it("hidden dosyaları include_hidden=false ile gizler", async () => {
    await seedFile(ws, "project/.hidden", "gizli");
    await seedFile(ws, "project/visible.txt", "görünür");
    const res = parseResult(
      await listDirectory.handler({
        path: ws.resolve("project"),
        include_hidden: false,
      }),
    );
    const entries = res.entries as Array<Record<string, unknown>>;
    const names = entries.map((e) => e.name);
    expect(names).not.toContain(".hidden");
    expect(names).toContain("visible.txt");
  });

  it("include_hidden=true ile hidden dosyaları gösterir", async () => {
    await seedFile(ws, "project/.hidden", "gizli");
    const res = parseResult(
      await listDirectory.handler({
        path: ws.resolve("project"),
        include_hidden: true,
      }),
    );
    const entries = res.entries as Array<Record<string, unknown>>;
    const names = entries.map((e) => e.name);
    expect(names).toContain(".hidden");
  });

  it("pattern ile filtreler", async () => {
    await seedFile(ws, "project/app.ts", "ts");
    await seedFile(ws, "project/style.css", "css");
    const res = parseResult(
      await listDirectory.handler({
        path: ws.resolve("project"),
        pattern: "*.ts",
      }),
    );
    const entries = res.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("app.ts");
  });

  it("olmayan dizinde FileNotFoundError fırlatır", async () => {
    await expect(
      listDirectory.handler({ path: ws.resolve("nope") }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("dosya verilirse NotDirectoryError fırlatır", async () => {
    const fp = await seedFile(ws, "project/file.txt", "x");
    await expect(listDirectory.handler({ path: fp })).rejects.toThrow(
      NotDirectoryError,
    );
  });

  it("entry'lerde type alanı doğru", async () => {
    await seedFile(ws, "project/f.txt", "file");
    await seedDir(ws, "project/d");
    const res = parseResult(
      await listDirectory.handler({ path: ws.resolve("project") }),
    );
    const entries = res.entries as Array<Record<string, unknown>>;
    const fileEntry = entries.find((e) => e.name === "f.txt");
    const dirEntry = entries.find((e) => e.name === "d");
    expect(fileEntry?.type).toBe("file");
    expect(dirEntry?.type).toBe("directory");
  });

  it("tool metadata doğru", () => {
    expect(listDirectory.requiresPathValidation).toBe(true);
    expect(listDirectory.pathOperation).toBe("read");
  });
});
