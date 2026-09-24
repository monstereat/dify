import { timingSafeEqual } from 'node:crypto';

const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const MAX_BODY_BYTES = 32768;

export function authenticate(header, clients) {
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim() : '';
  if (!token) return null;
  for (const client of clients) {
    if (!client.token || typeof client.token !== 'string') continue;
    const provided = Buffer.from(token);
    const expected = Buffer.from(client.token);
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return client;
    }
  }
  return null;
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Body exceeds 32 KiB');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

function respond(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

export function createHandler({
  clients, projects, difyApiBaseUrl, difyApiKey,
  fetchImpl = fetch, timeoutMs = 30000,
}) {
  if (!Array.isArray(clients) || !projects || !difyApiBaseUrl || !difyApiKey) {
    throw new Error('Configure clients, projects, Dify API base URL, and Dify API key');
  }
  const workflowUrl = new URL('workflows/run', difyApiBaseUrl.endsWith('/') ? difyApiBaseUrl : difyApiBaseUrl + '/');
  if (!['http:', 'https:'].includes(workflowUrl.protocol)) throw new Error('Invalid Dify API URL');

  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz')
      return respond(res, 200, { status: 'ok' });
    if (req.method !== 'POST' || req.url !== '/api/enterprise/workflows/run')
      return respond(res, 404, { error: 'Not found' });

    const actor = authenticate(req.headers.authorization, clients);
    if (!actor || typeof actor.userId !== 'string' || !Array.isArray(actor.projectIds))
      return respond(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message });
    }

    const { projectId, question, documentIds } = body ?? {};
    if (!ID.test(projectId ?? '') || typeof question !== 'string' ||
        !question.trim() || question.length > 4000 ||
        !Array.isArray(documentIds) || documentIds.length < 1 || documentIds.length > 30 ||
        !documentIds.every(id => typeof id === 'string' && ID.test(id))) {
      return respond(res, 400, { error: 'Invalid project, question, or document IDs' });
    }

    const project = Object.hasOwn(projects, projectId) ? projects[projectId] : null;
    if (!actor.projectIds.includes(projectId) || !project ||
        !Array.isArray(project.documentIds) ||
        !documentIds.every(id => project.documentIds.includes(id))) {
      return respond(res, 403, { error: 'Access denied' });
    }

    const safeDocumentIds = [...new Set(documentIds)];
    const upstreamPayload = {
      inputs: {
        question: question.trim(),
        project_id: projectId,
        document_ids: safeDocumentIds,
      },
      response_mode: 'blocking',
      user: actor.userId,
    };

    try {
      const response = await fetchImpl(workflowUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${difyApiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(upstreamPayload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        return respond(res, 502, { error: 'Dify workflow failed', upstreamStatus: response.status });

      const result = await response.json();
      if (!result || typeof result !== 'object' || !result.data || typeof result.data !== 'object')
        return respond(res, 502, { error: 'Unexpected Dify response' });

      return respond(res, 200, {
        workflowRunId: result.workflow_run_id ?? null,
        taskId: result.task_id ?? null,
        status: result.data.status ?? null,
        outputs: result.data.outputs ?? {},
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return respond(res, timedOut ? 504 : 502, { error: timedOut ? 'Dify timeout' : 'Dify unavailable' });
    }
  };
}
