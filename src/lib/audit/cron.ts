import cron from "node-cron";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { archiveMonth, cleanRetention } from "./archive.js";

let archiveTask: cron.ScheduledTask | null = null;
let retentionTask: cron.ScheduledTask | null = null;

export function startAuditCron(): void {
  const config = loadConfig();
  const auditDir = config.resolvedAuditDir;
  const archiveDir = config.resolvedAuditArchiveDir;

  archiveTask = cron.schedule("0 2 1 * *", async () => {
    const now = new Date();
    let targetMonth = now.getUTCMonth();
    let targetYear = now.getUTCFullYear();
    if (targetMonth === 0) {
      targetMonth = 12;
      targetYear--;
    }
    logger.info({ targetYear, targetMonth }, "audit archive cron started");
    try {
      const result = await archiveMonth(auditDir, archiveDir, targetYear, targetMonth);
      logger.info(result, "audit archive cron completed");
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "audit archive cron failed",
      );
    }
  }, { timezone: "UTC" });

  retentionTask = cron.schedule("0 3 1 * *", async () => {
    logger.info("audit retention cron started");
    try {
      const result = await cleanRetention(archiveDir, config.AUDIT_RETENTION_MONTHS);
      logger.info(result, "audit retention cron completed");
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "audit retention cron failed",
      );
    }
  }, { timezone: "UTC" });

  logger.info("audit cron jobs scheduled");
}

export function stopAuditCron(): void {
  if (archiveTask) {
    archiveTask.stop();
    archiveTask = null;
  }
  if (retentionTask) {
    retentionTask.stop();
    retentionTask = null;
  }
}
