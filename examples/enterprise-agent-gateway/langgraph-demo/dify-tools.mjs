/**
 * Example adapter connecting LangGraph roles to one Dify Workflow application.
 * Server owns the application API key and trusted user ID. Never accept them
 * from the language model or arbitrary request data.
 */
export function createDifyRoleTools({
  baseUrl, apiKey, trustedUserId,
  fetchImpl = fetch, timeoutMs = 30000,
}) {
  if (!baseUrl || !apiKey || !trustedUserId) {
    throw new Error('Dify endpoint, API key and trusted identity are required');
  }
  const url = new URL('workflows/run', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Invalid Dify URL');

  async function call(role, details) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        user: trustedUserId,
        response_mode: 'blocking',
        inputs: {
          role, project_id: details.projectId,
          requirement: details.requirement ?? '',
          plan: details.plan ?? '',
          implementation: details.implementation ?? '',
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error('Dify ' + role + ' workflow returned HTTP ' + response.status);
    const result = await response.json();
    const artifact = result?.data?.outputs?.artifact;
    if (typeof artifact !== 'string') {
      throw new Error('Dify workflow must return a text output named artifact');
    }
    return artifact;
  }
  return {
    productAgent: input => call('product', input),
    developerAgent: input => call('developer', input),
    testAgent: input => call('tester', input),
  };
}
