import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import UldaSign from "../../../packages/ulda-sign/ulda-sign.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const serverEntry = path.join(appRoot, "src", "server.js");

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

const args = process.argv.slice(2);
const label = readArgValue(args, "--label") ?? "baseline";
const outPath = readArgValue(args, "--out");

const scenarios = [
  { name: "small", clients: 10, updatesPerClient: 1, contentBytes: 32, port: 8901 },
  { name: "medium", clients: 25, updatesPerClient: 3, contentBytes: 256, port: 8902 },
  { name: "large", clients: 50, updatesPerClient: 5, contentBytes: 2048, port: 8903 }
];

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[index];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createDeterministicBase64(byteLength, seed) {
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (seed + index * 17) % 256;
  }
  return Buffer.from(bytes).toString("base64");
}

/**
 * @param {string} baseUrl
 * @param {string} route
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function jsonRequest(baseUrl, route, { method = "GET", body } = {}) {
  const startedAt = process.hrtime.bigint();
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const duration = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    const message = json?.error ?? `HTTP ${response.status}`;
    throw new Error(`${method} ${route} failed: ${message}`);
  }
  return { json, duration };
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Retry until deadline.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server at ${baseUrl} did not become healthy in time`);
}

function startServer(port) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", chunk => stdout.push(String(chunk)));
  child.stderr.on("data", chunk => stderr.push(String(chunk)));

  return {
    child,
    getLogs() {
      return {
        stdout: stdout.join(""),
        stderr: stderr.join("")
      };
    }
  };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

async function runScenario(scenario) {
  const baseUrl = `http://127.0.0.1:${scenario.port}`;
  const server = startServer(scenario.port);
  try {
    await waitForHealth(baseUrl);
    const initialStats = await fetch(`${baseUrl}/stats`).then(response => response.json());
    const config = await fetch(`${baseUrl}/config`).then(response => response.json());
    const latencies = [];
    const methodDurations = {
      POST: [],
      GET: [],
      PUT: [],
      DELETE: []
    };

    const signCfg = {
      ...config.sign,
      originSize: config.originSize
    };

    const scenarioStartedAt = process.hrtime.bigint();
    const clientResults = await Promise.allSettled(
      Array.from({ length: scenario.clients }, (_, index) =>
        runClient(index + 1, scenario, signCfg, baseUrl, latencies, methodDurations)
      )
    );
    const scenarioDurationMs = Number(process.hrtime.bigint() - scenarioStartedAt) / 1e6;
    const finalStats = await fetch(`${baseUrl}/stats`).then(response => response.json());

    const failedClients = clientResults.filter(result => result.status === "rejected");
    const successfulClients = scenario.clients - failedClients.length;
    const sortedLatencies = [...latencies].sort((left, right) => left - right);
    const totalRequests = latencies.length;

    return {
      name: scenario.name,
      clients: scenario.clients,
      updatesPerClient: scenario.updatesPerClient,
      contentBytes: scenario.contentBytes,
      totalRequests,
      successfulClients,
      failedClients: failedClients.length,
      durationMs: Number(scenarioDurationMs.toFixed(2)),
      throughputRps: Number((totalRequests / (scenarioDurationMs / 1000)).toFixed(2)),
      latencyMs: {
        average: Number(average(sortedLatencies).toFixed(3)),
        p50: Number(percentile(sortedLatencies, 50).toFixed(3)),
        p95: Number(percentile(sortedLatencies, 95).toFixed(3)),
        max: Number((sortedLatencies.at(-1) ?? 0).toFixed(3))
      },
      perMethodAverageMs: Object.fromEntries(
        Object.entries(methodDurations).map(([method, values]) => [
          method,
          Number(average(values).toFixed(3))
        ])
      ),
      memory: {
        before: initialStats.memory,
        after: finalStats.memory,
        deltaHeapUsed: finalStats.memory.heapUsed - initialStats.memory.heapUsed
      },
      profiling: finalStats.profiling,
      recordsAfterScenario: finalStats.recordsInMemory
    };
  } finally {
    await stopServer(server.child);
  }
}

async function runClient(clientId, scenario, signCfg, baseUrl, latencies, methodDurations) {
  const signer = new UldaSign({
    fmt: { export: "base64" },
    sign: {
      N: signCfg.N,
      mode: signCfg.mode,
      hash: signCfg.hash,
      originSize: signCfg.originSize
    }
  });

  const baseIndex = BigInt(clientId) * 1000000n;
  let state = signer.New(baseIndex);
  let signature = await signer.sign(state);

  const created = await jsonRequest(baseUrl, "/records", {
    method: "POST",
    body: {
      ulda_key: signature,
      content: createDeterministicBase64(scenario.contentBytes, clientId),
      format: "base64",
      contentFormat: "base64"
    }
  });
  latencies.push(created.duration);
  methodDurations.POST.push(created.duration);
  const id = created.json.id;

  for (let updateIndex = 0; updateIndex < scenario.updatesPerClient; updateIndex += 1) {
    state = signer.stepUp(state);
    signature = await signer.sign(state);

    const updated = await jsonRequest(baseUrl, `/records/${id}`, {
      method: "PUT",
      body: {
        ulda_key: signature,
        content: createDeterministicBase64(scenario.contentBytes, clientId + updateIndex + 1),
        format: "base64",
        contentFormat: "base64"
      }
    });
    latencies.push(updated.duration);
    methodDurations.PUT.push(updated.duration);

    if (updateIndex === 0 || updateIndex === scenario.updatesPerClient - 1) {
      const read = await jsonRequest(
        baseUrl,
        `/records/${id}?format=base64&contentFormat=base64`
      );
      latencies.push(read.duration);
      methodDurations.GET.push(read.duration);
    }
  }

  state = signer.stepUp(state);
  signature = await signer.sign(state);
  const deleted = await jsonRequest(baseUrl, `/records/${id}`, {
    method: "DELETE",
    body: {
      ulda_key: signature,
      format: "base64"
    }
  });
  latencies.push(deleted.duration);
  methodDurations.DELETE.push(deleted.duration);
}

async function main() {
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  const output = {
    label,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    scenarios: results
  };

  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (outPath) {
    const resolvedOutPath = path.resolve(appRoot, outPath);
    fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
    fs.writeFileSync(resolvedOutPath, json);
  }
  process.stdout.write(json);
}

main().catch(error => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
