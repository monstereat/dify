import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHandler } from './handler.mjs';

export function loadConfig(env = process.env) {
  const clients = JSON.parse(env.CLIENTS_JSON || '[]');
  const projects = JSON.parse(env.PROJECTS_JSON || '{}');
  return {
    clients, projects,
    difyApiBaseUrl: env.DIFY_API_BASE_URL,
    difyApiKey: env.DIFY_API_KEY,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const port = Number(process.env.PORT || '8090');
  const server = http.createServer(createHandler(config));
  server.listen(port, '127.0.0.1', () => {
    console.log(`Enterprise Agent Gateway listening on http://127.0.0.1:${port}`);
  });
}
