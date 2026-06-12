import { z } from "zod";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type PathField = "path" | "paths" | "source" | "destination" | "source_path" | "dest_path" | "cwd";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  requiresPathValidation?: boolean;
  pathFields?: PathField[];
  pathOperation?: "read" | "write";
  auditRedactFields?: string[];
}

export interface AuditEntry {
  ts: string;
  tool: string;
  project: string;
  args: Record<string, unknown>;
  result: "success" | "error";
  duration_ms: number;
  size_bytes?: number;
  exit_code?: number;
  timed_out?: boolean;
  pid?: number;
  process_id?: string;
  error?: { code: string; message: string };
  request_id?: string;
}
