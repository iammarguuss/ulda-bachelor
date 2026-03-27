import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto, randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import mysql from "mysql2/promise";
import UldaSign from "../../../packages/ulda-sign/ulda-sign.js";

/**
 * @typedef {object} KeeperRecordPayload
 * @property {number|string} [id] Record identifier for read, update, and delete operations.
 * @property {string|Uint8Array|number[]} [ulda_key] ULDA signature/state key.
 * @property {string|Uint8Array|number[]} [uldaKey] Alias for `ulda_key`.
 * @property {string|Uint8Array|number[]} [content] Binary content payload in the selected encoding.
 * @property {"hex"|"base64"|"bytes"} [format] Encoding used for `ulda_key`.
 * @property {"hex"|"base64"|"bytes"} [contentFormat] Encoding used for `content`.
 */

/**
 * @typedef {object} KeeperHandlerResult
 * @property {number} [id]
 * @property {boolean} [verified]
 * @property {boolean} [deleted]
 * @property {number} [status]
 * @property {string} [error]
 * @property {string|number[]|Uint8Array} [ulda_key]
 * @property {string|number[]|Uint8Array} [content]
 * @property {string} [format]
 * @property {string} [contentFormat]
 */

/**
 * Demo password-keeper server built on ULDA verification primitives.
 *
 * Although this application presents a password-keeper style UI, in the repository it serves as a demonstration
 * client/server integration layer for ULDA-based state progression and encrypted content handling.
 */

const exec = promisify(execCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const packagesDir = path.resolve(rootDir, "..", "..", "packages");

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
  port: Number(process.env.PORT ?? 8899),
  jsonLimit: process.env.JSON_LIMIT ?? "16mb",
  originSize: Number(process.env.ORIGIN_SIZE ?? 256),
  sign: {
    N: Number(process.env.SIGN_N ?? 5),
    mode: process.env.SIGN_MODE ?? "S",
    hash: process.env.SIGN_HASH ?? "SHA-256"
  },
  contentBytes: Number(process.env.CONTENT_BYTES ?? 8192),
  maxContentBytes: Number(process.env.MAX_CONTENT_BYTES ?? 8 * 1024 * 1024),
  logRequests: String(process.env.LOG_REQUESTS ?? "true").toLowerCase() === "true",
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "ulda",
    password: process.env.DB_PASSWORD ?? "ulda",
    database: process.env.DB_NAME ?? "ulda_keeper",
    connectionLimit: Number(process.env.DB_POOL_LIMIT ?? 10)
  },
  docker: {
    enable: String(process.env.DB_DOCKER_ENABLE ?? "true").toLowerCase() === "true",
    image: process.env.DB_DOCKER_IMAGE ?? "mysql:8.0",
    container: process.env.DB_DOCKER_CONTAINER ?? "ulda-keeper-mysql",
    volume: process.env.DB_DOCKER_VOLUME ?? "ulda_keeper_mysql",
    rootPassword: process.env.DB_DOCKER_ROOT_PASSWORD ?? "ulda_root"
  }
};

function normalizeOriginSize(value, fallback = 256) {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n % 8 !== 0) {
    throw new Error("originSize must be a positive multiple of 8 (bits)");
  }
  return n;
}

function normalizeFormat(value, fallback = "hex") {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const fmt = String(value).toLowerCase();
  if (fmt === "hex" || fmt === "base64" || fmt === "bytes") return fmt;
  throw new Error("format must be hex, base64, or bytes");
}

function normalizeId(value) {
  const id = Number(value);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    throw new Error("id must be a positive integer");
  }
  return id;
}

function parseBytes(input, format, label) {
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (Array.isArray(input)) return Buffer.from(input);
  if (typeof input !== "string") throw new Error(`${label} must be a string or byte array`);
  const fmt = normalizeFormat(format, "hex");
  const trimmed = input.trim();
  if (fmt === "bytes") throw new Error(`${label} with format=bytes must be an array`);
  if (fmt === "hex") return Buffer.from(trimmed, "hex");
  if (fmt === "base64") return Buffer.from(trimmed, "base64");
  throw new Error(`Unsupported ${label} format`);
}

