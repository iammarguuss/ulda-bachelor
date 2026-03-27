import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const appRootDir = fileURLToPath(new URL("../../", import.meta.url));
const logDir = path.resolve(appRootDir, process.env.LOG_DIR ?? "logs");
const levelNames = ["critical", "error", "warning", "info", "debug"];
const configuredLevel = String(process.env.LOG_LEVEL ?? "info").toLowerCase();
const loggerLevel = levelNames.includes(configuredLevel) ? configuredLevel : "info";

fs.mkdirSync(logDir, { recursive: true });

const levels = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  debug: 4
};

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(info => {
    const { timestamp, level, message, stack, ...meta } = info;
    const suffix = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level}] ${message}${stack ? `\n${stack}` : ""}${suffix}`;
  })
);

const transports = [
  new winston.transports.Console({
    level: loggerLevel,
    format: consoleFormat
  }),
  new DailyRotateFile({
    dirname: logDir,
    filename: "ulda-crud-%DATE%.log",
    datePattern: process.env.LOG_DATE_PATTERN ?? "YYYY-MM-DD",
    maxFiles: process.env.LOG_MAX_FILES ?? "14d",
    zippedArchive: String(process.env.LOG_ZIPPED_ARCHIVE ?? "false").toLowerCase() === "true",
    level: loggerLevel,
    format: fileFormat
  }),
  new DailyRotateFile({
    dirname: logDir,
    filename: "ulda-crud-error-%DATE%.log",
    datePattern: process.env.LOG_DATE_PATTERN ?? "YYYY-MM-DD",
    maxFiles: process.env.LOG_MAX_FILES ?? "30d",
    zippedArchive: String(process.env.LOG_ZIPPED_ARCHIVE ?? "false").toLowerCase() === "true",
    level: "error",
    format: fileFormat
  })
];

const baseLogger = winston.createLogger({
  levels,
  level: loggerLevel,
  defaultMeta: {
    app: "ulda-crud"
  },
  transports
});

/**
 * Creates a child logger tagged with the current component/module name.
 *
 * @param {string} component
 * @returns {*}
 */
function createModuleLogger(component) {
  return baseLogger.child({ component });
}

export {
  createModuleLogger,
  loggerLevel,
  logDir
};
