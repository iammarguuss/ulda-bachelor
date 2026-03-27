import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import UldaSign from "../../../packages/ulda-sign/ulda-sign.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const artifactsDir = path.resolve(appRoot, "../../artifacts/performance");
const serverEntry = path.join(appRoot, "scripts", "profile-server-entry.js");

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
const label = readArgValue(args, "--label") ?? "baseline-large";
const outPath = readArgValue(args, "--out");
const scenario = { name: "profile-large", clients: 150, updatesPerClient: 12, contentBytes: 4096, port: 8910 };

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
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
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    const message = json?.error ?? `HTTP ${response.status}`;
    throw new Error(`${method} ${route} failed: ${message}`);
  }
  return json;
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Retry until the server is up.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server at ${baseUrl} did not become healthy in time`);
}

function startProfiledServer(port, profileName) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const child = spawn(process.execPath, [
    "--cpu-prof",
    "--cpu-prof-interval=500",
    `--cpu-prof-dir=${artifactsDir}`,
    `--cpu-prof-name=${profileName}`,
    serverEntry
  ], {
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

function extractHotspots(cpuProfile) {
  const nodesById = new Map(cpuProfile.nodes.map(node => [node.id, node]));
  const parentById = new Map();

  for (const node of cpuProfile.nodes) {
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id);
    }
  }

  const inclusiveCounts = new Map();
  for (const sampleNodeId of cpuProfile.samples ?? []) {
    let currentId = sampleNodeId;
    while (currentId) {
      inclusiveCounts.set(currentId, (inclusiveCounts.get(currentId) ?? 0) + 1);
      currentId = parentById.get(currentId);
    }
  }

  const totalSamples = (cpuProfile.samples ?? []).length;
  return [...inclusiveCounts.entries()]
    .map(([id, sampleCount]) => ({ node: nodesById.get(id), sampleCount }))
    .filter(entry => {
      const functionName = entry.node?.callFrame.functionName || "(anonymous)";
      const url = entry.node?.callFrame.url ?? "";
      return entry.node &&
        sampleCountAboveZero(entry.sampleCount) &&
        !functionName.includes("(idle)") &&
        !url.includes("node:internal") &&
        !url.startsWith("node:");
    })
    .sort((left, right) => right.sampleCount - left.sampleCount)
    .slice(0, 12)
    .map(entry => ({
      functionName: entry.node.callFrame.functionName || "(anonymous)",
      url: entry.node.callFrame.url,
      lineNumber: entry.node.callFrame.lineNumber + 1,
      sampleCount: entry.sampleCount,
      sharePercent: Number(((entry.sampleCount / totalSamples) * 100).toFixed(2))
    }));
}

function sampleCountAboveZero(sampleCount) {
  return sampleCount > 0;
}

async function runProfileScenario() {
  const baseUrl = `http://127.0.0.1:${scenario.port}`;
  const profileName = `${label}.cpuprofile`;
  const profiledServer = startProfiledServer(scenario.port, profileName);

  try {
    await waitForHealth(baseUrl);
    const config = await jsonRequest(baseUrl, "/config");
    const signCfg = {
      ...config.sign,
      originSize: config.originSize
    };

    await Promise.all(
      Array.from({ length: scenario.clients }, (_, index) =>
        runClient(index + 1, scenario, signCfg, baseUrl)
      )
    );
    await new Promise(resolve => setTimeout(resolve, 1000));
  } finally {
    await stopServer(profiledServer.child);
  }

  const profilePath = path.join(artifactsDir, profileName);
  const cpuProfile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  return {
    label,
    profilePath,
    hotspots: extractHotspots(cpuProfile)
  };
}

async function runClient(clientId, scenarioConfig, signCfg, baseUrl) {
  const signer = new UldaSign({
    fmt: { export: "base64" },
    sign: {
      N: signCfg.N,
      mode: signCfg.mode,
      hash: signCfg.hash,
      originSize: signCfg.originSize
    }
  });

  let state = signer.New(BigInt(clientId) * 1000000n);
  let signature = await signer.sign(state);
  const created = await jsonRequest(baseUrl, "/records", {
    method: "POST",
    body: {
      ulda_key: signature,
      content: createDeterministicBase64(scenarioConfig.contentBytes, clientId),
      format: "base64",
      contentFormat: "base64"
    }
  });

  const id = created.id;
  for (let updateIndex = 0; updateIndex < scenarioConfig.updatesPerClient; updateIndex += 1) {
    state = signer.stepUp(state);
    signature = await signer.sign(state);
    await jsonRequest(baseUrl, `/records/${id}`, {
      method: "PUT",
      body: {
        ulda_key: signature,
        content: createDeterministicBase64(scenarioConfig.contentBytes, clientId + updateIndex + 1),
        format: "base64",
        contentFormat: "base64"
      }
    });
    if (updateIndex === 0 || updateIndex === scenarioConfig.updatesPerClient - 1) {
      await jsonRequest(baseUrl, `/records/${id}?format=base64&contentFormat=base64`);
    }
  }

  state = signer.stepUp(state);
  signature = await signer.sign(state);
  await jsonRequest(baseUrl, `/records/${id}`, {
    method: "DELETE",
    body: {
      ulda_key: signature,
      format: "base64"
    }
  });
}

async function main() {
  const result = await runProfileScenario();
  const json = `${JSON.stringify(result, null, 2)}\n`;
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
