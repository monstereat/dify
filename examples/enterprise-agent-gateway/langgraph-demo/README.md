# Dify + LangGraph.js: approval-gated R&D workflow (P0 prototype)

Separate, opt-in sample for \`develop-me\`. Each role is an injected async tool
rather than a simulated claim of a live LLM. \`dify-tools.mjs\` includes a real
Dify Workflow HTTP adapter; tests stub the upstream so they need no API keys.

Graph:

\`START → product → developer → tester → approval INTERRUPT → (approved? deliver : END) → END\`

What is implemented:
- A typed-by-convention graph with product, developer, test, and delivery roles.
- A checkpoint plus \`interrupt()\` / \`Command({resume})\` for manual approval.
- A denied review cannot invoke \`deliver\`; stale approvals cannot be replayed.
- Dify blocking Workflow HTTP role adapters, with server-owned key and user ID.

Run:

\`\`\`bash
cd examples/enterprise-agent-gateway/langgraph-demo
npm install
npm test
\`\`\`

To connect to a real Dify Workflow, define inputs
\`role\`, \`project_id\`, \`requirement\`, \`plan\`, \`implementation\`,
and an output \`artifact\` (string). Create role tools via
\`createDifyRoleTools\` and supply them to
\`createResearchDevelopmentGraph\`. The \`deliver\` adapter must be
bound to your server-side authenticated user and checked at the Git/CI API;
the graph's approval state is not an authorization primitive.

**Not yet production ready:** \`MemorySaver\` is process-local and loses state
on restart. Use a production checkpointer (for example PostgreSQL), persisted
approval identities and idempotency keys before executing any real Git writes.
The standalone graph is not yet exposed by the Enterprise Gateway HTTP API;
wire it into a NestJS service after identity/ACL and approval persistence exist.
