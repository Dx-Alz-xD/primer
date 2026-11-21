// =====================================================================
// Community board: a public place to share sources, write posts, add
// photos and talk in threads. Anyone can read; posting, commenting and
// voting need an account.
//
//   Posts     title, plain-text body, up to 10 sources (http/https links),
//             up to 4 photos and an optional topic tag.
//   Comments  threaded replies (parent_id); authors can edit and delete.
//   Votes     +1 or -1 per account on posts and comments. Posts keep a
//             cached score and a "hot" rank (score with time decay).
//   Photos    sent raw to POST /api/community/images, checked by their
//             magic bytes (never SVG), kept in data/uploads/ and served
//             from /uploads/<name> under a sandboxing CSP, so a file can
//             never act as a page.
//
// Deleting a post or comment that has replies keeps it as "[deleted]" so
// the thread still reads; anything without replies is removed for good.
// Authors are shown by first name and last initial, never by email.
// =====================================================================
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { q, tx, now, schema, parseJSON, DATA_DIR } from './db.mjs';
import { HttpError, send, sendJSON, readBody, readRaw, text, longText, overLimit } from './http.mjs';
import { requireUser, sessionUser } from './auth.mjs';

schema('community-1', `
  CREATE TABLE community_posts (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    sources     TEXT NOT NULL DEFAULT '[]',  -- JSON [{ url, label }]
    images      TEXT NOT NULL DEFAULT '[]',  -- JSON [{ name, alt }]
    tag         TEXT,                        -- topic as typed
    tag_key     TEXT,                        -- lower case, for filtering
    score       INTEGER NOT NULL DEFAULT 0,
    hot         REAL NOT NULL DEFAULT 0,
    comments    INTEGER NOT NULL DEFAULT 0,  -- comments that aren't deleted
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    edited_at   INTEGER
  );
  CREATE INDEX community_posts_new ON community_posts(created_at DESC);
  CREATE INDEX community_posts_hot ON community_posts(hot DESC);
  CREATE INDEX community_posts_top ON community_posts(score DESC, created_at DESC);
  CREATE INDEX community_posts_tag ON community_posts(tag_key, created_at DESC);
  CREATE INDEX community_posts_user ON community_posts(user_id);

  CREATE TABLE community_comments (
    id          INTEGER PRIMARY KEY,
    post_id     INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    parent_id   INTEGER REFERENCES community_comments(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    depth       INTEGER NOT NULL DEFAULT 0,
    body        TEXT NOT NULL,
    score       INTEGER NOT NULL DEFAULT 0,
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    edited_at   INTEGER
  );
  CREATE INDEX community_comments_post ON community_comments(post_id, created_at);
  CREATE INDEX community_comments_parent ON community_comments(parent_id);
  CREATE INDEX community_comments_user ON community_comments(user_id);

  CREATE TABLE community_post_votes (
    post_id     INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE INDEX community_post_votes_user ON community_post_votes(user_id);

  CREATE TABLE community_comment_votes (
    comment_id  INTEGER NOT NULL REFERENCES community_comments(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (comment_id, user_id)
  );
  CREATE INDEX community_comment_votes_user ON community_comment_votes(user_id);

  CREATE TABLE community_images (
    name        TEXT PRIMARY KEY,            -- <32 hex>.<ext>, the file in data/uploads
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     INTEGER REFERENCES community_posts(id) ON DELETE SET NULL,
    type        TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX community_images_post ON community_images(post_id);
  CREATE INDEX community_images_loose ON community_images(created_at) WHERE post_id IS NULL;
`);

/* ---------------- limits ---------------- */

const MAX_TITLE = 160;
const MAX_BODY = 20_000;
const MAX_COMMENT = 5_000;
const MAX_SOURCES = 10;
const MAX_PHOTOS = 4;
const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_DEPTH = 40;
const MAX_THREAD = 3_000;
const HOUR = 3600_000;

