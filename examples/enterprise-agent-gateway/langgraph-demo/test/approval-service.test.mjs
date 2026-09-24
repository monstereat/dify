import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResearchDevelopmentGraph, begin } from '../graph.mjs';
import { createApprovalService } from '../approval-service.mjs';

const task = { projectId: 'p1', approverIds: ['team-lead'],
  status: 'awaiting_approval' };

function graphWithCounters() {
  let delivered = 0;
  return {
    graph: createResearchDevelopmentGraph({
      productAgent: async () => 'plan',
      developerAgent: async () => 'patch',
      testAgent: async () => 'tests pass',
      deliver: async () => { delivered += 1; return 'draft PR'; },
    }),
    delivered: () => delivered,
  };
}

test('denies an ordinary developer and does not resume delivery', async () => {
  const { graph, delivered } = graphWithCounters();
  await begin(graph, { threadId: 'request-1', projectId: 'p1', requirement: 'new page' });
  const audit = [];
  const approve = createApprovalService({
    taskRegistry: new Map([['request-1', task]]),
    authorizeProject: async () => true,
    auditSink: event => audit.push(event),
  });
  await assert.rejects(approve(graph, {
    threadId: 'request-1', approved: true, actor: { userId: 'developer' },
  }), /not permitted/);
  assert.equal(delivered(), 0);
  assert.equal(audit[0].outcome, 'denied');
});

test('requires BOTH task approver assignment and project permission', async () => {
  const { graph, delivered } = graphWithCounters();
  await begin(graph, { threadId: 'request-2', projectId: 'p1', requirement: 'new page' });
  const approve = createApprovalService({
    taskRegistry: new Map([['request-2', task]]),
    authorizeProject: async () => false,
  });
  await assert.rejects(approve(graph, {
    threadId: 'request-2', approved: true, actor: { userId: 'team-lead' },
  }), /not permitted/);
  assert.equal(delivered(), 0);
});

test('authorized reviewer resumes once and records a sanitized audit event', async () => {
  const { graph, delivered } = graphWithCounters();
  await begin(graph, { threadId: 'request-3', projectId: 'p1', requirement: 'new page' });
  const audit = [];
  const approve = createApprovalService({
    taskRegistry: new Map([['request-3', task]]),
    authorizeProject: async (actor, projectId, action) =>
      actor.userId === 'team-lead' && projectId === 'p1' && action === 'delivery:approve',
    auditSink: event => audit.push(event),
  });
  const result = await approve(graph, {
    threadId: 'request-3', approved: true, actor: { userId: 'team-lead' },
  });
  assert.equal(result.delivery, 'draft PR');
  assert.equal(delivered(), 1);
  assert.deepEqual(audit.map(event => event.outcome), ['approved']);
  await assert.rejects(approve(graph, {
    threadId: 'request-3', approved: true, actor: { userId: 'team-lead' },
  }), /not awaiting approval/);
});
