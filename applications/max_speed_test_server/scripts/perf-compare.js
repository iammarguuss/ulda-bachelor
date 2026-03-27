import fs from "node:fs";
import path from "node:path";

const [baselinePathArg, optimizedPathArg, outPathArg] = process.argv.slice(2);

if (!baselinePathArg || !optimizedPathArg || !outPathArg) {
  console.error("Usage: node scripts/perf-compare.js <baseline.json> <optimized.json> <out.json>");
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function improvement(before, after) {
  if (!before) return 0;
  return Number((((before - after) / before) * 100).toFixed(2));
}

const baseline = readJson(baselinePathArg);
const optimized = readJson(optimizedPathArg);

const comparison = baseline.scenarios.map((baselineScenario, index) => {
  const optimizedScenario = optimized.scenarios[index];
  return {
    scenario: baselineScenario.name,
    latencyAverageMs: {
      before: baselineScenario.latencyMs.average,
      after: optimizedScenario.latencyMs.average,
      improvementPercent: improvement(
        baselineScenario.latencyMs.average,
        optimizedScenario.latencyMs.average
      )
    },
    latencyP95Ms: {
      before: baselineScenario.latencyMs.p95,
      after: optimizedScenario.latencyMs.p95,
      improvementPercent: improvement(
        baselineScenario.latencyMs.p95,
        optimizedScenario.latencyMs.p95
      )
    },
    throughputRps: {
      before: baselineScenario.throughputRps,
      after: optimizedScenario.throughputRps,
      improvementPercent: Number(
        ((((optimizedScenario.throughputRps - baselineScenario.throughputRps) / baselineScenario.throughputRps) * 100)).toFixed(2)
      )
    },
    heapUsedDeltaBytes: {
      before: baselineScenario.memory.deltaHeapUsed,
      after: optimizedScenario.memory.deltaHeapUsed,
      improvementPercent: improvement(
        baselineScenario.memory.deltaHeapUsed,
        optimizedScenario.memory.deltaHeapUsed
      )
    }
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  comparison
};

const resolvedOutPath = path.resolve(outPathArg);
fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
fs.writeFileSync(resolvedOutPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
