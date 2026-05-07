import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { moveFile } from "../../src/tools/move-file.js";
import {
  FileNotFoundError,
  DestinationExistsError,
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

describe("move_file", () => {
  it("dosyayı taşır", async () => {
    const src = await seedFile(ws, "project/old.txt", "içerik");
    const dest = ws.resolve("project/new.txt");
    const res = parseResult(
      await moveFile.handler({ source: src, destination: dest }),
    );
    expect(res.type).toBe("file");
    expect(res.source).toBe(src);
    expect(res.destination).toBe(dest);
    const content = await fs.readFile(dest, "utf-8");
    expect(content).toBe("içerik");
    await expect(fs.access(src)).rejects.toThrow();
  });

  it("dizini taşır", async () => {
    const src = await seedDir(ws, "project/olddir");
    await seedFile(ws, "project/olddir/file.txt", "test");
    const dest = ws.resolve("project/newdir");
    const res = parseResult(
      await moveFile.handler({ source: src, destination: dest }),
    );
    expect(res.type).toBe("directory");
    const content = await fs.readFile(ws.resolve("project/newdir/file.txt"), "utf-8");
    expect(content).toBe("test");
  });

  it("hedef varsa ve overwrite=false ise DestinationExistsError fırlatır", async () => {
    const src = await seedFile(ws, "project/a.txt", "a");
    const dest = await seedFile(ws, "project/b.txt", "b");
    await expect(
      moveFile.handler({ source: src, destination: dest, overwrite: false }),
    ).rejects.toThrow(DestinationExistsError);
  });

  it("overwrite=true ile hedefin üzerine yazar", async () => {
    const src = await seedFile(ws, "project/a.txt", "yeni");
    const dest = await seedFile(ws, "project/b.txt", "eski");
    await moveFile.handler({ source: src, destination: dest, overwrite: true });
    const content = await fs.readFile(dest, "utf-8");
    expect(content).toBe("yeni");
  });

  it("kaynak yoksa FileNotFoundError fırlatır", async () => {
    await expect(
      moveFile.handler({
        source: ws.resolve("project/ghost.txt"),
        destination: ws.resolve("project/dest.txt"),
      }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("tool metadata doğru", () => {
    expect(moveFile.requiresPathValidation).toBe(true);
    expect(moveFile.pathFields).toEqual(["source", "destination"]);
    expect(moveFile.pathOperation).toBe("write");
  });
});
