import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";

const inputSchema = z.object({
  path: z.string().describe("Directory path to create"),
  recursive: z
    .boolean()
    .default(true)
    .describe("Create parent directories if needed"),
});

export const createDirectory: ToolDefinition = {
  name: "create_directory",
  description: "Create a directory (and parents if needed)",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "write",
  handler: async (args) => {
    const { path: dirPath, recursive } =
      inputSchema.parse(args);

    let existed = true;
    try {
      const stat = await fs.stat(dirPath);
      if (stat.isDirectory()) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ path: dirPath, created: false }),
            },
          ],
        };
      }
    } catch {
      existed = false;
    }

    await fs.mkdir(dirPath, { recursive });

    const result = {
      path: dirPath,
      created: !existed,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
