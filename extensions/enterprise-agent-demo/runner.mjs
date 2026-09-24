import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const STAGES = ["product", "frontend", "backend", "test"];

export class DifyWorkflowClient {
  constructor({ baseUrl, apiKeys, fetchImpl = fetch, timeoutMs = 90_000 }) {
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error("Set a valid DIFY_BASE_URL");
    this.url = new URL("workflows/run", baseUrl.replace(/\/?$/, "/"));
    this.apiKeys = apiKeys;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async run(stage, { request, context = {} }) {
    if (!STAGES.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
    const key = this.apiKeys[stage];
    if (!key) throw new Error(`Missing API key for ${stage}`);
    if (!request || typeof request !== "string") throw new Error("request must be a non-empty string");
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: { request, context: JSON.stringify(context) },
        response_mode: "blocking",
        user: "enterprise-agent-demo",
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Dify ${stage} request failed (HTTP ${response.status})`);
    const payload = await response.json();
    if (payload.data?.status !== "succeeded" || !payload.data?.outputs) {
      throw new Error(`Dify ${stage} workflow failed: ${payload.data?.error ?? payload.message ?? "unknown reason"}`);
    }
    return { runId: payload.workflow_run_id ?? payload.data.id, outputs: payload.data.outputs };
  }
}

async function saveCheckpoint(dir, job) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${job.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(job, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

export async function runPipeline(request, {
  client,
  approveTest = false,
  checkpointDir = path.join(process.cwd(), ".agent-runs"),
  id = randomUUID(),
} = {}) {
  if (!client) throw new Error("client is required");
  if (!request?.trim() || request.length > 20_000) throw new Error("request must be 1-20000 characters");
  const job = { id, status: "running", steps: {}, createdAt: new Date().toISOString() };
  await saveCheckpoint(checkpointDir, job);
  try {
    job.steps.product = await client.run("product", { request });
    await saveCheckpoint(checkpointDir, job);
    const context = { product: job.steps.product.outputs };
    const [frontend, backend] = await Promise.all([
      client.run("frontend", { request, context }),
      client.run("backend", { request, context }),
    ]);
    job.steps.frontend = frontend;
    job.steps.backend = backend;
    await saveCheckpoint(checkpointDir, job);
    if (!approveTest) {
      job.status = "waiting_approval";
      await saveCheckpoint(checkpointDir, job);
      return job;
    }
    job.steps.test = await client.run("test", {
      request,
      context: Object.fromEntries(Object.entries(job.steps).map(([key, value]) => [key, value.outputs])),
    });
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    await saveCheckpoint(checkpointDir, job);
    throw error;
  }
  await saveCheckpoint(checkpointDir, job);
  return job;
}

async function main() {
  const request = process.argv.slice(2).filter((arg) => arg !== "--approve-test").join(" ");
  if (!request) {
    console.error("Usage: node runner.mjs [--approve-test] \"your requirement\"");
    process.exitCode = 2;
    return;
  }
  const client = new DifyWorkflowClient({
    baseUrl: process.env.DIFY_BASE_URL ?? "http://localhost/v1/",
    apiKeys: {
      product: process.env.DIFY_PRODUCT_API_KEY,
      frontend: process.env.DIFY_FRONTEND_API_KEY,
      backend: process.env.DIFY_BACKEND_API_KEY,
      test: process.env.DIFY_TEST_API_KEY,
    },
  });
  const result = await runPipeline(request, {
    client,
    approveTest: process.argv.includes("--approve-test"),
  });
  console.log(JSON.stringify({ id: result.id, status: result.status, steps: Object.keys(result.steps) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
