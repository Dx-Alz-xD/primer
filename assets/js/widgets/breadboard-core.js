/* =====================================================================
   The breadboard bench, shared by the server (server/widgets/
   breadboard.mjs checks every bench the AI writes, and proves each task
   can be done) and the page (assets/js/widgets/breadboard.js draws it,
   runs it live and checks the learner's own build). The server imports
   this file; the page loads it with a script element
   (window.PrimerBreadboard).

   The board: a half-size breadboard, columns 1 to 30 and rows a to j.
   In each column, holes a-e are one strip and f-j another (the centre
   gap parts them); the four rails, "+T" and "-T" along the top and "+B"
   and "-B" along the bottom, are each one long strip. A hole is "a12";
   a rail hole "+T12" (a rail with no column means a free hole on it).
   Beside the board: a battery ("BAT+", "BAT-"), a small DC motor ("M+",
   "M-") and an Arduino Uno (D0-D13, A0-A5, 5V, 3V3, GND, VIN).

   A bench (the "spec"), after normSpec:
     battery   "9V" | "3V" (two AA cells) | null
     arduino   true | false          motor   true | false
     bin       { led: ["red", "any"], resistor: [220, "any"], button: 1,
                 switch, pot, ldr, buzzer: counts }   what is left to place
                 ("any": the learner picks the colour or the value)
     parts     [{ id, type, at: [holes], color?, ohms?, knob?, light?, on? }]
               led [anode, cathode]; resistor; button (press and hold);
               switch [first, middle, last]: on joins middle and first;
               pot [end, wiper, end], ohms, knob 0-1; ldr, light 0-1;
               buzzer [+, -]
     wires     [{ from, to, color }]   holes, rail holes or terminals
     code      the starter sketch (Arduino C), or ''
     hide_values   true: the bin shows resistors by their bands only
   A task's goal, after normGoal: { type, ... }
     light     count, color?, part? (led|buzzer|motor), ohms?, mA? [lo, hi], pin?
     series    count     LEDs in series, all lit
     parallel  count     LEDs in parallel, all lit
     button    when (pressed|released), pin?, led_pin?
     switch    pin?, led_pin?
     dimmer    by (pot|ldr), lit? (dark|bright), pin?, led_pin?
     blink     pin, on_ms, off_ms
     serial    text
   The learner's attempt ("value") is their whole build:
     { parts: [...], wires: [...], code }   (ids and holes their own)

   The simulation: the strips, wires and closed switches join holes into
   nets; resistors, the pot, the LDR and the motor are conductances; the
   battery, the Arduino's 5V and 3V3 and its output pins are sources with
   an inner resistance (so a short circuit is a big current, not a
   division by zero); an LED or the buzzer is a piecewise-linear diode,
   settled by iterating; every net has a tiny leak to ground so nothing
   floats. Solved by nodal analysis with Gaussian elimination. A PWM pin
   is solved high and low, and the results averaged by its duty.

   The sketch: an Arduino C subset (setup and loop, int long float bool
   byte char const unsigned, arrays, if else for while do switch,
   functions, #define), compiled to closures and generators (no eval):
   delay() moves simulated time on, and the run pauses at any statement,
   so the page stays responsive and a check can run seconds of it at once.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerBreadboard = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  class BBError extends Error {}
  const fail = (msg) => { throw new BBError(msg); };
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
  const show = (v) => String(v == null ? '' : v).replace(/[^\w .:+#-]/g, '').slice(0, 24);
  const round = (x, d) => Number(Number(x).toPrecision(d || 6));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };
  const ID = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;

  function parseBool(v, dflt) {
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === 0) return v === 1;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', 'yes', 'on', '1', 'closed', 'pressed'].includes(s)) return true;
      if (['false', 'no', 'off', '0', 'open', 'none', 'released'].includes(s)) return false;
    }
    return dflt;
  }
  function parseNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string' || v.length > 30) return NaN;
    const m = /^\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(v);
    return m ? Number(m[1]) : NaN;
  }
  // 220, "220", "220 ohms", "1k", "4.7k", "4k7", "10 kΩ", "1M"
  function parseOhms(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string' || v.length > 30) return NaN;
    const s = v.trim().replace(/\s+/g, '').replace(/(ohms?|Ω|ω|Ω)$/i, '');
    let m = /^(\d+)([kKmMrR])(\d+)$/.exec(s); // 4k7
    if (m) return Number(m[1] + '.' + m[3]) * ({ k: 1e3, m: 1e6, r: 1 })[m[2].toLowerCase()];
    m = /^(\d+(?:\.\d+)?|\.\d+)([kKM]?)$/.exec(s);
    if (!m) return NaN;
    return Number(m[1]) * (m[2] === 'M' ? 1e6 : m[2] ? 1e3 : 1);
  }
  // two significant figures, as the colour code writes them
  function sig2(v) {
    if (!(v > 0)) return v;
    const e = Math.floor(Math.log10(v)) - 1;
    return round(Math.round(v / Math.pow(10, e)) * Math.pow(10, e), 6);
  }

  /* ---------------- the board ---------------- */

  const COLS = 30;
  const ROWS = 'abcdefghij';
  const ROW_Y = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 6, g: 7, h: 8, i: 9, j: 10 };
  const RAIL_Y = { '-T': -3, '+T': -2, '+B': 12, '-B': 13 };
  const RAILS = Object.keys(RAIL_Y);
  const RAIL_COLS = [];
  for (let c = 1; c <= COLS; c++) if (c % 6 !== 1) RAIL_COLS.push(c); // groups of five: 2-6, 8-12 ... 26-30
  const HOLES = new Map(); // name -> { name, col, x, y, strip, row }
  const AT = new Map();    // "x,y" -> name
  function addHole(name, col, y, strip, row) {
    const h = { name, col, x: col - 1, y, strip, row };
    HOLES.set(name, h);
    AT.set(h.x + ',' + y, name);
  }
  for (let c = 1; c <= COLS; c++) for (const r of ROWS) addHole(r + c, c, ROW_Y[r], (ROW_Y[r] < 5 ? 'U' : 'D') + c, r);
  for (const rail of RAILS) for (const c of RAIL_COLS) addHole(rail + c, c, RAIL_Y[rail], rail, rail);
  const holeAt = (x, y) => AT.get(x + ',' + y) || null;

  // what sits beside the board: terminals that wires go to
  const DIGITAL = Array.from({ length: 14 }, (_, i) => 'D' + i);
  const ANALOG = Array.from({ length: 6 }, (_, i) => 'A' + i);
  const PINS = DIGITAL.concat(ANALOG);           // pin numbers 0-19 (A0 is 14)
  const PWM = [3, 5, 6, 9, 10, 11];
  const POWER = ['5V', '3V3', 'GND', 'VIN'];
  const BAT = ['BAT+', 'BAT-'];
  const MOTOR = ['M+', 'M-'];
  const pinNo = (name) => (name[0] === 'D' ? Number(name.slice(1)) : 14 + Number(name.slice(1)));
  const pinName = (n) => (n < 14 ? 'D' + n : 'A' + (n - 14));
  const isTerm = (name) => BAT.includes(name) || MOTOR.includes(name) || POWER.includes(name) || PINS.includes(name);
  function termsOf(spec) {
    return [].concat(spec.battery ? BAT : [], spec.motor ? MOTOR : [], spec.arduino ? POWER.concat(PINS) : []);
  }

  // a hole, rail or terminal as written -> { hole } | { rail, col } | { term } | null
  function parsePoint(v, arduino) {
    if (typeof v === 'number' && Number.isInteger(v)) v = String(v);
    if (typeof v !== 'string') return null;
    let s = v.trim().replace(/\s+/g, '');
    if (!s || s.length > 24) return null;
    // lower case is always a hole; upper case is a hole too, unless it names an Arduino pin (D0-D13, A0-A5)
    let m = /^([a-j])(\d{1,2})$/.exec(s) || /^([A-J])(\d{1,2})$/.exec(s);
    if (m && !((m[1] === 'A' && Number(m[2]) <= 5) || (m[1] === 'D' && Number(m[2]) <= 13))) {
      const name = m[1].toLowerCase() + Number(m[2]);
      return HOLES.has(name) ? { hole: name } : null;
    }
    m = /^(\d{1,2})([a-jA-J])$/.exec(s);
    if (m) { const name = m[2].toLowerCase() + Number(m[1]); return HOLES.has(name) ? { hole: name } : null; }
    let low = s.toLowerCase();
    // rails: +T, -T12, T+, top+, +top, +L, -B, +bottom5, +
    m = /^([+-])(t|top|l|left|b|bottom|r|right)?(?:rail)?(\d{1,2})?$/.exec(low) || /^(?:rail)?(t|top|l|left|b|bottom|r|right)([+-])(\d{1,2})?$/.exec(low);
    if (m) {
      const sign = m[1] === '+' || m[1] === '-' ? m[1] : m[2];
      const side = m[1] === '+' || m[1] === '-' ? m[2] : m[1];
      const col = m[3] ? Number(m[3]) : null;
      if (col != null && (col < 1 || col > COLS)) return null;
      return { rail: sign + (/^(b|bottom|r|right)$/.test(side || '') ? 'B' : 'T'), col };
    }
    // the battery, the motor
    m = /^(?:bat(?:tery)?\d?|b\d|cell)[.:_-]?(\+|-|plus|minus|pos(?:itive)?|neg(?:ative)?|red|black)$/.exec(low);
    if (m) return { term: /^(\+|plus|pos|positive|red)$/.test(m[1]) ? 'BAT+' : 'BAT-' };
    m = /^(?:m\d?|motor\d?)[.:_-]?(\+|-|1|2|a|b)$/.exec(low);
    if (m) return { term: /^(\+|1|a)$/.test(m[1]) ? 'M+' : 'M-' };
    // the Arduino
    low = low.replace(/^(?:u\d|arduino|uno|ard)[.:_-]?/, '');
    if (/^(?:led_?builtin)$/.test(low)) return { term: 'D13' };
    m = /^(?:d|pin|digital|io)?(\d{1,2})$/.exec(low);
    if (m) { const n = Number(m[1]); return n <= 19 ? { term: pinName(n) } : null; }
    m = /^a([0-5])$/.exec(low);
    if (m) return { term: 'A' + m[1] };
    if (/^\+?5v?$/.test(low) && low !== '5') return { term: '5V' };
    if (/^(?:3\.3v?|3v3|\+3\.3v)$/.test(low)) return { term: '3V3' };
    if (/^(?:gnd\d?|ground|0v)$/.test(low)) return { term: 'GND' };
    if (low === 'vin') return { term: 'VIN' };
    return null;
  }

  /* ---------------- the parts ---------------- */

  const LEDS = { red: 1.8, yellow: 1.9, green: 2.0, blue: 2.8, white: 2.8 }; // the knee of each colour, volts
  const LED_COLORS = Object.keys(LEDS);
  const LED_RS = 15;           // and its resistance above it
  const BUZZ = { vf: 1.2, rs: 160 };
  const MOTOR_R = 30;
  const R_PIN = 25, R_PULLUP = 20000, R_5V = 0.1, R_3V3 = 0.5;
  const BATTERIES = { '9V': { v: 9, r: 1.5 }, '3V': { v: 3, r: 0.3 } };
  const LIT = 0.001;           // an LED is lit from 1 mA
  const FULL = 0.018;          // fully bright
  const BURN = 0.035;          // and burns out above about 30 mA (on average), or twice it at a peak
  const WIRE_COLORS = ['red', 'black', 'blue', 'green', 'yellow', 'orange', 'white', 'purple'];
  const STANDARD = [10, 22, 47, 100, 150, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 22000, 47000, 100000, 1000000];

  const TYPES = {
    resistor: { legs: [2], gap: [1, 10], foot: [[0, 0], [4, 0]], prefix: 'R' },
    led: { legs: [2], gap: [1, 3], foot: [[0, 0], [1, 0]], prefix: 'L' },
    button: { legs: [2], gap: [1, 4], foot: [[0, 0], [2, 0]], prefix: 'BTN' },
    switch: { legs: [3, 2], gap: [1, 2], foot: [[0, 0], [1, 0], [2, 0]], prefix: 'SW' },
    pot: { legs: [3], gap: [1, 2], foot: [[0, 0], [1, 0], [2, 0]], prefix: 'POT' },
    ldr: { legs: [2], gap: [1, 4], foot: [[0, 0], [2, 0]], prefix: 'LDR' },
    buzzer: { legs: [2], gap: [1, 4], foot: [[0, 0], [2, 0]], prefix: 'BZ' }
  };
  const PART_TYPES = Object.keys(TYPES);
  const ALIASES = {
    res: 'resistor', resistors: 'resistor', r: 'resistor',
    leds: 'led', 'light emitting diode': 'led', 'light-emitting diode': 'led', lamp: 'led',
    pushbutton: 'button', 'push button': 'button', 'push-button': 'button', buttons: 'button', tactile: 'button', 'tactile switch': 'button', 'momentary switch': 'button', 'push switch': 'button',
    'slide switch': 'switch', slideswitch: 'switch', toggle: 'switch', 'toggle switch': 'switch', switches: 'switch', spdt: 'switch',
    potentiometer: 'pot', knob: 'pot', 'variable resistor': 'pot', trimmer: 'pot', pots: 'pot', rheostat: 'pot',
    photoresistor: 'ldr', 'light sensor': 'ldr', 'light dependent resistor': 'ldr', 'light-dependent resistor': 'ldr', photocell: 'ldr', ldrs: 'ldr',
    piezo: 'buzzer', beeper: 'buzzer', buzzers: 'buzzer', 'piezo buzzer': 'buzzer'
  };
  const FIXTURES = { battery: 'battery', batteries: 'battery', cell: 'battery', cells: 'battery', arduino: 'arduino', uno: 'arduino', 'arduino uno': 'arduino', motor: 'motor', 'dc motor': 'motor', motors: 'motor', wire: 'wire', wires: 'wire', jumper: 'wire', jumpers: 'wire', 'jumper wires': 'wire', breadboard: 'wire' };
  function typeOf(v) {
    const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/_/g, ' ') : '';
    if (TYPES[s]) return s;
    return ALIASES[s] || FIXTURES[s] || '';
  }
  function batteryOf(v) {
    if (v == null || v === false || v === '' || v === 'none') return null;
    if (v === true) return '9V';
    const s = String(v).trim().toLowerCase().replace(/\s+/g, '');
    if (/^(9|9v|9volts?|pp3)$/.test(s)) return '9V';
    if (/^(3|3v|3volts?|2xaa|2aa|aa|aax2|2x1\.5v)$/.test(s)) return '3V';
    return undefined;
  }

  // the colour code: two digits, a multiplier, gold for 5%
  const BAND_NAMES = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
  function bands(ohms) {
    const v = sig2(ohms);
    if (!(v >= 1)) return ['black', 'black', 'black', 'gold'];
    if (v < 10) { const d = Math.round(v * 10); return [BAND_NAMES[Math.floor(d / 10)], BAND_NAMES[d % 10], 'gold', 'gold']; }
    const e = Math.floor(Math.log10(v)) - 1;
    const d = Math.round(v / Math.pow(10, e));
    return [BAND_NAMES[Math.floor(d / 10)], BAND_NAMES[d % 10], BAND_NAMES[e], 'gold'];
  }
  const sig = (x) => String(Number(Number(x).toPrecision(3)));
  function fmtOhms(v) { return v >= 1e6 ? sig(v / 1e6) + ' MΩ' : v >= 1e3 ? sig(v / 1e3) + ' kΩ' : sig(v) + ' Ω'; }
  const mA = (i) => (Math.abs(i) >= 0.01 ? Math.round(Math.abs(i) * 1000) : round(Math.abs(i) * 1000, 2));

  /* ---------------- the bench: spec, build, inventory ---------------- */

  const LIMIT = { parts: 20, wires: 40, bin: 30, perType: 10, code: 4000 };

  // the parts bin: [{ type, color }] for LEDs, [{ type, ohms }] for resistors (0 or 'any': the learner picks)
  function binItems(raw) {
    const out = [];
    const add = (type, variant, n) => {
      const t = typeOf(type);
      if (!TYPES[t]) return;
      const count = n == null ? 1 : Math.floor(parseNum(n));
      if (!(count >= 0)) fail(`the bin's "${show(type)}" count is not a number`);
      if (count > LIMIT.perType) fail(`more than ${LIMIT.perType} of one part in the bin`);
      for (let i = 0; i < count; i++) out.push(item(t, variant));
    };
    const item = (t, variant) => {
      if (t === 'led') {
        const c = typeof variant === 'string' ? variant.trim().toLowerCase() : '';
        if (!c || c === 'any') return { type: t, color: 'any' };
        if (!LEDS[c]) fail(`the bin has a "${show(variant)}" LED: LEDs are red, green, yellow, blue or white`);
        return { type: t, color: c };
      }
      if (t === 'resistor') {
        if (variant == null || variant === 'any' || variant === 0) return { type: t, ohms: 0 };
        const v = parseOhms(variant);
        if (!(v >= 1 && v <= 1e6)) fail(`the bin's resistor value "${show(variant)}" is not 1 to 1000000 ohms`);
        return { type: t, ohms: sig2(v) };
      }
      return { type: t };
    };
    if (raw == null) return out;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === 'string') { const [t, v] = x.split(':'); if (TYPES[typeOf(t)]) add(t, v); else if (!FIXTURES[typeOf(t)]) fail(`the bin has an unknown part "${show(t)}"`); }
        else if (isObj(x)) { const t = typeOf(pick(x, ['type', 'kind', 'part'])); if (TYPES[t]) add(t, pick(x, ['color', 'colour', 'ohms', 'value']), pick(x, ['count', 'n'])); else if (!FIXTURES[t]) fail(`the bin has an unknown part "${show(x.type)}"`); }
      }
    } else if (isObj(raw)) {
      for (const k of Object.keys(raw)) {
        const t = typeOf(k);
        const v = raw[k];
        if (!TYPES[t]) { if (FIXTURES[t]) continue; fail(`the bin has an unknown part "${show(k)}" (use led, resistor, button, switch, pot, ldr, buzzer)`); }
        if (Array.isArray(v)) { if (t === 'led' || t === 'resistor') v.forEach((x) => add(t, x)); else add(t, null, v.length); }
        else if (isObj(v)) Object.keys(v).forEach((x) => add(t, x, v[x]));
        else if (v === true) add(t, null, 1);
        else if (v === false || v == null) continue;
        else if ((t === 'led' || t === 'resistor') && typeof v === 'string' && !/^\d+$/.test(v.trim())) add(t, v);
        else add(t, null, v);
      }
    } else fail('"bin" is not an object');
    if (out.length > LIMIT.bin) fail(`more than ${LIMIT.bin} parts in the bin`);
    return out;
  }
  // the bin in its JSON form: { led: ["red", "any"], resistor: [220, "any"], button: 1 }
  function binOut(items) {
    const o = {};
    for (const it of items) {
      if (it.type === 'led') (o.led = o.led || []).push(it.color);
      else if (it.type === 'resistor') (o.resistor = o.resistor || []).push(it.ohms || 'any');
      else o[it.type] = (o[it.type] || 0) + 1;
    }
    return o;
  }

  const DIST = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const RAIL_NEAR = (rail, col, used) => {
    let best = null, bd = Infinity;
    for (const c of RAIL_COLS) {
      const h = rail + c;
      if (used.has(h)) continue;
      const d = Math.abs(c - col);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  };

  // one part, checked; ctx: { used: Map hole -> owner, arduino, learner, ids: Set }
  function normPart(p, ctx, index) {
    if (!isObj(p)) fail('a part is not an object');
    const type = typeOf(pick(p, ['type', 'kind', 'part']));
    if (!TYPES[type]) fail(`unknown part type "${show(pick(p, ['type', 'kind', 'part']))}" (led, resistor, button, switch, pot, ldr, buzzer)`);
    const T = TYPES[type];
    let id = typeof p.id === 'string' ? p.id.trim() : '';
    if (!ID.test(id) || ctx.ids.has(id)) {
      if (id && !ctx.learner) fail(ID.test(id) ? `two parts are called ${id}` : `part id "${show(id)}" should be short, like L1 or R2`);
      let n = 1;
      while (ctx.ids.has(T.prefix + n)) n++;
      id = T.prefix + n;
    }
    ctx.ids.add(id);
    let raw = pick(p, ['at', 'legs', 'pins', 'holes', 'holes_at']);
    if (!Array.isArray(raw)) {
      if (type === 'led' && (p.anode != null || p.cathode != null)) raw = [p.anode, p.cathode];
      else if (p.from != null || p.to != null) raw = [p.from, p.to];
      else if (typeof raw === 'string') raw = raw.split(/[\s,]+/);
      else fail(`${id} has no "at": the holes its legs go in, like ["a5", "a9"]`);
    }
    if (!T.legs.includes(raw.length)) fail(`${id} is a ${type} with ${T.legs[0]} legs, but "at" lists ${raw.length} holes`);
    const pts = raw.map((v) => parsePoint(v, ctx.arduino));
    pts.forEach((q, i) => {
      if (!q) fail(`${id}'s leg "${show(raw[i])}" is not a hole (holes are a1 to j30, or a rail: +T, -T, +B, -B)`);
      if (q.term) fail(`${id}'s leg is on ${q.term}: legs go in breadboard holes; join a hole to ${q.term} with a wire`);
    });
    // rails written without a column: the free hole nearest the part's other legs
    const near = pts.filter((q) => q.hole).map((q) => HOLES.get(q.hole).col);
    const col0 = near.length ? near[0] : (index || 0) % COLS + 1;
    const at = pts.map((q) => {
      if (q.hole) return q.hole;
      const h = RAIL_NEAR(q.rail, q.col != null ? q.col : col0, ctx.used);
      if (!h) fail(`${id}: the ${q.rail} rail is full`);
      return h;
    });
    at.forEach((h, i) => {
      if (at.indexOf(h) !== i) fail(`${id} has two legs in hole ${h}`);
      if (ctx.used.has(h)) fail(`${id} and ${ctx.used.get(h)} both use hole ${h}: a hole holds one leg or wire end`);
    });
    // the legs' spacing: as far apart as the part's legs reach; three legs in a straight row
    const H = at.map((h) => HOLES.get(h));
    if (H.length === 3) {
      const d1 = [H[1].x - H[0].x, H[1].y - H[0].y], d2 = [H[2].x - H[1].x, H[2].y - H[1].y];
      if (d1[0] !== d2[0] || d1[1] !== d2[1]) {
        if (H[0].col === H[1].col && H[1].col === H[2].col) fail(`${id}'s three legs (${at.join(', ')}) go down one column, so two share a strip; a ${type}'s legs sit side by side in one row, each in its own column, like ["${H[2].row}${H[0].col}", "${H[2].row}${H[0].col + 1}", "${H[2].row}${H[0].col + 2}"]`);
        fail(`${id}'s three legs (${at.join(', ')}) must be in a straight row, evenly spaced, like ["a5", "a6", "a7"]`);
      }
    }
    for (let i = 1; i < H.length; i++) {
      const d = DIST(H[i - 1], H[i]);
      if (d < T.gap[0] - 1e-9 || d > T.gap[1] + 1e-9) fail(`${id}'s legs ${at[i - 1]} and ${at[i]} are ${round(d, 3)} holes apart; a ${type}'s legs are ${T.gap[0]} to ${T.gap[1]} apart`);
    }
    if (!ctx.learner) {
      const strips = H.map((h) => h.strip);
      if (new Set(strips).size < strips.length) {
        const s = strips.find((x, i) => strips.indexOf(x) !== i);
        fail(`${id} has two legs in one strip (${/^[UD]/.test(s) ? `column ${s.slice(1)}, rows ${s[0] === 'U' ? 'a-e' : 'f-j'}` : `the ${s} rail`}), which joins them, so no current goes through it: put its legs in different columns`);
      }
    }
    at.forEach((h) => ctx.used.set(h, id));
    const out = { id, type, at };
    if (type === 'led') {
      const c = String(pick(p, ['color', 'colour']) || 'red').trim().toLowerCase();
      if (!LEDS[c]) fail(`${id} is a "${show(c)}" LED: LEDs are red, green, yellow, blue or white`);
      out.color = c;
    }
    if (type === 'resistor') {
      const v = parseOhms(pick(p, ['ohms', 'value', 'resistance', 'r']));
      if (!(v >= 1 && v <= 1e6)) fail(`${id} needs "ohms" from 1 to 1000000 (like 220)`);
      out.ohms = sig2(v);
    }
    if (type === 'pot') {
      const v = parseOhms(pick(p, ['ohms', 'value', 'resistance']) != null ? pick(p, ['ohms', 'value', 'resistance']) : 10000);
      if (!(v >= 1000 && v <= 1e6)) fail(`${id}'s "ohms" should be 1000 to 1000000 (a pot is usually 10000)`);
      out.ohms = sig2(v);
      const k = p.knob != null ? parseNum(p.knob) : 0.5;
      out.knob = Number.isFinite(k) ? round(clamp(k > 1 ? k / 100 : k, 0, 1), 3) : 0.5;
    }
    if (type === 'ldr') {
      const l = p.light != null ? parseNum(p.light) : 0.5;
      out.light = Number.isFinite(l) ? round(clamp(l > 1 ? l / 100 : l, 0, 1), 3) : 0.5;
    }
    if (type === 'switch') out.on = parseBool(pick(p, ['on', 'closed', 'state']), false);
    return out;
  }

  // a wire's end, resolved to a hole or terminal
  function wireEnd(v, other, ctx, what) {
    const q = parsePoint(v, ctx.arduino);
    if (!q) fail(`${what} goes to "${show(v)}", which is not a hole, a rail or a terminal`);
    if (q.term) {
      if (!ctx.terms.has(q.term)) {
        if (BAT.includes(q.term)) fail(`${what} goes to ${q.term} but there is no battery (add "battery": "9V" or "3V")`);
        if (MOTOR.includes(q.term)) fail(`${what} goes to ${q.term} but there is no motor (add "motor": true)`);
        fail(`${what} goes to the Arduino's ${q.term} but there is no Arduino (add "arduino": true)`);
      }
      return q.term;
    }
    if (q.hole) return q.hole;
    const o = parsePoint(other, ctx.arduino);
    const col = q.col != null ? q.col : o && o.hole ? HOLES.get(o.hole).col : o && o.rail && o.col ? o.col : 3;
    const h = RAIL_NEAR(q.rail, col, ctx.used);
    if (!h) fail(`the ${q.rail} rail is full`);
    return h;
  }
  function normWire(w, ctx, k) {
    let a, b, color;
    if (Array.isArray(w)) { a = w[0]; b = w[1]; color = w[2]; }
    else if (isObj(w)) { a = pick(w, ['from', 'a', 'start']); b = pick(w, ['to', 'b', 'end']); color = pick(w, ['color', 'colour']); }
    else fail('a wire is not an object');
    const what = `wire ${k + 1}`;
    // a wire written into the hole a leg already uses means "join it to that leg": on the bench, it goes in
    // the nearest free hole of the same strip (the learner's own build gets no such help)
    const settle = (h) => {
      if (!HOLES.has(h) || !ctx.used.has(h)) return h;
      const alt = ctx.learner ? null : freeInStrip(HOLES.get(h).strip, HOLES.get(h), ctx.used);
      if (!alt) fail(`${what} goes to hole ${h}, which ${ctx.used.get(h)} already uses: a hole holds one leg or wire end, so use another hole in the same strip`);
      return alt;
    };
    const from = settle(wireEnd(a, b, ctx, what));
    if (HOLES.has(from)) ctx.used.set(from, what);
    const to = settle(wireEnd(b, a, ctx, what));
    if (HOLES.has(to)) ctx.used.set(to, what);
    if (from === to) fail(`${what} joins ${from} to itself`);
    if (!ctx.learner && HOLES.has(from) && HOLES.has(to) && HOLES.get(from).strip === HOLES.get(to).strip) fail(`${what} joins ${from} and ${to}, which are in one strip already`);
    let c = typeof color === 'string' ? color.trim().toLowerCase() : '';
    if (!WIRE_COLORS.includes(c)) c = autoColor(from, to, k);
    return { from, to, color: c };
  }
  // the free hole of a strip nearest a hole
  function freeInStrip(strip, near, used) {
    let best = null, bd = Infinity;
    for (const h of HOLES.values()) {
      if (h.strip !== strip || used.has(h.name)) continue;
      const d = DIST(h, near);
      if (d < bd) { bd = d; best = h.name; }
    }
    return best;
  }
  // A wire end alone in its strip, with a leg straight across the centre gap, was meant for that leg's strip
  // (e5 and f5 look joined, and aren't): move it there. Only for benches the AI writes.
  function bridgeGap(spec, used) {
    const count = new Map();
    const bump = (h) => { if (HOLES.has(h)) { const s = HOLES.get(h).strip; count.set(s, (count.get(s) || 0) + 1); } };
    spec.parts.forEach((p) => p.at.forEach(bump));
    spec.wires.forEach((w) => { bump(w.from); bump(w.to); });
    spec.wires.forEach((w) => ['from', 'to'].forEach((end) => {
      const h = HOLES.get(w[end]);
      if (!h || !/^[UD]/.test(h.strip) || count.get(h.strip) !== 1) return;
      const other = (h.strip[0] === 'U' ? 'D' : 'U') + h.col;
      const across = spec.parts.some((p) => p.at.some((x) => HOLES.get(x).strip === other));
      if (!across) return;
      const alt = freeInStrip(other, h, used);
      if (!alt) return;
      used.delete(h.name);
      used.set(alt, 'a wire');
      w[end] = alt;
      count.set(h.strip, 0);
      count.set(other, (count.get(other) || 0) + 1);
    }));
  }
  function autoColor(a, b, k) {
    const plus = (x) => /^(\+[TB]|BAT\+|5V|3V3|VIN)/.test(x);
    const minus = (x) => /^(-[TB]|BAT-|GND)/.test(x);
    if (plus(a) || plus(b)) return 'red';
    if (minus(a) || minus(b)) return 'black';
    return ['blue', 'green', 'yellow', 'orange', 'purple', 'white'][k % 6];
  }
  const cleanCode = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[‪-‮⁦-⁩]/g, '') : '');

  // A bench as the AI (or a course file) writes it, checked; throws BBError. opts.loose: skip the start-state checks
  function normSpec(raw, opts) {
    opts = opts || {};
    if (!isObj(raw)) fail('the spec is not an object');
    const src = isObj(raw.bench) ? raw.bench : raw;
    const spec = { battery: null, arduino: false, motor: false, bin: [], parts: [], wires: [], code: '', hide_values: false };
    const batRaw = pick(src, ['battery', 'power', 'cell']);
    // "5V" or "USB" power is the Arduino's own
    const usb = typeof batRaw === 'string' && /^\s*(5\s*v|usb|arduino|uno)\s*$/i.test(batRaw);
    const bat = usb ? null : batteryOf(batRaw);
    if (bat === undefined) fail('"battery" is "9V" or "3V" (two AA cells); for 5 V, use the Arduino ("arduino": true) and its "5V" and "GND" pins');
    spec.battery = bat;
    spec.arduino = usb || parseBool(pick(src, ['arduino', 'uno', 'microcontroller']), false);
    spec.motor = parseBool(src.motor, false);
    // what the wires and code use says what's on the bench: the Arduino's pins, the battery's clips
    const rawWires0 = Array.isArray(src.wires) ? src.wires : [];
    rawWires0.forEach((w) => {
      const ends = Array.isArray(w) ? w.slice(0, 2) : isObj(w) ? [pick(w, ['from', 'a', 'start']), pick(w, ['to', 'b', 'end'])] : [];
      ends.forEach((e) => {
        const q = parsePoint(e, true);
        if (!q || !q.term) return;
        if (BAT.includes(q.term)) { if (!spec.battery) spec.battery = '9V'; }
        else if (MOTOR.includes(q.term)) spec.motor = true;
        else if (typeof e === 'string' && !/^\d+$/.test(e.trim())) spec.arduino = true;
      });
    });
    if (cleanCode(pick(src, ['code', 'sketch', 'starter_code', 'program'])).trim()) spec.arduino = true;
    // fixtures written as parts or bin entries
    const rawParts = Array.isArray(src.parts) ? src.parts : Array.isArray(src.components) ? src.components : [];
    const binRaw = pick(src, ['bin', 'parts_bin', 'available', 'inventory']);
    const hoist = (t, x) => {
      if (t === 'arduino') spec.arduino = true;
      else if (t === 'motor') spec.motor = true;
      else if (t === 'battery') { const b2 = batteryOf(isObj(x) ? pick(x, ['value', 'volts', 'voltage', 'type']) || true : true); spec.battery = spec.battery || b2 || '9V'; }
    };
    rawParts.forEach((p) => { if (isObj(p)) hoist(typeOf(pick(p, ['type', 'kind', 'part'])), p); });
    if (isObj(binRaw)) Object.keys(binRaw).forEach((k) => { if (binRaw[k]) hoist(typeOf(k), binRaw[k]); });
    else if (Array.isArray(binRaw)) binRaw.forEach((x) => hoist(typeOf(typeof x === 'string' ? x.split(':')[0] : isObj(x) ? pick(x, ['type', 'kind', 'part']) : ''), x));
    spec.bin = binItems(binRaw);
    spec.hide_values = parseBool(pick(src, ['hide_values', 'hideValues', 'bands_only']), false);
    const ctx = { used: new Map(), arduino: spec.arduino, learner: Boolean(opts.learner), ids: new Set(['BAT', 'MOTOR', 'UNO']), terms: new Set(termsOf(spec)) };
    const placed = rawParts.filter((p) => isObj(p) && TYPES[typeOf(pick(p, ['type', 'kind', 'part']))] !== undefined || !isObj(p));
    if (placed.length > LIMIT.parts) fail(`more than ${LIMIT.parts} parts placed`);
    spec.parts = placed.map((p, i) => normPart(p, ctx, i));
    const rawWires = rawWires0;
    if (rawWires.length > LIMIT.wires) fail(`more than ${LIMIT.wires} wires`);
    spec.wires = rawWires.map((w, k) => normWire(w, ctx, k));
    if (!opts.learner) bridgeGap(spec, ctx.used);
    spec.code = cleanCode(pick(src, ['code', 'sketch', 'starter_code', 'program']));
    if (spec.code.length > LIMIT.code) fail(`the code is longer than ${LIMIT.code} characters`);
    if (!spec.battery && !spec.arduino) {
      if (spec.parts.length || spec.bin.length) fail('there is nothing to power the parts: add "battery": "9V" (or "3V"), or "arduino": true');
    }
    if (!spec.parts.length && !spec.bin.length && !spec.wires.length && !spec.motor && !spec.arduino) fail('the bench is empty: put parts in "bin" (and maybe "parts")');
    if (spec.arduino && spec.code.trim()) {
      try { compile(spec.code); } catch (e) { if (e instanceof SketchError) fail('the starter code has an error: ' + e.message); throw e; }
    }
    if (!opts.loose) {
      const v = session(bench(spec, startBuild(spec))).view();
      if (v.short) fail('the bench is a short circuit as it starts: ' + v.shortWhy);
      const burnt = Object.keys(v.parts).find((id) => v.parts[id].burn);
      if (burnt) fail(`${burnt} burns out as the bench starts (${mA(v.parts[burnt].I)} mA): put a resistor (about 220 to 1000 ohms) in series with it`);
    }
    return spec;
  }
  // the spec in its JSON form (normSpec reads it back the same)
  function specOut(spec) {
    const o = { battery: spec.battery, arduino: spec.arduino, motor: spec.motor, bin: binOut(spec.bin), parts: spec.parts.map((p) => Object.assign({}, p, { at: p.at.slice() })), wires: spec.wires.map((w) => Object.assign({}, w)) };
    if (spec.code) o.code = spec.code;
    if (spec.hide_values) o.hide_values = true;
    return o;
  }
  const startBuild = (spec) => ({ parts: spec.parts.map((p) => Object.assign({}, p, { at: p.at.slice() })), wires: spec.wires.map((w) => Object.assign({}, w)), code: spec.code || '' });

  // everything the learner can place: what starts on the board and what's in the bin
  function inventory(spec) {
    return spec.parts.map((p) => (p.type === 'led' ? { type: 'led', color: p.color } : p.type === 'resistor' ? { type: 'resistor', ohms: p.ohms } : { type: p.type }))
      .concat(spec.bin.map((x) => Object.assign({}, x)));
  }
  // take one part out of an inventory list (exact colour or value first, then "any"); its variant, or null
  // (want null or "any": whichever there is, a fixed one first)
  function take(inv, type, want) {
    const loose = want == null || want === 'any' || want === 0;
    let i = inv.findIndex((x) => x.type === type && (loose ? !(x.color === 'any' || x.ohms === 0) : type === 'led' ? x.color === want : type === 'resistor' ? x.ohms === want : true));
    if (i < 0) i = inv.findIndex((x) => x.type === type && (loose || (type === 'led' ? x.color === 'any' && LEDS[want] : type === 'resistor' ? x.ohms === 0 && want > 0 : false)));
    if (i < 0) return null;
    return inv.splice(i, 1)[0];
  }

  // The learner's build (their value), checked against the bench; null if it can't be read.
  function normBuild(value, spec) {
    if (!isObj(value)) return null;
    try {
      const ctx = { used: new Map(), arduino: spec.arduino, learner: true, ids: new Set(['BAT', 'MOTOR', 'UNO']), terms: new Set(termsOf(spec)) };
      const parts = (Array.isArray(value.parts) ? value.parts : []).slice(0, LIMIT.parts + LIMIT.bin).map((p, i) => normPart(p, ctx, i));
      const inv = inventory(spec);
      for (const p of parts) if (!take(inv, p.type, p.type === 'led' ? p.color : p.type === 'resistor' ? p.ohms : null)) return null;
      const wires = (Array.isArray(value.wires) ? value.wires : []).slice(0, 80).map((w, k) => normWire(w, ctx, k));
      return { parts, wires, code: cleanCode(value.code).slice(0, 8000) };
    } catch (e) {
      if (e instanceof BBError) return null;
      throw e;
    }
  }

  /* ---------------- the netlist and the solver ---------------- */

  const INPUT = 0, OUTPUT = 1, PULLUP = 2;

  // the parts and wires of a build, as nodes and elements (compiled once per build)
  function bench(spec, build) {
    const pts = new Map(), names = [];
    const P = (name) => { let i = pts.get(name); if (i === undefined) { i = names.length; pts.set(name, i); names.push(name); } return i; };
    const nodeOf = (point) => (HOLES.has(point) ? '#' + HOLES.get(point).strip : point);
    termsOf(spec).forEach(P);
    const attach = new Map();         // node -> how many legs and wire ends are in it
    const note = (n) => attach.set(n, (attach.get(n) || 0) + 1);
    const els = [];
    const parts = new Map();
    for (const p of build.parts) {
      const legs = p.at.map((h) => P(nodeOf(h)));
      legs.forEach(note);
      parts.set(p.id, Object.assign({}, p, { legs }));
      const [a, b, c] = legs;
      if (p.type === 'resistor') els.push({ k: 'R', a, b, part: p.id, r: p.ohms });
      else if (p.type === 'led') els.push({ k: 'D', a, b, part: p.id, vf: LEDS[p.color] || 1.8, rs: LED_RS });
      else if (p.type === 'buzzer') els.push({ k: 'D', a, b, part: p.id, vf: BUZZ.vf, rs: BUZZ.rs });
      else if (p.type === 'ldr') els.push({ k: 'R', a, b, part: p.id, ldr: true });
      else if (p.type === 'pot') { els.push({ k: 'R', a, b, part: p.id, pot: 0, total: p.ohms }); els.push({ k: 'R', a: b, b: c, part: p.id, pot: 1, total: p.ohms }); }
      else if (p.type === 'button') els.push({ k: 'S', a, b, part: p.id, when: 'press' });
      else if (p.type === 'switch') {
        if (legs.length === 3) { els.push({ k: 'S', a: b, b: a, part: p.id, when: 'on' }); els.push({ k: 'S', a: b, b: c, part: p.id, when: 'off' }); }
        else els.push({ k: 'S', a, b, part: p.id, when: 'on' });
      }
    }
    if (spec.motor) els.push({ k: 'R', a: P('M+'), b: P('M-'), part: 'MOTOR', r: MOTOR_R });
    if (spec.battery) { const B = BATTERIES[spec.battery]; els.push({ k: 'V', a: P('BAT+'), b: P('BAT-'), v: B.v, r: B.r, src: 'BAT', part: 'BAT' }); }
    if (spec.arduino) {
      els.push({ k: 'V', a: P('5V'), b: P('GND'), v: 5, r: R_5V, src: '5V', part: 'UNO' });
      els.push({ k: 'V', a: P('3V3'), b: P('GND'), v: 3.3, r: R_3V3, src: '3V3', part: 'UNO' });
    }
    const wires = build.wires.map((w) => { const a = P(nodeOf(w.from)), b = P(nodeOf(w.to)); note(a); note(b); return { a, b }; });
    const n = names.length;
    const uf = new Int32Array(n);
    for (let i = 0; i < n; i++) uf[i] = i;
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    wires.forEach((w) => { const ra = find(w.a), rb = find(w.b); if (ra !== rb) uf[ra] = rb; });
    for (let i = 0; i < n; i++) uf[i] = find(i);
    let program = null, codeError = null;
    if (spec.arduino && build.code && build.code.trim()) {
      try { program = compile(build.code); } catch (e) { if (e instanceof SketchError) codeError = e; else throw e; }
    }
    return {
      spec, build, names, pts, nodeOf, attach, els, parts, uf, n, program, codeError,
      gnd: spec.arduino ? pts.get('GND') : spec.battery ? pts.get('BAT-') : 0,
      pinNode: spec.arduino ? PINS.map((x) => pts.get(x)) : null
    };
  }

  function gauss(A, rhs, n) {
    for (let col = 0; col < n; col++) {
      let piv = col, best = Math.abs(A[col * n + col]);
      for (let r = col + 1; r < n; r++) { const v = Math.abs(A[r * n + col]); if (v > best) { best = v; piv = r; } }
      if (best < 1e-30) return null;
      if (piv !== col) {
        for (let k = col; k < n; k++) { const t = A[col * n + k]; A[col * n + k] = A[piv * n + k]; A[piv * n + k] = t; }
        const t = rhs[col]; rhs[col] = rhs[piv]; rhs[piv] = t;
      }
      const d = A[col * n + col];
      for (let r = col + 1; r < n; r++) {
        const f = A[r * n + col] / d;
        if (!f) continue;
        for (let k = col; k < n; k++) A[r * n + k] -= f * A[col * n + k];
        rhs[r] -= f * rhs[col];
      }
    }
    const x = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = rhs[r];
      for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
      x[r] = s / A[r * n + r];
    }
    return x;
  }

  const ldrOhms = (light) => Math.pow(10, 5.3 - 2.3 * clamp(light, 0, 1)); // 200 kΩ in the dark, 1 kΩ in bright light
  const GMIN = 1e-9;

  // One DC solution for an exact state: st = { press, on, knob, light (by id), pins: [{ mode, level }], open, flip, burnt (Sets) }
  function solveOnce(B, st) {
    const uf = Int32Array.from(B.uf);
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf[ra] = rb; };
    const gone = (id) => (st.open && st.open.has(id)) || (st.burnt && st.burnt.has(id));
    for (const e of B.els) {
      if (e.k !== 'S' || gone(e.part)) continue;
      const shut = e.when === 'press' ? Boolean(st.press[e.part]) : e.when === 'on' ? Boolean(st.on[e.part]) : !st.on[e.part];
      if (shut) join(e.a, e.b);
    }
    const live = [];
    for (const e of B.els) {
      if (e.k === 'S' || gone(e.part)) continue;
      if (e.k === 'R') {
        let r = e.r;
        if (e.ldr) r = ldrOhms(own(st.light, e.part) ? st.light[e.part] : 0.5);
        else if (e.pot != null) { const k = own(st.knob, e.part) ? st.knob[e.part] : 0.5; r = Math.max(1, (e.pot === 0 ? k : 1 - k) * e.total); }
        live.push({ k: 'R', a: e.a, b: e.b, r, part: e.part, motor: e.part === 'MOTOR' });
      } else if (e.k === 'D') {
        const f = st.flip && st.flip.has(e.part);
        live.push({ k: 'D', a: f ? e.b : e.a, b: f ? e.a : e.b, vf: e.vf, rs: e.rs, part: e.part });
      } else live.push(e);
    }
    if (B.spec.arduino && st.pins) {
      for (let p = 0; p < 20; p++) {
        const ps = st.pins[p];
        if (ps.mode === OUTPUT) live.push({ k: 'V', a: B.pinNode[p], b: B.gnd, v: ps.level ? 5 : 0, r: R_PIN, src: 'pin', pin: p });
        else if (ps.mode === PULLUP) live.push({ k: 'V', a: B.pinNode[p], b: B.gnd, v: 5, r: R_PULLUP, src: 'pullup', pin: p });
      }
    }
    // the nets: every node a live element touches (and every terminal), measured from the reference
    const netOf = new Int32Array(B.n).fill(-1);
    const ref = find(B.gnd || 0);
    let m = 0;
    const roots = new Map();
    const idx = (node) => {
      const r = find(node);
      if (r === ref) return -1;
      let i = roots.get(r);
      if (i === undefined) { i = m++; roots.set(r, i); }
      return i;
    };
    const L = live.map((e) => ({ e, a: idx(e.a), b: idx(e.b) }));
    for (let i = 0; i < B.n; i++) { const r = find(i); netOf[i] = r === ref ? -2 : roots.has(r) ? roots.get(r) : -1; }
    const diodes = L.filter((x) => x.e.k === 'D');
    const on = new Array(diodes.length).fill(false);
    let V = null;
    const solveWith = () => {
      const A = new Float64Array(m * m), rhs = new Float64Array(m);
      for (let i = 0; i < m; i++) A[i * m + i] += GMIN;
      const stamp = (a, b, g, j) => { // current a -> b = g (Va - Vb) - j
        if (a >= 0) { A[a * m + a] += g; rhs[a] += j; if (b >= 0) A[a * m + b] -= g; }
        if (b >= 0) { A[b * m + b] += g; rhs[b] -= j; if (a >= 0) A[b * m + a] -= g; }
      };
      let di = 0;
      for (const x of L) {
        const e = x.e;
        if (e.k === 'R') stamp(x.a, x.b, 1 / e.r, 0);
        else if (e.k === 'V') stamp(x.a, x.b, 1 / e.r, e.v / e.r);
        else if (e.k === 'D') { if (on[di]) stamp(x.a, x.b, 1 / e.rs, e.vf / e.rs); else stamp(x.a, x.b, GMIN, 0); di++; }
      }
      return m ? gauss(A, rhs, m) : new Float64Array(0);
    };
    const vAt = (i) => (i >= 0 ? V[i] : 0);
    let settled = false;
    for (let it = 0; it < 60 && !settled; it++) {
      V = solveWith();
      if (!V) break;
      settled = true;
      let worst = -1, wv = 0;
      diodes.forEach((x, i) => {
        const vd = vAt(x.a) - vAt(x.b);
        const bad = on[i] ? x.e.vf - vd : vd - x.e.vf;
        if (bad > 1e-9) { settled = false; if (it < 30) on[i] = !on[i]; else if (bad > wv) { wv = bad; worst = i; } }
      });
      if (worst >= 0) on[worst] = !on[worst];
    }
    if (!V) V = new Float64Array(m);
    const I = new Map(), src = {}, pinI = new Float64Array(20);
    let di = 0;
    for (const x of L) {
      const e = x.e, dv = vAt(x.a) - vAt(x.b);
      if (e.k === 'R') { if (e.pot == null) I.set(e.part, dv / e.r); else I.set(e.part + '#' + e.pot, dv / e.r); }
      else if (e.k === 'D') { I.set(e.part, on[di] ? (dv - e.vf) / e.rs : 0); di++; }
      else if (e.k === 'V') {
        const out = (e.v - dv) / e.r; // the current it gives out of its + end
        if (e.src === 'pin' || e.src === 'pullup') pinI[e.pin] += out;
        else src[e.src] = (src[e.src] || 0) + out;
      }
    }
    return { V, netOf, I, src, pinI };
  }

  // The circuit in a state, with PWM pins averaged by their duty: what the page draws and the checks read.
  function view(B, st) {
    const pwm = [];
    if (B.spec.arduino && st.pins) st.pins.forEach((ps, p) => { if (ps.mode === OUTPUT && ps.duty != null && ps.duty > 0 && ps.duty < 1) pwm.push(p); });
    const combos = [];
    const k = Math.min(pwm.length, 6);
    for (let mask = 0; mask < (1 << k); mask++) {
      let w = 1;
      const pins = st.pins ? st.pins.map((ps) => ({ mode: ps.mode, level: ps.duty != null ? (ps.duty >= 0.5 ? 1 : 0) : ps.level })) : null;
      pwm.forEach((p, i) => {
        if (i >= k) return;
        const hi = (mask >> i) & 1;
        pins[p].level = hi;
        w *= hi ? st.pins[p].duty : 1 - st.pins[p].duty;
      });
      if (w > 0) combos.push({ w, r: solveOnce(B, Object.assign({}, st, { pins })) });
    }
    const out = { short: false, shortWhy: '', parts: {}, pinI: new Float64Array(20), pinPeak: new Float64Array(20), overload: [], src: {} };
    const ids = [...B.parts.keys()].concat(B.spec.motor ? ['MOTOR'] : []);
    for (const id of ids) {
      const p = B.parts.get(id) || { type: 'motor' };
      let I = 0, peak = 0, signed = 0;
      combos.forEach((c) => { const i = c.r.I.get(id) || 0; I += c.w * Math.abs(i); signed += c.w * i; peak = Math.max(peak, Math.abs(i)); });
      const o = { I, peak };
      if (p.type === 'led') {
        o.burn = I > BURN || peak > 2 * BURN;
        o.lit = !o.burn && I >= LIT;
        o.glow = o.burn ? 0 : round(Math.min(1, Math.pow(I / FULL, 0.55)), 3);
      } else if (p.type === 'buzzer') o.on = I >= 0.003;
      else if (p.type === 'motor') { o.on = Math.abs(signed) >= 0.03; o.speed = round(clamp(signed / 0.25, -1, 1), 3); }
      else if (p.type === 'pot') { o.I0 = 0; o.I1 = 0; combos.forEach((c) => { o.I0 += c.w * (c.r.I.get(id + '#0') || 0); o.I1 += c.w * (c.r.I.get(id + '#1') || 0); }); }
      out.parts[id] = o;
    }
    for (const c of combos) {
      for (const s of Object.keys(c.r.src)) out.src[s] = (out.src[s] || 0) + c.w * c.r.src[s];
      for (let p = 0; p < 20; p++) { out.pinI[p] += c.w * c.r.pinI[p]; out.pinPeak[p] = Math.max(out.pinPeak[p], Math.abs(c.r.pinI[p])); }
    }
    const maxSrc = (s) => Math.max.apply(null, combos.map((c) => Math.abs(c.r.src[s] || 0)));
    if (B.spec.battery && maxSrc('BAT') > 1.5) { out.short = true; out.shortWhy = 'the battery\'s + and - are joined with almost nothing between them'; out.shortSrc = 'BAT'; }
    else if (B.spec.arduino && maxSrc('5V') > 0.5) { out.short = true; out.shortWhy = 'the Arduino\'s 5V is joined to GND with almost nothing between them'; out.shortSrc = '5V'; }
    else if (B.spec.arduino && maxSrc('3V3') > 0.3) { out.short = true; out.shortWhy = 'the Arduino\'s 3.3V is joined to GND with almost nothing between them'; out.shortSrc = '3V3'; }
    if (st.pins) for (let p = 0; p < 20; p++) if (st.pins[p].mode === OUTPUT && out.pinPeak[p] > 0.04) out.overload.push(p);
    // the voltage at a hole or terminal (null: nothing there)
    out.volt = (point) => {
      const node = B.pts.get(B.nodeOf(point));
      if (node === undefined) return null;
      let v = 0, any = false;
      for (const c of combos) { const ni = c.r.netOf[node]; if (ni === -1) continue; any = true; v += c.w * (ni === -2 ? 0 : c.r.V[ni]); }
      return any ? v : null;
    };
    out.state = st;
    return out;
  }

  /* ---------------- the sketch: an Arduino C subset ---------------- */

  class SketchError extends Error {
    constructor(code, vals) {
      const v = vals || {};
      super(SKETCH_MSG[code] ? SKETCH_MSG[code].replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : code);
      this.code = code;
      this.vals = v;
      this.line = v.line || 0;
    }
  }
  const SKETCH_MSG = {
    semi: 'Line {line}: put a ; at the end of this line.',
    expect: 'Line {line}: "{want}" is missing before "{got}".',
    unexpected: 'Line {line}: "{got}" doesn\'t belong here.',
    eof: 'The code ends too soon: something opened with ( or { is never closed.',
    brace: 'Line {line}: this { is never closed with a }.',
    nested: 'Line {line}: {name}() starts inside another function: a } is missing above it.',
    paren: 'Line {line}: this ( is never closed with a ).',
    unknown: 'Line {line}: {name} isn\'t known. Declare it first, like int {name} = 0;',
    suggest: 'Line {line}: {name} isn\'t known. Did you mean {better}?',
    nofn: 'Line {line}: there is no function called {name}.',
    args: 'Line {line}: {name} needs {n} values in its ( ), not {got}.',
    argsRange: 'Line {line}: {name} needs {min} to {max} values in its ( ), not {got}.',
    constant: 'Line {line}: {name} is const, so it can\'t be changed.',
    twice: 'Line {line}: {name} is declared twice.',
    nosetup: 'There is no setup() function. Every sketch needs void setup() { } and void loop() { }.',
    noloop: 'There is no loop() function. Every sketch needs void setup() { } and void loop() { }.',
    string: 'Line {line}: String and text variables aren\'t supported here. Print words directly, like Serial.print("Hello");',
    concat: 'Line {line}: "text" + a number doesn\'t join them in Arduino C. Use two prints: Serial.print("text"); Serial.println(x);',
    unsupported: 'Line {line}: {what} isn\'t supported here.',
    macro: 'Line {line}: #define with ( ) isn\'t supported here; write a function instead.',
    number: 'Line {line}: "{got}" isn\'t a number I can read.',
    text: 'Line {line}: a "text" is not closed with ".',
    quote: 'Line {line}: {got} is a curly quote; use a straight quote " instead.',
    char: 'Line {line}: "{got}" can\'t be used in code.',
    novalue: 'Line {line}: {name} gives back nothing (void), so it has no value to use.',
    lvalue: 'Line {line}: the left side of {op} must be a variable.',
    notarray: 'Line {line}: {name} is not an array, so it can\'t have [ ].',
    isarray: 'Line {line}: {name} is an array: use {name}[0], {name}[1] and so on.',
    arraysize: 'Line {line}: the array {name} needs a size, like {name}[5], or its values in { }.',
    loopout: 'Line {line}: {what} only works inside a loop.',
    returnvoid: 'Line {line}: {name} is void, so return can\'t give back a value.',
    notype: 'Line {line}: put a type before {name}, like void {name}() or int {name}.',
    name: 'Line {line}: a name is missing after the type.',
    pinmode: 'Line {line}: pinMode needs INPUT, OUTPUT or INPUT_PULLUP.',
    index: 'Line {line}: {name}[{i}] is outside the array (it has {n} items, {name}[0] to {name}[{last}]).',
    div0: 'Line {line}: division by zero.',
    pin: 'Line {line}: the Arduino Uno has no pin {pin} (it has 0 to 13 and A0 to A5).',
    apin: 'Line {line}: analogRead needs an analog pin, A0 to A5.',
    deep: 'Line {line}: {name} calls itself too many times.',
    toolong: 'The code is too long (at most {n} characters).',
    crash: 'The sketch stopped: {msg}'
  };

  const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'true', 'false', 'const', 'static', 'volatile', 'sizeof', 'struct', 'class', 'enum', 'typedef', 'goto', 'new', 'delete', 'union', 'extern', 'register', 'inline', 'template', 'namespace', 'using']);
  const TYPE_WORDS = new Set(['void', 'int', 'long', 'short', 'float', 'double', 'bool', 'boolean', 'byte', 'char', 'word', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'size_t', 'unsigned', 'signed', 'String']);
  const OPS3 = ['<<=', '>>='];
  const OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', '::'];
  const OPS1 = '+-*/%=<>!&|^~?:;,.()[]{}';

  function lex(src) {
    if (src.length > 8000) throw new SketchError('toolong', { n: 8000 });
    const toks = [];
    const defines = new Map();
    let line = 1;
    function scan(text, startLine, out, top) {
      let i = 0, ln = startLine, lineStart = true;
      const n = text.length;
      const err = (code, vals) => { throw new SketchError(code, Object.assign({ line: ln }, vals)); };
      while (i < n) {
        const c = text[i];
        if (c === '\n') { ln++; i++; lineStart = true; continue; }
        if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
        if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
        if (c === '/' && text[i + 1] === '*') {
          const end = text.indexOf('*/', i + 2);
          const stop = end < 0 ? n : end + 2;
          for (let k = i; k < stop; k++) if (text[k] === '\n') ln++;
          i = stop;
          continue;
        }
        if (c === '#' && lineStart && top) {
          let eol = text.indexOf('\n', i);
          if (eol < 0) eol = n;
          const body = text.slice(i + 1, eol).replace(/\/\/.*$/, '');
          const m = /^\s*(\w+)\s*([\s\S]*)$/.exec(body);
          const what = m ? m[1] : '';
          if (what === 'define') {
            const d = /^([A-Za-z_]\w*)(\(?)([\s\S]*)$/.exec(m[2]);
            if (!d) err('unexpected', { got: '#define' });
            if (d[2]) err('macro');
            const sub = [];
            scan(d[3], ln, sub, false);
            defines.set(d[1], sub);
          } else if (what === 'undef') defines.delete(m[2].trim());
          else if (what !== 'include' && what !== 'pragma') err('unsupported', { what: '#' + what });
          i = eol;
          continue;
        }
        lineStart = false;
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
          const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)([uUlLfF]*)/.exec(text.slice(i, i + 40));
          const body = m[1], suf = m[2];
          const next = text[i + m[0].length] || '';
          if (/[A-Za-z0-9_.]/.test(next)) err('number', { got: text.slice(i, i + m[0].length + 1) });
          let v, f = false;
          if (/^0[xX]/.test(body)) v = parseInt(body.slice(2), 16);
          else if (/^0[bB]/.test(body)) v = parseInt(body.slice(2), 2);
          else { v = Number(body); f = /[.eE]/.test(body) || /f/i.test(suf); }
          out.push({ t: 'num', v, f, line: ln });
          i += m[0].length;
          continue;
        }
        if (/[A-Za-z_]/.test(c)) {
          const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 64));
          const w = m[0];
          i += w.length;
          if (/^B[01]{1,8}$/.test(w)) { out.push({ t: 'num', v: parseInt(w.slice(1), 2), f: false, line: ln }); continue; }
          out.push({ t: 'id', v: w, line: ln });
          continue;
        }
        if (c === '"') {
          let s = '', k = i + 1;
          for (;;) {
            const ch = text[k];
            if (ch === undefined || ch === '\n') err('text');
            if (ch === '"') break;
            if (ch === '\\') { const e = text[k + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === '0' ? '' : e; k += 2; continue; }
            s += ch;
            k++;
          }
          out.push({ t: 'str', v: s, line: ln });
          i = k + 1;
          continue;
        }
        if (c === '\'') {
          let v, k = i + 1;
          if (text[k] === '\\') { const e = text[k + 1]; v = (e === 'n' ? 10 : e === 't' ? 9 : e === 'r' ? 13 : e === '0' ? 0 : e.charCodeAt(0)); k += 2; }
          else { v = (text[k] || '').charCodeAt(0); k += 1; }
          if (text[k] !== '\'') err('char', { got: text.slice(i, i + 3) });
          out.push({ t: 'num', v, f: false, c: true, line: ln });
          i = k + 1;
          continue;
        }
        if (c === '“' || c === '”' || c === '‘' || c === '’') err('quote', { got: c });
        const three = text.substr(i, 3), two = text.substr(i, 2);
        if (OPS3.includes(three)) { out.push({ t: 'op', v: three, line: ln }); i += 3; continue; }
        if (OPS2.includes(two)) { out.push({ t: 'op', v: two, line: ln }); i += 2; continue; }
        if (OPS1.includes(c)) { out.push({ t: 'op', v: c, line: ln }); i += 1; continue; }
        err('char', { got: c });
      }
      return ln;
    }
    const raw = [];
    line = scan(src, 1, raw, true);
    // #define names replaced by what they stand for
    const expand = (tok, depth, seen) => {
      if (tok.t === 'id' && defines.has(tok.v) && !seen.has(tok.v) && depth < 10) {
        const s2 = new Set(seen); s2.add(tok.v);
        defines.get(tok.v).forEach((d) => expand(Object.assign({}, d, { line: tok.line }), depth + 1, s2));
      } else toks.push(tok);
    };
    raw.forEach((t) => expand(t, 0, new Set()));
    toks.end = line;
    return toks;
  }

  // types: k is i (whole number), f (float), b (bool), c (char), v (void)
  function typeFrom(base, longs, uns, line) {
    if (base === 'String') throw new SketchError('string', { line });
    if (base === 'void') return { name: 'void', k: 'v', size: 0 };
    if (base === 'float' || base === 'double') return { name: 'float', k: 'f', size: 4 };
    if (base === 'bool' || base === 'boolean') return { name: 'bool', k: 'b', size: 1 };
    if (base === 'char') return uns ? { name: 'byte', k: 'i', bits: 8, uns: true, size: 1 } : { name: 'char', k: 'c', bits: 8, uns: false, size: 1 };
    if (base === 'byte' || base === 'uint8_t') return { name: 'byte', k: 'i', bits: 8, uns: true, size: 1 };
    if (base === 'int8_t') return { name: 'int8_t', k: 'i', bits: 8, uns: false, size: 1 };
    if (base === 'word' || base === 'uint16_t') return { name: 'word', k: 'i', bits: 16, uns: true, size: 2 };
    if (base === 'int16_t') return { name: 'int', k: 'i', bits: 16, uns: false, size: 2 };
    if (base === 'uint32_t' || base === 'size_t') return { name: 'unsigned long', k: 'i', bits: 32, uns: true, size: 4 };
    if (base === 'int32_t') return { name: 'long', k: 'i', bits: 32, uns: false, size: 4 };
    if (longs > 0) return { name: uns ? 'unsigned long' : 'long', k: 'i', bits: 32, uns: Boolean(uns), size: 4 };
    return { name: uns ? 'unsigned int' : 'int', k: 'i', bits: 16, uns: Boolean(uns), size: 2 };
  }
  const toInt = (v) => (Number.isFinite(v) ? Math.trunc(v) : 0);
  function convOf(type) {
    if (type.k === 'f') return Math.fround;
    if (type.k === 'b') return (v) => (v ? 1 : 0);
    if (type.k === 'v') return () => 0;
    if (type.bits === 32) return type.uns ? (v) => (toInt(v) >>> 0) : (v) => (toInt(v) | 0);
    const mod = Math.pow(2, type.bits), half = mod / 2;
    return type.uns ? (v) => { const x = toInt(v) % mod; return x < 0 ? x + mod : x; }
      : (v) => { let x = toInt(v) % mod; if (x < 0) x += mod; return x >= half ? x - mod : x; };
  }

  function parse(toks) {
    let p = 0;
    const EOF = { t: 'eof', v: 'the end', line: toks.end || 1 };
    const peek = (k) => toks[p + (k || 0)] || EOF;
    const next = () => toks[p++] || EOF;
    const is = (v, k) => { const t = peek(k); return t.t !== 'str' && t.t !== 'num' && t.v === v; };
    const accept = (v) => { if (is(v)) { p++; return true; } return false; };
    const got = (t) => (t.t === 'eof' ? 'the end' : t.t === 'str' ? '"' + t.v.slice(0, 12) + '"' : String(t.t === 'num' && t.c ? '\'' + String.fromCharCode(t.v) + '\'' : t.v).slice(0, 16));
    const err = (code, vals, t) => { throw new SketchError(code, Object.assign({ line: (t || peek()).line }, vals)); };
    function expect(v, opened) {
      if (accept(v)) return;
      const t = peek();
      if (t.t === 'eof') err(opened ? (opened.v === '{' ? 'brace' : 'paren') : 'eof', {}, opened || t);
      if (v === ';') { const prev = toks[p - 1]; err('semi', {}, prev || t); }
      err('expect', { want: v, got: got(t) }, t);
    }
    const isTypeStart = (k) => { const t = peek(k); return t.t === 'id' && (TYPE_WORDS.has(t.v) || t.v === 'const' || t.v === 'static' || t.v === 'volatile'); };
    function parseType() {
      let isConst = false, isStatic = false, uns = null, base = null, longs = 0;
      const line = peek().line;
      for (;;) {
        const t = peek();
        if (t.t !== 'id') break;
        if (t.v === 'const') { isConst = true; p++; continue; }
        if (t.v === 'static') { isStatic = true; p++; continue; }
        if (t.v === 'volatile') { p++; continue; }
        if (t.v === 'unsigned') { uns = true; p++; continue; }
        if (t.v === 'signed') { uns = false; p++; continue; }
        if (t.v === 'long') { longs++; p++; continue; }
        if (t.v === 'short') { base = base || 'int'; p++; continue; }
        if (TYPE_WORDS.has(t.v) && !base) { base = t.v; p++; continue; }
        break;
      }
      if (!base && !longs && uns == null) err('unexpected', { got: got(peek()) });
      return { type: typeFrom(base || 'int', longs, uns, line), isConst, isStatic, line };
    }
    function nameAfterType() {
      const t = peek();
      if (t.t !== 'id' || KEYWORDS.has(t.v) || TYPE_WORDS.has(t.v)) { if (t.t === 'op' && t.v === '*') err('unsupported', { what: 'pointers (*)' }); err('name', {}, t); }
      p++;
      return t;
    }
    // name [size]? (= init)? , ...
    function declarators(ty) {
      const list = [];
      do {
        const nt = nameAfterType();
        const d = { k: 'decl', name: nt.v, type: ty.type, isConst: ty.isConst, isStatic: ty.isStatic, line: nt.line, arr: null, init: null };
        if (accept('[')) {
          d.arr = { size: is(']') ? null : expr() };
          expect(']');
          if (is('[')) err('unsupported', { what: 'arrays with two [ ] [ ]' });
        }
        if (accept('=')) {
          if (d.arr) {
            if (peek().t === 'str') err('string', {});
            const open = peek();
            expect('{');
            d.init = [];
            if (!is('}')) { do { if (is('}')) break; d.init.push(expr()); } while (accept(',')); }
            expect('}', open);
          } else {
            if (is('{')) err('unsupported', { what: '{ } here' });
            d.init = expr();
          }
        }
        if (d.arr && d.arr.size == null && !d.init) err('arraysize', { name: d.name }, nt);
        list.push(d);
      } while (accept(','));
      return list;
    }
    const prog = { globals: [], funcs: [] };
    function topLevel() {
      const t = peek();
      if (t.t === 'id' && ['struct', 'class', 'enum', 'typedef', 'template', 'namespace', 'using', 'union'].includes(t.v)) err('unsupported', { what: t.v });
      if (!isTypeStart()) {
        if (t.t === 'id' && is('(', 1)) err('notype', { name: t.v });
        if (t.t === 'op' && t.v === ';') { p++; return; }
        err('unexpected', { got: got(t) });
      }
      const ty = parseType();
      if (ty.type.k === 'v' && !is('(', 1) && peek().t === 'id' && !is('(', 1)) { /* void x; is odd, but caught below */ }
      const nt = nameAfterType();
      if (is('(')) {
        const open = next();
        const params = [];
        if (is('void') && is(')', 1)) p++;
        if (!is(')')) {
          do {
            if (!isTypeStart()) err('unexpected', { got: got(peek()) });
            const pt = parseType();
            if (accept('&')) err('unsupported', { what: 'references (&)' });
            const pn = nameAfterType();
            let arr = false;
            if (accept('[')) { if (!is(']')) expr(); expect(']'); arr = true; }
            params.push({ name: pn.v, type: pt.type, arr, line: pn.line });
          } while (accept(','));
        }
        expect(')', open);
        if (accept(';')) { prog.funcs.push({ name: nt.v, ret: ty.type, params, body: null, line: nt.line }); return; }
        const body = block();
        prog.funcs.push({ name: nt.v, ret: ty.type, params, body, line: nt.line });
        return;
      }
      p--; // back to the name
      declarators(ty).forEach((d) => prog.globals.push(d));
      expect(';');
    }
    function block() {
      const open = peek();
      expect('{');
      const list = [];
      while (!is('}')) {
        if (peek().t === 'eof') err('brace', {}, open);
        list.push(statement());
      }
      p++;
      return { k: 'block', list, line: open.line };
    }
    function statement() {
      const t = peek();
      if (t.t === 'op' && t.v === '{') return block();
      if (t.t === 'op' && t.v === ';') { p++; return { k: 'empty', line: t.line }; }
      if (t.t === 'id') {
        switch (t.v) {
          case 'if': {
            p++; const open = peek(); expect('('); const c = expr(); expect(')', open);
            const a = statement();
            const b = accept('else') ? statement() : null;
            return { k: 'if', c, a, b, line: t.line };
          }
          case 'while': { p++; const open = peek(); expect('('); const c = expr(); expect(')', open); return { k: 'while', c, body: statement(), line: t.line }; }
          case 'do': {
            p++; const body = statement();
            if (!accept('while')) err('expect', { want: 'while', got: got(peek()) });
            const open = peek(); expect('('); const c = expr(); expect(')', open); expect(';');
            return { k: 'do', c, body, line: t.line };
          }
          case 'for': {
            p++; const open = peek(); expect('(');
            let init = null;
            if (isTypeStart()) { const ty = parseType(); init = { k: 'decls', list: declarators(ty), line: t.line }; }
            else if (!is(';')) init = { k: 'expr', e: expr(), line: t.line };
            expect(';');
            const c = is(';') ? null : expr();
            expect(';');
            const upd = [];
            if (!is(')')) { do { upd.push(expr()); } while (accept(',')); }
            expect(')', open);
            return { k: 'for', init, c, upd, body: statement(), line: t.line };
          }
          case 'switch': {
            p++; const open = peek(); expect('('); const e = expr(); expect(')', open);
            const bo = peek(); expect('{');
            const items = [], cases = [];
            let dflt = -1;
            while (!is('}')) {
              if (peek().t === 'eof') err('brace', {}, bo);
              if (accept('case')) { const v = expr(); expect(':'); cases.push({ v, at: items.length }); continue; }
              if (accept('default')) { expect(':'); dflt = items.length; continue; }
              items.push(statement());
            }
            p++;
            return { k: 'switch', e, items, cases, dflt, line: t.line };
          }
          case 'break': p++; expect(';'); return { k: 'break', line: t.line };
          case 'continue': p++; expect(';'); return { k: 'continue', line: t.line };
          case 'return': { p++; const e = is(';') ? null : expr(); expect(';'); return { k: 'return', e, line: t.line }; }
          case 'else': err('unexpected', { got: 'else' });
          case 'case': case 'default': err('unexpected', { got: t.v });
          case 'goto': err('unsupported', { what: 'goto' });
          default:
            if (isTypeStart() && !is('(', 1)) {
              const ty = parseType();
              // "void loop() {" inside another function: a } is missing above it
              if (peek().t === 'id' && is('(', 1)) err('nested', { name: peek().v });
              const list = declarators(ty); expect(';'); return { k: 'decls', list, line: t.line };
            }
        }
      }
      const e = expr();
      expect(';');
      return { k: 'expr', e, line: t.line };
    }
    const BIN = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
    function expr() {
      const lhs = ternary();
      const t = peek();
      if (t.t === 'op' && ASSIGN.has(t.v)) { p++; return { k: 'asg', op: t.v, target: lhs, value: expr(), line: t.line }; }
      return lhs;
    }
    function ternary() {
      const c = binary(1);
      if (is('?')) { const t = next(); const a = expr(); expect(':'); const b = ternary(); return { k: 'cond', c, a, b, line: t.line }; }
      return c;
    }
    function binary(min) {
      let left = unary();
      for (;;) {
        const t = peek();
        const pr = t.t === 'op' ? BIN[t.v] : undefined;
        if (!pr || pr < min) break;
        p++;
        left = { k: 'bin', op: t.v, a: left, b: binary(pr + 1), line: t.line };
      }
      return left;
    }
    function unary() {
      const t = peek();
      if (t.t === 'op') {
        if (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~') { p++; return { k: 'un', op: t.v, a: unary(), line: t.line }; }
        if (t.v === '++' || t.v === '--') { p++; return { k: 'inc', op: t.v, prefix: true, target: unary(), line: t.line }; }
        if (t.v === '(' && isTypeStart(1) && !is('(', 2)) { p++; const ty = parseType(); expect(')'); return { k: 'cast', type: ty.type, a: unary(), line: t.line }; }
        if (t.v === '&' || t.v === '*') err('unsupported', { what: 'pointers (& and *)' });
      }
      if (t.t === 'id' && t.v === 'sizeof') {
        p++;
        const open = peek(); expect('(');
        let node;
        if (isTypeStart()) node = { k: 'sizeof', type: parseType().type, line: t.line };
        else node = { k: 'sizeof', a: expr(), line: t.line };
        expect(')', open);
        return node;
      }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        const t = peek();
        if (t.t !== 'op') break;
        if (t.v === '(') {
          p++;
          const args = [];
          if (!is(')')) { do { args.push(expr()); } while (accept(',')); }
          expect(')', t);
          if (e.k !== 'id' && e.k !== 'member') err('unexpected', { got: '(' }, t);
          e = { k: 'call', name: e.k === 'id' ? e.name : e.obj + '.' + e.name, args, line: e.line };
          continue;
        }
        if (t.v === '[') { p++; const idx = expr(); expect(']'); e = { k: 'index', a: e, idx, line: t.line }; continue; }
        if (t.v === '++' || t.v === '--') { p++; e = { k: 'inc', op: t.v, prefix: false, target: e, line: t.line }; continue; }
        if (t.v === '.') {
          p++;
          const nm = next();
          if (nm.t !== 'id' || e.k !== 'id') err('unsupported', { what: '.' }, t);
          e = { k: 'member', obj: e.name, name: nm.v, line: e.line };
          continue;
        }
        if (t.v === '->' || t.v === '::') err('unsupported', { what: t.v });
        break;
      }
      return e;
    }
    function primary() {
      const t = next();
      if (t.t === 'num') return { k: 'num', v: t.v, ty: t.f ? 'f' : t.c ? 'c' : 'i', line: t.line };
      if (t.t === 'str') { let s = t.v; while (peek().t === 'str') s += next().v; return { k: 'str', v: s, line: t.line }; }
      if (t.t === 'id') {
        if (t.v === 'true' || t.v === 'false') return { k: 'num', v: t.v === 'true' ? 1 : 0, ty: 'b', line: t.line };
        if (t.v === 'String') err('string', {}, t);
        if (TYPE_WORDS.has(t.v) && is('(')) return { k: 'id', name: t.v, line: t.line };
        if (KEYWORDS.has(t.v) || TYPE_WORDS.has(t.v)) err('unexpected', { got: t.v }, t);
        return { k: 'id', name: t.v, line: t.line };
      }
      if (t.t === 'op' && t.v === '(') { const e = expr(); expect(')', t); return e; }
      if (t.t === 'eof') err('eof', {}, t);
      err('unexpected', { got: got(t) }, t);
    }
    while (peek().t !== 'eof') topLevel();
    return prog;
  }

  // how long things take on the board, in simulated microseconds
  const COST = { stmt: 1, call: 2, loop: 20, digital: 5, analog: 112, pwm: 10, serial: 30 };
  const BRK = 1, CNT = 2, RET = 3;
  const CONSTS = { HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, LED_BUILTIN: 13, A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEC: 10, HEX: 16, OCT: 8, BIN: 2, CHANGE: 1, RISING: 3, FALLING: 2 };
  const T_INT = typeFrom('int', 0, false), T_LONG = typeFrom('long', 1, false);

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 9;
    const d = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[b.length];
  }

  // A sketch, compiled: { main(vm) generator }; throws SketchError with a line number and plain words.
  function compile(src) {
    const ast = parse(lex(src));
    const P = (t, f) => ({ t, g: false, f });
    const G = (t, f) => ({ t, g: true, f });
    const lift = (e) => (e.g ? e.f : function* (vm) { return e.f(vm); });
    const err = (code, vals, line) => { throw new SketchError(code, Object.assign({ line }, vals)); };

    const globals = new Map();   // name -> var
    let gsize = 0;
    const funcs = new Map();
    for (const f of ast.funcs) {
      const old = funcs.get(f.name);
      if (old && old.body && f.body) err('twice', { name: f.name + '()' }, f.line);
      if (!old || f.body) funcs.set(f.name, { name: f.name, ret: f.ret, params: f.params, ast: f.body, line: f.line, body: null, size: 0 });
    }
    // scopes for the function being compiled
    let scopes = [], fn = null, loops = 0, switches = 0;
    const lookup = (name) => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name); return globals.get(name) || null; };
    function declare(d, where) {
      const scope = where === 'g' ? globals : scopes[scopes.length - 1];
      if (scope.has(d.name)) err('twice', { name: d.name }, d.line);
      if (BUILTINS[d.name] || funcs.has(d.name)) err('twice', { name: d.name }, d.line);
      const v = { name: d.name, type: d.type, isConst: d.isConst, arr: Boolean(d.arr), where, slot: where === 'g' ? gsize++ : fn.size++, conv: convOf(d.type) };
      scope.set(d.name, v);
      return v;
    }
    function unknown(name, line) {
      const known = [...Object.keys(BUILTINS), ...Object.keys(CONSTS), ...funcs.keys(), ...globals.keys(), 'Serial'];
      scopes.forEach((s) => s.forEach((_, k) => known.push(k)));
      let best = null, bd = 3;
      for (const k of known) { const d = k.toLowerCase() === name.toLowerCase() ? 0 : lev(name, k); if (d < bd) { bd = d; best = k; } }
      if (best && best !== name) err('suggest', { name, better: best }, line);
      err('unknown', { name }, line);
    }
    const numT = (a, b) => (a === 'f' || b === 'f' ? 'f' : 'i');

    // a place to store: { t, conv, ref(vm) -> container (key in vm.rk) }
    function ref(node, op) {
      if (node.k === 'id') {
        const v = lookup(node.name);
        if (!v) { if (CONSTS[node.name] != null) err('lvalue', { op }, node.line); unknown(node.name, node.line); }
        if (v.isConst) err('constant', { name: v.name }, node.line);
        if (v.arr) err('isarray', { name: v.name }, node.line);
        const slot = v.slot;
        return { t: v.type.k, conv: v.conv, g: false, f: v.where === 'g' ? (vm) => { vm.rk = slot; return vm.g; } : (vm) => { vm.rk = slot; return vm.frame; } };
      }
      if (node.k === 'index') {
        if (node.a.k !== 'id') err('lvalue', { op }, node.line);
        const v = lookup(node.a.name);
        if (!v) unknown(node.a.name, node.line);
        if (!v.arr) err('notarray', { name: v.name }, node.line);
        if (v.isConst) err('constant', { name: v.name }, node.line);
        const I = expr(node.idx);
        const slot = v.slot, where = v.where, line = node.line, name = v.name;
        const at = (vm, i) => {
          const a = where === 'g' ? vm.g[slot] : vm.frame[slot];
          i = toInt(i);
          if (!(i >= 0 && i < a.v.length)) throw new SketchError('index', { line, name, i, n: a.v.length, last: a.v.length - 1 });
          vm.rk = i;
          return a.v;
        };
        return I.g ? { t: v.type.k, conv: v.conv, g: true, f: function* (vm) { const i = yield* I.f(vm); return at(vm, i); } } : { t: v.type.k, conv: v.conv, g: false, f: (vm) => at(vm, I.f(vm)) };
      }
      err('lvalue', { op }, node.line);
    }
    const ARITH = {
      '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
      '<<': (a, b) => toInt(a) << toInt(b), '>>': (a, b) => toInt(a) >> toInt(b), '&': (a, b) => toInt(a) & toInt(b), '|': (a, b) => toInt(a) | toInt(b), '^': (a, b) => toInt(a) ^ toInt(b),
      '==': (a, b) => (a === b ? 1 : 0), '!=': (a, b) => (a !== b ? 1 : 0), '<': (a, b) => (a < b ? 1 : 0), '>': (a, b) => (a > b ? 1 : 0), '<=': (a, b) => (a <= b ? 1 : 0), '>=': (a, b) => (a >= b ? 1 : 0)
    };
    function opFn(op, t, line) {
      if (op === '/') return t === 'f' ? (a, b) => a / b : (a, b) => { if (b === 0) throw new SketchError('div0', { line }); return Math.trunc(a / b); };
      if (op === '%') return t === 'f' ? (a, b) => a % b : (a, b) => { if (toInt(b) === 0) throw new SketchError('div0', { line }); return toInt(a) % toInt(b); };
      return ARITH[op];
    }
    function combine(t, kids, op) {
      if (!kids.some((k) => k.g)) {
        if (kids.length === 1) { const a = kids[0].f; return P(t, (vm) => op(vm, a(vm))); }
        if (kids.length === 2) { const a = kids[0].f, b = kids[1].f; return P(t, (vm) => op(vm, a(vm), b(vm))); }
        const fs = kids.map((k) => k.f);
        return P(t, (vm) => op(vm, ...fs.map((f) => f(vm))));
      }
      const gs = kids.map(lift);
      return G(t, function* (vm) { const vals = []; for (const g of gs) vals.push(yield* g(vm)); return op(vm, ...vals); });
    }
    function value(node) { const e = expr(node); if (e.t === 'v') err('novalue', { name: node.name || 'it' }, node.line); if (e.t === 'arr') err('isarray', { name: node.name }, node.line); return e; }

    function expr(node) {
      switch (node.k) {
        case 'num': { const v = node.v, t = node.ty; return P(t, () => v); }
        case 'str': { const v = node.v; return P('s', () => v); }
        case 'id': {
          const v = lookup(node.name);
          if (v) {
            const slot = v.slot;
            if (v.arr) return P('arr', v.where === 'g' ? (vm) => vm.g[slot] : (vm) => vm.frame[slot]);
            return P(v.type.k, v.where === 'g' ? (vm) => vm.g[slot] : (vm) => vm.frame[slot]);
          }
          if (CONSTS[node.name] != null) { const c = CONSTS[node.name]; return P(Number.isInteger(c) ? 'i' : 'f', () => c); }
          if (node.name === 'Serial') err('unsupported', { what: 'Serial without .print or .begin' }, node.line);
          unknown(node.name, node.line);
          break;
        }
        case 'member': err('unsupported', { what: node.obj + '.' + node.name }, node.line); break;
        case 'call': return call(node);
        case 'index': {
          if (node.a.k !== 'id') err('unsupported', { what: '[ ] here' }, node.line);
          const v = lookup(node.a.name);
          if (!v) unknown(node.a.name, node.line);
          if (!v.arr) err('notarray', { name: v.name }, node.line);
          const slot = v.slot, where = v.where, line = node.line, name = v.name;
          return combine(v.type.k, [value(node.idx)], (vm, i) => {
            const a = where === 'g' ? vm.g[slot] : vm.frame[slot];
            i = toInt(i);
            if (!(i >= 0 && i < a.v.length)) throw new SketchError('index', { line, name, i, n: a.v.length, last: a.v.length - 1 });
            return a.v[i];
          });
        }
        case 'un': {
          const a = value(node.a);
          if (node.op === '!') return combine('b', [a], (vm, x) => (x ? 0 : 1));
          if (node.op === '-') return combine(a.t === 'f' ? 'f' : 'i', [a], (vm, x) => -x);
          if (node.op === '~') return combine('i', [a], (vm, x) => ~toInt(x));
          return combine(a.t === 'f' ? 'f' : 'i', [a], (vm, x) => x);
        }
        case 'bin': {
          const a = value(node.a), b = value(node.b);
          if ((a.t === 's' || b.t === 's') && node.op === '+') err('concat', {}, node.line);
          if (a.t === 's' || b.t === 's') err('unsupported', { what: 'comparing "text"' }, node.line);
          if (node.op === '&&' || node.op === '||') {
            const and = node.op === '&&';
            if (!a.g && !b.g) { const fa = a.f, fb = b.f; return P('b', and ? (vm) => (fa(vm) ? (fb(vm) ? 1 : 0) : 0) : (vm) => (fa(vm) ? 1 : fb(vm) ? 1 : 0)); }
            const ga = lift(a), gb = lift(b);
            return G('b', function* (vm) { const x = yield* ga(vm); if (and ? !x : x) return and ? 0 : 1; return (yield* gb(vm)) ? 1 : 0; });
          }
          const cmp = ['==', '!=', '<', '>', '<=', '>='].includes(node.op);
          const t = cmp ? 'b' : ['<<', '>>', '&', '|', '^'].includes(node.op) ? 'i' : numT(a.t, b.t);
          const f = opFn(node.op, numT(a.t, b.t), node.line);
          return combine(t, [a, b], (vm, x, y) => f(x, y));
        }
        case 'cond': {
          const c = value(node.c), a = value(node.a), b = value(node.b);
          const t = a.t === b.t ? a.t : numT(a.t, b.t);
          if (!c.g && !a.g && !b.g) { const fc = c.f, fa = a.f, fb = b.f; return P(t, (vm) => (fc(vm) ? fa(vm) : fb(vm))); }
          const gc = lift(c), ga = lift(a), gb = lift(b);
          return G(t, function* (vm) { return (yield* gc(vm)) ? yield* ga(vm) : yield* gb(vm); });
        }
        case 'cast': { const conv = convOf(node.type); return combine(node.type.k, [value(node.a)], (vm, x) => conv(x)); }
        case 'sizeof': {
          if (node.type) { const s = node.type.size; return P('i', () => s); }
          if (node.a.k === 'id') {
            const v = lookup(node.a.name);
            if (!v) unknown(node.a.name, node.line);
            const size = v.type.size || 2, slot = v.slot, where = v.where;
            if (v.arr) return P('i', (vm) => size * (where === 'g' ? vm.g[slot] : vm.frame[slot]).v.length);
            return P('i', () => size);
          }
          if (node.a.k === 'index' && node.a.a.k === 'id') { const v = lookup(node.a.a.name); if (!v) unknown(node.a.a.name, node.line); const s = v.type.size || 2; return P('i', () => s); }
          const e = value(node.a);
          return P('i', () => (e.t === 'f' ? 4 : 2));
        }
        case 'asg': {
          const R = ref(node.target, node.op);
          const V = value(node.value);
          if (V.t === 's') err('string', {}, node.line);
          const conv = R.conv;
          let f;
          if (node.op === '=') f = (o, k, x) => (o[k] = conv(x));
          else {
            const bop = node.op.slice(0, -1);
            const fo = opFn(bop, numT(R.t, V.t), node.line);
            f = (o, k, x) => (o[k] = conv(fo(o[k], x)));
          }
          if (!R.g && !V.g) { const rf = R.f, vf = V.f; return P(R.t, (vm) => { const x = vf(vm); const o = rf(vm); return f(o, vm.rk, x); }); }
          const gr = lift(R), gv = lift(V);
          return G(R.t, function* (vm) { const x = yield* gv(vm); const o = yield* gr(vm); return f(o, vm.rk, x); });
        }
        case 'inc': {
          const R = ref(node.target, node.op);
          const d = node.op === '++' ? 1 : -1, conv = R.conv, pre = node.prefix;
          const f = (o, k) => { const old = o[k]; o[k] = conv(old + d); return pre ? o[k] : old; };
          if (!R.g) { const rf = R.f; return P(R.t, (vm) => { const o = rf(vm); return f(o, vm.rk); }); }
          const gr = R.f;
          return G(R.t, function* (vm) { const o = yield* gr(vm); return f(o, vm.rk); });
        }
        default: err('unexpected', { got: node.k }, node.line);
      }
      return null;
    }

    // calls: the Arduino's functions, Serial, casts, and the sketch's own functions
    function call(node) {
      const name = node.name, line = node.line, n = node.args.length;
      const arity = (min, max) => {
        if (n < min || n > max) err(min === max ? 'args' : 'argsRange', { name: name + '()', n: min, min, max, got: n }, line);
      };
      if (name.startsWith('Serial.')) {
        const m = name.slice(7);
        if (m === 'begin') { arity(1, 2); return combine('v', node.args.map(value), (vm) => { vm.serialOn = true; return 0; }); }
        if (m === 'print' || m === 'println') {
          arity(m === 'println' ? 0 : 1, 2);
          const args = node.args.map(value);
          const t = args[0] ? args[0].t : 's';
          const nl = m === 'println' ? '\n' : '';
          return combine('v', args, (vm, x, fmt) => { vm.t += COST.serial; vm.print((n ? fmtPrint(x, t, fmt) : '') + nl); return 0; });
        }
        if (m === 'write') { arity(1, 1); return combine('v', node.args.map(value), (vm, x) => { vm.print(typeof x === 'string' ? x : String.fromCharCode(toInt(x) & 255)); return 0; }); }
        if (m === 'available') { arity(0, 0); return P('i', () => 0); }
        if (m === 'read' || m === 'peek') { arity(0, 0); return P('i', () => -1); }
        if (m === 'flush' || m === 'end') { arity(0, 0); return P('v', () => 0); }
        err('unsupported', { what: name }, line);
      }
      if (TYPE_WORDS.has(name)) { // int(x), float(x), byte(x)
        arity(1, 1);
        const ty = typeFrom(name === 'long' ? 'int' : name, name === 'long' ? 1 : 0, name === 'unsigned' ? true : null, line);
        const conv = convOf(ty);
        return combine(ty.k, [value(node.args[0])], (vm, x) => conv(x));
      }
      const b = BUILTINS[name];
      if (b) {
        arity(b.n[0], b.n[1]);
        const args = node.args.map(value);
        const t = typeof b.t === 'function' ? b.t(args.map((a) => a.t)) : b.t;
        const impl = b.f;
        return combine(t, args, (vm, ...xs) => impl(vm, xs, line));
      }
      const f = funcs.get(name);
      if (!f) {
        const v = lookup(name);
        if (v) err('unsupported', { what: name + '()' }, line);
        const known = [...Object.keys(BUILTINS), ...funcs.keys(), 'Serial.print', 'Serial.println', 'Serial.begin'];
        let best = null, bd = 3;
        for (const k of known) { const d = k.toLowerCase() === name.toLowerCase() ? 0 : lev(name, k); if (d < bd) { bd = d; best = k; } }
        if (best && best !== name) err('suggest', { name: name + '()', better: best + '()' }, line);
        err('nofn', { name: name + '()' }, line);
      }
      if (n !== f.params.length) err('args', { name: name + '()', n: f.params.length, got: n }, line);
      const args = node.args.map((a, i) => {
        const e = expr(a);
        if (f.params[i].arr && e.t !== 'arr') err('notarray', { name: a.name || 'it' }, line);
        if (!f.params[i].arr && (e.t === 'arr' || e.t === 'v')) err(e.t === 'arr' ? 'isarray' : 'novalue', { name: a.name || 'it' }, line);
        return e;
      });
      const gs = args.map(lift);
      const convs = f.params.map((p) => (p.arr ? null : convOf(p.type)));
      const retConv = convOf(f.ret);
      return G(f.ret.k, function* (vm) {
        const vals = [];
        for (const g of gs) vals.push(yield* g(vm));
        if (vm.depth >= 60) throw new SketchError('deep', { line, name: name + '()' });
        const frame = new Array(f.size);
        for (let i = 0; i < vals.length; i++) frame[i] = convs[i] ? convs[i](vals[i]) : vals[i];
        const saved = vm.frame;
        vm.frame = frame;
        vm.depth++;
        vm.t += COST.call;
        const r = yield* f.body(vm);
        vm.frame = saved;
        vm.depth--;
        if (r === RET) { const v = vm.ret; vm.ret = 0; return retConv(v); }
        return 0;
      });
    }

    // statements: { p: plain function } or { g: generator } returning 0, BRK, CNT or RET
    function stmt(node) {
      switch (node.k) {
        case 'empty': return { p: () => 0 };
        case 'expr': { const e = expr(node.e); const f = e.f; return e.g ? { g: function* (vm) { yield* f(vm); return 0; } } : { p: (vm) => { f(vm); return 0; } }; }
        case 'decls': {
          const list = node.list.map(decl);
          if (list.length === 1) return list[0];
          return { g: seq(list) };
        }
        case 'block': {
          scopes.push(new Map());
          const list = node.list.map(stmt);
          scopes.pop();
          return { g: seq(list) };
        }
        case 'if': {
          const c = value(node.c), a = asGen(stmt(node.a)), b = node.b ? asGen(stmt(node.b)) : null;
          const gc = lift(c);
          return { g: function* (vm) { if (yield* gc(vm)) return yield* a(vm); if (b) return yield* b(vm); return 0; } };
        }
        case 'while': case 'do': {
          const c = value(node.c);
          loops++;
          const body = asGen(stmt(node.body));
          loops--;
          const gc = lift(c), isDo = node.k === 'do';
          return {
            g: function* (vm) {
              let first = isDo;
              for (;;) {
                vm.steps++; vm.t += COST.stmt;
                if (!first && !(yield* gc(vm))) return 0;
                first = false;
                const r = yield* body(vm);
                if (r === BRK) return 0;
                if (r === RET) return RET;
                if (vm.t >= vm.until || vm.steps >= vm.cap) yield 0;
              }
            }
          };
        }
        case 'for': {
          scopes.push(new Map());
          const init = node.init ? stmt(node.init) : null;
          const c = node.c ? value(node.c) : null;
          const upd = node.upd.map(value);
          loops++;
          const body = asGen(stmt(node.body));
          loops--;
          scopes.pop();
          const gi = init ? asGen(init) : null, gc = c ? lift(c) : null, gu = upd.map(lift);
          return {
            g: function* (vm) {
              if (gi) yield* gi(vm);
              for (;;) {
                vm.steps++; vm.t += COST.stmt;
                if (gc && !(yield* gc(vm))) return 0;
                const r = yield* body(vm);
                if (r === BRK) return 0;
                if (r === RET) return RET;
                for (const u of gu) yield* u(vm);
                if (vm.t >= vm.until || vm.steps >= vm.cap) yield 0;
              }
            }
          };
        }
        case 'switch': {
          const e = lift(value(node.e));
          switches++;
          scopes.push(new Map());
          const items = node.items.map(stmt);
          scopes.pop();
          switches--;
          const cases = node.cases.map((c) => ({ v: lift(value(c.v)), at: c.at }));
          const dflt = node.dflt;
          return {
            g: function* (vm) {
              const x = yield* e(vm);
              let start = dflt;
              for (const c of cases) { if ((yield* c.v(vm)) === x) { start = c.at; break; } }
              if (start < 0) return 0;
              for (let i = start; i < items.length; i++) {
                vm.steps++; vm.t += COST.stmt;
                const s = items[i];
                const r = s.p ? s.p(vm) : yield* s.g(vm);
                if (r === BRK) return 0;
                if (r) return r;
                if (vm.t >= vm.until || vm.steps >= vm.cap) yield 0;
              }
              return 0;
            }
          };
        }
        case 'break': if (!loops && !switches) err('loopout', { what: 'break' }, node.line); return { p: () => BRK };
        case 'continue': if (!loops) err('loopout', { what: 'continue' }, node.line); return { p: () => CNT };
        case 'return': {
          if (node.e && fn.ret.k === 'v') err('returnvoid', { name: fn.name + '()' }, node.line);
          if (!node.e) return { p: () => RET };
          const e = value(node.e);
          if (!e.g) { const f = e.f; return { p: (vm) => { vm.ret = f(vm); return RET; } }; }
          const g = e.f;
          return { g: function* (vm) { vm.ret = yield* g(vm); return RET; } };
        }
        default: err('unexpected', { got: node.k }, node.line);
      }
      return null;
    }
    function asGen(s) { if (s.g) return s.g; const f = s.p; return function* (vm) { return f(vm); }; }
    function seq(list) {
      const n = list.length;
      return function* (vm) {
        for (let i = 0; i < n; i++) {
          const s = list[i];
          vm.steps++; vm.t += COST.stmt;
          let r;
          if (s.p) r = s.p(vm); else r = yield* s.g(vm);
          if (r) return r;
          if (vm.t >= vm.until || vm.steps >= vm.cap) yield 0;
        }
        return 0;
      };
    }
    function makeArray(type, n, line, name) {
      n = toInt(n);
      if (!(n >= 1 && n <= 2000)) throw new SketchError('arraysize', { line, name });
      return { v: new Array(n).fill(0), name };
    }
    // a declaration: a variable, a static, or an array, set as the statement runs
    function decl(d, where) {
      const isG = where === 'g';
      const v = d.isStatic && !isG ? (() => { const gv = { name: d.name, type: d.type, isConst: d.isConst, arr: Boolean(d.arr), where: 'g', slot: gsize++, conv: convOf(d.type) }; scopes[scopes.length - 1].set(d.name, gv); return gv; })() : declare(d, isG ? 'g' : 'l');
      if (d.type.k === 'v') err('unexpected', { got: 'void' }, d.line);
      const slot = v.slot, conv = v.conv, line = d.line, name = d.name;
      const store = isG || d.isStatic ? (vm, x) => { vm.g[slot] = x; } : (vm, x) => { vm.frame[slot] = x; };
      let run, gen = false;
      if (d.arr) {
        gen = true;
        const size = d.arr.size ? value(d.arr.size) : null;
        const inits = d.init ? d.init.map(value) : [];
        inits.forEach((e) => { if (e.t === 's') err('string', {}, line); });
        const gs = size ? lift(size) : null, gi = inits.map(lift);
        run = function* (vm) {
          const n = gs ? yield* gs(vm) : gi.length;
          const a = makeArray(d.type, n, line, name);
          if (gi.length > a.v.length) throw new SketchError('index', { line, name, i: gi.length - 1, n: a.v.length, last: a.v.length - 1 });
          for (let i = 0; i < gi.length; i++) a.v[i] = conv(yield* gi[i](vm));
          store(vm, a);
          return 0;
        };
      } else {
        const init = d.init ? value(d.init) : null;
        if (init && init.t === 's') err('string', {}, line);
        if (init && !init.g) { const f = init.f; run = (vm) => { store(vm, conv(f(vm))); return 0; }; }
        else if (init) { gen = true; const g = init.f; run = function* (vm) { store(vm, conv(yield* g(vm))); return 0; }; }
        else run = (vm) => { store(vm, 0); return 0; };
      }
      const isGen = gen;
      if (d.isStatic && !isG) { // set once, the first time
        const flag = gsize++;
        const g = isGen ? run : (function (f) { return function* (vm) { return f(vm); }; })(run);
        return { g: function* (vm) { if (!vm.g[flag]) { vm.g[flag] = 1; yield* g(vm); } return 0; } };
      }
      return isGen ? { g: run } : { p: run };
    }

    // globals first (all of them, so functions can use any), then the functions
    scopes = [];
    fn = { size: 0, ret: T_INT, name: '' };
    const ginit = ast.globals.map((d) => decl(d, 'g'));
    for (const f of funcs.values()) {
      if (!f.ast) continue;
      fn = f;
      f.size = 0;
      scopes = [new Map()];
      f.params.forEach((p) => {
        if (scopes[0].has(p.name)) err('twice', { name: p.name }, p.line);
        scopes[0].set(p.name, { name: p.name, type: p.type, isConst: false, arr: p.arr, where: 'l', slot: f.size++, conv: convOf(p.type) });
      });
      loops = 0; switches = 0;
      f.body = seq(f.ast.list.map(stmt));
    }
    for (const f of funcs.values()) if (!f.body) f.body = function* () { return 0; };
    const setup = funcs.get('setup'), loop = funcs.get('loop');
    if (!setup || !setup.ast) throw new SketchError('nosetup', {});
    if (!loop || !loop.ast) throw new SketchError('noloop', {});
    const gInit = seq(ginit);
    const size = () => gsize;
    return {
      gsize: size,
      main: function* (vm) {
        vm.frame = [];
        yield* gInit(vm);
        vm.frame = new Array(setup.size);
        yield* setup.body(vm);
        for (;;) {
          vm.frame = new Array(loop.size);
          vm.t += COST.loop;
          vm.steps++;
          yield* loop.body(vm);
          if (vm.t >= vm.until || vm.steps >= vm.cap) yield 0;
        }
      }
    };
  }

  function fmtPrint(x, t, fmt) {
    if (t === 's') return String(x);
    if (t === 'c') return String.fromCharCode(toInt(x) & 255);
    if (t === 'f') {
      if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : 'inf';
      const d = fmt == null ? 2 : clamp(toInt(fmt), 0, 8);
      return Number(x).toFixed(d);
    }
    const v = toInt(x);
    if (fmt === 16) return (v >>> 0).toString(16).toUpperCase();
    if (fmt === 2) return (v >>> 0).toString(2);
    if (fmt === 8) return (v >>> 0).toString(8);
    return String(v);
  }

  const pinArg = (x, line) => { const p = toInt(x); if (!(p >= 0 && p <= 19)) throw new SketchError('pin', { line, pin: p }); return p; };
  const numArgT = (ts) => (ts.some((t) => t === 'f') ? 'f' : 'i');
  const BUILTINS = {
    pinMode: { n: [2, 2], t: 'v', f: (vm, a, line) => { const m = toInt(a[1]); if (m !== 0 && m !== 1 && m !== 2) throw new SketchError('pinmode', { line }); vm.io.mode(pinArg(a[0], line), m); vm.t += COST.digital; return 0; } },
    digitalWrite: { n: [2, 2], t: 'v', f: (vm, a, line) => { vm.io.write(pinArg(a[0], line), a[1] ? 1 : 0); vm.t += COST.digital; return 0; } },
    digitalRead: { n: [1, 1], t: 'i', f: (vm, a, line) => { vm.t += COST.digital; return vm.io.read(pinArg(a[0], line)) >= 2.5 ? 1 : 0; } },
    analogRead: { n: [1, 1], t: 'i', f: (vm, a, line) => { let p = toInt(a[0]); if (p >= 0 && p <= 5) p += 14; if (!(p >= 14 && p <= 19)) throw new SketchError('apin', { line }); vm.t += COST.analog; return Math.round(clamp(vm.io.read(p), 0, 5) / 5 * 1023); } },
    analogWrite: { n: [2, 2], t: 'v', f: (vm, a, line) => { vm.io.pwm(pinArg(a[0], line), clamp(toInt(a[1]), 0, 255)); vm.t += COST.pwm; return 0; } },
    tone: { n: [2, 3], t: 'v', f: (vm, a, line) => { vm.io.tone(pinArg(a[0], line), Math.max(31, toInt(a[1])), a[2] != null ? toInt(a[2]) : 0); return 0; } },
    noTone: { n: [1, 1], t: 'v', f: (vm, a, line) => { vm.io.write(pinArg(a[0], line), 0); return 0; } },
    delay: { n: [1, 1], t: 'v', f: (vm, a) => { vm.t += Math.max(0, toInt(a[0])) * 1000; return 0; } },
    delayMicroseconds: { n: [1, 1], t: 'v', f: (vm, a) => { vm.t += Math.max(0, toInt(a[0])); return 0; } },
    millis: { n: [0, 0], t: 'i', f: (vm) => Math.floor(vm.t / 1000) },
    micros: { n: [0, 0], t: 'i', f: (vm) => Math.floor(vm.t) },
    map: { n: [5, 5], t: 'i', f: (vm, a, line) => { const [x, a1, a2, b1, b2] = a.map(toInt); if (a2 === a1) throw new SketchError('div0', { line }); return Math.trunc((x - a1) * (b2 - b1) / (a2 - a1)) + b1; } },
    constrain: { n: [3, 3], t: numArgT, f: (vm, a) => (a[0] < a[1] ? a[1] : a[0] > a[2] ? a[2] : a[0]) },
    min: { n: [2, 2], t: numArgT, f: (vm, a) => (a[0] < a[1] ? a[0] : a[1]) },
    max: { n: [2, 2], t: numArgT, f: (vm, a) => (a[0] > a[1] ? a[0] : a[1]) },
    abs: { n: [1, 1], t: numArgT, f: (vm, a) => Math.abs(a[0]) },
    sq: { n: [1, 1], t: numArgT, f: (vm, a) => a[0] * a[0] },
    sqrt: { n: [1, 1], t: 'f', f: (vm, a) => Math.sqrt(a[0]) },
    pow: { n: [2, 2], t: 'f', f: (vm, a) => Math.pow(a[0], a[1]) },
    sin: { n: [1, 1], t: 'f', f: (vm, a) => Math.sin(a[0]) },
    cos: { n: [1, 1], t: 'f', f: (vm, a) => Math.cos(a[0]) },
    tan: { n: [1, 1], t: 'f', f: (vm, a) => Math.tan(a[0]) },
    floor: { n: [1, 1], t: 'f', f: (vm, a) => Math.floor(a[0]) },
    ceil: { n: [1, 1], t: 'f', f: (vm, a) => Math.ceil(a[0]) },
    round: { n: [1, 1], t: 'i', f: (vm, a) => Math.round(a[0]) },
    random: { n: [1, 2], t: 'i', f: (vm, a) => { const lo = a.length > 1 ? toInt(a[0]) : 0, hi = toInt(a.length > 1 ? a[1] : a[0]); if (hi <= lo) return lo; return lo + Math.floor(vm.rand() * (hi - lo)); } },
    randomSeed: { n: [1, 1], t: 'v', f: (vm, a) => { vm.seed = toInt(a[0]) >>> 0; return 0; } },
    bitRead: { n: [2, 2], t: 'i', f: (vm, a) => (toInt(a[0]) >> toInt(a[1])) & 1 },
    bit: { n: [1, 1], t: 'i', f: (vm, a) => 1 << toInt(a[0]) },
    highByte: { n: [1, 1], t: 'i', f: (vm, a) => (toInt(a[0]) >> 8) & 255 },
    lowByte: { n: [1, 1], t: 'i', f: (vm, a) => toInt(a[0]) & 255 }
  };

  function makeVM(prog, io) {
    const vm = { t: 0, until: 0, steps: 0, cap: 0, g: new Array(prog.gsize()).fill(0), frame: null, depth: 0, ret: 0, rk: 0, io, serialOn: false, seed: 12345, done: false, error: null };
    vm.rand = () => { // mulberry32: the same "random" numbers every run, so a check is fair
      let s = (vm.seed = (vm.seed + 0x6D2B79F5) >>> 0);
      s = Math.imul(s ^ (s >>> 15), s | 1);
      s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
      return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
    vm.print = (s) => { if (vm.serialOn) vm.io.serial(s); else vm.noBegin = true; };
    vm.it = prog.main(vm);
    return vm;
  }
  // run until simulated time reaches until (microseconds), or maxSteps statements have run
  function advance(vm, until, maxSteps) {
    if (vm.done || vm.t >= until) return;
    vm.until = until;
    vm.cap = vm.steps + maxSteps;
    try {
      const r = vm.it.next();
      if (r.done) vm.done = true;
    } catch (e) {
      vm.done = true;
      vm.error = e instanceof SketchError ? e : new SketchError('crash', { msg: String((e && e.message) || e).slice(0, 80) });
    }
  }

  /* ---------------- a run of the bench over time ---------------- */

  // The bench as it runs: inputs (buttons, switches, knobs, light), the Arduino's pins and its sketch.
  function session(B, opts) {
    opts = opts || {};
    const inputs = { press: {}, on: {}, knob: {}, light: {} };
    for (const p of B.parts.values()) {
      if (p.type === 'switch') inputs.on[p.id] = Boolean(p.on);
      if (p.type === 'pot') inputs.knob[p.id] = p.knob;
      if (p.type === 'ldr') inputs.light[p.id] = p.light;
      if (p.type === 'button') inputs.press[p.id] = false;
    }
    const pins = Array.from({ length: 20 }, () => ({ mode: INPUT, level: 0, duty: null, freq: 0 }));
    const cache = new Map();
    const S = {
      B, inputs, pins, burnt: new Set(), serial: '', serialLen: 0, vm: null, record: null, dirty: true, last: null, toneEnd: [],
      key() {
        let k = '';
        for (const id of Object.keys(inputs.press)) k += inputs.press[id] ? 'p' : 'r';
        for (const id of Object.keys(inputs.on)) k += inputs.on[id] ? '1' : '0';
        for (const id of Object.keys(inputs.knob)) k += ',' + inputs.knob[id];
        for (const id of Object.keys(inputs.light)) k += ',' + inputs.light[id];
        k += '|';
        for (const ps of pins) k += ps.mode + (ps.duty != null ? '~' + ps.duty.toFixed(3) : String(ps.level));
        if (S.burnt.size) k += '|' + [...S.burnt].join(',');
        return k;
      },
      view(extra) {
        if (extra) return view(B, Object.assign({ press: inputs.press, on: inputs.on, knob: inputs.knob, light: inputs.light, pins: pins.map((x) => Object.assign({}, x)), burnt: S.burnt }, extra));
        if (!S.dirty && S.last) return S.last;
        const k = S.key();
        let v = cache.get(k);
        if (!v) {
          v = view(B, { press: Object.assign({}, inputs.press), on: Object.assign({}, inputs.on), knob: Object.assign({}, inputs.knob), light: Object.assign({}, inputs.light), pins: pins.map((x) => Object.assign({}, x)), burnt: new Set(S.burnt) });
          if (cache.size > 300) cache.clear();
          cache.set(k, v);
        }
        S.last = v;
        S.dirty = false;
        return v;
      },
      // live: an LED that burns stays burnt (open) until the build changes
      latch() {
        for (let i = 0; i < 8; i++) {
          const v = S.view();
          const fresh = Object.keys(v.parts).filter((id) => v.parts[id].burn && !S.burnt.has(id));
          if (!fresh.length) return v;
          fresh.forEach((id) => S.burnt.add(id));
          S.dirty = true;
        }
        return S.view();
      },
      set(kind, id, x) { if (inputs[kind] && own(inputs[kind], id) && inputs[kind][id] !== x) { inputs[kind][id] = x; S.dirty = true; S.changed(); } },
      setAll(kind, x) { Object.keys(inputs[kind]).forEach((id) => S.set(kind, id, x)); },
      changed() { if (S.record) S.record.push({ t: S.vm ? S.vm.t : 0, pins: pins.map((x) => Object.assign({}, x)) }); },
      start() {
        pins.forEach((ps) => { ps.mode = INPUT; ps.level = 0; ps.duty = null; ps.freq = 0; });
        S.serial = ''; S.serialLen = 0; S.dirty = true; S.toneEnd = [];
        S.vm = B.program ? makeVM(B.program, io) : null;
        return S.vm;
      },
      stop() { S.vm = null; pins.forEach((ps) => { ps.mode = INPUT; ps.level = 0; ps.duty = null; ps.freq = 0; }); S.dirty = true; },
      // the page rewired the bench while the sketch runs: carry on with the same sketch, pins and serial output
      adopt(old) {
        if (!old) return S;
        old.pins.forEach((ps, i) => Object.assign(pins[i], ps));
        S.vm = old.vm;
        if (S.vm) S.vm.io = io;
        S.serial = old.serial; S.serialLen = old.serialLen; S.toneEnd = old.toneEnd;
        Object.keys(inputs).forEach((k) => Object.keys(inputs[k]).forEach((id) => { if (k === 'press' && own(old.inputs.press, id)) inputs.press[id] = old.inputs.press[id]; }));
        S.dirty = true;
        return S;
      },
      // check mode: run ms of simulated time at once (false if it took too many steps)
      run(ms, budget) {
        if (!S.vm) return true;
        const until = S.vm.t + ms * 1000;
        let left = budget || 3e6;
        while (!S.vm.done && S.vm.t < until && left > 0) {
          const s0 = S.vm.steps;
          advance(S.vm, Math.min(until, S.nextTone(until)), Math.min(left, 200000));
          S.tones();
          left -= S.vm.steps - s0;
        }
        return left > 0 || S.vm.t >= until;
      },
      // tone(pin, f, ms) ends by itself
      nextTone(until) { return S.toneEnd.reduce((m, x) => Math.min(m, x.t), until); },
      tones() {
        if (!S.vm) return;
        S.toneEnd = S.toneEnd.filter((x) => {
          if (x.t > S.vm.t) return true;
          const ps = pins[x.pin];
          if (ps.freq) { ps.duty = null; ps.level = 0; ps.freq = 0; S.dirty = true; S.changed(); }
          return false;
        });
      },
      print(s) {
        if (S.serialLen > 200000) return;
        S.serialLen += s.length;
        S.serial = (S.serial + s).slice(-6000);
        if (opts.onSerial) opts.onSerial(s);
      }
    };
    const io = {
      mode(p, m) { const ps = pins[p]; if (ps.mode !== m) { ps.mode = m; ps.duty = null; ps.freq = 0; S.dirty = true; S.changed(); } },
      write(p, v) {
        const ps = pins[p];
        if (ps.mode === OUTPUT) { if (ps.level !== v || ps.duty != null) { ps.level = v; ps.duty = null; ps.freq = 0; S.dirty = true; S.changed(); } }
        else { const m = v ? PULLUP : INPUT; if (ps.mode !== m) { ps.mode = m; S.dirty = true; S.changed(); } } // digitalWrite on an input sets its pull-up, as on a real board
      },
      pwm(p, v) {
        const ps = pins[p];
        const was = ps.mode + ':' + ps.level + ':' + ps.duty;
        ps.mode = OUTPUT; ps.freq = 0;
        if (PWM.includes(p) && v > 0 && v < 255) { ps.duty = round(v / 255, 4); ps.level = 0; }
        else { ps.duty = null; ps.level = PWM.includes(p) ? (v >= 255 ? 1 : 0) : (v >= 128 ? 1 : 0); }
        if (was !== ps.mode + ':' + ps.level + ':' + ps.duty) { S.dirty = true; S.changed(); }
      },
      tone(p, f, ms) {
        const ps = pins[p];
        ps.mode = OUTPUT; ps.duty = 0.5; ps.level = 0; ps.freq = f;
        S.dirty = true; S.changed();
        S.toneEnd = S.toneEnd.filter((x) => x.pin !== p);
        if (ms > 0) S.toneEnd.push({ pin: p, t: S.vm.t + ms * 1000 });
      },
      read(p) { const v = S.view().volt(pinName(p)); return v == null ? 0 : v; },
      serial(s) { S.print(s); }
    };
    S.io = io;
    if (opts.run !== false && B.program) S.start();
    return S;
  }

  /* ---------------- goals ---------------- */

  const GOAL_ALIASES = {
    light: 'light', lit: 'light', on: 'light', glow: 'light', led: 'light', power: 'light', buzz: 'light', beep: 'light', sound: 'light', buzzer: 'light', motor: 'light', spin: 'light',
    series: 'series', 'in series': 'series', parallel: 'parallel', 'in parallel': 'parallel',
    button: 'button', press: 'button', pushbutton: 'button', 'push button': 'button',
    switch: 'switch', toggle: 'switch', slide: 'switch',
    dimmer: 'dimmer', dim: 'dimmer', brightness: 'dimmer', fade: 'dimmer', pot: 'dimmer', knob: 'dimmer', potentiometer: 'dimmer', ldr: 'dimmer', sensor: 'dimmer', 'light sensor': 'dimmer', 'night light': 'dimmer',
    blink: 'blink', flash: 'blink', blinking: 'blink',
    serial: 'serial', print: 'serial', monitor: 'serial', 'serial monitor': 'serial'
  };
  const PART_GOAL = { buzz: 'buzzer', beep: 'buzzer', sound: 'buzzer', buzzer: 'buzzer', motor: 'motor', spin: 'motor' };
  function digitalPin(v) {
    const q = parsePoint(typeof v === 'number' ? String(v) : v, true);
    return q && q.term && PINS.includes(q.term) ? pinNo(q.term) : null;
  }

  // A goal, checked against the bench: the parts it needs must be there. Throws BBError.
  function normGoal(raw, spec) {
    if (!isObj(raw)) fail('the goal is not an object');
    const tRaw = String(pick(raw, ['type', 'kind']) || '').trim().toLowerCase().replace(/_/g, ' ');
    const type = GOAL_ALIASES[tRaw];
    if (!type) fail(`unknown goal type "${show(tRaw)}" (light, series, parallel, button, switch, dimmer, blink or serial)`);
    const g = { type };
    const inv = inventory(spec);
    const count = (t, c) => inv.filter((x) => x.type === t && (!c || x.color === c || x.color === 'any')).length;
    const need = (ok, msg) => { if (!ok) fail(msg); };
    if (!spec.battery && !spec.arduino) fail('the goal needs power: add "battery": "9V" or "arduino": true');
    const part = PART_GOAL[tRaw] || String(pick(raw, ['part', 'output', 'device']) || 'led').trim().toLowerCase();
    if (type === 'light' || type === 'button' || type === 'switch') {
      g.part = part === 'buzzer' || part === 'motor' ? part : 'led';
      if (g.part === 'buzzer') need(count('buzzer'), 'the goal needs a buzzer but the parts bin has none (add "buzzer": 1 to "bin")');
      if (g.part === 'motor') need(spec.motor, 'the goal needs the motor but there is none (add "motor": true)');
    }
    const color = pick(raw, ['color', 'colour']);
    if (color != null && color !== 'any' && (type === 'light' || type === 'button' || type === 'switch' || type === 'blink' || type === 'dimmer')) {
      const c = String(color).trim().toLowerCase();
      if (!LEDS[c]) fail(`the goal's colour "${show(color)}" is not an LED colour (red, green, yellow, blue, white)`);
      need(count('led', c), `the goal needs a ${c} LED but the parts bin has none (add it to "bin": {"led": ["${c}"]})`);
      g.color = c;
    }
    const n = pick(raw, ['count', 'leds', 'n', 'number']);
    if (type === 'light' || type === 'series' || type === 'parallel') {
      const k = n == null ? (type === 'light' ? 1 : 2) : Math.floor(parseNum(n));
      if (!(k >= 1 && k <= 6)) fail('the goal\'s "count" should be 1 to 6');
      if (type !== 'light' && k < 2) fail(`a ${type} goal needs "count" of 2 or more LEDs`);
      g.count = k;
    }
    if ((!g.part || g.part === 'led') && type !== 'serial') {
      const k = g.count || 1;
      const have = count('led', g.color);
      need(have >= k, k > 1 ? `the goal needs ${k} LEDs but the parts bin has ${have}` : 'the goal needs an LED but the parts bin has none (add "led": ["red"] to "bin")');
    }
    if (type === 'light') {
      const o = pick(raw, ['ohms', 'resistor', 'resistance']);
      if (o != null) {
        const v = sig2(parseOhms(o));
        if (!(v >= 1 && v <= 1e6)) fail('the goal\'s "ohms" is not a resistor value');
        need(inv.some((x) => x.type === 'resistor' && (x.ohms === v || x.ohms === 0)), `the goal needs a ${v} ohm resistor but the parts bin has none`);
        g.ohms = v;
      }
      const r = pick(raw, ['mA', 'ma', 'current']);
      if (r != null) {
        const lo = Array.isArray(r) ? parseNum(r[0]) : parseNum(r) * 0.8, hi = Array.isArray(r) ? parseNum(r[1]) : parseNum(r) * 1.2;
        if (!(lo >= 0.5 && hi > lo && hi <= 30)) fail('the goal\'s "mA" should be [low, high] between 0.5 and 30');
        g.mA = [round(lo, 3), round(hi, 3)];
      }
    }
    if (type === 'button') {
      need(count('button'), 'the goal needs a push button but the parts bin has none (add "button": 1 to "bin")');
      g.when = String(pick(raw, ['when', 'lit']) || 'pressed').toLowerCase().startsWith('rel') ? 'released' : 'pressed';
    }
    if (type === 'switch') need(count('switch'), 'the goal needs a slide switch but the parts bin has none (add "switch": 1 to "bin")');
    if (type === 'dimmer') {
      let by = String(pick(raw, ['by', 'with', 'input', 'sensor']) || (tRaw === 'ldr' || tRaw === 'light sensor' || tRaw === 'night light' || tRaw === 'sensor' ? 'ldr' : 'pot')).trim().toLowerCase();
      by = typeOf(by) === 'ldr' ? 'ldr' : 'pot';
      need(count(by), by === 'pot' ? 'the goal needs a potentiometer but the parts bin has none (add "pot": 1 to "bin")' : 'the goal needs an LDR (light sensor) but the parts bin has none (add "ldr": 1 to "bin")');
      g.by = by;
      const lit = pick(raw, ['lit', 'on_when', 'when']) || (tRaw === 'night light' ? 'dark' : null);
      if (lit != null && by === 'ldr') {
        const s = String(lit).toLowerCase();
        if (/dark|night/.test(s)) g.lit = 'dark';
        else if (/bright|light|day/.test(s)) g.lit = 'bright';
      }
    }
    // the Arduino's pins
    const pinRaw = pick(raw, ['pin', 'button_pin', 'input_pin', 'in', 'sensor_pin']);
    const ledRaw = pick(raw, ['led_pin', 'output_pin', 'out', 'ledpin']);
    if (type === 'blink') {
      need(spec.arduino, 'a blink goal needs the Arduino ("arduino": true)');
      const p = digitalPin(pinRaw != null ? pinRaw : ledRaw != null ? ledRaw : 13);
      if (p == null) fail(`the goal's pin "${show(pinRaw)}" is not an Arduino pin (0 to 13, or A0 to A5)`);
      g.pin = p;
      const both = parseNum(pick(raw, ['ms', 'interval', 'delay', 'period_ms']));
      const on = parseNum(pick(raw, ['on_ms', 'on', 'high_ms'])), off = parseNum(pick(raw, ['off_ms', 'off', 'low_ms']));
      g.on_ms = Math.round(Number.isFinite(on) ? on : Number.isFinite(both) ? both : 1000);
      g.off_ms = Math.round(Number.isFinite(off) ? off : Number.isFinite(both) ? both : g.on_ms);
      if (!(g.on_ms >= 100 && g.on_ms <= 3000 && g.off_ms >= 100 && g.off_ms <= 3000)) fail('the blink goal\'s on_ms and off_ms should each be 100 to 3000');
    } else if (type === 'serial') {
      need(spec.arduino, 'a serial goal needs the Arduino ("arduino": true)');
      const text = String(pick(raw, ['text', 'prints', 'message', 'output']) || '').replace(/[\u0000-\u001f\u007f"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!text) fail('a serial goal needs "text": what the serial monitor should show');
      g.text = text;
    } else if ((pinRaw != null || ledRaw != null) && spec.arduino) { // (on a bench with no Arduino, pins mean nothing: the goal is done in wiring)
      if (!['light', 'button', 'switch', 'dimmer'].includes(type)) fail(`a ${type} goal doesn't take an Arduino pin`);
      if (g.part === 'motor') fail('an Arduino pin can\'t drive the motor: it needs far more current than a pin gives. Power the motor from the battery instead');
      if (type === 'light') {
        const p = digitalPin(pinRaw != null ? pinRaw : ledRaw);
        if (p == null) fail('the goal\'s "pin" is not an Arduino pin');
        g.pin = p;
      } else {
        if (pinRaw != null) {
          const p = digitalPin(pinRaw);
          if (p == null) fail('the goal\'s "pin" is not an Arduino pin');
          if (type === 'dimmer' && p < 14) fail('a dimmer\'s "pin" is the analog input that reads it: A0 to A5');
          g.pin = p;
        }
        if (ledRaw != null) {
          const p = digitalPin(ledRaw);
          if (p == null) fail('the goal\'s "led_pin" is not an Arduino pin');
          if (type === 'dimmer' && !PWM.includes(p)) fail(`pin ${p} can't dim an LED: analogWrite needs a ~ pin (3, 5, 6, 9, 10 or 11)`);
          if (p === g.pin) fail('the goal\'s "pin" and "led_pin" are the same pin');
          g.led_pin = p;
        }
      }
    }
    return g;
  }
  const needsCode = (g) => g.type === 'blink' || g.type === 'serial' || g.pin != null || g.led_pin != null;

  // which parts are the goal's outputs, and whether one is on
  function outputsOf(B, goal) {
    if (goal.part === 'motor') return B.spec.motor ? ['MOTOR'] : [];
    const type = goal.part === 'buzzer' ? 'buzzer' : 'led';
    return [...B.parts.values()].filter((p) => p.type === type && (!goal.color || type !== 'led' || p.color === goal.color)).map((p) => p.id);
  }
  const isOn = (v, id) => { const o = v.parts[id]; return Boolean(o && (o.lit || o.on)); };
  // a problem in a state: a short circuit, an LED burning out, a pin giving too much
  function health(v, B) {
    if (v.short) return { code: 'short', src: v.shortSrc };
    const b = Object.keys(v.parts).find((id) => v.parts[id].burn);
    if (b) return { code: 'burn', name: b, mA: mA(v.parts[b].I > v.parts[b].peak / 2 ? v.parts[b].I : v.parts[b].peak) };
    if (v.overload.length) return { code: 'pin', pin: pinLabel(v.overload[0]), mA: mA(v.pinPeak[v.overload[0]]) };
    return null;
  }
  const pinLabel = (p) => (p < 14 ? String(p) : 'A' + (p - 14));

  // why nothing lights: the most useful thing to say about this build
  function diagnose(B, S, ids) {
    const parts = [...B.parts.values()];
    const order = ids.map((id) => B.parts.get(id)).filter(Boolean).concat(parts.filter((p) => !ids.includes(p.id)));
    for (const p of order) {
      if (p.type === 'switch' || p.type === 'pot') continue;
      if (new Set(p.legs.map((l) => B.uf[l])).size < p.legs.length) return { code: 'samestrip', name: p.id };
    }
    for (const p of order) {
      for (let i = 0; i < p.at.length; i++) if ((B.attach.get(p.legs[i]) || 0) < 2 && !isTermNode(B, p.legs[i])) return { code: 'alone', name: p.id, hole: p.at[i] };
    }
    for (const w of B.build.wires) {
      for (const end of [w.from, w.to]) if (HOLES.has(end) && (B.attach.get(B.pts.get(B.nodeOf(end))) || 0) < 2) return { code: 'wirealone', hole: end };
    }
    for (const id of ids) {
      const p = B.parts.get(id);
      if (!p || (p.type !== 'led' && p.type !== 'buzzer')) continue;
      const v = S.view({ flip: new Set([id]) });
      if (isOn(v, id)) return { code: 'reversed', name: id };
    }
    const powered = (B.spec.battery && ['BAT+', 'BAT-'].every((t) => (B.attach.get(B.pts.get(t)) || 0) > 0)) || (B.spec.arduino && POWER.concat(PINS).some((t) => (B.attach.get(B.pts.get(t)) || 0) > 0));
    if (!powered) return { code: 'nopower' };
    return { code: 'dark' };
  }
  const isTermNode = (B, node) => isTerm(B.names[node]);

  // the LED (or output) follows this pin: it changes when the pin goes high or low
  function drivenBy(S, id, pin) {
    const force = (level) => { const pins = S.pins.map((x) => Object.assign({}, x)); pins[pin] = { mode: OUTPUT, level, duty: null, freq: 0 }; return S.view({ pins }); };
    return isOn(force(1), id) !== isOn(force(0), id);
  }

  // Does this build meet the goal? { ok, why: { code, ... }, invalid? }
  function evaluate(spec, goal, build) {
    const B = bench(spec, build);
    if (needsCode(goal)) {
      if (!build.code || !build.code.trim()) return { ok: false, invalid: true, why: { code: 'nocode' } };
      if (B.codeError) return { ok: false, invalid: true, why: { code: 'sketch', error: B.codeError } };
    }
    const ids = outputsOf(B, goal);
    const ok = { ok: true };
    const no = (why) => ({ ok: false, why });
    const useCode = Boolean(B.program);
    const fresh = () => session(B);
    const timed = (S, ms) => { if (!S.run(ms)) return { code: 'slow' }; if (S.vm && S.vm.error) return { code: 'sketch', error: S.vm.error }; return null; };
    const hasType = (t) => [...B.parts.values()].some((p) => p.type === t);

    if (goal.type === 'light' || goal.type === 'series' || goal.type === 'parallel') {
      if (!ids.length) return no(goal.part === 'buzzer' ? { code: 'nobuzzer' } : goal.part === 'motor' ? { code: 'motor' } : { code: 'noled' });
      let first = null;
      for (const pressAll of [false, true]) {
        const S = fresh();
        if (pressAll) { if (!hasType('button')) break; S.setAll('press', true); }
        const bad = useCode ? timed(S, 1500) : null;
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B);
        if (h) { first = first || h; continue; }
        let lit = ids.filter((id) => isOn(v, id));
        if (goal.pin != null) lit = lit.filter((id) => drivenBy(S, id, goal.pin));
        if (goal.type === 'light') {
          if (goal.mA) {
            const inRange = lit.filter((id) => v.parts[id].I * 1000 >= goal.mA[0] - 1e-6 && v.parts[id].I * 1000 <= goal.mA[1] + 1e-6);
            if (lit.length && inRange.length < goal.count) { first = first || { code: 'mA', mA: mA(v.parts[lit[0]].I), lo: goal.mA[0], hi: goal.mA[1] }; continue; }
            lit = inRange;
          }
          if (goal.ohms) {
            const res = [...B.parts.values()].filter((p) => p.type === 'resistor' && p.ohms === goal.ohms).map((p) => (v.parts[p.id] ? v.parts[p.id].I : 0));
            const through = lit.filter((id) => res.some((i) => Math.abs(i - v.parts[id].I) <= 0.03 * v.parts[id].I + 1e-6));
            if (lit.length && through.length < goal.count) { first = first || { code: 'ohms', ohms: goal.ohms }; continue; }
            lit = through;
          }
          if (lit.length >= goal.count) return ok;
          if (lit.length) { first = first || { code: 'few', n: lit.length, want: goal.count }; continue; }
          if (goal.pin != null && ids.some((id) => isOn(v, id))) { first = first || { code: 'pinout', pin: pinLabel(goal.pin) }; continue; }
          first = first || diagnose(B, S, ids);
          continue;
        }
        // series and parallel: take each lit LED out in turn and see what the others do
        if (lit.length < goal.count) { first = first || (lit.length ? { code: 'few', n: lit.length, want: goal.count } : diagnose(B, S, ids)); continue; }
        const series = goal.type === 'series';
        const good = lit.every((id) => {
          const w = S.view({ open: new Set([id]) });
          const others = lit.filter((x) => x !== id);
          return series ? others.every((x) => !isOn(w, x)) : others.every((x) => isOn(w, x));
        });
        if (good) return ok;
        first = first || { code: series ? 'notseries' : 'notparallel' };
      }
      return no(first || diagnose(B, fresh(), ids));
    }

    if (goal.type === 'button' || goal.type === 'switch') {
      const kind = goal.type === 'button' ? 'press' : 'on';
      if (!hasType(goal.type)) return no({ code: goal.type === 'button' ? 'nobutton' : 'noswitch' });
      if (!ids.length) return no(goal.part === 'buzzer' ? { code: 'nobuzzer' } : goal.part === 'motor' ? { code: 'motor' } : { code: 'noled' });
      // the button up, down, up again (the sketch running all along); a switch one way, the other, and back
      const S = fresh();
      const states = [];
      const first = goal.type === 'button' ? false : !([...B.parts.values()].find((p) => p.type === 'switch') || {}).on;
      for (const x of [first, !first, first]) {
        S.setAll(kind, x);
        const bad = useCode ? timed(S, 1200) : null;
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B);
        if (h) return no(h);
        states.push({ x, v, read: goal.pin != null ? (S.view().volt(pinName(goal.pin)) || 0) >= 2.5 : null });
      }
      const vOn = states[1].x ? states[1].v : states[0].v, vOff = states[1].x ? states[0].v : states[1].v;
      if (goal.pin != null && states[0].read === states[1].read) return no({ code: 'pinin', pin: pinLabel(goal.pin), what: goal.type });
      let cand = ids.filter((id) => isOn(states[0].v, id) === isOn(states[2].v, id) && isOn(states[0].v, id) !== isOn(states[1].v, id));
      if (goal.type === 'button') cand = cand.filter((id) => isOn(vOn, id) === (goal.when === 'pressed'));
      if (goal.led_pin != null) {
        const driven = cand.filter((id) => drivenBy(S, id, goal.led_pin));
        if (cand.length && !driven.length) return no({ code: 'pinout', pin: pinLabel(goal.led_pin) });
        cand = driven;
      }
      if (cand.length) return ok;
      const litOn = ids.some((id) => isOn(vOn, id)), litOff = ids.some((id) => isOn(vOff, id));
      if (goal.type === 'button') {
        if (goal.when === 'pressed') return no(litOff ? { code: 'btnalways' } : litOn ? { code: 'btnstuck' } : Object.assign({ when: 'pressed' }, diagnoseIn(B, ids, kind, true)));
        return no(litOn ? { code: 'btnreleased' } : !litOff ? diagnoseIn(B, ids, kind, false) : { code: 'btnstuck' });
      }
      return no(litOn || litOff ? { code: 'switchsame' } : diagnoseIn(B, ids, kind, true));
    }

    if (goal.type === 'dimmer') {
      if (!hasType(goal.by)) return no({ code: goal.by === 'pot' ? 'nopot' : 'noldr' });
      if (!ids.length) return no({ code: 'noled' });
      const kind = goal.by === 'pot' ? 'knob' : 'light';
      const steps = goal.by === 'pot' ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
      const S = fresh();
      const cur = {}; ids.forEach((id) => { cur[id] = []; });
      const reads = [];
      for (const x of steps) {
        S.setAll(kind, x);
        const bad = useCode ? timed(S, 500) : null;
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B);
        if (h) return no(Object.assign(h, { at: goal.by }));
        ids.forEach((id) => cur[id].push(v.parts[id].I));
        if (goal.pin != null) reads.push(v.volt(pinName(goal.pin)) || 0);
      }
      if (goal.pin != null && Math.max.apply(null, reads) - Math.min.apply(null, reads) < 0.5) return no({ code: 'pinin', pin: pinLabel(goal.pin), what: goal.by });
      let cand = ids.filter((id) => {
        const c = cur[id], hi = Math.max.apply(null, c), lo = Math.min.apply(null, c);
        if (goal.lit === 'dark') return c[0] >= LIT && c[c.length - 1] < LIT;
        if (goal.lit === 'bright') return c[c.length - 1] >= LIT && c[0] < LIT;
        return hi >= 2 * LIT && lo <= 0.6 * hi;
      });
      if (goal.led_pin != null) {
        const driven = cand.filter((id) => drivenBy(S, id, goal.led_pin));
        if (cand.length && !driven.length) return no({ code: 'pinout', pin: pinLabel(goal.led_pin) });
        cand = driven;
      }
      if (cand.length) return ok;
      const any = ids.some((id) => Math.max.apply(null, cur[id]) >= LIT);
      if (!any) return no(diagnoseIn(B, ids, kind, 0));
      if (goal.lit) return no({ code: goal.lit === 'dark' ? 'ldrdark' : 'ldrbright' });
      return no({ code: goal.by === 'pot' ? 'potsame' : 'ldrsame' });
    }

    if (goal.type === 'blink') {
      if (!ids.length) return no({ code: 'noled' });
      const S = session(B, { run: false });
      S.record = [];
      S.start();
      const T = Math.max(3000, 3 * (goal.on_ms + goal.off_ms) + 300);
      S.record.push({ t: 0, pins: S.pins.map((x) => Object.assign({}, x)) });
      if (!S.run(T, 4e6)) return no({ code: 'slow' });
      if (S.vm.error) return no({ code: 'sketch', error: S.vm.error });
      const rec = S.record.slice(0, 4000);
      const views = rec.map((r) => S.view({ pins: r.pins }));
      for (const v of views) { const h = health(v, B); if (h) return no(h); }
      const tol = (ms) => Math.max(60, ms * 0.1);
      let best = null;
      for (const id of ids) {
        // the LED's on and off times from when it changes
        const segs = [];
        let state = null, since = 0;
        rec.forEach((r, i) => { const on = isOn(views[i], id); if (on !== state) { if (state !== null) segs.push({ on: state, ms: (r.t - since) / 1000 }); state = on; since = r.t; } });
        const full = segs.slice(1); // the first may have started part-way
        const ons = full.filter((s) => s.on).map((s) => s.ms), offs = full.filter((s) => !s.on).map((s) => s.ms);
        if (ons.length < 2 || offs.length < 1) { if (!best) best = { code: segs.length || state ? 'noblink' : 'dark' }; continue; }
        const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
        const on = med(ons), off = med(offs);
        if (Math.abs(on - goal.on_ms) <= tol(goal.on_ms) && Math.abs(off - goal.off_ms) <= tol(goal.off_ms)) {
          const pinRec = rec.filter((r) => r.pins[goal.pin].mode === OUTPUT);
          if (!pinRec.length || !drivenBy(S, id, goal.pin)) { best = { code: 'pinout', pin: pinLabel(goal.pin) }; continue; }
          return ok;
        }
        best = { code: 'blinktime', on: Math.round(on), off: Math.round(off), won: goal.on_ms, woff: goal.off_ms };
      }
      if (best && best.code === 'dark') {
        const d = diagnose(B, S, ids);
        return no(d.code === 'dark' ? { code: 'noblink' } : d);
      }
      return no(best || { code: 'noblink' });
    }

    if (goal.type === 'serial') {
      const S = fresh();
      const bad = timed(S, 3000);
      if (bad) return no(bad);
      const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      if (norm(S.serial).includes(norm(goal.text))) return ok;
      if (S.vm && S.vm.noBegin && !S.serial) return no({ code: 'nobegin' });
      return no({ code: 'serial', text: goal.text });
    }
    return no({ code: 'dark' });
  }
  function diagnoseIn(B, ids, kind, x) {
    const S = session(B);
    if (kind && x !== 0) S.setAll(kind, x);
    if (B.program) S.run(800);
    return diagnose(B, S, ids);
  }

  /* ---------------- reference builds: a working answer for each goal ---------------- */

  function Layout(spec) {
    const used = new Set(), parts = [], wires = [], inv = inventory(spec);
    const ids = new Set();
    const L = {
      parts, wires, inv, used, failed: false,
      free(col, rows) { if (col < 1 || col > COLS) return null; for (const r of rows) { const h = r + col; if (HOLES.has(h) && !used.has(h)) return h; } return null; },
      point(name, col) {
        if (RAILS.includes(name)) { const h = RAIL_NEAR(name, col, used); if (h) used.add(h); else L.failed = true; return h; }
        return name;
      },
      wire(a, b) { if (!a || !b) { L.failed = true; return; } if (HOLES.has(a)) used.add(a); if (HOLES.has(b)) used.add(b); wires.push({ from: a, to: b, color: autoColor(a, b, wires.length) }); },
      part(type, at, props) {
        if (at.some((h) => !h)) { L.failed = true; return null; }
        const want = props && (type === 'led' ? props.color : type === 'resistor' ? props.ohms : null);
        const it = take(inv, type, want);
        if (!it) {
          L.failed = true;
          const more = parts.some((p) => p.type === type) ? 'another ' : 'a ';
          L.missing = L.missing || (type === 'resistor' ? `${more}${want ? want + ' ohm ' : ''}resistor` : type === 'led' ? `${more}${want && want !== 'any' ? want + ' ' : ''}LED` : more + type);
          return null;
        }
        let n = 1;
        while (ids.has(TYPES[type].prefix + n)) n++;
        const id = TYPES[type].prefix + n;
        ids.add(id);
        at.forEach((h) => used.add(h));
        const p = Object.assign({ id, type, at }, props || {});
        if (type === 'led' && (!p.color || p.color === 'any')) p.color = it.color && it.color !== 'any' ? it.color : 'red';
        if (type === 'pot') { p.ohms = p.ohms || 10000; p.knob = p.knob != null ? p.knob : 0.5; }
        if (type === 'ldr') p.light = p.light != null ? p.light : 0.5;
        if (type === 'switch') p.on = p.on != null ? p.on : false;
        parts.push(p);
        return p;
      },
      // a chain of parts along the lower half, from one point to another; the column it ends in
      chain(items, c0, from, to) {
        const rows = 'hgfi';
        let c = c0;
        L.wire(L.point(from, c), L.free(c, 'j'));
        const avoid = new Set();
        for (const it of items) {
          const T = TYPES[it.type];
          if (T.legs[0] === 3) {
            const row = [...rows].find((r) => [c, c + 1, c + 2].every((k) => L.free(k, r) === r + k));
            if (!row) { L.failed = true; return c; }
            L.part(it.type, [row + c, row + (c + 1), row + (c + 2)], it.props);
            avoid.add(c + 2);
            c += 1;
            continue;
          }
          let s = T.foot[1][0];
          while (avoid.has(c + s) && s < T.gap[1]) s++;
          if (c + s > COLS) { L.failed = true; return c; }
          const h1 = L.free(c, rows), h2 = L.free(c + s, rows);
          L.part(it.type, [h1, h2], it.props);
          c += s;
        }
        L.wire(L.free(c, 'j' + rows), L.point(to, c));
        return c;
      },
      build(code) { return { parts: parts.slice(), wires: wires.slice(), code: code || '' }; }
    };
    return L;
  }
  function resistorChoices(spec) {
    const inv = inventory(spec);
    const vals = new Set(inv.filter((x) => x.type === 'resistor' && x.ohms).map((x) => x.ohms));
    if (inv.some((x) => x.type === 'resistor' && !x.ohms)) STANDARD.forEach((v) => vals.add(v));
    return [...vals].sort((a, b) => Math.abs(Math.log(a / 330)) - Math.abs(Math.log(b / 330)));
  }
  const ledFor = (goal) => ({ type: 'led', props: { color: goal.color || 'any' } });

  // the sketches the reference builds run
  const SK = {
    on: (p) => `void setup() {\n  pinMode(${p}, OUTPUT);\n  digitalWrite(${p}, HIGH);\n}\n\nvoid loop() {\n}\n`,
    blink: (p, on, off) => `void setup() {\n  pinMode(${p}, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(${p}, HIGH);\n  delay(${on});\n  digitalWrite(${p}, LOW);\n  delay(${off});\n}\n`,
    follow: (inp, out, when) => `const int inputPin = ${inp};\nconst int ledPin = ${out};\n\nvoid setup() {\n  pinMode(inputPin, INPUT_PULLUP);\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {\n  // with INPUT_PULLUP, the pin reads LOW while the button is pressed or the switch is on\n  if (digitalRead(inputPin) == ${when === 'released' ? 'HIGH' : 'LOW'}) {\n    digitalWrite(ledPin, HIGH);\n  } else {\n    digitalWrite(ledPin, LOW);\n  }\n}\n`,
    dim: (a, out) => `const int sensorPin = A${a - 14};\nconst int ledPin = ${out};\n\nvoid setup() {\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {\n  int reading = analogRead(sensorPin);   // 0 to 1023\n  analogWrite(ledPin, reading / 4);      // 0 to 255\n}\n`,
    night: (a, out, dark) => `const int sensorPin = A${a - 14};\nconst int ledPin = ${out};\n\nvoid setup() {\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {\n  int light = analogRead(sensorPin);   // low in the dark, high in bright light\n  if (light ${dark ? '<' : '>'} 500) {\n    digitalWrite(ledPin, HIGH);\n  } else {\n    digitalWrite(ledPin, LOW);\n  }\n}\n`,
    serial: (text) => `void setup() {\n  Serial.begin(9600);\n  Serial.println("${text.replace(/["\\]/g, ' ')}");\n}\n\nvoid loop() {\n}\n`
  };

  const SKELETON = 'void setup() {\n  \n}\n\nvoid loop() {\n  \n}\n';

  // candidate builds for a goal, best first: functions of a resistor value -> { build, info }
  function candidates(spec, goal) {
    const out = [];
    const bat = Boolean(spec.battery);
    const power = (L) => { if (bat) { L.wire('BAT+', L.point('+B', 2)); L.wire('BAT-', L.point('-B', 3)); } else { L.wire('5V', L.point('+B', 2)); L.wire('GND', L.point('-B', 3)); } };
    const outPart = (goal) => (goal.part === 'buzzer' ? { type: 'buzzer' } : ledFor(goal));
    const t = goal.type;
    if (t === 'light' && goal.pin == null && goal.part === 'motor') {
      out.push(() => { const L = Layout(spec); L.wire(bat ? 'BAT+' : '5V', 'M+'); L.wire('M-', bat ? 'BAT-' : 'GND'); return L; });
      return out;
    }
    if (t === 'light' && goal.pin != null) {
      out.push((r) => { const L = Layout(spec); L.chain([{ type: 'resistor', props: { ohms: goal.ohms || r } }, outPart(goal)], 4, 'D' + goal.pin, 'GND'); return Object.assign(L, { code: SK.on(goal.pin) }); });
      return out;
    }
    if (t === 'light' && goal.part === 'buzzer') out.push(() => { const L = Layout(spec); power(L); L.chain([{ type: 'buzzer' }], 3, '+B', '-B'); return L; });
    if (t === 'light' || t === 'parallel') {
      const k = goal.count || 1;
      // each LED its own resistor, side by side
      out.push((r) => { const L = Layout(spec); power(L); for (let i = 0; i < k; i++) L.chain([{ type: 'resistor', props: { ohms: goal.ohms || r } }, outPart(goal)], 3 + i * 7, '+B', '-B'); return L; });
      if (k > 1 && t === 'parallel') out.push((r) => { // one resistor, the LEDs side by side after it
        const L = Layout(spec); power(L);
        L.wire(L.point('+B', 3), L.free(3, 'j'));
        L.part('resistor', [L.free(3, 'hgf'), L.free(7, 'hgf')], { ohms: r });
        for (let i = 0; i < k; i++) { const c = 9 + i * 3; L.wire(L.free(7, 'ihgf'), L.free(c, 'f')); L.part('led', [L.free(c, 'hg'), L.free(c + 1, 'hg')], { color: goal.color || 'any' }); L.wire(L.free(c + 1, 'j'), L.point('-B', c + 1)); }
        return L;
      });
      if (t === 'light' && k > 1) out.push((r) => { const L = Layout(spec); power(L); L.chain([{ type: 'resistor', props: { ohms: goal.ohms || r } }].concat(Array.from({ length: k }, () => outPart(goal))), 3, '+B', '-B'); return L; });
      return out;
    }
    if (t === 'series') {
      out.push((r) => { const L = Layout(spec); power(L); L.chain([{ type: 'resistor', props: { ohms: r } }].concat(Array.from({ length: goal.count }, () => ledFor(goal))), 3, '+B', '-B'); return L; });
      return out;
    }
    if ((t === 'button' || t === 'switch') && goal.pin == null && goal.part === 'motor') {
      const sw = t === 'button' ? { type: 'button' } : { type: 'switch', props: { on: false } };
      out.push(() => { const L = Layout(spec); power(L); const c = L.chain([sw], 3, '+B', 'M+'); L.wire('M-', L.point('-B', c)); return L; });
      return out;
    }
    if ((t === 'button' || t === 'switch') && goal.pin == null) {
      const sw = t === 'button' ? { type: 'button' } : { type: 'switch', props: { on: false } };
      if (goal.part === 'buzzer' && goal.when !== 'released') out.push(() => { const L = Layout(spec); power(L); L.chain([sw, { type: 'buzzer' }], 3, '+B', '-B'); return L; });
      if (t === 'button' && goal.when === 'released') {
        out.push((r) => { // the button beside the LED: pressing it takes the current away from the LED
          const L = Layout(spec); power(L);
          L.wire(L.point('+B', 3), L.free(3, 'j'));
          L.part('resistor', [L.free(3, 'hgf'), L.free(7, 'hgf')], { ohms: r });
          L.part(goal.part === 'buzzer' ? 'buzzer' : 'led', [L.free(7, 'hgf'), L.free(8, 'hgf')], goal.part === 'buzzer' ? {} : { color: goal.color || 'any' });
          L.wire(L.free(8, 'j'), L.point('-B', 8));
          L.part('button', [L.free(7, 'hgf'), L.free(10, 'hgf')]);
          L.wire(L.free(10, 'j'), L.point('-B', 10));
          return L;
        });
        return out;
      }
      out.push((r) => { const L = Layout(spec); power(L); L.chain([sw, { type: 'resistor', props: { ohms: r } }, outPart(goal)], 3, '+B', '-B'); return L; });
      return out;
    }
    if (t === 'button' || t === 'switch') {
      const ledPin = goal.led_pin != null ? goal.led_pin : [13, 12, 9, 8, 7].find((p) => p !== goal.pin);
      out.push((r) => {
        const L = Layout(spec);
        if (t === 'button') L.part('button', [L.free(4, 'hgf'), L.free(6, 'hgf')]);
        else L.part('switch', [L.free(4, 'h'), L.free(5, 'h'), L.free(6, 'h')], { on: false });
        if (t === 'button') { L.wire('D' + goal.pin, L.free(4, 'j')); L.wire(L.free(6, 'j'), 'GND'); }
        else { L.wire('D' + goal.pin, L.free(5, 'j')); L.wire(L.free(4, 'j'), 'GND'); }
        L.chain([{ type: 'resistor', props: { ohms: r } }, outPart(goal)], 10, 'D' + ledPin, 'GND');
        return Object.assign(L, { code: SK.follow(pinLabelC(goal.pin), ledPin, t === 'button' ? goal.when : 'pressed') });
      });
      return out;
    }
    if (t === 'dimmer' && goal.pin == null && goal.led_pin == null) {
      if (goal.by === 'pot') out.push((r) => { const L = Layout(spec); power(L); L.chain([{ type: 'pot', props: { knob: 0.5 } }, { type: 'resistor', props: { ohms: r } }, ledFor(goal)], 3, '+B', '-B'); return L; });
      else if (goal.lit === 'dark') out.push((r) => { // the LDR beside the LED: in bright light it takes the current away from the LED
        const L = Layout(spec); power(L);
        L.wire(L.point('+B', 3), L.free(3, 'j'));
        L.part('resistor', [L.free(3, 'hgf'), L.free(7, 'hgf')], { ohms: r });
        L.part('led', [L.free(7, 'hgf'), L.free(8, 'hgf')], { color: goal.color || 'any' });
        L.wire(L.free(8, 'j'), L.point('-B', 8));
        L.part('ldr', [L.free(7, 'hgf'), L.free(10, 'hgf')]);
        L.wire(L.free(10, 'j'), L.point('-B', 10));
        return L;
      });
      else out.push((r) => { const L = Layout(spec); power(L); L.chain([{ type: 'ldr' }, { type: 'resistor', props: { ohms: r } }, ledFor(goal)], 3, '+B', '-B'); return L; });
      return out;
    }
    if (t === 'dimmer') {
      const a = goal.pin != null ? goal.pin : 14;
      const ledPin = goal.led_pin != null ? goal.led_pin : 9;
      out.push((r) => {
        const L = Layout(spec);
        if (goal.by === 'pot') {
          L.part('pot', [L.free(4, 'h'), L.free(5, 'h'), L.free(6, 'h')], { knob: 0.5 });
          L.wire('5V', L.free(4, 'j')); L.wire(L.free(5, 'j'), pinName(a)); L.wire(L.free(6, 'j'), 'GND');
        } else {
          // the LDR and a fixed resistor make a voltage divider: about 10k, from what the bin has
          const div = resistorChoices(spec).filter((v) => v >= 1000 && v <= 100000).sort((x, y) => Math.abs(Math.log(x / 10000)) - Math.abs(Math.log(y / 10000)))[0];
          L.part('ldr', [L.free(3, 'h'), L.free(5, 'h')]);
          L.wire('5V', L.free(3, 'j'));
          if (!div) { L.failed = true; L.missing = 'a second resistor of about 10k (10000) for the LDR\'s voltage divider'; return L; }
          L.part('resistor', [L.free(5, 'g'), L.free(9, 'g')], { ohms: div });
          L.wire(L.free(5, 'j'), pinName(a)); L.wire(L.free(9, 'j'), 'GND');
        }
        L.chain([{ type: 'resistor', props: { ohms: r } }, ledFor(goal)], 13, 'D' + ledPin, 'GND');
        return Object.assign(L, { code: goal.lit ? SK.night(a, ledPin, goal.lit === 'dark') : SK.dim(a, ledPin) });
      });
      return out;
    }
    if (t === 'blink') {
      out.push((r) => { const L = Layout(spec); L.chain([{ type: 'resistor', props: { ohms: r } }, ledFor(goal)], 4, 'D' + goal.pin, 'GND'); return Object.assign(L, { code: SK.blink(goal.pin, goal.on_ms, goal.off_ms) }); });
      return out;
    }
    if (t === 'serial') {
      out.push(() => Object.assign(Layout(spec), { code: SK.serial(goal.text) }));
      return out;
    }
    return out;
  }
  const pinLabelC = (p) => (p < 14 ? String(p) : 'A' + (p - 14));

  // A working build for the goal from the bench's own parts (start parts and bin), proved by the simulator:
  // { build, info } or { reason } (why none works, for the AI to repair).
  function reference(spec, goal) {
    const vals = resistorChoices(spec);
    const fns = candidates(spec, goal);
    let reason = '';
    for (const make of fns) {
      for (const r of (vals.length ? vals : [0]).slice(0, 12)) {
        const L = make(r);
        if (L.failed) { reason = reason || (L.missing ? `the parts bin is missing ${L.missing} (add it to "bin")` : 'the parts do not fit on the board'); continue; }
        const usesR = L.parts.some((p) => p.type === 'resistor');
        // the starter code first, if it already does the job
        const codes = L.code ? (spec.code && spec.code.trim() ? [spec.code, L.code] : [L.code]) : [spec.code || ''];
        for (const code of codes) {
          const build = L.build(code);
          const res = evaluate(spec, goal, build);
          if (res.ok) return { build, info: { ohms: usesR ? (L.parts.find((p) => p.type === 'resistor' && p.ohms !== 10000) || L.parts.find((p) => p.type === 'resistor')).ohms : null, color: (L.parts.find((p) => p.type === 'led') || {}).color || null } };
          if (!reason && res.why) reason = whyText(res.why, spec, r);
        }
        if (!usesR) break;
      }
    }
    if (!vals.length && fns.length && ['light', 'series', 'parallel', 'button', 'switch', 'dimmer', 'blink'].includes(goal.type) && goal.part !== 'motor') {
      return { reason: 'the parts bin has no resistor, and an LED needs one in series (add "resistor": [220] to "bin")' };
    }
    return { reason: reason || 'no build from the parts bin meets the goal' };
  }
  // a check's reason in plain English (for the server and the debug log)
  function whyText(why, spec, r) {
    const ohm = r ? ` (tried ${r} ohms)` : '';
    switch (why.code) {
      case 'short': return 'it makes a short circuit';
      case 'burn': return `an LED burns out: ${why.mA} mA${ohm}; the bin needs a bigger resistor`;
      case 'pin': return `pin ${why.pin} gives ${why.mA} mA, too much${ohm}`;
      case 'few': return `only ${why.n} of ${why.want} LEDs light${ohm}: the battery may be too weak (try "9V")`;
      case 'dark': case 'reversed': case 'alone': case 'samestrip': case 'nopower': return `the LED does not light${ohm}: the battery may be too weak for this (try "9V"), or the bin lacks a part`;
      case 'notseries': return 'the LEDs are not in series';
      case 'notparallel': return 'the LEDs are not in parallel';
      case 'mA': return `the current is ${why.mA} mA, outside ${why.lo} to ${why.hi} mA, with every resistor in the bin`;
      case 'ohms': return `the ${why.ohms} ohm resistor does not carry the LED's current`;
      case 'ldrdark': case 'ldrbright': return 'no resistor in the bin makes the LDR switch the LED (try a 4.7k or 10k resistor, and the 9V battery)';
      case 'potsame': case 'ldrsame': return 'the LED\'s brightness does not change';
      case 'sketch': return 'the sketch has an error: ' + (why.error && why.error.message);
      default: return why.code;
    }
  }

  // A task: the bench and its goal, checked: the goal's parts are in the bin, some build from them meets it
  // (proved by the simulator), and the bench doesn't meet it as it starts.
  function normTask(rawSpec, rawGoal) {
    const spec = normSpec(rawSpec);
    const goal = normGoal(rawGoal, spec);
    // a goal worked through code, with no starter sketch: lighting from a pin comes with the sketch that turns
    // the pin on (the build is the task); the others start from an empty setup() and loop()
    if (needsCode(goal) && !spec.code.trim()) spec.code = goal.type === 'light' && goal.pin != null ? SK.on(goal.pin) : SKELETON;
    const ref = reference(spec, goal);
    if (!ref.build) fail('no build from the bench\'s parts meets the goal: ' + ref.reason);
    if (evaluate(spec, goal, startBuild(spec)).ok) fail('the bench already meets the goal as it starts: leave something for the learner to build or write');
    return { spec: specOut(spec), goal };
  }
  // A block: a bench to play with. If it has parts placed with something to see, some setting must make it work.
  function normBlock(raw) {
    const spec = normSpec(raw);
    const B = bench(spec, startBuild(spec));
    const outs = [...B.parts.values()].filter((p) => p.type === 'led' || p.type === 'buzzer').map((p) => p.id).concat(spec.motor && spec.wires.some((w) => /^M[+-]$/.test(w.from) || /^M[+-]$/.test(w.to)) ? ['MOTOR'] : []);
    const wired = spec.parts.length && spec.wires.length;
    if (outs.length && wired) {
      const inputs = [...B.parts.values()].filter((p) => ['button', 'switch', 'pot', 'ldr'].includes(p.type));
      const tries = [];
      const ways = [[false, 0], [true, 1], [true, 0], [false, 1]];
      ways.forEach(([pr, k]) => tries.push({ press: pr, on: pr, knob: k, light: k }));
      let works = false;
      for (const x of tries) {
        const S = session(B);
        inputs.forEach((p) => { if (p.type === 'button') S.set('press', p.id, x.press); if (p.type === 'switch') S.set('on', p.id, x.on); if (p.type === 'pot') S.set('knob', p.id, x.knob); if (p.type === 'ldr') S.set('light', p.id, x.light); });
        if (B.program) {
          S.record = [];
          S.run(2500, 2e6);
          if (S.vm && S.vm.error) fail('the starter code stops with an error: ' + S.vm.error.message);
          if (S.record.some((r) => outs.some((id) => isOn(S.view({ pins: r.pins }), id)))) { works = true; break; }
        }
        const v = S.view();
        if (outs.some((id) => isOn(v, id))) { works = true; break; }
      }
      if (!works) {
        const d = diagnose(B, session(B), outs);
        const pinWire = spec.wires.map((w) => [w.from, w.to].find((e) => PINS.includes(e))).find(Boolean);
        if (!B.program && pinWire && d.code === 'dark') fail(`the parts are wired to the Arduino's pin ${pinLabel(pinNo(pinWire))}, but there is no "code" to turn that pin on: add a sketch with pinMode(${pinLabel(pinNo(pinWire))}, OUTPUT); and digitalWrite(${pinLabel(pinNo(pinWire))}, HIGH);`);
        fail(blockWhy(d, B));
      }
    }
    // a sketch that works output pins none of which is wired does nothing to see
    if (B.program) {
      const S = session(B, { run: false });
      S.record = [];
      S.start();
      S.run(2500, 2e6);
      const outPins = new Set();
      S.record.forEach((r) => r.pins.forEach((ps, p) => { if (ps.mode === OUTPUT) outPins.add(p); }));
      const wired = (p) => (B.attach.get(B.pts.get(pinName(p))) || 0) > 0;
      if (outPins.size && ![...outPins].some(wired)) {
        const p = [...outPins][0];
        fail(`the sketch works pin ${pinLabel(p)}, but nothing on the bench is wired to it: wire the LED's resistor to "${pinName(p)}" (not to "5V")`);
      }
    }
    return specOut(spec);
  }
  function blockWhy(d, B) {
    const where = (id) => { const p = B.parts.get(id); return p ? `${id} (${p.at.join(', ')})` : id; };
    switch (d.code) {
      case 'samestrip': return `${where(d.name)} has two legs in one strip, so no current goes through it: put its legs in different columns`;
      case 'alone': {
        // what sits straight across the centre gap, which does not join
        const h = HOLES.get(d.hole);
        const other = /^[UD]/.test(h.strip) ? (h.strip[0] === 'U' ? 'D' : 'U') + h.col : null;
        const p2 = other && [...B.parts.values()].find((p) => p.id !== d.name && p.at.some((x) => HOLES.get(x).strip === other));
        if (p2) return `${d.name}'s leg in ${d.hole} and ${p2.id}'s leg in ${p2.at.find((x) => HOLES.get(x).strip === other)} are on opposite sides of the centre gap, which does not join them: put both in rows a-e, or both in f-j, of column ${h.col}`;
        return `${d.name}'s leg in ${d.hole} is in a strip with nothing else in it, so the circuit is broken there: join that strip to the next part (same column and half) or with a wire`;
      }
      case 'wirealone': return `a wire ends in ${d.hole}, a strip with nothing else in it: move that end next to the part it should reach`;
      case 'reversed': return `${where(d.name)} is the wrong way round: "at" lists the anode (+) first, and the anode must face the + side`;
      case 'nopower': return 'nothing is wired to the battery\'s BAT+ and BAT- (or the Arduino\'s pins): add wires from them to the rails or holes';
      default: return 'nothing ever lights or sounds, whatever the learner does: check that there is a whole loop from + through each part back to -';
    }
  }

  // the learner's attempt, checked: { correct, invalid?, why? }
  function check(spec, goal, value) {
    const build = normBuild(value, spec);
    if (!build) return { correct: false, invalid: true, why: { code: 'unreadable' } };
    if (!build.parts.length && !build.wires.length && !needsCode(goal)) return { correct: false, invalid: true, why: { code: 'empty' } };
    const r = evaluate(spec, goal, build);
    return { correct: r.ok, invalid: Boolean(r.invalid), why: r.why || null };
  }

  return {
    COLS, ROWS, ROW_Y, RAIL_Y, RAILS, RAIL_COLS, HOLES, holeAt, PINS, PWM, POWER, BAT, MOTOR, DIGITAL, ANALOG, pinNo, pinName, isTerm, termsOf,
    LEDS, LED_COLORS, TYPES, PART_TYPES, WIRE_COLORS, STANDARD, LIT, BURN, BATTERIES, BAND_NAMES,
    BBError, SketchError, SKETCH_MSG, INPUT, OUTPUT, PULLUP,
    parsePoint, parseOhms, sig2, bands, fmtOhms, mA, ldrOhms,
    normSpec, specOut, normBlock, normGoal, normTask, normBuild, startBuild, inventory, take, binItems, binOut,
    bench, session, view, compile, makeVM, advance, lex, parse,
    evaluate, check, reference, diagnose, needsCode, outputsOf, health, whyText, blockWhy, isOn
  };
});
