import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { resetConfig } from "../src/lib/config.js";
import {
  resolvePath,
  resolvePathWithSymlink,
  assertWithinWorkspace,
  assertNotReserved,
  validatePath,
} from "../src/lib/path-lock.js";
import {
  InvalidPathError,
  PathOutsideWorkspaceError,
  ReservedPathError,
} from "../src/lib/errors.js";

const TEST_WORKSPACE = "/tmp/fms-test-workspace-pathlock";

beforeEach(async () => {
  resetConfig();
  process.env["WORKSPACE_ROOT"] = TEST_WORKSPACE;
  await fs.mkdir(TEST_WORKSPACE, { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, "opop"), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, ".fms-mcp", "audit", "opop"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(TEST_WORKSPACE, "opop", "file.ts"),
    "test content",
  );
  await fs.writeFile(
    path.join(TEST_WORKSPACE, ".fms-mcp", "audit", "opop", "2026-05-06.log"),
    "log content",
  );
});

afterEach(async () => {
  resetConfig();
  await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("resolvePath", () => {
  it("mutlak yol verilince aynısını döner", () => {
    expect(resolvePath("/tmp/fms-test-workspace/opop/file.ts")).toBe(
      "/tmp/fms-test-workspace/opop/file.ts",
    );
  });

  it("relative yol WORKSPACE_ROOT'a göre çözülür", () => {
    expect(resolvePath("opop/file.ts")).toBe(
      path.join(TEST_WORKSPACE, "opop", "file.ts"),
    );
  });

  it(".. içeren yollar normalize edilir", () => {
    expect(resolvePath("/tmp/fms-test-workspace/opop/../opop/file.ts")).toBe(
      "/tmp/fms-test-workspace/opop/file.ts",
    );
  });

  it("trailing slash temizlenir", () => {
    const result = resolvePath("/tmp/fms-test-workspace/opop/");
    expect(result.endsWith("/")).toBe(false);
    expect(result).toBe("/tmp/fms-test-workspace/opop");
  });

  it("sadece dosya adı verilirse workspace altına çözer", () => {
    expect(resolvePath("package.json")).toBe(
      path.join(TEST_WORKSPACE, "package.json"),
    );
  });
});

describe("resolvePathWithSymlink", () => {
  it("var olan dosyayı realpath ile çözer", async () => {
    const result = await resolvePathWithSymlink(
      path.join(TEST_WORKSPACE, "opop", "file.ts"),
    );
    expect(result).toBe(path.join(TEST_WORKSPACE, "opop", "file.ts"));
  });

  it("var olmayan dosyayı normalize ederek döner", async () => {
    const result = await resolvePathWithSymlink(
      path.join(TEST_WORKSPACE, "nonexistent", "file.ts"),
    );
    expect(result).toBe(path.join(TEST_WORKSPACE, "nonexistent", "file.ts"));
  });

  it("workspace dışına gösteren symlink'i gerçek yola çözer", async () => {
    const symlinkPath = path.join(TEST_WORKSPACE, "opop", "evil-link");
    await fs.symlink("/tmp", symlinkPath);
    const result = await resolvePathWithSymlink(symlinkPath);
    expect(result).toBe("/tmp");
  });
});

describe("assertWithinWorkspace", () => {
  it("workspace altındaki dosyayı kabul eder", () => {
    expect(() =>
      assertWithinWorkspace(path.join(TEST_WORKSPACE, "opop", "file.ts")),
    ).not.toThrow();
  });

  it("workspace altındaki dizini kabul eder", () => {
    expect(() =>
      assertWithinWorkspace(path.join(TEST_WORKSPACE, "opop")),
    ).not.toThrow();
  });

  it("workspace root'un kendisini kabul eder", () => {
    expect(() => assertWithinWorkspace(TEST_WORKSPACE)).not.toThrow();
  });

  it("/etc/passwd reddeder", () => {
    expect(() => assertWithinWorkspace("/etc/passwd")).toThrow(
      PathOutsideWorkspaceError,
    );
  });

  it("prefix saldırısını reddeder (/workspace-evil/file)", () => {
    expect(() =>
      assertWithinWorkspace("/tmp/fms-test-workspace-evil/file"),
    ).toThrow(PathOutsideWorkspaceError);
  });

  it("workspace dışı yolu reddeder", () => {
    expect(() => assertWithinWorkspace("/home/yavuz/secret")).toThrow(
      PathOutsideWorkspaceError,
    );
  });

  it("relative path verilirse InvalidPathError fırlatır", () => {
    expect(() => assertWithinWorkspace("opop/file.ts")).toThrow(
      InvalidPathError,
    );
  });

  it("üst dizine çıkma denemesini reddeder", () => {
    expect(() =>
      assertWithinWorkspace(
        path.resolve(TEST_WORKSPACE, "..", "etc", "passwd"),
      ),
    ).toThrow(PathOutsideWorkspaceError);
  });
});

describe("assertNotReserved", () => {
  it("reserved path'e read izin verir", () => {
    expect(() =>
      assertNotReserved(
        path.join(
          TEST_WORKSPACE,
          ".fms-mcp",
          "audit",
          "opop",
          "2026-05-06.log",
        ),
        "read",
      ),
    ).not.toThrow();
  });

  it("reserved path'e write reddeder", () => {
    expect(() =>
      assertNotReserved(
        path.join(
          TEST_WORKSPACE,
          ".fms-mcp",
          "audit",
          "opop",
          "2026-05-06.log",
        ),
        "write",
      ),
    ).toThrow(ReservedPathError);
  });

  it("normal path'e write izin verir", () => {
    expect(() =>
      assertNotReserved(
        path.join(TEST_WORKSPACE, "opop", "file.ts"),
        "write",
      ),
    ).not.toThrow();
  });

  it("reserved dizinin kendisine write reddeder", () => {
    expect(() =>
      assertNotReserved(path.join(TEST_WORKSPACE, ".fms-mcp"), "write"),
    ).toThrow(ReservedPathError);
  });

  it("normal path'e read izin verir", () => {
    expect(() =>
      assertNotReserved(
        path.join(TEST_WORKSPACE, "opop", "file.ts"),
        "read",
      ),
    ).not.toThrow();
  });
});

describe("validatePath", () => {
  it("geçerli workspace path'ini doğrular ve döner", async () => {
    const result = await validatePath(
      path.join(TEST_WORKSPACE, "opop", "file.ts"),
      "read",
    );
    expect(result).toBe(path.join(TEST_WORKSPACE, "opop", "file.ts"));
  });

  it("relative path'i çözüp doğrular", async () => {
    const result = await validatePath("opop/file.ts", "read");
    expect(result).toBe(path.join(TEST_WORKSPACE, "opop", "file.ts"));
  });

  it("path traversal denemesini reddeder", async () => {
    await expect(
      validatePath(path.join(TEST_WORKSPACE, "..", "etc", "passwd"), "read"),
    ).rejects.toThrow(PathOutsideWorkspaceError);
  });

  it("reserved path'e write reddeder", async () => {
    await expect(
      validatePath(
        path.join(
          TEST_WORKSPACE,
          ".fms-mcp",
          "audit",
          "opop",
          "2026-05-06.log",
        ),
        "write",
      ),
    ).rejects.toThrow(ReservedPathError);
  });

  it("reserved path'e read izin verir", async () => {
    const result = await validatePath(
      path.join(
        TEST_WORKSPACE,
        ".fms-mcp",
        "audit",
        "opop",
        "2026-05-06.log",
      ),
      "read",
    );
    expect(result).toBe(
      path.join(
        TEST_WORKSPACE,
        ".fms-mcp",
        "audit",
        "opop",
        "2026-05-06.log",
      ),
    );
  });

  it("workspace dışına gösteren symlink'i reddeder", async () => {
    const symlinkPath = path.join(TEST_WORKSPACE, "opop", "escape-link");
    await fs.symlink("/etc/passwd", symlinkPath);
    await expect(validatePath(symlinkPath, "read")).rejects.toThrow(
      PathOutsideWorkspaceError,
    );
  });

  it("workspace dışına gösteren symlink altındaki yeni dosyayı reddeder", async () => {
    const outsideDir = "/tmp/fms-pathlock-outside";
    await fs.rm(outsideDir, { recursive: true, force: true });
    await fs.mkdir(outsideDir, { recursive: true });

    const symlinkPath = path.join(TEST_WORKSPACE, "opop", "escape-dir");
    await fs.symlink(outsideDir, symlinkPath);

    await expect(
      validatePath(path.join(symlinkPath, "new-file.txt"), "write"),
    ).rejects.toThrow(PathOutsideWorkspaceError);

    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("workspace içine gösteren symlink'i kabul eder", async () => {
    const targetPath = path.join(TEST_WORKSPACE, "opop", "file.ts");
    const symlinkPath = path.join(TEST_WORKSPACE, "opop", "internal-link");
    await fs.symlink(targetPath, symlinkPath);
    const result = await validatePath(symlinkPath, "read");
    expect(result).toBe(targetPath);
  });

  it(".. ile traversal denemesini normalize edip reddeder", async () => {
    await expect(
      validatePath(
        "/tmp/fms-test-workspace/../../../etc/passwd",
        "read",
      ),
    ).rejects.toThrow(PathOutsideWorkspaceError);
  });

  it("workspace root'un kendisini kabul eder", async () => {
    const result = await validatePath(TEST_WORKSPACE, "read");
    expect(result).toBe(TEST_WORKSPACE);
  });

  it("normal dosyaya write izin verir", async () => {
    const result = await validatePath(
      path.join(TEST_WORKSPACE, "opop", "file.ts"),
      "write",
    );
    expect(result).toBe(path.join(TEST_WORKSPACE, "opop", "file.ts"));
  });

  it("workspace içindeki symlink altındaki yeni dosyayı gerçek yola çözer", async () => {
    const targetDir = path.join(TEST_WORKSPACE, "opop", "target-dir");
    await fs.mkdir(targetDir);

    const symlinkPath = path.join(TEST_WORKSPACE, "opop", "internal-dir-link");
    await fs.symlink(targetDir, symlinkPath);

    const result = await validatePath(
      path.join(symlinkPath, "new-file.txt"),
      "write",
    );

    expect(result).toBe(path.join(targetDir, "new-file.txt"));
  });
});
