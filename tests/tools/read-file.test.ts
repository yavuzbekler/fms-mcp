import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "../../src/tools/read-file.js";
import {
  FileNotFoundError,
  FileTooLargeError,
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

describe("read_file", () => {
  it("dosya içeriğini okur", async () => {
    const fp = await seedFile(ws, "project/hello.txt", "Merhaba dünya");
    const res = parseResult(await readFile.handler({ path: fp }));
    expect(res.content).toBe("Merhaba dünya");
    expect(res.encoding).toBe("utf-8");
    expect(res.size_bytes).toBe(Buffer.byteLength("Merhaba dünya"));
    expect(res.truncated).toBe(false);
  });

  it("base64 encoding ile okur", async () => {
    const fp = await seedFile(ws, "project/data.bin", "binary-data");
    const res = parseResult(
      await readFile.handler({ path: fp, encoding: "base64" }),
    );
    expect(res.encoding).toBe("base64");
    const decoded = Buffer.from(res.content as string, "base64").toString();
    expect(decoded).toBe("binary-data");
  });

  it("offset ve length ile kısmi okuma yapar", async () => {
    const fp = await seedFile(ws, "project/long.txt", "0123456789");
    const res = parseResult(
      await readFile.handler({ path: fp, offset: 3, length: 4 }),
    );
    expect(res.content).toBe("3456");
    expect(res.truncated).toBe(true);
  });

  it("büyük dosyada FileTooLargeError fırlatır", async () => {
    const fp = await seedFile(ws, "project/big.txt", "x".repeat(100));
    await expect(
      readFile.handler({ path: fp, max_size_bytes: 50 }),
    ).rejects.toThrow(FileTooLargeError);
  });

  it("olmayan dosyada FileNotFoundError fırlatır", async () => {
    await expect(
      readFile.handler({ path: ws.resolve("project/nope.txt") }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("dizin için IsDirectoryError fırlatır", async () => {
    const dp = await seedDir(ws, "project/subdir");
    await expect(readFile.handler({ path: dp })).rejects.toThrow(
      IsDirectoryError,
    );
  });

  it("tool metadata doğru", () => {
    expect(readFile.requiresPathValidation).toBe(true);
    expect(readFile.pathFields).toEqual(["path"]);
    expect(readFile.pathOperation).toBe("read");
  });
});
