// =====================================================================
// Primer's database: one SQLite file (data/primer.db) through Node's
// built-in node:sqlite, so there is nothing to install.
//
// Each feature module calls schema('name', sql) once at import. A named
// step runs a single time and is recorded in _migrations, so modules can
// add their own tables without stepping on each other.
// =====================================================================
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.PRIMER_DB || path.join(DATA_DIR, 'primer.db');
mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000; PRAGMA synchronous = NORMAL;');
db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function schema(name, sql) {
  if (db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)) return;
  tx(() => {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
  });
  console.log(`[db] applied ${name}`);
}

// Prepared statements are cached by their SQL text.
const cache = new Map();
export function q(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}

export const now = () => Date.now();

export function parseJSON(s, fallback = null) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// ---------------------------------------------------------------------
// Core tables: accounts, sessions, and everything a learner saves.
// ---------------------------------------------------------------------
schema('core-1', `
  CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    pass        TEXT NOT NULL,            -- argon2id, PHC string
    lang        TEXT NOT NULL DEFAULT 'en',
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,         -- SHA-256 of the cookie token; the token itself is never stored
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    agent       TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE courses (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data        TEXT NOT NULL,            -- JSON: topic, title, range, instructions, style, source, model, units
    folder_id   INTEGER,
    created_at  INTEGER NOT NULL,
    opened_at   INTEGER NOT NULL,
    last_lesson INTEGER
  );
  CREATE INDEX courses_user ON courses(user_id, opened_at DESC);

  CREATE TABLE lessons (
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    n           INTEGER NOT NULL,
    data        TEXT NOT NULL,
    model       TEXT,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (course_id, n)
  );

  CREATE TABLE progress (
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    n           INTEGER NOT NULL,
    data        TEXT NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (course_id, n)
  );

  CREATE TABLE doubts (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id    TEXT REFERENCES courses(id) ON DELETE CASCADE,
    lesson_n     INTEGER,
    lesson_title TEXT,
    kind         TEXT NOT NULL,           -- selection | drawing | general
    section      TEXT,
    quote        TEXT,
    context      TEXT,
    question     TEXT NOT NULL,
    image        TEXT,                    -- the sketch, as a JPEG data URL
    answer       TEXT,
    answer_model TEXT,
    answered_at  INTEGER,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX doubts_user ON doubts(user_id, created_at DESC);
  CREATE INDEX doubts_lesson ON doubts(course_id, lesson_n);

  CREATE TABLE notes (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_n    INTEGER NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    sketch      TEXT,                     -- JSON strokes drawn over the lesson
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, course_id, lesson_n)
  );

  CREATE TABLE mistakes (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   TEXT REFERENCES courses(id) ON DELETE CASCADE,
    lesson_n    INTEGER,
    lesson_title TEXT,
    prompt      TEXT NOT NULL,
    given       TEXT,
    correct     TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX mistakes_user ON mistakes(user_id, created_at DESC);
`);

// Expired sessions are cleared at start-up and once a day.
function purgeSessions() { q('DELETE FROM sessions WHERE expires_at < ?').run(now()); }
purgeSessions();
setInterval(purgeSessions, 24 * 3600 * 1000).unref();
