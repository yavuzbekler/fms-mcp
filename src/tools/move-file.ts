import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";
import {
  FileNotFoundError,
  DestinationExistsError,
} from "../lib/errors.js";

const inputSchema = z.object({
  source: z.string().describe("Source path (file or directory)"),
  destination: z.string().describe("Destination path"),
  overwrite: z
    .boolean()
    .default(false)
    .describe("Overwrite destination if it exists"),
});

export const moveFile: ToolDefinition = {
  name: "move_file",
  description: "Move or rename a file or directory",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["source", "destination"],
  pathOperation: "write",
  handler: async (args) => {
    const { source, destination, overwrite } =
      inputSchema.parse(args);

    let sourceStat;
    try {
      sourceStat = await fs.stat(source);
    } catch {
      throw new FileNotFoundError(`Source not found: ${source}`);
    }

    if (!overwrite) {
      try {
        await fs.access(destination);
        throw new DestinationExistsError(
          `Destination already exists: ${destination}. Set overwrite: true to replace.`,
        );
      } catch (err) {
        if (err instanceof DestinationExistsError) throw err;
      }
    }

    await fs.rename(source, destination);

    const result = {
      source,
      destination,
      type: sourceStat.isDirectory() ? "directory" : "file",
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
