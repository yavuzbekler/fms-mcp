import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";

const inputSchema = z.object({
  paths: z
    .array(z.string())
    .min(1)
    .max(50)
    .describe("Array of file paths to read (1-50)"),
  encoding: z
    .enum(["utf-8", "base64"])
    .default("utf-8")
    .describe("File encoding"),
  max_size_bytes: z
    .number()
    .int()
    .positive()
    .default(5_000_000)
    .describe("Maximum file size per file in bytes"),
});

interface FileResult {
  path: string;
  success: boolean;
  content?: string;
  error?: { code: string; message: string };
  size_bytes?: number;
}

export const readMultipleFiles: ToolDefinition = {
  name: "read_multiple_files",
  description: "Read multiple files in one call. Returns array, never fails wholesale",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["paths"],
  pathOperation: "read",
  handler: async (args) => {
    const { paths, encoding, max_size_bytes } =
      inputSchema.parse(args);

    const results: FileResult[] = await Promise.all(
      paths.map(async (filePath): Promise<FileResult> => {
        try {
          const stat = await fs.stat(filePath);

          if (stat.isDirectory()) {
            return {
              path: filePath,
              success: false,
              error: { code: "IS_DIRECTORY", message: `Path is a directory: ${filePath}` },
            };
          }

          if (stat.size > max_size_bytes) {
            return {
              path: filePath,
              success: false,
              error: {
                code: "FILE_TOO_LARGE",
                message: `File size ${stat.size} exceeds limit ${max_size_bytes}`,
              },
            };
          }

          const buffer = await fs.readFile(filePath);
          const content =
            encoding === "base64"
              ? buffer.toString("base64")
              : buffer.toString("utf-8");

          return {
            path: filePath,
            success: true,
            content,
            size_bytes: stat.size,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            path: filePath,
            success: false,
            error: { code: "FILE_NOT_FOUND", message },
          };
        }
      }),
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ results }) }],
    };
  },
};
