import { z } from "zod";
import type { ToolDefinition } from "../types/index.js";

export const ping: ToolDefinition = {
  name: "ping",
  description: "Health check — returns pong with server info",
  inputSchema: z.object({}),
  handler: async () => {
    const result = {
      status: "ok",
      server: "fms-mcp",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      node_version: process.version,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
