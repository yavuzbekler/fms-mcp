import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readMultipleFiles } from "../../src/tools/read-multiple-files.js";
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

describe("read_multiple_files", () => {
  it("birden fazla dosyayı okur", async () => {
    const f1 = await seedFile(ws, "a/one.txt", "bir");
    const f2 = await seedFile(ws, "a/two.txt", "iki");
    const res = parseResult(
      await readMultipleFiles.handler({ paths: [f1, f2] }),
    );
    const results = res.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[0].content).toBe("bir");
    expect(results[1].success).toBe(true);
    expect(results[1].content).toBe("iki");
  });

  it("bir dosya hatalı olursa diğerleri etkilenmez", async () => {
    const f1 = await seedFile(ws, "a/ok.txt", "tamam");
    const f2 = ws.resolve("a/yok.txt");
    const res = parseResult(
      await readMultipleFiles.handler({ paths: [f1, f2] }),
    );
    const results = res.results as Array<Record<string, unknown>>;
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect((results[1].error as Record<string, string>).code).toBe("FILE_NOT_FOUND");
  });

  it("dizin dosyası için IS_DIRECTORY hatası döner", async () => {
    const dp = await seedDir(ws, "a/dir");
    const res = parseResult(
      await readMultipleFiles.handler({ paths: [dp] }),
    );
    const results = res.results as Array<Record<string, unknown>>;
    expect(results[0].success).toBe(false);
    expect((results[0].error as Record<string, string>).code).toBe("IS_DIRECTORY");
  });

  it("base64 encoding ile okur", async () => {
    const f1 = await seedFile(ws, "a/data.bin", "hello");
    const res = parseResult(
      await readMultipleFiles.handler({
        paths: [f1],
        encoding: "base64",
      }),
    );
    const results = res.results as Array<Record<string, unknown>>;
    const decoded = Buffer.from(results[0].content as string, "base64").toString();
    expect(decoded).toBe("hello");
  });

  it("tool metadata doğru", () => {
    expect(readMultipleFiles.requiresPathValidation).toBe(true);
    expect(readMultipleFiles.pathFields).toEqual(["paths"]);
    expect(readMultipleFiles.pathOperation).toBe("read");
  });
});
