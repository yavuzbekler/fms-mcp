import fsp from "node:fs/promises";
import path from "node:path";
import { create as tarCreate } from "tar";
import { logger } from "../logger.js";

export async function archiveMonth(
  auditDir: string,
  archiveDir: string,
  targetYear: number,
  targetMonth: number,
): Promise<{ archived: number; projects: string[] }> {
  const prefix = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  let totalArchived = 0;
  const archivedProjects: string[] = [];

  let projects: string[];
  try {
    projects = await fsp.readdir(auditDir);
  } catch {
    return { archived: 0, projects: [] };
  }

  for (const project of projects) {
    const projectDir = path.join(auditDir, project);
    const stat = await fsp.stat(projectDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const files = await fsp.readdir(projectDir);
    const matchingFiles = files.filter(
      (f) => f.startsWith(prefix) && f.endsWith(".log"),
    );

    if (matchingFiles.length === 0) continue;

    const archiveProjectDir = path.join(archiveDir, project);
    await fsp.mkdir(archiveProjectDir, { recursive: true });

    const archivePath = path.join(archiveProjectDir, `${prefix}.tar.gz`);

    try {
      await tarCreate(
        {
          gzip: true,
          file: archivePath,
          cwd: projectDir,
        },
        matchingFiles,
      );

      for (const f of matchingFiles) {
        await fsp.unlink(path.join(projectDir, f));
      }

      totalArchived += matchingFiles.length;
      archivedProjects.push(project);
      logger.info(
        { project, files: matchingFiles.length, archive: archivePath },
        "audit logs archived",
      );
    } catch (err) {
      logger.error(
        { project, error: err instanceof Error ? err.message : String(err) },
        "audit archive failed — originals preserved",
      );
    }
  }

  return { archived: totalArchived, projects: archivedProjects };
}

export async function cleanRetention(
  archiveDir: string,
  retentionMonths: number,
): Promise<{ deleted: number }> {
  const now = new Date();
  const cutoffYear = now.getUTCFullYear();
  const cutoffMonth = now.getUTCMonth() + 1;
  const cutoffTotal = cutoffYear * 12 + cutoffMonth - retentionMonths;
  let totalDeleted = 0;

  let projects: string[];
  try {
    projects = await fsp.readdir(archiveDir);
  } catch {
    return { deleted: 0 };
  }

  for (const project of projects) {
    const projectDir = path.join(archiveDir, project);
    const stat = await fsp.stat(projectDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const files = await fsp.readdir(projectDir);

    for (const file of files) {
      const match = file.match(/^(\d{4})-(\d{2})\.tar\.gz$/);
      if (!match) continue;

      const fileYear = parseInt(match[1], 10);
      const fileMonth = parseInt(match[2], 10);
      const fileTotal = fileYear * 12 + fileMonth;

      if (fileTotal < cutoffTotal) {
        try {
          await fsp.unlink(path.join(projectDir, file));
          totalDeleted++;
          logger.info(
            { project, file },
            "old audit archive deleted (retention)",
          );
        } catch (err) {
          logger.error(
            { project, file, error: err instanceof Error ? err.message : String(err) },
            "retention cleanup failed",
          );
        }
      }
    }
  }

  return { deleted: totalDeleted };
}
