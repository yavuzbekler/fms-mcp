import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../types/index.js";
import { FileNotFoundError, NotDirectoryError } from "../lib/errors.js";

const MAX_ENTRIES = 1000;

const inputSchema = z.object({
  path: z.string().describe("Directory path to list"),
  recursive: z.boolean().default(false).describe("List recursively"),
  max_depth: z
    .number()
    .int()
    .min(1)
    .default(5)
    .describe("Max depth when recursive (default 5)"),
  include_hidden: z
    .boolean()
    .default(false)
    .describe("Include hidden files (starting with .)"),
  pattern: z.string().optional().describe("Glob pattern to filter (e.g. *.ts)"),
});

interface DirEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size_bytes?: number;
  modified_at: string;
}

async function walkDirectory(
  dirPath: string,
  recursive: boolean,
  maxDepth: number,
  includeHidden: boolean,
  pattern: string | undefined,
  entries: DirEntry[],
  currentDepth: number,
): Promise<boolean> {
  if (entries.length >= MAX_ENTRIES) return true;
  if (recursive && currentDepth > maxDepth) return false;

  let dirents;
  try {
    dirents = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const dirent of dirents) {
    if (entries.length >= MAX_ENTRIES) return true;

    if (!includeHidden && dirent.name.startsWith(".")) continue;

    if (pattern && !matchGlob(dirent.name, pattern)) {
      if (recursive && dirent.isDirectory()) {
        const truncated = await walkDirectory(
          path.join(dirPath, dirent.name),
          recursive,
          maxDepth,
          includeHidden,
          pattern,
          entries,
          currentDepth + 1,
        );
        if (truncated) return true;
      }
      continue;
    }

    const fullPath = path.join(dirPath, dirent.name);
    let type: "file" | "directory" | "symlink" = "file";
    if (dirent.isDirectory()) type = "directory";
    else if (dirent.isSymbolicLink()) type = "symlink";

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      stat = null;
    }

    entries.push({
      name: dirent.name,
      path: fullPath,
      type,
      size_bytes: stat && !stat.isDirectory() ? stat.size : undefined,
      modified_at: stat ? stat.mtime.toISOString() : new Date().toISOString(),
    });

    if (recursive && dirent.isDirectory()) {
      const truncated = await walkDirectory(
        fullPath,
        recursive,
        maxDepth,
        includeHidden,
        pattern,
        entries,
        currentDepth + 1,
      );
      if (truncated) return true;
    }
  }

  return false;
}

function matchGlob(name: string, pattern: string): boolean {
  if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
    const regex = globToRegex(pattern);
    return regex.test(name);
  }
  return name === pattern;
}

function globToRegex(glob: string): RegExp {
  let regex = "^";
  for (const ch of glob) {
    if (ch === "*") regex += ".*";
    else if (ch === "?") regex += ".";
    else if (".+^${}()|[]\\".includes(ch)) regex += "\\" + ch;
    else regex += ch;
  }
  regex += "$";
  return new RegExp(regex);
}

export const listDirectory: ToolDefinition = {
  name: "list_directory",
  description: "List directory contents with metadata",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "read",
  handler: async (args) => {
    const {
      path: dirPath,
      recursive,
      max_depth,
      include_hidden,
      pattern,
    } = inputSchema.parse(args);

    let stat;
    try {
      stat = await fs.stat(dirPath);
    } catch {
      throw new FileNotFoundError(`Path not found: ${dirPath}`);
    }

    if (!stat.isDirectory()) {
      throw new NotDirectoryError(`Path is not a directory: ${dirPath}`);
    }

    const entries: DirEntry[] = [];
    const wasTruncated = await walkDirectory(
      dirPath,
      recursive,
      max_depth,
      include_hidden,
      pattern,
      entries,
      1,
    );

    const result = {
      path: dirPath,
      entries,
      total_count: entries.length,
      ...(wasTruncated ? { truncated: true } : {}),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
