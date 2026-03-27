import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import UldaSign from "../../../packages/ulda-sign/ulda-sign.js";

/**
 * @typedef {object} SpeedTestPayload
 * @property {number|string} [id] Record identifier for read, update, and delete operations.
 * @property {string|Uint8Array|number[]} [ulda_key] ULDA signature/state key.
 * @property {string|Uint8Array|number[]} [uldaKey] Alias for `ulda_key`.
 * @property {string|Uint8Array|number[]} [content] Binary content payload in the selected encoding.
 * @property {"hex"|"base64"|"bytes"} [format] Encoding used for `ulda_key`.
 * @property {"hex"|"base64"|"bytes"} [contentFormat] Encoding used for `content`.
 */

/**
 * In-memory ULDA speed-test server used for HTTP stress experiments.
 *
 * This server intentionally trades persistence for startup speed by storing records in memory only.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const browserTestDir = path.join(rootDir, "browser-test");

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
  originSize: Number(process.env.ORIGIN_SIZE ?? 256),
  sign: {
    N: Number(process.env.SIGN_N ?? 5),
    mode: process.env.SIGN_MODE ?? "S",
    hash: process.env.SIGN_HASH ?? "SHA-256"
  },
  contentBytes: Number(process.env.CONTENT_BYTES ?? 32)
};
const BASE64_CACHE_MAX_BYTES = 512;

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
  const startedAt = process.hrtime.bigint();
  try {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) {
      return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    }
    if (Array.isArray(input)) return Buffer.from(input);
    if (typeof input !== "string") {
      throw new Error(`${label} must be a string or byte array`);
    }
    const trimmed = input[0] === " " || input.at(-1) === " " ? input.trim() : input;
    const fmt =
      format === null || typeof format === "undefined" || format === "" ? "hex" :
      format === "hex" || format === "base64" || format === "bytes" ? format :
      normalizeFormat(format, "hex");
    if (fmt === "bytes") {
      throw new Error(`${label} with format=bytes must be an array`);
    }
    if (fmt === "hex") return Buffer.from(trimmed, "hex");
    if (fmt === "base64") return Buffer.from(trimmed, "base64");
    throw new Error(`Unsupported ${label} format`);
  } finally {
    recordProfileMetric("parseBytes", startedAt);
  }
}

function encodeBytes(bytes, format) {
  const startedAt = process.hrtime.bigint();
  try {
    const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const fmt =
      format === null || typeof format === "undefined" || format === "" ? "base64" :
      format === "hex" || format === "base64" || format === "bytes" ? format :
      normalizeFormat(format, "base64");
    if (fmt === "hex") return source.toString("hex");
    if (fmt === "base64") return source.toString("base64");
    if (fmt === "bytes") return Array.from(source);
    return source.toString("base64");
  } finally {
    recordProfileMetric("encodeBytes", startedAt);
  }
}

function durationMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

const store = new Map();
let nextId = 1;
const profiling = {
  parseBytes: { calls: 0, totalNs: 0n },
  encodeBytes: { calls: 0, totalNs: 0n },
  verify: { calls: 0, totalNs: 0n },
  storeRead: { calls: 0, totalNs: 0n },
  storeWrite: { calls: 0, totalNs: 0n }
};

function recordProfileMetric(metric, startedAt) {
  profiling[metric].calls += 1;
  profiling[metric].totalNs += process.hrtime.bigint() - startedAt;
}

function profilingSnapshot() {
  return Object.fromEntries(
    Object.entries(profiling).map(([name, metric]) => [
      name,
      {
        calls: metric.calls,
        totalMs: Number(metric.totalNs) / 1e6,
        averageMs: metric.calls ? Number(metric.totalNs) / 1e6 / metric.calls : 0
      }
    ])
  );
}

function maybeCacheBase64(buffer) {
  return buffer.length <= BASE64_CACHE_MAX_BYTES ? buffer.toString("base64") : null;
}

const uldaVerifier = new UldaSign({
  fmt: { export: "bytes" },
  sign: { originSize: normalizeOriginSize(CONFIG.originSize, 256) }
});

function importSignature(signature) {
  return uldaVerifier.actions.import.signature(signature);
}

async function verifyTransition(row, candidateKey) {
  const currentSignature = row.parsedKey ?? importSignature(row.ulda_key);
  const nextSignature = importSignature(candidateKey);

  if (
    currentSignature.N !== nextSignature.N ||
    currentSignature.mode !== nextSignature.mode ||
    currentSignature.alg !== nextSignature.alg
  ) {
    return { verified: false, nextSignature };
  }

  const verified =
    currentSignature.mode === "S" ? await uldaVerifier.actions.VerifyS(currentSignature, nextSignature) :
    currentSignature.mode === "X" ? await uldaVerifier.actions.VerifyX(currentSignature, nextSignature) :
    false;

  return { verified, nextSignature };
}

/**
 * Creates an in-memory record for benchmark and stress-test scenarios.
 *
 * @param {SpeedTestPayload} payload Incoming create payload.
 * @returns {Promise<{ id: number }>} Created record id.
 */
