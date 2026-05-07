import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./types/index.js";
import { ping } from "./tools/ping.js";
import { logger } from "./lib/logger.js";

const tools: ToolDefinition[] = [ping];

export function createServer(): McpServer {
  const server = new McpServer({
    name: "fms-mcp",
    version: "0.1.0",
  });

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (args) => {
        logger.info({ tool: tool.name }, "tool called");
        return tool.handler(args as Record<string, unknown>);
      },
    );
  }

  logger.info({ toolCount: tools.length }, "MCP server created");
  return server;
}
