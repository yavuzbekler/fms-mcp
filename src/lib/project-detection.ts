import path from "node:path";
import { loadConfig } from "./config.js";
import { resolvePath } from "./path-lock.js";

const SYSTEM_PROJECT = "_system";

export function detectProject(absolutePath: string): string {
  const { WORKSPACE_ROOT } = loadConfig();
  const relative = path.relative(WORKSPACE_ROOT, absolutePath);

  if (!relative || relative === ".") return SYSTEM_PROJECT;

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return SYSTEM_PROJECT;
  }

  const firstSegment = relative.split(path.sep)[0];

  if (!firstSegment || firstSegment === ".") return SYSTEM_PROJECT;
  if (firstSegment.startsWith(".")) return SYSTEM_PROJECT;

  return firstSegment;
}

export function detectProjectFromCwd(cwd?: string): string {
  if (!cwd) return SYSTEM_PROJECT;
  return detectProject(resolvePath(cwd));
}
