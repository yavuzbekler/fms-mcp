import { z } from "zod";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ToolDefinition } from "../types/index.js";
import { FileNotFoundError, NotDirectoryError } from "../lib/errors.js";

const inputSchema = z.object({
  path: z.string().describe("Starting directory for search"),
  query: z.string().describe("Search query (regex or literal)"),
  is_regex: z
    .boolean()
    .default(false)
    .describe("Treat query as regex (default: literal)"),
  case_sensitive: z
    .boolean()
    .default(false)
    .describe("Case-sensitive search"),
  file_pattern: z
    .string()
    .optional()
    .describe("Glob to filter files (e.g. *.ts)"),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum results"),
  context_lines: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Context lines around match"),
});

interface CodeMatch {
  file: string;
  line: number;
  content: string;
  context_before?: string[];
  context_after?: string[];
}

interface RgMessage {
  type: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: Array<{ match: { text: string } }>;
  };
}

function runRipgrep(rgArgs: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("rg", rgArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 || code === 1) {
        resolve(stdout);
      } else {
        reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`ripgrep not available: ${err.message}`));
    });
  });
}

export const searchCode: ToolDefinition = {
  name: "search_code",
  description: "Search file contents using ripgrep",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "read",
  handler: async (args) => {
    const {
      path: dirPath,
      query,
      is_regex,
      case_sensitive,
      file_pattern,
      max_results,
      context_lines,
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

    const rgArgs = ["--json"];

    if (!is_regex) rgArgs.push("--fixed-strings");
    if (!case_sensitive) rgArgs.push("--ignore-case");
    if (file_pattern) rgArgs.push("--glob", file_pattern);
    if (context_lines > 0) rgArgs.push("--context", String(context_lines));

    rgArgs.push("--", query, dirPath);

    const stdout = await runRipgrep(rgArgs);

    const matches: CodeMatch[] = [];
    const contextMap = new Map<string, { before: string[]; after: string[] }>();

    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;

      let msg: RgMessage;
      try {
        msg = JSON.parse(line) as RgMessage;
      } catch {
        continue;
      }

      if (msg.type === "match" && msg.data) {
        const file = msg.data.path?.text ?? "";
        const lineNum = msg.data.line_number ?? 0;
        const content = (msg.data.lines?.text ?? "").replace(/\n$/, "");

        const match: CodeMatch = { file, line: lineNum, content };

        if (context_lines > 0) {
          const key = `${file}:${lineNum}`;
          const ctx = contextMap.get(key);
          if (ctx) {
            match.context_before = ctx.before;
          }
          match.context_before = match.context_before ?? [];
          match.context_after = [];
          contextMap.set(key, { before: match.context_before, after: match.context_after });
        }

        matches.push(match);
        if (matches.length >= max_results) break;
      } else if (msg.type === "context" && msg.data && context_lines > 0) {
        const content = (msg.data.lines?.text ?? "").replace(/\n$/, "");
        const lineNum = msg.data.line_number ?? 0;

        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1];
          if (lineNum > lastMatch.line) {
            lastMatch.context_after = lastMatch.context_after ?? [];
            lastMatch.context_after.push(content);
          }
        }
      }
    }

    const truncated = matches.length >= max_results;

    const result = {
      matches,
      total_count: matches.length,
      truncated,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
