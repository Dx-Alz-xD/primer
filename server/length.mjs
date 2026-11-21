// =====================================================================
// Course length: how long the learner wants a course to be.
//   (nothing)          as long as the subject needs (the default)
//   { kind: 'concise' }               one unit of 1 to 5 lessons: a quick overview
//   { kind: 'lessons', n: 20 }        exactly n lessons (1 to 150)
//   { kind: 'minutes', n: 180 }       about n minutes of study in all (10 minutes to 50 hours)
//
// cleanLength   checks what the browser sent (and what a course stores)
// lengthKey     its part of an outline's cache key (nothing when unset)
// lengthRule    the firm rule the outline prompt gets
// enforceLength makes an AI outline keep to it: trims a slightly long one,
//               and refuses one that is far off so the next model is asked
//               (lenient after the first reply, so a course always comes back)
// fitLength     whether an outline that already exists (a library slice)
//               fits, without changing what it teaches
// No imports, so ai.mjs, data.mjs and library.mjs can all use it.
// =====================================================================

export const MAX_LESSONS = 150;   // the same ceiling as any outline (OUTLINE_MAX in ai.mjs)
export const CONCISE_MAX = 5;
export const MIN_MINUTES = 10;
export const MAX_MINUTES = 3000;  // 50 hours: 150 lessons of 20 minutes
const SLACK = 0.15;               // a time budget is met within 15%

export function cleanLength(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.kind === 'concise') return { kind: 'concise' };
  const n = Math.round(Number(v.n));
  if (!Number.isFinite(n) || n < 1) return null;
  if (v.kind === 'lessons') return { kind: 'lessons', n: Math.min(MAX_LESSONS, n) };
  if (v.kind === 'minutes') return { kind: 'minutes', n: Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n)) };
  return null;
}

// Requests without a length keep the cache keys they always had.
export const lengthKey = (len) => (len ? { len: len.kind === 'concise' ? 'concise' : `${len.kind === 'lessons' ? 'l' : 'm'}${len.n}` } : {});

export function humanMinutes(n) {
  if (n < 60) return `${n} minutes`;
  const h = Math.floor(n / 60), m = n % 60;
  const hours = `${h} hour${h === 1 ? '' : 's'}`;
  return m ? `${hours} ${m} minutes` : hours;
}

export function lengthRule(len, { syllabus = false } = {}) {
  if (!len) return '';
  const head = 'Length (a firm rule: it replaces the general rules about how many lessons):';
  const syl = syllabus ? ' Follow the syllabus\'s chapters and their order within this length, combining its items into fewer lessons where needed.' : '';
  if (len.kind === 'concise') {
    return `${head} a concise course for a quick overview. Exactly ONE unit with 1 to ${CONCISE_MAX} lessons in all. Choose the few ideas that matter most across the whole range and leave the details out.${syl}`;
  }
  if (len.kind === 'lessons') {
    const n = len.n;
    return `${head} exactly ${n} lesson${n === 1 ? '' : 's'} in all, no more and no fewer. ${n <= 5 ? 'Put them in one unit.' : 'Group them into units as usual.'} Cover the whole range at the depth ${n} lesson${n === 1 ? '' : 's'} allow${n === 1 ? 's' : ''}: broad with few lessons, deeper with many.${syl}`;
  }
  const lo = Math.round(len.n * 0.9), hi = Math.round(len.n * 1.1);
  return `${head} the learner wants to spend about ${humanMinutes(len.n)} on the whole course (${len.n} minutes). The lessons' "minutes" must add up to between ${lo} and ${hi}. Keep each lesson's minutes realistic (8 to 25) and plan as many lessons as fit that time, covering the whole range at the depth it allows.${syl}`;
}

/* ---------------- keeping an outline to a length ---------------- */

const count = (units) => units.reduce((n, u) => n + u.lessons.length, 0);
const minutesOf = (units) => units.reduce((m, u) => m + u.lessons.reduce((a, l) => a + (Number(l.minutes) || 0), 0), 0);
const copy = (units) => units.map((u) => ({ ...u, lessons: u.lessons.slice() }));

