import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { createDirectory } from "../../src/tools/create-directory.js";
import {
  createTestWorkspace,
  destroyTestWorkspace,
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

describe("create_directory", () => {
  it("yeni dizin oluşturur", async () => {
    const dp = ws.resolve("project/newdir");
    const res = parseResult(await createDirectory.handler({ path: dp }));
    expect(res.created).toBe(true);
    const stat = await fs.stat(dp);
    expect(stat.isDirectory()).toBe(true);
  });

  it("recursive ile derin dizin oluşturur", async () => {
    const dp = ws.resolve("project/a/b/c/d");
    const res = parseResult(
      await createDirectory.handler({ path: dp, recursive: true }),
    );
    expect(res.created).toBe(true);
    const stat = await fs.stat(dp);
    expect(stat.isDirectory()).toBe(true);
  });

  it("zaten varsa created=false döner", async () => {
    const dp = ws.resolve("project/existing");
    await fs.mkdir(dp, { recursive: true });
    const res = parseResult(await createDirectory.handler({ path: dp }));
    expect(res.created).toBe(false);
  });

  it("tool metadata doğru", () => {
    expect(createDirectory.requiresPathValidation).toBe(true);
    expect(createDirectory.pathOperation).toBe("write");
  });
});
