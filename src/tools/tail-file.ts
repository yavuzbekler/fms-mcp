import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";
import { FileNotFoundError, IsDirectoryError } from "../lib/errors.js";

const inputSchema = z.object({
  path: z
    .string()
    .describe("File path to tail (absolute or relative to workspace)"),
  lines: z
    .number()
    .int()
    .positive()
    .max(10000)
    .default(50)
    .describe("Number of lines to return (default 50, max 10000)"),
  from_end: z
    .boolean()
    .default(true)
    .describe("Read from end of file (default true)"),
});

const CHUNK_SIZE = 8192;

async function tailFromEnd(
  filePath: string,
  lineCount: number,
): Promise<{ lines: string[]; bytesRead: number }> {
  const stat = await fs.stat(filePath);
  const fileSize = stat.size;

  if (fileSize === 0) {
    return { lines: [], bytesRead: 0 };
  }

  const fd = await fs.open(filePath, "r");
  try {
    let position = fileSize;
    let bytesRead = 0;
    const chunks: Buffer[] = [];
    let newlineCount = 0;
    const targetNewlines = lineCount + 1;

    while (position > 0 && newlineCount < targetNewlines) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;
      const buffer = Buffer.alloc(readSize);
      const result = await fd.read(buffer, 0, readSize, position);
      bytesRead += result.bytesRead;
      chunks.unshift(buffer.subarray(0, result.bytesRead));

      for (let i = 0; i < result.bytesRead; i++) {
        if (buffer[i] === 0x0a) newlineCount++;
      }
    }

    const content = Buffer.concat(chunks).toString("utf-8");
    let allLines = content.split("\n");

    if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
      allLines.pop();
    }

    if (allLines.length > lineCount) {
      allLines = allLines.slice(allLines.length - lineCount);
    }

    return { lines: allLines, bytesRead };
  } finally {
    await fd.close();
  }
}

async function tailFromStart(
  filePath: string,
  lineCount: number,
): Promise<{ lines: string[]; bytesRead: number }> {
  const content = await fs.readFile(filePath, "utf-8");
  let allLines = content.split("\n");

  if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }

  const lines = allLines.slice(0, lineCount);
  return { lines, bytesRead: Buffer.byteLength(content) };
}

export const tailFile: ToolDefinition = {
  name: "tail_file",
  description: "Get last N lines of a file. Useful for log monitoring.",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "read",
  handler: async (args) => {
    const parsed = inputSchema.parse(args);
    const filePath = parsed.path;

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new FileNotFoundError(`File not found: ${filePath}`);
    }

    if (stat.isDirectory()) {
      throw new IsDirectoryError(`Path is a directory: ${filePath}`);
    }

    const { lines, bytesRead } = parsed.from_end
      ? await tailFromEnd(filePath, parsed.lines)
      : await tailFromStart(filePath, parsed.lines);

    const totalContent = await fs.readFile(filePath, "utf-8");
    let totalLines = totalContent.split("\n").length;
    if (totalContent.endsWith("\n")) totalLines--;

    const result = {
      path: filePath,
      lines,
      total_lines: totalLines,
      bytes_read: bytesRead,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
