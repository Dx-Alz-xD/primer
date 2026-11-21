// =====================================================================
// A lesson's references: its sources (server/sources.mjs) and the apps
// to practise it in (server/apps.mjs), kept per lesson in lesson_refs
// and handed to the page as lesson.refs:
//
//   { sources: [{ n, kind: wiki|paper|video|own, title, url, ... }],
//     tags: { <section index>: [source numbers] },
//     status: found | none | pending, mode: grounded | checked | null,
//     apps: [{ name, url, host, icon, what, free, oss, platforms, steps }],
//     appsStatus: found | none | pending }
//
// - A lesson written from its sources (lesson.grounding, ai.mjs) gets
//   them at once, numbered in the order its sections use them; sources
//   no section uses are left out.
// - Any other lesson (written before this, or when the lookup was slow)
//   gets them on first open, once, like photos: looked up and tagged in
//   the background, then kept. The page asks again a few times
//   (GET …/refs) until they are ready.
// - Watch mode's videos are added once YouTube's oEmbed confirms them,
//   tagged on the parts they cover; a course written from the learner's
//   own material (Add2Knowledge) lists that material.
// - Apps are worked out in the background after a lesson is written or
//   first opened, and kept.
// - Safely framed courses get no outside lookups and no apps.
// Kept in a table of their own (keyed to the lesson's section titles),
// so nothing here ever rewrites a stored lesson.
// =====================================================================
import { q, schema, now, parseJSON } from './db.mjs';
import { sendJSON, overLimit } from './http.mjs';
import { requireUser } from './auth.mjs';
import { hooks, ownCourse, flatten } from './data.mjs';
import { courseSafety } from './safety.mjs';
import { LANG_NAMES } from './langs.mjs';
import { findSources, tagLesson, checkVideo } from './sources.mjs';
import { findApps } from './apps.mjs';
import { once, sleep, hash, oneLine } from './refnet.mjs';

schema('refs-1', `
  CREATE TABLE lesson_refs (
    course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    n          INTEGER NOT NULL,
    sig        TEXT NOT NULL,   -- the lesson these are for (a hash of its section titles)
    sources    TEXT,            -- JSON: { status, mode, list, tags, at, retryAt, tries }
    videos     TEXT,            -- JSON: { <video id>: { ok, at } } Watch mode's videos, checked
    apps       TEXT,            -- JSON: { status, list, at, retryAt, tries }
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (course_id, n)
  );
`);

// Add2Knowledge sets this: material(row, meta, n) -> [{ title, contributor, date }] for a lesson written
// from the learner's own material (shown as "From your knowledge: …" and tagged on every part).
export const refHooks = { material: null };

const arr = (v) => (Array.isArray(v) ? v : []);
const RETRY_MS = 10 * 60_000;
const OPEN_WAIT = 1500;   // an opened lesson waits this long for quick answers
const ASK_WAIT = 2500;    // GET …/refs waits this long

export const sigOf = (lesson) => hash(arr(lesson && lesson.sections).map((s) => oneLine(s && s.title, 90)).join('|')).slice(0, 16);
const rowOf = (cid, n) => q('SELECT * FROM lesson_refs WHERE course_id = ? AND n = ?').get(cid, n) || null;
const storedSig = (cid, n) => {
  const r = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(cid, n);
  return r ? sigOf(parseJSON(r.data, null)) : null;
};

// Writes some columns for this version of the lesson (a stale job for an older version writes nothing).
function save(cid, n, sig, patch) {
  if (storedSig(cid, n) !== sig) return;
  const cur = rowOf(cid, n);
  const keep = cur && cur.sig === sig;
  const col = (k) => (k in patch ? (patch[k] == null ? null : JSON.stringify(patch[k])) : keep ? cur[k] : null);
  q(`INSERT INTO lesson_refs (course_id, n, sig, sources, videos, apps, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (course_id, n) DO UPDATE SET sig = excluded.sig, sources = excluded.sources, videos = excluded.videos,
       apps = excluded.apps, updated_at = excluded.updated_at`)
    .run(cid, n, sig, col('sources'), col('videos'), col('apps'), now());
}

/* ---------------- what goes in a source entry ---------------- */

