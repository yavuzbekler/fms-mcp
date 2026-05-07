import { z } from "zod";
import fs from "node:fs/promises";
import fg from "fast-glob";
import type { ToolDefinition } from "../types/index.js";
import { FileNotFoundError, NotDirectoryError } from "../lib/errors.js";

const inputSchema = z.object({
  path: z.string().describe("Starting directory for search"),
  pattern: z.string().describe("Glob pattern (e.g. **/*.ts, package.json)"),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum results to return"),
  include_hidden: z
    .boolean()
    .default(false)
    .describe("Include hidden files"),
});

export const searchFiles: ToolDefinition = {
  name: "search_files",
  description: "Find files by name pattern using glob",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "read",
  handler: async (args) => {
    const { path: dirPath, pattern, max_results, include_hidden } =
      inputSchema.parse(args);

    let stat;
    try {
      stat = await fs.stat(dirPath);
    } catch {
      throw new FileNotFoundError(`Path not found: ${dirPath}`);
    }

    if (!stat.isDirectory()) {
      throw new NotDirectoryError(`Path is not a directory: ${dirPath}`);
    }

    const matches = await fg(pattern, {
      cwd: dirPath,
      absolute: true,
      dot: include_hidden,
      onlyFiles: false,
      followSymbolicLinks: false,
    });

    const truncated = matches.length > max_results;
    const limited = matches.slice(0, max_results);

    const result = {
      matches: limited,
      total_count: matches.length,
      truncated,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
