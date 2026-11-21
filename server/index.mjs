// =====================================================================
// Primer server
//   npm start            (or: node server/index.mjs)
//
// Serves the site's pages and assets (and nothing else: .env, server
// code, the database and caches are never served) plus the JSON API.
// Each feature lives in its own module that exports `routes`.
//
// Pages that need an account redirect to sign-in on the server, and every
// page gets the signed-in user injected, so the browser never has to
// guess. Binds to 127.0.0.1 by default so nobody else on the network can
// use it; set HOST=0.0.0.0 to share it.
// =====================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(process.env.PRIMER_ENV_FILE || path.join(ROOT, '.env'));
} catch {
  console.warn('[primer] No .env file found, so AI features are off. Copy .env.example to .env and add a key.');
}

const { config } = await import('./ai.mjs');
const { HttpError, send, sendJSON, checkOrigin, matchRoute } = await import('./http.mjs');
const auth = await import('./auth.mjs');
const MODULES = [auth, await import('./data.mjs')];
for (const extra of (await import('./features.mjs')).default) MODULES.push(await extra());
const ROUTES = MODULES.flatMap((m) => m.routes || []);
const RAW_ROUTES = ROUTES.filter((r) => r[3] === 'raw');
const PAGE_HOOKS = MODULES.flatMap((m) => m.pages || []);
const BOOT_HOOKS = MODULES.map((m) => m.boot).filter(Boolean);

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';

// page -> needs an account?
const PAGES = new Map([['index.html', false], ['auth.html', false], ['app.html', true], ['lesson.html', true], ['welcome.html', true]]);
PAGE_HOOKS.forEach((p) => PAGES.set(p.file, Boolean(p.protected)));
const SAFE_NEXT = /^[a-z]+\.html(\?[\w=&%.\-+~!*'()]*)?$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.epub': 'application/epub+zip'
};

function csp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "media-src 'self' blob:",
    // Watch mode's YouTube videos, embedded without YouTube's cookies (their thumbnails come from this site)
    'frame-src https://www.youtube-nocookie.com',
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
}

const SECURITY = { 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin' };
const htmlCache = new Map();
// U+2028 and U+2029 end a line inside a <script>, so they are escaped too.
const LINE_SEPS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const scriptJSON = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(LINE_SEPS, (c) => '\\u' + c.charCodeAt(0).toString(16));

async function servePage(req, res, file, search) {
  const user = auth.sessionUser(req);
  if (PAGES.get(file) && !user) {
    return send(res, 302, '', 'text/plain', { Location: `/auth.html?next=${encodeURIComponent(file + search)}#signin`, 'Cache-Control': 'no-store' });
  }
  if (file === 'auth.html' && user) {
    const next = new URLSearchParams(search).get('next');
    const ok = next && SAFE_NEXT.test(next) && PAGES.has(next.split('?')[0]);
    return send(res, 302, '', 'text/plain', { Location: '/' + (ok ? next : 'app.html'), 'Cache-Control': 'no-store' });
  }
  let html = process.env.NODE_ENV === 'production' ? htmlCache.get(file) : null;
  if (!html) {
    try { html = await readFile(path.join(ROOT, file), 'utf8'); } catch { return send(res, 404, 'Not found'); }
    htmlCache.set(file, html);
  }
  const nonce = crypto.randomBytes(16).toString('base64');
  const code = auth.inviteCode();
  const boot = scriptJSON(Object.assign({
    user: auth.publicUser(user), invite: Boolean(code), ai: config().ai,
    inviteHint: code.toUpperCase() === 'PRIMER' ? 'PRIMER' : null // only the public demo code is ever shown
  }, ...BOOT_HOOKS.map((f) => f(user) || {})));
  html = html.replace('</head>', `<script nonce="${nonce}">window.__PRIMER__=${boot};</script>\n</head>`);
  send(res, 200, req.method === 'HEAD' ? undefined : html, TYPES['.html'], {
    ...SECURITY, 'Content-Security-Policy': csp(nonce), 'Cache-Control': 'no-store'
  });
}

async function serveStatic(req, res, pathname, search) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (PAGES.has(file)) return servePage(req, res, file, search);
  if (!/^\/assets\/[A-Za-z0-9_\-./]+$/.test(pathname) || pathname.includes('..') || pathname.includes('/.')) return send(res, 404, 'Not found');
  const full = path.join(ROOT, file);
  if (!full.startsWith(path.join(ROOT, 'assets') + path.sep)) return send(res, 404, 'Not found');
  try {
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ...SECURITY
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'Not found');
  }
}

async function handleApi(req, res, pathname, url) {
  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      // which AI providers have a key, in the order they are tried (never the keys themselves)
      const cfg = config();
      return sendJSON(res, 200, { ok: true, ai: cfg.ai, providers: cfg.providers, models: cfg.models });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') checkOrigin(req);
    const hit = matchRoute(ROUTES, req.method, pathname);
    if (!hit) return sendJSON(res, 404, { ok: false, error: 'Unknown endpoint.' });
    await hit.handler({ req, res, params: hit.params, url });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (!(err instanceof HttpError)) console.error('[primer]', err);
    if (!res.headersSent) sendJSON(res, status, { ok: false, error: err instanceof HttpError ? err.message : 'Something went wrong on the server.' });
  }
}

const server = http.createServer((req, res) => {
  let url, pathname;
  try {
    url = new URL(req.url, 'http://x');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname, url);
  const raw = matchRoute(RAW_ROUTES, req.method, pathname);
  if (raw) {
    return raw.handler({ req, res, params: raw.params, url }).catch((err) => {
      if (!(err instanceof HttpError)) console.error('[primer]', err);
      send(res, err.status || 500, err instanceof HttpError ? err.message : 'Server error');
    });
  }
  return serveStatic(req, res, pathname, url.search);
});

server.listen(PORT, HOST, () => {
  const cfg = config();
  console.log(`[primer] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(cfg.ai
    ? `[primer] AI on: ${cfg.providers.map((p) => `${p.name} (${p.models.join(', ')})`).join(' -> ')}`
    : '[primer] AI off: add GROQ_KEY, ADAP, GEM_KEY, REQ_KEY or OPENROUTER_API_KEY to .env');
  console.log(auth.inviteCode() ? '[primer] Sign-up needs the invite code set in INVITE_CODE (default PRIMER)' : '[primer] Sign-up is open to anyone');
});
