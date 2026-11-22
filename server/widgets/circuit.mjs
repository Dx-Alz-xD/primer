// =====================================================================
// The circuit, for lessons on electricity (server/widgets.mjs): a live
// circuit diagram with textbook symbols (cells, resistors, bulbs, switches,
// LEDs, ammeters and voltmeters) that the learner switches and adjusts,
// and tasks done in it: light the right bulbs, make a meter read a value,
// add the missing wire. In build mode ("build": true and a "palette") the
// learner places the parts on a grid of dots themselves, and build tasks
// are checked on whatever they build: bulbs lit (equally, or in an order),
// parts in series or in parallel, a reading, an equivalent resistance, a
// meter placed right, a switch that controls only some lamps.
//
// The checks and the solver are shared with the page, in
// assets/js/widgets/circuit-core.js: every circuit the AI writes must be
// whole (known parts, sensible values, nodes that exist, no loose ends,
// a cell, not a short circuit as it starts), and every task must be
// possible (some setting of its switches and sliders meets the goal) and
// not already done. A build task's goal carries "answer", a build from the
// palette that is checked to meet it. Anything else is left out of the lesson.
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
Circuit ("kind": "circuit"): a textbook circuit diagram the app solves live: moving current, glowing bulbs, meters.
Diagram: "spec": {"nodes": {"a": [x, y]}, "parts": [...], "controls": [...], "labels": [{"at": [x, y], "text": "..."}]}; nodes x 0-8, y 0-6 (y down; about 6 by 4), one per point. Draw like a textbook (series: a rectangle; parallel: a ladder between two rails), parts along rows or columns, 2-4 apart, never over a node.
Parts {"id": "R1", "type": ..., "from": "a", "to": "b"}: "cell"/"battery" ("value" volts, "to" is +), "resistor"/"bulb" ("value" ohms), "switch" ("closed"), "led" (lit by current "from" to "to"; 200 ohms in series), "ammeter" (in series), "voltmeter" (across a part), "wire" (no id). Nodes join 2+ parts; at most 16 parts besides wires; no cell shorted by wires, switches or ammeters.
"controls": switch ids and sliders {"part": "R1", "min": 2, "max": 20, "step": 2} (default: every switch). A circuit needs a bulb, LED or meter, a diagram block a switch or slider.
Block example: {"t":"widget","kind":"circuit","caption":"Close S1, then S2: L1 stays as bright.","spec":{"nodes":{"a":[0,0],"b":[3,0],"c":[6,0],"d":[0,4],"e":[3,4],"f":[6,4]},"parts":[{"id":"B1","type":"battery","from":"d","to":"a","value":6},{"id":"S1","type":"switch","from":"a","to":"b"},{"id":"L1","type":"bulb","from":"b","to":"e","value":12},{"id":"S2","type":"switch","from":"b","to":"c"},{"id":"L2","type":"bulb","from":"c","to":"f","value":12},{"type":"wire","from":"f","to":"e"},{"id":"A1","type":"ammeter","from":"e","to":"d"}]}}
Tasks are done in the circuit (sums are "numeric"). Diagram goals start unmet; the app tries every setting:
- {"type": "light", "on": ["L2"]}: set so exactly these lamps light ("off": [...]: only these stay dark)
- {"type": "reading", "meter": "A1", "value": 0.5}: a meter reads this (A or V)
- {"type": "connect", "terminals": ["p", "q", "r"], "on": ["L1"]}: one wire left out (ends loose); one pair of these 3-6 nodes lights the lamps. No "controls".
Build mode: the learner places the parts. "spec": {"build": true, "grid": [6, 4], "palette": {...}}: dots at whole x 0-6, y 0-4; each part, wires too, straight along a row or column between two dots; a wire joins every dot it passes, a part only its ends. "parts" ([x, y] points) start fixed; "nodes" ({"P": [0, 1]}) are labelled dots. "palette": {"cell": [6], "resistor": [4, 4], "bulb": {"count": 2, "value": 6}, "switch": 1, "led": ["red"], "ammeter": 1, "voltmeter": 1, "wire": 12} ("values": [2, 4] to choose); ids follow the spec's (R1, R2...). A build block: a sandbox, or a circuit to finish. Build goals, checked on whatever is built, hold "answer": the parts a right build adds, from the palette:
- {"type": "lit", "on": ["L1", "L2"], "equal": true} (or "order": brightest first)
- {"type": "series", "parts": ["L1", "L2"]}, or "parallel"
- {"type": "reading", "meter": "A1", "value": 0.5}
- {"type": "equivalent", "between": ["P", "Q"], "value": 6}
- {"type": "measure", "meter": "V1", "across": "R2"} ("through" for an ammeter)
- {"type": "control", "switch": "S1", "on": ["L2"]}: S1 turns L2, and no other lamp, on and off
Task example: {"type":"task","kind":"circuit","prompt":"Connect L1 and L2 in parallel across the cell.","spec":{"build":true,"grid":[4,2],"parts":[{"id":"B1","type":"cell","from":[0,2],"to":[0,0],"value":3}],"palette":{"bulb":{"count":2,"value":6},"wire":8}},"goal":{"type":"parallel","parts":["L1","L2"],"answer":[{"type":"wire","from":[0,0],"to":[2,0]},{"id":"L1","type":"bulb","from":[1,0],"to":[1,2]},{"id":"L2","type":"bulb","from":[2,0],"to":[2,2]},{"type":"wire","from":[0,2],"to":[2,2]}]}}
Blocks show ideas, tasks test them. A lesson on series and parallel, equivalent resistance, meters or Ohm's law gets at least one build task. Use the lesson's own idea and numbers; examples show only the format. Only for electricity.`.trim();

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
function note(what, err, data) {
  if (debug()) console.log(`[widgets] circuit ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}

