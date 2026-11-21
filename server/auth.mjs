// =====================================================================
// Accounts and sessions.
//
// - Passwords: argon2id through Node's built-in crypto.argon2 (OWASP's
//   settings: 19 MiB memory, 2 passes, 1 lane), stored as PHC strings.
// - Sessions: a random 256-bit token in an HttpOnly, SameSite=Lax cookie.
//   Only its SHA-256 is stored, so a leaked database can't be replayed.
// - Sign-up needs the invite code from INVITE_CODE in .env (default
//   PRIMER); set INVITE_CODE= (empty) to open sign-up to anyone.
// - Sign-in failures are rate limited per address and per account, and
//   unknown emails still cost a full argon2id check so timing gives
//   nothing away.
// =====================================================================
import crypto from 'node:crypto';
import { q, now, schema } from './db.mjs';
import { HttpError, sendJSON, readBody, text, parseCookies, setCookie, clientIp, overLimit } from './http.mjs';
import { UI_LANGS } from './langs.mjs';

const COOKIE = 'primer_sid';
const SESSION_DAYS = 30;
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

export const inviteCode = () => (process.env.INVITE_CODE ?? 'PRIMER').trim();

/* ---------------- passwords ---------------- */

function argon2id(password, salt, p) {
  return new Promise((resolve, reject) => {
    crypto.argon2('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      parallelism: p.parallelism,
      tagLength: p.tagLength,
      memory: p.memory,
      passes: p.passes
    }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const b64 = (buf) => buf.toString('base64').replace(/=+$/, '');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await argon2id(password, salt, ARGON);
  return `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, phc) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(String(phc || ''));
  if (!m) return false;
  const expected = Buffer.from(m[5], 'base64');
  const got = await argon2id(password, Buffer.from(m[4], 'base64'), {
    memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: expected.length
  });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// Spent on sign-ins for unknown emails, so they take as long as real ones.
const DUMMY = hashPassword(crypto.randomBytes(18).toString('base64'));

/* ---------------- sessions ---------------- */

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  q('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen, agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, t, t + SESSION_DAYS * 864e5, t, text(req.headers['user-agent'], 200));
  setCookie(req, res, COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
}

// The welcome after sign-up (welcome.html): a name, a date of birth (or just the year, for anyone who
// doesn't know the day) and a language, then the offer of a tour. Accounts made before it count as welcomed.
schema('welcome-1', `
  ALTER TABLE users ADD COLUMN dob TEXT;          -- 'YYYY-MM-DD' or just 'YYYY'; seen only by its owner
  ALTER TABLE users ADD COLUMN welcomed_at INTEGER;
  UPDATE users SET welcomed_at = created_at;
`);

const USER_COLS = 'u.id, u.email, u.name, u.lang, u.created_at, u.dob, u.welcomed_at';

// A date of birth as the learner gave it: 'YYYY-MM-DD', or 'YYYY' alone; between 3 and 110 years ago.
export function cleanDob(v) {
  const s = String(v == null ? '' : v).trim();
  const m = /^([0-9]{4})(?:-([0-9]{2})-([0-9]{2}))?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), year = new Date().getFullYear();
  if (y < year - 110 || y > year - 3) return null;
  if (!m[2]) return m[1];
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3]) || d.getTime() > Date.now()) return null;
  return s;
}
// Age in whole years (from the year alone, if that is all there is), or null.
export function ageOf(dob) {
  const s = cleanDob(dob);
  if (!s) return null;
  const t = new Date();
  let age = t.getFullYear() - Number(s.slice(0, 4));
  if (s.length > 4 && (t.getMonth() + 1 < Number(s.slice(5, 7)) || (t.getMonth() + 1 === Number(s.slice(5, 7)) && t.getDate() < Number(s.slice(8, 10))))) age--;
  return age;
}
// One line for the tutor's prompt: the learner's name, and their age when it is known, so answers suit them.
export function learnerLine(u) {
  const age = u && ageOf(u.dob);
  const who = (u && u.name) || 'a learner';
  return age != null ? `The learner is ${who}, about ${age} years old: explain in a way that suits that age.` : `The learner is ${who}.`;
}

// The signed-in user for this request, or null. Sessions roll forward while in use.
export function sessionUser(req) {
  if (req._user !== undefined) return req._user;
  const token = parseCookies(req)[COOKIE];
  req._user = null;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const id = sha256(token);
  const row = q(`SELECT ${USER_COLS}, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`).get(id, now());
  if (!row) return null;
  if (now() - row.last_seen > 3600_000) {
    q('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?').run(now(), now() + SESSION_DAYS * 864e5, id);
  }
  req._user = { id: row.id, email: row.email, name: row.name, lang: row.lang, createdAt: row.created_at, dob: row.dob || null, welcomed: Boolean(row.welcomed_at) };
  return req._user;
}

export function requireUser(req) {
  const u = sessionUser(req);
  if (!u) throw new HttpError('Sign in to do that.', 401);
  return u;
}

// welcome: true until the learner has been through welcome.html (name, date of birth, language, tour)
export const publicUser = (u) => (u ? {
  id: u.id, name: u.name, email: u.email, lang: u.lang, dob: u.dob || null,
  welcome: u.welcomed === undefined ? !u.welcomed_at : !u.welcomed
} : null);

/* ---------------- validation ---------------- */

const normEmail = (e) => text(e, 254).toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const LANGS = UI_LANGS; // the interface languages (server/langs.mjs)

function checkInvite(code) {
  const want = inviteCode();
  if (!want) return true;
  const got = Buffer.from(text(code, 40).toUpperCase());
  const exp = Buffer.from(want.toUpperCase());
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

/* ---------------- routes ---------------- */

async function me({ req, res }) {
  sendJSON(res, 200, { ok: true, user: publicUser(sessionUser(req)), invite: Boolean(inviteCode()) });
}

async function invite({ req, res }) {
  if (overLimit('invite:' + clientIp(req), 20, 15 * 60_000)) throw new HttpError('Too many tries. Wait a few minutes and try again.', 429);
  const body = await readBody(req, 2_000);
  if (!checkInvite(body.code)) throw new HttpError('That code isn’t valid. Try again.', 400);
  sendJSON(res, 200, { ok: true });
}

async function signup({ req, res }) {
  if (overLimit('signup:' + clientIp(req), 10, 60 * 60_000)) throw new HttpError('Too many new accounts from here. Try again later.', 429);
  const body = await readBody(req, 4_000);
  if (!checkInvite(body.invite)) throw new HttpError('That invite code isn’t valid.', 400);
  const name = text(body.name, 60); // optional: the welcome right after asks for it (welcome.html)
  const email = normEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const errors = {};
  if (!validEmail(email)) errors.email = 'Enter an email address, like you@gmail.com.';
  if (password.length < 8) errors.password = 'Use at least 8 characters.';
  else if (password.length > 200) errors.password = 'Use 200 characters or fewer.';
  else if (password.toLowerCase() === email) errors.password = 'Don’t use your email as your password.';
  if (Object.keys(errors).length) return sendJSON(res, 400, { ok: false, error: Object.values(errors)[0], fields: errors });
  if (q('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return sendJSON(res, 409, { ok: false, error: 'An account already uses this email.', fields: { email: 'An account already uses this email.' } });
  }
  const pass = await hashPassword(password);
  let id;
  try {
    // the language they were already reading Primer in, so the welcome that follows is in it too
    const lang = LANGS.has(body.lang) ? body.lang : 'en';
    id = Number(q('INSERT INTO users (email, name, pass, lang, created_at) VALUES (?, ?, ?, ?, ?)').run(email, name, pass, lang, now()).lastInsertRowid);
  } catch {
    return sendJSON(res, 409, { ok: false, error: 'An account already uses this email.', fields: { email: 'An account already uses this email.' } });
  }
  startSession(req, res, id);
  const lang = q('SELECT lang FROM users WHERE id = ?').get(id).lang;
  sendJSON(res, 201, { ok: true, user: { id, name, email, lang, dob: null, welcome: true } });
}

async function signin({ req, res }) {
  const ip = clientIp(req);
  if (overLimit('signin:' + ip, 30, 15 * 60_000)) throw new HttpError('Too many sign-in attempts. Wait a few minutes and try again.', 429);
  const body = await readBody(req, 2_000);
  const email = normEmail(body.email);
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (overLimit('signin-acct:' + email, 10, 15 * 60_000)) throw new HttpError('Too many attempts for this account. Wait 15 minutes and try again.', 429);
  const row = validEmail(email) ? q('SELECT id, email, name, lang, pass, dob, welcomed_at FROM users WHERE email = ?').get(email) : null;
  const ok = row ? await verifyPassword(password, row.pass) : (await verifyPassword(password, await DUMMY), false);
  if (!ok) throw new HttpError('That email and password don’t match an account.', 401);
  startSession(req, res, row.id);
  sendJSON(res, 200, { ok: true, user: publicUser(row) });
}

async function signout({ req, res }) {
  const token = parseCookies(req)[COOKIE];
  if (token) q('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  setCookie(req, res, COOKIE, '', { maxAge: 0 });
  sendJSON(res, 200, { ok: true });
}

async function updateMe({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 2_000);
  if (body.name != null) {
    const name = text(body.name, 60);
    if (!name) throw new HttpError('Enter your name.', 400);
    q('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
  }
  if (body.lang != null) {
    if (!LANGS.has(body.lang)) throw new HttpError('That language isn’t available yet.', 400);
    q('UPDATE users SET lang = ? WHERE id = ?').run(body.lang, u.id);
  }
  if (body.dob !== undefined) {
    // '' or null takes it away again; otherwise a full date, or a year alone
    const dob = body.dob ? cleanDob(body.dob) : null;
    if (body.dob && !dob) throw new HttpError('That date of birth doesn’t look right. Check the year.', 400);
    q('UPDATE users SET dob = ? WHERE id = ?').run(dob, u.id);
  }
  if (body.welcomed === true) q('UPDATE users SET welcomed_at = COALESCE(welcomed_at, ?) WHERE id = ?').run(now(), u.id);
  const row = q('SELECT id, email, name, lang, dob, welcomed_at FROM users WHERE id = ?').get(u.id);
  sendJSON(res, 200, { ok: true, user: publicUser(row) });
}

export const routes = [
  ['GET', /^\/api\/auth\/me$/, me],
  ['POST', /^\/api\/auth\/invite$/, invite],
  ['POST', /^\/api\/auth\/signup$/, signup],
  ['POST', /^\/api\/auth\/signin$/, signin],
  ['POST', /^\/api\/auth\/signout$/, signout],
  ['PUT', /^\/api\/me$/, updateMe]
];
