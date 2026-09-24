# Enterprise product R&D: Dify workflow adapter (MVP)

This **example extension** runs four independent Dify Workflow apps as a product, frontend, backend and test team. It does **not** replace the Dify engine or claim to implement LangGraph/checkpoint-based resumption.

## Requirements

- Node.js 20+
- Four Dify **Workflow** applications; each must define string inputs `request` and `context`. For the product workflow, `context` is optional. Add your own RAG knowledge-retrieval nodes to the workflows before running.
- Separate **app API keys** for each workflow; never commit the keys.

```bash
export DIFY_BASE_URL=http://localhost/v1/
export DIFY_PRODUCT_API_KEY=...
export DIFY_FRONTEND_API_KEY=...
export DIFY_BACKEND_API_KEY=...
export DIFY_TEST_API_KEY=...
node extensions/enterprise-agent-demo/runner.mjs "Create an order dashboard"
# After a human reviews the proposed code/workflows:
node extensions/enterprise-agent-demo/runner.mjs --approve-test "Create an order dashboard"
node --test extensions/enterprise-agent-demo/runner.test.mjs
```

Product runs first; frontend and backend run in parallel with the product output, and the test workflow runs only with explicit `--approve-test`. Dify uses blocking responses. Failure stops the pipeline; no automatic retries of side-effecting workflows. The `.agent-runs/` JSON checkpoints are local **audit snapshots**, not resumable checkpoints. Running the approved command creates a **new** job; implement persisted resume and per-stage approval before production use.

**Security:** Local checkpoints contain workflow outputs, which may be sensitive: keep the directory out of source control and restrict file access. Use a sandbox for generated code execution, scoped credentials, and a separate approval service before enabling automatic Git commits or deployment.

## Next changes

- Persist and resume individual LangGraph.js nodes instead of rerunning earlier stages.
- Read documents with ACL-aware RAG; link sources to specific requirement versions.
- Create approval tasks in NestJS and correlate Dify trace IDs across services.
- Add an isolated code-testing sandbox and golden-task evaluation suite.