async function handleCreate(payload) {
  const key = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  const content = parseBytes(payload.content, payload.contentFormat ?? "base64", "content");
  const id = nextId++;
  const startedAt = process.hrtime.bigint();
  store.set(id, {
    id,
    ulda_key: key,
    content,
    parsedKey: importSignature(key),
    ulda_key_b64: key.toString("base64"),
    content_b64: maybeCacheBase64(content)
  });
  recordProfileMetric("storeWrite", startedAt);
  return { id };
}

/**
 * Reads an in-memory record and encodes the response in the requested formats.
 *
 * @param {SpeedTestPayload} payload Read payload.
 * @returns {Promise<object>} Read response or `{ status, error }`.
 */
async function handleRead(payload) {
  const id = normalizeId(payload.id);
  const startedAt = process.hrtime.bigint();
  const row = store.get(id);
  recordProfileMetric("storeRead", startedAt);
  if (!row) return { status: 404, error: "not found" };
  const format = payload.format ?? "base64";
  const contentFormat = payload.contentFormat ?? "base64";
  const normalizedFormat = format === "base64" ? "base64" : normalizeFormat(format, "base64");
  const normalizedContentFormat =
    contentFormat === "base64" ? "base64" : normalizeFormat(contentFormat, "base64");
  return {
    id: row.id,
    ulda_key: normalizedFormat === "base64" ? row.ulda_key_b64 : encodeBytes(row.ulda_key, normalizedFormat),
    content:
      normalizedContentFormat === "base64" && row.content_b64 !== null ?
        row.content_b64 :
        encodeBytes(row.content, normalizedContentFormat),
    format: normalizedFormat,
    contentFormat: normalizedContentFormat
  };
}

/**
 * Updates an in-memory record after ULDA forward-verification succeeds.
 *
 * @param {SpeedTestPayload} payload Update payload.
 * @returns {Promise<object>} Update result or `{ status, error }`.
 */
async function handleUpdate(payload) {
  const id = normalizeId(payload.id);
  const readStartedAt = process.hrtime.bigint();
  const row = store.get(id);
  recordProfileMetric("storeRead", readStartedAt);
  if (!row) return { status: 404, error: "not found" };

  const newKey = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  const newContent = parseBytes(payload.content, payload.contentFormat ?? "base64", "content");

  const verifyStartedAt = process.hrtime.bigint();
  const { verified, nextSignature } = await verifyTransition(row, newKey);
  recordProfileMetric("verify", verifyStartedAt);
  if (!verified) return { status: 400, error: "signature verification failed" };

  const writeStartedAt = process.hrtime.bigint();
  row.ulda_key = newKey;
  row.content = newContent;
  row.parsedKey = nextSignature;
  row.ulda_key_b64 = newKey.toString("base64");
  row.content_b64 = maybeCacheBase64(newContent);
  recordProfileMetric("storeWrite", writeStartedAt);
  return { verified: true };
}

