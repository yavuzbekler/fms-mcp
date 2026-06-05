import path from "node:path";
import fs from "node:fs/promises";
import { loadConfig } from "./config.js";
import {
  InvalidPathError,
  PathOutsideWorkspaceError,
  ReservedPathError,
} from "./errors.js";

export function resolvePath(input: string): string {
  const { WORKSPACE_ROOT } = loadConfig();
  const resolved = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(WORKSPACE_ROOT, input);
  return resolved;
}

export async function resolvePathWithSymlink(input: string): Promise<string> {
  const resolved = resolvePath(input);
  try {
    return await fs.realpath(resolved);
  } catch {
    return await resolveNonexistentPathWithSymlink(resolved);
  }
}

async function resolveNonexistentPathWithSymlink(resolved: string): Promise<string> {
  let current = resolved;
  const missingSegments: string[] = [];

  while (true) {
    try {
      const realAncestor = await fs.realpath(current);
      return path.join(realAncestor, ...missingSegments.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

export function assertWithinWorkspace(absolutePath: string): void {
  if (!path.isAbsolute(absolutePath)) {
    throw new InvalidPathError(`Path must be absolute, got: ${absolutePath}`);
  }

  const { WORKSPACE_ROOT } = loadConfig();
  const relative = path.relative(WORKSPACE_ROOT, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathOutsideWorkspaceError(
      `Path is outside workspace: ${absolutePath}`,
    );
  }
}

export function assertNotReserved(
  absolutePath: string,
  operation: "read" | "write",
): void {
  if (operation === "read") return;

  const { WORKSPACE_ROOT, RESERVED_PATHS } = loadConfig();
  const relative = path.relative(WORKSPACE_ROOT, absolutePath);
  const firstSegment = relative.split(path.sep)[0];

  for (const reserved of RESERVED_PATHS) {
    if (firstSegment === reserved) {
      throw new ReservedPathError(
        `Write access denied to reserved path: ${absolutePath}`,
      );
    }
  }
}

export async function validatePath(
  input: string,
  operation: "read" | "write",
): Promise<string> {
  const resolved = await resolvePathWithSymlink(input);
  assertWithinWorkspace(resolved);
  assertNotReserved(resolved, operation);
  return resolved;
}
