import express from "express";
import http from "node:http";
import path from "node:path";
import { exec as execCb } from "node:child_process";
import { webcrypto, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { Server as SocketIOServer } from "socket.io";
import UldaSign from "../../../packages/ulda-sign/ulda-sign.js";
import {
  AppError,
  DatabaseError,
  NotFoundError,
  ValidationError,
  VerificationError,
  toAppError
} from "./errors/app-error.js";
import { createLocalizedErrorBody } from "./errors/messages.js";
import { createModuleLogger, loggerLevel, logDir } from "./logging/logger.js";
import {
  getRequestContext,
  requestContextMiddleware,
  withRequestContext
} from "./logging/request-context.js";

/**
 * @typedef {object} CrudRecordPayload
 * @property {number|string} [id] Record identifier for read, update, and delete operations.
 * @property {string|Uint8Array|number[]} [ulda_key] ULDA signature/state key.
 * @property {string|Uint8Array|number[]} [uldaKey] Alias for `ulda_key`.
 * @property {string|Uint8Array|number[]} [content] Binary content payload in the selected encoding.
 * @property {"hex"|"base64"|"bytes"} [format] Encoding used for `ulda_key`.
 * @property {"hex"|"base64"|"bytes"} [contentFormat] Encoding used for `content`.
 */

/**
 * @typedef {object} CrudHandlerResult
 * @property {number} [id] Created record id.
 * @property {boolean} [verified] Whether an update/delete signature was accepted.
 * @property {boolean} [deleted] Whether a record was deleted.
 * @property {string|number[]|Uint8Array} [ulda_key] Encoded ULDA key for read responses.
 * @property {string|number[]|Uint8Array} [content] Encoded content for read responses.
 * @property {string} [format] Encoding used in the response for `ulda_key`.
 * @property {string} [contentFormat] Encoding used in the response for `content`.
 */

/**
 * @typedef {object} TraceLogger
 * @property {Function} step Emits a progress message.
 * @property {Function} error Emits an error message.
 * @property {Function} done Emits a final completion marker.
 */

/**
 * @typedef {object} CrudServer
 * @property {*} app Express application instance.
 * @property {*} httpServer HTTP server instance.
 * @property {*} io Socket.IO server instance.
 * @property {Function} start Starts the server.
 * @property {Function} stop Stops the server.
 */

const exec = promisify(execCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const browserTestDir = path.join(rootDir, "browser-test");

const serverLogger = createModuleLogger("server");
const requestLogger = createModuleLogger("http");
const dbLogger = createModuleLogger("database");
const operationLogger = createModuleLogger("operations");
const socketLogger = createModuleLogger("socket");
const processLogger = createModuleLogger("process");

function ensureWebCrypto() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    globalThis.crypto = /** @type {any} */ (webcrypto);
  }
  if (typeof globalThis.btoa !== "function") {
    globalThis.btoa = str => Buffer.from(str, "binary").toString("base64");
  }
  if (typeof globalThis.atob !== "function") {
    globalThis.atob = b64 => Buffer.from(b64, "base64").toString("binary");
  }
}

ensureWebCrypto();

const CONFIG = {
  port: Number(process.env.PORT ?? 8787),
  originSize: Number(process.env.ORIGIN_SIZE ?? 256),
  sign: {
    N: Number(process.env.SIGN_N ?? 5),
    mode: process.env.SIGN_MODE ?? "S",
    hash: process.env.SIGN_HASH ?? "SHA-256"
  },
  contentBytes: Number(process.env.CONTENT_BYTES ?? 32),
  logRequests: String(process.env.LOG_REQUESTS ?? "true").toLowerCase() === "true",
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "ulda",
    password: process.env.DB_PASSWORD ?? "ulda",
    database: process.env.DB_NAME ?? "ulda",
    connectionLimit: Number(process.env.DB_POOL_LIMIT ?? 10)
  },
  docker: {
    enable: String(process.env.DB_DOCKER_ENABLE ?? "true").toLowerCase() === "true",
    image: process.env.DB_DOCKER_IMAGE ?? "mysql:8.0",
    container: process.env.DB_DOCKER_CONTAINER ?? "ulda-mysql",
    volume: process.env.DB_DOCKER_VOLUME ?? "ulda_mysql",
    rootPassword: process.env.DB_DOCKER_ROOT_PASSWORD ?? "ulda_root"
  }
};

