import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import { authenticate, createHandler } from '../handler.mjs';

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve))));
});

async function request(handler, body, token = 'test-secret') {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return fetch(`http://127.0.0.1:${server.address().port}/api/enterprise/workflows/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const config = {
  clients: [{ token: 'test-secret', userId: 'user-42', projectIds: ['p1'] }],
  projects: { p1: { documentIds: ['doc1', 'doc2'] }, p2: { documentIds: ['doc3'] } },
  difyApiBaseUrl: 'http://dify.local/v1/',
  difyApiKey: 'upstream-test-key',
};

const valid = { projectId: 'p1', question: 'Generate a plan', documentIds: ['doc1'] };

test('rejects missing or incorrect credentials', async () => {
  assert.equal(authenticate('Bearer incorrect', config.clients), null);
  const result = await request(createHandler(config), valid, 'incorrect');
  assert.equal(result.status, 401);
});

test('rejects unauthorized project and document combinations', async () => {
  const h = createHandler(config);
  assert.equal((await request(h, { ...valid, projectId: 'p2', documentIds: ['doc3'] })).status, 403);
  assert.equal((await request(h, { ...valid, documentIds: ['doc3'] })).status, 403);
});

test('rejects empty document scope rather than making unrestricted RAG requests', async () => {
  const result = await request(createHandler(config), { ...valid, documentIds: [] });
  assert.equal(result.status, 400);
});

test('derives upstream identity server-side and forwards only authorized documents', async () => {
  let observed;
  const handler = createHandler({
    ...config,
    fetchImpl: async (url, init) => {
      observed = { url: String(url), init };
      return { ok: true, json: async () => ({
        workflow_run_id: 'run-1', data: { status: 'succeeded', outputs: { answer: 'ok' } },
      }) };
    },
  });
  const result = await request(handler, { ...valid, documentIds: ['doc1', 'doc1'], user: 'admin' });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).outputs.answer, 'ok');
  assert.equal(observed.url, 'http://dify.local/v1/workflows/run');
  const payload = JSON.parse(observed.init.body);
  assert.equal(payload.user, 'user-42');
  assert.deepEqual(payload.inputs.document_ids, ['doc1']);
  assert.equal(payload.inputs.user, undefined);
  assert.equal(observed.init.headers.authorization, 'Bearer upstream-test-key');
});

test('does not expose upstream error bodies or secrets', async () => {
  const handler = createHandler({
    ...config,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  const response = await request(handler, valid);
  assert.equal(response.status, 502);
  assert.equal(JSON.stringify(await response.json()).includes(config.difyApiKey), false);
});
