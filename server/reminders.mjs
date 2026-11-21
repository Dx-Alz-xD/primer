// =====================================================================
// Reminders about courses a learner has started and left unfinished.
//
// How long since a course was last opened decides the reminder: with
// the usual ("gentle") setting, a nudge after 2 days away, another after
// 7 and a last one after 30. Opening the course starts the count again.
// Each reminder can be dismissed (the next one still comes later),
// snoozed, or turned off for that course. The bell in every page's top
// bar shows them (assets/js/reminders.js); with the learner's permission
// the browser shows them as notifications too, when Primer is opened or,
// in the installed app on Chrome, from a background check
// (assets/js/sw-study.js). Quiet hours hold back notifications, not the bell.
//
//   GET  /api/reminders                 the reminders due now, counts, settings
//   POST /api/reminders/seen            the bell was opened: nothing is new any more
//   POST /api/reminders/notified        { courseIds } shown as notifications
//   GET  /api/reminders/course/:id      { muted, snoozeUntil }
//   POST /api/reminders/course/:id      { action: dismiss | snooze | unsnooze | mute | unmute, days }
//   PUT  /api/reminders/settings        { cadence, quietFrom, quietTo, notify }
// =====================================================================
import { q, schema, now, parseJSON } from './db.mjs';
import { HttpError, sendJSON, readBody } from './http.mjs';
import { requireUser } from './auth.mjs';
import { ownCourse, flatten } from './data.mjs';

schema('reminders-1', `
  CREATE TABLE reminder_settings (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cadence     TEXT NOT NULL DEFAULT 'gentle',  -- gentle | often | rarely | off
    quiet_from  INTEGER,                         -- quiet hours for notifications, 0-23 in the learner's own time
    quiet_to    INTEGER,
    notify      INTEGER NOT NULL DEFAULT 0,      -- the learner turned browser notifications on
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE reminder_courses (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id        TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    muted            INTEGER NOT NULL DEFAULT 0,  -- "don't remind me about this course"
    snooze_until     INTEGER,
    -- each of these counts only for the current spell away (when *_at is after the course was last opened)
    dismissed_stage  INTEGER NOT NULL DEFAULT 0, dismissed_at INTEGER,
    seen_stage       INTEGER NOT NULL DEFAULT 0, seen_at      INTEGER,
    notified_stage   INTEGER NOT NULL DEFAULT 0, notified_at  INTEGER,
    PRIMARY KEY (user_id, course_id)
  );
`);

const DAY = 86400_000;
// days away before each reminder
export const CADENCES = { gentle: [2, 7, 30], often: [1, 3, 7, 14, 30], rarely: [7, 30], off: [] };
const SNOOZE_DAYS = new Set([1, 3, 7]);

function settingsOf(userId) {
  const r = q('SELECT * FROM reminder_settings WHERE user_id = ?').get(userId);
  return {
    cadence: r && CADENCES[r.cadence] ? r.cadence : 'gentle',
    quietFrom: r && r.quiet_from != null ? r.quiet_from : null,
    quietTo: r && r.quiet_to != null ? r.quiet_to : null,
    notify: Boolean(r && r.notify),
    steps: CADENCES[r && CADENCES[r.cadence] ? r.cadence : 'gentle']
  };
}

// Every course the learner has started (opened a lesson of) and not finished, with its reminder.
function compute(user) {
  const t = now();
  const settings = settingsOf(user.id);
  const steps = settings.steps;
  const rows = q(`SELECT c.id, c.data, c.opened_at, c.last_lesson, r.muted, r.snooze_until,
      r.dismissed_stage, r.dismissed_at, r.seen_stage, r.seen_at, r.notified_stage, r.notified_at
    FROM courses c LEFT JOIN reminder_courses r ON r.user_id = c.user_id AND r.course_id = c.id
    WHERE c.user_id = ?`).all(user.id);
  const started = new Map(); // course -> Set of finished lesson numbers
  q('SELECT p.course_id, p.n, p.done FROM progress p JOIN courses c ON c.id = p.course_id WHERE c.user_id = ?').all(user.id).forEach((p) => {
    if (!started.has(p.course_id)) started.set(p.course_id, new Set());
    if (p.done) started.get(p.course_id).add(p.n);
  });

  const out = { reminders: [], muted: [], snoozed: [], unfinished: 0, settings };
  for (const c of rows) {
    const done = started.get(c.id);
    if (!done) continue;
    const meta = parseJSON(c.data, {});
    const flat = flatten(meta.units || []);
    const total = flat.length;
    const finished = flat.filter((l) => done.has(l.n)).length;
    if (!total || finished >= total) continue;
    out.unfinished++;
    const title = meta.title || meta.topic || 'Untitled course';
    const lang = meta.lang || 'en';
    if (c.muted) { out.muted.push({ courseId: c.id, title, lang }); continue; }
    // where to pick up: the lesson last opened if it isn't finished, else the first one that isn't
    let next = c.last_lesson && c.last_lesson <= total && !done.has(c.last_lesson) ? c.last_lesson : null;
    if (!next) next = (flat.find((l) => !done.has(l.n)) || flat[0]).n;
    const days = Math.max(0, Math.floor((t - c.opened_at) / DAY));
    const stage = steps.filter((d) => days >= d).length;
    if (!stage) continue;
    const thisSpell = (at) => at != null && at > c.opened_at;
    if (c.snooze_until && c.snooze_until > t) { out.snoozed.push({ courseId: c.id, title, lang, until: c.snooze_until }); continue; }
    if (thisSpell(c.dismissed_at) && c.dismissed_stage >= stage) continue;
    out.reminders.push({
      courseId: c.id, title, lang, days, done: finished, total, next, nextTitle: flat[next - 1].title,
      stage, stages: steps.length, last: stage === steps.length,
      unread: !(thisSpell(c.seen_at) && c.seen_stage >= stage),
      notified: thisSpell(c.notified_at) && c.notified_stage >= stage,
      openedAt: c.opened_at
    });
  }
  out.reminders.sort((a, b) => b.days - a.days);
  out.unread = out.reminders.filter((r) => r.unread).length;
  return out;
}

