import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./lib/logger.js";
import { loadConfig } from "./lib/config.js";
import { getProcessManager } from "./lib/process-manager.js";
import { startHealthServer, stopHealthServer } from "./http-health.js";
import { getAuditLogger } from "./lib/audit/logger.js";
import { startAuditCron, stopAuditCron } from "./lib/audit/cron.js";

async function shutdown(): Promise<void> {
  logger.info("Shutting down FMS-MCP server...");
  stopAuditCron();
  const pm = getProcessManager();
  await pm.shutdownAll();
  pm.dispose();
  const audit = getAuditLogger();
  await audit.shutdown();
  await stopHealthServer();
  logger.info("Shutdown complete");
}

async function main(): Promise<void> {
  const config = loadConfig();

  const audit = getAuditLogger();
  await audit.init();

  if (config.AUDIT_ENABLED) {
    startAuditCron();
  }

  if (config.HEALTH_PORT) {
    startHealthServer(config.HEALTH_PORT);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("FMS-MCP server started on stdio");

  const onSignal = () => {
    shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal error: ${String(error)}\n`);
  process.exit(1);
});
