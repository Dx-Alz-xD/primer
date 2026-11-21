// =====================================================================
// The circuit, for lessons on electricity (server/widgets.mjs): a live
// circuit diagram with textbook symbols (cells, resistors, bulbs, switches,
// LEDs, ammeters and voltmeters) that the learner switches and adjusts,
// and tasks done in it: light the right bulbs, make a meter read a value,
// add the missing wire.
//
// The checks and the solver are shared with the page, in
// assets/js/widgets/circuit-core.js: every circuit the AI writes must be
// whole (known parts, sensible values, nodes that exist, no loose ends,
// a cell, not a short circuit as it starts), and every task must be
// possible (some setting of its switches and sliders meets the goal) and
// not already done. Anything else is left out of the lesson.
//
// PRIMER_WIDGET_DEBUG=1 logs why a circuit was left out.
// =====================================================================
import core from '../../assets/js/widgets/circuit-core.js';

export const label = 'a circuit diagram';

// Words that say a lesson is about electric circuits, in the languages Primer serves. Strong words are
// enough alone; weak ones ("circuit", "current", "resistance", "cell"...) also mean other things, so two
// different ones must appear together.
const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const latin = (w) => START + w + END;      // a whole word
const stem = (w) => START + w;             // a word that starts so
const any = (w) => w;                      // anywhere (scripts where words join up)
const STRONG = [
  // English
  stem('electric'), latin('ohm(?:s|\'s|’s)?'), stem('resistors?'), stem('voltage'), latin('volts?'), stem('voltmeter'), stem('ammeter'),
  stem('galvanometer'), stem('multimeter'), latin('amperes?'), stem('amperage'), stem('kirchhoff'), stem('rheostat'), latin('potential difference'),
  stem('electromotive'), latin('e\\.?m\\.?f'), stem('diodes?'), latin('leds'), latin('light[- ]emitting'), latin('short[- ]circuits?'),
  latin('series circuits?'), latin('parallel circuits?'), latin('circuit diagrams?'), stem('wheatstone'), latin('breadboard'),
  // Hindi, Marathi, Bhojpuri, Maithili
  any('विद्युत'), any('बिजली'), any('परिपथ'), any('सर्किट'), any('प्रतिरोधक'), any('वोल्टता'), any('वोल्टेज'), any('विभवांतर'), any('विभवान्तर'),
  any('एमीटर'), any('अमीटर'), any('ऐमीटर'), any('वोल्टमीटर'), any('ओम का नियम'), any('ओम के नियम'), any('किरचॉफ'), any('किरखोफ'),
  // Tamil
  any('மின்சுற்று'), any('மின்சாரம்'), any('மின்னோட்டம்'), any('மின்தடை'), any('மின்னழுத்தம்'), any('மின்கல'), any('ஓம் விதி'),
  // Telugu
  any('విద్యుత్'), any('వోల్టేజ్'), any('ఓమ్ నియమం'), any('నిరోధకం'),
  // Bengali, Assamese
  any('বর্তনী'), any('বৰ্তনী'), any('বিদ্যুৎ'), any('তড়িৎ'), any('ভোল্টেজ'), any('রোধক'), any('ওহমের সূত্র'), any('ও’মের সূত্র'),
  // Gujarati
  any('વિદ્યુત'), any('વીજળી'), any('પરિપથ'), any('અવરોધક'),
  // Kannada
  any('ವಿದ್ಯುತ್'), any('ವಿದ್ಯುನ್ಮಂಡಲ'), any('ರೋಧಕ'),
  // Malayalam
  any('വൈദ്യുത'), any('സർക്യൂട്ട്'), any('പ്രതിരോധകം'),
  // Punjabi
  any('ਬਿਜਲੀ'), any('ਬਿਜਲਈ'), any('ਸਰਕਟ'), any('ਸਰਕਿਟ'),
  // Odia
  any('ବିଦ୍ୟୁତ'), any('ପରିପଥ'),
  // Urdu
  any('برقی'), any('بجلی'), any('سرکٹ'), any('وولٹیج'),
  // Arabic
  any('كهرباء'), any('كهربائي'), any('كهربية'), any('دائرة كهربائية'), any('قانون أوم'), any('فولت'),
  // Spanish, Portuguese, French
  stem('el[eé]c?tric'), stem('electricidad'), stem('eletricidade'), stem('electricidade'), stem('voltaje'), stem('voltagem'),
  stem('volt[ií]metro'), stem('amper[ií]metro'), latin('ley de ohm'), latin('lei de ohm'),
  stem('[ée]lectrique'), stem('[ée]lectricit[ée]'), latin('loi d\'ohm'), latin('loi d’ohm'), stem('amp[èe]rem[èe]tre'), stem('voltm[èe]tre'),
  // Russian
  stem('электрическ'), stem('электричеств'), stem('резистор'), stem('амперметр'), stem('вольтметр'), latin('закон ома'), stem('кирхгоф'),
  // German
  stem('stromkreis'), stem('elektrisch'), stem('schaltkreis')
];
const WEAK = [
  ['circuit', stem('circuits?')], ['current', latin('currents?')], ['battery', stem('batter(?:y|ies)')], ['bulb', latin('bulbs?')],
  ['switch', latin('switch(?:es)?')], ['resistance', latin('resistance')], ['cell', latin('cells?')], ['series', latin('series')],
  ['parallel', latin('parallel')], ['wire', latin('wires?')], ['charge', latin('charges?')], ['conductor', latin('conductors?')],
  ['धारा', any('धारा')], ['प्रतिरोध', any('प्रतिरोध')], ['बैटरी', any('बैटरी')], ['बल्ब', any('बल्ब')], ['श्रेणी', any('श्रेणी')], ['समांतर', any('समांतर|समानांतर|समान्तर|पार्श्व')],
  ['சுற்று', any('சுற்று')], ['వలయం', any('వలయం')], ['నిరోధం', any('నిరోధం')], ['রোধ', any('রোধ')], ['প্রবাহ', any('প্রবাহ')],
  ['અવરોધ', any('અવરોધ')], ['ಮಂಡಲ', any('ಮಂಡಲ')], ['പ്രതിരോധം', any('പ്രതിരോധം')], ['مزاحمت', any('مزاحمت')], ['مقاومة', any('مقاومة')], ['تيار', any('تيار')],
  ['circuito', stem('circuitos?')], ['corriente', latin('corriente')], ['corrente', latin('corrente')], ['resistencia', stem('resist[eê]ncia')],
  ['courant', latin('courant')], ['résistance', latin('r[ée]sistance')], ['pila', latin('pilas?')], ['ampoule', latin('ampoules?')],
  ['цепь', stem('цеп[ьи]')], ['ток', latin('ток[аи]?')], ['сопротивлени', stem('сопротивлени')], ['напряжени', stem('напряжени')],
  ['widerstand', stem('widerstand')], ['spannung', latin('spannung')]
];
// phrases where those words mean something else
const NOT = /circuit[- ]training|circuit court|circuit judge|(?:racing|race|grand prix|f1|formula (?:one|1)|lecture|comedy|festival|tennis|tour) circuits?|electric (?:guitar|blue|eel)s?|current (?:affairs|events|account)|(?:ocean|sea|air|rip) currents?|cell (?:biology|membrane|division|wall)s?|prison cells?|resistance (?:movement|fighters?)|french resistance|antibiotic resistance|series of|tv series|parallel (?:lines?|universe)/g;
const strongRe = new RegExp(STRONG.join('|'), 'u');
const weakRe = WEAK.map(([k, w]) => [k, new RegExp(w, 'u')]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (strongRe.test(s)) return true;
  return weakRe.filter(([, re]) => re.test(s)).length >= 2;
}