// Takes one lesson out: from the unit with the most lessons (a later one on a tie), the lesson before
// its last, so each unit keeps its opening and closing lessons and the course its first and last.
function dropOne(units) {
  const order = units.map((u, i) => i).sort((a, b) => units[b].lessons.length - units[a].lessons.length || b - a);
  for (const ui of order) {
    const u = units[ui];
    for (let li = u.lessons.length - 2; li >= 0; li--) {
      if (ui === 0 && li === 0) continue; // the course's first lesson
      u.lessons.splice(li, 1);
      return units.filter((x) => x.lessons.length);
    }
    if (u.lessons.length === 1 && ui !== 0 && ui !== units.length - 1) { // a one-lesson unit in the middle
      u.lessons.splice(0, 1);
      return units.filter((x) => x.lessons.length);
    }
  }
  const last = units[units.length - 1]; // only the first and last lessons are left: keep the first
  last.lessons.pop();
  return units.filter((x) => x.lessons.length);
}

function oneUnit(units, title) {
  return [{ title: units.length === 1 ? units[0].title : (title || units[0].title), lessons: units.flatMap((u) => u.lessons) }];
}

// `units` as normalizeOutline makes them. Returns the units to keep, or throws when the reply is too
// far off (generate() then asks the next model). `title` names the one unit of a concise course
// when the reply had several.
export function enforceLength(units, len, { lenient = false, title = '' } = {}) {
  if (!len) return units;
  let out = copy(units);
  const total = count(out);
  if (!total) throw new Error('no lessons');
  if (len.kind === 'concise') {
    if (!lenient && total > CONCISE_MAX + 2) throw new Error(`a concise course came back with ${total} lessons`);
    while (count(out) > CONCISE_MAX) out = dropOne(out);
    return oneUnit(out, title);
  }
  if (len.kind === 'lessons') {
    const n = len.n;
    if (total > n) {
      if (!lenient && total > Math.ceil(n * 1.25) + 1) throw new Error(`asked for ${n} lessons, got ${total}`);
      while (count(out) > n) out = dropOne(out);
    } else if (total < n && (!lenient || total < Math.floor(n * 0.85))) {
      throw new Error(`asked for ${n} lessons, got ${total}`);
    }
    return n <= 5 && out.length > 1 ? oneUnit(out, title) : out;
  }
  // a time budget, within the ceiling every outline has
  while (count(out) > MAX_LESSONS) out = dropOne(out);
  const t = len.n, lo = t * (1 - SLACK), hi = t * (1 + SLACK);
  if (minutesOf(out) > hi) {
    if (!lenient && minutesOf(out) > t * 1.6) throw new Error(`asked for ${t} minutes, got ${minutesOf(out)}`);
    while (minutesOf(out) > hi && count(out) > 1) {
      const before = minutesOf(out);
      const next = dropOne(copy(out));
      // stop where the total is closest to the budget, even if just over it
      if (minutesOf(next) < lo && lo - minutesOf(next) > before - hi) break;
      out = next;
    }
  }
  const m = minutesOf(out);
  if (m < lo && (!lenient || m < t * 0.7)) throw new Error(`asked for ${t} minutes, got ${m}`);
  return out;
}

// Does an outline that already exists fit the length? Returns the units (a concise one as a single
// unit) or null. Lessons are never dropped here: a library course's lessons build on each other.
export function fitLength(units, len, { title = '' } = {}) {
  if (!len) return units;
  const total = count(units);
  if (!total) return null;
  if (len.kind === 'concise') return total <= CONCISE_MAX ? oneUnit(copy(units), title) : null;
  if (len.kind === 'lessons') return Math.abs(total - len.n) <= Math.max(0, Math.round(len.n * 0.1)) ? units : null;
  const m = minutesOf(units);
  return m >= len.n * (1 - SLACK) && m <= len.n * (1 + SLACK) ? units : null;
}
