import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { resetConfig } from "../src/lib/config.js";
import {
  detectProject,
  detectProjectFromCwd,
} from "../src/lib/project-detection.js";

const TEST_WORKSPACE = "/tmp/fms-test-workspace-projdet";

beforeEach(async () => {
  resetConfig();
  process.env["WORKSPACE_ROOT"] = TEST_WORKSPACE;
  await fs.mkdir(TEST_WORKSPACE, { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, "opop"), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, "so4chat", "admin"), {
    recursive: true,
  });
  await fs.mkdir(path.join(TEST_WORKSPACE, "sporteq"), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, "kengel"), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, ".fms-mcp", "audit"), {
    recursive: true,
  });
});

afterEach(async () => {
  resetConfig();
  await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("detectProject", () => {
  it("dosya yolundan proje adını tespit eder", () => {
    expect(
      detectProject(path.join(TEST_WORKSPACE, "opop", "file.ts")),
    ).toBe("opop");
  });

  it("derin dizinden proje adını tespit eder", () => {
    expect(
      detectProject(path.join(TEST_WORKSPACE, "so4chat", "admin", "page.tsx")),
    ).toBe("so4chat");
  });

  it("proje kök dizinini tespit eder", () => {
    expect(detectProject(path.join(TEST_WORKSPACE, "sporteq"))).toBe(
      "sporteq",
    );
  });

  it("workspace root için _system döner", () => {
    expect(detectProject(TEST_WORKSPACE)).toBe("_system");
  });

  it("gizli klasör (.fms-mcp) için _system döner", () => {
    expect(
      detectProject(path.join(TEST_WORKSPACE, ".fms-mcp", "audit")),
    ).toBe("_system");
  });

  it("workspace dışı path için _system döner", () => {
    expect(detectProject("/etc/passwd")).toBe("_system");
  });

  it("trailing slash ile doğru çalışır", () => {
    expect(
      detectProject(path.join(TEST_WORKSPACE, "opop") + "/"),
    ).toBe("opop");
  });
});

describe("detectProjectFromCwd", () => {
  it("undefined cwd için _system döner", () => {
    expect(detectProjectFromCwd(undefined)).toBe("_system");
  });

  it("cwd'den proje tespit eder", () => {
    expect(
      detectProjectFromCwd(path.join(TEST_WORKSPACE, "kengel")),
    ).toBe("kengel");
  });

  it("relative cwd'yi workspace altında çözer", () => {
    expect(detectProjectFromCwd("opop")).toBe("opop");
  });

  it("boş string için _system döner", () => {
    expect(detectProjectFromCwd("")).toBe("_system");
  });

  it("derin cwd'den doğru projeyi tespit eder", () => {
    expect(
      detectProjectFromCwd(
        path.join(TEST_WORKSPACE, "so4chat", "admin"),
      ),
    ).toBe("so4chat");
  });
});
