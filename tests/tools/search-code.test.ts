import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchCode } from "../../src/tools/search-code.js";
import { FileNotFoundError } from "../../src/lib/errors.js";
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

describe("search_code", () => {
  it("dosya içeriğinde literal arama yapar", async () => {
    await seedFile(ws, "project/src/main.ts", 'const greeting = "hello world";\n');
    const res = parseResult(
      await searchCode.handler({
        path: ws.resolve("project"),
        query: "hello world",
      }),
    );
    const matches = res.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].file).toContain("main.ts");
    expect(matches[0].line).toBe(1);
  });

  it("case insensitive arama (varsayılan)", async () => {
    await seedFile(ws, "project/src/app.ts", "Hello World\n");
    const res = parseResult(
      await searchCode.handler({
        path: ws.resolve("project"),
        query: "hello world",
      }),
    );
    const matches = res.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("case sensitive arama", async () => {
    await seedFile(ws, "project/src/app.ts", "Hello World\nhello world\n");
    const res = parseResult(
      await searchCode.handler({
        path: ws.resolve("project"),
        query: "Hello World",
        case_sensitive: true,
      }),
    );
    const matches = res.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(1);
  });

  it("file_pattern ile filtreler", async () => {
    await seedFile(ws, "project/a.ts", "target\n");
    await seedFile(ws, "project/b.css", "target\n");
    const res = parseResult(
      await searchCode.handler({
        path: ws.resolve("project"),
        query: "target",
        file_pattern: "*.ts",
      }),
    );
    const matches = res.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(1);
    expect((matches[0].file as string)).toContain("a.ts");
  });

  it("regex arama", async () => {
    await seedFile(ws, "project/code.ts", "const num = 42;\nconst str = 'hi';\n");
    const res = parseResult(
      await searchCode.handler({
        path: ws.resolve("project"),
        query: "\\d+",
        is_regex: true,
      }),
    );
    const matches = res.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("sonuç yoksa boş döner", async () => {
    await seedFile(ws, "project/empty.ts", "nothing here\n");
    const res = parseResult(
      await searchCode.handler({
        path: ws.resolve("project"),
        query: "nonexistent_string_xyz",
      }),
    );
    const matches = res.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(0);
  });

  it("olmayan dizinde FileNotFoundError fırlatır", async () => {
    await expect(
      searchCode.handler({
        path: ws.resolve("nope"),
        query: "test",
      }),
    ).rejects.toThrow(FileNotFoundError);
  });

  it("tool metadata doğru", () => {
    expect(searchCode.requiresPathValidation).toBe(true);
    expect(searchCode.pathOperation).toBe("read");
  });
});
