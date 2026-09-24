import {
  Annotation, StateGraph, START, END, interrupt, Command, MemorySaver,
} from '@langchain/langgraph';

const State = Annotation.Root({
  projectId: Annotation(),
  requirement: Annotation(),
  plan: Annotation(),
  implementation: Annotation(),
  verification: Annotation(),
  approved: Annotation(),
  delivery: Annotation(),
  events: Annotation({ default: () => [], reducer: (a, b) => a.concat(b) }),
});

function requiredText(value, stage) {
  if (typeof value !== 'string' || !value.trim() || value.length > 20000) {
    throw new Error(stage + ' returned an invalid artifact');
  }
  return value;
}

/**
 * A real LangGraph state machine with independently injected Agent tools.
 * A MemorySaver is a process-only demonstration checkpoint; configure a
 * durable Postgres checkpointer for multi-process or crash-recovery use.
 *
 * Deliver MUST be a server-controlled, idempotent, permission-checked adapter:
 * graph approval is not a replacement for authorization at Git/CI boundaries.
 */
export function createResearchDevelopmentGraph({
  productAgent, developerAgent, testAgent, deliver,
  checkpointer = new MemorySaver(),
}) {
  for (const fn of [productAgent, developerAgent, testAgent, deliver]) {
    if (typeof fn !== 'function') throw new TypeError('All agent adapters are required');
  }
  const graph = new StateGraph(State)
    .addNode('product', async (state) => ({
      plan: requiredText(await productAgent({
        projectId: state.projectId,
        requirement: state.requirement,
      }), 'product'),
      events: ['product.completed'],
    }))
    .addNode('developer', async (state) => ({
      implementation: requiredText(await developerAgent({
        projectId: state.projectId,
        requirement: state.requirement,
        plan: state.plan,
      }), 'developer'),
      events: ['developer.completed'],
    }))
    .addNode('tester', async (state) => ({
      verification: requiredText(await testAgent({
        projectId: state.projectId,
        requirement: state.requirement,
        plan: state.plan,
        implementation: state.implementation,
      }), 'tester'),
      events: ['tester.completed'],
    }))
    .addNode('approval', (state) => {
      // The graph suspends HERE. The delivery adapter cannot run before resume.
      const review = interrupt({
        kind: 'development-delivery-approval',
        projectId: state.projectId,
        plan: state.plan,
        implementation: state.implementation,
        verification: state.verification,
      });
      return {
        approved: review != null && review.approved === true,
        events: [review != null && review.approved === true
          ? 'approval.approved' : 'approval.rejected'],
      };
    })
    .addNode('deliver', async (state) => ({
      delivery: requiredText(await deliver({
        projectId: state.projectId,
        plan: state.plan,
        implementation: state.implementation,
        verification: state.verification,
      }), 'delivery'),
      events: ['delivery.completed'],
    }))
    .addEdge(START, 'product')
    .addEdge('product', 'developer')
    .addEdge('developer', 'tester')
    .addEdge('tester', 'approval')
    .addConditionalEdges('approval', (s) => s.approved ? 'deliver' : END, ['deliver', END])
    .addEdge('deliver', END)
    .compile({ checkpointer });

  return graph;
}

export async function begin(graph, { threadId, projectId, requirement }) {
  if (!threadId || !/^[a-zA-Z0-9_-]{1,80}$/.test(threadId) ||
      !projectId || !/^[a-zA-Z0-9_-]{1,80}$/.test(projectId) ||
      typeof requirement !== 'string' || !requirement.trim() || requirement.length > 4000) {
    throw new TypeError('Invalid thread, project or requirement');
  }
  return graph.invoke(
    { projectId, requirement: requirement.trim() },
    { configurable: { thread_id: threadId } },
  );
}

export async function review(graph, { threadId, approved }) {
  if (!threadId || !/^[a-zA-Z0-9_-]{1,80}$/.test(threadId) ||
      typeof approved !== 'boolean') {
    throw new TypeError('Invalid review');
  }
  const config = { configurable: { thread_id: threadId } };
  const snapshot = await graph.getState(config);
  if (!snapshot.next?.includes('approval')) {
    throw new Error('Task is not awaiting approval');
  }
  return graph.invoke(new Command({ resume: { approved } }), config);
}
