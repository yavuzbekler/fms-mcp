import pino from "pino";
import { loadConfig } from "./config.js";

const config = loadConfig();

export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    process.env["NODE_ENV"] === "development"
      ? { target: "pino/file", options: { destination: 2 } }
      : undefined,
}, process.stderr);
