// =====================================================================
// Interactive parts of a lesson ("widgets"): a chess board, a circuit, a
// graph with sliders, a piano or drums, cards to put in order, match or
// sort (for any subject), used in two ways.
//
//   A block, among a section's content:
//     { "t": "widget", "kind": "chess", "spec": {...}, "caption": "..." }
//     it shows something, often animated, that the learner can also play with.
//   A task, among a section's checkpoint questions:
//     { "type": "task", "kind": "chess", "prompt": "...", "spec": {...},
//       "goal": {...}, "hint": "...", "explain": "..." }
//     the learner does something in the widget (moves a piece, closes a
//     switch, sets a slider, plays a chord) and the widget says whether it
//     meets the goal. Checked in the browser, like numeric answers.
//
// Each kind lives in server/widgets/<kind>.mjs, which exports:
//   label    what it is, in a few words (for logs and the tutor)
//   match    (text) -> true when a lesson on this text should be offered it;
//            text is the course topic, the lesson's title and description and
//            the teaching instructions, lower-cased
//   prompt   the lines added to the lesson prompt: the spec and goal shapes,
//            with a short example of each, and when (not) to use it
//   block(spec)        -> a clean spec, or null (the block is dropped)
//   task(spec, goal)   -> { spec, goal } clean, or null (the question is dropped)
// and may export
//   optional  true: offered to every lesson, but used only where it fits
//   texts(spec) -> [words]           the words in it that a translator should translate
//   withTexts(spec, words) -> spec   the same spec with translated words, or null
// and its browser half is assets/js/widgets/<kind>.js (assets/js/widgets.js).
//
// Everything the AI sends is checked here: a widget that doesn't hold
// together (an impossible chess position, a circuit with a loose end, an
// expression that can't be read) is left out of the lesson, never shown
// half-broken. A lesson on a subject with no widget is written as before.
// =====================================================================

export const KINDS = ['chess', 'circuit', 'graph', 'music', 'arrange', 'chem', 'optics', 'geometry', 'numbers', 'physics', 'code', 'breadboard'];

const mods = new Map(); // kind -> module, for the kinds whose file exists
await Promise.all(KINDS.map(async (kind) => {
  try {
    const m = await import(`./widgets/${kind}.mjs`);
    if (m && typeof m.match === 'function' && typeof m.block === 'function' && typeof m.task === 'function') mods.set(kind, m);
  } catch (err) {
    if (err && err.code !== 'ERR_MODULE_NOT_FOUND') console.log(`[widgets] ${kind}: ${String(err.message || err).slice(0, 200)}`);
  }
}));

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
// a spec or goal goes no further than this much JSON
const small = (v, max = 20000) => { try { return JSON.stringify(v).length <= max; } catch { return false; } };

export const available = () => [...mods.keys()];

// Part of every lesson's cache key (server/ai.mjs): raise it when what lessons are asked for changes a lot,
// so a lesson cached under the old prompt is written again instead of served. 2: interactive parts in most
// sections, the repair round, and the new kinds.
export const PROMPT_VERSION = 2;

// The kinds a lesson is offered: those whose words appear in what the lesson is about.
export function widgetKinds({ topic, title, desc, instructions } = {}) {
  const text = [topic, title, desc, instructions].filter(Boolean).join(' \n ').toLowerCase();
  if (!text) return [];
  return [...mods.entries()].filter(([, m]) => { try { return Boolean(m.match(text)); } catch { return false; } }).map(([k]) => k);
}