/**
 * Deletes an in-memory record after ULDA forward-verification succeeds.
 *
 * @param {SpeedTestPayload} payload Delete payload.
 * @returns {Promise<object>} Delete result or `{ status, error }`.
 */
async function handleDelete(payload) {
  const id = normalizeId(payload.id);
  const readStartedAt = process.hrtime.bigint();
  const row = store.get(id);
  recordProfileMetric("storeRead", readStartedAt);
  if (!row) return { status: 404, error: "not found" };

  const key = parseBytes(payload.ulda_key ?? payload.uldaKey, payload.format, "ulda_key");
  const verifyStartedAt = process.hrtime.bigint();
  const { verified } = await verifyTransition(row, key);
  recordProfileMetric("verify", verifyStartedAt);
  if (!verified) return { status: 400, error: "signature verification failed" };

  const writeStartedAt = process.hrtime.bigint();
  store.delete(id);
  recordProfileMetric("storeWrite", writeStartedAt);
  return { deleted: true };
}

/**
 * Creates the HTTP server used by the in-memory speed-test application.
 *
 * @param {object} [options] Runtime port override.
 * @param {number} [options.port]
 * @returns {object} Server handles.
 */
function createServer({ port = CONFIG.port } = {}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (req, res) => {
    res.json({
      name: "max_speed_test_server",
      ok: true,
      endpoints: ["/config", "/records", "/records/:id", "/health", "/stats", "/browser-test"]
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
      format: "base64",
      contentFormat: "base64"
    });
  });

  app.get("/health", (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get("/stats", (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      ok: true,
      recordsInMemory: store.size,
      nextId,
      profiling: profilingSnapshot(),
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers
      }
    });
  });

  app.post("/records", async (req, res) => {
    const t0 = process.hrtime.bigint();
    try {
      const response = await handleCreate(req.body ?? {});
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.get("/records/:id", async (req, res) => {
    const t0 = process.hrtime.bigint();
    try {
      const response = await handleRead({
        id: req.params.id,
        format: req.query.format,
        contentFormat: req.query.contentFormat
      });
      if (response.status === 404) {
        return res.status(404).json({ ok: false, error: response.error, durationMs: durationMs(t0) });
      }
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.put("/records/:id", async (req, res) => {
    const t0 = process.hrtime.bigint();
    try {
      const response = await handleUpdate({
        id: req.params.id,
        ...req.body
      });
      if (response.status) {
        return res.status(response.status).json({
          ok: false,
          error: response.error,
          durationMs: durationMs(t0)
        });
      }
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.delete("/records/:id", async (req, res) => {
    const t0 = process.hrtime.bigint();
    try {
      const response = await handleDelete({
        id: req.params.id,
        ...req.body
      });
      if (response.status) {
        return res.status(response.status).json({
          ok: false,
          error: response.error,
          durationMs: durationMs(t0)
        });
      }
      return res.json({ ok: true, ...response, durationMs: durationMs(t0) });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: err?.message ?? String(err),
        durationMs: durationMs(t0)
      });
    }
  });

  app.use("/browser-test", express.static(browserTestDir));

  const httpServer = http.createServer(app);
  const start = () =>
    new Promise(resolve => {
      httpServer.listen(port, () => resolve({ port }));
    });
  const stop = () =>
    new Promise((resolve, reject) => {
      httpServer.close(err => (err ? reject(err) : resolve()));
    });

  return { app, httpServer, start, stop };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { start } = createServer({ port: CONFIG.port });
  start().then(({ port }) => {
    console.log(`max_speed_test_server listening on http://localhost:${port}`);
    console.log("Browser test: http://localhost:8899/browser-test/");
    console.log(`source: ${path.resolve(__dirname)}`);
  });
}

export {
  createServer,
  handleCreate,
  handleRead,
  handleUpdate,
  handleDelete
};
