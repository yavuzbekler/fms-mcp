import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getFileInfo } from "../../src/tools/get-file-info.js";
import { FileNotFoundError } from "../../src/lib/errors.js";
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

describe("get_file_info", () => {
  it("dosya bilgilerini döner", async () => {
    const fp = await seedFile(ws, "project/info.txt", "test content");
    const res = parseResult(await getFileInfo.handler({ path: fp }));
    expect(res.type).toBe("file");
    expect(res.size_bytes).toBe(Buffer.byteLength("test content"));
    expect(res.path).toBe(fp);
    expect(res.is_readable).toBe(true);
    expect(res.is_writable).toBe(true);
    expect(res.created_at).toBeDefined();
    expect(res.modified_at).toBeDefined();
    expect(res.accessed_at).toBeDefined();
    expect(res.permissions).toBeDefined();
    expect(typeof res.owner_uid).toBe("number");
  });

  it("dizin bilgilerini döner", async () => {
    const dp = await seedDir(ws, "project/mydir");
    const res = parseResult(await getFileInfo.handler({ path: dp }));
    expect(res.type).toBe("directory");
  });

  it("olmayan path'de FileNotFoundError fırlatır", async () => {
    await expect(
      getFileInfo.handler({ path: ws.resolve("project/nope") }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("permissions formatı doğru (9 karakter)", async () => {
    const fp = await seedFile(ws, "project/perm.txt", "x");
    const res = parseResult(await getFileInfo.handler({ path: fp }));
    const perms = res.permissions as string;
    expect(perms).toHaveLength(9);
    expect(perms).toMatch(/^[rwx-]{9}$/);
  });

  it("tool metadata doğru", () => {
    expect(getFileInfo.requiresPathValidation).toBe(true);
    expect(getFileInfo.pathOperation).toBe("read");
  });
});