// The lines added to the lesson prompt for those kinds.
export function widgetPrompt(kinds) {
  const parts = (kinds || []).map((k) => mods.get(k)).filter(Boolean);
  if (!parts.length) return '';
  // only optional kinds (the card activity): use one where it fits, or none
  // learners asked for lessons they can play with, so the parts are wanted, not just allowed
  const use = parts.some((m) => !m.optional)
    ? 'This is a hands-on lesson: learners learn by doing. Put an interactive block in most sections (at least two in the lesson, each set up for this section\'s own idea), and make at least two of the checkpoint questions "task" questions done in an interactive part, wherever acting is a fair test.'
    : 'Almost every lesson has something it suits (stages, events in time, causes and effects, words and meanings, examples and their kind): use it at least once, as a "task" question (two at most). Leave it out only if nothing in this lesson can be put in order, matched or sorted.';
  return [
    '',
    'Interactive parts. This lesson can use the interactive parts below, which the app draws and the learner can use.',
    use + ' Write the surrounding text so it makes sense with them (refer to "the board below", "the circuit", "the graph", "the keyboard", "the cards"). Everything else in the lesson stays as described above.',
    'A block goes among a section\'s "blocks": {"t": "widget", "kind": "<kind>", "spec": {...}, "caption": "one sentence on what to notice or try"}.',
    'A task goes among a section\'s "checkpoint" questions: {"type": "task", "kind": "<kind>", "prompt": "what to do", "spec": {...}, "goal": {...}, "hint": "...", "explain": "why that is right"}.',
    'Get every detail exactly right (legal positions, sound circuits, true values): the app checks each one and leaves out any that is wrong.',
    ...parts.map((m) => m.prompt)
  ].join('\n');
}

// A widget block from the AI (or a course file), checked by its kind; null leaves it out.
export function normWidgetBlock(b) {
  if (!isObj(b)) return null;
  const kind = str(b.kind || b.widget, 20).toLowerCase();
  const m = mods.get(kind);
  if (!m || !isObj(b.spec) || !small(b.spec)) return null;
  let spec;
  try { spec = m.block(b.spec); } catch { spec = null; }
  if (!isObj(spec) || !small(spec)) return null;
  return { t: 'widget', kind, spec, caption: str(b.caption, 400) };
}

// A task question, given the checked prompt, hint and explanation; null leaves it out.
export function normTask(q, base) {
  if (!isObj(q)) return null;
  const kind = str(q.kind || q.widget, 20).toLowerCase();
  const m = mods.get(kind);
  const goal = q.goal == null ? {} : q.goal; // a kind whose answer is the spec itself takes {}
  if (!m || !isObj(q.spec) || !isObj(goal) || !small(q.spec) || !small(goal, 6000)) return null;
  let out;
  try { out = m.task(q.spec, goal); } catch { out = null; }
  if (!out || !isObj(out.spec) || !isObj(out.goal) || !small(out.spec) || !small(out.goal, 6000)) return null;
  return { type: 'task', kind, ...base, spec: out.spec, goal: out.goal };
}

// Why the AI's block (goal undefined) or task was left out, in a line the AI can act on: each kind's
// why(spec, goal) (or explain), '' when it holds together. Used to send a failed part back to be fixed.
export function widgetWhy(kind, spec, goal) {
  const k = String(kind || '').toLowerCase();
  const m = mods.get(k);
  if (!m) return `there is no interactive part called "${str(kind, 20)}"; use one of ${[...mods.keys()].join(', ')}`;
  if (!isObj(spec)) return '"spec" must be a JSON object';
  if (goal !== undefined && !isObj(goal)) return '"goal" must be a JSON object';
  if (!small(spec)) return 'the spec is far too long';
  const fn = typeof m.why === 'function' ? m.why : typeof m.explain === 'function' ? m.explain : null;
  if (fn) {
    try { return String(fn(spec, goal) || '').replace(/\s+/g, ' ').slice(0, 300); } catch (err) { return String((err && err.message) || err).replace(/\s+/g, ' ').slice(0, 300); }
  }
  // a kind with no reasons of its own: whether its own check passes
  let ok = null;
  try { ok = goal === undefined ? m.block(spec) : m.task(spec, goal); } catch { ok = null; }
  return ok ? '' : `it breaks one of the rules for "${k}" given above`;
}

// For the tutor and anything else that reads a lesson as text: what a widget is, in a line.
export function widgetLine(b) {
  const m = mods.get(b && b.kind);
  return `[${m ? m.label : 'an interactive part'}${b && b.caption ? `: ${b.caption}` : ''}]`;
}

// The words in a widget's spec that a translator should translate ([] for most kinds), and the spec
// with translated words put back (null: keep the original).
export function widgetTexts(kind, spec) {
  const m = mods.get(kind);
  try { return m && typeof m.texts === 'function' ? m.texts(spec).filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export function widgetWithTexts(kind, spec, words) {
  const m = mods.get(kind);
  try { return m && typeof m.withTexts === 'function' ? m.withTexts(spec, words) : null; } catch { return null; }
}