export const prompt = String.raw`
Circuit ("kind": "circuit"): a live circuit diagram drawn with textbook symbols. The app solves it (Ohm's law, series and parallel) and shows the current moving, bulbs glowing by their power and meters reading live; the learner taps switches and drags sliders.
"spec": {"nodes": {...}, "parts": [...], "controls": [...], "labels": [...]}
- "nodes": named points on a grid, {"a": [x, y], ...}, x from 0 to 8 and y from 0 to 6, y growing downward (about 6 across and 4 down reads best on a phone); never two at the same point. Lay it out like a textbook diagram: a rectangle for a series circuit; for parallel, a ladder whose branches each join the same two rails (as in the block example); every part on a straight row or column between two nodes 2 to 4 apart, and no part passing over another node.
- "parts": each {"id": "R1", "type": ..., "from": "a", "to": "b"}, and:
  "cell", or "battery" (drawn as two cells): "value" in volts; "to" is its + terminal.
  "resistor", "bulb": "value" in ohms.
  "switch": "closed": true or false.
  "led": lights only when current flows from "from" to "to"; about 2 V across it; give it a resistor in series (about 200 ohms).
  "ammeter": in series, reads the current. "voltmeter": across what it measures, and it may share both its nodes with that part (the app draws it alongside); reads the voltage.
  "wire": no id needed.
  Every node joins at least two parts. At most 16 parts besides wires; at least one cell or battery; ids like B1, S1, L1, R1, A1, V1. A cell's two ends must never be joined by only wires, switches or ammeters (a short circuit).
- "controls" (optional): what the learner may change: a switch's id, or a slider {"part": "R1", "min": 2, "max": 20, "step": 2} for a cell's, resistor's or bulb's value. Without "controls", every switch can be tapped; [] for none.
- "labels" (optional): [{"at": [x, y], "text": "a few words"}].
Every circuit needs something to see (a bulb, an LED or a meter), and a block something to try (a switch, or a slider).
Block example: {"t": "widget", "kind": "circuit", "caption": "Close S1, then S2: L2 joins in parallel and L1 stays just as bright.", "spec": {"nodes": {"a": [0, 0], "b": [3, 0], "c": [6, 0], "d": [0, 4], "e": [3, 4], "f": [6, 4]}, "parts": [{"id": "B1", "type": "battery", "from": "d", "to": "a", "value": 6}, {"id": "S1", "type": "switch", "from": "a", "to": "b", "closed": false}, {"id": "L1", "type": "bulb", "from": "b", "to": "e", "value": 12}, {"id": "S2", "type": "switch", "from": "b", "to": "c", "closed": false}, {"id": "L2", "type": "bulb", "from": "c", "to": "f", "value": 12}, {"type": "wire", "from": "f", "to": "e"}, {"id": "A1", "type": "ammeter", "from": "e", "to": "d"}]}}
A task is something the learner does in the circuit, not a sum to work out (for a calculation, ask a "numeric" question). Its goal ("goal") is one of:
- {"type": "light", "on": ["L2"]}: set the switches (and sliders) so exactly these bulbs or LEDs light and the others don't (or add "off": [...] to name the only ones that must stay off).
- {"type": "reading", "meter": "A1", "value": 0.5, "tolerance": 0.02}: set the sliders (and switches) so the meter reads this, in amperes or volts. "meter" is an ammeter or voltmeter in the spec (to measure a current through an LED or a bulb, put an ammeter in series with it).
- {"type": "connect", "terminals": ["p", "q", "r"], "on": ["L1"]}: the spec leaves one wire out, so its two ends are loose; the learner joins two of these 3 to 6 nodes with one wire so the named lamps light with no short circuit, and some choices must not work. Leave "controls" out.
For "light" and "reading", the spec must have controls, and must start wrong (switches open, a slider at another value): the app tries every setting (each switch both ways, each slider at each step), and leaves out a task already done at the start or that no setting can do. Work every number out exactly (6 V across 12 ohms is 0.5 A).
Task example: {"type": "task", "kind": "circuit", "prompt": "Set R1 so the ammeter reads 0.5 A.", "spec": {"nodes": {"a": [0, 0], "b": [4, 0], "c": [4, 3], "d": [0, 3]}, "parts": [{"id": "B1", "type": "cell", "from": "d", "to": "a", "value": 6}, {"id": "A1", "type": "ammeter", "from": "a", "to": "b"}, {"id": "R1", "type": "resistor", "from": "b", "to": "c", "value": 4}, {"type": "wire", "from": "c", "to": "d"}], "controls": [{"part": "R1", "min": 2, "max": 20, "step": 2}]}, "goal": {"type": "reading", "meter": "A1", "value": 0.5}, "hint": "I = V / R, so R = V / I.", "explain": "R = 6 V / 0.5 A = 12 ohms."}
Use a block to show an idea and let the learner explore it (a switch in one branch, series against parallel, what a voltmeter across a bulb reads), and tasks to test it (which switches light only L2? set R so the ammeter reads 0.5 A; where does the missing wire go?). Build circuits for this lesson's own idea and numbers; the examples only show the format. Use the circuit only in lessons on electricity.`.trim();

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
function note(what, err, data) {
  if (debug()) console.log(`[widgets] circuit ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try {
    const out = core.normSpec(spec);
    // a block is for trying things; one with no switch or slider is only a picture (lessons have figures for that)
    if (!out.controls || !out.controls.length) throw new core.CircuitError('a block needs something to try: a switch or a slider');
    return out;
  } catch (err) {
    if (!(err instanceof core.CircuitError)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: the goal must be reachable and not met at the start; null leaves it out.
export function task(spec, goal) {
  try { return core.normTask(spec, goal); } catch (err) {
    if (!(err instanceof core.CircuitError)) throw err;
    note('task', err, { spec, goal });
    return null;
  }
}

// The words a translator should translate (server/widgets.mjs): the notes on the drawing, then the parts'
// own names where they have one ("Bulb A"); ids (R1), values and node names stay as they are.
export function texts(spec) {
  if (!spec || typeof spec !== 'object') return [];
  const notes = Array.isArray(spec.labels) ? spec.labels.map((l) => l && l.text) : [];
  const names = Array.isArray(spec.parts) ? spec.parts.map((p) => p && p.label) : [];
  return [...notes, ...names].filter((s) => typeof s === 'string' && s);
}

// The same (already checked) spec with those words translated, in the same order; null keeps the original.
export function withTexts(spec, words) {
  const want = texts(spec);
  if (!want.length || !Array.isArray(words) || words.length !== want.length) return null;
  let k = 0;
  const next = (max, was) => core.text(typeof words[k] === 'string' ? words[k++] : (k++, ''), max) || was;
  const out = { ...spec };
  if (Array.isArray(spec.labels)) out.labels = spec.labels.map((l) => (l && typeof l.text === 'string' && l.text ? { ...l, text: next(40, l.text) } : l));
  if (Array.isArray(spec.parts)) out.parts = spec.parts.map((p) => (p && typeof p.label === 'string' && p.label ? { ...p, label: next(16, p.label) } : p));
  return out;
}

// Why a spec (and goal) would be left out, or '' if it holds together: for tests and the debug log.
export function why(spec, goal) {
  try { if (goal === undefined) core.normSpec(spec); else core.normTask(spec, goal); return ''; } catch (err) { return err.message; }
}
