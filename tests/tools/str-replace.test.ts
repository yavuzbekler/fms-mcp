import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { strReplace } from "../../src/tools/str-replace.js";
import {
  FileNotFoundError,
  OldStringNotFoundError,
  OccurrenceCountMismatchError,
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

describe("str_replace", () => {
  it("tek occurrence'ı değiştirir", async () => {
    const fp = await seedFile(ws, "project/code.ts", 'const x = "hello";');
    const res = parseResult(
      await strReplace.handler({
        path: fp,
        old_str: '"hello"',
        new_str: '"world"',
      }),
    );
    expect(res.replacements_made).toBe(1);
    const content = await fs.readFile(fp, "utf-8");
    expect(content).toBe('const x = "world";');
  });

  it("birden fazla occurrence'ı değiştirir", async () => {
    const fp = await seedFile(ws, "project/multi.txt", "aa bb aa cc aa");
    const res = parseResult(
      await strReplace.handler({
        path: fp,
        old_str: "aa",
        new_str: "XX",
        expected_replacements: 3,
      }),
    );
    expect(res.replacements_made).toBe(3);
    const content = await fs.readFile(fp, "utf-8");
    expect(content).toBe("XX bb XX cc XX");
  });

  it("dry_run modunda dosyayı değiştirmez", async () => {
    const fp = await seedFile(ws, "project/dry.txt", "keep this");
    const res = parseResult(
      await strReplace.handler({
        path: fp,
        old_str: "keep",
        new_str: "lose",
        dry_run: true,
      }),
    );
    expect(res.dry_run).toBe(true);
    expect(res.replacements_made).toBe(0);
    const content = await fs.readFile(fp, "utf-8");
    expect(content).toBe("keep this");
  });

  it("string bulunamazsa OldStringNotFoundError fırlatır", async () => {
    const fp = await seedFile(ws, "project/nope.txt", "nothing here");
    await expect(
      strReplace.handler({
        path: fp,
        old_str: "missing",
        new_str: "found",
      }),
    ).rejects.toThrow(OldStringNotFoundError);
  });

  it("occurrence sayısı uyuşmazsa OccurrenceCountMismatchError fırlatır", async () => {
    const fp = await seedFile(ws, "project/mismatch.txt", "aa bb aa");
    await expect(
      strReplace.handler({
        path: fp,
        old_str: "aa",
        new_str: "XX",
        expected_replacements: 1,
      }),
    ).rejects.toThrow(OccurrenceCountMismatchError);
  });

  it("olmayan dosyada FileNotFoundError fırlatır", async () => {
    await expect(
      strReplace.handler({
        path: ws.resolve("project/ghost.txt"),
        old_str: "x",
        new_str: "y",
      }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("boş new_str ile silme yapar", async () => {
    const fp = await seedFile(ws, "project/del.txt", "remove-this-part");
    await strReplace.handler({
      path: fp,
      old_str: "-this",
      new_str: "",
    });
    const content = await fs.readFile(fp, "utf-8");
    expect(content).toBe("remove-part");
  });

  it("tool metadata doğru", () => {
    expect(strReplace.requiresPathValidation).toBe(true);
    expect(strReplace.pathOperation).toBe("write");
  });
});
