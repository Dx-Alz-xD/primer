// =====================================================================
// Folders: a learner groups courses under a name ("General Topic").
//   - list, create, rename and delete folders (a deleted folder's courses
//     stay in the library, unfiled), and move a course between folders.
//   - /api/outline and /api/courses file a new course in a folder through
//     hooks.ownFolder, so bulk-adding topics is just one outline per topic.
//   - The fit check asks the AI, in one request per batch, whether each
//     topic belongs under the folder's name. The answer is kept on the
//     course as data.folderFit = { folderId, folder, ok, reason, dismissed }
//     and the page shows a quiet warning when ok is false. If the AI can't
//     be reached the check is skipped without a fuss.
// =====================================================================
import { q, tx, now, schema, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody, text } from './http.mjs';
import { requireUser } from './auth.mjs';
import { hooks, ownCourse } from './data.mjs';
import { checkFolderFit } from './ai.mjs';

schema('folders-1', `
  CREATE TABLE folders (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX folders_user ON folders(user_id, created_at);
  CREATE INDEX courses_folder ON courses(user_id, folder_id);
`);

const MAX_FOLDERS = 100;
const MAX_FIT_BATCH = 40;

export function ownFolder(user, id) {
  const n = Number(id);
  const row = Number.isInteger(n) && n > 0 ? q('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(n, user.id) : null;
  if (!row) throw new HttpError('That folder doesn’t exist.', 404);
  return row;
}
hooks.ownFolder = ownFolder;

const folderOut = (f, count = 0) => ({ id: f.id, name: f.name, createdAt: f.created_at, courses: count });

function cleanName(user, raw, exceptId = 0) {
  const name = text(raw, 60);
  if (!name) throw new HttpError('Give the folder a name.', 400);
  const clash = q('SELECT name FROM folders WHERE user_id = ? AND lower(name) = lower(?) AND id <> ?').get(user.id, name, exceptId);
  if (clash) throw new HttpError(`You already have a folder called “${clash.name}”.`, 409);
  return name;
}

async function listFolders({ req, res }) {
  const u = requireUser(req);
  const counts = new Map(q('SELECT folder_id, COUNT(*) AS n FROM courses WHERE user_id = ? AND folder_id IS NOT NULL GROUP BY folder_id')
    .all(u.id).map((r) => [r.folder_id, r.n]));
  const rows = q('SELECT * FROM folders WHERE user_id = ? ORDER BY lower(name), id').all(u.id);
  sendJSON(res, 200, { ok: true, folders: rows.map((f) => folderOut(f, counts.get(f.id) || 0)) });
}

async function createFolder({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 2_000);
  const name = cleanName(u, body.name);
  if (q('SELECT COUNT(*) AS n FROM folders WHERE user_id = ?').get(u.id).n >= MAX_FOLDERS) {
    throw new HttpError(`You can have up to ${MAX_FOLDERS} folders. Delete one you no longer use first.`, 400);
  }
  const id = Number(q('INSERT INTO folders (user_id, name, created_at) VALUES (?, ?, ?)').run(u.id, name, now()).lastInsertRowid);
  sendJSON(res, 201, { ok: true, folder: folderOut(ownFolder(u, id)) });
}

async function renameFolder({ req, res, params }) {
  const u = requireUser(req);
  const f = ownFolder(u, params.id);
  const body = await readBody(req, 2_000);
  const name = cleanName(u, body.name, f.id);
  q('UPDATE folders SET name = ? WHERE id = ?').run(name, f.id);
  const count = q('SELECT COUNT(*) AS n FROM courses WHERE user_id = ? AND folder_id = ?').get(u.id, f.id).n;
  sendJSON(res, 200, { ok: true, folder: folderOut({ ...f, name }, count) });
}

// The folder goes; its courses stay in the library, unfiled.
async function deleteFolder({ req, res, params }) {
  const u = requireUser(req);
  const f = ownFolder(u, params.id);
  const unfiled = tx(() => {
    const n = Number(q("UPDATE courses SET folder_id = NULL, data = json_remove(data, '$.folderFit') WHERE user_id = ? AND folder_id = ?").run(u.id, f.id).changes);
    q('DELETE FROM folders WHERE id = ?').run(f.id);
    return n;
  });
  sendJSON(res, 200, { ok: true, unfiled });
}

// Moves a course into a folder (or out of every folder with folderId: null).
// Any earlier fit result belonged to the old folder, so it is dropped.
async function moveCourse({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const body = await readBody(req, 1_000);
  const folderId = body.folderId == null || body.folderId === '' ? null : ownFolder(u, body.folderId).id;
  if (folderId !== (row.folder_id ?? null)) {
    const meta = parseJSON(row.data, {});
    delete meta.folderFit;
    q('UPDATE courses SET folder_id = ?, data = ? WHERE id = ?').run(folderId, JSON.stringify(meta), row.id);
  }
  sendJSON(res, 200, { ok: true, folderId });
}

/* ---------------- does each topic belong in the folder? ---------------- */

// After a failed check (AI busy, quota used up, no key) nobody's checks run for a while,
// so pages that ask on load don't keep spending the shared free requests.
let retryAt = 0;
const BACKOFF_MS = 10 * 60_000;

async function fitCheck({ req, res, params }) {
  const u = requireUser(req);
  const f = ownFolder(u, params.id);
  const body = await readBody(req, 6_000);
  const ids = [...new Set((Array.isArray(body.courseIds) ? body.courseIds : []).filter((x) => typeof x === 'string'))].slice(0, MAX_FIT_BATCH);
  const rows = ids.map((id) => q('SELECT id, data FROM courses WHERE id = ? AND user_id = ? AND folder_id = ?').get(id, u.id, f.id)).filter(Boolean);
  if (!rows.length) return sendJSON(res, 200, { ok: true, results: {} });
  if (retryAt > Date.now()) return sendJSON(res, 200, { ok: true, results: {}, skipped: true });

  const topics = rows.map((r) => text(parseJSON(r.data, {}).topic, 120) || 'Untitled');
  let answers;
  try {
    answers = await checkFolderFit(f.name, topics);
  } catch (err) {
    retryAt = Date.now() + BACKOFF_MS;
    console.log(`[folders] fit check for "${f.name}" skipped: ${err.message}`);
    return sendJSON(res, 200, { ok: true, results: {}, skipped: true });
  }

  const results = {};
  const at = now();
  rows.forEach((r, i) => {
    // The AI answered for the batch, so a topic it left out counts as fitting rather than asking again.
    const a = answers[i] || { ok: true, reason: '' };
    // Re-read: the course may have moved or been renamed while the AI was thinking.
    const cur = q('SELECT data FROM courses WHERE id = ? AND user_id = ? AND folder_id = ?').get(r.id, u.id, f.id);
    if (!cur) return;
    const meta = parseJSON(cur.data, {});
    const fit = { folderId: f.id, folder: f.name, ok: a.ok, reason: a.ok ? '' : text(a.reason, 160), at };
    if (meta.folderFit && meta.folderFit.dismissed && meta.folderFit.folderId === f.id && meta.folderFit.folder === f.name) fit.dismissed = true;
    meta.folderFit = fit;
    q('UPDATE courses SET data = ? WHERE id = ?').run(JSON.stringify(meta), r.id);
    results[r.id] = fit;
  });
  sendJSON(res, 200, { ok: true, results });
}

async function dismissFit({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const meta = parseJSON(row.data, {});
  if (meta.folderFit) {
    meta.folderFit.dismissed = true;
    q('UPDATE courses SET data = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
  }
  sendJSON(res, 200, { ok: true });
}

export const routes = [
  ['GET', /^\/api\/folders$/, listFolders],
  ['POST', /^\/api\/folders$/, createFolder],
  ['PATCH', /^\/api\/folders\/(?<id>\d+)$/, renameFolder],
  ['DELETE', /^\/api\/folders\/(?<id>\d+)$/, deleteFolder],
  ['POST', /^\/api\/folders\/(?<id>\d+)\/fit$/, fitCheck],
  ['PUT', /^\/api\/courses\/(?<id>[^/]+)\/folder$/, moveCourse],
  ['POST', /^\/api\/courses\/(?<id>[^/]+)\/folder-fit\/dismiss$/, dismissFit]
];
