// =====================================================================
// Primer server
//   npm start            (or: node server/index.mjs)
//
// Serves the site's pages and assets (and nothing else: .env, server
// code and caches are never served), plus the AI endpoints:
//   GET  /api/health    is the AI configured?
//   POST /api/outline   { topic, from, to, instructions }
//   POST /api/lesson    { topic, from, to, instructions, courseTitle, outline:[{n,unit,title,desc}], n }
// Binds to 127.0.0.1 by default so nobody else on the network can use it.
// =====================================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, generateOutline, generateLesson, AIError } from './ai.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  console.warn('[primer] No .env file found, so AI features are off. Copy .env.example to .env and add your key.');
}

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const PAGES = new Set(['index.html', 'auth.html', 'app.html', 'lesson.html']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

/* ---------------- helpers ---------------- */

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
const sendJSON = (res, status, obj) => send(res, status, JSON.stringify(obj), undefined, { 'Cache-Control': 'no-store' });

function readBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new AIError('Request too large.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new AIError('The request body is not valid JSON.', 400)); }
    });
    req.on('error', reject);
  });
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function courseInput(body) {
  const topic = text(body.topic, 120);
  if (!topic) throw new AIError('Name a topic first.', 400);
  return { topic, from: text(body.from, 80), to: text(body.to, 80), instructions: text(body.instructions, 600) };
}

/* ---------------- static files ---------------- */

async function serveStatic(req, res, pathname) {
  let rel;
  if (pathname === '/') rel = 'index.html';
  else if (PAGES.has(pathname.slice(1))) rel = pathname.slice(1);
  else if (/^\/assets\/[A-Za-z0-9_\-./]+$/.test(pathname) && !pathname.includes('..') && !pathname.includes('/.')) rel = pathname.slice(1);
  else return send(res, 404, 'Not found', 'text/plain; charset=utf-8');

  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  try {
    const data = await readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

/* ---------------- API ---------------- */

async function handleApi(req, res, pathname) {
  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      const cfg = config();
      return sendJSON(res, 200, { ok: true, ai: Boolean(cfg.key), models: cfg.models });
    }
    if (pathname === '/api/outline' && req.method === 'POST') {
      const input = courseInput(await readBody(req));
      const out = await generateOutline(input);
      return sendJSON(res, 200, { ok: true, ...out });
    }
    if (pathname === '/api/lesson' && req.method === 'POST') {
      const body = await readBody(req);
      const input = courseInput(body);
      const outline = (Array.isArray(body.outline) ? body.outline : []).slice(0, 40).map((l, i) => ({
        n: Number.isInteger(l && l.n) ? l.n : i + 1,
        unit: text(l && l.unit, 80),
        title: text(l && l.title, 120),
        desc: text(l && l.desc, 300)
      })).filter((l) => l.title);
      const n = Number(body.n);
      if (!Number.isInteger(n) || !outline.some((l) => l.n === n)) throw new AIError('That lesson is not in the outline.', 400);
      const out = await generateLesson({ ...input, courseTitle: text(body.courseTitle, 120) || input.topic, outline, n });
      return sendJSON(res, 200, { ok: true, ...out });
    }
    return sendJSON(res, 404, { ok: false, error: 'Unknown endpoint.' });
  } catch (err) {
    const status = err instanceof AIError ? err.status : 500;
    if (!(err instanceof AIError)) console.error('[primer]', err);
    return sendJSON(res, status, { ok: false, error: err instanceof AIError ? err.message : 'Something went wrong on the server.' });
  }
}

/* ---------------- server ---------------- */

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { return send(res, 400, 'Bad request', 'text/plain; charset=utf-8'); }
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  return serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  const cfg = config();
  console.log(`[primer] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(cfg.key ? `[primer] AI on: ${cfg.models.join(' -> ')}` : '[primer] AI off: add OPENROUTER_API_KEY to .env');
});
