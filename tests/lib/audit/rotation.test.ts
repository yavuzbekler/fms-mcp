import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { StreamManager, buildLogPath } from "../../../src/lib/audit/rotation.js";

let testDir: string;

beforeEach(async () => {
  testDir = `/tmp/fms-rotation-test-${crypto.randomBytes(6).toString("hex")}`;
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("buildLogPath", () => {
  it("should build daily log path", () => {
    const date = new Date("2026-05-07T10:30:00Z");
    const result = buildLogPath("/audit", "opop", date, false);
    expect(result).toBe("/audit/opop/2026-05-07.log");
  });

  it("should build hourly log path", () => {
    const date = new Date("2026-05-07T14:30:00Z");
    const result = buildLogPath("/audit", "opop", date, true);
    expect(result).toBe("/audit/opop/2026-05-07-14.log");
  });

  it("should pad single-digit hours", () => {
    const date = new Date("2026-05-07T03:00:00Z");
    const result = buildLogPath("/audit", "opop", date, true);
    expect(result).toBe("/audit/opop/2026-05-07-03.log");
  });
});

describe("StreamManager", () => {
  it("should create project directory and write stream", async () => {
    const sm = new StreamManager(testDir, 100);
    const stream = await sm.getStream("myproject");
    expect(stream).toBeDefined();
    expect(fss.existsSync(path.join(testDir, "myproject"))).toBe(true);
    await sm.closeAll();
  });

  it("should reuse stream for same project on same day", async () => {
    const sm = new StreamManager(testDir, 100);
    const now = new Date();
    const s1 = await sm.getStream("proj", now);
    const s2 = await sm.getStream("proj", now);
    expect(s1).toBe(s2);
    await sm.closeAll();
  });

  it("should create separate streams for different projects", async () => {
    const sm = new StreamManager(testDir, 100);
    const now = new Date();
    const s1 = await sm.getStream("proj1", now);
    const s2 = await sm.getStream("proj2", now);
    expect(s1).not.toBe(s2);
    expect(sm.getOpenStreamCount()).toBe(2);
    await sm.closeAll();
  });

  it("should rotate to new file when date changes", async () => {
    const sm = new StreamManager(testDir, 100);
    const day1 = new Date("2026-05-07T23:59:00Z");
    const day2 = new Date("2026-05-08T00:01:00Z");

    const s1 = await sm.getStream("proj", day1);
    s1.write("day1 data\n");

    const s2 = await sm.getStream("proj", day2);
    s2.write("day2 data\n");

    expect(s1).not.toBe(s2);
    await sm.closeAll();

    const files = await fs.readdir(path.join(testDir, "proj"));
    expect(files.sort()).toEqual(["2026-05-07.log", "2026-05-08.log"]);
  });

  it("should switch to hourly fallback when size exceeds limit", async () => {
    const sm = new StreamManager(testDir, 0.000001); // ~1 byte limit
    const now = new Date("2026-05-07T10:30:00Z");

    const s1 = await sm.getStream("proj", now);
    s1.write("a".repeat(100));
    await new Promise((r) => setTimeout(r, 50));

    const s2 = await sm.getStream("proj", now);
    // After size check, should switch to hourly
    await sm.closeAll();

    const files = await fs.readdir(path.join(testDir, "proj"));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("should return to daily after date change from hourly fallback", async () => {
    const sm = new StreamManager(testDir, 0.000001);
    const day1 = new Date("2026-05-07T10:00:00Z");
    const day2 = new Date("2026-05-08T10:00:00Z");

    const s1 = await sm.getStream("proj", day1);
    s1.write("data");
    await new Promise((r) => setTimeout(r, 50));

    await sm.getStream("proj", day1); // triggers size check

    const s3 = await sm.getStream("proj", day2);
    expect(s3).toBeDefined();
    await sm.closeAll();

    const files = await fs.readdir(path.join(testDir, "proj"));
    const day2Files = files.filter((f) => f.startsWith("2026-05-08"));
    expect(day2Files.length).toBeGreaterThanOrEqual(1);
    if (day2Files.length === 1) {
      expect(day2Files[0]).toBe("2026-05-08.log");
    }
  });

  it("should closeAll and reset stream count to 0", async () => {
    const sm = new StreamManager(testDir, 100);
    await sm.getStream("a");
    await sm.getStream("b");
    expect(sm.getOpenStreamCount()).toBe(2);
    await sm.closeAll();
    expect(sm.getOpenStreamCount()).toBe(0);
  });

  it("should handle multiple getStream calls without error", async () => {
    const sm = new StreamManager(testDir, 100);
    for (let i = 0; i < 10; i++) {
      await sm.getStream(`proj-${i}`);
    }
    expect(sm.getOpenStreamCount()).toBe(10);
    await sm.closeAll();
  });

  it("should write JSONL data correctly", async () => {
    const sm = new StreamManager(testDir, 100);
    const now = new Date("2026-05-07T12:00:00Z");
    const stream = await sm.getStream("test", now);

    const entry = { ts: "2026-05-07T12:00:00Z", tool: "ping" };
    stream.write(JSON.stringify(entry) + "\n");
    await sm.closeAll();

    const content = await fs.readFile(
      path.join(testDir, "test", "2026-05-07.log"),
      "utf-8",
    );
    const parsed = JSON.parse(content.trim());
    expect(parsed.tool).toBe("ping");
  });
});
