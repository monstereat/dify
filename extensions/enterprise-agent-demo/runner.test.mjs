import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DifyWorkflowClient, runPipeline } from "./runner.mjs";

test("Dify client sends stage-specific key and parses outputs", async () => {
  const client = new DifyWorkflowClient({
    baseUrl: "http://localhost/v1/",
    apiKeys: { product: "test-key" },
    fetchImpl: async (url, options) => {
      assert.equal(String(url), "http://localhost/v1/workflows/run");
      assert.equal(options.headers.Authorization, "Bearer test-key");
      assert.equal(JSON.parse(options.body).inputs.request, "spec");
      return { ok: true, json: async () => ({ workflow_run_id: "run-1", data: { status: "succeeded", outputs: { spec: "done" } } }) };
    },
  });
  assert.deepEqual(await client.run("product", { request: "spec" }), { runId: "run-1", outputs: { spec: "done" } });
});

test("pipeline gates test stage until approved and writes checkpoint", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dify-demo-"));
  const called = [];
  const client = { run: async (stage) => { called.push(stage); return { runId: stage, outputs: { text: stage } }; } };
  try {
    const job = await runPipeline("build a page", { client, checkpointDir: dir, id: "job-1" });
    assert.equal(job.status, "waiting_approval");
    assert.deepEqual(called.sort(), ["backend", "frontend", "product"]);
    const saved = JSON.parse(await readFile(path.join(dir, "job-1.json"), "utf8"));
    assert.equal(saved.status, "waiting_approval");
    const complete = await runPipeline("build a page", { client, checkpointDir: dir, id: "job-2", approveTest: true });
    assert.equal(complete.status, "completed");
    assert.ok(called.includes("test"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed stage stops the pipeline", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dify-demo-"));
  try {
    await assert.rejects(runPipeline("build a page", {
      client: { run: async () => { throw Error("workflow failed"); } },
      checkpointDir: dir, id: "failed",
    }), /workflow failed/);
    assert.equal(JSON.parse(await readFile(path.join(dir, "failed.json"), "utf8")).status, "failed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
