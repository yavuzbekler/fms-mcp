import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { deleteFile } from "../../src/tools/delete-file.js";
import {
  FileNotFoundError,
  IsDirectoryError,
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

describe("delete_file", () => {
  it("dosyayı siler", async () => {
    const fp = await seedFile(ws, "project/del.txt", "silinecek");
    const res = parseResult(await deleteFile.handler({ path: fp }));
    expect(res.deleted).toBe(true);
    expect(res.type).toBe("file");
    await expect(fs.access(fp)).rejects.toThrow();
  });

  it("dizini recursive ile siler", async () => {
    await seedFile(ws, "project/dir/a.txt", "a");
    await seedFile(ws, "project/dir/b.txt", "b");
    const dp = ws.resolve("project/dir");
    const res = parseResult(
      await deleteFile.handler({ path: dp, recursive: true }),
    );
    expect(res.deleted).toBe(true);
    expect(res.type).toBe("directory");
    await expect(fs.access(dp)).rejects.toThrow();
  });

  it("dizin recursive=false ile IsDirectoryError fırlatır", async () => {
    const dp = await seedDir(ws, "project/dir");
    await expect(
      deleteFile.handler({ path: dp, recursive: false }),
    ).rejects.toThrow(IsDirectoryError);
  });

  it("olmayan dosyada FileNotFoundError fırlatır", async () => {
    await expect(
      deleteFile.handler({ path: ws.resolve("project/ghost.txt") }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("tool metadata doğru", () => {
    expect(deleteFile.requiresPathValidation).toBe(true);
    expect(deleteFile.pathOperation).toBe("write");
  });
});
