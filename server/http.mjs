// =====================================================================
// Small HTTP helpers shared by every route module.
// =====================================================================

export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

export function sendJSON(res, status, obj, extra = {}) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...extra });
}

// Reads the request body as a Buffer, refusing anything over `limit` bytes.
export function readRaw(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) { reject(new HttpError('That request is too large.', 413)); req.resume(); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError('That request is too large.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readBody(req, limit = 100_000) {
  const type = String(req.headers['content-type'] || '');
  if (!/^application\/json\b/i.test(type)) throw new HttpError('Send the request as JSON.', 415);
  const buf = await readRaw(req, limit);
  try {
    const v = JSON.parse(buf.toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch {
    throw new HttpError('The request body is not valid JSON.', 400);
  }
}

// Collapses whitespace and trims to `max` characters; anything that isn't a string becomes ''.
export const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
// Like text(), but keeps line breaks (for notes, posts and comments).
export const longText = (v, max) => (typeof v === 'string'
  ? v.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
  : '');

export function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie: ignore it */ }
  });
  return out;
}

export function isSecure(req) {
  return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

export function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : [cookie]);
}

export function setCookie(req, res, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (httpOnly) parts.push('HttpOnly');
  if (isSecure(req)) parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

// State-changing requests must come from our own pages. Browsers always send Origin on
// cross-site POSTs, so a mismatch means another site is trying to act as the user.
export function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError('Request refused.', 403); }
  if (host !== req.headers.host) throw new HttpError('Request refused.', 403);
}

export function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

// Fixed-window rate limiter kept in memory. Returns true when the caller is over the limit.
const buckets = new Map();
export function overLimit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= t) { b = { count: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.count++;
  if (buckets.size > 20_000) for (const [k, v] of buckets) if (v.reset <= t) buckets.delete(k);
  return b.count > max;
}

// Tiny router: routes are [method, /pattern/ with named groups, handler(ctx)].
export function matchRoute(routes, method, pathname) {
  for (const [m, re, handler] of routes) {
    if (m !== method && !(m === 'GET' && method === 'HEAD')) continue;
    const hit = re.exec(pathname);
    if (hit) return { handler, params: hit.groups || {} };
  }
  return null;
}