// A circuit written with nothing to try gets something: a slider on its first resistor (or bulb, or cell),
// from a quarter of its value to three times it, in steps that keep the value it was written with.
function withSlider(spec, out) {
  const p = ['resistor', 'bulb', 'cell', 'battery'].map((t) => out.parts.find((x) => x.type === t && x.value > 0)).find(Boolean);
  if (!p) return null;
  const T = core.TYPES[p.type];
  const step = Number((p.value / 4).toPrecision(3));
  const max = Math.min(T.max, Number((p.value * 3).toPrecision(3)));
  if (!(step >= T.min) || max <= step) return null;
  try {
    const next = core.normSpec({ ...spec, controls: [{ part: p.id, min: step, max, step }] });
    return next.controls.length ? next : null;
  } catch { return null; }
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try {
    let out = core.normSpec(spec);
    // a circuit to build is something to try already (normSpec checked it has a palette and something to see)
    if (out.build) return out;
    // a block is for trying things; one with no switch or slider is only a picture (lessons have figures for that),
    // so it gets a slider if it has a value to change, and is left out if it hasn't
    if (!out.controls || !out.controls.length) out = withSlider(spec, out);
    if (!out) throw new core.CircuitError('a block needs something to try: a switch or a slider');
    return out;
  } catch (err) {
    if (!(err instanceof core.CircuitError)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: the goal must be reachable and not met at the start; null leaves it out.
export function task(spec, goal) {
  try {
    const out = core.normTask(spec, goal);
    // a build task kept with an answer the app made, the AI's being missing or wrong
    if (out.made && debug()) console.log(`[widgets] circuit task kept with the app's own answer (the AI's: ${out.made})`);
    return out;
  } catch (err) {
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

// Why a spec (and goal) would be left out, or '' if it holds together: for tests, the debug log, and the
// repair round (server/ai.mjs sends a failed part back to the model with this reason).
export function why(spec, goal) {
  try {
    if (goal === undefined) {
      const out = core.normSpec(spec);
      if (!out.build && (!out.controls || !out.controls.length) && !withSlider(spec, out)) return 'a block needs something to try: give it "controls" (a switch, or a slider for a value)';
    } else core.normTask(spec, goal);
    return '';
  } catch (err) {
    // parts this diagram doesn't have, which the breadboard does: say where they belong
    const m = /unknown part type "([^"]+)"/.exec(err.message);
    if (m && /capacit|transistor|npn|pnp|mosfet|diode|zener|servo|relay|sensor|tmp36|ldr|potentio|buzzer|motor|arduino|seg|lcd/i.test(m[1])) {
      return `${err.message}: the "circuit" kind has no ${m[1]}s; rebuild this part with the "breadboard" kind, which has capacitors, transistors, diodes, motors, sensors and an Arduino`;
    }
    return err.message;
  }
}