function encodeBytes(bytes, format) {
  const fmt = normalizeFormat(format, "base64");
  if (fmt === "hex") return Buffer.from(bytes).toString("hex");
  if (fmt === "base64") return Buffer.from(bytes).toString("base64");
  if (fmt === "bytes") return Array.from(Buffer.from(bytes));
  return Buffer.from(bytes).toString("base64");
}

function assertMaxBytes(buffer, maxBytes, label) {
  if (buffer.length > maxBytes) {
    throw new Error(`${label} exceeds MAX_CONTENT_BYTES (${maxBytes})`);
  }
}

function durationMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

function createTrace(label, startNs = process.hrtime.bigint()) {
  let last = startNs;
  const fmt = value => value.toFixed(2);
  const tick = () => {
    const now = process.hrtime.bigint();
    const delta = Number(now - last) / 1e6;
    const total = Number(now - startNs) / 1e6;
    last = now;
    return { delta, total };
  };
  return {
    step(message, extra) {
      const { delta, total } = tick();
      const suffix = extra ? ` | ${extra}` : "";
      console.log(`[${label}] +${fmt(delta)}ms (total ${fmt(total)}ms) ${message}${suffix}`);
    },
    done(status) {
      const { delta, total } = tick();
      console.log(`[${label}] +${fmt(delta)}ms (total ${fmt(total)}ms) done ${status}`);
    },
    error(err) {
      const { delta, total } = tick();
      console.error(
        `[${label}] +${fmt(delta)}ms (total ${fmt(total)}ms) ERROR ${err?.message ?? String(err)}`
      );
    }
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.database]
 */
async function connectOnce({ database } = {}) {
  const pool = mysql.createPool({
    host: CONFIG.db.host,
    port: CONFIG.db.port,
    user: CONFIG.db.user,
    password: CONFIG.db.password,
    database: database ?? CONFIG.db.database,
    connectionLimit: CONFIG.db.connectionLimit,
    enableKeepAlive: true
  });
  await pool.query("SELECT 1");
  return pool;
}

async function ensureDatabaseExists() {
  try {
    return await connectOnce({ database: CONFIG.db.database });
  } catch (err) {
    if (err?.code !== "ER_BAD_DB_ERROR") throw err;
    const conn = await mysql.createConnection({
      host: CONFIG.db.host,
      port: CONFIG.db.port,
      user: CONFIG.db.user,
      password: CONFIG.db.password
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${CONFIG.db.database}\``);
    await conn.end();
    return connectOnce({ database: CONFIG.db.database });
  }
}

async function ensureDockerMysql() {
  const recreateContainer = async () => {
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
  };

  await exec("docker --version");
  const { stdout } = await exec(
    `docker ps -a --filter "name=^/${CONFIG.docker.container}$" --format "{{.Names}}"`
  );
  if (stdout.trim()) {
    try {
      await exec(`docker start ${CONFIG.docker.container}`);
    } catch {
      // no-op, start may fail if it is already running.
    }

    // Existing container may have been created earlier without host port binding.
    // In that case, backend gets ECONNREFUSED on 127.0.0.1:<DB_PORT>.
    const { stdout: portStdout } = await exec(
      `docker port ${CONFIG.docker.container} 3306/tcp`
    ).catch(() => ({ stdout: "" }));
    const expectedPort = String(CONFIG.db.port);
    const hasExpectedPort = portStdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .some(line => line.endsWith(`:${expectedPort}`));

    if (!hasExpectedPort) {
      await exec(`docker rm -f ${CONFIG.docker.container}`);
      await recreateContainer();
    }
    return;
  }
  await recreateContainer();
}

async function connectWithDockerFallback() {
  try {
    return await ensureDatabaseExists();
  } catch (err) {
    if (!CONFIG.docker.enable) throw err;
    await ensureDockerMysql();
    const maxAttempts = 20;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await ensureDatabaseExists();
      } catch (retryErr) {
        if (attempt === maxAttempts) throw retryErr;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    throw err;
  }
}

let pool;
const dbReady = (async () => {
  pool = await connectWithDockerFallback();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS main (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ulda_key BLOB NOT NULL,
      content LONGBLOB NOT NULL
    ) ENGINE=InnoDB`
  );
})();
dbReady.catch(err => {
  console.error("DB init failed:", err?.message ?? String(err));
});

const uldaVerifier = new UldaSign({
  fmt: { export: "bytes" },
  sign: { originSize: normalizeOriginSize(CONFIG.originSize, 256) }
});

/**
 * Creates a new ULDA-backed record.
 *
 * @param {KeeperRecordPayload} payload Incoming create payload.
 * @param {{ step: Function, error: Function }|null} [trace] Optional request trace logger.
 * @returns {Promise<KeeperHandlerResult>} Created record result.
 */
async function handleCreate(payload, trace) {
  trace?.step("parse payload");
  const key = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  const content = parseBytes(payload.content, payload.contentFormat ?? "base64", "content");
  assertMaxBytes(content, CONFIG.maxContentBytes, "content");
  trace?.step("db insert", `keyBytes=${key.length} contentBytes=${content.length}`);
  const [result] = await pool.execute("INSERT INTO main (ulda_key, content) VALUES (?, ?)", [
    key,
    content
  ]);
  return { id: result.insertId };
}

/**
 * Reads a stored ULDA-backed record and encodes it for the requested transport format.
 *
 * @param {KeeperRecordPayload} payload Read payload.
 * @param {{ step: Function, error: Function }|null} [trace] Optional request trace logger.
 * @returns {Promise<KeeperHandlerResult>} Read response or `{ status, error }`.
 */
async function handleRead(payload, trace) {
  const id = normalizeId(payload.id);
  const format = payload.format ?? "base64";
  const contentFormat = payload.contentFormat ?? "base64";
  trace?.step("db select", `id=${id}`);
  const [rows] = await pool.execute("SELECT id, ulda_key, content FROM main WHERE id = ?", [id]);
  if (!rows.length) return { error: "not found", status: 404 };
  const row = rows[0];
  return {
    id: row.id,
    ulda_key: encodeBytes(row.ulda_key, format),
    content: encodeBytes(row.content, contentFormat),
    format: normalizeFormat(format, "base64"),
    contentFormat: normalizeFormat(contentFormat, "base64")
  };
}

/**
 * Updates an existing record after ULDA forward-verification succeeds.
 *
 * @param {KeeperRecordPayload} payload Update payload.
 * @param {{ step: Function, error: Function }|null} [trace] Optional request trace logger.
 * @returns {Promise<KeeperHandlerResult>} Update result or `{ status, error }`.
 */
async function handleUpdate(payload, trace) {
  const id = normalizeId(payload.id);
  trace?.step("parse payload", `id=${id}`);
  const newKey = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  const newContent = parseBytes(payload.content, payload.contentFormat ?? "base64", "content");
  assertMaxBytes(newContent, CONFIG.maxContentBytes, "content");
  trace?.step("db select current key");
  const [rows] = await pool.execute("SELECT ulda_key FROM main WHERE id = ?", [id]);
  if (!rows.length) return { error: "not found", status: 404 };
  const storedKey = rows[0].ulda_key;
  trace?.step("verify signature");
  const verified = await uldaVerifier.verify(storedKey, newKey);
  if (!verified) return { error: "signature verification failed", status: 400 };
  trace?.step("db update");
  await pool.execute("UPDATE main SET ulda_key = ?, content = ? WHERE id = ?", [
    newKey,
    newContent,
    id
  ]);
  return { verified: true };
}

/**
 * Deletes an existing record after ULDA forward-verification succeeds.
 *
 * @param {KeeperRecordPayload} payload Delete payload.
 * @param {{ step: Function, error: Function }|null} [trace] Optional request trace logger.
 * @returns {Promise<KeeperHandlerResult>} Delete result or `{ status, error }`.
 */
async function handleDelete(payload, trace) {
  const id = normalizeId(payload.id);
  trace?.step("parse payload", `id=${id}`);
  const key = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  trace?.step("db select current key");
  const [rows] = await pool.execute("SELECT ulda_key FROM main WHERE id = ?", [id]);
  if (!rows.length) return { error: "not found", status: 404 };
  const storedKey = rows[0].ulda_key;
  trace?.step("verify signature");
  const verified = await uldaVerifier.verify(storedKey, key);
  if (!verified) return { error: "signature verification failed", status: 400 };
  trace?.step("db delete");
  await pool.execute("DELETE FROM main WHERE id = ?", [id]);
  return { deleted: true };
}

/**
 * Creates the HTTP and Socket.IO server used by the example password-keeper demo.
 *
 * @param {object} [options] Runtime port override.
 * @param {number} [options.port]
 * @returns {object} Server handles.
 */
function createServer({ port = CONFIG.port } = {}) {
  const app = express();
  app.use(express.json({ limit: CONFIG.jsonLimit }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });

  app.get("/api", (req, res) => {
    res.json({
      name: "example-password-keeper-server",
      ok: true,
      endpoints: ["/config", "/records", "/records/:id", "/health", "/", "/packages"]
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
      contentFormat: "base64"
    });
  });

  app.get("/health", async (req, res) => {
    const t0 = process.hrtime.bigint();
    const trace = CONFIG.logRequests ? createTrace("GET /health", t0) : null;
    try {
      await dbReady;
      res.json({ ok: true, time: new Date().toISOString(), durationMs: durationMs(t0) });
      trace?.done(200);
    } catch (err) {
      trace?.error(err);
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  app.post("/client-logs", (req, res) => {
    const requestId = randomUUID();
    const payload = {
      type: typeof req.body?.type === "string" ? req.body.type.slice(0, 64) : "unknown",
      message: typeof req.body?.message === "string" ? req.body.message.slice(0, 500) : "no-message",
      source: typeof req.body?.source === "string" ? req.body.source.slice(0, 300) : null,
      line: Number.isFinite(Number(req.body?.line)) ? Number(req.body.line) : null,
      column: Number.isFinite(Number(req.body?.column)) ? Number(req.body.column) : null,
      page: typeof req.body?.page === "string" ? req.body.page.slice(0, 300) : null
    };

    console.warn("[client-log]", JSON.stringify({
      requestId,
      app: "example-password-keeper",
      ...payload
    }));

    res.status(202).json({
      ok: true,
      requestId
    });
  });

  app.post("/records", async (req, res) => {
    const t0 = process.hrtime.bigint();
    const trace = CONFIG.logRequests ? createTrace("POST /records", t0) : null;
    try {
      await dbReady;
      const response = await handleCreate(req.body ?? {}, trace);
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      trace?.error(err);
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.get("/records/:id", async (req, res) => {
    const t0 = process.hrtime.bigint();
    const trace = CONFIG.logRequests ? createTrace("GET /records/:id", t0) : null;
    try {
      await dbReady;
      const response = await handleRead({
        id: req.params.id,
        format: req.query.format,
        contentFormat: req.query.contentFormat
      }, trace);
      if (response.status === 404) {
        return res.status(404).json({ ok: false, error: response.error, durationMs: durationMs(t0) });
      }
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      trace?.error(err);
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.put("/records/:id", async (req, res) => {
    const t0 = process.hrtime.bigint();
    const trace = CONFIG.logRequests ? createTrace("PUT /records/:id", t0) : null;
    try {
      await dbReady;
      const response = await handleUpdate({ id: req.params.id, ...req.body }, trace);
      if (response.status === 404) {
        return res.status(404).json({ ok: false, error: response.error, durationMs: durationMs(t0) });
      }
      if (response.status === 400) {
        return res.status(400).json({ ok: false, error: response.error, durationMs: durationMs(t0) });
      }
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      trace?.error(err);
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.delete("/records/:id", async (req, res) => {
    const t0 = process.hrtime.bigint();
    const trace = CONFIG.logRequests ? createTrace("DELETE /records/:id", t0) : null;
    try {
      await dbReady;
      const response = await handleDelete({ id: req.params.id, ...req.body }, trace);
      if (response.status === 404) {
        return res.status(404).json({ ok: false, error: response.error, durationMs: durationMs(t0) });
      }
      if (response.status === 400) {
        return res.status(400).json({ ok: false, error: response.error, durationMs: durationMs(t0) });
      }
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      trace?.error(err);
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.use("/packages", express.static(packagesDir));
  app.use("/", express.static(publicDir));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
  });

  io.on("connection", socket => {
    socket.on("create", async (payload, cb) => {
      const t0 = process.hrtime.bigint();
      const trace = CONFIG.logRequests ? createTrace("socket:create", t0) : null;
      try {
        await dbReady;
        const response = await handleCreate(payload ?? {}, trace);
        const data = { ok: true, ...response, durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("created", data);
      } catch (err) {
        trace?.error(err);
        const data = { ok: false, error: err?.message ?? String(err), durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("created", data);
      }
    });

    socket.on("read", async (payload, cb) => {
      const t0 = process.hrtime.bigint();
      const trace = CONFIG.logRequests ? createTrace("socket:read", t0) : null;
      try {
        await dbReady;
        const response = await handleRead(payload ?? {}, trace);
        if (response.status) {
          const data = { ok: false, error: response.error, durationMs: durationMs(t0) };
          if (typeof cb === "function") cb(data);
          else socket.emit("read", data);
          return;
        }
        const data = { ok: true, ...response, durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("read", data);
      } catch (err) {
        trace?.error(err);
        const data = { ok: false, error: err?.message ?? String(err), durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("read", data);
      }
    });

    socket.on("update", async (payload, cb) => {
      const t0 = process.hrtime.bigint();
      const trace = CONFIG.logRequests ? createTrace("socket:update", t0) : null;
      try {
        await dbReady;
        const response = await handleUpdate(payload ?? {}, trace);
        if (response.status) {
          const data = { ok: false, error: response.error, durationMs: durationMs(t0) };
          if (typeof cb === "function") cb(data);
          else socket.emit("updated", data);
          return;
        }
        const data = { ok: true, ...response, durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("updated", data);
      } catch (err) {
        trace?.error(err);
        const data = { ok: false, error: err?.message ?? String(err), durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("updated", data);
      }
    });

    socket.on("delete", async (payload, cb) => {
      const t0 = process.hrtime.bigint();
      const trace = CONFIG.logRequests ? createTrace("socket:delete", t0) : null;
      try {
        await dbReady;
        const response = await handleDelete(payload ?? {}, trace);
        if (response.status) {
          const data = { ok: false, error: response.error, durationMs: durationMs(t0) };
          if (typeof cb === "function") cb(data);
          else socket.emit("deleted", data);
          return;
        }
        const data = { ok: true, ...response, durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("deleted", data);
      } catch (err) {
        trace?.error(err);
        const data = { ok: false, error: err?.message ?? String(err), durationMs: durationMs(t0) };
        if (typeof cb === "function") cb(data);
        else socket.emit("deleted", data);
      }
    });
  });

  const start = () =>
    new Promise(resolve => {
      httpServer.listen(port, () => resolve({ port }));
    });

  const stop = () =>
    new Promise((resolve, reject) => {
      httpServer.close(err => (err ? reject(err) : resolve()));
    });

  return { app, httpServer, io, start, stop };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { start } = createServer({ port: CONFIG.port });
  start().then(({ port }) => {
    console.log(`password-keeper demo server listening on http://localhost:${port}`);
    console.log(`UI: http://localhost:${port}/`);
  });
}

export {
  createServer,
  handleCreate,
  handleRead,
  handleUpdate,
  handleDelete
};
