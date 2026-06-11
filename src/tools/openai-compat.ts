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
    const proc = spawn(
      "rg",
      ["--fixed-strings", "--ignore-case", "--max-count", "1", "--json", "--", query, workspaceRoot],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    const finish = () => {
      const matches = new Map<string, string>();
      for (const line of stdout.split("\n")) {
        if (matches.size >= limit) break;
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as {
            type: string;
            data?: { path?: { text?: string }; lines?: { text?: string } };
          };
          if (msg.type === "match" && msg.data?.path?.text) {
            const snippet = (msg.data.lines?.text ?? "").trim().slice(0, 120);
            matches.set(msg.data.path.text, snippet);
          }
        } catch {
          // bozuk satırı atla
        }
      }
      resolve(matches);
    };
    proc.on("close", finish);
    proc.on("error", () => resolve(new Map()));
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

    const nameMatches = await fg(`**/*${fg.escapePath(query)}*`, {
      cwd: WORKSPACE_ROOT,
      absolute: true,
      onlyFiles: true,
      caseSensitiveMatch: false,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
      suppressErrors: true,
    }).catch(() => [] as string[]);

    const contentMatches = await searchContent(WORKSPACE_ROOT, query, MAX_RESULTS);

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const abs of nameMatches) {
      if (results.length >= MAX_RESULTS) break;
      if (seen.has(abs)) continue;
      seen.add(abs);
      results.push(toResult(WORKSPACE_ROOT, abs));
    }
    for (const [abs, snippet] of contentMatches) {
      if (results.length >= MAX_RESULTS) break;
      if (seen.has(abs)) continue;
      seen.add(abs);
      results.push(toResult(WORKSPACE_ROOT, abs, snippet));
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ results }) }],
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
      content: [{ type: "text" as const, text: JSON.stringify(document) }],
    };
  },
};
