import assert from 'node:assert/strict';
import { test } from 'node:test';
import { begin, createResearchDevelopmentGraph, review } from '../graph.mjs';
import { createDifyRoleTools } from '../dify-tools.mjs';

const request = {
  threadId: 'req-100',
  projectId: 'sales-platform',
  requirement: 'Implement a sales report',
};

test('approval pauses delivery, resumes at the checkpoint, keeps artifacts', async () => {
  const calls = [];
  const graph = createResearchDevelopmentGraph({
    productAgent: async input => { calls.push('product'); return 'Plan for ' + input.requirement; },
    developerAgent: async input => { calls.push('developer'); assert.match(input.plan, /sales report/); return 'Code diff'; },
    testAgent: async input => { calls.push('tester'); assert.equal(input.implementation, 'Code diff'); return 'All tests passed'; },
    deliver: async input => { calls.push('deliver'); return 'PR 101 for ' + input.projectId; },
  });
  await begin(graph, request);
  const config = { configurable: { thread_id: request.threadId } };
  const snapshot = await graph.getState(config);
  assert.ok(snapshot.next.includes('approval'));
  assert.deepEqual(calls, ['product', 'developer', 'tester']);
  assert.equal(snapshot.values.verification, 'All tests passed');
  const done = await review(graph, { threadId: request.threadId, approved: true });
  assert.equal(done.approved, true);
  assert.equal(done.delivery, 'PR 101 for sales-platform');
  assert.deepEqual(calls, ['product', 'developer', 'tester', 'deliver']);
  await assert.rejects(
    review(graph, { threadId: request.threadId, approved: true }),
    /not awaiting approval/,
  );
});

test('explicit rejection prevents delivery and records the decision', async () => {
  let delivered = false;
  const graph = createResearchDevelopmentGraph({
    productAgent: async () => 'Plan',
    developerAgent: async () => 'Diff',
    testAgent: async () => 'Test evidence',
    deliver: async () => { delivered = true; return 'PR'; },
  });
  await begin(graph, { ...request, threadId: 'req-rejected' });
  const done = await review(graph, { threadId: 'req-rejected', approved: false });
  assert.equal(done.approved, false);
  assert.equal(delivered, false);
  assert.ok(done.events.includes('approval.rejected'));
});

test('Dify role adapters send only server-owned credentials and validated inputs', async () => {
  const requests = [];
  const roles = createDifyRoleTools({
    baseUrl: 'https://dify.example.test/v1/',
    apiKey: 'server-secret',
    trustedUserId: 'verified-user',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), ...init });
      return { ok: true, json: async () => ({
        data: { outputs: { artifact: 'generated artifact' } },
      }) };
    },
  });
  assert.equal(await roles.productAgent({ projectId: 'demo', requirement: 'hello' }), 'generated artifact');
  assert.equal(requests[0].url, 'https://dify.example.test/v1/workflows/run');
  assert.equal(requests[0].headers.authorization, 'Bearer server-secret');
  assert.equal(JSON.parse(requests[0].body).user, 'verified-user');
  assert.equal(JSON.parse(requests[0].body).inputs.role, 'product');
});

test('failed independent tests stop before approval and never deliver', async () => {
  let deliveries = 0;
  const graph = createResearchDevelopmentGraph({
    productAgent: async () => 'Plan',
    developerAgent: async () => 'Diff',
    testAgent: async () => ({ passed: false, report: 'Unit tests failed (2 failures)' }),
    deliver: async () => { deliveries++; return 'unexpected delivery'; },
  });
  const threadId = 'req-failed-tests';
  const finished = await begin(graph, {
    projectId: 'sales-platform', requirement: 'Add refund validation', threadId,
  });
  const state = await graph.getState({ configurable: { thread_id: threadId } });
  assert.equal(finished.verificationPassed, false);
  assert.ok(finished.events.includes('tester.failed'));
  assert.equal(state.next.length, 0, 'a failed test must not create a pending approval');
  assert.equal(deliveries, 0);
  await assert.rejects(review(graph, { threadId, approved: true }), /not awaiting approval/);
});

test('successful structured test output can reach the approval boundary', async () => {
  const graph = createResearchDevelopmentGraph({
    productAgent: async () => 'Plan',
    developerAgent: async () => 'Diff',
    testAgent: async () => ({ passed: true, report: '3 suites passed' }),
    deliver: async () => 'PR #17',
  });
  const threadId = 'req-verified';
  await begin(graph, {
    projectId: 'sales-platform', requirement: 'Implement revenue API', threadId,
  });
  const state = await graph.getState({ configurable: { thread_id: threadId } });
  assert.equal(state.values.verificationPassed, true);
  assert.ok(state.next.includes('approval'));
  assert.equal((await review(graph, { threadId, approved: true })).delivery, 'PR #17');
});

test('malformed structured test status fails closed', async () => {
  const graph = createResearchDevelopmentGraph({
    productAgent: async () => 'Plan',
    developerAgent: async () => 'Diff',
    testAgent: async () => ({ report: 'looks good' }),
    deliver: async () => 'never',
  });
  await assert.rejects(
    begin(graph, {
      projectId: 'sales-platform', requirement: 'Implement audit API',
      threadId: 'req-malformed-test',
    }),
    /passed: boolean/,
  );
});