const LINK = {
  wiki: /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\/[^\s"<>]+$/,
  paper: /^https:\/\/doi\.org\/10\.\d{4,9}\/[^\s"<>]+$/
};
function entry(s) {
  if (!s || !LINK[s.kind] || !LINK[s.kind].test(String(s.url || ''))) return null;
  const e = { kind: s.kind, title: oneLine(s.title, 300), url: s.url, lang: oneLine(s.lang, 8) || 'en' };
  if (s.kind === 'wiki') e.site = 'Wikipedia';
  else {
    e.site = oneLine(s.site, 160);
    e.year = Number(s.year) || null;
    e.authors = arr(s.authors).map((a) => oneLine(a, 80)).filter(Boolean).slice(0, 3);
    e.more = Boolean(s.more);
    e.doi = oneLine(s.doi, 200);
  }
  return e.title ? e : null;
}

// Tags (section index -> numbers into `list`, 1-based) -> only the sources used, renumbered by first use.
function renumber(list, tags, sections) {
  const used = new Map();
  const out = {};
  sections.forEach((_, i) => {
    const nums = arr(tags[i]).filter((k) => Number.isInteger(k) && k >= 1 && k <= list.length && entry(list[k - 1]));
    if (!nums.length) return;
    out[i] = [...new Set(nums.map((k) => { if (!used.has(k)) used.set(k, used.size + 1); return used.get(k); }))].sort((a, b) => a - b);
  });
  const kept = [...used.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => entry(list[k - 1]));
  return { list: kept, tags: out };
}

// A lesson written from its sources: its own tags, checked again here.
function fromGrounding(lesson) {
  const g = lesson && lesson.grounding;
  if (!g || !arr(g.sources).length) return null;
  const tags = {};
  lesson.sections.forEach((s, i) => { if (arr(s.src).length) tags[i] = arr(s.src).map(Number); });
  const { list, tags: t } = renumber(g.sources, tags, lesson.sections);
  return list.length ? { status: 'found', mode: 'grounded', list, tags: t, at: now() } : null;
}

/* ---------------- the background work ---------------- */

let busyJobs = 0;
const waiting = [];
async function slot(fn) {
  if (busyJobs >= 3) await new Promise((r) => waiting.push(r));
  busyJobs++;
  try { return await fn(); } finally { busyJobs--; if (waiting.length) waiting.shift()(); }
}
const running = new Set();
function job(name, fn) {
  if (running.has(name)) return null;
  running.add(name);
  return once(name, () => slot(fn)).catch((err) => console.log(`[refs] ${name}: ${oneLine(err.message, 160)}`)).finally(() => running.delete(name));
}
const isBusy = (cid, n, what) => running.has(`${what}|${cid}|${n}`);

const retrying = (state) => ({ status: 'retry', retryAt: now() + RETRY_MS * Math.min(12, 2 ** ((state && state.tries) || 0)), tries: ((state && state.tries) || 0) + 1 });
const due = (state) => !state || (state.status === 'retry' && now() >= (state.retryAt || 0));

function videosOf(cid, n) {
  try {
    const plan = parseJSON((q('SELECT data FROM lesson_videos WHERE course_id = ? AND n = ?').get(cid, n) || {}).data, null);
    return plan && plan.status === 'found' ? arr(plan.videos).filter((v) => v && /^[A-Za-z0-9_-]{11}$/.test(v.id || '')) : [];
  } catch { return []; } // Watch mode isn't installed
}

// Starts whatever this lesson still needs. Returns a promise for the jobs started (or null).
function ensure(row, meta, n, lesson, sig) {
  const cid = row.id;
  const r = rowOf(cid, n);
  if (!r || r.sig !== sig) return null;
  const S = parseJSON(r.sources, null), A = parseJSON(r.apps, null), V = parseJSON(r.videos, null) || {};
  const me = flatten(meta.units || [])[n - 1] || { title: lesson.title || '' };
  const lang = meta.lang || 'en';
  const topic = (meta.library && meta.library.subject) || meta.topic || '';
  const jobs = [];
  const allowed = () => !overLimit('refs:' + row.user_id, 80, 3600_000);

  if (due(S) && !isBusy(cid, n, 'src') && allowed()) {
    jobs.push(job(`src|${cid}|${n}`, async () => {
      let out;
      try {
        // the same lookups a new lesson is written from (kept on disk, so a lesson written from its sources
        // but left untagged gets the same list back), then one small AI call says which part uses which
        const { list } = await findSources({ title: me.title, topic, lang });
        if (!list.length) out = { status: 'none', mode: 'checked', list: [], tags: {}, at: now() };
        else {
          const tags = await tagLesson(lesson, list, lang);
          const t = renumber(list, tags, lesson.sections);
          out = { status: t.list.length ? 'found' : 'none', mode: lesson.grounding ? 'grounded' : 'checked', list: t.list, tags: t.tags, at: now() };
        }
      } catch (err) {
        if (!err.retryLater) console.log(`[refs] sources for lesson ${n} of ${cid}: ${oneLine(err.message, 160)}`);
        out = retrying(S);
      }
      save(cid, n, sig, { sources: out });
    }));
  }
  const unchecked = videosOf(cid, n).filter((v) => !V[v.id] || (!V[v.id].ok && now() - V[v.id].at > 864e5));
  if (unchecked.length && !isBusy(cid, n, 'vid')) {
    jobs.push(job(`vid|${cid}|${n}`, async () => {
      const got = {};
      for (const v of unchecked.slice(0, 4)) {
        try { got[v.id] = { ok: await checkVideo(v.id), at: now() }; } catch { /* YouTube unreachable: next time */ }
      }
      const cur = parseJSON((rowOf(cid, n) || {}).videos, null) || {};
      save(cid, n, sig, { videos: { ...cur, ...got } });
    }));
  }
  if (due(A) && !isBusy(cid, n, 'app') && allowed()) {
    jobs.push(job(`app|${cid}|${n}`, async () => {
      let out;
      try { out = await findApps({ meta, me, n, lesson, langName: LANG_NAMES[lang] || 'English' }); } catch (err) {
        if (!err.retryLater) console.log(`[refs] apps for lesson ${n} of ${cid}: ${oneLine(err.message, 160)}`);
        out = retrying(A);
      }
      save(cid, n, sig, { apps: out });
    }));
  }
  const started = jobs.filter(Boolean);
  return started.length ? Promise.all(started) : null;
}

/* ---------------- what the page gets ---------------- */

function materials(row, meta, n) {
  let m = null;
  try { m = refHooks.material ? refHooks.material(row, meta, n) : null; } catch { m = null; }
  if (!m) m = meta.materials || meta.material || null;
  return arr(Array.isArray(m) ? m : m ? [m] : []).map((x) => x && typeof x === 'object' && {
    kind: 'own', title: oneLine(x.title, 200), contributor: oneLine(x.contributor || x.by || x.author, 120), date: oneLine(x.date || x.at, 40)
  }).filter((x) => x && x.title).slice(0, 5);
}

const APP_ICON = /^\/media\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/;
const cleanApp = (a) => a && /^https:\/\//.test(a.url || '') && {
  name: oneLine(a.name, 40), url: a.url, host: oneLine(a.host, 120), icon: APP_ICON.test(a.icon || '') ? a.icon : null,
  what: oneLine(a.what, 240), free: Boolean(a.free), oss: Boolean(a.oss), platforms: arr(a.platforms).slice(0, 6), steps: arr(a.steps).map((s) => oneLine(s, 260)).slice(0, 3)
};

export function view(r, lesson, cid, n, meta, row) {
  const S = r && parseJSON(r.sources, null), A = r && parseJSON(r.apps, null), V = (r && parseJSON(r.videos, null)) || {};
  const list = [], tags = {};
  const tag = (i, k) => { if (Number.isInteger(i) && i >= 0 && i < lesson.sections.length) { (tags[i] ||= []); if (!tags[i].includes(k)) tags[i].push(k); } };
  if (S && S.status === 'found') {
    arr(S.list).forEach((s) => { const e = entry(s); if (e) list.push(e); });
    Object.entries(S.tags || {}).forEach(([i, ks]) => arr(ks).forEach((k) => { if (k >= 1 && k <= list.length) tag(Number(i), k); }));
  }
  for (const v of videosOf(cid, n)) {
    if (!(V[v.id] && V[v.id].ok)) continue;
    list.push({ kind: 'video', title: oneLine(v.title, 200), url: `https://www.youtube.com/watch?v=${v.id}`, site: 'YouTube', channel: oneLine(v.channel, 120) });
    const k = list.length;
    (arr(v.parts).length ? v.parts : lesson.sections.map((_, i) => i)).forEach((i) => tag(Number(i), k));
  }
  for (const m of materials(row || { id: cid }, meta, n)) {
    list.push(m);
    const k = list.length;
    lesson.sections.forEach((s, i) => { if (arr(s.blocks).length) tag(i, k); });
  }
  Object.values(tags).forEach((t) => t.sort((a, b) => a - b));
  const srcPending = !S || S.status === 'retry' || isBusy(cid, n, 'src');
  const status = list.length ? 'found' : S && S.status === 'none' ? 'none' : srcPending ? 'pending' : 'none';
  const apps = A && A.status === 'found' ? arr(A.list).map(cleanApp).filter(Boolean) : [];
  const appsStatus = apps.length ? 'found' : A && A.status === 'none' ? 'none' : 'pending';
  return {
    sources: list.map((s, i) => ({ n: i + 1, ...s })), tags, status, mode: S && S.status === 'found' ? S.mode : null,
    apps, appsStatus
  };
}

const usable = (meta, lesson) => lesson && Array.isArray(lesson.sections) && (meta.source === 'ai' || meta.source === 'library');
const NONE = () => ({ status: 'none', mode: null, list: [], tags: {}, at: now() });

// The first time this version of the lesson is seen: what is known already.
function prime(row, meta, n, lesson, sig) {
  const r = rowOf(row.id, n);
  if (r && r.sig === sig) return;
  const framed = Boolean(courseSafety(meta)); // risky topics taught safely: no outside lookups, no apps
  save(row.id, n, sig, {
    sources: framed ? NONE() : fromGrounding(lesson),
    videos: null,
    apps: framed ? { status: 'none', list: [], at: now() } : null
  });
}

// hooks.refs in data.mjs: every lesson written (stored: false) or opened (stored: true) gets lesson.refs.
// Never throws, never waits long; nothing here is saved into the lesson itself.
async function lessonRefs(row, meta, n, lesson, stored) {
  try {
    if (!usable(meta, lesson)) return lesson;
    const sig = sigOf(lesson);
    prime(row, meta, n, lesson, sig);
    const jobs = ensure(row, meta, n, lesson, sig);
    if (jobs) await Promise.race([jobs, sleep(stored ? OPEN_WAIT : 300)]);
    return { ...lesson, refs: view(rowOf(row.id, n), lesson, row.id, n, meta, row) };
  } catch (err) {
    console.log(`[refs] lesson ${n} of ${row.id}: ${oneLine(err.message, 160)}`);
    return lesson;
  }
}
hooks.refs = lessonRefs;

// hooks.bookRefs, for the book and the EPUB (server/ebook.mjs): what is kept, without any lookups.
hooks.bookRefs = (course, n, lesson) => {
  try {
    if (!usable(course, lesson)) return lesson;
    const r = rowOf(course.id, n);
    if (!r || r.sig !== sigOf(lesson)) return lesson;
    return { ...lesson, refs: view(r, lesson, course.id, n, course, { id: course.id, user_id: null }) };
  } catch { return lesson; }
};

/* ---------------- route: the page asks again while something is pending ---------------- */

async function getRefs({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const n = Number(params.n);
  const meta = parseJSON(row.data, {});
  const have = q('SELECT data FROM lessons WHERE course_id = ? AND n = ?').get(row.id, n);
  const lesson = have && parseJSON(have.data, null);
  if (!usable(meta, lesson)) return sendJSON(res, 200, { ok: true, refs: null });
  const sig = sigOf(lesson);
  prime(row, meta, n, lesson, sig);
  const jobs = ensure(row, meta, n, lesson, sig);
  if (jobs) await Promise.race([jobs, sleep(ASK_WAIT)]);
  sendJSON(res, 200, { ok: true, refs: view(rowOf(row.id, n), lesson, row.id, n, meta, row) });
}

export const routes = [
  ['GET', /^\/api\/courses\/(?<id>[^/]+)\/lessons\/(?<n>\d{1,4})\/refs$/, getRefs]
];
