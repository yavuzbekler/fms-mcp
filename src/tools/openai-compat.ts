import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import fg from "fast-glob";
import type { ToolDefinition } from "../types/index.js";
import { loadConfig } from "../lib/config.js";
import { validatePath } from "../lib/path-lock.js";
import { FileNotFoundError, FileTooLargeError, IsDirectoryError } from "../lib/errors.js";

// ChatGPT connector'ları `search` ve `fetch` adlı tool'ları zorunlu tutar:
// search → {results: [{id, title, url}]}, fetch → {id, title, text, url, metadata}.
// Bu iki tool mevcut dosya arama/okuma yeteneklerini o sözleşmeye uyarlar.

const MAX_RESULTS = 20;
const MAX_FETCH_BYTES = 1_000_000;
const MAX_SEARCH_OUTPUT_BYTES = 2_000_000;
const MAX_RIPGREP_JSON_LINE_CHARS = 32_000;

interface SearchResult {
  id: string;
  title: string;
  url: string;
}

function toResult(workspaceRoot: string, absolutePath: string, snippet?: string): SearchResult {
  const relative = path.relative(workspaceRoot, absolutePath);
  return {
    id: relative,
    title: snippet ? `${path.basename(absolutePath)} — ${snippet}` : path.basename(absolutePath),
    url: `file://${absolutePath}`,
  };
}

function searchContent(workspaceRoot: string, query: string, limit: number): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    if (limit <= 0) {
      resolve(new Map());
      return;
    }

    const matches = new Map<string, string>();
    const proc = spawn(
      "rg",
      [
        "--fixed-strings",
        "--ignore-case",
        "--max-count",
        "1",
        "--max-columns",
        "300",
        "--max-filesize",
        "1M",
        "--json",
        "--no-messages",
        "--glob",
        "!**/node_modules/**",
        "--glob",
        "!**/.git/**",
        "--",
        query,
        workspaceRoot,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    let buffer = "";
    let outputBytes = 0;
    let settled = false;
    let stopped = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(matches);
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      proc.kill("SIGTERM");
    };

    const consumeLine = (line: string) => {
      if (matches.size >= limit || !line || line.length > MAX_RIPGREP_JSON_LINE_CHARS) return;

      try {
        const msg = JSON.parse(line) as {
          type: string;
          data?: { path?: { text?: string }; lines?: { text?: string } };
        };
        if (msg.type === "match" && msg.data?.path?.text) {
          const snippet = (msg.data.lines?.text ?? "").trim().slice(0, 120);
          matches.set(msg.data.path.text, snippet);
          if (matches.size >= limit) stop();
        }
      } catch {
        // bozuk satırı atla
      }
    };

    proc.stdout.on("data", (data: Buffer) => {
      if (settled) return;

      outputBytes += data.byteLength;
      if (outputBytes > MAX_SEARCH_OUTPUT_BYTES) {
        stop();
        return;
      }

      buffer += data.toString("utf-8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        consumeLine(line);
        if (stopped) break;
        newlineIndex = buffer.indexOf("\n");
      }

      if (buffer.length > MAX_RIPGREP_JSON_LINE_CHARS) {
        buffer = "";
      }
    });

    proc.on("close", () => {
      if (buffer && !stopped) {
        consumeLine(buffer);
      }
      settle();
    });
    proc.on("error", settle);
  });
}

const searchInputSchema = z.object({
  query: z.string().describe("Search query — matches file names and file contents"),
});

export const openaiSearch: ToolDefinition = {
  name: "search",
  description:
    "Search the workspace by file name and file content. Returns a list of matching documents for use with the fetch tool.",
  inputSchema: searchInputSchema,
  handler: async (args) => {
    const { query } = searchInputSchema.parse(args);
    const { WORKSPACE_ROOT } = loadConfig();
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      const structuredContent = { results: [] };
      return {
        structuredContent,
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
      };
    }

    const nameMatches = await fg(`**/*${fg.escapePath(normalizedQuery)}*`, {
      cwd: WORKSPACE_ROOT,
      absolute: true,
      onlyFiles: true,
      caseSensitiveMatch: false,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
      suppressErrors: true,
    }).catch(() => [] as string[]);

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const abs of nameMatches) {
      if (results.length >= MAX_RESULTS) break;
      if (seen.has(abs)) continue;
      seen.add(abs);
      results.push(toResult(WORKSPACE_ROOT, abs));
    }

    const contentMatches = await searchContent(WORKSPACE_ROOT, normalizedQuery, MAX_RESULTS - results.length);
    for (const [abs, snippet] of contentMatches) {
      if (results.length >= MAX_RESULTS) break;
      if (seen.has(abs)) continue;
      seen.add(abs);
      results.push(toResult(WORKSPACE_ROOT, abs, snippet));
    }

    const structuredContent = { results };
    return {
      structuredContent,
      content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    };
  },
};

const fetchInputSchema = z.object({
  id: z.string().describe("Document id returned by the search tool (workspace-relative file path)"),
});

export const openaiFetch: ToolDefinition = {
  name: "fetch",
  description: "Fetch the full content of a document found via the search tool.",
  inputSchema: fetchInputSchema,
  handler: async (args) => {
    const { id } = fetchInputSchema.parse(args);
    const absolutePath = await validatePath(id, "read");

    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      throw new FileNotFoundError(`File not found: ${id}`);
    }
    if (stat.isDirectory()) {
      throw new IsDirectoryError(`Path is a directory, not a file: ${id}`);
    }
    if (stat.size > MAX_FETCH_BYTES) {
      throw new FileTooLargeError(
        `File size ${stat.size} bytes exceeds fetch limit of ${MAX_FETCH_BYTES} bytes: ${id}`,
      );
    }

    const text = await fs.readFile(absolutePath, "utf-8");
    const document = {
      id,
      title: path.basename(absolutePath),
      text,
      url: `file://${absolutePath}`,
      metadata: {
        size_bytes: stat.size,
        modified: stat.mtime.toISOString(),
      },
    };

    return {
      structuredContent: document,
      content: [{ type: "text" as const, text: JSON.stringify(document) }],
    };
  },
};
