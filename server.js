/* mod dog — server.js
   本機開發伺服器。執行方式：node server.js
   提供 ES modules 支援與 OAuth callback 路由。 */

import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // OAuth callback routes — redirect back to index with params
  if (pathname.startsWith('/auth/')) {
    const params = url.search;
    res.writeHead(302, { Location: `/${params}` });
    res.end();
    return;
  }

  // Default to index.html
  if (pathname === '/') pathname = '/index.html';

  const filePath = join(__dirname, pathname);

  // Security: prevent path traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback
    const indexPath = join(__dirname, 'index.html');
    const content = readFileSync(indexPath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`\n  mod dog dev server running at:\n`);
  console.log(`    http://localhost:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