function currentLogMeta(meta = {}) {
  return { ...getRequestContext(), ...meta };
}

function logAtLevel(logger, level, message, meta = {}) {
  logger.log({
    level,
    message,
    ...currentLogMeta(meta)
  });
}

function durationMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

function normalizeOriginSize(value, fallback = 256) {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue % 8 !== 0) {
    throw new ValidationError("originSize must be a positive multiple of 8 (bits)", {
      context: { value }
    });
  }
  return numericValue;
}

function normalizeFormat(value, fallback = "hex") {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const format = String(value).toLowerCase();
  if (format === "hex" || format === "base64" || format === "bytes") return format;
  throw new ValidationError("format must be hex, base64, or bytes", {
    context: { value }
  });
}

function normalizeId(value) {
  const id = Number(value);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    throw new ValidationError("id must be a positive integer", {
      context: { value }
    });
  }
  return id;
}

function parseBytes(input, format, label) {
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (Array.isArray(input)) return Buffer.from(input);
  if (typeof input !== "string") {
    throw new ValidationError(`${label} must be a string or byte array`, {
      context: { label, receivedType: typeof input }
    });
  }
  const trimmed = input.trim();
  const normalizedFormat = normalizeFormat(format, "hex");
  if (normalizedFormat === "bytes") {
    throw new ValidationError(`${label} with format=bytes must be an array`, {
      context: { label }
    });
  }
  try {
    if (normalizedFormat === "hex") return Buffer.from(trimmed, "hex");
    if (normalizedFormat === "base64") return Buffer.from(trimmed, "base64");
  } catch (error) {
    throw new ValidationError(`Unsupported ${label} format`, {
      context: { label, format: normalizedFormat },
      cause: error instanceof Error ? error : undefined
    });
  }
  throw new ValidationError(`Unsupported ${label} format`, {
    context: { label, format: normalizedFormat }
  });
}

function encodeBytes(bytes, format) {
  const normalizedFormat = normalizeFormat(format, "base64");
  if (normalizedFormat === "hex") return Buffer.from(bytes).toString("hex");
  if (normalizedFormat === "base64") return Buffer.from(bytes).toString("base64");
  if (normalizedFormat === "bytes") return Array.from(Buffer.from(bytes));
  return Buffer.from(bytes).toString("base64");
}

function createTrace(label, startNs = process.hrtime.bigint()) {
  return {
    step(message, extra = {}) {
      if (!CONFIG.logRequests) return;
      logAtLevel(operationLogger, "debug", message, {
        operation: label,
        elapsedMs: durationMs(startNs),
        ...extra
      });
    },
    error(error, extra = {}) {
      const appError = toAppError(error);
      logAtLevel(operationLogger, appError.level ?? "error", appError.message, {
        operation: label,
        errorId: appError.errorId,
        code: appError.code,
        elapsedMs: durationMs(startNs),
        context: appError.context,
        stack: appError.stack,
        ...extra
      });
    },
    done(statusCode, extra = {}) {
      const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warning" : "info";
      logAtLevel(operationLogger, level, "Operation completed", {
        operation: label,
        statusCode,
        durationMs: durationMs(startNs),
        ...extra
      });
    }
  };
}

function wrapDatabaseError(error, operation, context = {}) {
  return new DatabaseError(`Database operation failed during ${operation}`, {
    context: {
      operation,
      ...context,
      originalCode: error?.code ?? null
    },
    cause: error instanceof Error ? error : undefined
  });
}

/**
 * @param {object} [options]
 * @param {string} [options.database]
 */
