import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";
import {
  FileNotFoundError,
  FileTooLargeError,
  IsDirectoryError,
} from "../lib/errors.js";

const inputSchema = z.object({
  path: z.string().describe("File path to read (absolute or relative to workspace)"),
  encoding: z
    .enum(["utf-8", "base64"])
    .default("utf-8")
    .describe("File encoding"),
  max_size_bytes: z
    .number()
    .int()
    .positive()
    .default(5_000_000)
    .describe("Maximum file size in bytes (default 5MB)"),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Byte offset to start reading from"),
  length: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Number of bytes to read"),
});

export const readFile: ToolDefinition = {
  name: "read_file",
  description: "Read text content of a single file from workspace",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "read",
  handler: async (args) => {
    const { path: filePath, encoding, max_size_bytes, offset, length } =
      inputSchema.parse(args);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new FileNotFoundError(`File not found: ${filePath}`);
    }

    if (stat.isDirectory()) {
      throw new IsDirectoryError(`Path is a directory, not a file: ${filePath}`);
    }

    if (stat.size > max_size_bytes) {
      throw new FileTooLargeError(
        `File size ${stat.size} bytes exceeds limit of ${max_size_bytes} bytes: ${filePath}`,
      );
    }

    const usePartial = offset !== undefined || length !== undefined;
    let content: string;

    if (usePartial) {
      const fd = await fs.open(filePath, "r");
      try {
        const readOffset = offset ?? 0;
        const readLength = length ?? stat.size - readOffset;
        const buffer = Buffer.alloc(readLength);
        const { bytesRead } = await fd.read(buffer, 0, readLength, readOffset);
        const slice = buffer.subarray(0, bytesRead);
        content =
          encoding === "base64"
            ? slice.toString("base64")
            : slice.toString("utf-8");
      } finally {
        await fd.close();
      }
    } else {
      const buffer = await fs.readFile(filePath);
      content =
        encoding === "base64"
          ? buffer.toString("base64")
          : buffer.toString("utf-8");
    }

    const result = {
      content,
      encoding,
      size_bytes: stat.size,
      truncated: usePartial,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
