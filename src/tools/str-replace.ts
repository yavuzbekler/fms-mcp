import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";
import {
  FileNotFoundError,
  OldStringNotFoundError,
  OccurrenceCountMismatchError,
} from "../lib/errors.js";

const inputSchema = z.object({
  path: z.string().describe("File path to edit"),
  old_str: z.string().min(1).describe("Exact string to find and replace"),
  new_str: z.string().describe("Replacement string (empty string = delete)"),
  expected_replacements: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe("Expected number of replacements"),
  dry_run: z
    .boolean()
    .default(false)
    .describe("If true, don't modify the file, just report match count"),
});

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let idx = 0;
  while (true) {
    idx = text.indexOf(search, idx);
    if (idx === -1) break;
    count++;
    idx += search.length;
  }
  return count;
}

export const strReplace: ToolDefinition = {
  name: "str_replace",
  description: "Replace exact string occurrences in a file",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "write",
  auditRedactFields: ["old_str", "new_str"],
  handler: async (args) => {
    const { path: filePath, old_str, new_str, expected_replacements, dry_run } =
      inputSchema.parse(args);

    let original: string;
    try {
      original = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new FileNotFoundError(`File not found: ${filePath}`);
    }

    const occurrences = countOccurrences(original, old_str);

    if (occurrences === 0) {
      throw new OldStringNotFoundError(
        `String not found in file: ${filePath}`,
      );
    }

    if (occurrences !== expected_replacements) {
      throw new OccurrenceCountMismatchError(
        `Expected ${expected_replacements} occurrence(s) but found ${occurrences} in ${filePath}`,
      );
    }

    if (!dry_run) {
      const replaced = original.split(old_str).join(new_str);
      const tmpPath = filePath + ".tmp";
      await fs.writeFile(tmpPath, replaced, "utf-8");
      await fs.rename(tmpPath, filePath);
    }

    const result = {
      path: filePath,
      replacements_made: dry_run ? 0 : occurrences,
      dry_run,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
