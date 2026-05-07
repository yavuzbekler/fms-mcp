import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { archiveMonth, cleanRetention } from "../../../src/lib/audit/archive.js";

let testDir: string;
let auditDir: string;
let archiveDir: string;

beforeEach(async () => {
  testDir = `/tmp/fms-archive-test-${crypto.randomBytes(6).toString("hex")}`;
  auditDir = path.join(testDir, "audit");
  archiveDir = path.join(testDir, "archive");
  await fs.mkdir(auditDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

async function seedLogFile(project: string, fileName: string, content = "test log\n"): Promise<void> {
  const dir = path.join(auditDir, project);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), content);
}

async function seedArchive(project: string, fileName: string): Promise<void> {
  const dir = path.join(archiveDir, project);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), "fake archive");
}

describe("archiveMonth", () => {
  it("should archive previous month's log files", async () => {
    await seedLogFile("opop", "2026-04-01.log");
    await seedLogFile("opop", "2026-04-15.log");
    await seedLogFile("opop", "2026-04-30.log");
    await seedLogFile("opop", "2026-05-01.log"); // should not be archived

    const result = await archiveMonth(auditDir, archiveDir, 2026, 4);
    expect(result.archived).toBe(3);
    expect(result.projects).toContain("opop");

    const archiveExists = await fs.access(path.join(archiveDir, "opop", "2026-04.tar.gz"))
      .then(() => true).catch(() => false);
    expect(archiveExists).toBe(true);

    // Originals should be deleted
    const remaining = await fs.readdir(path.join(auditDir, "opop"));
    expect(remaining).toEqual(["2026-05-01.log"]);
  });

  it("should handle hourly log files in archive", async () => {
    await seedLogFile("proj", "2026-04-15.log");
    await seedLogFile("proj", "2026-04-15-14.log");
    await seedLogFile("proj", "2026-04-15-15.log");

    const result = await archiveMonth(auditDir, archiveDir, 2026, 4);
    expect(result.archived).toBe(3);
  });

  it("should archive multiple projects independently", async () => {
    await seedLogFile("opop", "2026-04-01.log");
    await seedLogFile("so4chat", "2026-04-01.log");

    const result = await archiveMonth(auditDir, archiveDir, 2026, 4);
    expect(result.archived).toBe(2);
    expect(result.projects.sort()).toEqual(["opop", "so4chat"]);
  });

  it("should skip projects with no matching files", async () => {
    await seedLogFile("opop", "2026-05-01.log");

    const result = await archiveMonth(auditDir, archiveDir, 2026, 4);
    expect(result.archived).toBe(0);
    expect(result.projects).toEqual([]);
  });

  it("should return zero when audit dir does not exist", async () => {
    const result = await archiveMonth("/nonexistent/dir", archiveDir, 2026, 4);
    expect(result.archived).toBe(0);
  });

  it("should create archive project directory if needed", async () => {
    await seedLogFile("newproj", "2026-04-01.log");

    await archiveMonth(auditDir, archiveDir, 2026, 4);

    const exists = await fs.access(path.join(archiveDir, "newproj"))
      .then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("should handle _system project", async () => {
    await seedLogFile("_system", "2026-04-01.log");

    const result = await archiveMonth(auditDir, archiveDir, 2026, 4);
    expect(result.archived).toBe(1);
    expect(result.projects).toContain("_system");
  });

  it("should handle month boundaries (January archiving December)", async () => {
    await seedLogFile("proj", "2025-12-15.log");
    await seedLogFile("proj", "2025-12-31.log");

    const result = await archiveMonth(auditDir, archiveDir, 2025, 12);
    expect(result.archived).toBe(2);

    const archiveExists = await fs.access(path.join(archiveDir, "proj", "2025-12.tar.gz"))
      .then(() => true).catch(() => false);
    expect(archiveExists).toBe(true);
  });
});

describe("cleanRetention", () => {
  it("should delete archives older than retention period", async () => {
    // 2026-05, 6 month retention → cutoff total = (2026*12+5)-6 = 24311
    // 2025-10 → 24310 < 24311 → DELETE
    // 2025-11 → 24311 = 24311 → NOT deleted (boundary)
    // 2026-01 → 24313 → keep
    const now = new Date("2026-05-01T00:00:00Z");
    const realDateNow = Date.now;
    Date.now = () => now.getTime();
    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(now.getTime());
        } else {
          // @ts-expect-error dynamic args
          super(...args);
        }
      }
    } as DateConstructor;

    await seedArchive("opop", "2025-09.tar.gz"); // old — delete
    await seedArchive("opop", "2025-10.tar.gz"); // old — delete
    await seedArchive("opop", "2025-11.tar.gz"); // boundary — keep
    await seedArchive("opop", "2026-01.tar.gz"); // keep
    await seedArchive("opop", "2026-04.tar.gz"); // keep

    const result = await cleanRetention(archiveDir, 6);

    globalThis.Date = RealDate;
    Date.now = realDateNow;

    expect(result.deleted).toBe(2);

    const remaining = await fs.readdir(path.join(archiveDir, "opop"));
    expect(remaining.sort()).toEqual(["2025-11.tar.gz", "2026-01.tar.gz", "2026-04.tar.gz"]);
  });

  it("should return zero when archive dir does not exist", async () => {
    const result = await cleanRetention("/nonexistent/archive", 6);
    expect(result.deleted).toBe(0);
  });

  it("should skip non-matching filenames", async () => {
    await seedArchive("opop", "readme.txt");
    await seedArchive("opop", "2026-04.tar.gz");

    const result = await cleanRetention(archiveDir, 1);
    // Only .tar.gz matching YYYY-MM pattern should be considered
    expect(result.deleted).toBeLessThanOrEqual(1);
  });

  it("should handle multiple projects", async () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now.getTime());
        // @ts-expect-error dynamic args
        else super(...args);
      }
    } as DateConstructor;

    await seedArchive("opop", "2025-01.tar.gz");
    await seedArchive("so4chat", "2025-02.tar.gz");

    const result = await cleanRetention(archiveDir, 6);

    globalThis.Date = RealDate;

    expect(result.deleted).toBe(2);
  });
});