function setCourse(userId, courseId, cols) {
  const names = Object.keys(cols);
  q(`INSERT INTO reminder_courses (user_id, course_id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})
     ON CONFLICT (user_id, course_id) DO UPDATE SET ${names.map((k) => `${k} = excluded.${k}`).join(', ')}`)
    .run(userId, courseId, ...names.map((k) => cols[k]));
}

const publicSettings = ({ cadence, quietFrom, quietTo, notify }) => ({ cadence, quietFrom, quietTo, notify, cadences: CADENCES });

async function list({ req, res }) {
  const u = requireUser(req);
  const r = compute(u);
  sendJSON(res, 200, {
    ok: true, now: now(), lang: u.lang || 'en',
    reminders: r.reminders, unread: r.unread, unfinished: r.unfinished, muted: r.muted, snoozed: r.snoozed,
    settings: publicSettings(r.settings)
  });
}

async function seen({ req, res }) {
  const u = requireUser(req);
  const t = now();
  compute(u).reminders.forEach((r) => setCourse(u.id, r.courseId, { seen_stage: r.stage, seen_at: t }));
  sendJSON(res, 200, { ok: true, unread: 0 });
}

async function notified({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 8_000);
  const ids = new Set(Array.isArray(body.courseIds) ? body.courseIds.filter((x) => typeof x === 'string').slice(0, 200) : []);
  const t = now();
  compute(u).reminders.filter((r) => ids.has(r.courseId)).forEach((r) => setCourse(u.id, r.courseId, { notified_stage: r.stage, notified_at: t }));
  sendJSON(res, 200, { ok: true });
}

async function getCourse({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const r = q('SELECT muted, snooze_until FROM reminder_courses WHERE user_id = ? AND course_id = ?').get(u.id, row.id);
  const s = settingsOf(u.id);
  sendJSON(res, 200, { ok: true, muted: Boolean(r && r.muted), snoozeUntil: r && r.snooze_until > now() ? r.snooze_until : null, cadence: s.cadence });
}

async function actOnCourse({ req, res, params }) {
  const u = requireUser(req);
  const row = ownCourse(u, params.id);
  const body = await readBody(req, 1_000);
  const t = now();
  switch (body.action) {
    case 'dismiss': {
      const r = compute(u).reminders.find((x) => x.courseId === row.id);
      if (r) setCourse(u.id, row.id, { dismissed_stage: r.stage, dismissed_at: t, seen_stage: r.stage, seen_at: t });
      break;
    }
    case 'snooze': {
      const days = Number(body.days);
      if (!SNOOZE_DAYS.has(days)) throw new HttpError('Snooze for 1, 3 or 7 days.', 400);
      setCourse(u.id, row.id, { snooze_until: t + days * DAY });
      break;
    }
    case 'unsnooze': setCourse(u.id, row.id, { snooze_until: null }); break;
    case 'mute': setCourse(u.id, row.id, { muted: 1 }); break;
    case 'unmute': setCourse(u.id, row.id, { muted: 0 }); break;
    default: throw new HttpError('Unknown action.', 400);
  }
  const r = compute(u);
  sendJSON(res, 200, { ok: true, unread: r.unread });
}

async function putSettings({ req, res }) {
  const u = requireUser(req);
  const body = await readBody(req, 1_000);
  const cur = settingsOf(u.id);
  const hour = (v) => (v === null ? null : Number.isInteger(v) && v >= 0 && v <= 23 ? v : undefined);
  const cadence = body.cadence === undefined ? cur.cadence : body.cadence;
  if (!CADENCES[cadence]) throw new HttpError('That isn’t one of the choices.', 400);
  let quietFrom = body.quietFrom === undefined ? cur.quietFrom : hour(body.quietFrom);
  let quietTo = body.quietTo === undefined ? cur.quietTo : hour(body.quietTo);
  if (quietFrom === undefined || quietTo === undefined) throw new HttpError('Quiet hours are whole hours, 0 to 23.', 400);
  if (quietFrom === null || quietTo === null || quietFrom === quietTo) quietFrom = quietTo = null;
  const notify = body.notify === undefined ? cur.notify : Boolean(body.notify);
  q(`INSERT INTO reminder_settings (user_id, cadence, quiet_from, quiet_to, notify, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET cadence = excluded.cadence, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to,
       notify = excluded.notify, updated_at = excluded.updated_at`).run(u.id, cadence, quietFrom, quietTo, notify ? 1 : 0, now());
  const r = compute(u);
  sendJSON(res, 200, { ok: true, settings: publicSettings(r.settings), unread: r.unread });
}

export const routes = [
  ['GET', /^\/api\/reminders$/, list],
  ['POST', /^\/api\/reminders\/seen$/, seen],
  ['POST', /^\/api\/reminders\/notified$/, notified],
  ['GET', /^\/api\/reminders\/course\/(?<id>[^/]+)$/, getCourse],
  ['POST', /^\/api\/reminders\/course\/(?<id>[^/]+)$/, actOnCourse],
  ['PUT', /^\/api\/reminders\/settings$/, putSettings]
];

// The bell's count on every page, without a request.
export const boot = (user) => {
  if (!user) return {};
  try {
    const r = compute(user);
    return { reminders: { unread: r.unread, notify: r.settings.notify } };
  } catch (err) {
    console.error('[reminders]', err);
    return {};
  }
};