async function connectOnce({ database } = {}) {
  const poolConnection = mysql.createPool({
    host: CONFIG.db.host,
    port: CONFIG.db.port,
    user: CONFIG.db.user,
    password: CONFIG.db.password,
    database: database ?? CONFIG.db.database,
    connectionLimit: CONFIG.db.connectionLimit,
    enableKeepAlive: true
  });
  try {
    await poolConnection.query("SELECT 1");
    return poolConnection;
  } catch (error) {
    await poolConnection.end().catch(() => {});
    throw error;
  }
}

async function ensureDatabaseExists() {
  try {
    return await connectOnce({ database: CONFIG.db.database });
  } catch (error) {
    if (error?.code !== "ER_BAD_DB_ERROR") {
      throw error;
    }

    logAtLevel(dbLogger, "warning", "Configured database is missing, creating it now", {
      database: CONFIG.db.database
    });

    const connection = await mysql.createConnection({
      host: CONFIG.db.host,
      port: CONFIG.db.port,
      user: CONFIG.db.user,
      password: CONFIG.db.password
    });

    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${CONFIG.db.database}\``);
    } finally {
      await connection.end();
    }

    return await connectOnce({ database: CONFIG.db.database });
  }
}

async function ensureDockerMysql() {
  logAtLevel(dbLogger, "warning", "MySQL is unavailable, attempting Docker fallback", {
    container: CONFIG.docker.container,
    image: CONFIG.docker.image
  });

  await exec("docker --version");
  const { stdout } = await exec(
    `docker ps -a --filter "name=^/${CONFIG.docker.container}$" --format "{{.Names}}"`
  );

  if (stdout.trim()) {
    await exec(`docker start ${CONFIG.docker.container}`);
    logAtLevel(dbLogger, "info", "Started existing Docker MySQL container", {
      container: CONFIG.docker.container
    });
    return;
  }

  await exec(
    `docker run -d --name ${CONFIG.docker.container} ` +
      `-e MYSQL_ROOT_PASSWORD=${CONFIG.docker.rootPassword} ` +
      `-e MYSQL_DATABASE=${CONFIG.db.database} ` +
      `-e MYSQL_USER=${CONFIG.db.user} ` +
      `-e MYSQL_PASSWORD=${CONFIG.db.password} ` +
      `-p ${CONFIG.db.port}:3306 ` +
      `-v ${CONFIG.docker.volume}:/var/lib/mysql ` +
      `--restart unless-stopped ` +
      `${CONFIG.docker.image}`
  );

  logAtLevel(dbLogger, "info", "Created Docker MySQL container", {
    container: CONFIG.docker.container
  });
}

async function connectWithDockerFallback() {
  try {
    return await ensureDatabaseExists();
  } catch (error) {
    if (!CONFIG.docker.enable) {
      throw error;
    }
    await ensureDockerMysql();
    const maxAttempts = 20;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await ensureDatabaseExists();
      } catch (retryError) {
        if (attempt === maxAttempts) throw retryError;
        logAtLevel(dbLogger, "debug", "Waiting for MySQL container readiness", {
          attempt,
          maxAttempts
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    throw error;
  }
}

let pool;
let dbReadyPromise = null;

async function ensureDbReady() {
  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      logAtLevel(dbLogger, "info", "Initializing database connectivity", {
        database: CONFIG.db.database,
        host: CONFIG.db.host,
        port: CONFIG.db.port
      });
      try {
        pool = await connectWithDockerFallback();
        await pool.query(
          `CREATE TABLE IF NOT EXISTS main (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            ulda_key BLOB NOT NULL,
            content LONGBLOB NOT NULL
          ) ENGINE=InnoDB`
        );
        logAtLevel(dbLogger, "info", "Database is ready", {
          database: CONFIG.db.database
        });
        return pool;
      } catch (error) {
        dbReadyPromise = null;
        throw wrapDatabaseError(error, "initialize");
      }
    })();
  }
  return dbReadyPromise;
}

const uldaVerifier = new UldaSign({
  fmt: { export: "bytes" },
  sign: { originSize: normalizeOriginSize(CONFIG.originSize, 256) }
});