const UPLOAD_DIR = process.env.PRIMER_UPLOADS || path.join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const IMAGE_NAME = /^[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/;

/* ---------------- small helpers ---------------- */

const clampInt = (v, lo, hi, d) => {
  if (v == null || v === '') return d;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const tagKey = (v) => text(String(v || '').replace(/^#+/, ''), 40).toLowerCase();

// "Ada Lovelace" -> "Ada L.": enough to know who's talking, without full names on a public page.
function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A reader';
  const first = Array.from(parts[0]).slice(0, 30).join('');
  if (parts.length === 1) return first;
  return `${first} ${Array.from(parts[parts.length - 1])[0].toUpperCase()}.`;
}

// Reddit-style ranking: ten times the votes buys about 12.5 hours of freshness. Using
// log10(1 + votes) rather than Reddit's log10(votes) means the first vote counts too,
// which matters on a small board.
function hotRank(score, createdAt) {
  const order = Math.log10(1 + Math.abs(score));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  return Math.round((sign * order + (createdAt / 1000 - 1_700_000_000) / 45_000) * 1e7) / 1e7;
}

function excerpt(body, max = 280) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:]+$/, '') + '…';
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const removeFile = (name) => (IMAGE_NAME.test(name) ? unlink(path.join(UPLOAD_DIR, name)).catch(() => {}) : Promise.resolve());

/* ---------------- input cleaning ---------------- */

function cleanSources(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new HttpError('The sources aren’t in the right shape.', 400);
  if (list.length > MAX_SOURCES) throw new HttpError(`Add up to ${MAX_SOURCES} sources.`, 400);
  const out = [];
  const seen = new Set();
  list.forEach((s, i) => {
    const raw = typeof s === 'string' ? s : s && s.url;
    const label = text(s && typeof s === 'object' ? s.label : '', 120);
    const link = text(raw, 2000);
    if (!link) {
      if (label) throw new HttpError(`Source ${i + 1} needs a link.`, 400);
      return;
    }
    let u;
    try { u = new URL(link); } catch { throw new HttpError(`Source ${i + 1} isn’t a full web link. Start it with https://`, 400); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(`Source ${i + 1} must be a web link that starts with http:// or https://`, 400);
    if (u.username || u.password) throw new HttpError(`Source ${i + 1} has a username or password in it. Take them out and try again.`, 400);
    if (seen.has(u.href)) return;
    seen.add(u.href);
    out.push({ url: u.href, label });
  });
  return out;
}

// Photos must have been uploaded by this account and not be part of another post.
function cleanImages(list, userId, postId) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new HttpError('The photos aren’t in the right shape.', 400);
  if (list.length > MAX_PHOTOS) throw new HttpError(`Add up to ${MAX_PHOTOS} photos.`, 400);
  const out = [];
  const seen = new Set();
  for (const im of list) {
    const name = typeof im === 'string' ? im : im && im.name;
    const missing = new HttpError('One of the photos couldn’t be found. Remove it and add it again.', 400);
    if (typeof name !== 'string' || !IMAGE_NAME.test(name) || seen.has(name)) throw missing;
    const row = q('SELECT post_id FROM community_images WHERE name = ? AND user_id = ?').get(name, userId);
    if (!row || (row.post_id != null && row.post_id !== postId)) throw missing;
    seen.add(name);
    out.push({ name, alt: text(im && typeof im === 'object' ? im.alt : '', 200) });
  }
  return out;
}

// A new post takes every field from the body; an edit keeps whatever the body leaves out.
function cleanPost(body, user, existing) {
  const given = (k) => body[k] !== undefined || !existing;
  const title = given('title') ? text(body.title, MAX_TITLE) : existing.title;
  if (!title) throw new HttpError('Give your post a title.', 400);
  const tag = (given('tag') ? text(String(body.tag || '').replace(/^#+/, ''), 40) : existing.tag) || null;
  return {
    title,
    body: given('body') ? longText(body.body, MAX_BODY) : existing.body,
    sources: given('sources') ? cleanSources(body.sources) : parseJSON(existing.sources, []),
    images: given('images') ? cleanImages(body.images, user.id, existing ? existing.id : null) : parseJSON(existing.images, []),
    tag,
    tagKey: tag ? tag.toLowerCase() : null
  };
}

function parseVote(body) {
  const v = Number(body.value);
  if (v !== 1 && v !== -1 && v !== 0) throw new HttpError('A vote is up (1), down (-1) or none (0).', 400);
  return v;
}

/* ---------------- loading and shaping ---------------- */

const POST_SELECT = `SELECT p.*, u.name AS author_name, COALESCE(v.value, 0) AS my_vote
  FROM community_posts p JOIN users u ON u.id = p.user_id
  LEFT JOIN community_post_votes v ON v.post_id = p.id AND v.user_id = ?`;

function postRow(id, viewer) {
  const n = Number(id);
  const row = Number.isSafeInteger(n) ? q(`${POST_SELECT} WHERE p.id = ?`).get(viewer ? viewer.id : 0, n) : null;
  if (!row) throw new HttpError('That post isn’t here. It may have been deleted.', 404);
  return row;
}

function ownPost(user, id) {
  const row = postRow(id, user);
  if (row.deleted) throw new HttpError('That post was already deleted.', 404);
  if (row.user_id !== user.id) throw new HttpError('You can only change your own posts.', 403);
  return row;
}

const imageOut = (im) => ({ name: im.name, alt: im.alt || '', url: '/uploads/' + im.name });

function postOut(r, viewer, full) {
  const dead = Boolean(r.deleted);
  const sources = dead ? [] : parseJSON(r.sources, []);
  const images = dead ? [] : parseJSON(r.images, []).map(imageOut);
  const out = {
    id: r.id,
    title: dead ? '' : r.title,
    tag: dead ? null : r.tag,
    deleted: dead,
    author: dead ? null : { name: shortName(r.author_name) },
    mine: !dead && Boolean(viewer && viewer.id === r.user_id),
    createdAt: r.created_at,
    editedAt: dead ? null : r.edited_at ?? null,
    score: r.score,
    myVote: r.my_vote || 0,
    comments: r.comments
  };
  if (full) {
    out.body = dead ? '' : r.body;
    out.sources = sources;
    out.images = images;
  } else {
    out.excerpt = dead ? '' : excerpt(r.body);
    out.sourceCount = sources.length;
    out.domains = [...new Set(sources.map((s) => hostOf(s.url)).filter(Boolean))].slice(0, 3);
    out.image = images[0] || null;
    out.imageCount = images.length;
  }
  return out;
}

const COMMENT_SELECT = `SELECT c.*, u.name AS author_name, COALESCE(v.value, 0) AS my_vote
  FROM community_comments c JOIN users u ON u.id = c.user_id
  LEFT JOIN community_comment_votes v ON v.comment_id = c.id AND v.user_id = ?`;

function commentRow(id, viewer) {
  const n = Number(id);
  const row = Number.isSafeInteger(n) ? q(`${COMMENT_SELECT} WHERE c.id = ?`).get(viewer ? viewer.id : 0, n) : null;
  if (!row) throw new HttpError('That comment isn’t here. It may have been deleted.', 404);
  return row;
}

function commentOut(c, viewer, opId) {
  const dead = Boolean(c.deleted);
  return {
    id: c.id,
    postId: c.post_id,
    parentId: c.parent_id ?? null,
    depth: c.depth,
    body: dead ? '' : c.body,
    deleted: dead,
    author: dead ? null : { name: shortName(c.author_name) },
    op: !dead && opId != null && c.user_id === opId,
    mine: !dead && Boolean(viewer && viewer.id === c.user_id),
    createdAt: c.created_at,
    editedAt: dead ? null : c.edited_at ?? null,
    score: c.score,
    myVote: c.my_vote || 0
  };
}

function limit(key, max, message) {
  if (overLimit(key, max, HOUR)) throw new HttpError(message, 429);
}

/* ---------------- posts ---------------- */

const SORTS = {
  hot: 'p.hot DESC, p.id DESC',
  new: 'p.created_at DESC, p.id DESC',
  top: 'p.score DESC, p.created_at DESC, p.id DESC'
};
const SPANS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };

async function listPosts({ req, res, url }) {
  const viewer = sessionUser(req);
  const sp = url.searchParams;
  const sort = Object.hasOwn(SORTS, sp.get('sort')) ? sp.get('sort') : 'hot';
  const tag = tagKey(sp.get('tag'));
  const search = text(sp.get('q'), 100);
  const like = '%' + search.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const span = sort === 'top' && Object.hasOwn(SPANS, sp.get('t')) ? SPANS[sp.get('t')] : 0;
  const since = span ? now() - span : 0;
  const size = clampInt(sp.get('limit'), 1, 50, 20);
  const offset = clampInt(sp.get('offset'), 0, 100_000, 0);
  const rows = q(`${POST_SELECT}
    WHERE (? = '' OR p.tag_key = ?) AND (? = '' OR p.title LIKE ? ESCAPE '\\') AND p.created_at >= ?
    ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`)
    .all(viewer ? viewer.id : 0, tag, tag, search, like, since, size + 1, offset);
  sendJSON(res, 200, {
    ok: true,
    sort,
    posts: rows.slice(0, size).map((r) => postOut(r, viewer, false)),
    more: rows.length > size,
    next: offset + Math.min(rows.length, size)
  });
}

async function listTags({ res }) {
  const rows = q(`SELECT tag_key, COUNT(*) AS n, MAX(created_at) AS last,
      (SELECT tag FROM community_posts p2 WHERE p2.tag_key = p.tag_key AND p2.deleted = 0 ORDER BY created_at DESC LIMIT 1) AS tag
    FROM community_posts p WHERE deleted = 0 AND tag_key IS NOT NULL
    GROUP BY tag_key ORDER BY n DESC, last DESC LIMIT 16`).all();
  sendJSON(res, 200, { ok: true, tags: rows.map((r) => ({ tag: r.tag, count: r.n })) });
}

async function getPost({ req, res, params }) {
  const viewer = sessionUser(req);
  const row = postRow(params.id, viewer);
  const comments = q(`${COMMENT_SELECT} WHERE c.post_id = ? ORDER BY c.created_at, c.id LIMIT ${MAX_THREAD}`)
    .all(viewer ? viewer.id : 0, row.id);
  sendJSON(res, 200, {
    ok: true,
    post: postOut(row, viewer, true),
    comments: comments.map((c) => commentOut(c, viewer, row.deleted ? null : row.user_id))
  });
}

async function createPost({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 120_000);
  const p = cleanPost(body, u, null);
  limit('community-post:' + u.id, 10, 'You’ve shared 10 posts in the last hour. Take a break and post again later.');
  const t = now();
  const id = tx(() => {
    const id = Number(q(`INSERT INTO community_posts (user_id, title, body, sources, images, tag, tag_key, score, hot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(u.id, p.title, p.body, JSON.stringify(p.sources), JSON.stringify(p.images), p.tag, p.tagKey, hotRank(0, t), t).lastInsertRowid);
    for (const im of p.images) q('UPDATE community_images SET post_id = ? WHERE name = ?').run(id, im.name);
    return id;
  });
  sendJSON(res, 201, { ok: true, post: postOut(postRow(id, u), u, true) });
}

async function editPost({ req, res, params }) {
  const u = requireUser(req);
  const body = await readBody(req, 120_000);
  const row = ownPost(u, params.id);
  const p = cleanPost(body, u, row);
  limit('community-edit:' + u.id, 120, 'You’ve made a lot of edits in the last hour. Try again later.');
  const before = parseJSON(row.images, []).map((im) => im.name);
  const keep = new Set(p.images.map((im) => im.name));
  const dropped = before.filter((n) => !keep.has(n));
  tx(() => {
    q(`UPDATE community_posts SET title = ?, body = ?, sources = ?, images = ?, tag = ?, tag_key = ?, edited_at = ? WHERE id = ?`)
      .run(p.title, p.body, JSON.stringify(p.sources), JSON.stringify(p.images), p.tag, p.tagKey, now(), row.id);
    for (const im of p.images) q('UPDATE community_images SET post_id = ? WHERE name = ?').run(row.id, im.name);
    for (const name of dropped) q('DELETE FROM community_images WHERE name = ? AND post_id = ?').run(name, row.id);
  });
  dropped.forEach(removeFile);
  sendJSON(res, 200, { ok: true, post: postOut(postRow(row.id, u), u, true) });
}

async function deletePost({ req, res, params }) {
  const u = requireUser(req);
  const row = ownPost(u, params.id);
  const photos = q('SELECT name FROM community_images WHERE post_id = ?').all(row.id).map((r) => r.name);
  const kept = Boolean(q('SELECT 1 FROM community_comments WHERE post_id = ? LIMIT 1').get(row.id));
  tx(() => {
    q('DELETE FROM community_images WHERE post_id = ?').run(row.id);
    if (kept) {
      q(`UPDATE community_posts SET deleted = 1, title = '', body = '', sources = '[]', images = '[]', tag = NULL, tag_key = NULL WHERE id = ?`).run(row.id);
    } else {
      q('DELETE FROM community_posts WHERE id = ?').run(row.id);
    }
  });
  photos.forEach(removeFile);
  sendJSON(res, 200, { ok: true, kept });
}

async function votePost({ req, res, params }) {
  const u = requireUser(req);
  const value = parseVote(await readBody(req, 1_000));
  const row = postRow(params.id, u);
  if (row.deleted) throw new HttpError('That post was deleted, so it can’t take votes.', 400);
  limit('community-vote:' + u.id, 600, 'You’ve voted a lot in the last hour. Try again later.');
  const score = tx(() => {
    if (value === 0) q('DELETE FROM community_post_votes WHERE post_id = ? AND user_id = ?').run(row.id, u.id);
    else {
      q(`INSERT INTO community_post_votes (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (post_id, user_id) DO UPDATE SET value = excluded.value`).run(row.id, u.id, value, now());
    }
    const s = q('SELECT COALESCE(SUM(value), 0) AS s FROM community_post_votes WHERE post_id = ?').get(row.id).s;
    q('UPDATE community_posts SET score = ?, hot = ? WHERE id = ?').run(s, hotRank(s, row.created_at), row.id);
    return s;
  });
  sendJSON(res, 200, { ok: true, score, myVote: value });
}

/* ---------------- comments ---------------- */

async function addComment({ req, res, params }) {
  const u = requireUser(req);
  const body = await readBody(req, 30_000);
  const post = postRow(params.id, u);
  if (post.deleted) throw new HttpError('This post was deleted, so it’s closed to new comments.', 400);
  const words = longText(body.body, MAX_COMMENT);
  if (!words) throw new HttpError('Write your comment first.', 400);
  let parent = null;
  if (body.parentId != null) {
    const pid = Number(body.parentId);
    parent = Number.isSafeInteger(pid) ? q('SELECT id, depth, deleted FROM community_comments WHERE id = ? AND post_id = ?').get(pid, post.id) : null;
    if (!parent) throw new HttpError('The comment you’re replying to isn’t here any more.', 404);
    if (parent.deleted) throw new HttpError('That comment was deleted, so it can’t take replies.', 400);
    if (parent.depth >= MAX_DEPTH) throw new HttpError('This thread is too deep for more replies. Reply further up instead.', 400);
  }
  if (q('SELECT COUNT(*) AS n FROM community_comments WHERE post_id = ?').get(post.id).n >= MAX_THREAD) {
    throw new HttpError('This thread is full. Start a new post to keep talking.', 400);
  }
  limit('community-comment:' + u.id, 60, 'You’ve written 60 comments in the last hour. Take a break and try again later.');
  const id = tx(() => {
    const id = Number(q('INSERT INTO community_comments (post_id, parent_id, user_id, depth, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(post.id, parent ? parent.id : null, u.id, parent ? parent.depth + 1 : 0, words, now()).lastInsertRowid);
    q('UPDATE community_posts SET comments = comments + 1 WHERE id = ?').run(post.id);
    return id;
  });
  sendJSON(res, 201, { ok: true, comment: commentOut(commentRow(id, u), u, post.user_id) });
}

function ownComment(user, id) {
  const c = commentRow(id, user);
  if (c.deleted) throw new HttpError('That comment was already deleted.', 404);
  if (c.user_id !== user.id) throw new HttpError('You can only change your own comments.', 403);
  return c;
}

async function editComment({ req, res, params }) {
  const u = requireUser(req);
  const body = await readBody(req, 30_000);
  const c = ownComment(u, params.id);
  const words = longText(body.body, MAX_COMMENT);
  if (!words) throw new HttpError('A comment can’t be empty. Delete it instead.', 400);
  limit('community-edit:' + u.id, 120, 'You’ve made a lot of edits in the last hour. Try again later.');
  q('UPDATE community_comments SET body = ?, edited_at = ? WHERE id = ?').run(words, now(), c.id);
  const post = q('SELECT user_id, deleted FROM community_posts WHERE id = ?').get(c.post_id);
  sendJSON(res, 200, { ok: true, comment: commentOut(commentRow(c.id, u), u, post && !post.deleted ? post.user_id : null) });
}

async function deleteComment({ req, res, params }) {
  const u = requireUser(req);
  const c = ownComment(u, params.id);
  const kept = tx(() => {
    q('UPDATE community_posts SET comments = MAX(comments - 1, 0) WHERE id = ?').run(c.post_id);
    if (q('SELECT 1 FROM community_comments WHERE parent_id = ? LIMIT 1').get(c.id)) {
      q(`UPDATE community_comments SET deleted = 1, body = '' WHERE id = ?`).run(c.id);
      return true;
    }
    q('DELETE FROM community_comments WHERE id = ?').run(c.id);
    // Deleted comments that were only kept for this reply have nothing left to hold up.
    let pid = c.parent_id;
    while (pid != null) {
      const p = q('SELECT id, parent_id, deleted FROM community_comments WHERE id = ?').get(pid);
      if (!p || !p.deleted || q('SELECT 1 FROM community_comments WHERE parent_id = ? LIMIT 1').get(p.id)) break;
      q('DELETE FROM community_comments WHERE id = ?').run(p.id);
      pid = p.parent_id;
    }
    // The same goes for a deleted post whose last comment just went.
    const post = q('SELECT deleted FROM community_posts WHERE id = ?').get(c.post_id);
    if (post && post.deleted && !q('SELECT 1 FROM community_comments WHERE post_id = ? LIMIT 1').get(c.post_id)) {
      q('DELETE FROM community_posts WHERE id = ?').run(c.post_id);
    }
    return false;
  });
  sendJSON(res, 200, { ok: true, kept });
}

async function voteComment({ req, res, params }) {
  const u = requireUser(req);
  const value = parseVote(await readBody(req, 1_000));
  const c = commentRow(params.id, u);
  if (c.deleted) throw new HttpError('That comment was deleted, so it can’t take votes.', 400);
  limit('community-vote:' + u.id, 600, 'You’ve voted a lot in the last hour. Try again later.');
  const score = tx(() => {
    if (value === 0) q('DELETE FROM community_comment_votes WHERE comment_id = ? AND user_id = ?').run(c.id, u.id);
    else {
      q(`INSERT INTO community_comment_votes (comment_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (comment_id, user_id) DO UPDATE SET value = excluded.value`).run(c.id, u.id, value, now());
    }
    const s = q('SELECT COALESCE(SUM(value), 0) AS s FROM community_comment_votes WHERE comment_id = ?').get(c.id).s;
    q('UPDATE community_comments SET score = ? WHERE id = ?').run(s, c.id);
    return s;
  });
  sendJSON(res, 200, { ok: true, score, myVote: value });
}

/* ---------------- photos ---------------- */

// What the first bytes say the file is, whatever its name or Content-Type claims.
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// Drops the EXIF/XMP (APP1) and Photoshop/IPTC (APP13) blocks from a JPEG, which is where
// phones keep the GPS location. Everything else is copied untouched; if the file doesn't
// parse the way a JPEG should, it is left exactly as it was.
function stripJpegMetadata(buf) {
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xda) { parts.push(buf.subarray(i)); return Buffer.concat(parts); } // image data from here on
    if (marker === 0xd9) { parts.push(buf.subarray(i, i + 2)); return Buffer.concat(parts); }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { parts.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return buf;
    if (marker !== 0xe1 && marker !== 0xed) parts.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return buf;
}

async function uploadImage({ req, res }) {
  const u = requireUser(req);
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  const tooBig = () => new HttpError('That photo is over 4 MB. Choose a smaller one.', 413);
  if (!ext) { req.resume(); throw new HttpError('Photos must be JPEG, PNG, WebP or GIF files.', 415); }
  if (Number(req.headers['content-length']) > MAX_IMAGE) { req.resume(); throw tooBig(); }
  limit('community-image:' + u.id, 40, 'You’ve uploaded 40 photos in the last hour. Try again later.');
  let buf;
  try { buf = await readRaw(req, MAX_IMAGE); } catch (err) { throw err.status === 413 ? tooBig() : err; }
  if (!buf.length) throw new HttpError('That photo is empty.', 400);
  const actual = sniff(buf);
  if (!actual) throw new HttpError('That file isn’t a JPEG, PNG, WebP or GIF image.', 415);
  if (actual !== ext) throw new HttpError('That file isn’t the kind of image it says it is.', 415);
  if (actual === 'jpg') buf = stripJpegMetadata(buf);
  const name = crypto.randomBytes(16).toString('hex') + '.' + actual;
  await writeFile(path.join(UPLOAD_DIR, name), buf, { flag: 'wx' });
  q('INSERT INTO community_images (name, user_id, type, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, u.id, MIME[actual], buf.length, now());
  sendJSON(res, 201, { ok: true, image: { name, url: '/uploads/' + name } });
}

// Removes a photo that was uploaded but never posted (the writer took it out of a draft).
async function deleteImage({ req, res, params }) {
  const u = requireUser(req);
  const row = q('SELECT post_id FROM community_images WHERE name = ? AND user_id = ?').get(params.name, u.id);
  if (!row) throw new HttpError('That photo isn’t here.', 404);
  if (row.post_id != null) throw new HttpError('That photo is part of a post. Edit the post to remove it.', 400);
  q('DELETE FROM community_images WHERE name = ?').run(params.name);
  await removeFile(params.name);
  sendJSON(res, 200, { ok: true });
}

// The file itself. Only names we generated can match, and the headers make sure a
// browser treats it as a picture and nothing else.
async function serveImage({ req, res, params }) {
  let data;
  try { data = await readFile(path.join(UPLOAD_DIR, params.name)); } catch { return send(res, 404, 'Not found'); }
  res.writeHead(200, {
    'Content-Type': MIME[params.name.split('.').pop()],
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'public, max-age=31536000, immutable'
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// Photos uploaded for a post that was never published are cleared after a day.
function sweepUploads() {
  const old = q('SELECT name FROM community_images WHERE post_id IS NULL AND created_at < ?').all(now() - 24 * HOUR);
  if (!old.length) return;
  tx(() => old.forEach((r) => q('DELETE FROM community_images WHERE name = ?').run(r.name)));
  old.forEach((r) => removeFile(r.name));
}
sweepUploads();
setInterval(sweepUploads, HOUR).unref();

export const pages = [
  { file: 'community.html', protected: false },
  { file: 'post.html', protected: false }
];

export const routes = [
  ['GET', /^\/api\/community\/posts$/, listPosts],
  ['POST', /^\/api\/community\/posts$/, createPost],
  ['GET', /^\/api\/community\/tags$/, listTags],
  ['GET', /^\/api\/community\/posts\/(?<id>\d{1,15})$/, getPost],
  ['PATCH', /^\/api\/community\/posts\/(?<id>\d{1,15})$/, editPost],
  ['DELETE', /^\/api\/community\/posts\/(?<id>\d{1,15})$/, deletePost],
  ['POST', /^\/api\/community\/posts\/(?<id>\d{1,15})\/vote$/, votePost],
  ['POST', /^\/api\/community\/posts\/(?<id>\d{1,15})\/comments$/, addComment],
  ['PATCH', /^\/api\/community\/comments\/(?<id>\d{1,15})$/, editComment],
  ['DELETE', /^\/api\/community\/comments\/(?<id>\d{1,15})$/, deleteComment],
  ['POST', /^\/api\/community\/comments\/(?<id>\d{1,15})\/vote$/, voteComment],
  ['POST', /^\/api\/community\/images$/, uploadImage],
  ['DELETE', /^\/api\/community\/images\/(?<name>[a-f0-9]{32}\.(?:jpg|png|webp|gif))$/, deleteImage],
  ['GET', /^\/uploads\/(?<name>[a-f0-9]{32}\.(?:jpg|png|webp|gif))$/, serveImage, 'raw']
];
