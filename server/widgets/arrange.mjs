// =====================================================================
// "arrange": cards the learner taps into place, for any subject.
//   order  put steps or events in sequence     { mode, items: [...] }   (written in the right order)
//   match  join each thing to its partner      { mode, pairs: [[left, right], ...] }
//   group  sort things into groups             { mode, groups: [{ name, items: [...] }, ...] }
// The right answer is the spec itself (the browser shuffles the cards), so a task's goal is {}.
// Cards are plain text: the browser puts them in with textContent, never as HTML.
// =====================================================================

export const label = 'a card activity (put in order, match, or sort into groups)';
// offered to every lesson, and used only where it fits (server/widgets.mjs words the prompt for that)
export const optional = true;
export const match = () => true;

export const prompt = `Kind "arrange": cards the learner taps into place. It suits any subject. Three modes:
- "order": steps, stages or events to put in sequence. spec {"mode": "order", "items": ["Seed", "Sprout", "Young plant", "Flowering plant"]}: 3 to 7 items, written in the RIGHT order (the app shuffles them).
- "match": things to join to their partner. spec {"mode": "match", "pairs": [["Lungs", "Breathing"], ["Heart", "Pumping blood"], ["Stomach", "Digesting food"]]}: 3 to 6 pairs of [left, right]; every left and every right different.
- "group": things to sort. spec {"mode": "group", "groups": [{"name": "Living", "items": ["Tree", "Cat"]}, {"name": "Non-living", "items": ["Stone", "Water"]}]}: 2 to 4 groups, 4 to 12 items in all, each item in exactly one group, no item repeated.
Each card is short plain text: at most 8 words, no HTML, no LaTeX. The right answer must be beyond doubt from what the lesson teaches: in "order", steps that must come in that order or events clearly apart in time (never two that happened within days of each other); in "match" and "group", nothing that could fairly go in two places. As a task, give "goal": {} (the spec is the answer). Prefer a task to a block. Use "arrange" at most twice in the whole lesson (blocks and tasks together), never with the same cards twice, and only where ordering, matching or sorting really tests understanding (the stages of a process, events in time, causes and effects, words and meanings, examples and their kind); not for trivia, and not when the lesson already has a better interactive part.`;

const MODES = ['order', 'match', 'group'];
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// a card: plain text, one line, at most 90 characters; '' if there is nothing usable
function card(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  let s = String(v).replace(/<[^>]*>/g, ' ');
  s = [...s].filter((ch) => { const c = ch.codePointAt(0); return c >= 32 && c !== 127; }).join('');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 90 ? '' : s;
}
const key = (s) => s.toLocaleLowerCase();
const distinct = (list) => new Set(list.map(key)).size === list.length;

function clean(spec) {
  if (!isObj(spec)) return null;
  const mode = MODES.includes(spec.mode) ? spec.mode
    : Array.isArray(spec.pairs) ? 'match' : Array.isArray(spec.groups) ? 'group' : Array.isArray(spec.items) ? 'order' : '';
  if (mode === 'order') {
    if (!Array.isArray(spec.items)) return null;
    const items = spec.items.map(card);
    if (items.length < 3 || items.length > 7 || items.some((s) => !s) || !distinct(items)) return null;
    return { mode, items };
  }
  if (mode === 'match') {
    if (!Array.isArray(spec.pairs)) return null;
    const pairs = spec.pairs.map((p) => (Array.isArray(p) ? [card(p[0]), card(p[1])] : isObj(p) ? [card(p.left), card(p.right)] : ['', '']));
    if (pairs.length < 3 || pairs.length > 6 || pairs.some(([l, r]) => !l || !r)) return null;
    if (!distinct(pairs.map((p) => p[0])) || !distinct(pairs.map((p) => p[1]))) return null;
    return { mode, pairs };
  }
  if (mode === 'group') {
    if (!Array.isArray(spec.groups)) return null;
    const groups = spec.groups.map((g) => (isObj(g) && Array.isArray(g.items) ? { name: card(g.name), items: g.items.map(card) } : null));
    if (groups.length < 2 || groups.length > 4 || groups.some((g) => !g || !g.name || !g.items.length || g.items.some((s) => !s))) return null;
    const all = groups.flatMap((g) => g.items);
    if (all.length < 4 || all.length > 12 || !distinct(all) || !distinct(groups.map((g) => g.name))) return null;
    return { mode, groups };
  }
  return null;
}

export function block(spec) { return clean(spec); }

export function task(spec) {
  const s = clean(spec);
  return s ? { spec: s, goal: {} } : null;
}

// The words on the cards, for the translator, and the same spec with translated words put back
// (null when the count doesn't match, so the original stays).
export function texts(spec) {
  const s = clean(spec);
  if (!s) return [];
  if (s.mode === 'order') return s.items.slice();
  if (s.mode === 'match') return s.pairs.flat();
  return s.groups.flatMap((g) => [g.name, ...g.items]);
}
export function withTexts(spec, words) {
  const s = clean(spec);
  if (!s || !Array.isArray(words) || words.length !== texts(s).length) return null;
  let i = 0;
  const next = () => words[i++];
  if (s.mode === 'order') return clean({ mode: 'order', items: s.items.map(next) });
  if (s.mode === 'match') return clean({ mode: 'match', pairs: s.pairs.map(() => [next(), next()]) });
  return clean({ mode: 'group', groups: s.groups.map((g) => ({ name: next(), items: g.items.map(next) })) });
}
