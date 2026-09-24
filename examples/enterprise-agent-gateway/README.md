# Enterprise Agent Gateway (standalone MVP)

This opt-in, dependency-free Node.js 20 example sits **in front of** a Dify workflow API. It is intentionally separate from Dify internals, so upstream updates remain easy to merge.

Implemented:
- Server-side credential-to-user binding: callers cannot spoof the Dify user.
- Project + document allowlists enforced **before** invoking the workflow.
- Input size bounds, network timeouts, sanitized upstream errors.
- Minimal Node.js integration tests with a stub Dify API.

## Configure

Create a Dify **Workflow** application with three declared inputs named `question` (text), `project_id` (text), and `document_ids` (array of text values, or adapt the mapping to your workflow). Generate an application API key. The actual RAG retrieval node must use `project_id` and `document_ids` to enforce the same scope. **Checking IDs only at this gateway is not sufficient for document-level RAG isolation if the downstream workflow ignores them.**

```bash
cd examples/enterprise-agent-gateway
export DIFY_API_BASE_URL="http://127.0.0.1/v1/"
export DIFY_API_KEY="your-dify-workflow-app-key"
export CLIENTS_JSON='[{"token":"local-demo-token","userId":"developer-1","projectIds":["demo-project"]}]'
export PROJECTS_JSON='{"demo-project":{"documentIds":["doc-a","doc-b"]}}'
npm test
npm start
```

On another terminal:

```bash
curl -fsS http://127.0.0.1:8090/api/enterprise/workflows/run \
  -H 'Authorization: Bearer local-demo-token' \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"demo-project","question":"Create a product plan","documentIds":["doc-a"]}'
```

**MVP only:** in production, replace static JSON credentials with verified OIDC/JWT, pull authorization from your database, enforce per-user and per-document ACL at retrieval time, add audit persistence, rate limits, streaming, and separate services for long-running LangGraph agents. Never commit production API keys.
