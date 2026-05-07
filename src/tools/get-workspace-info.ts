import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../types/index.js";
import { loadConfig } from "../lib/config.js";

const inputSchema = z.object({});

async function scanProject(
  projectPath: string,
  name: string,
): Promise<{
  name: string;
  path: string;
  size_bytes: number;
  file_count: number;
  last_modified: string;
  has_git: boolean;
  has_package_json: boolean;
}> {
  let sizeBytes = 0;
  let fileCount = 0;
  let lastModified = new Date(0);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    if (fileCount > 1000) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const fullPath = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          fileCount++;
          sizeBytes += stat.size;
          if (stat.mtime > lastModified) lastModified = stat.mtime;
        } else if (stat.isDirectory()) {
          await walk(fullPath, depth + 1);
        }
      } catch {
        continue;
      }
    }
  }

  await walk(projectPath, 0);

  let hasGit = false;
  let hasPackageJson = false;

  try {
    await fs.access(path.join(projectPath, ".git"));
    hasGit = true;
  } catch {}

  try {
    await fs.access(path.join(projectPath, "package.json"));
    hasPackageJson = true;
  } catch {}

  return {
    name,
    path: projectPath,
    size_bytes: sizeBytes,
    file_count: fileCount,
    last_modified: lastModified.toISOString(),
    has_git: hasGit,
    has_package_json: hasPackageJson,
  };
}

export const getWorkspaceInfo: ToolDefinition = {
  name: "get_workspace_info",
  description: "Get overview of workspace projects and recent activity.",
  inputSchema,
  handler: async () => {
    const config = loadConfig();
    const root = config.WORKSPACE_ROOT;

    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              workspace_root: root,
              projects: [],
              total_projects: 0,
              total_size_bytes: 0,
              generated_at: new Date().toISOString(),
              error: "Cannot read workspace root",
            }),
          },
        ],
      };
    }

    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith("."),
    );

    const scanPromises = dirs.map((d) =>
      scanProject(path.join(root, d.name), d.name),
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("scan timeout")), 5000),
    );

    type ProjectInfo = Awaited<ReturnType<typeof scanProject>>;
    let projects: ProjectInfo[];
    try {
      projects = await Promise.race([
        Promise.all(scanPromises),
        timeoutPromise,
      ]) as ProjectInfo[];
    } catch {
      projects = [];
    }

    const totalSize = projects.reduce((sum, p) => sum + p.size_bytes, 0);

    const result = {
      workspace_root: root,
      projects,
      total_projects: projects.length,
      total_size_bytes: totalSize,
      generated_at: new Date().toISOString(),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