/**
 * Creates a record after decoding the incoming ULDA key and content payload.
 *
 * @param {CrudRecordPayload} payload Incoming create payload.
 * @param {TraceLogger|null} [trace] Optional request trace logger.
 * @returns {Promise<CrudHandlerResult>} Created record id.
 */
async function handleCreate(payload, trace) {
  trace?.step("Parsing create payload");
  const key = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  const content = parseBytes(payload.content, payload.contentFormat ?? "base64", "content");
  const database = await ensureDbReady();

  try {
    const [result] = await database.execute("INSERT INTO main (ulda_key, content) VALUES (?, ?)", [
      key,
      content
    ]);
    trace?.done(201, {
      recordId: result.insertId,
      keyBytes: key.length,
      contentBytes: content.length
    });
    return { id: result.insertId };
  } catch (error) {
    throw wrapDatabaseError(error, "insertRecord");
  }
}

/**
 * Reads a record and encodes it into the requested response formats.
 *
 * @param {CrudRecordPayload} payload Read payload containing id and optional output formats.
 * @param {TraceLogger|null} [trace] Optional request trace logger.
 * @returns {Promise<CrudHandlerResult>} Encoded record response.
 */
async function handleRead(payload, trace) {
  const id = normalizeId(payload.id);
  const format = payload.format ?? "base64";
  const contentFormat = payload.contentFormat ?? "base64";
  trace?.step("Reading record", { recordId: id });

  try {
    const database = await ensureDbReady();
    const [rows] = await database.execute("SELECT id, ulda_key, content FROM main WHERE id = ?", [id]);
    if (!rows.length) {
      throw new NotFoundError(`Record ${id} was not found`, {
        context: { recordId: id }
      });
    }
    const row = rows[0];
    trace?.done(200, { recordId: id });
    return {
      id: row.id,
      ulda_key: encodeBytes(row.ulda_key, format),
      content: encodeBytes(row.content, contentFormat),
      format: normalizeFormat(format, "base64"),
      contentFormat: normalizeFormat(contentFormat, "base64")
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw wrapDatabaseError(error, "readRecord", { recordId: id });
  }
}

/**
 * Updates a record only when the supplied ULDA key verifies against the stored key.
 *
 * @param {CrudRecordPayload} payload Update payload with record id, key, and content.
 * @param {TraceLogger|null} [trace] Optional request trace logger.
 * @returns {Promise<CrudHandlerResult>} Verification result.
 */
async function handleUpdate(payload, trace) {
  const id = normalizeId(payload.id);
  trace?.step("Updating record", { recordId: id });
  const newKey = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  const newContent = parseBytes(payload.content, payload.contentFormat ?? "base64", "content");

  try {
    const database = await ensureDbReady();
    const [rows] = await database.execute("SELECT ulda_key FROM main WHERE id = ?", [id]);
    if (!rows.length) {
      throw new NotFoundError(`Record ${id} was not found`, {
        context: { recordId: id }
      });
    }

    const storedKey = rows[0].ulda_key;
    const verified = await uldaVerifier.verify(storedKey, newKey);
    if (!verified) {
      throw new VerificationError("Signature verification failed for update", {
        context: { recordId: id }
      });
    }

    await database.execute("UPDATE main SET ulda_key = ?, content = ? WHERE id = ?", [
      newKey,
      newContent,
      id
    ]);

    trace?.done(200, { recordId: id, contentBytes: newContent.length });
    return { verified: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw wrapDatabaseError(error, "updateRecord", { recordId: id });
  }
}

/**
 * Deletes a record only when the supplied ULDA key verifies as a valid forward transition.
 *
 * @param {CrudRecordPayload} payload Delete payload with record id and ULDA key.
 * @param {TraceLogger|null} [trace] Optional request trace logger.
 * @returns {Promise<CrudHandlerResult>} Delete result.
 */
async function handleDelete(payload, trace) {
  const id = normalizeId(payload.id);
  trace?.step("Deleting record", { recordId: id });
  const key = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");

  try {
    const database = await ensureDbReady();
    const [rows] = await database.execute("SELECT ulda_key FROM main WHERE id = ?", [id]);
    if (!rows.length) {
      throw new NotFoundError(`Record ${id} was not found`, {
        context: { recordId: id }
      });
    }

    const storedKey = rows[0].ulda_key;
    const verified = await uldaVerifier.verify(storedKey, key);
    if (!verified) {
      throw new VerificationError("Signature verification failed for delete", {
        context: { recordId: id }
      });
    }

    await database.execute("DELETE FROM main WHERE id = ?", [id]);
    trace?.done(200, { recordId: id });
    return { deleted: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw wrapDatabaseError(error, "deleteRecord", { recordId: id });
  }
}

function logRequestStart(req) {
  if (!CONFIG.logRequests) return;
  logAtLevel(requestLogger, "debug", "HTTP request started", {
    method: req.method,
    path: req.originalUrl ?? req.url,
    route: req.path,
    ip: req.ip
  });
}

function logRequestCompletion(req, res, startNs) {
  const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warning" : "info";
  logAtLevel(requestLogger, level, "HTTP request completed", {
    method: req.method,
    path: req.originalUrl ?? req.url,
    route: req.route?.path ?? req.path,
    statusCode: res.statusCode,
    durationMs: durationMs(startNs),
    ip: req.ip
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function registerProcessHandlers() {
  if (globalThis.__uldaCrudProcessHandlersRegistered) {
    return;
  }
  globalThis.__uldaCrudProcessHandlersRegistered = true;

  process.on("unhandledRejection", reason => {
    const error = toAppError(reason, { message: "Unhandled promise rejection" });
    logAtLevel(processLogger, "critical", "Unhandled promise rejection", {
      errorId: error.errorId,
      code: error.code,
      context: error.context,
      stack: error.stack
    });
  });

  process.on("uncaughtException", error => {
    const appError = toAppError(error, { message: "Uncaught exception" });
    logAtLevel(processLogger, "critical", "Uncaught exception", {
      errorId: appError.errorId,
      code: appError.code,
      context: appError.context,
      stack: appError.stack
    });
    process.exitCode = 1;
  });
}

/**
 * Creates the HTTP and Socket.IO server pair used by the ULDA CRUD demo application.
 *
 * The returned object exposes the Express app, the underlying HTTP server, the Socket.IO server,
 * and start/stop helpers used by runtime bootstrap or tests.
 *
 * @param {object} [options] Runtime port override.
 * @param {number} [options.port]
 * @returns {CrudServer} Server handles.
 */
function createServer({ port = CONFIG.port } = {}) {
  registerProcessHandlers();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(requestContextMiddleware);

  app.use((req, res, next) => {
    const startNs = process.hrtime.bigint();
    res.locals.requestStartNs = startNs;
    logRequestStart(req);
    res.on("finish", () => logRequestCompletion(req, res, startNs));
    next();
  });

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept-Language,X-Lang");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });

  app.get("/", (req, res) => {
    res.json({
      name: "ulda-crud",
      ok: true,
      requestId: req.requestId,
      endpoints: ["/config", "/records", "/records/:id", "/health", "/browser-test"]
    });
  });

  app.get("/config", (req, res) => {
    res.json({
      originSize: normalizeOriginSize(CONFIG.originSize, 256),
      sign: {
        N: CONFIG.sign.N,
        mode: CONFIG.sign.mode,
        hash: CONFIG.sign.hash
      },
      contentBytes: CONFIG.contentBytes,
      format: "hex",
      contentFormat: "base64",
      logging: {
        level: loggerLevel,
        requests: CONFIG.logRequests,
        logDir
      },
      requestId: req.requestId
    });
  });

  app.get("/health", asyncHandler(async (req, res) => {
    const startedAt = /** @type {bigint} */ (res.locals.requestStartNs ?? process.hrtime.bigint());
    await ensureDbReady();
    res.json({
      ok: true,
      time: new Date().toISOString(),
      durationMs: durationMs(startedAt),
      requestId: req.requestId
    });
  }));

  app.post("/records", asyncHandler(async (req, res) => {
    const startedAt = /** @type {bigint} */ (res.locals.requestStartNs ?? process.hrtime.bigint());
    const trace = createTrace("POST /records", startedAt);
    const response = await handleCreate(req.body ?? {}, trace);
    res.status(201).json({
      ok: true,
      ...response,
      durationMs: durationMs(startedAt),
      requestId: req.requestId
    });
  }));

  app.get("/records/:id", asyncHandler(async (req, res) => {
    const startedAt = /** @type {bigint} */ (res.locals.requestStartNs ?? process.hrtime.bigint());
    const trace = createTrace("GET /records/:id", startedAt);
    const response = await handleRead({
      id: req.params.id,
      format: req.query.format,
      contentFormat: req.query.contentFormat
    }, trace);
    res.json({
      ok: true,
      ...response,
      durationMs: durationMs(startedAt),
      requestId: req.requestId
    });
  }));

  app.put("/records/:id", asyncHandler(async (req, res) => {
    const startedAt = /** @type {bigint} */ (res.locals.requestStartNs ?? process.hrtime.bigint());
    const trace = createTrace("PUT /records/:id", startedAt);
    const response = await handleUpdate({
      id: req.params.id,
      ...req.body
    }, trace);
    res.json({
      ok: true,
      ...response,
      durationMs: durationMs(startedAt),
      requestId: req.requestId
    });
  }));

  app.delete("/records/:id", asyncHandler(async (req, res) => {
    const startedAt = /** @type {bigint} */ (res.locals.requestStartNs ?? process.hrtime.bigint());
    const trace = createTrace("DELETE /records/:id", startedAt);
    const response = await handleDelete({
      id: req.params.id,
      ...req.body
    }, trace);
    res.json({
      ok: true,
      ...response,
      durationMs: durationMs(startedAt),
      requestId: req.requestId
    });
  }));

  app.use("/browser-test", express.static(browserTestDir));

  app.use((req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} was not found`, {
      messageKey: "errors.routeNotFound",
      nextStepKey: "next.checkAddress",
      context: { method: req.method, path: req.originalUrl ?? req.url }
    }));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const appError = toAppError(error, {
      context: { method: req.method, path: req.originalUrl ?? req.url }
    });
    const requestId = req.requestId ?? randomUUID();
    const locale = req.locale ?? res.locals.locale ?? "en";
    const responseBody = createLocalizedErrorBody(appError, locale, requestId);
    const startedAt = /** @type {bigint|undefined} */ (res.locals.requestStartNs);

    logAtLevel(serverLogger, appError.level ?? "error", "Request failed", {
      requestId,
      errorId: appError.errorId,
      code: appError.code,
      method: req.method,
      path: req.originalUrl ?? req.url,
      route: req.route?.path ?? req.path,
      statusCode: appError.status,
      locale,
      durationMs: startedAt ? durationMs(startedAt) : undefined,
      context: appError.context,
      stack: appError.stack
    });

    res.status(appError.status).json({
      ...responseBody,
      durationMs: startedAt ? durationMs(startedAt) : undefined
    });
    return undefined;
  });

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
  });

  async function executeSocketAction(eventName, socket, payload, callback, handler) {
    const requestId = randomUUID();
    const startNs = process.hrtime.bigint();
    return withRequestContext({
      requestId,
      locale: "en",
      method: `socket:${eventName}`,
      path: eventName,
      route: eventName,
      ip: socket.handshake.address
    }, async () => {
      try {
        const trace = createTrace(`socket:${eventName}`, startNs);
        const response = await handler(payload ?? {}, trace);
        const data = {
          ok: true,
          ...response,
          durationMs: durationMs(startNs),
          requestId
        };
        if (typeof callback === "function") callback(data);
        else socket.emit(eventName, data);
        logAtLevel(socketLogger, "info", "Socket operation completed", {
          eventName,
          socketId: socket.id,
          durationMs: durationMs(startNs)
        });
      } catch (error) {
        const appError = toAppError(error, {
          context: { eventName, socketId: socket.id }
        });
        const data = {
          ...createLocalizedErrorBody(appError, "en", requestId),
          durationMs: durationMs(startNs)
        };
        if (typeof callback === "function") callback(data);
        else socket.emit(eventName, data);
        logAtLevel(socketLogger, appError.level ?? "error", "Socket operation failed", {
          eventName,
          socketId: socket.id,
          errorId: appError.errorId,
          code: appError.code,
          durationMs: durationMs(startNs),
          context: appError.context,
          stack: appError.stack
        });
      }
    });
  }

  io.on("connection", socket => {
    logAtLevel(socketLogger, "info", "Socket client connected", {
      socketId: socket.id,
      ip: socket.handshake.address
    });

    socket.on("create", (payload, callback) =>
      executeSocketAction("created", socket, payload, callback, handleCreate)
    );
    socket.on("read", (payload, callback) =>
      executeSocketAction("read", socket, payload, callback, handleRead)
    );
    socket.on("update", (payload, callback) =>
      executeSocketAction("updated", socket, payload, callback, handleUpdate)
    );
    socket.on("delete", (payload, callback) =>
      executeSocketAction("deleted", socket, payload, callback, handleDelete)
    );
    socket.on("disconnect", reason => {
      logAtLevel(socketLogger, "info", "Socket client disconnected", {
        socketId: socket.id,
        reason
      });
    });
  });

  const start = async () => {
    return new Promise(resolve => {
      httpServer.listen(port, () => {
        logAtLevel(serverLogger, "info", "ulda-crud server started", {
          port,
          logLevel: loggerLevel,
          logDir
        });
        ensureDbReady().catch(error => {
          const appError = toAppError(error, { message: "Deferred database initialization failed" });
          logAtLevel(dbLogger, "error", "Deferred database initialization failed", {
            errorId: appError.errorId,
            code: appError.code,
            context: appError.context,
            stack: appError.stack
          });
        });
        resolve({ port });
      });
    });
  };

  const stop = async () => {
    logAtLevel(serverLogger, "info", "ulda-crud server shutdown requested", { port });
    io.close();
    if (httpServer.listening) {
      await new Promise((resolve, reject) => {
        httpServer.close(error => {
          if (!error || /** @type {any} */ (error).code === "ERR_SERVER_NOT_RUNNING") {
            resolve(undefined);
            return;
          }
          reject(error);
        });
      });
    }
    if (pool) {
      await pool.end();
      pool = null;
      dbReadyPromise = null;
    }
    logAtLevel(serverLogger, "info", "ulda-crud server stopped", { port });
  };

  return { app, httpServer, io, start, stop };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { start, stop } = createServer({ port: CONFIG.port });

  const shutdown = signal => {
    logAtLevel(processLogger, "info", "Received shutdown signal", { signal });
    stop()
      .then(() => process.exit(0))
      .catch(error => {
        const appError = toAppError(error, { message: "Shutdown failed" });
        logAtLevel(processLogger, "critical", "Shutdown failed", {
          signal,
          errorId: appError.errorId,
          code: appError.code,
          stack: appError.stack
        });
        process.exit(1);
      });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  start()
    .then(({ port }) => {
      logAtLevel(serverLogger, "info", "Startup endpoints ready", {
        port,
        browserTestUrl: `http://localhost:${port}/browser-test/`,
        healthUrl: `http://localhost:${port}/health`
      });
    })
    .catch(error => {
      const appError = toAppError(error, { message: "Server startup failed" });
      logAtLevel(processLogger, "critical", "Server startup failed", {
        errorId: appError.errorId,
        code: appError.code,
        context: appError.context,
        stack: appError.stack
      });
      process.exit(1);
    });
}

export {
  createServer,
  handleCreate,
  handleRead,
  handleUpdate,
  handleDelete
};
