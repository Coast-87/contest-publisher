import http from 'node:http';
import { APP_HTML } from './ui/index.mjs';
import { startApiServer } from './api-server.mjs';
import { openTarget } from './platform.mjs';

function routePath(rawUrl) {
  const url = new URL(rawUrl ?? '/', 'http://127.0.0.1');
  return url.pathname.replace(/\/+$/, '') || '/';
}

export async function startUiServer({ host = '127.0.0.1', port = 0, runsRoot, open = false } = {}) {
  // runsRoot stays undefined unless the operator passed --runs-root, so the
  // remembered workspace (saved by the workbench) decides where runs live.
  const api = await startApiServer({ host, port: 0, runsRoot });
  const handleApiRequest = api.handleApiRequest;
  const server = http.createServer(async (req, res) => {
    const pathname = routePath(req.url);
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(APP_HTML);
      return;
    }
    await handleApiRequest(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const originalClose = server.close.bind(server);
  server.close = callback => api.server.close(() => originalClose(callback));
  const address = server.address(); const url = `http://${host}:${address.port}`;
  // 工作台的「退出软件」按钮走这个回调：只监听 127.0.0.1，等于本机操作者按了退出。
  api.workspace.shutdown = () => {
    try { server.close(); } catch { /* 已经关了 */ }
    try { api.server.close(); } catch { /* 已经关了 */ }
    process.exit(0);
  };
  if (open) openTarget(url, { kind: 'url' });
  return { server, url, port: address.port, host, workspace: api.workspace };
}
