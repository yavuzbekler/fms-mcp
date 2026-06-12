import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openaiSearch, openaiFetch } from "../../src/tools/openai-compat.js";
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

describe("openai compatibility tools", () => {
  it("search structuredContent döner ve sonuçları limitler", async () => {
    for (let i = 0; i < 30; i++) {
      await seedFile(ws, `project/file-${i}.txt`, `mcp connector content ${i}\n`);
    }

    const result = await openaiSearch.handler({ query: "mcp" });
    const parsed = parseResult(result);
    const structured = result.structuredContent as { results: Array<Record<string, unknown>> };

    expect(parsed.results).toHaveLength(20);
    expect(structured.results).toHaveLength(20);
    expect(structured.results[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      url: expect.any(String),
    });
  });

  it("fetch structuredContent ve JSON content ile belge döner", async () => {
    await seedFile(ws, "project/readme.md", "# FMS\n\nConnector notes\n");

    const result = await openaiFetch.handler({ id: "project/readme.md" });
    const parsed = parseResult(result);

    expect(parsed).toMatchObject({
      id: "project/readme.md",
      title: "readme.md",
      text: "# FMS\n\nConnector notes\n",
    });
    expect(result.structuredContent).toMatchObject(parsed);
  });
});
