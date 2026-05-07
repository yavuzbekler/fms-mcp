import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resetConfig } from "../../src/lib/config.js";

export interface TestWorkspace {
  root: string;
  resolve: (...segments: string[]) => string;
}

export async function createTestWorkspace(): Promise<TestWorkspace> {
  const id = crypto.randomBytes(6).toString("hex");
  const root = `/tmp/fms-test-${id}`;
  await fs.mkdir(root, { recursive: true });

  resetConfig();
  process.env["WORKSPACE_ROOT"] = root;

  return {
    root,
    resolve: (...segments: string[]) => path.join(root, ...segments),
  };
}

export async function destroyTestWorkspace(ws: TestWorkspace): Promise<void> {
  resetConfig();
  await fs.rm(ws.root, { recursive: true, force: true });
}

export async function seedFile(
  ws: TestWorkspace,
  relativePath: string,
  content: string,
): Promise<string> {
  const abs = ws.resolve(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return abs;
}

export async function seedDir(
  ws: TestWorkspace,
  relativePath: string,
): Promise<string> {
  const abs = ws.resolve(relativePath);
  await fs.mkdir(abs, { recursive: true });
  return abs;
}

export function parseResult(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}
