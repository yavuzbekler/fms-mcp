import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { writeFile } from "../../src/tools/write-file.js";
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

describe("write_file", () => {
  it("yeni dosya oluşturur", async () => {
    const fp = ws.resolve("project/new.txt");
    const res = parseResult(
      await writeFile.handler({ path: fp, content: "yeni içerik" }),
    );
    expect(res.created).toBe(true);
    expect(res.mode).toBe("rewrite");
    const read = await fs.readFile(fp, "utf-8");
    expect(read).toBe("yeni içerik");
  });

  it("var olan dosyanın üzerine yazar", async () => {
    const fp = await seedFile(ws, "project/exist.txt", "eski");
    const res = parseResult(
      await writeFile.handler({ path: fp, content: "yeni" }),
    );
    expect(res.created).toBe(false);
    const read = await fs.readFile(fp, "utf-8");
    expect(read).toBe("yeni");
  });

  it("append modunda dosyaya ekler", async () => {
    const fp = await seedFile(ws, "project/log.txt", "satır1\n");
    await writeFile.handler({
      path: fp,
      content: "satır2\n",
      mode: "append",
    });
    const read = await fs.readFile(fp, "utf-8");
    expect(read).toBe("satır1\nsatır2\n");
  });

  it("create_dirs ile parent dizinleri oluşturur", async () => {
    const fp = ws.resolve("deep/nested/dir/file.txt");
    await writeFile.handler({
      path: fp,
      content: "derin",
      create_dirs: true,
    });
    const read = await fs.readFile(fp, "utf-8");
    expect(read).toBe("derin");
  });

  it("base64 encoding ile yazar", async () => {
    const fp = ws.resolve("project/b64.txt");
    const b64 = Buffer.from("binary data").toString("base64");
    await writeFile.handler({
      path: fp,
      content: b64,
      encoding: "base64",
    });
    const read = await fs.readFile(fp);
    expect(read.toString()).toBe("binary data");
  });

  it("bytes_written doğru döner", async () => {
    const fp = ws.resolve("project/size.txt");
    const res = parseResult(
      await writeFile.handler({ path: fp, content: "abc" }),
    );
    expect(res.bytes_written).toBe(3);
  });

  it("atomic write — .tmp dosyası kalmaz", async () => {
    const fp = ws.resolve("project/atomic.txt");
    await writeFile.handler({ path: fp, content: "atomik" });
    const files = await fs.readdir(ws.resolve("project"));
    expect(files).not.toContain("atomic.txt.tmp");
  });

  it("tool metadata doğru", () => {
    expect(writeFile.requiresPathValidation).toBe(true);
    expect(writeFile.pathFields).toEqual(["path"]);
    expect(writeFile.pathOperation).toBe("write");
  });
});
