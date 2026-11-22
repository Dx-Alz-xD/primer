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
   "M-"), an Arduino Uno (D0-D13, A0-A5, 5V, 3V3, GND, VIN), and the
   modules placed beside it, each with its own pins ("SV1.SIG").

   A bench (the "spec"), after normSpec:
     battery   "9V" | "3V" (two AA cells) | null
     arduino   true | false          motor   true | false
     bin       { led: ["red", "any"], resistor: [220, "any"], capacitor: [0.1],
                 electrolytic: [100], seg7: ["cathode"], button: 1, ... }
               what is left to place ("any": the learner picks the colour or value)
     parts     [{ id, type, at: [holes], ...props }]
       on the board (legs in holes; "at" may give the first leg's hole alone,
       and the rest follow the part's footprint, turned by "rot" 0-3):
         led [anode, cathode] color; resistor ohms; button (press and hold);
         switch [first, middle, last]: on joins middle and first;
         pot [end, wiper, end] ohms, knob 0-1; ldr light 0-1; buzzer [+, -];
         npn [E, B, C]; mosfet [G, D, S]; diode and zener [anode, cathode] (volts);
         capacitor uf; electrolytic [+, -] uf; tmp36 [+Vs, Vout, GND] temp (°C);
         rgb [R, common cathode, G, B]; seg7 (10 pins: g f COM a b along the top,
         e d COM c dp six rows below) common "cathode" | "anode"
       beside the board (no holes; wires go to "<id>.<pin>"):
         servo GND VCC SIG; sonar (HC-SR04) VCC TRIG ECHO GND, cm;
         lcd (16x2, I2C) GND VCC SDA SCL; relay IN VCC GND COM NO NC;
         pir VCC OUT GND, motion; dht11 VCC DATA GND, temp, hum
     wires     [{ from, to, color }]   holes, rail holes or terminals
     code      the starter sketch (Arduino C), or ''
     hide_values   true: the bin shows resistors by their bands only
   A task's goal, after normGoal: { type, ... }
     light     count, color?, part? (led|buzzer|motor), ohms?, mA? [lo, hi], pin?
               (the motor from a pin: through a transistor or relay; flyback?)
     series    count     LEDs in series, all lit
     parallel  count     LEDs in parallel, all lit
     button    when (pressed|released), pin?, led_pin?
     switch    pin?, led_pin?
     dimmer    by (pot|ldr), lit? (dark|bright), pin?, led_pin?
     blink     pin, on_ms, off_ms
     serial    text
     servo     angle | sweep (true, or [low, high])
     display   digit (the 7-segment display)       lcd   text
     distance  cm, part? (led|buzzer): on while something is nearer than cm
     temperature  above (°C), part? (motor|led), by? (tmp36|dht11)
     fade      by (switch|button), ms: still lit ms after the switch opens
   The learner's attempt ("value") is their whole build:
     { parts: [...], wires: [...], code }   (ids and holes their own)

   The simulation: the strips, wires and closed switches join holes into
   nets; resistors, the pot, the LDR and the motor are conductances; the
   battery, the Arduino's 5V and 3V3 and its output pins are sources with
   an inner resistance (so a short circuit is a big current, not a
   division by zero); an LED, the buzzer and a diode are piecewise-linear
   diodes, settled by iterating; an NPN transistor (Ebers-Moll, with its
   beta: cut off, active or saturated) and a MOSFET are solved by Newton
   iterations, with the junction steps limited as SPICE does; every net
   has a tiny leak to ground so nothing floats. Solved by nodal analysis
   with Gaussian elimination. A PWM pin is solved high and low, and the
   results averaged by its duty. A capacitor is a backward-Euler
   companion (its voltage behind dt/C), stepped through the simulated
   time the sketch runs on, so it charges, discharges and debounces.

   The sketch: an Arduino C subset (setup and loop, int long float bool
   byte char const unsigned String, arrays, if else for while do switch,
   functions, #define, #include of the libraries the bench has: Servo,
   Wire, LiquidCrystal_I2C, DHT), compiled to closures and generators (no
   eval): delay() moves simulated time on, and the run pauses at any
   statement, so the page stays responsive and a check can run seconds of
   it at once. Interrupts on pins 2 and 3 run between statements.
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
  // a capacitance in microfarads: 100, "100uF", "100 µF", "0.1uF", "100nF", "100n", "22pF", "1mF"
  function parseFarads(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string' || v.length > 30) return NaN;
    const s = v.trim().replace(/\s+/g, '').replace(/farads?$/i, 'f').replace(/[µμ]/g, 'u');
    const m = /^(\d+(?:\.\d+)?|\.\d+)([munp]?)f?$/i.exec(s);
    if (!m) return NaN;
    return Number(m[1]) * ({ m: 1000, u: 1, n: 1e-3, p: 1e-6 })[(m[2] || 'u').toLowerCase()];
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
  const MODPIN = /^[A-Za-z][A-Za-z0-9_]{0,7}\.[A-Z]{2,4}$/; // a module's pin: "SV1.SIG"
  const isTerm = (name) => BAT.includes(name) || MOTOR.includes(name) || POWER.includes(name) || PINS.includes(name) || MODPIN.test(name);
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
    if (low === 'sda') return { term: 'A4' };
    if (low === 'scl') return { term: 'A5' };
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
  const DIODE = { vf: 0.65, rs: 0.4 };               // a 1N4007: about 0.7 V at 10 mA, 1 V at 1 A
  const ZENER = { vf: 0.65, rs: 1, rz: 5 };
  const RGB_VF = { r: 1.8, g: 2.8, b: 2.8 };
  const ESR = { capacitor: 0.05, electrolytic: 0.2 };
  const MOTOR_R = 30;
  const R_PIN = 25, R_PULLUP = 20000, R_5V = 0.1, R_3V3 = 0.5;
  const BATTERIES = { '9V': { v: 9, r: 1.5 }, '3V': { v: 3, r: 0.3 } };
  const LIT = 0.001;           // an LED is lit from 1 mA
  const FULL = 0.018;          // fully bright
  const BURN = 0.035;          // and burns out above about 30 mA (on average), or twice it at a peak
  const Q_MAX = 0.8, QB_MAX = 0.15; // an NPN's most collector and base current (a 2N2222), amps
  const WIRE_COLORS = ['red', 'black', 'blue', 'green', 'yellow', 'orange', 'white', 'purple'];
  const STANDARD = [10, 22, 47, 100, 150, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 22000, 47000, 100000, 1000000];
  const CAP_STANDARD = [0.01, 0.1, 1, 10, 47, 100, 220, 470, 1000, 2200];  // microfarads
  // the 7-segment display's segments, and the digits as they light them (with the other ways some write 6, 7 and 9)
  const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
  const DIGITS = { 0: ['abcdef'], 1: ['bc'], 2: ['abdeg'], 3: ['abcdg'], 4: ['bcfg'], 5: ['acdfg'], 6: ['acdefg', 'cdefg'], 7: ['abc', 'abcf'], 8: ['abcdefg'], 9: ['abcdfg', 'abcfg'] };

  // legs: how many; gap: how far apart each leg is from the next (holes); foot: where the legs go from the
  // first, as placed (turned by rot); rigid: the legs can't bend, so they sit as the foot says; fixed: and it
  // doesn't turn; dock: a module beside the board, with pins that wires go to; pins: what its legs are called
  const TYPES = {
    resistor: { legs: [2], gap: [1, 10], foot: [[0, 0], [4, 0]], prefix: 'R' },
    led: { legs: [2], gap: [1, 3], foot: [[0, 0], [1, 0]], prefix: 'L', pins: ['+', '−'] },
    button: { legs: [2], gap: [1, 4], foot: [[0, 0], [2, 0]], prefix: 'BTN' },
    switch: { legs: [3, 2], gap: [1, 2], foot: [[0, 0], [1, 0], [2, 0]], prefix: 'SW' },
    pot: { legs: [3], gap: [1, 2], foot: [[0, 0], [1, 0], [2, 0]], prefix: 'POT' },
    ldr: { legs: [2], gap: [1, 4], foot: [[0, 0], [2, 0]], prefix: 'LDR' },
    buzzer: { legs: [2], gap: [1, 4], foot: [[0, 0], [2, 0]], prefix: 'BZ', pins: ['+', '−'] },
    npn: { legs: [3], gap: [1, 2], foot: [[0, 0], [1, 0], [2, 0]], prefix: 'Q', pins: ['E', 'B', 'C'] },
    mosfet: { legs: [3], gap: [1, 2], foot: [[0, 0], [1, 0], [2, 0]], prefix: 'Q', pins: ['G', 'D', 'S'] },
    diode: { legs: [2], gap: [1, 8], foot: [[0, 0], [4, 0]], prefix: 'D', pins: ['A', 'K'] },
    zener: { legs: [2], gap: [1, 8], foot: [[0, 0], [4, 0]], prefix: 'ZD', pins: ['A', 'K'] },
    capacitor: { legs: [2], gap: [1, 4], foot: [[0, 0], [2, 0]], prefix: 'C' },
    electrolytic: { legs: [2], gap: [1, 3], foot: [[0, 0], [1, 0]], prefix: 'C', pins: ['+', '−'] },
    tmp36: { legs: [3], gap: [1, 2], foot: [[0, 0], [1, 0], [2, 0]], prefix: 'TMP', pins: ['+Vs', 'Vout', 'GND'] },
    rgb: { legs: [4], rigid: true, foot: [[0, 0], [1, 0], [2, 0], [3, 0]], prefix: 'RGB', pins: ['R', '−', 'G', 'B'] },
    seg7: { legs: [10], rigid: true, fixed: true, foot: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 6], [1, 6], [2, 6], [3, 6], [4, 6]], prefix: 'DSP', pins: ['g', 'f', 'COM', 'a', 'b', 'e', 'd', 'COM', 'c', 'dp'] },
    servo: { dock: true, prefix: 'SV', pins: ['GND', 'VCC', 'SIG'] },
    sonar: { dock: true, prefix: 'US', pins: ['VCC', 'TRIG', 'ECHO', 'GND'] },
    lcd: { dock: true, prefix: 'LCD', pins: ['GND', 'VCC', 'SDA', 'SCL'] },
    relay: { dock: true, prefix: 'RLY', pins: ['IN', 'VCC', 'GND', 'COM', 'NO', 'NC'] },
    pir: { dock: true, prefix: 'PIR', pins: ['VCC', 'OUT', 'GND'] },
    dht11: { dock: true, prefix: 'DHT', pins: ['VCC', 'DATA', 'GND'] }
  };
  const PART_TYPES = Object.keys(TYPES);
  const DOCK_TYPES = PART_TYPES.filter((t) => TYPES[t].dock);
  // the parts that come in kinds: the kind's field ('any', or 0, lets the learner pick)
  const VARIANT = { led: 'color', resistor: 'ohms', capacitor: 'uf', electrolytic: 'uf', seg7: 'common' };
  const SEG7_SEG = { g: 0, f: 1, a: 3, b: 4, e: 5, d: 6, c: 8, dp: 9 }; // each segment's leg
  const ALIASES = {
    res: 'resistor', resistors: 'resistor', r: 'resistor',
    leds: 'led', 'light emitting diode': 'led', 'light-emitting diode': 'led', lamp: 'led',
    pushbutton: 'button', 'push button': 'button', 'push-button': 'button', buttons: 'button', tactile: 'button', 'tactile switch': 'button', 'momentary switch': 'button', 'push switch': 'button',
    'slide switch': 'switch', slideswitch: 'switch', toggle: 'switch', 'toggle switch': 'switch', switches: 'switch', spdt: 'switch',
    potentiometer: 'pot', knob: 'pot', 'variable resistor': 'pot', trimmer: 'pot', pots: 'pot', rheostat: 'pot',
    photoresistor: 'ldr', 'light sensor': 'ldr', 'light dependent resistor': 'ldr', 'light-dependent resistor': 'ldr', photocell: 'ldr', ldrs: 'ldr',
    piezo: 'buzzer', beeper: 'buzzer', buzzers: 'buzzer', 'piezo buzzer': 'buzzer',
    transistor: 'npn', transistors: 'npn', 'npn transistor': 'npn', bjt: 'npn', '2n2222': 'npn', '2n2222a': 'npn', pn2222: 'npn', bc547: 'npn', '2n3904': 'npn', tip120: 'npn',
    'n-channel mosfet': 'mosfet', 'n channel mosfet': 'mosfet', nmos: 'mosfet', irf540: 'mosfet', irf540n: 'mosfet', irfz44n: 'mosfet', irlz44n: 'mosfet', mosfets: 'mosfet', fet: 'mosfet',
    diodes: 'diode', rectifier: 'diode', 'rectifier diode': 'diode', '1n4007': 'diode', '1n4001': 'diode', '1n4148': 'diode', 'flyback diode': 'diode',
    'zener diode': 'zener', zeners: 'zener',
    capacitors: 'capacitor', cap: 'capacitor', 'ceramic capacitor': 'capacitor', ceramic: 'capacitor', 'ceramic cap': 'capacitor',
    'electrolytic capacitor': 'electrolytic', 'polarized capacitor': 'electrolytic', 'polarised capacitor': 'electrolytic', 'electrolytic cap': 'electrolytic',
    'temperature sensor': 'tmp36', 'temp sensor': 'tmp36', 'tmp 36': 'tmp36', thermometer: 'tmp36',
    'rgb led': 'rgb', rgbled: 'rgb', 'rgb leds': 'rgb',
    '7seg': 'seg7', '7-segment': 'seg7', '7 segment': 'seg7', '7-segment display': 'seg7', '7 segment display': 'seg7', 'seven segment': 'seg7', 'seven-segment': 'seg7', 'seven segment display': 'seg7', 'seven-segment display': 'seg7', segment: 'seg7',
    servos: 'servo', sg90: 'servo', 'micro servo': 'servo', 'servo motor': 'servo', 'sg90 servo': 'servo',
    ultrasonic: 'sonar', 'ultrasonic sensor': 'sonar', 'hc-sr04': 'sonar', hcsr04: 'sonar', 'hc sr04': 'sonar', 'distance sensor': 'sonar', 'ultrasonic distance sensor': 'sonar',
    'lcd 16x2': 'lcd', '16x2 lcd': 'lcd', 'i2c lcd': 'lcd', 'lcd i2c': 'lcd', lcd1602: 'lcd', 'lcd display': 'lcd', liquidcrystal: 'lcd', 'liquidcrystal i2c': 'lcd',
    relays: 'relay', 'relay module': 'relay', '5v relay': 'relay',
    'pir sensor': 'pir', 'motion sensor': 'pir', 'hc-sr501': 'pir', 'pir motion sensor': 'pir',
    dht: 'dht11', 'dht11 sensor': 'dht11', 'dht-11': 'dht11', 'humidity sensor': 'dht11', dht22: 'dht11'
  };
  const FIXTURES = { battery: 'battery', batteries: 'battery', cell: 'battery', cells: 'battery', arduino: 'arduino', uno: 'arduino', 'arduino uno': 'arduino', motor: 'motor', 'dc motor': 'motor', motors: 'motor', fan: 'motor', wire: 'wire', wires: 'wire', jumper: 'wire', jumpers: 'wire', 'jumper wires': 'wire', breadboard: 'wire' };
  const PART_LIST = 'led, resistor, button, switch, pot, ldr, buzzer, npn, mosfet, diode, zener, capacitor, electrolytic, tmp36, rgb, seg7, servo, sonar, lcd, relay, pir, dht11';
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
  function fmtFarads(uf) { return uf >= 1 ? sig(uf) + ' µF' : uf >= 0.001 ? sig(uf * 1000) + ' nF' : sig(uf * 1e6) + ' pF'; }
  const mA = (i) => (Math.abs(i) >= 0.01 ? Math.round(Math.abs(i) * 1000) : round(Math.abs(i) * 1000, 2));

  // a module's pins, by the names people give them
  const PIN_WORDS = {
    servo: { GND: ['gnd', 'ground', 'brown', 'black', '-', 'v-'], VCC: ['vcc', '5v', '+', 'red', 'v+', 'power', 'pwr', 'vin'], SIG: ['sig', 'signal', 'pwm', 'orange', 'yellow', 's', 'data', 'in', 'control', 'ctrl', 'pulse'] },
    sonar: { VCC: ['vcc', '5v', '+', 'power'], TRIG: ['trig', 'trigger', 'trg', 't'], ECHO: ['echo', 'e'], GND: ['gnd', 'ground', '-'] },
    lcd: { GND: ['gnd', 'ground', '-'], VCC: ['vcc', '5v', '+', 'power', 'vdd'], SDA: ['sda', 'data'], SCL: ['scl', 'clock', 'clk', 'sck'] },
    relay: { IN: ['in', 'in1', 'sig', 'signal', 's', 'input', 'ctrl', 'control'], VCC: ['vcc', '5v', '+', 'dc+'], GND: ['gnd', '-', 'dc-', 'ground'], COM: ['com', 'common', 'c'], NO: ['no', 'normallyopen', 'n.o.'], NC: ['nc', 'normallyclosed', 'n.c.'] },
    pir: { VCC: ['vcc', '5v', '+', 'power'], OUT: ['out', 'output', 'sig', 'signal', 'data', 's'], GND: ['gnd', '-', 'ground'] },
    dht11: { VCC: ['vcc', '5v', '+', 'power'], DATA: ['data', 'out', 'sig', 'signal', 's', 'dat'], GND: ['gnd', '-', 'ground'] }
  };
  // a board part's legs, by name: a wire to "Q1.B" goes into the strip of Q1's base
  const POLES = { '+': ['+', 'anode', 'a', 'plus', 'positive', 'long'], '−': ['-', '−', 'cathode', 'k', 'minus', 'negative', 'short'] };
  const LEG_WORDS = {
    npn: { E: ['e', 'emitter'], B: ['b', 'base'], C: ['c', 'collector'] },
    mosfet: { G: ['g', 'gate'], D: ['d', 'drain'], S: ['s', 'source'] },
    tmp36: { '+Vs': ['vs', '+vs', 'v+', 'vcc', '5v', '+', 'vin', 'power'], Vout: ['vout', 'out', 'signal', 'sig', 'v', 'output'], GND: ['gnd', '-', 'ground'] },
    diode: { A: ['a', 'anode', '+'], K: ['k', 'cathode', 'c', '-'] },
    zener: { A: ['a', 'anode', '+'], K: ['k', 'cathode', 'c', '-'] },
    led: POLES, buzzer: POLES, electrolytic: POLES,
    rgb: { R: ['r', 'red'], '−': ['-', '−', 'common', 'cathode', 'k', 'gnd', 'com'], G: ['g', 'green'], B: ['b', 'blue'] },
    seg7: { g: ['g'], f: ['f'], COM: ['com', 'common', 'gnd', 'cc', 'ca'], a: ['a'], b: ['b'], e: ['e'], d: ['d'], c: ['c'], dp: ['dp', '.', 'dot'] }
  };
  function pinOf(type, word) {
    const w = String(word).trim().toLowerCase().replace(/[\s_]+/g, '');
    const m = PIN_WORDS[type] || LEG_WORDS[type];
    if (!m) return null;
    for (const k of Object.keys(m)) if (k.toLowerCase() === w) return k;
    for (const k of Object.keys(m)) if (m[k].includes(w)) return k;
    return null;
  }
  // "SV1.SIG", "sv1:signal", "servo.SIG" (the only servo, or "servo2" the second) -> "SV1.SIG"; null if it isn't one
  function modPin(v, ctx, what) {
    if (typeof v !== 'string' || !ctx.mods || v.length > 32) return null;
    const m = /^\s*([A-Za-z][A-Za-z0-9_ -]{0,20}?)\s*[.:]\s*([A-Za-z0-9+ ._-]{1,16})\s*$/.exec(v);
    const bare = !m && /^\s*([A-Za-z][A-Za-z0-9_]{0,7})\s*$/.exec(v);
    const word = m ? m[1] : bare ? bare[1] : null;
    if (!word) return null;
    // a leg of a part on the board: its hole (the wire then goes in a free hole of that strip)
    const part = m && ctx.board && ctx.board.get(word.toLowerCase());
    if (part) {
      const leg = pinOf(part.type, m[2]);
      if (!leg) fail(`${what} goes to ${part.id}.${show(m[2])}, but a ${part.type}'s legs are ${TYPES[part.type].pins.join(', ')}`);
      return part.at[TYPES[part.type].pins.indexOf(leg)];
    }
    let mod = ctx.mods.get(word.toLowerCase());
    if (!mod) {
      const k = /^(.*?)\s*(\d*)$/.exec(word);
      // a type ("servo2") or a module's usual id ("US1") for a part not placed
      const t = typeOf(k[1]) || (m && DOCK_TYPES.find((x) => TYPES[x].prefix.toLowerCase() === k[1].toLowerCase())) || '';
      if (!TYPES[t] || !TYPES[t].dock) return null;
      const all = [...ctx.mods.values()].filter((x) => x.type === t);
      mod = k[2] && typeOf(k[1]) ? all[Number(k[2]) - 1] : all.length === 1 && typeOf(k[1]) ? all[0] : null;
      if (!mod) {
        if (all.length && !typeOf(k[1])) fail(`${what} goes to "${show(v)}", but no part is called ${show(word)}: the ${t} here is ${all.map((x) => x.id).join(', ')}`);
        if (!all.length) fail(`${what} goes to a ${t} ("${show(v)}"), but there is none: put it in "parts", like {"id": "${typeOf(k[1]) ? TYPES[t].prefix + '1' : show(word)}", "type": "${t}"}`);
        fail(`${what} goes to "${show(v)}", but there are ${all.length} of them: name one by its id, like "${all[0].id}.${TYPES[t].pins[0]}"`);
      }
    }
    if (!m) fail(`${what} goes to ${mod.id}: name the pin too, like "${mod.id}.${TYPES[mod.type].pins[0]}" (its pins are ${TYPES[mod.type].pins.join(', ')})`);
    const pin = pinOf(mod.type, m[2]);
    if (!pin) fail(`${what} goes to ${mod.id}.${show(m[2])}, but a ${mod.type}'s pins are ${TYPES[mod.type].pins.join(', ')}`);
    return mod.id + '.' + pin;
  }

  /* ---------------- the bench: spec, build, inventory ---------------- */

  const LIMIT = { parts: 20, wires: 40, bin: 30, perType: 10, dock: 4, code: 4000 };

  const isAnyV = (v) => v == null || v === 'any' || v === 0;
  // a part's kind as the bin knows it ('any' when the learner picks)
  function variantIn(type, raw, id) {
    const what = id || `the bin's ${type}`;
    if (type === 'led') {
      const c = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!c || c === 'any') return 'any';
      if (!LEDS[c]) fail(`${what} is a "${show(raw)}" LED: LEDs are red, green, yellow, blue or white`);
      return c;
    }
    if (type === 'resistor') {
      if (isAnyV(raw)) return 0;
      const v = parseOhms(raw);
      if (!(v >= 1 && v <= 1e6)) fail(`${what}'s resistor value "${show(raw)}" is not 1 to 1000000 ohms`);
      return sig2(v);
    }
    if (type === 'capacitor' || type === 'electrolytic') {
      if (isAnyV(raw)) return 0;
      const v = parseFarads(raw);
      if (!(v >= 1e-5 && v <= 10000)) fail(`${what}'s capacitor value "${show(raw)}" is not 10 pF to 10000 µF (give microfarads, like 100 or "0.1uF")`);
      return round(v, 3);
    }
    if (type === 'seg7') return /^(?:anode|ca|common anode|\+)$/i.test(String(raw == null ? '' : raw).trim()) ? 'anode' : 'cathode';
    return undefined;
  }
  const itemOf = (p) => { const k = VARIANT[p.type]; const o = { type: p.type }; if (k) o[k] = p[k] != null ? p[k] : (p.type === 'led' ? 'any' : p.type === 'seg7' ? 'cathode' : 0); return o; };
  const variantOf = (p) => (VARIANT[p.type] ? p[VARIANT[p.type]] : null);

  // the parts bin: [{ type, color }] for LEDs, [{ type, ohms }] for resistors, [{ type, uf }] for capacitors
  // (0 or 'any': the learner picks), [{ type, common }] for the 7-segment display
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
      const k = VARIANT[t];
      if (!k) return { type: t };
      return { type: t, [k]: variantIn(t, variant) };
    };
    const isCap = (t) => t === 'capacitor' || t === 'electrolytic';
    if (raw == null) return out;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === 'string') { const [t, v] = x.split(':'); if (TYPES[typeOf(t)]) add(t, v); else if (!FIXTURES[typeOf(t)]) fail(`the bin has an unknown part "${show(t)}"`); }
        else if (isObj(x)) { const t = typeOf(pick(x, ['type', 'kind', 'part'])); if (TYPES[t]) add(t, pick(x, ['color', 'colour', 'ohms', 'uf', 'value', 'common']), pick(x, ['count', 'n'])); else if (!FIXTURES[t]) fail(`the bin has an unknown part "${show(x.type)}"`); }
      }
    } else if (isObj(raw)) {
      for (const k of Object.keys(raw)) {
        const t = typeOf(k);
        const v = raw[k];
        if (!TYPES[t]) { if (FIXTURES[t]) continue; fail(`the bin has an unknown part "${show(k)}" (use ${PART_LIST})`); }
        if (Array.isArray(v)) { if (VARIANT[t]) v.forEach((x) => add(t, x)); else add(t, null, v.length); }
        else if (isObj(v)) Object.keys(v).forEach((x) => add(t, x, v[x]));
        else if (v === true) add(t, null, 1);
        else if (v === false || v == null) continue;
        else if (VARIANT[t] && typeof v === 'string' && !/^\d+$/.test(v.trim())) add(t, v);
        else if (isCap(t) && typeof v === 'number' && v > LIMIT.perType) add(t, v); // "electrolytic": 1000 is a value
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
      const k = VARIANT[it.type];
      if (k) (o[it.type] = o[it.type] || []).push(isAnyV(it[k]) ? 'any' : it[k]);
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
  // a footprint turned a quarter at a time
  const turn = (foot, rot) => foot.map(([x, y]) => { for (let k = 0; k < rot; k++) { const nx = -y; y = x; x = nx; } return [x, y]; });
  const rotOf = (p) => {
    const r = pick(p, ['rot', 'rotate', 'rotation', 'turn']);
    const n = parseNum(r);
    if (!Number.isFinite(n)) return 0;
    return ((Math.round(n >= 4 ? n / 90 : n) % 4) + 4) % 4;
  };

  // one part, checked; ctx: { used: Map hole -> owner, arduino, learner, ids: Set, mods: Map }
  function normPart(p, ctx, index) {
    if (!isObj(p)) fail('a part is not an object');
    const type = typeOf(pick(p, ['type', 'kind', 'part']));
    if (!TYPES[type]) fail(`unknown part type "${show(pick(p, ['type', 'kind', 'part']))}" (${PART_LIST})`);
    const T = TYPES[type];
    let id = typeof p.id === 'string' ? p.id.trim() : '';
    if (!ID.test(id) || ctx.ids.has(id)) {
      if (id && !ctx.learner) fail(ID.test(id) ? `two parts are called ${id}` : `part id "${show(id)}" should be short, like L1 or R2`);
      let n = 1;
      while (ctx.ids.has(T.prefix + n)) n++;
      id = T.prefix + n;
    }
    ctx.ids.add(id);
    if (T.dock) return dockPart(p, ctx, id, type);
    let raw = pick(p, ['at', 'legs', 'pins', 'holes', 'holes_at', 'hole']);
    if (!Array.isArray(raw)) {
      if (type === 'led' && (p.anode != null || p.cathode != null)) raw = [p.anode, p.cathode];
      else if (p.from != null || p.to != null) raw = [p.from, p.to];
      else if (typeof raw === 'string') raw = raw.split(/[\s,]+/).filter(Boolean);
      else fail(`${id} has no "at": the holes its legs go in, like ${T.rigid ? `"a5" (its first leg; the rest follow in a row)` : '["a5", "a9"]'}`);
    }
    const legs = T.legs[0];
    // the first leg's hole alone: the rest follow the part's footprint
    if (raw.length === 1 && legs > 1) {
      const q = parsePoint(raw[0], ctx.arduino);
      if (!q || !q.hole) fail(`${id}'s "at" "${show(raw[0])}" is not a breadboard hole (a1 to j30)`);
      const h0 = HOLES.get(q.hole);
      const at = turn(T.foot, T.fixed ? 0 : rotOf(p)).map(([dx, dy]) => holeAt(h0.x + dx, h0.y + dy));
      if (at.some((h) => !h || !/^[UD]/.test(HOLES.get(h).strip))) fail(`${id} doesn't fit with its first leg in ${q.hole}: its other legs would land off the board${type === 'seg7' ? ' (the display\'s top pins go in row a to e, like "c10"; the bottom ones six rows below)' : ''}`);
      raw = at;
    }
    if (!T.legs.includes(raw.length)) fail(`${id} is a ${type} with ${legs} legs, but "at" lists ${raw.length} holes`);
    const pts = raw.map((v) => parsePoint(v, ctx.arduino));
    pts.forEach((q, i) => {
      if (!q) fail(`${id}'s leg "${show(raw[i])}" is not a hole (holes are a1 to j30, or a rail: +T, -T, +B, -B)`);
      if (q.term) fail(`${id}'s leg is on ${q.term}: legs go in breadboard holes; join a hole to ${q.term} with a wire`);
      if (q.rail && T.rigid) fail(`${id}'s legs go in the board's holes (a1 to j30), not a rail`);
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
    const H = at.map((h) => HOLES.get(h));
    if (T.rigid) {
      // its legs sit as the part has them, turned any way (or not at all)
      const offs = H.map((h) => [h.x - H[0].x, h.y - H[0].y]).join(';');
      const fits = (T.fixed ? [0] : [0, 1, 2, 3]).some((r) => turn(T.foot, r).join(';') === offs);
      if (!fits) fail(`${id}'s legs (${at.join(', ')}) don't sit as a ${type}'s do: give its first leg's hole alone, like "at": "${type === 'seg7' ? 'c10' : 'h10'}", and the rest follow`);
    } else {
      // the legs' spacing: as far apart as the part's legs reach; three legs in a straight row
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
    if (LEG_WORDS[type] && ctx.board) ctx.board.set(id.toLowerCase(), out);
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
    if (type === 'capacitor' || type === 'electrolytic') {
      const raw2 = pick(p, ['uf', 'uF', 'value', 'capacitance', 'farads', 'c']);
      const v = raw2 == null ? (type === 'capacitor' ? 0.1 : 100) : variantIn(type, raw2, id);
      if (!v) fail(`${id} needs "uf": its value in microfarads (like 100, or 0.1)`);
      out.uf = v;
    }
    if (type === 'zener') {
      const v = parseNum(pick(p, ['volts', 'vz', 'voltage', 'v']));
      out.volts = Number.isFinite(v) ? round(clamp(v, 2.4, 15), 3) : 5.1;
    }
    if (type === 'seg7') out.common = variantIn('seg7', pick(p, ['common', 'variant', 'kind_of']));
    if (type === 'tmp36') out.temp = numIn(p, ['temp', 'temperature', 'celsius'], 25, -40, 125);
    return out;
  }
  const numIn = (p, keys, dflt, lo, hi) => { const v = parseNum(pick(p, keys)); return Number.isFinite(v) ? round(clamp(v, lo, hi), 4) : dflt; };
  // a module beside the board: no holes; its pins become terminals
  function dockPart(p, ctx, id, type) {
    const out = { id, type, at: [] };
    // written with "at": its header plugged into the breadboard, a pin to a hole (it becomes wires from its pins)
    let raw = pick(p, ['at', 'holes', 'hole']);
    if (typeof raw === 'string') raw = raw.split(/[\s,]+/).filter(Boolean);
    const pins = TYPES[type].pins;
    if (Array.isArray(raw) && raw.length && !ctx.learner) {
      const pts = raw.map((v) => parsePoint(v, ctx.arduino));
      if (pts.some((q) => !q || !q.hole || !/^[UD]/.test(HOLES.get(q.hole).strip))) fail(`${id} sits beside the board, wired by its pins (like "${id}.${pins[0]}"); to plug it into the board, give "at" the hole of its first pin, like "a10"`);
      let holes = pts.map((q) => q.hole);
      if (holes.length === 1) {
        const h0 = HOLES.get(holes[0]);
        holes = pins.map((_, i) => holeAt(h0.x + i, h0.y));
        if (holes.some((h) => !h)) fail(`${id}'s ${pins.length} pins would run off the board from ${raw[0]}`);
      }
      if (holes.length !== pins.length) fail(`${id} has ${pins.length} pins (${pins.join(', ')}), but "at" lists ${holes.length} holes`);
      out.plug = pins.map((pin, i) => [pin, holes[i]]);
    }
    if (type === 'sonar') out.cm = numIn(p, ['cm', 'distance', 'range', 'obstacle'], 100, 2, 400);
    if (type === 'pir') out.motion = parseBool(pick(p, ['motion', 'moving', 'on']), false);
    if (type === 'dht11') { out.temp = numIn(p, ['temp', 'temperature', 'celsius'], 25, 0, 50); out.hum = numIn(p, ['hum', 'humidity'], 50, 20, 90); }
    ctx.mods.set(id.toLowerCase(), { id, type });
    TYPES[type].pins.forEach((pin) => ctx.terms.add(id + '.' + pin));
    return out;
  }

  // a wire's end, resolved to a hole or terminal
  function wireEnd(v, other, ctx, what) {
    const mp = modPin(v, ctx, what);
    if (mp) return mp;
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
    const plus = (x) => /^(\+[TB]|BAT\+|5V|3V3|VIN)|\.VCC$/.test(x);
    const minus = (x) => /^(-[TB]|BAT-|GND)|\.GND$/.test(x);
    if (plus(a) || plus(b)) return 'red';
    if (minus(a) || minus(b)) return 'black';
    return ['blue', 'green', 'yellow', 'orange', 'purple', 'white'][k % 6];
  }
  const cleanCode = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[‪-‮⁦-⁩]/g, '') : '');
  const newCtx = (spec, learner) => ({ used: new Map(), arduino: spec.arduino, learner: Boolean(learner), ids: new Set(['BAT', 'MOTOR', 'UNO']), terms: new Set(termsOf(spec)), mods: new Map(), board: learner ? null : new Map() });

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
    spec.motor = parseBool(pick(src, ['motor', 'fan']), false);
    // what the wires and code use says what's on the bench: the Arduino's pins, the battery's clips
    const rawWires0 = Array.isArray(src.wires) ? src.wires : [];
    rawWires0.forEach((w) => {
      const ends = Array.isArray(w) ? w.slice(0, 2) : isObj(w) ? [pick(w, ['from', 'a', 'start']), pick(w, ['to', 'b', 'end'])] : [];
      ends.forEach((e) => {
        if (typeof e === 'string' && /[.:]/.test(e) && TYPES[typeOf(e.split(/[.:]/)[0].replace(/\d+$/, ''))] !== undefined) return; // a module's pin
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
    const ctx = newCtx(spec, opts.learner);
    const placed = rawParts.filter((p) => isObj(p) && TYPES[typeOf(pick(p, ['type', 'kind', 'part']))] !== undefined || !isObj(p));
    if (placed.length > LIMIT.parts) fail(`more than ${LIMIT.parts} parts placed`);
    spec.parts = placed.map((p, i) => normPart(p, ctx, i));
    const docks = spec.parts.concat(spec.bin).filter((x) => TYPES[x.type].dock).length;
    if (docks > LIMIT.dock) fail(`more than ${LIMIT.dock} modules (servo, sonar, lcd, relay, pir, dht11) on one bench`);
    // modules plugged into the board: a wire from each pin to its hole (unless the wires already name its pins)
    const plugged = [];
    const named = (id) => rawWires0.some((w) => (Array.isArray(w) ? w.slice(0, 2) : isObj(w) ? [pick(w, ['from', 'a', 'start']), pick(w, ['to', 'b', 'end'])] : []).some((e) => typeof e === 'string' && e.trim().toLowerCase().startsWith(id.toLowerCase() + '.')));
    spec.parts.forEach((p) => { if (p.plug) { if (!named(p.id)) p.plug.forEach(([pin, h]) => plugged.push({ from: p.id + '.' + pin, to: h })); delete p.plug; } });
    const rawWires = rawWires0.concat(plugged);
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
      const burnt = Object.keys(v.parts).find((id) => v.parts[id].burn || v.parts[id].fault);
      if (burnt) {
        const id = burnt, t = (spec.parts.find((p) => p.id === id) || {}).type;
        if (t === 'electrolytic') fail(`${id} is the wrong way round as the bench starts: an electrolytic capacitor's + leg (the first in "at") must face the + side`);
        if (t === 'npn' || t === 'mosfet') fail(`${id} carries too much current as the bench starts: put a resistor (about 1000 ohms) between the pin and its base, and never wire it straight across the supply`);
        fail(`${id} burns out as the bench starts (${mA((v.parts[id] || {}).I || 0)} mA): put a resistor (about 220 to 1000 ohms) in series with it`);
      }
    }
    return spec;
  }
  // the spec in its JSON form (normSpec reads it back the same)
  function specOut(spec) {
    const o = { battery: spec.battery, arduino: spec.arduino, motor: spec.motor, bin: binOut(spec.bin), parts: spec.parts.map((p) => { const q = Object.assign({}, p, { at: p.at.slice() }); if (TYPES[p.type].dock) delete q.at; return q; }), wires: spec.wires.map((w) => Object.assign({}, w)) };
    if (spec.code) o.code = spec.code;
    if (spec.hide_values) o.hide_values = true;
    return o;
  }
  const startBuild = (spec) => ({ parts: spec.parts.map((p) => Object.assign({}, p, { at: p.at.slice() })), wires: spec.wires.map((w) => Object.assign({}, w)), code: spec.code || '' });

  // everything the learner can place: what starts on the board and what's in the bin
  function inventory(spec) {
    return spec.parts.map(itemOf).concat(spec.bin.map((x) => Object.assign({}, x)));
  }
  // take one part out of an inventory list (exact kind first, then "any"); its item, or null
  // (want null or "any": whichever there is, a fixed one first)
  function take(inv, type, want) {
    const k = VARIANT[type];
    const anyItem = (x) => Boolean(k) && isAnyV(x[k]) && type !== 'seg7';
    const loose = !k || isAnyV(want);
    const fitsAny = () => (type === 'led' ? Boolean(LEDS[want]) : type === 'seg7' ? false : want > 0);
    let i = inv.findIndex((x) => x.type === type && (loose ? !anyItem(x) : x[k] === want));
    if (i < 0) i = inv.findIndex((x) => x.type === type && (loose || (anyItem(x) && fitsAny())));
    if (i < 0) return null;
    return inv.splice(i, 1)[0];
  }

  // The learner's build (their value), checked against the bench; null if it can't be read.
  function normBuild(value, spec) {
    if (!isObj(value)) return null;
    try {
      const ctx = newCtx(spec, true);
      const parts = (Array.isArray(value.parts) ? value.parts : []).slice(0, LIMIT.parts + LIMIT.bin).map((p, i) => normPart(p, ctx, i));
      const inv = inventory(spec);
      for (const p of parts) if (!take(inv, p.type, variantOf(p))) return null;
      const wires = (Array.isArray(value.wires) ? value.wires : []).slice(0, 80).map((w, k) => normWire(w, ctx, k));
      return { parts, wires, code: cleanCode(value.code).slice(0, 8000) };
    } catch (e) {
      if (e instanceof BBError) return null;
      throw e;
    }
  }

  /* ---------------- the netlist and the solver ---------------- */

  const INPUT = 0, OUTPUT = 1, PULLUP = 2;
  // how much each module needs between its VCC and GND to work, volts
  const POWERED = { servo: 4, sonar: 4.5, lcd: 4.5, relay: 4, pir: 4.5, dht11: 3 };

  // the parts and wires of a build, as nodes and elements (compiled once per build)
  function bench(spec, build) {
    const pts = new Map(), names = [];
    const P = (name) => { let i = pts.get(name); if (i === undefined) { i = names.length; pts.set(name, i); names.push(name); } return i; };
    const nodeOf = (point) => (HOLES.has(point) ? '#' + HOLES.get(point).strip : point);
    termsOf(spec).forEach(P);
    const attach = new Map();         // node -> how many legs and wire ends are in it
    const note = (n) => attach.set(n, (attach.get(n) || 0) + 1);
    const els = [], caps = [], joins = [];
    const mods = { servo: [], sonar: [], lcd: [], relay: [], pir: [], dht11: [] };
    const parts = new Map();
    const R = (a, b, r, id, key, more) => els.push(Object.assign({ k: 'R', a, b, r, part: id, key: key || id }, more || {}));
    const D = (a, b, vf, rs, id, key) => els.push({ k: 'D', a, b, vf, rs, part: id, key: key || id });
    for (const p of build.parts) {
      const T = TYPES[p.type];
      const legs = T.dock ? T.pins.map((pin) => P(p.id + '.' + pin)) : p.at.map((h) => P(nodeOf(h)));
      if (!T.dock) legs.forEach(note);
      parts.set(p.id, Object.assign({}, p, { legs }));
      const [a, b, c] = legs;
      const id = p.id;
      switch (p.type) {
        case 'resistor': R(a, b, p.ohms, id); break;
        case 'led': D(a, b, LEDS[p.color] || 1.8, LED_RS, id); break;
        case 'buzzer': D(a, b, BUZZ.vf, BUZZ.rs, id); break;
        case 'ldr': R(a, b, 0, id, id, { ldr: true }); break;
        case 'pot': R(a, b, 0, id, id + '#0', { pot: 0, total: p.ohms }); R(b, c, 0, id, id + '#1', { pot: 1, total: p.ohms }); break;
        case 'button': els.push({ k: 'S', a, b, part: id, when: 'press' }); break;
        case 'switch':
          if (legs.length === 3) { els.push({ k: 'S', a: b, b: a, part: id, when: 'on' }); els.push({ k: 'S', a: b, b: c, part: id, when: 'off' }); }
          else els.push({ k: 'S', a, b, part: id, when: 'on' });
          break;
        case 'diode': D(a, b, DIODE.vf, DIODE.rs, id); break;
        case 'zener': D(a, b, ZENER.vf, ZENER.rs, id); D(b, a, p.volts, ZENER.rz, id, id + '#z'); break;
        case 'capacitor': case 'electrolytic':
          caps.push({ part: id, a, b, C: p.uf * 1e-6, esr: ESR[p.type], polar: p.type === 'electrolytic' });
          els.push({ k: 'C', a, b, part: id, key: id, ci: caps.length - 1 });
          break;
        case 'npn': els.push({ k: 'Q', ne: a, nb: b, nc: c, part: id, key: id }); break;
        case 'mosfet': els.push({ k: 'M', ng: a, nd: b, ns: c, part: id, key: id }); break;
        case 'tmp36': {
          // 10 mV a degree, 0.5 V at 0 °C, while it has 2.7 V or more
          R(a, c, 100000, id, id + '#load');
          const t0 = p.temp;
          els.push({ k: 'V', a: b, b: c, v: 0, r: 100, part: id, key: id, ctl: { watch: [a, c], f: (w, st) => { const vs = w[0] - w[1]; return vs < 2.7 ? 0 : clamp(0.5 + 0.01 * (own(st.temp, id) ? st.temp[id] : t0), 0.1, vs - 0.1); } } });
          break;
        }
        case 'rgb': ['r', 'g', 'b'].forEach((ch, i) => D(legs[i ? i + 1 : 0], legs[1], RGB_VF[ch], LED_RS, id, id + '#' + ch)); break;
        case 'seg7': {
          joins.push([legs[2], legs[7]]); // its two COM pins are one
          SEGS.forEach((s) => { const n = legs[SEG7_SEG[s]]; if (p.common === 'anode') D(legs[2], n, LEDS.red, LED_RS, id, id + '#' + s); else D(n, legs[2], LEDS.red, LED_RS, id, id + '#' + s); });
          break;
        }
        // the modules beside the board
        case 'servo': R(b, a, 500, id, id + '#load'); mods.servo.push({ id, gnd: a, vcc: b, sig: c }); break;
        case 'sonar': {
          const [vcc, trig, echo, gnd] = legs;
          R(vcc, gnd, 333, id, id + '#load');
          els.push({ k: 'V', a: echo, b: gnd, v: 0, r: 50, part: id, key: id, ctl: { watch: [vcc, gnd], f: (w, st) => (st.echo && st.echo[id] && w[0] - w[1] >= POWERED.sonar ? Math.min(5.5, w[0] - w[1]) : 0) } });
          mods.sonar.push({ id, vcc, trig, echo, gnd });
          break;
        }
        case 'lcd': {
          const [gnd, vcc, sda, scl] = legs;
          R(vcc, gnd, 250, id, id + '#load'); R(sda, vcc, 10000, id, id + '#sda'); R(scl, vcc, 10000, id, id + '#scl');
          mods.lcd.push({ id, gnd, vcc, sda, scl });
          break;
        }
        case 'relay': {
          const [inp, vcc, gnd, com, no, nc] = legs;
          R(inp, gnd, 1500, id, id + '#in'); R(vcc, gnd, 70, id, id + '#coil', { coil: true });
          els.push({ k: 'S', a: com, b: no, part: id, when: 'relay' }); els.push({ k: 'S', a: com, b: nc, part: id, when: 'unrelay' });
          mods.relay.push({ id, inp, vcc, gnd, com, no, nc });
          break;
        }
        case 'pir': {
          const [vcc, outp, gnd] = legs;
          R(vcc, gnd, 100000, id, id + '#load');
          els.push({ k: 'V', a: outp, b: gnd, v: 0, r: 100, part: id, key: id, ctl: { watch: [vcc, gnd], f: (w, st) => (st.motion && st.motion[id] && w[0] - w[1] >= POWERED.pir ? 3.3 : 0) } });
          mods.pir.push({ id, vcc, out: outp, gnd });
          break;
        }
        case 'dht11': {
          const [vcc, data, gnd] = legs;
          R(vcc, gnd, 5000, id, id + '#load'); R(data, vcc, 10000, id, id + '#pull');
          mods.dht11.push({ id, vcc, data, gnd });
          break;
        }
        default: break;
      }
    }
    if (spec.motor) els.push({ k: 'R', a: P('M+'), b: P('M-'), part: 'MOTOR', key: 'MOTOR', r: MOTOR_R });
    if (spec.battery) { const Bt = BATTERIES[spec.battery]; els.push({ k: 'V', a: P('BAT+'), b: P('BAT-'), v: Bt.v, r: Bt.r, src: 'BAT', part: 'BAT', key: 'BAT' }); }
    if (spec.arduino) {
      els.push({ k: 'V', a: P('5V'), b: P('GND'), v: 5, r: R_5V, src: '5V', part: 'UNO', key: '5V' });
      els.push({ k: 'V', a: P('3V3'), b: P('GND'), v: 3.3, r: R_3V3, src: '3V3', part: 'UNO', key: '3V3' });
    }
    const wires = build.wires.map((w) => { const a = P(nodeOf(w.from)), b = P(nodeOf(w.to)); note(a); note(b); return { a, b }; });
    const n = names.length;
    const uf = new Int32Array(n);
    for (let i = 0; i < n; i++) uf[i] = i;
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    wires.concat(joins.map(([a, b]) => ({ a, b }))).forEach((w) => { const ra = find(w.a), rb = find(w.b); if (ra !== rb) uf[ra] = rb; });
    for (let i = 0; i < n; i++) uf[i] = find(i);
    let program = null, codeError = null;
    if (spec.arduino && build.code && build.code.trim()) {
      try { program = compile(build.code); } catch (e) { if (e instanceof SketchError) codeError = e; else throw e; }
    }
    // the Arduino pins each module pin is wired straight to (by wires and strips)
    const pinsAt = (node) => (spec.arduino ? PINS.map((x, i) => i).filter((i) => uf[pts.get(PINS[i])] === uf[node]) : []);
    mods.servo.forEach((m) => { m.pins = pinsAt(m.sig); });
    mods.sonar.forEach((m) => { m.trigPins = pinsAt(m.trig); m.echoPins = pinsAt(m.echo); });
    mods.lcd.forEach((m) => { m.i2c = pinsAt(m.sda).includes(18) && pinsAt(m.scl).includes(19); });
    mods.dht11.forEach((m) => { m.pins = pinsAt(m.data); });
    return {
      spec, build, names, pts, nodeOf, attach, els, parts, uf, n, program, codeError, caps, mods, warm: [],
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
  const DT_VIEW = 0.001;   // a capacitor, seen now, behind the step of a millisecond
  // the NPN transistor (Ebers-Moll): saturation current, thermal voltage, forward and reverse beta
  const VT = 0.025852, IS = 1e-14, BF = 150, BRV = 3;
  const VCRIT = VT * Math.log(VT / (Math.SQRT2 * IS));
  // the N-channel MOSFET: its gain, threshold and how softly it starts (an IRF540 on a 5 V gate, roughly)
  const KN = 2, VTH = 2.5, VSOFT = 0.04;
  const ex = (x) => (x > 80 ? Math.exp(80) * (1 + x - 80) : Math.exp(x));
  // a junction's voltage may move only so far in one Newton step (SPICE's pnjlim), or exp() runs away
  function pnjlim(vnew, vold) {
    if (vnew > VCRIT && Math.abs(vnew - vold) > 2 * VT) {
      if (vold > 0) { const arg = 1 + (vnew - vold) / VT; vnew = arg > 0 ? vold + VT * Math.log(arg) : VCRIT; }
      else vnew = VT * Math.log(vnew / VT);
    }
    return vnew;
  }
  function bjt(vbe, vbc) {
    const ef = ex(vbe / VT), er = ex(vbc / VT);
    const If = IS * (ef - 1), Ir = IS * (er - 1);
    const gf = IS * ef / VT + GMIN, gr = IS * er / VT + GMIN;
    return { ic: If - Ir * (1 + 1 / BRV), ib: If / BF + Ir / BRV, gf, gr };
  }
  function fet(vgs, vds) { // vds >= 0
    const u = (vgs - VTH) / VSOFT;
    const sg = u > 40 ? 1 : 1 / (1 + Math.exp(-u));
    const vov = u > 40 ? vgs - VTH : VSOFT * Math.log1p(Math.exp(u));
    let id, gm, gds;
    if (vds < vov) { id = KN * (vov * vds - vds * vds / 2); gm = KN * vds * sg; gds = KN * (vov - vds); }
    else { id = KN / 2 * vov * vov; gm = KN * vov * sg; gds = 0; }
    return { id: id + 1e-7 * vds, gm, gds: gds + 1e-7 };
  }

  // One solution for an exact state: st = { press, on, knob, light, temp, motion, echo, relay (by id),
  // pins: [{ mode, level }], open, flip, burnt (Sets), vc (capacitor volts), dt (seconds), dc (capacitors open) }
  function solveOnce(B, st) {
    const uf = Int32Array.from(B.uf);
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf[ra] = rb; };
    const gone = (key) => Boolean((st.open && st.open.has(key)) || (st.burnt && st.burnt.has(key)));
    for (const e of B.els) {
      if (e.k !== 'S' || gone(e.part)) continue;
      const relayOn = Boolean(st.relay && st.relay[e.part]);
      const shut = e.when === 'press' ? Boolean(st.press[e.part]) : e.when === 'on' ? Boolean(st.on[e.part]) : e.when === 'off' ? !st.on[e.part] : e.when === 'relay' ? relayOn : !relayOn;
      if (shut) join(e.a, e.b);
    }
    const live = [];
    for (const e of B.els) {
      if (e.k === 'S' || gone(e.part) || gone(e.key)) continue;
      if (e.k === 'R') {
        let r = e.r;
        if (e.ldr) r = ldrOhms(own(st.light, e.part) ? st.light[e.part] : 0.5);
        else if (e.pot != null) { const k = own(st.knob, e.part) ? st.knob[e.part] : 0.5; r = Math.max(1, (e.pot === 0 ? k : 1 - k) * e.total); }
        else if (e.coil) r = st.relay && st.relay[e.part] ? e.r : 1e6;
        live.push({ k: 'R', a: e.a, b: e.b, r, part: e.part, key: e.key });
      } else if (e.k === 'D') {
        const f = st.flip && st.flip.has(e.part);
        live.push({ k: 'D', a: f ? e.b : e.a, b: f ? e.a : e.b, vf: e.vf, rs: e.rs, part: e.part, key: e.key });
      } else if (e.k === 'C') {
        if (st.dc) continue; // a charged capacitor passes no current
        const cap = B.caps[e.ci];
        live.push({ k: 'V', a: e.a, b: e.b, v: st.vc ? st.vc[e.ci] : 0, r: cap.esr + (st.dt || DT_VIEW) / cap.C, cap: e.ci, part: e.part, key: e.key });
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
    const L = live.map((e) => (e.k === 'Q' ? { e, c: idx(e.nc), b: idx(e.nb), x: idx(e.ne) } : e.k === 'M' ? { e, g: idx(e.ng), d: idx(e.nd), s: idx(e.ns) } : { e, a: idx(e.a), b: idx(e.b) }));
    for (let i = 0; i < B.n; i++) { const r = find(i); netOf[i] = r === ref ? -2 : roots.has(r) ? roots.get(r) : -1; }
    // a node a controlled source only watches: its net, or nothing (0 V)
    const watchAt = (node) => { const r = find(node); return r === ref ? -1 : roots.has(r) ? roots.get(r) : -3; };
    const diodes = L.filter((x) => x.e.k === 'D');
    const qs = L.filter((x) => x.e.k === 'Q'), fets = L.filter((x) => x.e.k === 'M'), ctls = L.filter((x) => x.e.ctl);
    const warm = st.warm || null; // where the last solution ended, to start from
    const on = diodes.map((x) => Boolean(warm && warm.d && warm.d.get(x.e.key)));
    qs.forEach((x) => { const w = warm && warm.q && warm.q.get(x.e.key); x.vbe = w ? w[0] : 0.6; x.vbc = w ? w[1] : -1; });
    fets.forEach((x) => { const w = warm && warm.q && warm.q.get(x.e.key); x.vgs = w ? w[0] : 0; x.vds = w ? w[1] : 0; });
    ctls.forEach((x) => { x.w = x.e.ctl.watch.map(watchAt); x.v = warm && warm.c && warm.c.has(x.e.key) ? warm.c.get(x.e.key) : 0; });
    let V = null;
    const solveWith = () => {
      const A = new Float64Array(m * m), rhs = new Float64Array(m);
      for (let i = 0; i < m; i++) A[i * m + i] += GMIN;
      const stamp = (a, b, g, j) => { // current a -> b = g (Va - Vb) - j
        if (a >= 0) { A[a * m + a] += g; rhs[a] += j; if (b >= 0) A[a * m + b] -= g; }
        if (b >= 0) { A[b * m + b] += g; rhs[b] -= j; if (a >= 0) A[b * m + a] -= g; }
      };
      const put = (r, c, g) => { if (r >= 0 && c >= 0) A[r * m + c] += g; };
      let di = 0;
      for (const x of L) {
        const e = x.e;
        if (e.k === 'R') stamp(x.a, x.b, 1 / e.r, 0);
        else if (e.k === 'V') stamp(x.a, x.b, 1 / e.r, (e.ctl ? x.v : e.v) / e.r);
        else if (e.k === 'D') { if (on[di]) stamp(x.a, x.b, 1 / e.rs, e.vf / e.rs); else stamp(x.a, x.b, GMIN, 0); di++; }
        else if (e.k === 'Q') {
          // the currents into C, B and E, linearised where vbe and vbc are now
          const q = bjt(x.vbe, x.vbc);
          const cF = q.gf, cR = -q.gr * (1 + 1 / BRV), bF = q.gf / BF, bR = q.gr / BRV;
          for (const [n, I0, dF, dR] of [[x.c, q.ic, cF, cR], [x.b, q.ib, bF, bR], [x.x, -(q.ic + q.ib), -(cF + bF), -(cR + bR)]]) {
            if (n < 0) continue;
            put(n, x.b, dF + dR); put(n, x.x, -dF); put(n, x.c, -dR);
            rhs[n] += dF * x.vbe + dR * x.vbc - I0;
          }
        } else if (e.k === 'M') {
          // the lower of drain and source is the source
          const rev = x.vds < 0;
          const dN = rev ? x.s : x.d, sN = rev ? x.d : x.s;
          const vgs = rev ? x.vgs - x.vds : x.vgs, vds = Math.abs(x.vds);
          const f = fet(vgs, vds);
          for (const [n, s] of [[dN, 1], [sN, -1]]) {
            if (n < 0) continue;
            put(n, x.g, s * f.gm); put(n, dN, s * f.gds); put(n, sN, -s * (f.gm + f.gds));
            rhs[n] += s * (f.gm * vgs + f.gds * vds - f.id);
          }
        }
      }
      return m ? gauss(A, rhs, m) : new Float64Array(0);
    };
    const vAt = (i) => (i >= 0 ? V[i] : 0);
    let settled = false, rounds = 0;
    for (let it = 0; it < 240 && !settled; it++) {
      V = solveWith();
      if (!V) break;
      // the transistors and controlled sources first, by Newton steps; then the diodes, on or off
      let moved = false;
      for (const x of qs) {
        const vb = vAt(x.b);
        const vbe = pnjlim(vb - vAt(x.x), x.vbe), vbc = pnjlim(vb - vAt(x.c), x.vbc);
        if (Math.abs(vbe - x.vbe) > 1e-7 || Math.abs(vbc - x.vbc) > 1e-7) moved = true;
        x.vbe = vbe; x.vbc = vbc;
      }
      for (const x of fets) {
        const vgs = vAt(x.g) - vAt(x.s), vds = vAt(x.d) - vAt(x.s);
        const ng = x.vgs + clamp(vgs - x.vgs, -0.5, 0.5), nd = x.vds + clamp(vds - x.vds, -2, 2);
        if (Math.abs(ng - x.vgs) > 1e-7 || Math.abs(nd - x.vds) > 1e-6) moved = true;
        x.vgs = ng; x.vds = nd;
      }
      for (const x of ctls) {
        const nv = x.e.ctl.f(x.w.map((i) => (i >= 0 ? V[i] : 0)), st);
        if (Math.abs(nv - x.v) > 1e-6) { moved = true; x.v = nv; }
      }
      if (moved) continue;
      settled = true;
      let worst = -1, wv = 0;
      diodes.forEach((x, i) => {
        const vd = vAt(x.a) - vAt(x.b);
        const bad = on[i] ? x.e.vf - vd : vd - x.e.vf;
        if (bad > 1e-9) { settled = false; if (rounds < 30) on[i] = !on[i]; else if (bad > wv) { wv = bad; worst = i; } }
      });
      if (worst >= 0) on[worst] = !on[worst];
      if (++rounds > 90) break;
    }
    if (!V) V = new Float64Array(m);
    const I = new Map(), src = {}, pinI = new Float64Array(20), capI = new Float64Array(B.caps.length), q = new Map();
    let di = 0;
    for (const x of L) {
      const e = x.e;
      if (e.k === 'Q') {
        const r = bjt(Math.min(vAt(x.b) - vAt(x.x), 1.2), Math.min(vAt(x.b) - vAt(x.c), 1.2));
        q.set(e.key, { ic: r.ic, ib: r.ib, vce: vAt(x.c) - vAt(x.x) });
        I.set(e.key, r.ic);
        continue;
      }
      if (e.k === 'M') {
        const vds = vAt(x.d) - vAt(x.s);
        const r = vds >= 0 ? fet(vAt(x.g) - vAt(x.s), vds) : fet(vAt(x.g) - vAt(x.d), -vds);
        const id = vds >= 0 ? r.id : -r.id;
        q.set(e.key, { id, vgs: vAt(x.g) - vAt(x.s) });
        I.set(e.key, id);
        continue;
      }
      const dv = vAt(x.a) - vAt(x.b);
      if (e.k === 'R') I.set(e.key, dv / e.r);
      else if (e.k === 'D') { I.set(e.key, on[di] ? (dv - e.vf) / e.rs : 0); di++; }
      else if (e.k === 'V') {
        const out = ((e.ctl ? x.v : e.v) - dv) / e.r; // the current it gives out of its + end
        if (e.cap != null) { capI[e.cap] = -out; I.set(e.key, -out); }
        else if (e.src === 'pin' || e.src === 'pullup') pinI[e.pin] += out;
        else if (e.src) src[e.src] = (src[e.src] || 0) + out;
        else I.set(e.key, out);
      }
    }
    const warmOut = { d: new Map(diodes.map((x, i) => [x.e.key, on[i]])), q: new Map(), c: new Map(ctls.map((x) => [x.e.key, x.v])) };
    qs.forEach((x) => warmOut.q.set(x.e.key, [x.vbe, x.vbc]));
    fets.forEach((x) => warmOut.q.set(x.e.key, [x.vgs, x.vds]));
    return { V, netOf, I, src, pinI, capI, q, warm: warmOut };
  }

  // The circuit in a state, with PWM pins averaged by their duty, and the relays settled where the circuit
  // puts them: what the page draws and the checks read. With st.dt (seconds), it is a step of that long,
  // and vcNext the capacitors' voltages at its end.
  function view(B, st) {
    let relay = Object.assign({}, st.relay || {});
    let out = null;
    for (let k = 0; k < 4; k++) {
      out = viewWith(B, Object.assign({}, st, { relay }));
      const next = out.relayNext;
      if (!B.mods.relay.some((r) => Boolean(next[r.id]) !== Boolean(relay[r.id]))) break;
      relay = next;
    }
    out.relayUsed = relay;
    return out;
  }
  // which segments make which digit (null: none)
  function digitOf(lit) {
    const s = SEGS.filter((x) => x !== 'dp' && lit[x]).join('');
    for (const d of Object.keys(DIGITS)) if (DIGITS[d].includes(s)) return Number(d);
    return null;
  }
  function viewWith(B, st) {
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
      if (w > 0) {
        const slot = (st.dc ? 64 : 0) + mask;
        const r = solveOnce(B, Object.assign({}, st, { pins, warm: B.warm[slot] }));
        B.warm[slot] = r.warm;
        combos.push({ w, r });
      }
    }
    const out = { short: false, shortWhy: '', parts: {}, pinI: new Float64Array(20), pinPeak: new Float64Array(20), overload: [], src: {}, srcMax: {}, relayNext: {}, vcNext: null };
    // the voltage at a hole or terminal (null: nothing there)
    out.volt = (point) => {
      const node = B.pts.get(B.nodeOf(point));
      if (node === undefined) return null;
      let v = 0, any = false;
      for (const c of combos) { const ni = c.r.netOf[node]; if (ni === -1) continue; any = true; v += c.w * (ni === -2 ? 0 : c.r.V[ni]); }
      return any ? v : null;
    };
    const vv = (point) => out.volt(point) || 0;
    const avg = (key) => {
      let I = 0, peak = 0, signed = 0;
      combos.forEach((c) => { const i = c.r.I.get(key) || 0; I += c.w * Math.abs(i); signed += c.w * i; peak = Math.max(peak, Math.abs(i)); });
      return { I, peak, signed };
    };
    const ledLook = (a) => {
      const o = { I: a.I, peak: a.peak };
      o.burn = a.I > BURN || a.peak > 2 * BURN;
      o.lit = !o.burn && a.I >= LIT;
      o.glow = o.burn ? 0 : round(Math.min(1, Math.pow(a.I / FULL, 0.55)), 3);
      return o;
    };
    const ids = [...B.parts.keys()].concat(B.spec.motor ? ['MOTOR'] : []);
    for (const id of ids) {
      const p = B.parts.get(id) || { type: 'motor' };
      let o;
      switch (p.type) {
        case 'led': o = ledLook(avg(id)); break;
        case 'buzzer': { const a = avg(id); o = { I: a.I, peak: a.peak, on: a.I >= 0.003 }; break; }
        case 'motor': { const a = avg('MOTOR'); o = { I: a.I, peak: a.peak, on: Math.abs(a.signed) >= 0.03, speed: round(clamp(a.signed / 0.25, -1, 1), 3) }; break; }
        case 'pot': o = { I: 0, peak: 0, I0: avg(id + '#0').signed, I1: avg(id + '#1').signed }; break;
        case 'rgb': case 'seg7': {
          const subs = {};
          (p.type === 'rgb' ? ['r', 'g', 'b'] : SEGS).forEach((s) => { subs[s] = ledLook(avg(id + '#' + s)); });
          const all = Object.values(subs);
          o = { I: Math.max.apply(null, all.map((x) => x.I)), peak: Math.max.apply(null, all.map((x) => x.peak)), burn: all.some((x) => x.burn), lit: all.some((x) => x.lit) };
          o[p.type === 'rgb' ? 'dies' : 'segs'] = subs;
          if (p.type === 'seg7') { const lit = {}; SEGS.forEach((s) => { lit[s] = subs[s].lit; }); o.digit = digitOf(lit); }
          break;
        }
        case 'diode': { const a = avg(id); o = { I: a.signed, peak: a.peak }; break; }
        case 'zener': { const f = avg(id), z = avg(id + '#z'); o = { I: f.signed - z.signed, peak: Math.max(f.peak, z.peak) }; break; }
        case 'capacitor': case 'electrolytic': {
          const a = avg(id), ci = B.caps.findIndex((c) => c.part === id);
          const vab = vv(p.at[0]) - vv(p.at[1]);
          o = { I: a.signed, peak: a.peak, V: vab, vc: st.vc && ci >= 0 ? st.vc[ci] : 0, fault: p.type === 'electrolytic' && vab < -1 };
          break;
        }
        case 'npn': {
          let ic = 0, ib = 0, vce = 0;
          combos.forEach((c) => { const x = c.r.q.get(id); if (x) { ic += c.w * x.ic; ib += c.w * x.ib; vce += c.w * x.vce; } });
          o = { I: Math.abs(ic), peak: Math.abs(ic), ic, ib, vce, on: ic > 0.001, sat: ic > 0.001 && vce < 0.3, burn: Math.abs(ic) > Q_MAX || ib > QB_MAX };
          break;
        }
        case 'mosfet': {
          let d = 0, g = 0;
          combos.forEach((c) => { const x = c.r.q.get(id); if (x) { d += c.w * x.id; g += c.w * x.vgs; } });
          o = { I: Math.abs(d), peak: Math.abs(d), id: d, vgs: g, on: d > 0.001, burn: Math.abs(d) > 20 };
          break;
        }
        case 'tmp36': o = { V: vv(p.at[1]) - vv(p.at[2]) }; break;
        default:
          if (TYPES[p.type] && TYPES[p.type].dock) {
            const pw = vv(id + '.VCC') - vv(id + '.GND');
            o = { V: pw, powered: pw >= POWERED[p.type] };
            if (p.type === 'relay') {
              const was = Boolean(st.relay && st.relay[id]);
              const vin = vv(id + '.IN') - vv(id + '.GND');
              out.relayNext[id] = was ? vin >= 1.5 && pw >= 3.5 : vin >= 2 && pw >= POWERED.relay;
              o.on = was;
            }
            if (p.type === 'pir') o.out = vv(id + '.OUT') - vv(id + '.GND');
          } else { const a = avg(id); o = { I: a.I, peak: a.peak }; }
      }
      out.parts[id] = o;
    }
    for (const c of combos) {
      for (const s of Object.keys(c.r.src)) { out.src[s] = (out.src[s] || 0) + c.w * c.r.src[s]; out.srcMax[s] = Math.max(out.srcMax[s] || 0, Math.abs(c.r.src[s])); }
      for (let p = 0; p < 20; p++) { out.pinI[p] += c.w * c.r.pinI[p]; out.pinPeak[p] = Math.max(out.pinPeak[p], Math.abs(c.r.pinI[p])); }
    }
    // a short circuit is a path with nothing in it, not a capacitor taking its first gulp of current
    let dcv = null;
    const big = (s, lim) => (out.srcMax[s] || 0) > lim && (!B.caps.length || st.dc || ((dcv = dcv || viewWith(B, Object.assign({}, st, { dc: true, relay: st.relay }))).srcMax[s] || 0) > lim);
    const tied = (a, b) => B.pts.has(a) && B.pts.has(b) && B.uf[B.pts.get(a)] === B.uf[B.pts.get(b)];
    if (B.spec.battery && big('BAT', 1.5)) {
      out.short = true; out.shortSrc = 'BAT';
      out.shortWhy = B.spec.arduino && (tied('BAT+', '5V') || tied('BAT+', '3V3')) ? 'BAT+ is wired to the Arduino\'s 5V (or 3V3), so two supplies fight: leave that wire out (the Arduino\'s 5V and GND power the parts), and keep the battery for the motor'
        : 'the battery\'s + and - are joined with almost nothing between them';
    }
    else if (B.spec.arduino && big('5V', 0.5)) { out.short = true; out.shortWhy = 'the Arduino\'s 5V is joined to GND with almost nothing between them'; out.shortSrc = '5V'; }
    else if (B.spec.arduino && big('3V3', 0.3)) { out.short = true; out.shortWhy = 'the Arduino\'s 3.3V is joined to GND with almost nothing between them'; out.shortSrc = '3V3'; }
    if (st.pins) for (let p = 0; p < 20; p++) if (st.pins[p].mode === OUTPUT && out.pinPeak[p] > 0.04) out.overload.push(p);
    // a step: where the capacitors' voltages end up
    if (st.dt && B.caps.length) {
      out.vcNext = new Float64Array(B.caps.length);
      B.caps.forEach((cap, i) => { let v = 0; combos.forEach((c) => { v += c.w * ((st.vc ? st.vc[i] : 0) + c.r.capI[i] * st.dt / cap.C); }); out.vcNext[i] = v; });
    }
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
    string: 'Line {line}: text in a char array isn\'t supported here; use a String, like String name = "Asha";',
    concat: 'Line {line}: "text" + a number doesn\'t join them in Arduino C. Make one a String: String("text") + x, or use two prints.',
    library: 'Line {line}: there is no {name} library on this bench (it has Servo.h, Wire.h, LiquidCrystal_I2C.h and DHT.h).',
    include: 'Line {line}: {name} needs #include <{lib}> at the top of the sketch.',
    strnum: 'Line {line}: a String is text, not a number: use {name}.toInt() to read a number from it.',
    isobject: 'Line {line}: {name} is a {cls}: use its functions, like {name}.{eg}().',
    method: 'Line {line}: a {cls} has no {name}() function.',
    isr: 'Line {line}: attachInterrupt needs the name of a void function with no ( ) values, like attachInterrupt(digitalPinToInterrupt(2), pressed, FALLING);',
    intpin: 'Line {line}: only pins 2 and 3 have interrupts on the Uno: use digitalPinToInterrupt(2) or digitalPinToInterrupt(3).',
    isrlong: 'The interrupt function {name}() runs too long: keep it short, with no delay() or waiting loops.',
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
  const TYPE_WORDS = new Set(['void', 'int', 'long', 'short', 'float', 'double', 'bool', 'boolean', 'byte', 'char', 'word', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'size_t', 'unsigned', 'signed', 'String', 'Servo', 'LiquidCrystal_I2C', 'DHT']);
  // the libraries a sketch may #include, and the class each one brings
  const LIBS = { 'Arduino.h': '', 'Servo.h': 'Servo', 'Wire.h': '', 'LiquidCrystal_I2C.h': 'LiquidCrystal_I2C', 'DHT.h': 'DHT', 'DHT_U.h': 'DHT', 'Adafruit_Sensor.h': '', 'math.h': '', 'avr/interrupt.h': '' };
  const CLASS_LIB = { Servo: 'Servo.h', LiquidCrystal_I2C: 'LiquidCrystal_I2C.h', DHT: 'DHT.h' };
  const OPS3 = ['<<=', '>>='];
  const OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', '::'];
  const OPS1 = '+-*/%=<>!&|^~?:;,.()[]{}';

  function lex(src) {
    if (src.length > 8000) throw new SketchError('toolong', { n: 8000 });
    const toks = [];
    const defines = new Map();
    const includes = new Set();
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
          else if (what === 'include') {
            const lib = /^\s*[<"]\s*([\w./-]{1,40})\s*[>"]/.exec(m[2]);
            const name = lib ? lib[1] : m[2].trim().slice(0, 40);
            if (!own(LIBS, name)) err('library', { name: name || '?' });
            if (LIBS[name]) includes.add(LIBS[name]);
          } else if (what !== 'pragma') err('unsupported', { what: '#' + what });
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
    toks.includes = includes;
    return toks;
  }

  // types: k is i (whole number), f (float), b (bool), c (char), v (void), S (a String), o (a library's object)
  function typeFrom(base, longs, uns, line) {
    if (base === 'String') return { name: 'String', k: 'S', size: 6 };
    if (CLASS_LIB[base]) return { name: base, k: 'o', cls: base, size: 2, line };
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
  // a value of type t, as String() writes it
  function strConv(t) {
    if (t === 's' || t === 'S') return (x) => String(x);
    if (t === 'c') return (x) => String.fromCharCode(toInt(x) & 255);
    if (t === 'f') return (x) => fmtPrint(x, 'f');
    if (t === 'b') return (x) => (x ? '1' : '0');
    return (x) => String(toInt(x));
  }
  function convOf(type) {
    if (type.k === 'S') return (v) => (typeof v === 'string' ? v : String(v));
    if (type.k === 'o') return (v) => v;
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
      if (CLASS_LIB[base] && !(toks.includes && toks.includes.has(base))) err('include', { name: base, lib: CLASS_LIB[base] }, { line });
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
          if (ty.type.k === 'o') err('unsupported', { what: 'an array of ' + ty.type.name });
          d.arr = { size: is(']') ? null : expr() };
          expect(']');
          if (is('[')) err('unsupported', { what: 'arrays with two [ ] [ ]' });
        }
        // an object made with values: LiquidCrystal_I2C lcd(0x27, 16, 2); DHT dht(2, DHT11); String s("hi");
        if (!d.arr && (ty.type.k === 'o' || ty.type.k === 'S') && is('(')) {
          const open = next();
          d.ctor = [];
          if (!is(')')) { do { d.ctor.push(expr()); } while (accept(',')); }
          expect(')', open);
        }
        if (accept('=')) {
          if (ty.type.k === 'o') err('unsupported', { what: '= for a ' + ty.type.name });
          if (d.arr) {
            if (peek().t === 'str' && ty.type.k !== 'S') err('string', {});
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
      // "Servo arm;", "LiquidCrystal_I2C lcd(0x27, 16, 2);", "String s("hi");" declare; "String name() {" is a function
      const made = ty.type.k === 'o' || (ty.type.k === 'S' && is('(') && !is(')', 1) && !isTypeStart(1));
      if (is('(') && !made) {
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
  const CONSTS = { HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, LED_BUILTIN: 13, A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEC: 10, HEX: 16, OCT: 8, BIN: 2, CHANGE: 1, RISING: 3, FALLING: 2, NOT_AN_INTERRUPT: -1, DHT11: 11, DHT22: 22, DHT21: 21, SDA: 18, SCL: 19 };
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
        if (v.type.k === 'o') err('isobject', objWords(v), node.line);
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
    // an object's words, for its messages: { name, cls, eg }
    const objWords = (v) => ({ name: v ? v.name : 'it', cls: v ? v.type.cls : '', eg: v ? ({ Servo: 'write', LiquidCrystal_I2C: 'print', DHT: 'readTemperature' })[v.type.cls] || 'begin' : 'begin' });
    function value(node) {
      const e = expr(node);
      if (e.t === 'v') err('novalue', { name: node.name || 'it' }, node.line);
      if (e.t === 'arr') err('isarray', { name: node.name }, node.line);
      if (e.t === 'o') err('isobject', objWords(lookup(node.name)), node.line);
      return e;
    }
    const isText = (t) => t === 's' || t === 'S';
    // a value of type t stored where type ty goes
    function storeConv(ty, t, line, name) {
      if (ty.k === 'S') return strConv(t);
      if (isText(t)) err(t === 'S' ? 'strnum' : 'string', { name: name || 'it' }, line);
      return convOf(ty);
    }

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
        case 'member': err('unsupported', { what: node.obj + '.' + node.name + ' without ( )' }, node.line); break;
        case 'call': return call(node);
        case 'index': {
          if (node.a.k !== 'id') err('unsupported', { what: '[ ] here' }, node.line);
          const v = lookup(node.a.name);
          if (!v) unknown(node.a.name, node.line);
          const slot = v.slot, where = v.where, line = node.line, name = v.name;
          if (v.type.k === 'S' && !v.arr) { // a String's character
            return combine('c', [value(node.idx)], (vm, i) => { const s = where === 'g' ? vm.g[slot] : vm.frame[slot]; i = toInt(i); return i >= 0 && i < s.length ? s.charCodeAt(i) & 255 : 0; });
          }
          if (!v.arr) err('notarray', { name: v.name }, node.line);
          return combine(v.type.k, [value(node.idx)], (vm, i) => {
            const a = where === 'g' ? vm.g[slot] : vm.frame[slot];
            i = toInt(i);
            if (!(i >= 0 && i < a.v.length)) throw new SketchError('index', { line, name, i, n: a.v.length, last: a.v.length - 1 });
            return a.v[i];
          });
        }
        case 'un': {
          const a = value(node.a);
          if (isText(a.t)) err('unsupported', { what: node.op + ' on text' }, node.line);
          if (node.op === '!') return combine('b', [a], (vm, x) => (x ? 0 : 1));
          if (node.op === '-') return combine(a.t === 'f' ? 'f' : 'i', [a], (vm, x) => -x);
          if (node.op === '~') return combine('i', [a], (vm, x) => ~toInt(x));
          return combine(a.t === 'f' ? 'f' : 'i', [a], (vm, x) => x);
        }
        case 'bin': {
          const a = value(node.a), b = value(node.b);
          // a String joins anything on with +, and compares with text
          if (a.t === 'S' || b.t === 'S') {
            const ca = strConv(a.t), cb = strConv(b.t);
            if (node.op === '+') return combine('S', [a, b], (vm, x, y) => (ca(x) + cb(y)).slice(0, 2000));
            const cmpF = { '==': (x, y) => x === y, '!=': (x, y) => x !== y, '<': (x, y) => x < y, '>': (x, y) => x > y, '<=': (x, y) => x <= y, '>=': (x, y) => x >= y }[node.op];
            if (cmpF && isText(a.t) && isText(b.t)) return combine('b', [a, b], (vm, x, y) => (cmpF(x, y) ? 1 : 0));
            if (cmpF) err('strnum', { name: (a.t === 'S' ? node.a.name : node.b.name) || 'it' }, node.line);
            err('unsupported', { what: 'a String with ' + node.op }, node.line);
          }
          if ((a.t === 's' || b.t === 's') && node.op === '+') err('concat', {}, node.line);
          if (a.t === 's' || b.t === 's') err('unsupported', { what: 'comparing "text" (make one a String)' }, node.line);
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
          if (isText(a.t) !== isText(b.t)) err('unsupported', { what: '? : with text on one side only' }, node.line);
          const t = a.t === b.t ? a.t : isText(a.t) ? 'S' : numT(a.t, b.t);
          if (!c.g && !a.g && !b.g) { const fc = c.f, fa = a.f, fb = b.f; return P(t, (vm) => (fc(vm) ? fa(vm) : fb(vm))); }
          const gc = lift(c), ga = lift(a), gb = lift(b);
          return G(t, function* (vm) { return (yield* gc(vm)) ? yield* ga(vm) : yield* gb(vm); });
        }
        case 'cast': {
          if (node.type.k === 'o') err('unsupported', { what: 'a ' + node.type.name + ' cast' }, node.line);
          const a = value(node.a);
          const conv = storeConv(node.type, a.t, node.line, node.a.name);
          return combine(node.type.k, [a], (vm, x) => conv(x));
        }
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
          let f;
          if (R.t === 'S') {
            const sc = strConv(V.t);
            if (node.op === '=') f = (o, k, x) => (o[k] = sc(x));
            else if (node.op === '+=') f = (o, k, x) => (o[k] = (o[k] + sc(x)).slice(0, 2000));
            else err('unsupported', { what: node.op + ' on a String' }, node.line);
          } else {
            if (isText(V.t)) err(V.t === 'S' ? 'strnum' : 'string', { name: node.value.name || 'it' }, node.line);
            const conv = R.conv;
            if (node.op === '=') f = (o, k, x) => (o[k] = conv(x));
            else {
              const bop = node.op.slice(0, -1);
              const fo = opFn(bop, numT(R.t, V.t), node.line);
              f = (o, k, x) => (o[k] = conv(fo(o[k], x)));
            }
          }
          if (!R.g && !V.g) { const rf = R.f, vf = V.f; return P(R.t, (vm) => { const x = vf(vm); const o = rf(vm); return f(o, vm.rk, x); }); }
          const gr = lift(R), gv = lift(V);
          return G(R.t, function* (vm) { const x = yield* gv(vm); const o = yield* gr(vm); return f(o, vm.rk, x); });
        }
        case 'inc': {
          const R = ref(node.target, node.op);
          if (R.t === 'S') err('unsupported', { what: node.op + ' on a String' }, node.line);
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

    // calls: the Arduino's functions, Serial, a String's and a library object's functions, casts, and the sketch's own
    function call(node) {
      const name = node.name, line = node.line, n = node.args.length;
      const arity = (min, max) => {
        if (n < min || n > max) err(min === max ? 'args' : 'argsRange', { name: name + '()', n: min, min, max, got: n }, line);
      };
      const dot = name.indexOf('.');
      if (dot > 0) {
        const obj = name.slice(0, dot), m = name.slice(dot + 1);
        if (obj === 'Serial') return serialCall(m);
        const v = lookup(obj);
        if (!v) {
          if (CLASS_LIB[obj]) err('unsupported', { what: name + '()' }, line);
          unknown(obj, line);
        }
        if (v.arr) err('isarray', { name: v.name }, line);
        if (v.type.k === 'S') return stringCall(v, m);
        if (v.type.k === 'o') return objectCall(v, m);
        err('unsupported', { what: name + '()' }, line);
      }
      function serialCall(m) {
        if (m === 'begin') { arity(1, 2); return combine('v', node.args.map(value), (vm) => { vm.serialOn = true; return 0; }); }
        if (m === 'print' || m === 'println') {
          arity(m === 'println' ? 0 : 1, 2);
          const args = node.args.map(value);
          const t = args[0] ? args[0].t : 's';
          const nl = m === 'println' ? '\n' : '';
          return combine('v', args, (vm, x, fmt) => { vm.t += COST.serial; vm.print((n ? fmtPrint(x, t, fmt) : '') + nl); return 0; });
        }
        if (m === 'write') { arity(1, 1); return combine('v', node.args.map(value), (vm, x) => { vm.print(typeof x === 'string' ? x : String.fromCharCode(toInt(x) & 255)); return 0; }); }
        // what the learner types in the serial monitor
        if (m === 'available') { arity(0, 0); return P('i', (vm) => vm.io.rx().length); }
        if (m === 'read' || m === 'peek') {
          arity(0, 0);
          const take = m === 'read';
          return P('i', (vm) => { const s = vm.io.rx(); if (!s.length) return -1; if (take) vm.io.take(1); return s.charCodeAt(0) & 255; });
        }
        if (m === 'parseInt' || m === 'parseFloat') { arity(0, 2); const fl = m === 'parseFloat'; return combine(fl ? 'f' : 'i', node.args.map(value), (vm) => readNumber(vm, fl)); }
        if (m === 'readString') { arity(0, 0); return P('S', (vm) => { const s = vm.io.rx(); vm.io.take(s.length); vm.t += vm.timeout * 1000; return s; }); }
        if (m === 'readStringUntil') {
          arity(1, 1);
          return combine('S', [value(node.args[0])], (vm, c) => {
            const s = vm.io.rx(), i = s.indexOf(String.fromCharCode(toInt(c) & 255));
            if (i >= 0) { vm.io.take(i + 1); return s.slice(0, i); }
            vm.io.take(s.length); vm.t += vm.timeout * 1000; return s;
          });
        }
        if (m === 'setTimeout') { arity(1, 1); return combine('v', [value(node.args[0])], (vm, x) => { vm.timeout = clamp(toInt(x), 0, 60000); return 0; }); }
        if (m === 'flush' || m === 'end') { arity(0, 0); return P('v', () => 0); }
        err('unsupported', { what: name }, line);
      }
      function stringCall(v, m) {
        const slot = v.slot, where = v.where;
        const get = where === 'g' ? (vm) => vm.g[slot] : (vm) => vm.frame[slot];
        const set = where === 'g' ? (vm, s) => { vm.g[slot] = s.slice(0, 2000); } : (vm, s) => { vm.frame[slot] = s.slice(0, 2000); };
        const args = node.args.map(value);
        const txt = args.map((a) => strConv(a.t));
        const on = (t, f) => combine(t, args, (vm, ...xs) => f(get(vm), xs, vm));
        const num = (re) => (s) => { const x = re.exec(s); return x ? Number(x[0]) : 0; };
        switch (m) {
          case 'length': arity(0, 0); return on('i', (s) => s.length);
          case 'isEmpty': arity(0, 0); return on('b', (s) => (s.length ? 0 : 1));
          case 'toInt': { arity(0, 0); const f = num(/^\s*[-+]?\d+/); return on('i', (s) => toInt(f(s)) | 0); }
          case 'toFloat': case 'toDouble': { arity(0, 0); const f = num(/^\s*[-+]?(?:\d+\.?\d*|\.\d+)/); return on('f', (s) => f(s)); }
          case 'equals': arity(1, 1); return on('b', (s, xs) => (s === txt[0](xs[0]) ? 1 : 0));
          case 'equalsIgnoreCase': arity(1, 1); return on('b', (s, xs) => (s.toLowerCase() === txt[0](xs[0]).toLowerCase() ? 1 : 0));
          case 'compareTo': arity(1, 1); return on('i', (s, xs) => { const o = txt[0](xs[0]); return s < o ? -1 : s > o ? 1 : 0; });
          case 'startsWith': arity(1, 1); return on('b', (s, xs) => (s.startsWith(txt[0](xs[0])) ? 1 : 0));
          case 'endsWith': arity(1, 1); return on('b', (s, xs) => (s.endsWith(txt[0](xs[0])) ? 1 : 0));
          case 'indexOf': arity(1, 2); return on('i', (s, xs) => s.indexOf(txt[0](xs[0]), xs.length > 1 ? Math.max(0, toInt(xs[1])) : 0));
          case 'lastIndexOf': arity(1, 1); return on('i', (s, xs) => s.lastIndexOf(txt[0](xs[0])));
          case 'charAt': arity(1, 1); return on('c', (s, xs) => { const i = toInt(xs[0]); return i >= 0 && i < s.length ? s.charCodeAt(i) & 255 : 0; });
          case 'substring': arity(1, 2); return on('S', (s, xs) => { const a = clamp(toInt(xs[0]), 0, s.length), b = xs.length > 1 ? clamp(toInt(xs[1]), 0, s.length) : s.length; return a <= b ? s.slice(a, b) : s.slice(b, a); });
          case 'c_str': arity(0, 0); return on('s', (s) => s);
          // these change the String itself, as Arduino's do
          case 'trim': arity(0, 0); return on('v', (s, xs, vm) => { set(vm, s.trim()); return 0; });
          case 'toUpperCase': arity(0, 0); return on('v', (s, xs, vm) => { set(vm, s.toUpperCase()); return 0; });
          case 'toLowerCase': arity(0, 0); return on('v', (s, xs, vm) => { set(vm, s.toLowerCase()); return 0; });
          case 'concat': arity(1, 1); return on('b', (s, xs, vm) => { set(vm, s + txt[0](xs[0])); return 1; });
          case 'replace': arity(2, 2); return on('v', (s, xs, vm) => { const a = txt[0](xs[0]); if (a) set(vm, s.split(a).join(txt[1](xs[1]))); return 0; });
          case 'remove': arity(1, 2); return on('v', (s, xs, vm) => { const i = clamp(toInt(xs[0]), 0, s.length), k = xs.length > 1 ? Math.max(0, toInt(xs[1])) : s.length; set(vm, s.slice(0, i) + s.slice(i + k)); return 0; });
          case 'setCharAt': arity(2, 2); return on('v', (s, xs, vm) => { const i = toInt(xs[0]); if (i >= 0 && i < s.length) set(vm, s.slice(0, i) + String.fromCharCode(toInt(xs[1]) & 255) + s.slice(i + 1)); return 0; });
          default: err('method', { cls: 'String', name: m }, line);
        }
        return null;
      }
      function objectCall(v, m) {
        const slot = v.slot, where = v.where, cls = v.type.cls;
        const get = where === 'g' ? (vm) => vm.g[slot] : (vm) => vm.frame[slot];
        const sp = METHODS[cls] && own(METHODS[cls], m) ? METHODS[cls][m] : null;
        if (!sp) err('method', { cls, name: m }, line);
        arity(sp.n[0], sp.n[1]);
        const args = node.args.map(value);
        const ts = args.map((a) => a.t);
        const impl = sp.f;
        return combine(sp.t, args, (vm, ...xs) => impl(vm, get(vm), xs, line, ts));
      }
      if (name === 'F') { arity(1, 1); const a = value(node.args[0]); if (a.t !== 's') err('unsupported', { what: 'F() without "text" in it' }, line); return a; }
      if (name === 'String') {
        arity(0, 2);
        if (!n) return P('S', () => '');
        const a = value(node.args[0]);
        if (n === 1) { const c = strConv(a.t); return combine('S', [a], (vm, x) => c(x)); }
        return combine('S', [a, value(node.args[1])], (vm, x, f) => { const s = fmtPrint(x, a.t === 'f' ? 'f' : 'i', f); return a.t === 'f' ? s : s.toLowerCase(); });
      }
      if (name === 'attachInterrupt') {
        arity(3, 3);
        const fa = node.args[1];
        const target = fa.k === 'id' ? funcs.get(fa.name) : null;
        if (!target || target.params.length || target.ret.k !== 'v') err('isr', {}, line);
        return combine('v', [value(node.args[0]), value(node.args[2])], (vm, k, md) => {
          k = toInt(k);
          if (k !== 0 && k !== 1) throw new SketchError('intpin', { line });
          vm.isr[k] = { f: target, mode: toInt(md), name: fa.name };
          vm.io.attach(k);
          return 0;
        });
      }
      if (TYPE_WORDS.has(name)) { // int(x), float(x), byte(x)
        arity(1, 1);
        if (CLASS_LIB[name]) err('unsupported', { what: name + '()' }, line);
        const ty = typeFrom(name === 'long' ? 'int' : name, name === 'long' ? 1 : 0, name === 'unsigned' ? true : null, line);
        const a = value(node.args[0]);
        const conv = storeConv(ty, a.t, line, node.args[0].name);
        return combine(ty.k, [a], (vm, x) => conv(x));
      }
      const b = BUILTINS[name];
      if (b) {
        arity(b.n[0], b.n[1]);
        const args = node.args.map(value);
        args.forEach((a, i) => { if (isText(a.t)) err(a.t === 'S' ? 'strnum' : 'string', { name: node.args[i].name || 'it' }, line); });
        const t = typeof b.t === 'function' ? b.t(args.map((a) => a.t)) : b.t;
        const impl = b.f;
        return combine(t, args, (vm, ...xs) => impl(vm, xs, line));
      }
      const f = funcs.get(name);
      if (!f) {
        const v = lookup(name);
        if (v) err('unsupported', { what: name + '()' }, line);
        const known = [...Object.keys(BUILTINS), ...funcs.keys(), 'Serial.print', 'Serial.println', 'Serial.begin', 'String', 'attachInterrupt'];
        let best = null, bd = 3;
        for (const k of known) { const d = k.toLowerCase() === name.toLowerCase() ? 0 : lev(name, k); if (d < bd) { bd = d; best = k; } }
        if (best && best !== name) err('suggest', { name: name + '()', better: best + '()' }, line);
        err('nofn', { name: name + '()' }, line);
      }
      if (n !== f.params.length) err('args', { name: name + '()', n: f.params.length, got: n }, line);
      const args = node.args.map((a, i) => {
        const e = expr(a);
        if (f.params[i].arr && e.t !== 'arr') err('notarray', { name: a.name || 'it' }, line);
        if (!f.params[i].arr && (e.t === 'arr' || e.t === 'v' || e.t === 'o')) err(e.t === 'arr' ? 'isarray' : e.t === 'o' ? 'unsupported' : 'novalue', { name: a.name || 'it', what: 'passing a ' + (e.t === 'o' ? 'library object' : '') + ' to a function' }, line);
        return e;
      });
      const gs = args.map(lift);
      const convs = f.params.map((p, i) => (p.arr ? null : storeConv(p.type, args[i].t, line, node.args[i].name)));
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
        return f.ret.k === 'S' ? '' : 0;
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
          const rc = storeConv(fn.ret, e.t, node.line, node.e.name);
          if (!e.g) { const f = e.f; return { p: (vm) => { vm.ret = rc(f(vm)); return RET; } }; }
          const g = e.f;
          return { g: function* (vm) { vm.ret = rc(yield* g(vm)); return RET; } };
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
      return { v: new Array(n).fill(type.k === 'S' ? '' : 0), name };
    }
    // a declaration: a variable, a static, an array or a library's object, set as the statement runs
    function decl(d, where) {
      const isG = where === 'g';
      const v = d.isStatic && !isG ? (() => { const gv = { name: d.name, type: d.type, isConst: d.isConst, arr: Boolean(d.arr), where: 'g', slot: gsize++, conv: convOf(d.type) }; scopes[scopes.length - 1].set(d.name, gv); return gv; })() : declare(d, isG ? 'g' : 'l');
      if (d.type.k === 'v') err('unexpected', { got: 'void' }, d.line);
      const slot = v.slot, line = d.line, name = d.name;
      const store = isG || d.isStatic ? (vm, x) => { vm.g[slot] = x; } : (vm, x) => { vm.frame[slot] = x; };
      let run, gen = false;
      if (d.arr) {
        gen = true;
        const size = d.arr.size ? value(d.arr.size) : null;
        const inits = d.init ? d.init.map(value) : [];
        const convs = inits.map((e, i) => storeConv(d.type, e.t, line, d.init[i].name));
        const gs = size ? lift(size) : null, gi = inits.map(lift);
        run = function* (vm) {
          const n = gs ? yield* gs(vm) : gi.length;
          const a = makeArray(d.type, n, line, name);
          if (gi.length > a.v.length) throw new SketchError('index', { line, name, i: gi.length - 1, n: a.v.length, last: a.v.length - 1 });
          for (let i = 0; i < gi.length; i++) a.v[i] = convs[i](yield* gi[i](vm));
          store(vm, a);
          return 0;
        };
      } else if (d.type.k === 'o') {
        // Servo arm;   LiquidCrystal_I2C lcd(0x27, 16, 2);   DHT dht(2, DHT11);
        const cls = d.type.cls, ca = (d.ctor || []).map(value);
        const want = CTOR[cls];
        if (ca.length < want[0] || ca.length > want[1]) err(want[0] === want[1] ? 'args' : 'argsRange', { name: name + ' (a ' + cls + ')', n: want[0], min: want[0], max: want[1], got: ca.length }, line);
        const gs = ca.map(lift);
        gen = true;
        run = function* (vm) { const xs = []; for (const g of gs) xs.push(yield* g(vm)); store(vm, makeObj(cls, xs, line)); return 0; };
      } else {
        if (d.ctor && d.ctor.length > 1) err('unsupported', { what: 'String with two values in ( )' }, line);
        const initNode = d.ctor ? d.ctor[0] || null : d.init;
        const init = initNode ? value(initNode) : null;
        const conv = init ? storeConv(d.type, init.t, line, initNode.name) : null;
        if (init && !init.g) { const f = init.f; run = (vm) => { store(vm, conv(f(vm))); return 0; }; }
        else if (init) { gen = true; const g = init.f; run = function* (vm) { store(vm, conv(yield* g(vm))); return 0; }; }
        else { const z = d.type.k === 'S' ? '' : 0; run = (vm) => { store(vm, z); return 0; }; }
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
        if (p.type.k === 'o') err('unsupported', { what: 'a ' + p.type.name + ' passed to a function' }, p.line);
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
    if (t === 's' || t === 'S') return String(x);
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
    lowByte: { n: [1, 1], t: 'i', f: (vm, a) => toInt(a[0]) & 255 },
    // how long a pin stays HIGH (or LOW), in microseconds: an HC-SR04's echo, a PWM or tone pin; 0 if none in time
    pulseIn: { n: [2, 3], t: 'i', f: (vm, a, line) => { const r = vm.io.pulseIn(pinArg(a[0], line), a[1] ? 1 : 0, a.length > 2 ? Math.max(1, toInt(a[2])) : 1000000); vm.t += r.wait; return r.us; } },
    pulseInLong: { n: [2, 3], t: 'i', f: (vm, a, line) => { const r = vm.io.pulseIn(pinArg(a[0], line), a[1] ? 1 : 0, a.length > 2 ? Math.max(1, toInt(a[2])) : 1000000); vm.t += r.wait; return r.us; } },
    digitalPinToInterrupt: { n: [1, 1], t: 'i', f: (vm, a) => (toInt(a[0]) === 2 ? 0 : toInt(a[0]) === 3 ? 1 : -1) },
    detachInterrupt: { n: [1, 1], t: 'v', f: (vm, a) => { const k = toInt(a[0]); if (k === 0 || k === 1) vm.isr[k] = null; return 0; } },
    interrupts: { n: [0, 0], t: 'v', f: (vm) => { vm.intOff = false; vm.io.attach(-1); return 0; } },
    noInterrupts: { n: [0, 0], t: 'v', f: (vm) => { vm.intOff = true; return 0; } },
    isnan: { n: [1, 1], t: 'b', f: (vm, a) => (Number.isNaN(a[0]) ? 1 : 0) },
    isinf: { n: [1, 1], t: 'b', f: (vm, a) => (a[0] === Infinity || a[0] === -Infinity ? 1 : 0) }
  };

  // the libraries' objects: what they are made with, and their functions (vm, the object, the values, line, their types)
  const CTOR = { Servo: [0, 0], LiquidCrystal_I2C: [1, 3], DHT: [1, 3] };
  function makeObj(cls, a, line) {
    if (cls === 'Servo') return { cls, pin: -1, us: 1500, min: 544, max: 2400 };
    if (cls === 'LiquidCrystal_I2C') return { cls, addr: toInt(a[0]), cols: a.length > 1 ? toInt(a[1]) : 16, rows: a.length > 2 ? toInt(a[2]) : 2 };
    return { cls, pin: pinArg(a[0], line), kind: a.length > 1 ? toInt(a[1]) : 11, last: -1e12, r: null };
  }
  const servoUs = (o, angle) => Math.round(o.min + clamp(angle, 0, 180) * (o.max - o.min) / 180);
  const textT = (t) => t === 's' || t === 'S';
  const lcdDo = (op, cost) => ({ n: [0, 0], t: 'v', f: (vm, o) => { vm.io.lcd(o, op); vm.t += cost || 100; return 0; } });
  const lcdPrint = { n: [1, 2], t: 'i', f: (vm, o, a, line, ts) => { const s = fmtPrint(a[0], ts[0], a[1]); vm.io.lcd(o, 'print', s); vm.t += 400 * s.length; return s.length; } };
  // a DHT11 read takes about 20 ms, and the library keeps the last one for 2 s
  function dhtRead(vm, o) {
    if (vm.t - o.last < 2e6) return o.r;
    vm.t += 20000;
    o.last = vm.t;
    o.r = vm.io.dht(o.pin);
    return o.r;
  }
  const METHODS = {
    Servo: {
      attach: { n: [1, 3], t: 'i', f: (vm, o, a, line) => { const p = pinArg(a[0], line); if (o.pin >= 0 && o.pin !== p) vm.io.servo(o.pin, null); o.pin = p; if (a.length === 3 && toInt(a[2]) > toInt(a[1])) { o.min = toInt(a[1]); o.max = toInt(a[2]); } vm.io.servo(p, o.us); return 1; } },
      detach: { n: [0, 0], t: 'v', f: (vm, o) => { if (o.pin >= 0) vm.io.servo(o.pin, null); o.pin = -1; return 0; } },
      write: { n: [1, 1], t: 'v', f: (vm, o, a) => { const x = toInt(a[0]); o.us = x < 544 ? servoUs(o, x) : clamp(x, o.min, o.max); if (o.pin >= 0) vm.io.servo(o.pin, o.us); return 0; } },
      writeMicroseconds: { n: [1, 1], t: 'v', f: (vm, o, a) => { o.us = clamp(toInt(a[0]), o.min, o.max); if (o.pin >= 0) vm.io.servo(o.pin, o.us); return 0; } },
      read: { n: [0, 0], t: 'i', f: (vm, o) => Math.round((o.us - o.min) * 180 / (o.max - o.min)) },
      readMicroseconds: { n: [0, 0], t: 'i', f: (vm, o) => o.us },
      attached: { n: [0, 0], t: 'b', f: (vm, o) => (o.pin >= 0 ? 1 : 0) }
    },
    LiquidCrystal_I2C: {
      init: lcdDo('init', 50000), begin: { n: [0, 3], t: 'v', f: (vm, o) => { vm.io.lcd(o, 'init'); vm.t += 50000; return 0; } },
      backlight: lcdDo('light'), noBacklight: lcdDo('dark'),
      setBacklight: { n: [1, 1], t: 'v', f: (vm, o, a) => { vm.io.lcd(o, a[0] ? 'light' : 'dark'); return 0; } },
      clear: lcdDo('clear', 2000), home: lcdDo('home', 2000),
      setCursor: { n: [2, 2], t: 'v', f: (vm, o, a) => { vm.io.lcd(o, 'cursor', [toInt(a[0]), toInt(a[1])]); vm.t += 100; return 0; } },
      print: lcdPrint, println: lcdPrint,
      write: { n: [1, 1], t: 'i', f: (vm, o, a, line, ts) => { const s = textT(ts[0]) ? String(a[0]) : String.fromCharCode(toInt(a[0]) & 255); vm.io.lcd(o, 'print', s); vm.t += 400 * s.length; return s.length; } },
      display: lcdDo('on'), noDisplay: lcdDo('off'), cursor: lcdDo('none'), noCursor: lcdDo('none'), blink: lcdDo('none'), noBlink: lcdDo('none'),
      scrollDisplayLeft: lcdDo('left'), scrollDisplayRight: lcdDo('right')
    },
    DHT: {
      begin: { n: [0, 1], t: 'v', f: () => 0 },
      readTemperature: { n: [0, 2], t: 'f', f: (vm, o, a) => { const r = dhtRead(vm, o); return r ? (a[0] ? r.t * 9 / 5 + 32 : r.t) : NaN; } },
      readHumidity: { n: [0, 1], t: 'f', f: (vm, o) => { const r = dhtRead(vm, o); return r ? r.h : NaN; } }
    }
  };
  // Serial.parseInt() and parseFloat(): skip to a number, read it; wait the timeout if none comes, or if nothing follows it
  function readNumber(vm, isFloat) {
    const s = vm.io.rx();
    const starts = (i) => /[0-9]/.test(s[i]) || ((s[i] === '-' || (isFloat && s[i] === '.')) && /[0-9.]/.test(s[i + 1] || ''));
    let i = 0;
    while (i < s.length && !starts(i)) i++;
    if (i >= s.length) { vm.io.take(s.length); vm.t += vm.timeout * 1000; return 0; }
    let j = i + (s[i] === '-' ? 1 : 0), dot = false;
    while (j < s.length && (/[0-9]/.test(s[j]) || (isFloat && s[j] === '.' && !dot && (dot = true)))) j++;
    vm.io.take(j);
    if (j >= s.length) vm.t += vm.timeout * 1000;
    const v = isFloat ? parseFloat(s.slice(i, j)) : parseInt(s.slice(i, j), 10);
    return Number.isFinite(v) ? v : 0;
  }
  // an interrupt: its function runs to the end now, between the sketch's statements (or during its delay)
  function runIsr(vm, k, now) {
    const h = vm.isr[k];
    if (!h || vm.done) return;
    const saved = { frame: vm.frame, depth: vm.depth, ret: vm.ret, until: vm.until, cap: vm.cap, t: vm.t };
    vm.inIsr = true;
    vm.t = now;
    vm.frame = new Array(h.f.size);
    vm.depth = 0; vm.until = Infinity; vm.cap = vm.steps + 100000;
    let ok = false;
    try { const r = h.f.body(vm).next(); ok = Boolean(r.done); } catch (e) { vm.done = true; vm.error = e instanceof SketchError ? e : new SketchError('crash', { msg: String((e && e.message) || e).slice(0, 80) }); }
    if (!ok && !vm.error) { vm.done = true; vm.error = new SketchError('isrlong', { name: h.name }); }
    vm.t = Math.max(saved.t, vm.t);
    vm.frame = saved.frame; vm.depth = saved.depth; vm.ret = saved.ret; vm.until = saved.until; vm.cap = saved.cap;
    vm.inIsr = false;
  }

  function makeVM(prog, io) {
    const vm = { t: 0, until: 0, steps: 0, cap: 0, g: new Array(prog.gsize()).fill(0), frame: null, depth: 0, ret: 0, rk: 0, io, serialOn: false, seed: 12345, done: false, error: null, isr: [null, null], intOff: false, inIsr: false, timeout: 1000 };
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

  const DT_STEP = 1000, DT_MAX = 20000;    // a bench with capacitors steps 1 ms at a time, up to 20 ms while they barely change (µs)
  const SERVO_DEG_US = 0.0006;             // an SG90 turns 60° in 0.1 s
  const BOUNCE = [400, 900, 1700, 2600];   // a button's contacts bounce open and shut again this many µs after it moves
  const PCF = (a) => (a >= 0x20 && a <= 0x27) || (a >= 0x38 && a <= 0x3F); // the I2C backpack answers at these addresses
  const usAngle = (us) => clamp((us - 544) * 180 / (2400 - 544), 0, 180);
  const lcdBlank = () => ({ on: false, disp: true, light: false, x: 0, y: 0, shift: 0, rows: [new Array(40).fill(' '), new Array(40).fill(' ')] });
  // what a 16x2 display shows: its two rows, as text
  const lcdText = (d) => (d ? [0, 1].map((r) => Array.from({ length: 16 }, (_, c) => d.rows[r][(c + d.shift + 40) % 40]).join('')) : ['', '']);

  // The bench as it runs: inputs (buttons, switches, knobs, light, distance, temperature, motion), the Arduino's
  // pins and its sketch, and the circuit's own time (S.tc, µs): capacitors charge, servos turn, echoes come back.
  function session(B, opts) {
    opts = opts || {};
    const inputs = { press: {}, on: {}, knob: {}, light: {}, cm: {}, temp: {}, hum: {}, motion: {} };
    for (const p of B.parts.values()) {
      if (p.type === 'switch') inputs.on[p.id] = Boolean(p.on);
      if (p.type === 'pot') inputs.knob[p.id] = p.knob;
      if (p.type === 'ldr') inputs.light[p.id] = p.light;
      if (p.type === 'button') inputs.press[p.id] = false;
      if (p.type === 'sonar') inputs.cm[p.id] = p.cm;
      if (p.type === 'tmp36') inputs.temp[p.id] = p.temp;
      if (p.type === 'dht11') { inputs.temp[p.id] = p.temp; inputs.hum[p.id] = p.hum; }
      if (p.type === 'pir') inputs.motion[p.id] = Boolean(p.motion);
    }
    const pins = Array.from({ length: 20 }, () => ({ mode: INPUT, level: 0, duty: null, freq: 0, servo: null }));
    const cache = new Map();
    const dyn = B.caps.length > 0;
    const servoStart = {};
    B.mods.servo.forEach((m) => { servoStart[m.id] = 90; });
    const S = {
      B, inputs, pins, burnt: new Set(), serial: '', serialLen: 0, vm: null, record: null, dirty: true, last: null, dynamic: dyn,
      tc: 0, vc: new Float64Array(B.caps.length), dt: DT_STEP, events: [], hurt: null,
      relay: {}, echo: {}, sonar: {}, servo: servoStart, servoSeen: {}, lcd: {}, rx: '', intLevel: [null, null], intDue: [false, false], clicks: 0,
      key() {
        let k = '';
        for (const id of Object.keys(inputs.press)) k += inputs.press[id] ? 'p' : 'r';
        for (const id of Object.keys(inputs.on)) k += inputs.on[id] ? '1' : '0';
        for (const id of Object.keys(inputs.knob)) k += ',' + inputs.knob[id];
        for (const id of Object.keys(inputs.light)) k += ',' + inputs.light[id];
        for (const id of Object.keys(inputs.temp)) k += ',' + inputs.temp[id];
        for (const id of Object.keys(inputs.motion)) k += inputs.motion[id] ? 'm' : '-';
        for (const id of Object.keys(S.echo)) k += S.echo[id] ? 'e' : '_';
        for (const id of Object.keys(S.relay)) k += S.relay[id] ? 'k' : '.';
        k += '|';
        for (const ps of pins) k += ps.mode + (ps.duty != null ? '~' + ps.duty.toFixed(4) : String(ps.level));
        if (S.burnt.size) k += '|' + [...S.burnt].join(',');
        return k;
      },
      // the state to solve, copied
      snap() {
        const c = (o) => Object.assign({}, o);
        return { press: c(inputs.press), on: c(inputs.on), knob: c(inputs.knob), light: c(inputs.light), temp: c(inputs.temp), motion: c(inputs.motion), echo: c(S.echo), relay: c(S.relay), pins: pins.map(c), burnt: new Set(S.burnt) };
      },
      view(extra) {
        if (extra) return view(B, Object.assign(S.snap(), { vc: S.vc }, extra));
        if (!S.dirty && S.last) return S.last;
        let v;
        if (dyn) v = view(B, Object.assign(S.snap(), { vc: S.vc }));
        else {
          const k = S.key();
          v = cache.get(k);
          if (!v) {
            v = view(B, S.snap());
            if (cache.size > 300) cache.clear();
            cache.set(k, v);
          }
        }
        S.last = v;
        S.dirty = false;
        S.relays(v);
        return v;
      },
      // the relays stay where the circuit puts them; each move is a click
      relays(v) {
        const r = v.relayUsed || {};
        if (B.mods.relay.some((m) => Boolean(r[m.id]) !== Boolean(S.relay[m.id]))) { S.relay = Object.assign({}, r); S.clicks++; }
      },
      // parts that burn out stay burnt (open) until the build changes; the first is kept for the checks
      fresh(v) {
        const out = [];
        Object.keys(v.parts).forEach((id) => {
          const o = v.parts[id];
          const subs = o.segs || o.dies;
          if (subs) Object.keys(subs).forEach((s) => { if (subs[s].burn && !S.burnt.has(id + '#' + s)) out.push(id + '#' + s); });
          else if ((o.burn || o.fault) && !S.burnt.has(id)) out.push(id);
        });
        if (out.length && !S.hurt) { const id = out[0].split('#')[0]; S.hurt = { id, fault: Boolean(v.parts[id].fault), mA: mA(Math.max(v.parts[id].I || 0, (v.parts[id].peak || 0) / 2)) }; }
        return out;
      },
      latch() {
        for (let i = 0; i < 8; i++) {
          const v = S.view();
          const fresh = S.fresh(v);
          if (!fresh.length) return v;
          fresh.forEach((id) => S.burnt.add(id));
          S.dirty = true;
        }
        return S.view();
      },
      touch() { S.dirty = true; S.dt = DT_STEP; S.changed(); S.poll(); },
      set(kind, id, x) {
        if (!inputs[kind] || !own(inputs[kind], id) || inputs[kind][id] === x) return;
        inputs[kind][id] = x;
        // a button's contacts bounce for a few milliseconds as they close, as a real one's do (a sketch running can tell)
        if (kind === 'press' && x && S.vm && !S.vm.done) {
          S.events = S.events.filter((e) => !(e.kind === 'bounce' && e.id === id));
          BOUNCE.forEach((d, i) => S.events.push({ t: S.tc + d, kind: 'bounce', id, x: i % 2 ? x : !x }));
          S.events.sort((a, b) => a.t - b.t);
        }
        S.touch();
      },
      setAll(kind, x) { Object.keys(inputs[kind]).forEach((id) => S.set(kind, id, x)); },
      changed() { if (S.record) S.record.push({ t: S.vm ? Math.max(S.vm.t, S.tc) : S.tc, pins: pins.map((x) => Object.assign({}, x)) }); },
      start() {
        pins.forEach((ps) => { ps.mode = INPUT; ps.level = 0; ps.duty = null; ps.freq = 0; ps.servo = null; });
        S.serial = ''; S.serialLen = 0; S.dirty = true; S.events = []; S.tc = 0; S.dt = DT_STEP; S.echo = {}; S.sonar = {}; S.intLevel = [null, null]; S.intDue = [false, false]; S.lcd = {}; S.rx = '';
        S.vm = B.program ? makeVM(B.program, io) : null;
        return S.vm;
      },
      stop() { S.vm = null; pins.forEach((ps) => { ps.mode = INPUT; ps.level = 0; ps.duty = null; ps.freq = 0; ps.servo = null; }); S.events = S.events.filter((e) => e.kind === 'bounce'); S.echo = {}; S.dirty = true; },
      // the page rewired the bench: carry on with the same time, capacitor charges, servos and displays (and,
      // with keepVm, the same sketch, pins and serial output)
      adopt(old, keepVm) {
        if (!old) return S;
        S.tc = old.tc;
        B.caps.forEach((c, i) => { const j = old.B.caps.findIndex((x) => x.part === c.part); if (j >= 0) S.vc[i] = old.vc[j]; });
        Object.keys(S.servo).forEach((id) => { if (own(old.servo, id)) S.servo[id] = old.servo[id]; });
        Object.keys(old.lcd).forEach((id) => { if (B.parts.has(id)) S.lcd[id] = old.lcd[id]; });
        Object.keys(inputs).forEach((k) => Object.keys(inputs[k]).forEach((id) => { if (k === 'press' && own(old.inputs.press, id)) inputs.press[id] = old.inputs.press[id]; }));
        S.clicks = old.clicks;
        if (keepVm && old.vm) {
          old.pins.forEach((ps, i) => Object.assign(pins[i], ps));
          S.vm = old.vm;
          S.vm.io = io;
          S.serial = old.serial; S.serialLen = old.serialLen; S.events = old.events; S.rx = old.rx;
          S.sonar = old.sonar; S.echo = old.echo; S.intLevel = old.intLevel; S.servoSeen = old.servoSeen;
        }
        S.dirty = true;
        return S;
      },
      // check mode: run ms of simulated time at once (false if it took too many steps)
      run(ms, budget) { return S.runTo(S.tc + ms * 1000, budget || 3e6); },
      // the present moves on to target (µs): the sketch runs its statements as their time comes, events happen,
      // and the circuit follows; false if the sketch took more than budget statements
      runTo(target, budget) {
        let left = budget == null ? 3e6 : budget;
        S.poll();
        for (let guard = 0; guard < 1e6; guard++) {
          const vm = S.vm && !S.vm.done ? S.vm : null;
          const watch = vm && dyn && (vm.isr[0] || vm.isr[1]); // interrupts on a pin a capacitor moves: look often
          const stop = Math.min(target, S.events.length ? Math.max(S.events[0].t, S.tc) : Infinity, watch ? S.tc + 1000 : Infinity);
          if (vm && vm.t < stop) {
            const s0 = vm.steps;
            advance(vm, stop, Math.min(left, 200000));
            left -= vm.steps - s0;
            if (vm.t < stop && !vm.done) {
              if (left <= 0) { S.syncTo(vm.t); return false; }
              continue;
            }
          }
          S.syncTo(stop);
          if (S.tc >= target) return true;
        }
        return true;
      },
      // the circuit up to time t: the events due, in order, and the time between them
      syncTo(t) {
        for (;;) {
          const e = S.events[0];
          if (!e || e.t > t) break;
          if (e.t > S.tc) S.integrate(e.t);
          S.events.shift();
          S.apply(e);
        }
        if (t > S.tc) S.integrate(t);
      },
      integrate(t) {
        const span = t - S.tc;
        if (dyn) {
          while (S.tc < t) {
            const dt = Math.min(t - S.tc, S.dt);
            const v = view(B, Object.assign(S.snap(), { vc: S.vc, dt: dt / 1e6 }));
            let most = 0;
            for (let i = 0; i < S.vc.length; i++) most = Math.max(most, Math.abs(v.vcNext[i] - S.vc[i]));
            S.vc = v.vcNext;
            S.tc += dt;
            S.dt = most < 0.002 ? Math.min(DT_MAX, S.dt * 2) : most > 0.02 ? Math.max(100, S.dt / 2) : S.dt;
            S.last = v; S.dirty = false;
            S.relays(v);
            const f = S.fresh(v);
            if (f.length) { f.forEach((id) => S.burnt.add(id)); S.dirty = true; }
            S.poll(v);
          }
        } else S.tc = t;
        S.turn(span);
      },
      apply(e) {
        if (e.kind === 'tone') { const ps = pins[e.pin]; if (ps.freq && ps.servo == null) { ps.duty = null; ps.level = 0; ps.freq = 0; S.touch(); } }
        else if (e.kind === 'bounce') { if (own(inputs.press, e.id)) { inputs.press[e.id] = e.x; S.touch(); } }
        else if (e.kind === 'echo') { S.echo[e.id] = e.high; S.touch(); }
      },
      // servos turn towards the angle their signal asks for, if they have power
      turn(span) {
        if (!B.mods.servo.length || !(span > 0)) return;
        const v = S.view();
        for (const m of B.mods.servo) {
          const p = m.pins.find((q) => pins[q].mode === OUTPUT && pins[q].servo != null);
          if (p == null || !(v.parts[m.id] && v.parts[m.id].powered)) continue;
          S.servoSeen[m.id] = true;
          const want = usAngle(pins[p].servo), at = S.servo[m.id];
          S.servo[m.id] = at + clamp(want - at, -SERVO_DEG_US * span, SERVO_DEG_US * span);
        }
      },
      // interrupts on pins 2 and 3: an edge the sketch asked for runs its function now
      poll(v) {
        const vm = S.vm;
        if (!vm || vm.done || (!vm.isr[0] && !vm.isr[1])) return;
        for (let k = 0; k < 2; k++) {
          const h = vm.isr[k];
          if (!h) continue;
          const volts = (v || S.view()).volt(pinName(k ? 3 : 2)) || 0;
          const prev = S.intLevel[k];
          const level = prev == null ? volts >= 2.5 : prev ? volts > 1.5 : volts >= 3; // a Schmitt trigger, as the pin has
          S.intLevel[k] = level;
          if (prev == null || level === prev) continue;
          const want = h.mode === 1 || (h.mode === 3 && level) || (h.mode === 2 && !level) || (h.mode === 0 && !level);
          if (!want) continue;
          if (vm.intOff || vm.inIsr) { S.intDue[k] = true; continue; }
          runIsr(vm, k, S.tc);
        }
      },
      print(s) {
        if (S.serialLen > 200000) return;
        S.serialLen += s.length;
        S.serial = (S.serial + s).slice(-6000);
        if (opts.onSerial) opts.onSerial(s);
      },
      // the serial monitor's send box
      send(text) { S.rx = (S.rx + String(text)).slice(-1000); },
      lcdText: (id) => lcdText(S.lcd[id])
    };
    const io = {
      sync() { if (S.vm) S.syncTo(S.vm.t); },
      mode(p, m) { io.sync(); const ps = pins[p]; if (ps.mode !== m) { ps.mode = m; ps.duty = null; ps.freq = 0; ps.servo = null; S.touch(); } },
      write(p, v) {
        io.sync();
        const ps = pins[p];
        if (ps.mode === OUTPUT) {
          if (ps.level !== v || ps.duty != null) { const was = ps.duty == null ? ps.level : -1; ps.level = v; ps.duty = null; ps.freq = 0; ps.servo = null; S.touch(); io.trig(p, was, v); }
        } else { const m = v ? PULLUP : INPUT; if (ps.mode !== m) { ps.mode = m; S.touch(); } } // digitalWrite on an input sets its pull-up, as on a real board
      },
      pwm(p, v) {
        io.sync();
        const ps = pins[p];
        const was = ps.mode + ':' + ps.level + ':' + ps.duty;
        ps.mode = OUTPUT; ps.freq = 0; ps.servo = null;
        if (PWM.includes(p) && v > 0 && v < 255) { ps.duty = round(v / 255, 4); ps.level = 0; }
        else { ps.duty = null; ps.level = PWM.includes(p) ? (v >= 255 ? 1 : 0) : (v >= 128 ? 1 : 0); }
        if (was !== ps.mode + ':' + ps.level + ':' + ps.duty) S.touch();
      },
      tone(p, f, ms) {
        io.sync();
        const ps = pins[p];
        ps.mode = OUTPUT; ps.duty = 0.5; ps.level = 0; ps.freq = f; ps.servo = null;
        S.events = S.events.filter((x) => !(x.kind === 'tone' && x.pin === p));
        if (ms > 0) { S.events.push({ t: S.vm.t + ms * 1000, kind: 'tone', pin: p }); S.events.sort((a, b) => a.t - b.t); }
        S.touch();
      },
      // the Servo library keeps a pulse of us microseconds every 20 ms on the pin (null: it stops)
      servo(p, us) {
        io.sync();
        const ps = pins[p];
        if (us == null) { if (ps.servo != null) { ps.servo = null; ps.duty = null; ps.level = 0; ps.freq = 0; S.touch(); } return; }
        if (ps.servo === us && ps.mode === OUTPUT) return;
        ps.mode = OUTPUT; ps.servo = us; ps.duty = round(us / 20000, 4); ps.freq = 50; ps.level = 0;
        S.touch();
      },
      read(p) { io.sync(); const v = S.view().volt(pinName(p)); return v == null ? 0 : v; },
      serial(s) { S.print(s); },
      rx() { return S.rx; },
      take(n) { S.rx = S.rx.slice(n); },
      // an HC-SR04 sees its trigger pulse end (8 µs or more high): its echo comes back after the sound's trip
      trig(p, was, v) {
        if (!B.mods.sonar.length) return;
        const now = S.vm.t;
        for (const m of B.mods.sonar) {
          if (!m.trigPins.includes(p)) continue;
          const s = S.sonar[m.id] || (S.sonar[m.id] = {});
          if (v === 1 && was === 0) s.rise = now;
          else if (v === 0 && was === 1 && s.rise != null && now - s.rise >= 8 && !(s.t1 > now)) {
            s.rise = null;
            if (!(S.view().parts[m.id] || {}).powered) continue;
            const cm = inputs.cm[m.id];
            s.t0 = now + 460;
            s.t1 = s.t0 + (cm <= 400 ? cm * 58.3 : 38000);
            S.events.push({ t: s.t0, kind: 'echo', id: m.id, high: true }, { t: s.t1, kind: 'echo', id: m.id, high: false });
            S.events.sort((a, b) => a.t - b.t);
          }
        }
      },
      pulseIn(p, level, timeout) {
        io.sync();
        const now = S.vm.t;
        for (const m of B.mods.sonar) {
          const s = S.sonar[m.id];
          if (!m.echoPins.includes(p) || !s || !(s.t1 > now)) continue;
          if (level === 1 && now <= s.t0) return s.t1 - now > timeout ? { us: 0, wait: timeout } : { us: Math.round(s.t1 - s.t0), wait: s.t1 - now };
        }
        // a PWM, tone or servo pin wired to this one
        const node = B.uf[B.pinNode[p]];
        for (let q = 0; q < 20; q++) {
          const ps = pins[q];
          if (q === p || ps.mode !== OUTPUT || ps.duty == null || B.uf[B.pinNode[q]] !== node) continue;
          const period = 1e6 / (ps.freq || 490);
          const us = (level ? ps.duty : 1 - ps.duty) * period;
          return period * 2 > timeout ? { us: 0, wait: timeout } : { us: Math.round(us), wait: period * 1.5 };
        }
        return { us: 0, wait: timeout };
      },
      // the I2C display: every 16x2 module on A4 (SDA) and A5 (SCL), with power, takes the command
      lcd(o, op, arg) {
        io.sync();
        if (!PCF(o.addr)) return;
        const v = S.view();
        for (const m of B.mods.lcd) {
          if (!m.i2c || !(v.parts[m.id] && v.parts[m.id].powered)) continue;
          const d = S.lcd[m.id] || (S.lcd[m.id] = lcdBlank());
          if (op === 'init') { const light = d.light; Object.assign(d, lcdBlank(), { on: true, light }); continue; }
          if (op === 'light' || op === 'dark') { d.light = op === 'light'; continue; }
          if (!d.on) continue;
          if (op === 'clear') { d.rows = [new Array(40).fill(' '), new Array(40).fill(' ')]; d.x = 0; d.y = 0; d.shift = 0; }
          else if (op === 'home') { d.x = 0; d.y = 0; d.shift = 0; }
          else if (op === 'cursor') { d.x = clamp(arg[0], 0, 39); d.y = clamp(arg[1], 0, 1); }
          else if (op === 'on' || op === 'off') d.disp = op === 'on';
          else if (op === 'left' || op === 'right') d.shift = (d.shift + (op === 'left' ? 1 : 39)) % 40;
          else if (op === 'print') {
            for (const ch of String(arg)) {
              if (ch === '\n' || ch === '\r') continue;
              d.rows[d.y][d.x] = /^[ -~]$/.test(ch) ? ch : '?';
              d.x++;
              if (d.x >= 40) { d.x = 0; d.y = 1 - d.y; }
            }
          }
        }
        S.lcdSeq = (S.lcdSeq || 0) + 1;
      },
      // a DHT11 on this pin, with power: its temperature and humidity, as whole numbers; null if none answers
      dht(p) {
        io.sync();
        const v = S.view();
        for (const m of B.mods.dht11) if (m.pins.includes(p) && v.parts[m.id] && v.parts[m.id].powered) return { t: Math.round(inputs.temp[m.id]), h: Math.round(inputs.hum[m.id]) };
        return null;
      },
      // attachInterrupt(k): its pin's level now; interrupts(): what came while they were off
      attach(k) {
        if (k >= 0) { const volts = S.view().volt(pinName(k ? 3 : 2)) || 0; S.intLevel[k] = volts >= 2.5; S.intDue[k] = false; return; }
        for (let j = 0; j < 2; j++) if (S.intDue[j] && S.vm && S.vm.isr[j]) { S.intDue[j] = false; runIsr(S.vm, j, S.tc); }
      }
    };
    S.io = io;
    if (opts.run !== false && B.program) S.start();
    return S;
  }

  /* ---------------- goals ---------------- */

  const GOAL_ALIASES = {
    light: 'light', lit: 'light', on: 'light', glow: 'light', led: 'light', power: 'light', buzz: 'light', beep: 'light', sound: 'light', buzzer: 'light', motor: 'light', spin: 'light', transistor: 'light', relay: 'light', 'motor from a pin': 'light',
    series: 'series', 'in series': 'series', parallel: 'parallel', 'in parallel': 'parallel',
    button: 'button', press: 'button', pushbutton: 'button', 'push button': 'button',
    switch: 'switch', toggle: 'switch', slide: 'switch',
    dimmer: 'dimmer', dim: 'dimmer', brightness: 'dimmer', pot: 'dimmer', knob: 'dimmer', potentiometer: 'dimmer', ldr: 'dimmer', sensor: 'dimmer', 'light sensor': 'dimmer', 'night light': 'dimmer',
    blink: 'blink', flash: 'blink', blinking: 'blink',
    serial: 'serial', print: 'serial', monitor: 'serial', 'serial monitor': 'serial',
    servo: 'servo', sweep: 'servo', angle: 'servo', 'servo angle': 'servo', 'servo sweep': 'servo',
    display: 'display', digit: 'display', seg7: 'display', '7seg': 'display', '7-segment': 'display', '7 segment': 'display', 'seven segment': 'display', segment: 'display',
    lcd: 'lcd', screen: 'lcd', 'lcd text': 'lcd',
    distance: 'distance', obstacle: 'distance', ultrasonic: 'distance', sonar: 'distance', near: 'distance', proximity: 'distance', 'parking sensor': 'distance',
    temperature: 'temperature', temp: 'temperature', fan: 'temperature', thermostat: 'temperature', heat: 'temperature',
    fade: 'fade', 'fade out': 'fade', capacitor: 'fade', afterglow: 'fade', rc: 'fade'
  };
  const GOAL_LIST = 'light, series, parallel, button, switch, dimmer, blink, serial, servo, display, lcd, distance, temperature or fade';
  const PART_GOAL = { buzz: 'buzzer', beep: 'buzzer', sound: 'buzzer', buzzer: 'buzzer', motor: 'motor', spin: 'motor', fan: 'motor', 'motor from a pin': 'motor' };
  const DRIVERS = ['npn', 'mosfet', 'relay']; // what lets a pin switch the motor
  function digitalPin(v) {
    const q = parsePoint(typeof v === 'number' ? String(v) : v, true);
    return q && q.term && PINS.includes(q.term) ? pinNo(q.term) : null;
  }
  const goalText = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

  // A goal, checked against the bench: the parts it needs must be there. Throws BBError.
  function normGoal(raw, spec) {
    if (!isObj(raw)) fail('the goal is not an object');
    const tRaw = String(pick(raw, ['type', 'kind']) || '').trim().toLowerCase().replace(/_/g, ' ');
    const type = GOAL_ALIASES[tRaw];
    if (!type) fail(`unknown goal type "${show(tRaw)}" (${GOAL_LIST})`);
    const g = { type };
    const inv = inventory(spec);
    const count = (t, c) => inv.filter((x) => x.type === t && (!c || x.color === c || x.color === 'any')).length;
    const need = (ok, msg) => { if (!ok) fail(msg); };
    const needArduino = () => need(spec.arduino, `a ${type} goal needs the Arduino ("arduino": true)`);
    if (!spec.battery && !spec.arduino) fail('the goal needs power: add "battery": "9V" or "arduino": true');
    let part = PART_GOAL[tRaw] || String(pick(raw, ['part', 'output', 'device']) || '').trim().toLowerCase();
    if ((tRaw === 'transistor' || tRaw === 'relay' || type === 'temperature') && !part) part = spec.motor ? 'motor' : 'led';
    if (['light', 'button', 'switch', 'distance', 'temperature'].includes(type)) {
      g.part = part === 'buzzer' || part === 'motor' || part === 'fan' ? (part === 'fan' ? 'motor' : part) : 'led';
      if (g.part === 'buzzer') need(count('buzzer'), 'the goal needs a buzzer but the parts bin has none (add "buzzer": 1 to "bin")');
      if (g.part === 'motor') need(spec.motor, 'the goal needs the motor but there is none (add "motor": true)');
    }
    const color = pick(raw, ['color', 'colour']);
    if (color != null && color !== 'any' && ['light', 'button', 'switch', 'blink', 'dimmer', 'distance', 'temperature', 'fade'].includes(type)) {
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
    if (((!g.part || g.part === 'led') && !['serial', 'servo', 'display', 'lcd'].includes(type))) {
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
    const pinRaw = pick(raw, ['pin', 'button_pin', 'input_pin', 'in', 'sensor_pin', 'signal_pin', 'servo_pin']);
    const ledRaw = pick(raw, ['led_pin', 'output_pin', 'out', 'ledpin', 'fan_pin', 'motor_pin']);
    const pinOf = (v, what) => { const p = digitalPin(v); if (p == null) fail(`the goal's "${what}" "${show(v)}" is not an Arduino pin (0 to 13, or A0 to A5)`); return p; };
    if (type === 'blink') {
      needArduino();
      g.pin = pinOf(pinRaw != null ? pinRaw : ledRaw != null ? ledRaw : 13, 'pin');
      const both = parseNum(pick(raw, ['ms', 'interval', 'delay', 'period_ms']));
      const on = parseNum(pick(raw, ['on_ms', 'on', 'high_ms'])), off = parseNum(pick(raw, ['off_ms', 'off', 'low_ms']));
      g.on_ms = Math.round(Number.isFinite(on) ? on : Number.isFinite(both) ? both : 1000);
      g.off_ms = Math.round(Number.isFinite(off) ? off : Number.isFinite(both) ? both : g.on_ms);
      if (!(g.on_ms >= 100 && g.on_ms <= 3000 && g.off_ms >= 100 && g.off_ms <= 3000)) fail('the blink goal\'s on_ms and off_ms should each be 100 to 3000');
    } else if (type === 'serial') {
      needArduino();
      const text = goalText(pick(raw, ['text', 'prints', 'message', 'output']), 60);
      if (!text) fail('a serial goal needs "text": what the serial monitor should show');
      g.text = text;
    } else if (type === 'servo') {
      needArduino();
      need(count('servo'), 'a servo goal needs a servo (add "servo": 1 to "bin", or place one in "parts")');
      if (pinRaw != null) g.pin = pinOf(pinRaw, 'pin');
      const sw = pick(raw, ['sweep', 'range']);
      if (sw != null && sw !== false || tRaw === 'sweep' || tRaw === 'servo sweep') {
        const lo = Array.isArray(sw) ? parseNum(sw[0]) : parseNum(pick(raw, ['from', 'min', 'low'])), hi = Array.isArray(sw) ? parseNum(sw[1]) : parseNum(pick(raw, ['to', 'max', 'high']));
        g.sweep = [Number.isFinite(lo) ? Math.round(clamp(lo, 0, 150)) : 0, Number.isFinite(hi) ? Math.round(clamp(hi, 30, 180)) : 180];
        if (g.sweep[1] - g.sweep[0] < 30) fail('a servo sweep should cover 30 degrees or more, like "sweep": [0, 180]');
      } else {
        const a = parseNum(pick(raw, ['angle', 'degrees', 'deg', 'to']));
        if (!(a >= 0 && a <= 180)) fail('a servo goal needs "angle" from 0 to 180 (or "sweep": true)');
        g.angle = Math.round(a);
      }
    } else if (type === 'display') {
      need(count('seg7'), 'a display goal needs a 7-segment display (add "seg7": ["cathode"] to "bin")');
      const d = parseNum(pick(raw, ['digit', 'number', 'shows', 'value', 'n']));
      if (!(Number.isInteger(d) && d >= 0 && d <= 9)) fail('a display goal needs "digit": 0 to 9');
      g.digit = d;
      if (!spec.arduino) need(inv.some((x) => x.type === 'resistor'), 'the display needs a resistor on its COM pin (add "resistor": [220] to "bin")');
    } else if (type === 'lcd') {
      needArduino();
      need(count('lcd'), 'an lcd goal needs the 16x2 I2C display (add "lcd": 1 to "bin")');
      const text = goalText(pick(raw, ['text', 'shows', 'message', 'prints']), 32).replace(/[^ -~]/g, '');
      if (!text) fail('an lcd goal needs "text" in plain English letters: what the display should show (16 characters a row)');
      g.text = text;
    } else if (type === 'distance') {
      needArduino();
      need(count('sonar'), 'a distance goal needs the HC-SR04 ultrasonic sensor (add "sonar": 1 to "bin")');
      const cm = parseNum(pick(raw, ['cm', 'distance', 'below', 'nearer', 'within', 'under']));
      g.cm = Number.isFinite(cm) ? Math.round(cm) : 20;
      if (!(g.cm >= 5 && g.cm <= 200)) fail('a distance goal\'s "cm" should be 5 to 200');
      if (ledRaw != null) g.led_pin = pinOf(ledRaw, 'led_pin');
    } else if (type === 'temperature') {
      needArduino();
      let by = String(pick(raw, ['by', 'sensor', 'with']) || '').toLowerCase();
      by = /dht/.test(by) ? 'dht11' : /tmp|lm|36/.test(by) ? 'tmp36' : count('tmp36') ? 'tmp36' : 'dht11';
      need(count(by), `a temperature goal needs a sensor: add "tmp36": 1 (or "dht11": 1) to "bin"`);
      g.by = by;
      const above = parseNum(pick(raw, ['above', 'over', 'celsius', 'temp', 'temperature', 'c']));
      g.above = Number.isFinite(above) ? Math.round(above) : 30;
      if (!(g.above >= 10 && g.above <= 40)) fail('a temperature goal\'s "above" should be 10 to 40 (°C)');
      if (pinRaw != null) { g.pin = pinOf(pinRaw, 'pin'); if (by === 'tmp36' && g.pin < 14) fail('the TMP36 is read on an analog pin: "pin": "A0" to "A5"'); }
      if (ledRaw != null) g.led_pin = pinOf(ledRaw, 'led_pin');
      if (g.part === 'motor') need(DRIVERS.some((t) => count(t)), 'the fan (the motor) needs more current than a pin gives: add a transistor ("npn": 1) and a resistor of about 1000 ohms to "bin"');
    } else if (type === 'fade') {
      need(count('electrolytic') || count('capacitor'), 'a fade goal needs a capacitor to hold the charge (add "electrolytic": [1000] to "bin")');
      g.by = /button|press/.test(String(pick(raw, ['by', 'with', 'input']) || '').toLowerCase()) ? 'button' : 'switch';
      need(count(g.by), g.by === 'switch' ? 'the fade goal needs a slide switch (add "switch": 1 to "bin")' : 'the fade goal needs a push button (add "button": 1 to "bin")');
      need(inv.some((x) => x.type === 'resistor'), 'the fade goal needs a resistor for the LED (add "resistor": [330] to "bin")');
      const ms = parseNum(pick(raw, ['ms', 'at_least_ms', 'glow_ms', 'time']));
      g.ms = Number.isFinite(ms) ? Math.round(ms) : 300;
      if (!(g.ms >= 100 && g.ms <= 2000)) fail('a fade goal\'s "ms" (how long the LED glows on) should be 100 to 2000');
    } else if ((pinRaw != null || ledRaw != null) && spec.arduino) { // (on a bench with no Arduino, pins mean nothing: the goal is done in wiring)
      if (!['light', 'button', 'switch', 'dimmer'].includes(type)) fail(`a ${type} goal doesn't take an Arduino pin`);
      if (g.part === 'motor') {
        if (type !== 'light') fail('an Arduino pin can\'t drive the motor: it needs far more current than a pin gives. Power the motor from the battery instead');
        need(DRIVERS.some((t) => count(t)), 'an Arduino pin can\'t drive the motor alone: it needs far more current than a pin gives. Add a transistor ("npn": 1) and a resistor of about 1000 ohms to "bin" (or a "relay": 1)');
      }
      if (type === 'light') g.pin = pinOf(pinRaw != null ? pinRaw : ledRaw, 'pin');
      else {
        if (pinRaw != null) {
          const p = pinOf(pinRaw, 'pin');
          if (type === 'dimmer' && p < 14) fail('a dimmer\'s "pin" is the analog input that reads it: A0 to A5');
          g.pin = p;
        }
        if (ledRaw != null) {
          const p = pinOf(ledRaw, 'led_pin');
          if (type === 'dimmer' && !PWM.includes(p)) fail(`pin ${p} can't dim an LED: analogWrite needs a ~ pin (3, 5, 6, 9, 10 or 11)`);
          if (p === g.pin) fail('the goal\'s "pin" and "led_pin" are the same pin');
          g.led_pin = p;
        }
      }
    }
    if (g.part === 'motor' && type === 'light' && g.pin != null && parseBool(pick(raw, ['flyback', 'diode']), false)) {
      need(count('diode'), 'the goal asks for a flyback diode across the motor, but the parts bin has none (add "diode": 1 to "bin")');
      g.flyback = true;
    }
    return g;
  }
  const needsCode = (g) => ['blink', 'serial', 'servo', 'lcd', 'distance', 'temperature'].includes(g.type) || g.pin != null || g.led_pin != null;

  // which parts are the goal's outputs, and whether one is on
  function outputsOf(B, goal) {
    if (goal.part === 'motor') return B.spec.motor ? ['MOTOR'] : [];
    const type = goal.part === 'buzzer' ? 'buzzer' : 'led';
    return [...B.parts.values()].filter((p) => p.type === type && (!goal.color || type !== 'led' || p.color === goal.color)).map((p) => p.id);
  }
  const isOn = (v, id) => { const o = v.parts[id]; return Boolean(o && (o.lit || o.on)); };
  // a problem in a state: a short circuit, a part burning out, a capacitor the wrong way round, a pin giving too much
  function health(v, B, S) {
    if (v.short) return { code: 'short', src: v.shortSrc };
    const typeOfId = (id) => (B.parts.get(id) || {}).type;
    const said = (id, fault, ma) => (typeOfId(id) === 'electrolytic' || fault ? { code: 'capreversed', name: id } : typeOfId(id) === 'npn' || typeOfId(id) === 'mosfet' ? { code: 'qburn', name: id, mA: ma } : { code: 'burn', name: id, mA: ma });
    if (S && S.hurt) return said(S.hurt.id, S.hurt.fault, S.hurt.mA);
    const f = Object.keys(v.parts).find((id) => v.parts[id].fault);
    if (f) return { code: 'capreversed', name: f };
    const b = Object.keys(v.parts).find((id) => v.parts[id].burn);
    if (b) return said(b, false, mA(v.parts[b].I > v.parts[b].peak / 2 ? v.parts[b].I : v.parts[b].peak));
    if (v.overload.length) return { code: 'pin', pin: pinLabel(v.overload[0]), mA: mA(v.pinPeak[v.overload[0]]) };
    return null;
  }
  const pinLabel = (p) => (p < 14 ? String(p) : 'A' + (p - 14));
  const SPREAD = new Set(['switch', 'pot', 'seg7', 'rgb']); // parts whose legs may share a strip, or stay unused

  // why nothing lights: the most useful thing to say about this build
  function diagnose(B, S, ids) {
    const parts = [...B.parts.values()].filter((p) => !TYPES[p.type].dock);
    const order = ids.map((id) => B.parts.get(id)).filter((p) => p && !TYPES[p.type].dock).concat(parts.filter((p) => !ids.includes(p.id)));
    for (const p of order) {
      if (SPREAD.has(p.type)) continue;
      if (new Set(p.legs.map((l) => B.uf[l])).size < p.legs.length) return { code: 'samestrip', name: p.id };
    }
    for (const p of order) {
      if (SPREAD.has(p.type)) continue;
      for (let i = 0; i < p.at.length; i++) if ((B.attach.get(p.legs[i]) || 0) < 2 && !isTermNode(B, p.legs[i])) return { code: 'alone', name: p.id, hole: p.at[i] };
    }
    for (const w of B.build.wires) {
      for (const end of [w.from, w.to]) if (HOLES.has(end) && (B.attach.get(B.pts.get(B.nodeOf(end))) || 0) < 2) return { code: 'wirealone', hole: end };
    }
    for (const id of ids) {
      const p = B.parts.get(id);
      if (!p || (p.type !== 'led' && p.type !== 'buzzer' && p.type !== 'seg7')) continue;
      const v = S.view({ flip: new Set([id]) });
      if (isOn(v, id)) return p.type === 'seg7' ? { code: 'common', name: id, common: p.common } : { code: 'reversed', name: id };
    }
    // a battery and the Arduino on one circuit need their grounds joined
    const used = (t) => (B.attach.get(B.pts.get(t)) || 0) > 0;
    if (B.spec.battery && B.spec.arduino && used('BAT+') && PINS.some(used) && B.uf[B.pts.get('BAT-')] !== B.uf[B.pts.get('GND')]) return { code: 'ground' };
    const powered = (B.spec.battery && ['BAT+', 'BAT-'].every(used)) || (B.spec.arduino && POWER.concat(PINS).some(used));
    if (!powered) return { code: 'nopower' };
    return { code: 'dark' };
  }
  const isTermNode = (B, node) => isTerm(B.names[node]);

  // the LED (or output) follows this pin: it changes when the pin goes high or low
  function drivenBy(S, id, pin) {
    const force = (level) => { const pins = S.pins.map((x) => Object.assign({}, x)); pins[pin] = { mode: OUTPUT, level, duty: null, freq: 0 }; return S.view({ pins }); };
    return isOn(force(1), id) !== isOn(force(0), id);
  }
  // a diode across the motor, pointing back at its + side (it takes the motor's kick when it stops)
  function hasFlyback(B) {
    if (!B.spec.motor) return false;
    const mp = B.uf[B.pts.get('M+')], mm = B.uf[B.pts.get('M-')];
    return [...B.parts.values()].some((p) => p.type === 'diode' && B.uf[p.legs[1]] === mp && B.uf[p.legs[0]] === mm);
  }
  const partsOf = (B, t) => [...B.parts.values()].filter((p) => p.type === t);

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
    const noOut = () => no(goal.part === 'buzzer' ? { code: 'nobuzzer' } : goal.part === 'motor' ? { code: 'motor' } : { code: 'noled' });

    if (goal.type === 'light' || goal.type === 'series' || goal.type === 'parallel') {
      if (!ids.length) return noOut();
      let first = null;
      for (const pressAll of [false, true]) {
        const S = fresh();
        if (pressAll) { if (!hasType('button')) break; S.setAll('press', true); }
        const bad = useCode ? timed(S, 1500) : B.caps.length ? timed(S, 300) : null;
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B, S);
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
          if (lit.length >= goal.count) {
            if (goal.flyback && !hasFlyback(B)) { first = first || { code: 'flyback' }; continue; }
            return ok;
          }
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
      if (!ids.length) return noOut();
      // the button up, down, up again (the sketch running all along); a switch one way, the other, and back
      const S = fresh();
      const states = [];
      const first = goal.type === 'button' ? false : !([...B.parts.values()].find((p) => p.type === 'switch') || {}).on;
      for (const x of [first, !first, first]) {
        S.setAll(kind, x);
        const bad = useCode ? timed(S, 1200) : B.caps.length ? timed(S, 300) : null;
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B, S);
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
        const bad = useCode ? timed(S, 500) : B.caps.length ? timed(S, 300) : null;
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B, S);
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

    if (goal.type === 'servo') {
      const sv = partsOf(B, 'servo');
      if (!sv.length) return no({ code: 'noservo' });
      const S = fresh();
      const lo = goal.sweep ? goal.sweep[0] : 0, hi = goal.sweep ? goal.sweep[1] : 180;
      const visits = sv.map(() => ({ n: 0, last: null }));
      const T = goal.sweep ? 12000 : 2500;
      for (let t = 0; t < T; t += 50) {
        const bad = timed(S, 50);
        if (bad) return no(bad);
        sv.forEach((p, i) => {
          const a = S.servo[p.id], w = visits[i];
          const at = a <= lo + 8 ? 'lo' : a >= hi - 8 ? 'hi' : null;
          if (at && at !== w.last) { w.n++; w.last = at; }
        });
      }
      const h = health(S.view(), B, S);
      if (h) return no(h);
      let why = null;
      for (let i = 0; i < sv.length; i++) {
        const p = sv[i];
        if (goal.pin != null && !B.mods.servo.find((m) => m.id === p.id).pins.includes(goal.pin)) { why = why || { code: 'servopin', name: p.id, pin: pinLabel(goal.pin) }; continue; }
        if (!S.servoSeen[p.id]) { why = why || ((S.view().parts[p.id] || {}).powered ? { code: 'servosig', name: p.id } : { code: 'servopower', name: p.id }); continue; }
        const a = S.servo[p.id];
        if (goal.sweep) { if (visits[i].n >= 3) return ok; why = why || { code: 'servosweep', name: p.id, lo, hi }; continue; }
        if (Math.abs(a - goal.angle) <= 4) return ok;
        why = why || { code: 'servoangle', name: p.id, at: Math.round(a), want: goal.angle };
      }
      return no(why);
    }

    if (goal.type === 'display') {
      const ds = partsOf(B, 'seg7');
      if (!ds.length) return no({ code: 'nodisplay' });
      const S = fresh();
      const bad = useCode ? timed(S, 1500) : null;
      if (bad) return no(bad);
      const v = S.view();
      const h = health(v, B, S);
      if (h) return no(h);
      for (const p of ds) if (v.parts[p.id].digit === goal.digit) return ok;
      const p = ds.find((x) => v.parts[x.id].lit);
      if (p) return no({ code: 'digit', name: p.id, segs: SEGS.filter((s) => s !== 'dp' && v.parts[p.id].segs[s].lit).join(''), want: goal.digit, want_segs: DIGITS[goal.digit][0] });
      const d = diagnose(B, S, ds.map((x) => x.id));
      return no(d.code === 'dark' ? { code: 'segdark', name: ds[0].id } : d);
    }

    if (goal.type === 'lcd') {
      const ls = partsOf(B, 'lcd');
      if (!ls.length) return no({ code: 'nolcd' });
      const S = fresh();
      const bad = timed(S, 2000);
      if (bad) return no(bad);
      const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const want = norm(goal.text);
      let why = null;
      for (const p of ls) {
        const m = B.mods.lcd.find((x) => x.id === p.id);
        const rows = S.lcdText(p.id), d = S.lcd[p.id];
        if (!(S.view().parts[p.id] || {}).powered) { why = why || { code: 'lcdpower', name: p.id }; continue; }
        if (!m.i2c) { why = why || { code: 'lcdwires', name: p.id }; continue; }
        if (!d || !d.on) { why = why || { code: 'lcdinit', name: p.id }; continue; }
        if (!d.disp) { why = why || { code: 'lcdoff', name: p.id }; continue; }
        if ([norm(rows[0]), norm(rows[1]), norm(rows[0] + ' ' + rows[1])].some((r) => r.includes(want))) return ok;
        why = why || { code: 'lcdtext', name: p.id, shows: (rows[0].trim() + ' / ' + rows[1].trim()).replace(/^ \/ $/, ''), text: goal.text };
      }
      return no(why);
    }

    if (goal.type === 'distance' || goal.type === 'temperature') {
      const dist = goal.type === 'distance';
      const sensors = dist ? partsOf(B, 'sonar') : partsOf(B, goal.by);
      if (!sensors.length) return no({ code: dist ? 'nosonar' : goal.by === 'tmp36' ? 'notmp' : 'nodht' });
      if (!ids.length) return noOut();
      const kind = dist ? 'cm' : 'temp';
      const yes = dist ? Math.max(3, Math.round(goal.cm * 0.6)) : goal.above + 6;           // the output should be on
      const nope = dist ? Math.min(400, Math.round(goal.cm * 1.6) + 5) : goal.above - 6;     // and off
      const S = fresh();
      const seen = [];
      for (const x of [nope, yes, nope, yes]) {
        S.setAll(kind, x);
        const bad = timed(S, dist ? 700 : goal.by === 'dht11' ? 4500 : 1500);
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B, S);
        if (h) return no(h);
        seen.push(v);
      }
      let cand = ids.filter((id) => isOn(seen[1], id) && isOn(seen[3], id) && !isOn(seen[0], id) && !isOn(seen[2], id));
      const out = goal.led_pin;
      if (out != null) {
        const driven = cand.filter((id) => drivenBy(S, id, out));
        if (cand.length && !driven.length) return no({ code: 'pinout', pin: pinLabel(out) });
        cand = driven;
      }
      if (cand.length) return ok;
      const v = seen[3];
      const unpowered = sensors.find((p) => !(v.parts[p.id] || {}).powered && TYPES[p.type].dock);
      if (unpowered) return no({ code: 'modpower', name: unpowered.id });
      if (dist && !sensors.some((p) => S.sonar[p.id] && S.sonar[p.id].t1 != null)) return no({ code: 'noping', name: sensors[0].id });
      const onYes = ids.some((id) => isOn(seen[1], id) || isOn(seen[3], id)), onNo = ids.some((id) => isOn(seen[0], id) || isOn(seen[2], id));
      if (onYes && onNo) return no({ code: dist ? 'nearalways' : 'tempalways', cm: goal.cm, above: goal.above });
      if (onNo) return no({ code: dist ? 'nearflip' : 'tempflip', cm: goal.cm, above: goal.above });
      const d = diagnoseIn(B, ids, kind, yes);
      return no(d.code === 'dark' ? { code: dist ? 'neardark' : 'tempdark', cm: goal.cm, above: goal.above } : d);
    }

    if (goal.type === 'fade') {
      if (!ids.length) return no({ code: 'noled' });
      if (!hasType('electrolytic') && !hasType('capacitor')) return no({ code: 'nocap' });
      if (!hasType(goal.by)) return no({ code: goal.by === 'button' ? 'nobutton' : 'noswitch' });
      const kind = goal.by === 'button' ? 'press' : 'on';
      let why = null;
      // the switch on (or the button held) for 2 s, then off: the LED still glows ms later, and goes out in the end
      for (const pol of goal.by === 'button' ? [true] : [true, false]) {
        const S = fresh();
        S.setAll(kind, !pol);
        let bad = timed(S, 300);
        if (bad) return no(bad);
        S.setAll(kind, pol);
        bad = timed(S, 2000);
        if (bad) return no(bad);
        const v = S.view();
        const h = health(v, B, S);
        if (h) return no(h);
        const lit = ids.filter((id) => isOn(v, id));
        if (!lit.length) { why = why || diagnoseIn(B, ids, kind, pol); continue; }
        S.setAll(kind, !pol);
        let out = null;
        for (let t = 25; t <= goal.ms; t += 25) {
          bad = timed(S, 25);
          if (bad) return no(bad);
          if (!lit.some((id) => isOn(S.view(), id))) { out = t; break; }
        }
        if (out != null) { why = { code: 'fadequick', ms: out, want: goal.ms }; continue; }
        let gone = false;
        for (let t = 0; t < 15000 && !gone; t += 500) {
          bad = timed(S, 500);
          if (bad) return no(bad);
          gone = !lit.some((id) => isOn(S.view(), id));
        }
        if (!gone) { why = why || { code: 'fadestays' }; continue; }
        const h2 = health(S.view(), B, S);
        if (h2) return no(h2);
        return ok;
      }
      return no(why || { code: 'dark' });
    }
    return no({ code: 'dark' });
  }
  function diagnoseIn(B, ids, kind, x) {
    const S = session(B);
    if (kind && x !== 0) S.setAll(kind, x);
    if (B.program || B.caps.length) S.run(800);
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
        if (at.some((h) => !h || used.has(h))) { L.failed = true; return null; }
        const k = VARIANT[type];
        const want = props && k ? props[k] : null;
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
        if ((type === 'capacitor' || type === 'electrolytic') && !p.uf) p.uf = it.uf || (type === 'capacitor' ? 0.1 : 1000);
        if (type === 'seg7') p.common = it.common || 'cathode';
        if (type === 'pot') { p.ohms = p.ohms || 10000; p.knob = p.knob != null ? p.knob : 0.5; }
        if (type === 'ldr') p.light = p.light != null ? p.light : 0.5;
        if (type === 'switch') p.on = p.on != null ? p.on : false;
        if (type === 'zener') p.volts = p.volts || 5.1;
        if (type === 'tmp36') p.temp = p.temp != null ? p.temp : 25;
        if (type === 'sonar') p.cm = p.cm || 100;
        if (type === 'pir') p.motion = Boolean(p.motion);
        if (type === 'dht11') { p.temp = p.temp != null ? p.temp : 25; p.hum = p.hum || 50; }
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
  const has = (spec, t) => inventory(spec).some((x) => x.type === t);
  // the biggest capacitor the bench has (an "any" one: 1000 µF)
  function capChoice(spec) {
    const cs = inventory(spec).filter((x) => x.type === 'electrolytic' || x.type === 'capacitor').map((x) => ({ type: x.type, uf: x.uf || (x.type === 'electrolytic' ? 1000 : 1) }));
    return cs.sort((a, b) => b.uf - a.uf)[0] || null;
  }

  // the sketches the reference builds run
  const SEG_PIN = { a: 2, b: 3, c: 4, d: 5, e: 6, f: 7, g: 8 };
  const SEG_HOLE = { g: 'a10', f: 'a11', a: 'a13', b: 'a14', e: 'j10', d: 'j11', c: 'j13', dp: 'j14' }; // beside the display's pins, at c10
  const SK = {
    on: (p) => `void setup() {\n  pinMode(${p}, OUTPUT);\n  digitalWrite(${p}, HIGH);\n}\n\nvoid loop() {\n}\n`,
    blink: (p, on, off) => `void setup() {\n  pinMode(${p}, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(${p}, HIGH);\n  delay(${on});\n  digitalWrite(${p}, LOW);\n  delay(${off});\n}\n`,
    follow: (inp, out, when) => `const int inputPin = ${inp};\nconst int ledPin = ${out};\n\nvoid setup() {\n  pinMode(inputPin, INPUT_PULLUP);\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {\n  // with INPUT_PULLUP, the pin reads LOW while the button is pressed or the switch is on\n  if (digitalRead(inputPin) == ${when === 'released' ? 'HIGH' : 'LOW'}) {\n    digitalWrite(ledPin, HIGH);\n  } else {\n    digitalWrite(ledPin, LOW);\n  }\n}\n`,
    dim: (a, out) => `const int sensorPin = A${a - 14};\nconst int ledPin = ${out};\n\nvoid setup() {\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {\n  int reading = analogRead(sensorPin);   // 0 to 1023\n  analogWrite(ledPin, reading / 4);      // 0 to 255\n}\n`,
    night: (a, out, dark) => `const int sensorPin = A${a - 14};\nconst int ledPin = ${out};\n\nvoid setup() {\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {\n  int light = analogRead(sensorPin);   // low in the dark, high in bright light\n  if (light ${dark ? '<' : '>'} 500) {\n    digitalWrite(ledPin, HIGH);\n  } else {\n    digitalWrite(ledPin, LOW);\n  }\n}\n`,
    serial: (text) => `void setup() {\n  Serial.begin(9600);\n  Serial.println("${text.replace(/["\\]/g, ' ')}");\n}\n\nvoid loop() {\n}\n`,
    servo: (p, a) => `#include <Servo.h>\n\nServo arm;\n\nvoid setup() {\n  arm.attach(${p});   // the servo's orange wire\n  arm.write(${a});    // degrees, 0 to 180\n}\n\nvoid loop() {\n}\n`,
    sweep: (p, lo, hi) => `#include <Servo.h>\n\nServo arm;\n\nvoid setup() {\n  arm.attach(${p});\n}\n\nvoid loop() {\n  for (int angle = ${lo}; angle <= ${hi}; angle++) {\n    arm.write(angle);\n    delay(10);\n  }\n  for (int angle = ${hi}; angle >= ${lo}; angle--) {\n    arm.write(angle);\n    delay(10);\n  }\n}\n`,
    digit: (d, anode) => {
      const on = DIGITS[d][0], lit = anode ? 'LOW' : 'HIGH', dark = anode ? 'HIGH' : 'LOW';
      return `// segments a to g on pins 2 to 8${anode ? ' (common anode: LOW lights a segment)' : ''}\nvoid setup() {\n  for (int pin = 2; pin <= 8; pin++) {\n    pinMode(pin, OUTPUT);\n  }\n` + 'abcdefg'.split('').map((s) => `  digitalWrite(${SEG_PIN[s]}, ${on.includes(s) ? lit : dark});   // ${s}\n`).join('') + '}\n\nvoid loop() {\n}\n';
    },
    lcd: (text) => `#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\n\nLiquidCrystal_I2C lcd(0x27, 16, 2);\n\nvoid setup() {\n  lcd.init();\n  lcd.backlight();\n  lcd.setCursor(0, 0);\n` + (text.length > 16 ? `  lcd.print("${text.slice(0, 16)}");\n  lcd.setCursor(0, 1);\n  lcd.print("${text.slice(16).trim()}");\n` : `  lcd.print("${text}");\n`) + '}\n\nvoid loop() {\n}\n',
    near: (cm, out) => `const int trigPin = 9;\nconst int echoPin = 10;\nconst int ledPin = ${out};\n\nvoid setup() {\n  pinMode(trigPin, OUTPUT);\n  pinMode(echoPin, INPUT);\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(trigPin, LOW);\n  delayMicroseconds(2);\n  digitalWrite(trigPin, HIGH);   // a 10 microsecond pulse starts a measurement\n  delayMicroseconds(10);\n  digitalWrite(trigPin, LOW);\n  long duration = pulseIn(echoPin, HIGH);   // the echo's trip, there and back\n  int cm = duration * 0.034 / 2;\n  if (cm < ${cm}) {\n    digitalWrite(ledPin, HIGH);\n  } else {\n    digitalWrite(ledPin, LOW);\n  }\n  delay(60);\n}\n`,
    thermo: (a, out, above) => `const int sensorPin = A${a - 14};\nconst int fanPin = ${out};\n\nvoid setup() {\n  pinMode(fanPin, OUTPUT);\n}\n\nvoid loop() {\n  int reading = analogRead(sensorPin);\n  float volts = reading * 5.0 / 1023;\n  float tempC = (volts - 0.5) * 100;   // the TMP36: 0.5 V at 0 °C, 10 mV a degree\n  if (tempC > ${above}) {\n    digitalWrite(fanPin, HIGH);\n  } else {\n    digitalWrite(fanPin, LOW);\n  }\n  delay(200);\n}\n`,
    dht: (p, out, above) => `#include <DHT.h>\n\nDHT dht(${p}, DHT11);\nconst int fanPin = ${out};\n\nvoid setup() {\n  dht.begin();\n  pinMode(fanPin, OUTPUT);\n}\n\nvoid loop() {\n  float tempC = dht.readTemperature();\n  if (tempC > ${above}) {\n    digitalWrite(fanPin, HIGH);\n  } else {\n    digitalWrite(fanPin, LOW);\n  }\n  delay(2000);   // a DHT11 gives a new reading every 2 seconds\n}\n`
  };

  const SKELETON = 'void setup() {\n  \n}\n\nvoid loop() {\n  \n}\n';
  // the start of a sketch for a goal: the libraries it needs, already included
  function starter(goal) {
    if (goal.type === 'light' && goal.pin != null) return SK.on(goal.pin);
    if (goal.type === 'servo') return '#include <Servo.h>\n\nServo arm;\n\n' + SKELETON;
    if (goal.type === 'lcd') return '#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\n\nLiquidCrystal_I2C lcd(0x27, 16, 2);\n\n' + SKELETON;
    if (goal.type === 'temperature' && goal.by === 'dht11') return '#include <DHT.h>\n\nDHT dht(2, DHT11);\n\n' + SKELETON;
    return SKELETON;
  }

  // the motor, switched from a pin through a transistor (base or gate at col 10-12) or the relay module
  function motorStage(spec, L, pin, flyback, driver) {
    const bat = Boolean(spec.battery);
    const sup = bat ? 'BAT+' : '5V';
    if (bat) L.wire('BAT-', 'GND');
    if (driver === 'relay') {
      const k = L.part('relay', []);
      if (!k) return;
      L.wire('D' + pin, k.id + '.IN'); L.wire('5V', k.id + '.VCC'); L.wire(k.id + '.GND', 'GND');
      L.wire(sup, k.id + '.COM'); L.wire(k.id + '.NO', 'M+'); L.wire('M-', bat ? 'BAT-' : 'GND');
      return;
    }
    return { sup, rest: (r) => {
      // driver npn: E B C at h10 h11 h12; mosfet: G D S
      L.part(driver, ['h10', 'h11', 'h12']);
      L.part('resistor', driver === 'npn' ? ['g6', 'g11'] : ['g6', 'g10'], { ohms: r });
      L.wire('D' + pin, 'j6');
      L.wire(driver === 'npn' ? 'j10' : 'j12', 'GND');
      L.wire(sup, 'a20'); L.wire('b20', 'M+'); L.wire('M-', 'a24'); L.wire('c24', driver === 'npn' ? 'j12' : 'j11');
      if (flyback || has(spec, 'diode')) L.part('diode', ['d24', 'd20']);
    } };
  }
  function motorCandidates(spec, goal, pin, code, extra) {
    const out = [];
    for (const d of DRIVERS) {
      if (!has(spec, d)) continue;
      out.push((r) => {
        const L = Layout(spec);
        if (extra) extra(L);
        const st = motorStage(spec, L, pin, goal.flyback, d);
        if (st) st.rest(d === 'npn' ? (r >= 220 && r <= 4700 ? r : 1000) : r);
        return Object.assign(L, { code });
      });
    }
    return out;
  }

  // candidate builds for a goal, best first: functions of a resistor value -> { build, info }
  function candidates(spec, goal) {
    const out = [];
    const bat = Boolean(spec.battery);
    const power = (L) => { if (bat) { L.wire('BAT+', L.point('+B', 2)); L.wire('BAT-', L.point('-B', 3)); } else { L.wire('5V', L.point('+B', 2)); L.wire('GND', L.point('-B', 3)); } };
    const outPart = (goal) => (goal.part === 'buzzer' ? { type: 'buzzer' } : ledFor(goal));
    const t = goal.type;
    if (t === 'light' && goal.pin != null && goal.part === 'motor') return motorCandidates(spec, goal, goal.pin, SK.on(goal.pin));
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
    if (t === 'servo') {
      const pin = goal.pin != null ? goal.pin : 9;
      out.push(() => {
        const L = Layout(spec);
        const sv = L.part('servo', []);
        if (sv) { L.wire(sv.id + '.GND', 'GND'); L.wire(sv.id + '.VCC', '5V'); L.wire(sv.id + '.SIG', 'D' + pin); }
        return Object.assign(L, { code: goal.sweep ? SK.sweep(pin, goal.sweep[0], goal.sweep[1]) : SK.servo(pin, goal.angle) });
      });
      return out;
    }
    if (t === 'display') {
      out.push((r) => {
        const L = Layout(spec);
        const d = L.part('seg7', foot('seg7', 'c10'));
        if (!d) return L;
        const anode = d.common === 'anode';
        L.part('resistor', ['a12', 'a16'], { ohms: r }); // on the COM pin
        if (spec.arduino) {
          L.wire('b16', anode ? '5V' : 'GND');
          'abcdefg'.split('').forEach((s) => L.wire(SEG_HOLE[s], 'D' + SEG_PIN[s]));
          return Object.assign(L, { code: SK.digit(goal.digit, anode) });
        }
        // with a battery: the digit's segments wired straight to the other side
        const hi = bat ? 'BAT+' : '5V', lo = bat ? 'BAT-' : 'GND';
        L.wire('b16', anode ? hi : lo);
        DIGITS[goal.digit][0].split('').forEach((s) => L.wire(SEG_HOLE[s], anode ? lo : hi));
        return L;
      });
      return out;
    }
    if (t === 'lcd') {
      out.push(() => {
        const L = Layout(spec);
        const d = L.part('lcd', []);
        if (d) { L.wire(d.id + '.GND', 'GND'); L.wire(d.id + '.VCC', '5V'); L.wire(d.id + '.SDA', 'A4'); L.wire(d.id + '.SCL', 'A5'); }
        return Object.assign(L, { code: SK.lcd(goal.text) });
      });
      return out;
    }
    if (t === 'distance') {
      const ledPin = goal.led_pin != null ? goal.led_pin : 13;
      out.push((r) => {
        const L = Layout(spec);
        const u = L.part('sonar', []);
        if (u) { L.wire(u.id + '.VCC', '5V'); L.wire(u.id + '.GND', 'GND'); L.wire(u.id + '.TRIG', 'D9'); L.wire(u.id + '.ECHO', 'D10'); }
        L.chain([{ type: 'resistor', props: { ohms: r } }, outPart(goal)], 4, 'D' + ledPin, 'GND');
        return Object.assign(L, { code: SK.near(goal.cm, ledPin) });
      });
      return out;
    }
    if (t === 'temperature') {
      const outPin = goal.led_pin != null ? goal.led_pin : goal.part === 'motor' ? 9 : 13;
      const a = goal.pin != null ? goal.pin : goal.by === 'tmp36' ? 14 : 2;
      const sensor = (L) => {
        if (goal.by === 'tmp36') { L.part('tmp36', ['h3', 'h4', 'h5']); L.wire('5V', 'j3'); L.wire('j4', pinName(a)); L.wire('j5', 'GND'); }
        else { const d = L.part('dht11', []); if (d) { L.wire(d.id + '.VCC', '5V'); L.wire(d.id + '.GND', 'GND'); L.wire(d.id + '.DATA', pinName(a)); } }
      };
      const code = goal.by === 'tmp36' ? SK.thermo(a, outPin, goal.above) : SK.dht(a, outPin, goal.above);
      if (goal.part === 'motor') return motorCandidates(spec, goal, outPin, code, sensor);
      out.push((r) => { const L = Layout(spec); sensor(L); L.chain([{ type: 'resistor', props: { ohms: r } }, outPart(goal)], 14, 'D' + outPin, 'GND'); return Object.assign(L, { code }); });
      return out;
    }
    if (t === 'fade') {
      const cap = capChoice(spec);
      out.push((r) => {
        const L = Layout(spec); power(L);
        // + -> the switch (or button) -> strip X; the capacitor from X to -; a resistor and the LED from X to -
        let x;
        if (goal.by === 'switch') { L.part('switch', ['h3', 'h4', 'h5'], { on: false }); x = 4; }
        else { L.part('button', ['h3', 'h5']); x = 5; }
        L.wire(L.point('+B', 3), 'j3');
        if (cap) L.part(cap.type, ['f' + x, 'f' + (x + 2)], { uf: cap.uf });
        L.wire('j' + (x + 2), L.point('-B', x + 2));
        L.part('resistor', ['g' + x, 'g' + (x + 5)], { ohms: r });
        L.part('led', ['h' + (x + 5), 'h' + (x + 6)], { color: goal.color || 'any' });
        L.wire('j' + (x + 6), L.point('-B', x + 6));
        return L;
      });
      return out;
    }
    return out;
  }
  const pinLabelC = (p) => (p < 14 ? String(p) : 'A' + (p - 14));
  // a rigid part's holes from its first leg's
  const foot = (type, h) => { const h0 = HOLES.get(h); return TYPES[type].foot.map(([dx, dy]) => holeAt(h0.x + dx, h0.y + dy)); };

  // A working build for the goal from the bench's own parts (start parts and bin), proved by the simulator:
  // { build, info } or { reason } (why none works, for the AI to repair).
  function reference(spec, goal) {
    const vals = resistorChoices(spec);
    const fns = candidates(spec, goal);
    let reason = '';
    for (const make of fns) {
      for (const r of (vals.length ? vals : [0]).slice(0, goal.type === 'fade' ? 6 : 12)) {
        const L = make(r);
        if (L.failed) { reason = reason || (L.missing ? `the parts bin is missing ${L.missing} (add it to "bin")` : 'the parts do not fit on the board'); continue; }
        const usesR = L.parts.some((p) => p.type === 'resistor');
        // the starter code first, if it already does the job
        const codes = L.code ? (spec.code && spec.code.trim() ? [spec.code, L.code] : [L.code]) : [spec.code || ''];
        for (const code of codes) {
          const build = L.build(code);
          const res = evaluate(spec, goal, build);
          if (res.ok) return { build, info: { ohms: usesR ? (L.parts.find((p) => p.type === 'resistor' && p.ohms !== 10000) || L.parts.find((p) => p.type === 'resistor')).ohms : null, color: (L.parts.find((p) => p.type === 'led') || {}).color || null, driver: (L.parts.find((p) => DRIVERS.includes(p.type)) || {}).type || null } };
          if (!reason && res.why) reason = whyText(res.why, spec, r);
        }
        if (!usesR) break;
      }
    }
    if (!vals.length && fns.length && ['light', 'series', 'parallel', 'button', 'switch', 'dimmer', 'blink', 'distance', 'display', 'fade'].includes(goal.type) && goal.part !== 'motor') {
      return { reason: 'the parts bin has no resistor, and an LED needs one in series (add "resistor": [220] to "bin")' };
    }
    return { reason: reason || 'no build from the parts bin meets the goal' };
  }
  // a check's reason in plain English (for the server and the debug log)
  function whyText(why, spec, r) {
    const ohm = r ? ` (tried ${r} ohms)` : '';
    switch (why.code) {
      case 'short': return 'it makes a short circuit';
      case 'burn': return `${why.name || 'an LED'} burns out: ${why.mA} mA${ohm}; the bin needs a bigger resistor`;
      case 'qburn': return `the transistor carries too much current${ohm}`;
      case 'capreversed': return 'the electrolytic capacitor ends up the wrong way round';
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
      case 'motor': return 'the motor does not turn';
      case 'flyback': return 'there is no flyback diode across the motor';
      case 'fadequick': return `the LED goes out ${why.ms} ms after the switch opens, before ${why.want} ms: put a bigger capacitor (1000 or 2200 µF) in the bin, or ask for a shorter "ms"`;
      case 'fadestays': return 'the LED never goes out after the switch opens';
      case 'digit': return `the display shows segments ${why.segs}, not the digit ${why.want}`;
      case 'segdark': return 'no segment of the display lights: the bin may need a resistor of about 220 ohms';
      default: return why.code;
    }
  }

  // A task: the bench and its goal, checked: the goal's parts are in the bin, some build from them meets it
  // (proved by the simulator), and the bench doesn't meet it as it starts.
  function normTask(rawSpec, rawGoal) {
    const spec = normSpec(rawSpec);
    const goal = normGoal(rawGoal, spec);
    // a goal worked through code, with no starter sketch: lighting from a pin comes with the sketch that turns
    // the pin on (the build is the task); the others start from an empty setup() and loop(), the libraries included
    if (needsCode(goal) && !spec.code.trim()) spec.code = starter(goal);
    const ref = reference(spec, goal);
    if (!ref.build) fail('no build from the bench\'s parts meets the goal: ' + ref.reason);
    if (evaluate(spec, goal, startBuild(spec)).ok) fail('the bench already meets the goal as it starts: leave something for the learner to build or write');
    return { spec: specOut(spec), goal };
  }
  // A block: a bench to play with. If it has parts placed with something to see, some setting must make it work.
  function normBlock(raw) {
    const spec = normSpec(raw);
    const B = bench(spec, startBuild(spec));
    const shows = (p) => ['led', 'buzzer', 'seg7', 'rgb'].includes(p.type);
    const modWired = (p) => TYPES[p.type].dock && spec.wires.some((w) => w.from.startsWith(p.id + '.') || w.to.startsWith(p.id + '.'));
    const outs = [...B.parts.values()].filter(shows).map((p) => p.id).concat(spec.motor && spec.wires.some((w) => /^M[+-]$/.test(w.from) || /^M[+-]$/.test(w.to)) ? ['MOTOR'] : []);
    // a module counts when there's a sketch to work it (a wired module with no sketch is a bench to program);
    // a sonar when the sketch reads it with pulseIn()
    const mods = B.program ? [...B.parts.values()].filter((p) => (['servo', 'lcd', 'relay'].includes(p.type) || (p.type === 'sonar' && /pulseIn/.test(spec.code))) && modWired(p)) : [];
    const wired = spec.parts.length && spec.wires.length;
    if ((outs.length || mods.length) && wired) {
      const inputs = [...B.parts.values()].filter((p) => ['button', 'switch', 'pot', 'ldr', 'sonar', 'tmp36', 'dht11', 'pir'].includes(p.type));
      const ways = [[false, 0], [true, 1], [true, 0], [false, 1]];
      const busy = (S) => mods.some((p) => (p.type === 'servo' && S.servoSeen[p.id]) || (p.type === 'lcd' && S.lcdText(p.id).join('').trim()) || (p.type === 'relay' && S.clicks));
      // and a sonar the sketch reads must measure, whatever else lights
      const sonars = mods.filter((p) => p.type === 'sonar');
      const measured = new Set();
      let works = false;
      for (const [pr, k] of ways) {
        const S = session(B);
        S.record = [];
        inputs.forEach((p) => {
          if (p.type === 'button') S.set('press', p.id, pr);
          if (p.type === 'switch') S.set('on', p.id, pr);
          if (p.type === 'pot') S.set('knob', p.id, k);
          if (p.type === 'ldr') S.set('light', p.id, k);
          if (p.type === 'sonar') S.set('cm', p.id, k ? 8 : 250);
          if (p.type === 'tmp36' || p.type === 'dht11') S.set('temp', p.id, k ? 40 : 12);
          if (p.type === 'pir') S.set('motion', p.id, pr);
        });
        if (B.program || B.caps.length) {
          // a capacitor bench with no sketch: some time for it to charge
          S.run(2500, 2e6);
          if (S.vm && S.vm.error) fail('the starter code stops with an error: ' + S.vm.error.message);
          if (S.record.some((r) => outs.some((id) => isOn(S.view({ pins: r.pins }), id)))) works = true;
        }
        sonars.forEach((p) => { if (S.sonar[p.id] && S.sonar[p.id].t1 != null) measured.add(p.id); });
        const v = S.view();
        if (outs.some((id) => isOn(v, id)) || busy(S)) works = true;
        if (works && measured.size === sonars.length) break;
      }
      const deaf = sonars.find((p) => !measured.has(p.id));
      if (deaf) fail(modWhy(deaf, B));
      if (!works && (outs.length || mods.length > sonars.length)) {
        const d = diagnose(B, session(B), outs);
        const pinWire = spec.wires.map((w) => [w.from, w.to].find((e) => PINS.includes(e))).find(Boolean);
        if (!B.program && pinWire && d.code === 'dark') fail(`the parts are wired to the Arduino's pin ${pinLabel(pinNo(pinWire))}, but there is no "code" to turn that pin on: add a sketch with pinMode(${pinLabel(pinNo(pinWire))}, OUTPUT); and digitalWrite(${pinLabel(pinNo(pinWire))}, HIGH);`);
        if (!outs.length) fail(modWhy(mods.find((p) => p.type !== 'sonar'), B));
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
      const wiredPin = (p) => (B.attach.get(B.pts.get(pinName(p))) || 0) > 0;
      if (outPins.size && ![...outPins].some(wiredPin)) {
        const p = [...outPins][0];
        fail(`the sketch works pin ${pinLabel(p)}, but nothing on the bench is wired to it: wire the LED's resistor to "${pinName(p)}" (not to "5V")`);
      }
    }
    return specOut(spec);
  }
  // why a wired module never does anything
  function modWhy(p, B) {
    const pw = session(B).view().parts[p.id] || {};
    const order = ` (its pins, in order: ${TYPES[p.type].pins.join(', ')}; wire them by name, like "${p.id}.${TYPES[p.type].pins[0]}")`;
    if (!pw.powered) return `${p.id} has no power: wire ${p.id}.VCC to "5V" and ${p.id}.GND to "GND"` + order;
    if (p.type === 'servo') return `${p.id} never moves: wire ${p.id}.SIG to a pin and add code with #include <Servo.h>, attach() and write()`;
    if (p.type === 'lcd') return `${p.id} never shows anything: wire SDA to "A4" and SCL to "A5", and add code that calls lcd.init() and lcd.print()`;
    if (p.type === 'sonar') return `${p.id} never measures: its TRIG must be wired to the pin the code pulses HIGH for 10 microseconds, and its ECHO to the pin pulseIn() reads` + order;
    return `${p.id} never switches: wire ${p.id}.IN to a pin and set that pin HIGH in the code`;
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
      case 'common': return `${d.name} is a common-${d.common} display: its COM pins go to ${d.common === 'anode' ? '+ (5V)' : '- (GND)'}, and its segments to the other side`;
      case 'ground': return 'the battery\'s BAT- is not joined to the Arduino\'s GND: add a wire between them, so both share one ground';
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
    LEDS, LED_COLORS, TYPES, PART_TYPES, DOCK_TYPES, VARIANT, WIRE_COLORS, STANDARD, CAP_STANDARD, SEGS, DIGITS, SEG7_SEG, LIT, BURN, BATTERIES, BAND_NAMES, LIMIT,
    BBError, SketchError, SKETCH_MSG, INPUT, OUTPUT, PULLUP,
    parsePoint, parseOhms, parseFarads, sig2, bands, fmtOhms, fmtFarads, mA, ldrOhms, usAngle, lcdText, variantOf, itemOf,
    normSpec, specOut, normBlock, normGoal, normTask, normBuild, startBuild, inventory, take, binItems, binOut,
    bench, session, view, compile, makeVM, advance, lex, parse,
    evaluate, check, reference, diagnose, needsCode, outputsOf, health, whyText, blockWhy, isOn
  };
});
