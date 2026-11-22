/* =====================================================================
   The breadboard bench (assets/js/widgets.js): the learner builds real
   circuits, as in Tinkercad. A half-size breadboard (strips of five, the
   centre gap, the + and - rails), a parts bin (LEDs, resistors with
   their colour bands, a push button, a slide switch, a pot, an LDR, a
   buzzer), and beside the board a battery, a small motor and an
   Arduino Uno with its code panel and serial monitor.

   - Placing: drag a part from the bin onto the board, or tap it and
     then tap a hole (its first leg goes there). R or the Rotate button
     turns it; a placed part can be dragged to move it.
   - Wiring: tap a hole or pin, then another (or drag from one to the
     other). The colour buttons set the next wire's colour.
   - Phones: the bench zooms (+, -, fit, or two fingers); a tap on a
     tiny hole first zooms in. Every hole and pin also has a name to
     type ("a12", "D13") in the Hole box, and the keyboard moves a
     cursor over the holes (arrows, Enter, R, Delete, Escape).
   - The circuit is solved as it changes (assets/js/widgets/
     breadboard-core.js, shared with the server): LEDs glow by their
     current and burn out above about 30 mA, a short circuit warns,
     the motor spins, the buzzer sounds (a quiet tone, if the learner
     turns sound on). The Arduino's sketch runs a step at a time, so
     delay() takes simulated time and the page stays responsive.
   - As a task, check() simulates the learner's own build against the
     goal, whatever holes and ids they used.

   Every spec is checked again here before it is drawn; nothing from
   it goes into the page as markup, and the sketch runs in the core's
   interpreter, with no way to the page, the network or storage.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P || !P.widgets) return;
  const me = document.currentScript;

  const core = window.PrimerBreadboard ? Promise.resolve(window.PrimerBreadboard) : new Promise((resolve, reject) => {
    let s = document.querySelector('script[data-breadboard-core]');
    if (!s) {
      s = document.createElement('script');
      s.src = '/assets/js/widgets/breadboard-core.js';
      s.async = true;
      s.setAttribute('data-breadboard-core', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => (window.PrimerBreadboard ? resolve(window.PrimerBreadboard) : reject(new Error('breadboard-core.js did not load'))));
    s.addEventListener('error', () => reject(new Error('breadboard-core.js could not be loaded')));
  });
  const ready = core.then(start);
  if (me) me.ready = ready;
  ready.catch((err) => console.warn('[Primer] breadboard:', err && err.message));

  function start(C) {
    const T = (s) => (P.t ? P.t(s) : s);
    const F = (s, v) => T(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m));
    const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
    const clone = (b) => JSON.parse(JSON.stringify(b));
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const r1 = (x) => Math.round(x * 10) / 10;
    function andList(items) {
      try { return new Intl.ListFormat(P.lang || 'en', { type: 'conjunction' }).format(items); } catch (e) { return items.join(', '); }
    }

    /* ---------------- words (each literal, for the translators) ---------------- */

    function partName(type, t) {
      switch (type) {
        case 'led': return t('LED');
        case 'resistor': return t('Resistor');
        case 'button': return t('Push button');
        case 'switch': return t('Slide switch');
        case 'pot': return t('Potentiometer');
        case 'ldr': return t('Light sensor (LDR)');
        case 'buzzer': return t('Buzzer');
        case 'motor': return t('Motor');
        default: return type;
      }
    }
    function colorName(c, t) {
      switch (c) {
        case 'red': return t('red');
        case 'green': return t('green');
        case 'yellow': return t('yellow');
        case 'blue': return t('blue');
        case 'white': return t('white');
        case 'black': return t('black');
        case 'orange': return t('orange');
        case 'purple': return t('purple');
        case 'any': return t('any colour');
        default: return c;
      }
    }
    function bandName(c, t) {
      switch (c) {
        case 'black': return t('black');
        case 'brown': return t('brown');
        case 'red': return t('red');
        case 'orange': return t('orange');
        case 'yellow': return t('yellow');
        case 'green': return t('green');
        case 'blue': return t('blue');
        case 'violet': return t('violet');
        case 'grey': return t('grey');
        case 'white': return t('white');
        case 'gold': return t('gold');
        default: return c;
      }
    }
    // a part in a few words: "the red LED (L1)", "the 220 Ω resistor (R1)"
    function partWords(p, t, fill) {
      if (!p) return '';
      if (p.type === 'led') return fill('the {color} LED ({id})', { color: colorName(p.color, t), id: p.id });
      if (p.type === 'resistor') return fill('the {ohms} resistor ({id})', { ohms: C.fmtOhms(p.ohms), id: p.id });
      if (p.type === 'motor') return t('the motor');
      return fill('{name} {id}', { name: partName(p.type, t), id: p.id });
    }
    // a point's name for people: "hole a12", "Arduino pin 13"
    function pointWords(name, t, fill) {
      if (!name) return '';
      if (C.HOLES.has(name)) {
        const h = C.HOLES.get(name);
        if (/^[+-]/.test(h.row)) return fill(h.row[0] === '+' ? (h.row[1] === 'T' ? 'Top + rail, column {col}' : 'Bottom + rail, column {col}') : (h.row[1] === 'T' ? 'Top − rail, column {col}' : 'Bottom − rail, column {col}'), { col: h.col });
        return fill('Hole {hole}', { hole: name });
      }
      if (name === 'BAT+') return t('Battery +');
      if (name === 'BAT-') return t('Battery −');
      if (name === 'M+' || name === 'M-') return fill('Motor terminal {n}', { n: name === 'M+' ? '1' : '2' });
      if (/^D\d+$/.test(name)) return fill('Arduino pin {pin}', { pin: name.slice(1) });
      if (/^A\d$/.test(name)) return fill('Arduino pin {pin}', { pin: name });
      if (name === '3V3') return fill('Arduino pin {pin}', { pin: '3.3V' });
      return fill('Arduino pin {pin}', { pin: name });
    }
    // a sketch error in plain words, with its line number
    function sketchText(e, t, fill) {
      if (!e) return '';
      const v = Object.assign({}, e.vals || {});
      switch (e.code) {
        case 'semi': return fill('Line {line}: put a ; at the end of this line.', v);
        case 'expect': return fill('Line {line}: "{want}" is missing before "{got}".', v);
        case 'unexpected': return fill('Line {line}: "{got}" doesn’t belong here.', v);
        case 'eof': return t('The code ends too soon: something opened with ( or { is never closed.');
        case 'brace': return fill('Line {line}: this { is never closed with a }.', v);
        case 'nested': return fill('Line {line}: {name}() starts inside another function: a } is missing above it.', v);
        case 'paren': return fill('Line {line}: this ( is never closed with a ).', v);
        case 'unknown': return fill('Line {line}: {name} isn’t known. Declare it first, like int {name} = 0;', v);
        case 'suggest': return fill('Line {line}: {name} isn’t known. Did you mean {better}?', v);
        case 'nofn': return fill('Line {line}: there is no function called {name}.', v);
        case 'args': return fill('Line {line}: {name} needs {n} values in its ( ), not {got}.', v);
        case 'argsRange': return fill('Line {line}: {name} needs {min} to {max} values in its ( ), not {got}.', v);
        case 'constant': return fill('Line {line}: {name} is const, so it can’t be changed.', v);
        case 'twice': return fill('Line {line}: {name} is declared twice.', v);
        case 'nosetup': return t('There is no setup() function. Every sketch needs void setup() { } and void loop() { }.');
        case 'noloop': return t('There is no loop() function. Every sketch needs void setup() { } and void loop() { }.');
        case 'string': return fill('Line {line}: String and text variables aren’t supported here. Print words directly, like Serial.print("Hello");', v);
        case 'concat': return fill('Line {line}: "text" + a number doesn’t join them in Arduino C. Use two prints: Serial.print("text"); Serial.println(x);', v);
        case 'unsupported': return fill('Line {line}: {what} isn’t supported here.', v);
        case 'macro': return fill('Line {line}: #define with ( ) isn’t supported here; write a function instead.', v);
        case 'number': return fill('Line {line}: "{got}" isn’t a number I can read.', v);
        case 'text': return fill('Line {line}: a "text" is not closed with ".', v);
        case 'quote': return fill('Line {line}: {got} is a curly quote; use a straight quote " instead.', v);
        case 'char': return fill('Line {line}: "{got}" can’t be used in code.', v);
        case 'novalue': return fill('Line {line}: {name} gives back nothing (void), so it has no value to use.', v);
        case 'lvalue': return fill('Line {line}: the left side of {op} must be a variable.', v);
        case 'notarray': return fill('Line {line}: {name} is not an array, so it can’t have [ ].', v);
        case 'isarray': return fill('Line {line}: {name} is an array: use {name}[0], {name}[1] and so on.', v);
        case 'arraysize': return fill('Line {line}: the array {name} needs a size, like {name}[5], or its values in { }.', v);
        case 'loopout': return fill('Line {line}: {what} only works inside a loop.', v);
        case 'returnvoid': return fill('Line {line}: {name} is void, so return can’t give back a value.', v);
        case 'notype': return fill('Line {line}: put a type before {name}, like void {name}() or int {name}.', v);
        case 'name': return fill('Line {line}: a name is missing after the type.', v);
        case 'pinmode': return fill('Line {line}: pinMode needs INPUT, OUTPUT or INPUT_PULLUP.', v);
        case 'index': return fill('Line {line}: {name}[{i}] is outside the array (it has {n} items, {name}[0] to {name}[{last}]).', v);
        case 'div0': return fill('Line {line}: division by zero.', v);
        case 'pin': return fill('Line {line}: the Arduino Uno has no pin {pin} (it has 0 to 13 and A0 to A5).', v);
        case 'apin': return fill('Line {line}: analogRead needs an analog pin, A0 to A5.', v);
        case 'deep': return fill('Line {line}: {name} calls itself too many times.', v);
        case 'toolong': return fill('The code is too long (at most {n} characters).', v);
        default: return t('The sketch stopped with an error.');
      }
    }
    // what a check found, as a note for the learner
    function whyNote(why, B, t, fill) {
      if (!why) return '';
      const name = (id) => (id === 'MOTOR' ? t('the motor') : partWords(B && B.parts.get(id), t, fill) || id);
      switch (why.code) {
        case 'short': return t('That makes a short circuit: nothing slows the current, so the battery would get hot.');
        case 'burn': return fill('{name} would burn out: {mA} mA flows through it. Add a resistor in series.', { name: name(why.name), mA: why.mA });
        case 'pin': return fill('Pin {pin} would give {mA} mA, more than an Arduino pin can. Add a resistor.', why);
        case 'samestrip': return fill('{name} has both legs in one strip, so no current goes through it. Put its legs in different columns.', { name: name(why.name) });
        case 'alone': return fill('{name} has a leg in {hole}, a strip with nothing else in it, so the loop is broken there.', { name: name(why.name), hole: why.hole });
        case 'wirealone': return fill('A wire ends in {hole}, a strip with nothing else in it.', why);
        case 'reversed': return fill('{name} is the wrong way round: its + leg (the anode, the longer one) must face the + side.', { name: name(why.name) });
        case 'nopower': return t('Nothing is joined to the battery or the Arduino yet.');
        case 'dark': return t('No LED is lit. Is there a whole loop from + through the LED and back to −?');
        case 'noled': return t('There’s no LED on the board yet.');
        case 'nobuzzer': return t('There’s no buzzer on the board yet.');
        case 'motor': return t('The motor isn’t turning.');
        case 'few': return fill('Only {n} of the {want} LEDs are lit.', why);
        case 'mA': return fill('{mA} mA flows through the LED; the goal is {lo} to {hi} mA.', why);
        case 'ohms': return fill('Use the {ohms} resistor in series with the LED.', { ohms: C.fmtOhms(why.ohms) });
        case 'notseries': return t('Those LEDs aren’t in series: in series, taking one out puts the others out.');
        case 'notparallel': return t('Those LEDs aren’t in parallel: in parallel, each has its own path, so taking one out leaves the others lit.');
        case 'nobutton': return t('There’s no push button on the board yet.');
        case 'noswitch': return t('There’s no slide switch on the board yet.');
        case 'nopot': return t('There’s no potentiometer on the board yet.');
        case 'noldr': return t('There’s no light sensor (LDR) on the board yet.');
        case 'btnalways': return t('The LED is lit even when the button isn’t pressed.');
        case 'btnstuck': return t('The LED doesn’t go out again when the button is let go.');
        case 'btnreleased': return t('The LED should go out while the button is pressed, and light when it is let go.');
        case 'switchsame': return t('The switch doesn’t change the LED: it should be on one way and off the other.');
        case 'potsame': return t('Turning the knob doesn’t change how bright the LED is.');
        case 'ldrsame': return t('Changing the light doesn’t change the LED.');
        case 'ldrdark': return t('The LED should light in the dark and go out in bright light.');
        case 'ldrbright': return t('The LED should light in bright light and go out in the dark.');
        case 'pinin': return fill('Pin {pin} doesn’t notice it: wire it to pin {pin}.', why);
        case 'pinout': return fill('The LED isn’t worked by pin {pin}: wire it from pin {pin}, through a resistor, to GND.', why);
        case 'noblink': return t('The LED doesn’t blink.');
        case 'blinktime': return fill('The LED is on for {on} ms and off for {off} ms; the goal is {won} ms on and {woff} ms off.', why);
        case 'serial': return fill('The serial monitor doesn’t show "{text}".', why);
        case 'nobegin': return t('Nothing reaches the serial monitor: start it with Serial.begin(9600); in setup().');
        case 'nocode': return t('Write the sketch, then press Check.');
        case 'sketch': return sketchText(why.error, t, fill);
        case 'slow': return t('The sketch takes too long: is there a loop that never ends?');
        case 'empty': return t('Build something on the board first.');
        default: return '';
      }
    }

    /* ---------------- drawing ---------------- */

    const SVGNS = 'http://www.w3.org/2000/svg';
    const PITCH = 18, BMX = 30, BMY = 22;
    const BW = BMX * 2 + (C.COLS - 1) * PITCH, BH = BMY * 2 + 16 * PITCH;
    const FY = BH + 26;
    const hx = (x) => BMX + x * PITCH;
    const hy = (y) => BMY + (y + 3) * PITCH;
    const INK = '#2b1d11', SOFT = '#5b4730', GOLD = '#8a6128', RED = '#9a3324';
    const LEG = '#9aa3ab';
    const LED_ON = { red: '#ff3b2f', green: '#35d24c', yellow: '#ffd23a', blue: '#3f86ff', white: '#ffffff' };
    const LED_OFF = { red: '#b5574f', green: '#5c9a63', yellow: '#c4a955', blue: '#5974ad', white: '#dedbd0' };
    const WIRE = { red: '#d93a2b', black: '#2a2a2a', blue: '#2f6fd6', green: '#2e9b47', yellow: '#e8bf27', orange: '#ec7f22', white: '#efeee6', purple: '#8a4fc7' };
    const BAND = { black: '#1b1b1b', brown: '#7b4a20', red: '#d23a2a', orange: '#ef7d1a', yellow: '#f1cf22', green: '#2f9e44', blue: '#2f62d1', violet: '#8546c6', grey: '#8c8c8c', white: '#f5f5f5', gold: '#c9a13b', silver: '#b8bcc2' };
    let uid = 0;

    // a tiny tree of SVG nodes, made into markup (the book) or DOM (the page); text is escaped or set as text
    const el = (tag, attrs, kids, ref) => ({ tag, attrs: attrs || {}, kids: kids || [], ref });
    const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function toStr(n) {
      if (n == null) return '';
      if (typeof n === 'string') return escAttr(n);
      const a = Object.keys(n.attrs).filter((k) => n.attrs[k] != null && n.attrs[k] !== false).map((k) => ` ${k}="${escAttr(n.attrs[k])}"`).join('');
      return `<${n.tag}${a}>${n.kids.map(toStr).join('')}</${n.tag}>`;
    }
    function toDom(n, refs) {
      if (n == null) return null;
      if (typeof n === 'string') return document.createTextNode(n);
      const d = document.createElementNS(SVGNS, n.tag);
      Object.keys(n.attrs).forEach((k) => { if (n.attrs[k] != null && n.attrs[k] !== false) d.setAttribute(k, String(n.attrs[k])); });
      n.kids.forEach((k) => { const c = toDom(k, refs); if (c) d.appendChild(c); });
      if (n.ref && refs) refs[n.ref] = d;
      return d;
    }
    const holeXY = (name) => { const h = C.HOLES.get(name); return [hx(h.x), hy(h.y)]; };

    // where the battery, the motor and the Arduino sit, and their terminals
    function layout(spec) {
      const L = { ard: null, bat: null, mot: null, terms: new Map() };
      const add = (name, x, y) => { if (!L.terms.has(name)) L.terms.set(name, []); L.terms.get(name).push([r1(x), r1(y)]); };
      if (spec.arduino) {
        L.ard = { x: 14, y: FY, w: 340, h: 236 };
        const a = L.ard;
        const top = ['GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8'], top2 = ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'];
        top.forEach((n, i) => add(n, a.x + 92 + i * 16, a.y + 16));
        top2.forEach((n, i) => add(n, a.x + 210 + i * 16, a.y + 16));
        ['3V3', '5V', 'GND', 'GND', 'VIN'].forEach((n, i) => add(n, a.x + 106 + i * 16, a.y + a.h - 16));
        C.ANALOG.forEach((n, i) => add(n, a.x + 206 + i * 16, a.y + a.h - 16));
      }
      const bx = spec.arduino ? 376 : 40;
      if (spec.battery) {
        L.bat = { x: bx, y: FY + 8, w: 132, h: 62, kind: spec.battery };
        add('BAT+', L.bat.x + L.bat.w + 8, L.bat.y + 18);
        add('BAT-', L.bat.x + L.bat.w + 8, L.bat.y + 44);
      }
      if (spec.motor) {
        L.mot = { x: spec.arduino ? 376 : (spec.battery ? 260 : 40), y: spec.arduino && spec.battery ? FY + 112 : FY + 8, w: 124, h: 96 };
        add('M+', L.mot.x + L.mot.w - 6, L.mot.y + 34);
        add('M-', L.mot.x + L.mot.w - 6, L.mot.y + 62);
      }
      const bottom = Math.max(BH, L.ard ? L.ard.y + L.ard.h : 0, L.bat ? L.bat.y + L.bat.h + 8 : 0, L.mot ? L.mot.y + L.mot.h : 0);
      L.vb = [-8, -8, BW + 16, bottom + 18];
      return L;
    }
    // a terminal's place for a wire: the one of its pins nearest the wire's other end
    function termXY(L, name, near) {
      const list = L.terms.get(name);
      if (!list) return [0, 0];
      if (!near || list.length === 1) return list[0];
      let best = list[0], bd = Infinity;
      list.forEach((p) => { const d = Math.hypot(p[0] - near[0], p[1] - near[1]); if (d < bd) { bd = d; best = p; } });
      return best;
    }
    const pointXY = (L, name, near) => (C.HOLES.has(name) ? holeXY(name) : termXY(L, name, near));

    // the board itself: drawn once
    let boardCache = null;
    function boardTree() {
      if (boardCache) return boardCache;
      let holes = '';
      for (const h of C.HOLES.values()) holes += `M${r1(hx(h.x) - 2.6)} ${r1(hy(h.y) - 2.6)}h5.2v5.2h-5.2z`;
      const kids = [
        el('rect', { x: 0, y: 0, width: BW, height: BH, rx: 9, fill: '#f6f3ea', stroke: '#c9c2b0', 'stroke-width': 1.4 }),
        el('rect', { x: 6, y: hy(4) + PITCH * 0.5, width: BW - 12, height: PITCH, rx: 3, fill: '#e3ddce' }),
        el('rect', { x: 6, y: hy(4.5) + PITCH * 0.25 - 1, width: BW - 12, height: PITCH * 0.5 + 2, rx: 2, fill: '#d6cfbd' })
      ];
      // rail stripes: red beside +, blue beside -
      const stripe = (y, color) => el('line', { x1: hx(0) - 8, y1: y, x2: hx(C.COLS - 1) + 8, y2: y, stroke: color, 'stroke-width': 1.6, opacity: 0.85 });
      kids.push(stripe(hy(-3) - 9, '#3d6fd1'), stripe(hy(-2) + 9, '#d3402f'), stripe(hy(12) - 9, '#d3402f'), stripe(hy(13) + 9, '#3d6fd1'));
      const sign = (x, y, s, color) => el('text', { x, y, dy: '0.36em', 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: color }, [s]);
      [[hy(-3), '−', '#3d6fd1'], [hy(-2), '+', '#d3402f'], [hy(12), '+', '#d3402f'], [hy(13), '−', '#3d6fd1']].forEach(([y, s, c]) => { kids.push(sign(13, y, s, c), sign(BW - 13, y, s, c)); });
      kids.push(el('path', { d: holes, fill: '#4c4a45' }));
      // row letters, column numbers
      const words = [];
      for (const r of C.ROWS) {
        const y = hy(C.ROW_Y[r]);
        words.push(el('text', { x: 13, y, dy: '0.35em', 'text-anchor': 'middle' }, [r]), el('text', { x: BW - 13, y, dy: '0.35em', 'text-anchor': 'middle' }, [r]));
      }
      for (let c = 1; c <= C.COLS; c++) {
        if (c !== 1 && c % 5) continue;
        words.push(el('text', { x: hx(c - 1), y: hy(-1), dy: '0.35em', 'text-anchor': 'middle' }, [String(c)]), el('text', { x: hx(c - 1), y: hy(11), dy: '0.35em', 'text-anchor': 'middle' }, [String(c)]));
      }
      kids.push(el('g', { 'font-size': 9, fill: '#8f8878', 'font-family': 'Arial, Helvetica, sans-serif' }, words));
      boardCache = el('g', { class: 'bb-board' }, kids);
      return boardCache;
    }

    function arduinoTree(L, look) {
      const a = L.ard;
      const kids = [
        el('rect', { x: a.x - 12, y: a.y + 34, width: 46, height: 44, rx: 3, fill: '#b9bec4', stroke: '#7f868e' }),
        el('rect', { x: a.x - 6, y: a.y + 150, width: 36, height: 40, rx: 3, fill: '#2a2a2a' }),
        el('rect', { x: a.x, y: a.y, width: a.w, height: a.h, rx: 10, fill: '#1f7d72', stroke: '#145a52', 'stroke-width': 1.5 }),
        el('rect', { x: a.x + 84, y: a.y + 7, width: 120, height: 18, rx: 2, fill: '#1d1d1d' }),
        el('rect', { x: a.x + 202, y: a.y + 7, width: 132, height: 18, rx: 2, fill: '#1d1d1d' }),
        el('rect', { x: a.x + 98, y: a.y + a.h - 25, width: 84, height: 18, rx: 2, fill: '#1d1d1d' }),
        el('rect', { x: a.x + 198, y: a.y + a.h - 25, width: 100, height: 18, rx: 2, fill: '#1d1d1d' }),
        el('rect', { x: a.x + 150, y: a.y + 108, width: 150, height: 40, rx: 3, fill: '#222' }),
        el('text', { x: a.x + 225, y: a.y + 128, dy: '0.35em', 'text-anchor': 'middle', 'font-size': 8, fill: '#9aa', 'font-family': 'Arial, Helvetica, sans-serif' }, ['ATMEGA328P']),
        el('text', { x: a.x + 92, y: a.y + 104, 'font-size': 26, 'font-weight': 700, fill: '#e8f3f1', 'font-family': 'Arial, Helvetica, sans-serif' }, ['UNO']),
        el('text', { x: a.x + 92, y: a.y + 76, 'font-size': 11, fill: '#bfe0db', 'font-family': 'Arial, Helvetica, sans-serif', 'letter-spacing': 1 }, ['ARDUINO']),
        el('circle', { cx: a.x + 26, cy: a.y + 20, r: 7, fill: '#c9ccd0', stroke: '#888' })
      ];
      // the board's own LEDs: L (pin 13), TX, ON
      const dot = (x, y, fill, word, ref) => [el('rect', { x: x - 4, y: y - 2.5, width: 8, height: 5, rx: 1, fill }, [], ref), el('text', { x: x + 7, y, dy: '0.35em', 'font-size': 7, fill: '#cfe7e3', 'font-family': 'Arial, Helvetica, sans-serif' }, [word])];
      kids.push(...dot(a.x + 62, a.y + 50, look && look.L ? '#ffb02e' : '#6b5a3a', 'L', 'ledL'), ...dot(a.x + 62, a.y + 62, '#6b5a3a', 'TX', 'ledTX'), ...dot(a.x + 300, a.y + 72, '#58e35b', 'ON'));
      // the pins and their names
      const pins = [], names = [];
      L.terms.forEach((list, name) => {
        if (!C.PINS.includes(name) && !C.POWER.includes(name)) return;
        list.forEach(([x, y]) => {
          pins.push(el('rect', { x: x - 4, y: y - 4, width: 8, height: 8, rx: 1, fill: '#55585c', stroke: '#111', 'stroke-width': 0.8 }));
          const label = /^D\d+$/.test(name) ? (C.PWM.includes(Number(name.slice(1))) ? '~' : '') + name.slice(1) : name === '3V3' ? '3.3V' : name;
          const top = y < a.y + a.h / 2;
          names.push(el('text', { x, y: top ? y + 19 : y - 18, 'text-anchor': 'middle', 'font-size': 7.5, fill: '#eaf5f3', transform: `rotate(-90 ${x} ${top ? y + 19 : y - 18})`, dy: '0.35em' }, [label]));
        });
      });
      kids.push(el('g', {}, pins), el('g', { 'font-family': 'Arial, Helvetica, sans-serif' }, names));
      kids.push(el('text', { x: a.x + 210, y: a.y + 60, 'font-size': 7.5, fill: '#cfe7e3', 'font-family': 'Arial, Helvetica, sans-serif' }, ['DIGITAL (PWM ~)']));
      kids.push(el('text', { x: a.x + 214, y: a.y + a.h - 44, 'font-size': 7.5, fill: '#cfe7e3', 'font-family': 'Arial, Helvetica, sans-serif' }, ['ANALOG IN']));
      kids.push(el('text', { x: a.x + 112, y: a.y + a.h - 44, 'font-size': 7.5, fill: '#cfe7e3', 'font-family': 'Arial, Helvetica, sans-serif' }, ['POWER']));
      return el('g', { class: 'bb-uno' }, kids);
    }

    function batteryTree(L, look) {
      const b = L.bat;
      const hot = look && look.hot;
      const kids = [];
      kids.push(el('rect', { x: b.x - 6, y: b.y - 6, width: b.w + 26, height: b.h + 12, rx: 12, fill: '#ff6a3d', opacity: hot ? 0.45 : 0 }, [], 'heat'));
      if (b.kind === '9V') {
        kids.push(el('rect', { x: b.x, y: b.y, width: b.w - 14, height: b.h, rx: 6, fill: '#2d2d2f' }),
          el('rect', { x: b.x + 10, y: b.y + 8, width: b.w - 40, height: b.h - 16, rx: 3, fill: '#e2b23a' }),
          el('text', { x: b.x + (b.w - 30) / 2 + 5, y: b.y + b.h / 2, dy: '0.36em', 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: '#2d2d2f', 'font-family': 'Arial, Helvetica, sans-serif' }, ['9V']),
          el('rect', { x: b.x + b.w - 16, y: b.y + 8, width: 14, height: b.h - 16, rx: 2, fill: '#bfc3c8' }));
      } else {
        kids.push(el('rect', { x: b.x, y: b.y, width: b.w - 12, height: b.h, rx: 5, fill: '#2b2b2b' }));
        [0, 1].forEach((i) => {
          const y = b.y + 7 + i * 25;
          kids.push(el('rect', { x: b.x + 8, y, width: b.w - 34, height: 21, rx: 9, fill: '#3e7bd6' }), el('rect', { x: b.x + b.w - 28, y: y + 6, width: 5, height: 9, rx: 1, fill: '#c9ccd0' }),
            el('text', { x: b.x + (b.w - 26) / 2 + 4, y: y + 10.5, dy: '0.35em', 'text-anchor': 'middle', 'font-size': 9, fill: '#fff', 'font-family': 'Arial, Helvetica, sans-serif' }, ['AA 1.5V']));
        });
        kids.push(el('text', { x: b.x + 4, y: b.y + b.h + 13, 'font-size': 10, fill: SOFT, 'font-family': 'Arial, Helvetica, sans-serif' }, ['2 × AA = 3V']));
      }
      const [px, py] = L.terms.get('BAT+')[0], [mx, my] = L.terms.get('BAT-')[0];
      kids.push(el('line', { x1: b.x + b.w - 10, y1: py, x2: px, y2: py, stroke: '#d93a2b', 'stroke-width': 3 }), el('line', { x1: b.x + b.w - 10, y1: my, x2: mx, y2: my, stroke: '#2a2a2a', 'stroke-width': 3 }));
      kids.push(el('circle', { cx: px, cy: py, r: 5.5, fill: '#d93a2b', stroke: '#7a1d14' }), el('circle', { cx: mx, cy: my, r: 5.5, fill: '#2a2a2a', stroke: '#000' }));
      kids.push(el('text', { x: px + 10, y: py, dy: '0.36em', 'font-size': 12, 'font-weight': 700, fill: '#b02a1d', 'font-family': 'Arial, Helvetica, sans-serif' }, ['+']), el('text', { x: mx + 10, y: my, dy: '0.36em', 'font-size': 12, 'font-weight': 700, fill: INK, 'font-family': 'Arial, Helvetica, sans-serif' }, ['−']));
      return el('g', { class: 'bb-battery' }, kids);
    }

    function motorTree(L, look) {
      const m = L.mot;
      const cx = m.x + 44, cy = m.y + 48;
      const angle = look && look.angle ? look.angle : 0;
      const kids = [
        el('rect', { x: cx + 18, y: m.y + 26, width: m.w - 66, height: 44, rx: 4, fill: '#d9d5c7', stroke: '#9c9584' }),
        el('circle', { cx, cy, r: 34, fill: '#c9cdd2', stroke: '#868c93', 'stroke-width': 2 }),
        el('circle', { cx, cy, r: 24, fill: '#b2b7bd' }),
        el('g', { transform: `rotate(${r1(angle)} ${cx} ${cy})` }, [
          el('path', { d: `M${cx} ${cy}L${cx - 6} ${cy - 30}Q${cx} ${cy - 36} ${cx + 6} ${cy - 30}Z M${cx} ${cy}L${cx + 6} ${cy + 30}Q${cx} ${cy + 36} ${cx - 6} ${cy + 30}Z`, fill: '#e2553a', stroke: '#9b2f1d' }),
          el('circle', { cx, cy, r: 4, fill: '#333' })
        ], 'prop'),
        el('text', { x: cx, y: m.y + m.h + 4, 'text-anchor': 'middle', 'font-size': 10, fill: SOFT, 'font-family': 'Arial, Helvetica, sans-serif' }, ['DC motor']),
        el('text', { x: cx, y: cy - 40, 'text-anchor': 'middle', 'font-size': 14, fill: GOLD, opacity: look && look.spin ? 1 : 0 }, ['↻'], 'spinMark')
      ];
      L.terms.get('M+').concat(L.terms.get('M-')).forEach(([x, y], i) => {
        kids.push(el('line', { x1: cx + 34, y1: y, x2: x, y2: y, stroke: i ? '#2a2a2a' : '#d93a2b', 'stroke-width': 3 }), el('circle', { cx: x, cy: y, r: 5.5, fill: '#c7a443', stroke: '#7a6220' }));
      });
      return el('g', { class: 'bb-motor' }, kids);
    }

    // one part on the board; look: what the circuit is doing to it
    function partTree(p, look, opts) {
      opts = opts || {};
      look = look || {};
      const pts = p.at.map(holeXY);
      const a = pts[0], b = pts[pts.length - 1];
      const c = pts.length === 3 ? pts[1] : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const n = [-u[1], u[0]];
      const ang = r1(Math.atan2(u[1], u[0]) * 180 / Math.PI);
      const rot = `translate(${r1(c[0])} ${r1(c[1])}) rotate(${ang})`;
      const kids = [];
      const leg = (from, to) => el('line', { x1: r1(from[0]), y1: r1(from[1]), x2: r1(to[0]), y2: r1(to[1]), stroke: LEG, 'stroke-width': 2, 'stroke-linecap': 'round' });
      const tip = (q) => el('circle', { cx: r1(q[0]), cy: r1(q[1]), r: 2.2, fill: '#6d747b' });
      const at = (d) => [c[0] + u[0] * d, c[1] + u[1] * d];
      const live = opts.live, id = p.id;
      const ref = (k) => (live ? k + ':' + id : null);
      if (p.type === 'resistor') {
        const s = Math.min(1, (len - 6) / 34);
        kids.push(leg(a, at(-16 * s)), leg(at(16 * s), b), tip(a), tip(b));
        const bnd = C.bands(p.ohms);
        kids.push(el('g', { transform: rot + (s < 1 ? ` scale(${r1(Math.max(0.35, s) * 100) / 100})` : '') }, [
          el('rect', { x: -16, y: -5.5, width: 32, height: 11, rx: 5.5, fill: '#e3c995', stroke: '#9c7a43', 'stroke-width': 1 }),
          el('rect', { x: -11, y: -5.5, width: 3, height: 11, fill: BAND[bnd[0]] }),
          el('rect', { x: -6, y: -5.5, width: 3, height: 11, fill: BAND[bnd[1]] }),
          el('rect', { x: -1, y: -5.5, width: 3, height: 11, fill: BAND[bnd[2]] }),
          el('rect', { x: 8, y: -5.5, width: 3, height: 11, fill: BAND[bnd[3]] })
        ]));
      } else if (p.type === 'led') {
        const lit = look.lit, burnt = look.burnt;
        kids.push(leg(a, c), leg(b, c), tip(a), tip(b));
        kids.push(el('circle', { cx: r1(c[0]), cy: r1(c[1]), r: 26, fill: `url(#${opts.gid}-${p.color})`, opacity: lit ? r1(0.25 + 0.75 * (look.glow || 0)) : 0, class: 'bb-glow' }, [], ref('glow')));
        const fill = burnt ? '#3a3433' : lit ? LED_ON[p.color] : LED_OFF[p.color];
        kids.push(el('g', { transform: rot }, [
          el('path', { d: 'M -8.6 -2.6 A 9 9 0 1 1 -8.6 2.6 Z', fill: '#00000022' }),
          el('path', { d: 'M -7.6 -3.2 A 8.2 8.2 0 1 1 -7.6 3.2 Z', fill, stroke: burnt ? '#1c1a19' : '#00000055', 'stroke-width': 1 }, [], ref('dome')),
          el('ellipse', { cx: -2.2, cy: -2.6, rx: 2.6, ry: 1.6, fill: '#ffffff', opacity: burnt ? 0.15 : 0.55 }),
          burnt ? el('polyline', { points: '-4,-3 -1,0 -3,2 1,4', fill: 'none', stroke: '#c9c0b8', 'stroke-width': 1 }) : null
        ]));
        const plus = [a[0] - u[0] * 3 + n[0] * 11, a[1] - u[1] * 3 + n[1] * 11];
        kids.push(el('text', { x: r1(plus[0]), y: r1(plus[1]), dy: '0.36em', 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: '#b02a1d', 'font-family': 'Arial, Helvetica, sans-serif' }, ['+']));
        if (burnt) kids.push(el('g', { class: 'bb-smoke', fill: '#8e8a86' }, [el('circle', { cx: r1(c[0] + 3), cy: r1(c[1] - 14), r: 4, opacity: 0.55 }), el('circle', { cx: r1(c[0] - 2), cy: r1(c[1] - 21), r: 5, opacity: 0.4 }), el('circle', { cx: r1(c[0] + 4), cy: r1(c[1] - 28), r: 3.5, opacity: 0.3 })]));
      } else if (p.type === 'button') {
        kids.push(leg(a, c), leg(b, c), tip(a), tip(b));
        const pressed = look.pressed;
        kids.push(el('g', { transform: rot }, [
          el('rect', { x: -11, y: -11, width: 22, height: 22, rx: 2.5, fill: '#3b3d40', stroke: '#1f2022' }),
          el('circle', { cx: -7.5, cy: -7.5, r: 1.4, fill: '#888' }), el('circle', { cx: 7.5, cy: -7.5, r: 1.4, fill: '#888' }), el('circle', { cx: -7.5, cy: 7.5, r: 1.4, fill: '#888' }), el('circle', { cx: 7.5, cy: 7.5, r: 1.4, fill: '#888' }),
          el('circle', { cx: 0, cy: 0, r: pressed ? 5.6 : 6.8, fill: pressed ? '#9c2b22' : '#d9453a', stroke: '#6d1b14' }, [], ref('cap'))
        ]));
      } else if (p.type === 'switch') {
        const m = pts.length === 3 ? pts[1] : c;
        pts.forEach((q) => kids.push(leg(q, [q[0] + n[0] * 0, q[1]]), tip(q)));
        const half = Math.max(16, len / 2 + 8);
        const on = look.on;
        kids.push(el('g', { transform: `translate(${r1(m[0])} ${r1(m[1])}) rotate(${ang})` }, [
          el('rect', { x: -half, y: -8, width: half * 2, height: 16, rx: 3, fill: '#3b3f45', stroke: '#22252a' }),
          el('rect', { x: -half + 4, y: -3.5, width: half * 2 - 8, height: 7, rx: 3, fill: '#23262a' }),
          el('rect', { x: on ? -half + 4 : half - 16, y: -6, width: 12, height: 12, rx: 2, fill: '#ececec', stroke: '#999' }, [], ref('slider'))
        ]));
      } else if (p.type === 'pot') {
        const m = pts[1];
        pts.forEach((q) => kids.push(tip(q)));
        const k = look.knob != null ? look.knob : p.knob;
        kids.push(el('g', { transform: `translate(${r1(m[0])} ${r1(m[1])}) rotate(${ang})` }, [
          el('rect', { x: -15, y: -15, width: 30, height: 30, rx: 3, fill: '#2f63b3', stroke: '#1d3f75' }),
          el('circle', { cx: 0, cy: 0, r: 11, fill: '#ece8de', stroke: '#8d8778' }),
          el('g', { transform: `rotate(${r1(-135 + 270 * k - ang)})` }, [el('line', { x1: 0, y1: 0, x2: 0, y2: -9, stroke: '#2b2b2b', 'stroke-width': 2.4, 'stroke-linecap': 'round' })], ref('knob'))
        ]));
      } else if (p.type === 'ldr') {
        kids.push(leg(a, c), leg(b, c), tip(a), tip(b));
        kids.push(el('g', { transform: rot }, [
          el('circle', { cx: 0, cy: 0, r: 8.5, fill: '#e4b14d', stroke: '#9b6a1d' }),
          el('path', { d: 'M -5 -4 H 5 V -1.3 H -5 V 1.3 H 5 V 4 H -5', fill: 'none', stroke: '#7a4a1a', 'stroke-width': 1.1 })
        ]));
      } else if (p.type === 'buzzer') {
        kids.push(leg(a, c), leg(b, c), tip(a), tip(b));
        kids.push(el('circle', { cx: r1(c[0]), cy: r1(c[1]), r: 12, fill: '#1f1f1f', stroke: '#000' }), el('circle', { cx: r1(c[0]), cy: r1(c[1]), r: 3, fill: '#555' }));
        const plus = [a[0] + n[0] * 12, a[1] + n[1] * 12];
        kids.push(el('text', { x: r1(plus[0]), y: r1(plus[1]), dy: '0.36em', 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: '#b02a1d', 'font-family': 'Arial, Helvetica, sans-serif' }, ['+']));
        kids.push(el('g', { fill: 'none', stroke: GOLD, 'stroke-width': 1.6, opacity: look.on ? 1 : 0, class: 'bb-waves' }, [
          el('path', { d: `M ${r1(c[0] + 15)} ${r1(c[1] - 6)} Q ${r1(c[0] + 19)} ${r1(c[1])} ${r1(c[0] + 15)} ${r1(c[1] + 6)}` }),
          el('path', { d: `M ${r1(c[0] + 20)} ${r1(c[1] - 10)} Q ${r1(c[0] + 26)} ${r1(c[1])} ${r1(c[0] + 20)} ${r1(c[1] + 10)}` })
        ], ref('waves')));
      }
      // its id, small, beside it
      const off = p.type === 'pot' ? 26 : p.type === 'button' ? 24 : p.type === 'buzzer' ? 20 : p.type === 'switch' ? 17 : 14;
      const lab = [c[0] - n[0] * off, c[1] - n[1] * off];
      kids.push(el('text', { x: r1(lab[0]), y: r1(lab[1]), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 8.5, fill: SOFT, 'font-family': 'Arial, Helvetica, sans-serif', class: 'bb-id' }, [p.id]));
      return el('g', { class: 'bb-part' + (opts.ghost ? ' bb-ghost' : '') + (opts.bad ? ' is-bad' : ''), 'data-part': live ? id : null, opacity: opts.ghost ? 0.6 : null }, kids, live ? 'part:' + id : null);
    }

    function wireTree(L, w, i, opts) {
      opts = opts || {};
      const a0 = C.HOLES.has(w.from) ? holeXY(w.from) : null, b0 = C.HOLES.has(w.to) ? holeXY(w.to) : null;
      const a = a0 || termXY(L, w.from, b0 || termXY(L, w.to)), b = b0 || termXY(L, w.to, a);
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const bend = Math.min(28, d * 0.18);
      const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
      const s = ny > 0 ? -1 : 1; // bow upward
      const mx = (a[0] + b[0]) / 2 + nx * bend * s, my = (a[1] + b[1]) / 2 + ny * bend * s;
      const dPath = `M${r1(a[0])} ${r1(a[1])}Q${r1(mx)} ${r1(my)} ${r1(b[0])} ${r1(b[1])}`;
      const col = WIRE[w.color] || WIRE.blue;
      return el('g', { class: 'bb-wire' + (opts.sel ? ' is-sel' : ''), 'data-wire': opts.live ? String(i) : null }, [
        opts.live ? el('path', { d: dPath, fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'bb-wire__hit' }) : null,
        el('path', { d: dPath, fill: 'none', stroke: '#00000066', 'stroke-width': 5.2, 'stroke-linecap': 'round' }),
        el('path', { d: dPath, fill: 'none', stroke: col, 'stroke-width': 3.6, 'stroke-linecap': 'round' }),
        el('circle', { cx: r1(a[0]), cy: r1(a[1]), r: 2.8, fill: '#1c1c1c' }),
        el('circle', { cx: r1(b[0]), cy: r1(b[1]), r: 2.8, fill: '#1c1c1c' })
      ]);
    }

    function glowDefs(gid) {
      return el('defs', {}, Object.keys(LED_ON).map((k) => el('radialGradient', { id: gid + '-' + k }, [
        el('stop', { offset: '0', 'stop-color': LED_ON[k], 'stop-opacity': '0.9' }), el('stop', { offset: '0.45', 'stop-color': LED_ON[k], 'stop-opacity': '0.35' }), el('stop', { offset: '1', 'stop-color': LED_ON[k], 'stop-opacity': '0' })
      ])));
    }

    // what a solved state does to each part
    function looks(build, v, extra) {
      const out = {};
      build.parts.forEach((p) => {
        const o = (v && v.parts[p.id]) || {};
        out[p.id] = { lit: Boolean(o.lit), glow: o.glow || 0, burnt: Boolean(extra && extra.burnt && extra.burnt.has(p.id)) || Boolean(o.burn), on: p.type === 'switch' ? Boolean(p.on) : Boolean(o.on), pressed: Boolean(extra && extra.press && extra.press[p.id]), knob: p.knob };
      });
      return out;
    }

    // the still picture: the bench as it starts
    function stillSvg(spec) {
      const L = layout(spec);
      const build = C.startBuild(spec);
      let v = null;
      try { v = C.session(C.bench(spec, build), { run: false }).view(); } catch (e) { v = null; }
      const lk = looks(build, v);
      const gid = 'bbs' + (++uid);
      const kids = [glowDefs(gid), boardTree()];
      if (L.ard) kids.push(arduinoTree(L, {}));
      if (L.bat) kids.push(batteryTree(L, { hot: v && v.short }));
      if (L.mot) kids.push(motorTree(L, {}));
      kids.push(el('g', {}, build.parts.map((p) => partTree(p, lk[p.id], { gid }))));
      kids.push(el('g', {}, build.wires.map((w, i) => wireTree(L, w, i))));
      return toStr(el('svg', { xmlns: SVGNS, viewBox: L.vb.join(' '), width: L.vb[2], height: L.vb[3], role: 'img', 'aria-label': T('A breadboard bench'), 'font-family': 'Georgia, \'Times New Roman\', serif' }, kids));
    }

    /* ---------------- checked once, kept ---------------- */

    const checked = new WeakMap();
    function cleanSpec(spec) {
      if (!spec || typeof spec !== 'object') return null;
      let m = checked.get(spec);
      if (!m) { m = { spec: undefined, goals: new WeakMap() }; checked.set(spec, m); }
      if (m.spec === undefined) { try { m.spec = C.normSpec(spec, { loose: true }); } catch (e) { m.spec = null; } }
      return m.spec;
    }
    function cleanTask(spec, goal) {
      const s = cleanSpec(spec);
      if (!s || !goal || typeof goal !== 'object') return null;
      const m = checked.get(spec);
      if (!m.goals.has(goal)) { let g = null; try { g = C.normGoal(goal, s); } catch (e) { g = null; } m.goals.set(goal, g ? { spec: s, goal: g } : null); }
      return m.goals.get(goal);
    }
    const refs = new WeakMap();
    function referenceOf(t) {
      if (!refs.has(t.goal)) { let r = null; try { r = C.reference(t.spec, t.goal); } catch (e) { r = null; } refs.set(t.goal, r && r.build ? r : null); }
      return refs.get(t.goal);
    }

    /* ---------------- sound: a quiet buzz, only if the learner turns it on ---------------- */

    function makeSound() {
      let ac = null, osc = null, gain = null, on = false;
      return {
        get on() { return on; },
        enable(x) {
          on = Boolean(x);
          if (on && !ac) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) { on = false; return false; }
            try { ac = new AC(); gain = ac.createGain(); gain.gain.value = 0; gain.connect(ac.destination); osc = ac.createOscillator(); osc.type = 'square'; osc.frequency.value = 2000; osc.connect(gain); osc.start(); } catch (e) { ac = null; on = false; return false; }
          }
          if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
          if (!on) this.set(false);
          return on;
        },
        set(sounding, freq) {
          if (!ac || !gain) return;
          const want = on && sounding ? 0.025 : 0;
          try { gain.gain.setTargetAtTime(want, ac.currentTime, 0.015); if (freq) osc.frequency.setTargetAtTime(clamp(freq, 60, 6000), ac.currentTime, 0.01); } catch (e) { /* closed */ }
        },
        close() { try { if (ac) ac.close(); } catch (e) { /* gone */ } ac = null; }
      };
    }

    /* ---------------- the live bench ---------------- */

    function hostEl(tag, cls, attrs, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (attrs) Object.keys(attrs).forEach((k) => { const v = attrs[k]; if (v != null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); });
      if (text != null) e.textContent = text;
      return e;
    }
    function button(cls, text, onClick, attrs) {
      const b = hostEl('button', 'bb-btn' + (cls ? ' ' + cls : ''), Object.assign({ type: 'button' }, attrs || {}), text);
      if (onClick) b.addEventListener('click', onClick);
      return b;
    }

    function mount(host, spec, goal, ctx, mode) {
      const t = ctx.t || T;
      const fill = ctx.fill || F;
      const reduce = Boolean(ctx.reduce);
      const isTask = mode === 'task';
      const L = layout(spec);
      const startB = C.startBuild(spec);
      let build = clone(startB);
      let touched = false, locked = false, destroyed = false;
      let B = null, S = null;            // the compiled bench and its run
      let sel = null;                    // { k: 'part', id } | { k: 'wire', i }
      let act = null;                    // { k: 'place', item, rot } | { k: 'wire', from } | { k: 'probe' }
      let wireColor = 'auto';
      let cursor = 'a1', cursorOn = false;
      let probes = { red: null, black: null, next: 'red' };
      let hover = null;
      const history = [];
      const gid = 'bb' + (++uid);
      const sound = makeSound();
      let running = false;

      const root = hostEl('div', 'bb' + (isTask ? ' bb--task' : '') + (reduce ? ' is-still' : ''), { 'data-no-i18n': true });

      // the toolbar
      const bar = hostEl('div', 'bb-bar');
      const btnRotate = button('bb-btn--icon', t('Rotate'), () => rotate(), { 'aria-keyshortcuts': 'R' });
      const btnDelete = button('bb-btn--icon', t('Delete'), () => removeSel(), { 'aria-keyshortcuts': 'Delete' });
      const btnUndo = button('bb-btn--icon', t('Undo'), () => undoOnce(), { 'aria-keyshortcuts': 'Control+Z' });
      const btnMeter = button('bb-btn--icon', t('Meter'), () => toggleProbe(), { 'aria-pressed': 'false' });
      const btnReset = button('bb-btn--icon', t('Reset'), () => resetAll());
      bar.append(btnRotate, btnDelete, btnUndo, btnMeter, btnReset);
      let btnSound = null;
      if (C.inventory(spec).some((x) => x.type === 'buzzer')) {
        btnSound = button('bb-btn--icon', t('Sound off'), () => { const on = sound.enable(!sound.on); btnSound.textContent = on ? t('Sound on') : t('Sound off'); btnSound.setAttribute('aria-pressed', on ? 'true' : 'false'); paintLive(); }, { 'aria-pressed': 'false' });
        bar.appendChild(btnSound);
      }
      // wire colours
      const swatches = hostEl('div', 'bb-swatches', { role: 'group', 'aria-label': t('Wire colour') });
      const swBtns = {};
      ['auto'].concat(C.WIRE_COLORS.slice(0, 6)).forEach((c) => {
        const b = button('bb-swatch' + (c === 'auto' ? ' is-auto' : ''), c === 'auto' ? t('Auto') : '', () => setColor(c), { 'aria-pressed': c === wireColor ? 'true' : 'false', 'aria-label': c === 'auto' ? t('Wire colour: automatic') : fill('Wire colour: {color}', { color: colorName(c, t) }), title: c === 'auto' ? t('Wire colour: automatic') : fill('Wire colour: {color}', { color: colorName(c, t) }) });
        if (c !== 'auto') b.style.setProperty('--sw', WIRE[c]);
        swBtns[c] = b;
        swatches.appendChild(b);
      });
      bar.appendChild(swatches);
      // the hole box: type a hole or pin, as if tapping it
      const goBox = hostEl('form', 'bb-go');
      const goLabel = hostEl('label', 'bb-go__label', null, t('Hole'));
      const goIn = hostEl('input', 'bb-go__in', { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'a12', 'aria-label': t('Hole or pin to tap, like a12 or D13'), maxlength: '8' });
      const goBtn = hostEl('button', 'bb-btn', { type: 'submit' }, t('Tap'));
      goLabel.appendChild(goIn);
      goBox.append(goLabel, goBtn);
      bar.appendChild(goBox);
      root.appendChild(bar);

      // the stage: the bench drawing, with zoom buttons over it
      const stage = hostEl('div', 'bb-stage');
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'bb-svg');
      svg.setAttribute('viewBox', L.vb.join(' '));
      svg.setAttribute('role', 'application');
      svg.setAttribute('tabindex', '0');
      svg.setAttribute('aria-roledescription', t('breadboard'));
      svg.setAttribute('aria-label', t('Breadboard bench. Arrow keys move between holes, Enter taps a hole, R rotates, Delete removes, Escape cancels.'));
      stage.appendChild(svg);
      const zoomBox = hostEl('div', 'bb-zoom');
      const zIn = button('bb-zbtn', '+', () => zoomBy(1.5), { 'aria-label': t('Zoom in') });
      const zOut = button('bb-zbtn', '−', () => zoomBy(1 / 1.5), { 'aria-label': t('Zoom out') });
      const zFit = button('bb-zbtn', '⤢', () => fit(), { 'aria-label': t('Show the whole bench') });
      zoomBox.append(zIn, zOut, zFit);
      stage.appendChild(zoomBox);
      root.appendChild(stage);

      const status = hostEl('p', 'bb-status', { role: 'status' });
      status.hidden = true;
      root.appendChild(status);
      const hint = hostEl('p', 'bb-hint');
      root.appendChild(hint);

      // controls for the inputs on the board: buttons to hold, switches, knobs, light
      const controls = hostEl('div', 'bb-controls');
      root.appendChild(controls);
      const meterChip = hostEl('p', 'bb-meter');
      meterChip.hidden = true;
      root.appendChild(meterChip);

      // the parts bin
      const binWrap = hostEl('div', 'bb-bin');
      const binHead = hostEl('p', 'bb-bin__head', null, t('Parts bin'));
      const binList = hostEl('div', 'bb-bin__list', { role: 'list' });
      binWrap.append(binHead, binList);
      root.appendChild(binWrap);

      // the Arduino's code panel and serial monitor
      let codeIn = null, nums = null, codeErr = null, runBtn = null, stopBtn = null, runState = null, serialOut = null;
      if (spec.arduino) {
        const panel = hostEl('div', 'bb-code');
        const cbar = hostEl('div', 'bb-code__bar');
        cbar.appendChild(hostEl('span', 'bb-code__title', null, t('Arduino sketch')));
        runBtn = button('bb-btn bb-btn--go', t('Upload and run'), () => runSketch());
        stopBtn = button('bb-btn', t('Stop'), () => stopSketch());
        stopBtn.disabled = true;
        runState = hostEl('span', 'bb-code__state', { 'aria-live': 'polite' }, t('Stopped'));
        cbar.append(runBtn, stopBtn, runState);
        const edit = hostEl('div', 'bb-code__edit');
        nums = hostEl('pre', 'bb-code__nums', { 'aria-hidden': 'true' });
        codeIn = hostEl('textarea', 'bb-code__in', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', 'aria-label': t('Arduino sketch'), rows: '12', maxlength: '8000' });
        codeIn.value = build.code || '';
        edit.append(nums, codeIn);
        codeErr = hostEl('p', 'bb-code__err', { role: 'alert' });
        codeErr.hidden = true;
        const ser = hostEl('div', 'bb-serial');
        const sbar = hostEl('div', 'bb-serial__bar');
        sbar.appendChild(hostEl('span', null, null, t('Serial monitor')));
        sbar.appendChild(button('bb-btn bb-btn--small', t('Clear'), () => { serialOut.textContent = ''; serialText = ''; }));
        serialOut = hostEl('pre', 'bb-serial__out', { role: 'log', 'aria-label': t('Serial monitor') });
        ser.append(sbar, serialOut);
        panel.append(cbar, edit, codeErr, ser);
        root.appendChild(panel);
        const syncNums = () => {
          const n = Math.max(1, codeIn.value.split('\n').length);
          let s = '';
          for (let i = 1; i <= n; i++) s += i + '\n';
          nums.textContent = s;
          nums.scrollTop = codeIn.scrollTop;
        };
        syncNums();
        codeIn.addEventListener('scroll', () => { nums.scrollTop = codeIn.scrollTop; });
        codeIn.addEventListener('input', () => {
          if (locked) { codeIn.value = build.code; return; }
          build.code = codeIn.value;
          syncNums();
          markErrLine(0);
          changed(false);
        });
        codeIn.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
          // keep the indent of the line above (and one more after a {)
          const v = codeIn.value, at = codeIn.selectionStart;
          const lineStart = v.lastIndexOf('\n', at - 1) + 1;
          const line = v.slice(lineStart, at);
          let ind = (/^[ \t]*/.exec(line) || [''])[0];
          if (/\{\s*$/.test(line)) ind += '  ';
          e.preventDefault();
          codeIn.setRangeText('\n' + ind, at, codeIn.selectionEnd, 'end');
          codeIn.dispatchEvent(new Event('input'));
        });
      }
      const say = hostEl('p', 'sr-only', { 'aria-live': 'polite' });
      root.appendChild(say);
      let sayTimer = 0;
      const announce = (s) => { clearTimeout(sayTimer); sayTimer = setTimeout(() => { if (!destroyed) say.textContent = s; }, 120); };

      host.textContent = '';
      host.appendChild(root);

      /* the drawing's layers */
      const R = {};
      const gStatic = document.createElementNS(SVGNS, 'g');
      const gStrip = document.createElementNS(SVGNS, 'g');
      const gParts = document.createElementNS(SVGNS, 'g');
      const gWires = document.createElementNS(SVGNS, 'g');
      const gOver = document.createElementNS(SVGNS, 'g');
      gStrip.setAttribute('class', 'bb-strips');
      gOver.setAttribute('class', 'bb-over');
      svg.append(toDom(glowDefs(gid)), gStatic, gStrip, gParts, gWires, gOver);
      gStatic.appendChild(toDom(boardTree()));
      let fixtures = null;
      function drawFixtures(v) {
        if (fixtures) fixtures.remove();
        const kids = [];
        if (L.ard) kids.push(arduinoTree(L, {}));
        if (L.bat) kids.push(batteryTree(L, { hot: v && v.short }));
        if (L.mot) kids.push(motorTree(L, {}));
        // the terminals, as targets
        const terms = [];
        L.terms.forEach((list, name) => list.forEach(([x, y]) => terms.push(el('circle', { cx: x, cy: y, r: 9, class: 'bb-term', 'data-term': name, fill: 'transparent' }))));
        kids.push(el('g', {}, terms));
        fixtures = toDom(el('g', { class: 'bb-fixtures' }, kids), R);
        gStatic.appendChild(fixtures);
      }
      drawFixtures(null);

      /* the view: pan and zoom */
      const VB0 = L.vb.slice();
      let vb = VB0.slice();
      const applyVB = () => {
        svg.setAttribute('viewBox', vb.map(r1).join(' '));
        const z = VB0[2] / vb[2];
        root.classList.toggle('is-zoomed', z > 1.02);
        zOut.disabled = z <= 1.001;
        zFit.disabled = z <= 1.001;
      };
      function zoomTo(z, cx, cy) {
        z = clamp(z, 1, 5);
        const w = VB0[2] / z, h = VB0[3] / z;
        if (cx == null) { cx = vb[0] + vb[2] / 2; cy = vb[1] + vb[3] / 2; }
        const fx = (cx - vb[0]) / vb[2], fy = (cy - vb[1]) / vb[3];
        vb = [cx - fx * w, cy - fy * h, w, h];
        clampVB();
        applyVB();
      }
      function clampVB() {
        vb[0] = clamp(vb[0], VB0[0], VB0[0] + VB0[2] - vb[2]);
        vb[1] = clamp(vb[1], VB0[1], VB0[1] + VB0[3] - vb[3]);
      }
      const zoomBy = (k) => zoomTo((VB0[2] / vb[2]) * k);
      const fit = () => { vb = VB0.slice(); applyVB(); };
      applyVB();
      const screenScale = () => { const r = svg.getBoundingClientRect(); return r.width ? r.width / vb[2] : 1; };
      function toSvg(ev) {
        const r = svg.getBoundingClientRect();
        return [vb[0] + (ev.clientX - r.left) / r.width * vb[2], vb[1] + (ev.clientY - r.top) / r.height * vb[3]];
      }

      /* the build: what's where */
      function occupancy(b) {
        const m = new Map();
        b.parts.forEach((p) => p.at.forEach((h, i) => m.set(h, { k: 'part', id: p.id, leg: i })));
        b.wires.forEach((w, i) => { if (C.HOLES.has(w.from)) m.set(w.from, { k: 'wire', i }); if (C.HOLES.has(w.to)) m.set(w.to, { k: 'wire', i }); });
        return m;
      }
      // what's left in the bin: [{ key, type, color, ohms, n, any }]
      function binLeft() {
        const inv = C.inventory(spec);
        build.parts.forEach((p) => C.take(inv, p.type, p.type === 'led' ? p.color : p.type === 'resistor' ? p.ohms : null));
        const groups = new Map();
        inv.forEach((x) => {
          const key = x.type + ':' + (x.type === 'led' ? x.color : x.type === 'resistor' ? (x.ohms || 'any') : '');
          if (!groups.has(key)) groups.set(key, Object.assign({ key, n: 0 }, x));
          groups.get(key).n++;
        });
        return [...groups.values()];
      }
      const pickVal = {}; // the colour or value chosen for an "any" item
      function nextId(type) {
        const pre = C.TYPES[type].prefix;
        let n = 1;
        while (build.parts.some((p) => p.id === pre + n) || ['BAT', 'MOTOR', 'UNO'].includes(pre + n)) n++;
        return pre + n;
      }
      function footprint(type, rot) {
        return C.TYPES[type].foot.map(([dx, dy]) => {
          let x = dx, y = dy;
          for (let k = 0; k < rot; k++) { const nx = -y; y = x; x = nx; }
          return [x, y];
        });
      }
      // the holes a part's legs would go in, anchored at a hole; null where they can't
      function legsAt(anchor, offsets, ignoreId) {
        const h0 = C.HOLES.get(anchor);
        if (!h0) return null;
        const occ = occupancy(build);
        const at = [];
        for (const [dx, dy] of offsets) {
          const name = C.holeAt(h0.x + dx, h0.y + dy);
          if (!name) return null;
          const o = occ.get(name);
          if (o && !(o.k === 'part' && o.id === ignoreId)) return null;
          at.push(name);
        }
        return at;
      }
      const offsetsOf = (p) => { const h0 = C.HOLES.get(p.at[0]); return p.at.map((h) => { const q = C.HOLES.get(h); return [q.x - h0.x, q.y - h0.y]; }); };
      function snapshot() { history.push(JSON.stringify(build)); if (history.length > 60) history.shift(); }
      function undoOnce() {
        if (locked || !history.length) return;
        build = JSON.parse(history.pop());
        sel = null;
        rebuilt();
        changed(true);
        announce(t('Undone.'));
      }

      /* the circuit: compiled once per build, run live */
      let serialText = '';
      let lastView = null;
      function compileBench() {
        const old = S;
        B = C.bench(spec, build);
        S = C.session(B, { run: false, onSerial: (s) => { serialText += s; } });
        if (old && running && old.vm && !old.vm.done) {
          if (B.program || old.vm) S.adopt(old);
        }
        // the inputs as the learner set them
        build.parts.forEach((p) => { if (p.type === 'switch') S.set('on', p.id, Boolean(p.on)); if (p.type === 'pot') S.set('knob', p.id, p.knob); if (p.type === 'ldr') S.set('light', p.id, p.light); });
      }
      function rebuilt() {
        compileBench();
        drawBuild();
        drawBin();
        drawControls();
        paintLive();
      }
      function drawBuild() {
        while (gParts.firstChild) gParts.removeChild(gParts.firstChild);
        while (gWires.firstChild) gWires.removeChild(gWires.firstChild);
        const v = S.latch();
        lastView = v;
        const lk = looks(build, v, { burnt: S.burnt, press: S.inputs.press });
        build.parts.forEach((p) => gParts.appendChild(toDom(partTree(p, lk[p.id], { live: true, gid }), R)));
        build.wires.forEach((w, i) => gWires.appendChild(toDom(wireTree(L, w, i, { live: true, sel: sel && sel.k === 'wire' && sel.i === i }), R)));
        drawOverlay();
      }
      // what changes as the circuit runs: glows, the buzzer, the motor, warnings, the meter
      let spinAngle = 0, spinSpeed = 0;
      function paintLive() {
        if (!S) return;
        const v = S.latch();
        lastView = v;
        const lk = looks(build, v, { burnt: S.burnt, press: S.inputs.press });
        let buzzing = false, freq = 0;
        build.parts.forEach((p) => {
          const k = lk[p.id];
          if (p.type === 'led') {
            const g = R['glow:' + p.id], d = R['dome:' + p.id];
            if (g) g.setAttribute('opacity', k.lit ? r1(0.25 + 0.75 * k.glow) : 0);
            if (d && !k.burnt) d.setAttribute('fill', k.lit ? LED_ON[p.color] : LED_OFF[p.color]);
            if (k.burnt && d && d.getAttribute('fill') !== '#3a3433') { redrawPart(p, k); }
          } else if (p.type === 'buzzer') {
            const w = R['waves:' + p.id];
            if (w) w.setAttribute('opacity', k.on ? 1 : 0);
            if (k.on) { buzzing = true; S.pins.forEach((ps) => { if (ps.freq) freq = ps.freq; }); }
          } else if (p.type === 'button') {
            const cap = R['cap:' + p.id];
            if (cap) { cap.setAttribute('r', k.pressed ? 5.6 : 6.8); cap.setAttribute('fill', k.pressed ? '#9c2b22' : '#d9453a'); }
          }
        });
        sound.set(buzzing, freq || 2000);
        // the motor
        const mo = v.parts.MOTOR;
        spinSpeed = mo && mo.on ? mo.speed : 0;
        if (R.spinMark) R.spinMark.setAttribute('opacity', spinSpeed ? 1 : 0);
        // the Arduino's L light follows pin 13
        if (R.ledL && spec.arduino) {
          const p13 = S.pins[13];
          const on = p13.mode === C.OUTPUT && (p13.duty != null ? p13.duty > 0.05 : p13.level === 1);
          R.ledL.setAttribute('fill', on ? '#ffb02e' : '#6b5a3a');
        }
        if (R.heat) R.heat.setAttribute('opacity', v.short && v.shortSrc === 'BAT' ? 0.45 : 0);
        // what's wrong, if anything
        let msg = '', bad = false;
        if (v.short) { msg = v.shortSrc === 'BAT' ? t('Short circuit! The battery is getting hot: something joins + to − with nothing to slow the current.') : t('Short circuit! The Arduino’s power pin is joined straight to GND.'); bad = true; }
        else if (S.burnt.size) { const id = [...S.burnt][0]; msg = fill('{name} burnt out: too much current. Add a resistor in series, then put in a new LED (move it, or undo).', { name: partWords(B.parts.get(id), t, fill) }); bad = true; }
        else if (v.overload.length) { const p = v.overload[0]; msg = fill('Pin {pin} is giving {mA} mA, more than an Arduino pin can. Add a resistor.', { pin: p < 14 ? p : 'A' + (p - 14), mA: C.mA(v.pinPeak[p]) }); bad = true; }
        status.textContent = msg;
        status.hidden = !msg;
        status.classList.toggle('is-bad', bad);
        // the meter
        if (act && act.k === 'probe' || probes.red || probes.black) paintMeter(v);
        scheduleAnim();
      }
      function redrawPart(p, k) {
        const old = R['part:' + p.id];
        const fresh = toDom(partTree(p, k, { live: true, gid }), R);
        if (old && old.parentNode) old.parentNode.replaceChild(fresh, old); else gParts.appendChild(fresh);
        drawOverlay();
      }
      function paintMeter(v) {
        meterChip.hidden = false;
        if (!probes.red || !probes.black) { meterChip.textContent = probes.red ? t('Meter: now tap where the black probe goes.') : t('Meter: tap where the red probe goes.'); return; }
        const a = v.volt(probes.red), b = v.volt(probes.black);
        meterChip.textContent = a == null || b == null ? fill('Meter: {red} to {black}: not joined to anything', { red: probes.red, black: probes.black })
          : fill('Meter: {volts} V between {red} (red) and {black} (black)', { volts: (Math.round((a - b) * 100) / 100).toFixed(2), red: probes.red, black: probes.black });
      }

      /* the overlay: what's chosen, the ghost of a part being placed, a wire being drawn */
      let ghostAt = null, rubber = null, dragPart = null;
      function drawOverlay() {
        while (gOver.firstChild) gOver.removeChild(gOver.firstChild);
        while (gStrip.firstChild) gStrip.removeChild(gStrip.firstChild);
        const add = (tree) => { const d = toDom(tree); gOver.appendChild(d); return d; };
        // the strip under the pointer or cursor, lightly, to show what's joined
        const focus = hover || (cursorOn ? cursor : null) || (act && act.k === 'wire' ? act.from : null);
        if (focus && C.HOLES.has(focus)) {
          const h = C.HOLES.get(focus);
          const list = [...C.HOLES.values()].filter((q) => q.strip === h.strip);
          const xs = list.map((q) => hx(q.x)), ys = list.map((q) => hy(q.y));
          gStrip.appendChild(toDom(el('rect', { x: Math.min(...xs) - 7, y: Math.min(...ys) - 7, width: Math.max(...xs) - Math.min(...xs) + 14, height: Math.max(...ys) - Math.min(...ys) + 14, rx: 5, fill: '#4caf50', opacity: 0.18 })));
        }
        if (sel && sel.k === 'part') {
          const p = build.parts.find((x) => x.id === sel.id);
          if (p) {
            const pts = p.at.map(holeXY);
            const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
            add(el('rect', { x: Math.min(...xs) - 15, y: Math.min(...ys) - 15, width: Math.max(...xs) - Math.min(...xs) + 30, height: Math.max(...ys) - Math.min(...ys) + 30, rx: 6, fill: 'none', stroke: GOLD, 'stroke-width': 1.8, 'stroke-dasharray': '4 3' }));
          }
        }
        const ring = (name, color, r) => { const q = C.HOLES.has(name) ? holeXY(name) : termXY(L, name); add(el('circle', { cx: q[0], cy: q[1], r: r || 7.5, fill: 'none', stroke: color, 'stroke-width': 2.2 })); };
        if (act && act.k === 'wire') ring(act.from, GOLD, 8);
        if (hover && (!act || act.k !== 'place')) ring(hover, '#3f7d3a', 6.5);
        if (cursorOn) ring(cursor, GOLD, 9.5);
        if (probes.red) { const q = pointXY(L, probes.red); add(el('path', { d: `M${q[0]} ${q[1]}l-5 -12h10z`, fill: '#d93a2b', stroke: '#6d1b14' })); }
        if (probes.black) { const q = pointXY(L, probes.black); add(el('path', { d: `M${q[0]} ${q[1]}l-5 -12h10z`, fill: '#2a2a2a', stroke: '#000' })); }
        if (rubber) add(el('line', { x1: rubber[0][0], y1: rubber[0][1], x2: rubber[1][0], y2: rubber[1][1], stroke: wireColor === 'auto' ? GOLD : WIRE[wireColor], 'stroke-width': 3, 'stroke-dasharray': '5 4', 'stroke-linecap': 'round' }));
        // the ghost: a part on its way to the board
        const g = ghostPart();
        if (g) add(partTree(g.part, {}, { ghost: true, bad: !g.ok, gid }));
      }
      function ghostPart() {
        if (dragPart && ghostAt) {
          const p = build.parts.find((x) => x.id === dragPart.id);
          if (!p) return null;
          const at = legsAt(ghostAt, dragPart.offs, p.id);
          return at ? { part: Object.assign({}, p, { at }), ok: true } : null;
        }
        if (!act || act.k !== 'place' || !ghostAt) return null;
        const at = legsAt(ghostAt, footprint(act.item.type, act.rot));
        if (!at) return null;
        return { part: newPart(act.item, at, true), ok: true };
      }
      function newPart(item, at, preview) {
        const p = { id: preview ? '' : nextId(item.type), type: item.type, at };
        if (item.type === 'led') p.color = item.color === 'any' ? (pickVal[item.key] || 'red') : item.color;
        if (item.type === 'resistor') p.ohms = item.ohms || Number(pickVal[item.key] || 220);
        if (item.type === 'pot') { p.ohms = 10000; p.knob = 0.5; }
        if (item.type === 'ldr') p.light = 0.5;
        if (item.type === 'switch') p.on = false;
        return p;
      }

      /* edits */
      function changed(structure) {
        touched = true;
        if (structure) { S && S.burnt.clear(); }
        try { ctx.onChange && ctx.onChange(value()); } catch (e) { /* the page's own handler */ }
      }
      function placeAt(hole) {
        const item = act.item;
        const at = legsAt(hole, footprint(item.type, act.rot));
        if (!at) { setHint(t('That doesn’t fit there: a leg would land off the board or in a hole that’s taken. Try another hole, or rotate it.')); return false; }
        snapshot();
        const p = newPart(item, at, false);
        build.parts.push(p);
        sel = { k: 'part', id: p.id };
        act = null;
        rebuilt();
        changed(true);
        announce(fill('Placed {name} in {holes}.', { name: partWords(p, t, fill), holes: at.join(', ') }));
        setHint(legHint(p));
        return true;
      }
      function legHint(p) {
        if (p.type === 'led') return fill('The LED’s + leg (the anode) is in {a}, its − leg in {b}. Current only flows from + to −.', { a: p.at[0], b: p.at[1] });
        if (p.type === 'resistor') { const b = C.bands(p.ohms); return fill('{ohms}: its bands are {bands}.', { ohms: C.fmtOhms(p.ohms), bands: andList(b.map((x) => bandName(x, t))) }); }
        return fill('Placed in {holes}.', { holes: p.at.join(', ') });
      }
      function rotate() {
        if (locked) return;
        if (act && act.k === 'place') { act.rot = (act.rot + 1) % 4; drawOverlay(); return; }
        if (!sel || sel.k !== 'part') return;
        const p = build.parts.find((x) => x.id === sel.id);
        if (!p) return;
        const offs = offsetsOf(p).map(([x, y]) => [-y, x]);
        // turn about each leg in turn until it fits
        for (let i = 0; i < p.at.length; i++) {
          const piv = offs[i], h = C.HOLES.get(p.at[i]);
          const anchor = C.holeAt(h.x - piv[0], h.y - piv[1]);
          const at = anchor && legsAt(anchor, offs, p.id);
          if (at) { snapshot(); p.at = at; rebuilt(); changed(true); announce(fill('Turned {name}: now in {holes}.', { name: partWords(p, t, fill), holes: at.join(', ') })); return; }
        }
        setHint(t('There’s no room to turn it here.'));
      }
      function removeSel() {
        if (locked || !sel) return;
        snapshot();
        if (sel.k === 'part') { const p = build.parts.find((x) => x.id === sel.id); build.parts = build.parts.filter((x) => x.id !== sel.id); announce(fill('Took {name} back to the bin.', { name: partWords(p, t, fill) })); }
        else { build.wires.splice(sel.i, 1); announce(t('Wire removed.')); }
        sel = null;
        rebuilt();
        changed(true);
      }
      function addWire(a, b) {
        if (a === b) return false;
        const occ = occupancy(build);
        if ((C.HOLES.has(a) && occ.has(a)) || (C.HOLES.has(b) && occ.has(b))) { setHint(t('That hole is taken: a hole holds one leg or wire end.')); return false; }
        if (build.wires.length >= 40) { setHint(t('That’s as many wires as the bench takes.')); return false; }
        snapshot();
        const w = { from: a, to: b, color: wireColor === 'auto' ? autoColor(a, b, build.wires.length) : wireColor };
        build.wires.push(w);
        rebuilt();
        changed(true);
        announce(fill('Wire from {a} to {b}.', { a: pointWords(a, t, fill), b: pointWords(b, t, fill) }));
        return true;
      }
      const autoColor = (a, b, k) => {
        const plus = (x) => /^(\+[TB]|BAT\+|5V|3V3|VIN)/.test(x), minus = (x) => /^(-[TB]|BAT-|GND)/.test(x);
        return plus(a) || plus(b) ? 'red' : minus(a) || minus(b) ? 'black' : ['blue', 'green', 'yellow', 'orange', 'purple'][k % 5];
      };
      function setColor(c) {
        wireColor = c;
        Object.keys(swBtns).forEach((k) => swBtns[k].setAttribute('aria-pressed', k === c ? 'true' : 'false'));
        if (!locked && sel && sel.k === 'wire' && c !== 'auto' && build.wires[sel.i]) { snapshot(); build.wires[sel.i].color = c; rebuilt(); changed(false); }
      }
      function toggleProbe() {
        if (act && act.k === 'probe') { act = null; probes = { red: null, black: null, next: 'red' }; meterChip.hidden = true; btnMeter.setAttribute('aria-pressed', 'false'); setHint(''); drawOverlay(); return; }
        act = { k: 'probe' };
        btnMeter.setAttribute('aria-pressed', 'true');
        setHint(t('Meter: tap two holes or pins to read the voltage between them.'));
        paintLive();
        drawOverlay();
      }
      function resetAll() {
        if (locked) return;
        stopSketch();
        snapshot();
        build = clone(startB);
        if (codeIn) { codeIn.value = build.code || ''; codeIn.dispatchEvent(new Event('input')); }
        sel = null; act = null;
        rebuilt();
        touched = false;
        announce(t('The bench is back as it started.'));
      }
      function setHint(s) { hint.textContent = s || ''; }

      /* taps: on a part, a wire, a hole or a terminal */
      function pointNear(sx, sy) {
        const scale = screenScale();
        const reach = Math.max(PITCH * 0.55, 10 / scale);
        let best = null, bd = Infinity;
        L.terms.forEach((list, name) => list.forEach(([x, y]) => { const d = Math.hypot(x - sx, y - sy); if (d < bd && d <= Math.max(10, 12 / scale)) { bd = d; best = name; } }));
        if (best) return best;
        const x = Math.round((sx - BMX) / PITCH), y = Math.round((sy - BMY) / PITCH) - 3;
        for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const name = C.holeAt(x + dx, y + dy);
          if (!name) continue;
          const [px, py] = holeXY(name);
          const d = Math.hypot(px - sx, py - sy);
          if (d < bd && d <= reach) { bd = d; best = name; }
        }
        return best;
      }
      function tapPoint(name) {
        if (locked || !name) return;
        if (act && act.k === 'probe') {
          probes[probes.next] = name;
          probes.next = probes.next === 'red' ? 'black' : 'red';
          paintLive(); drawOverlay();
          announce(pointWords(name, t, fill));
          return;
        }
        if (act && act.k === 'place') { if (C.HOLES.has(name)) placeAt(name); else setHint(t('Parts go in breadboard holes; join them to the pins with wires.')); return; }
        if (act && act.k === 'wire') {
          if (name === act.from) { act = null; setHint(''); drawOverlay(); return; }
          const from = act.from;
          act = null;
          if (!addWire(from, name)) drawOverlay();
          else setHint('');
          return;
        }
        const occ = C.HOLES.has(name) ? occupancy(build).get(name) : null;
        if (occ) { sel = occ.k === 'part' ? { k: 'part', id: occ.id } : { k: 'wire', i: occ.i }; drawBuild(); announce(occ.k === 'part' ? partWords(build.parts.find((p) => p.id === occ.id), t, fill) : t('A wire')); return; }
        act = { k: 'wire', from: name };
        sel = null;
        drawOverlay();
        setHint(fill('Wire from {a}: now tap where it goes.', { a: pointWords(name, t, fill) }));
        announce(fill('Wire from {a}: now tap where it goes.', { a: pointWords(name, t, fill) }));
      }
      function tapPart(id) {
        if (locked) return;
        if (act && act.k === 'place') return;
        if (act && act.k === 'probe') { const p = build.parts.find((x) => x.id === id); if (p) tapPoint(p.at[0]); return; }
        if (act && act.k === 'wire') { act = null; setHint(''); }
        const p = build.parts.find((x) => x.id === id);
        if (!p) return;
        if (p.type === 'switch') {
          p.on = !p.on;
          S.set('on', id, p.on);
          changed(false);
          redrawPart(p, looks(build, S.view(), { burnt: S.burnt, press: S.inputs.press })[p.id]);
          paintLive();
          const ctl = ctlRefs[id];
          if (ctl) { ctl.textContent = fill(p.on ? 'Switch {id}: on' : 'Switch {id}: off', { id }); ctl.setAttribute('aria-pressed', p.on ? 'true' : 'false'); }
          announce(fill(p.on ? 'Switch {id}: on' : 'Switch {id}: off', { id }));
        }
        sel = { k: 'part', id };
        drawBuild();
        setHint(p.type === 'pot' ? t('Turn the knob with its slider below the bench.') : p.type === 'ldr' ? t('Change the light with its slider below the bench.') : legHint(p));
        announce(partWords(p, t, fill));
      }
      function press(id, down) {
        if (locked && down) return;
        if (!S || !S.inputs.press || !has(S.inputs.press, id)) return;
        S.set('press', id, down);
        touched = touched || down;
        paintLive();
      }

      /* pointers: tap, drag a part from the bin or on the board, draw a wire, pan, pinch */
      const ptrs = new Map();
      let gesture = null; // { k: 'tap'|'move'|'wire'|'pan'|'pinch'|'press', ... }
      const THRESH = 7;
      function onDown(e) {
        if (destroyed) return;
        svg.focus({ preventScroll: true });
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2) {
          const [p1, p2] = [...ptrs.values()];
          if (gesture && gesture.k === 'press') press(gesture.id, false);
          gesture = { k: 'pinch', d0: Math.hypot(p2.x - p1.x, p2.y - p1.y), z0: VB0[2] / vb[2], c: toSvg({ clientX: (p1.x + p2.x) / 2, clientY: (p1.y + p2.y) / 2 }) };
          return;
        }
        if (ptrs.size > 2) return;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        const [sx, sy] = toSvg(e);
        // a terminal (a battery clip, an Arduino pin) wins over the wires that end on it
        // and a hole right under the pointer wins over a wire passing over it
        const near = pointNear(sx, sy);
        const onTerm = near && !C.HOLES.has(near);
        const onHole = near && C.HOLES.has(near) && Math.hypot(holeXY(near)[0] - sx, holeXY(near)[1] - sy) <= PITCH * 0.4;
        const partEl = !onTerm && e.target.closest && e.target.closest('[data-part]');
        const wireEl = !onTerm && !onHole && e.target.closest && e.target.closest('[data-wire]');
        const termEl = e.target.closest && e.target.closest('[data-term]');
        const g = { k: 'tap', x0: e.clientX, y0: e.clientY, sx, sy, moved: false };
        if (onTerm) g.point = near;
        else if (partEl && !(act && (act.k === 'place'))) {
          g.part = partEl.getAttribute('data-part');
          const p = build.parts.find((x) => x.id === g.part);
          if (p && p.type === 'button' && !(act && act.k !== 'wire')) { press(p.id, true); g.pressing = p.id; }
        } else if (wireEl) g.wire = Number(wireEl.getAttribute('data-wire'));
        else g.point = termEl ? termEl.getAttribute('data-term') : near;
        gesture = g;
      }
      function onMove(e) {
        if (destroyed) return;
        if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [sx, sy] = toSvg(e);
        if (gesture && gesture.k === 'pinch' && ptrs.size === 2) {
          const [p1, p2] = [...ptrs.values()];
          const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          zoomTo(gesture.z0 * d / Math.max(10, gesture.d0), gesture.c[0], gesture.c[1]);
          return;
        }
        if (!gesture) {
          // hovering (a mouse): the ghost follows, the hole under it shows its strip
          if (e.pointerType === 'mouse') {
            const h = pointNear(sx, sy);
            if (act && act.k === 'place') { if (h !== ghostAt) { ghostAt = h && C.HOLES.has(h) ? h : null; hover = null; drawOverlay(); } }
            else if (h !== hover) { hover = h; if (act && act.k === 'wire' && h) rubber = [pointXY(L, act.from), pointXY(L, h)]; drawOverlay(); }
          }
          return;
        }
        const g = gesture;
        if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < THRESH) return;
        if (!g.moved) {
          g.moved = true;
          if (g.pressing) { press(g.pressing, false); g.pressing = null; }
          if (locked) g.k = 'pan';
          else if (g.part && !(act && act.k === 'probe')) {
            const p = build.parts.find((x) => x.id === g.part);
            const near = pointNear(g.sx, g.sy);
            const grab = near && C.HOLES.has(near) ? near : p.at[0];
            const gh = C.HOLES.get(grab), h0 = C.HOLES.get(p.at[0]);
            g.k = 'move';
            dragPart = { id: p.id, offs: offsetsOf(p).map(([x, y]) => [x - (gh.x - h0.x), y - (gh.y - h0.y)]) };
            sel = { k: 'part', id: p.id };
          } else if (g.point && !(act && act.k === 'probe') && !(act && act.k === 'place') && !(C.HOLES.has(g.point) && occupancy(build).has(g.point))) {
            g.k = 'wire';
            act = { k: 'wire', from: act && act.k === 'wire' ? act.from : g.point };
          } else g.k = root.classList.contains('is-zoomed') ? 'pan' : 'none';
        }
        if (g.k === 'pan') {
          const r = svg.getBoundingClientRect();
          vb[0] -= (e.clientX - g.x0) / r.width * vb[2];
          vb[1] -= (e.clientY - g.y0) / r.height * vb[3];
          g.x0 = e.clientX; g.y0 = e.clientY;
          clampVB(); applyVB();
        } else if (g.k === 'move') {
          const h = pointNear(sx, sy);
          ghostAt = h && C.HOLES.has(h) ? h : null;
          drawOverlay();
        } else if (g.k === 'wire') {
          const h = pointNear(sx, sy);
          hover = h;
          rubber = [pointXY(L, act.from), h ? pointXY(L, h) : [sx, sy]];
          drawOverlay();
        }
      }
      function onUp(e) {
        if (destroyed) return;
        ptrs.delete(e.pointerId);
        const g = gesture;
        if (g && g.k === 'pinch') { if (ptrs.size === 0) gesture = null; return; }
        gesture = null;
        if (!g) return;
        if (g.pressing) press(g.pressing, false);
        if (e.type === 'pointercancel') { dragPart = null; rubber = null; drawOverlay(); return; }
        if (!g.moved) {
          // a tap: on a phone, a tap on holes too small to hit surely zooms in first
          const pitch = PITCH * screenScale();
          if (pitch < 13 && !g.part && g.wire == null && !g.pressing && g.point && C.HOLES.has(g.point)) {
            zoomTo(26 / PITCH / (screenScale() / (VB0[2] / vb[2])) , g.sx, g.sy);
            setHint(t('Zoomed in: now tap the hole you want.'));
            return;
          }
          if (g.part) { if (!g.pressing) tapPart(g.part); return; }
          if (g.wire != null && !(act && (act.k === 'wire' || act.k === 'probe'))) { if (!locked) { sel = { k: 'wire', i: g.wire }; act = null; drawBuild(); announce(t('A wire. Delete removes it; a colour button recolours it.')); } return; }
          if (g.point) { tapPoint(g.point); return; }
          if (act && act.k === 'wire') { act = null; rubber = null; setHint(''); }
          sel = null; drawBuild();
          return;
        }
        if (g.k === 'move' && dragPart) {
          const p = build.parts.find((x) => x.id === dragPart.id);
          const at = ghostAt && legsAt(ghostAt, dragPart.offs, p.id);
          dragPart = null; ghostAt = null;
          if (at && at.join() !== p.at.join()) { snapshot(); p.at = at; rebuilt(); changed(true); announce(fill('Moved {name} to {holes}.', { name: partWords(p, t, fill), holes: at.join(', ') })); }
          else drawOverlay();
          return;
        }
        if (g.k === 'wire') {
          const to = pointNear(...toSvg(e));
          const from = act.from;
          rubber = null; hover = null;
          if (to && to !== from) { act = null; addWire(from, to); setHint(''); }
          else { setHint(fill('Wire from {a}: now tap where it goes.', { a: pointWords(from, t, fill) })); drawOverlay(); }
        }
      }
      function onLeave() { if (!gesture && (hover || ghostAt)) { hover = null; if (!(act && act.k === 'place')) ghostAt = null; drawOverlay(); } }
      function onWheel(e) {
        if (!e.ctrlKey) return; // a plain wheel scrolls the page
        e.preventDefault();
        const [sx, sy] = toSvg(e);
        zoomTo((VB0[2] / vb[2]) * Math.exp(-e.deltaY * 0.01), sx, sy);
      }
      svg.addEventListener('pointerdown', onDown);
      svg.addEventListener('pointermove', onMove);
      svg.addEventListener('pointerup', onUp);
      svg.addEventListener('pointercancel', onUp);
      svg.addEventListener('pointerleave', onLeave);
      svg.addEventListener('wheel', onWheel, { passive: false });
      const noMenu = (e) => { if (gesture) e.preventDefault(); };
      svg.addEventListener('contextmenu', noMenu);

      /* the keyboard: a cursor over the holes and pins */
      const ROW_ORDER = ['-T', '+T', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', '+B', '-B', 'terms'];
      const termList = [...L.terms.keys()];
      function rowOf(name) { if (C.HOLES.has(name)) return C.HOLES.get(name).row; return 'terms'; }
      function moveCursor(dx, dy) {
        let row = rowOf(cursor);
        let col = C.HOLES.has(cursor) ? C.HOLES.get(cursor).col : 1;
        if (row === 'terms') {
          let i = termList.indexOf(cursor);
          if (dy < 0) { cursor = '-B' + nearestRail(col); return; }
          if (dx) { i = (i + dx + termList.length) % termList.length; cursor = termList[i]; }
          return;
        }
        if (dy) {
          let ri = ROW_ORDER.indexOf(row) + dy;
          ri = clamp(ri, 0, termList.length ? ROW_ORDER.length - 1 : ROW_ORDER.length - 2);
          row = ROW_ORDER[ri];
          if (row === 'terms') { cursor = termList[0]; return; }
        }
        if (dx) col = clamp(col + dx, 1, C.COLS);
        if (/^[+-]/.test(row)) {
          if (dx && !C.RAIL_COLS.includes(col)) col = clamp(col + dx, 1, C.COLS);
          cursor = row + nearestRail(col);
        } else cursor = row + col;
      }
      const nearestRail = (col) => C.RAIL_COLS.reduce((b, c) => (Math.abs(c - col) < Math.abs(b - col) ? c : b), C.RAIL_COLS[0]);
      function onKey(e) {
        if (destroyed) return;
        const k = e.key;
        if (k === 'Escape') {
          if (act || sel || dragPart) { act = null; sel = null; dragPart = null; rubber = null; ghostAt = null; probes = { red: null, black: null, next: 'red' }; meterChip.hidden = true; btnMeter.setAttribute('aria-pressed', 'false'); setHint(''); drawBuild(); e.preventDefault(); }
          return;
        }
        if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { undoOnce(); e.preventDefault(); return; }
        if (k === 'r' || k === 'R') { rotate(); e.preventDefault(); return; }
        if (k === 'Delete' || k === 'Backspace') { removeSel(); e.preventDefault(); return; }
        const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (dirs[k]) {
          e.preventDefault();
          cursorOn = true;
          moveCursor(dirs[k][0], dirs[k][1]);
          if (act && act.k === 'place') ghostAt = C.HOLES.has(cursor) ? cursor : null;
          if (act && act.k === 'wire') rubber = [pointXY(L, act.from), pointXY(L, cursor)];
          drawOverlay();
          const occ = C.HOLES.has(cursor) ? occupancy(build).get(cursor) : null;
          announce(pointWords(cursor, t, fill) + (occ ? ' · ' + (occ.k === 'part' ? partWords(build.parts.find((p) => p.id === occ.id), t, fill) : t('a wire')) : ''));
          return;
        }
        if (k === 'Enter' || k === ' ') {
          if (!cursorOn) { cursorOn = true; drawOverlay(); announce(pointWords(cursor, t, fill)); e.preventDefault(); return; }
          e.preventDefault();
          const occ = C.HOLES.has(cursor) ? occupancy(build).get(cursor) : null;
          if (occ && occ.k === 'part' && !(act && act.k === 'probe')) {
            const p = build.parts.find((x) => x.id === occ.id);
            if (p && p.type === 'button') { press(p.id, true); setTimeout(() => press(p.id, false), 600); return; }
            tapPart(occ.id);
            return;
          }
          tapPoint(cursor);
        }
      }
      svg.addEventListener('keydown', onKey);
      svg.addEventListener('blur', () => { if (cursorOn) { cursorOn = false; drawOverlay(); } });
      goBox.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = C.parsePoint(goIn.value, spec.arduino);
        let name = q && (q.hole || q.term || (q.rail ? q.rail + nearestRail(q.col || 1) : null));
        if (name && !C.HOLES.has(name) && !L.terms.has(name)) name = null;
        if (!name) { setHint(t('Type a hole like a12 (a row a to j, a column 1 to 30), a rail like +T5, or a pin like D13, 5V or GND.')); return; }
        cursor = name;
        const occ = C.HOLES.has(name) ? occupancy(build).get(name) : null;
        if (occ && occ.k === 'part' && !(act && act.k === 'probe')) tapPart(occ.id); else tapPoint(name);
        goIn.select();
      });

      /* the bin */
      function drawBin() {
        const had = document.activeElement && binList.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
        binList.textContent = '';
        const left = binLeft();
        if (!left.length) { binList.appendChild(hostEl('p', 'bb-bin__empty', null, isTask || C.inventory(spec).length ? t('Everything is on the board. Delete a part to put it back.') : t('Wires only: tap a hole or pin, then another.'))); }
        left.forEach((it) => {
          const row = hostEl('div', 'bb-item', { role: 'listitem' });
          const label = it.type === 'led' ? (it.color === 'any' ? partName('led', t) : fill('{color} LED', { color: colorName(it.color, t) }))
            : it.type === 'resistor' ? (it.ohms ? (spec.hide_values ? partName('resistor', t) : fill('Resistor {ohms}', { ohms: C.fmtOhms(it.ohms) })) : partName('resistor', t))
              : partName(it.type, t);
          const b = hostEl('button', 'bb-item__btn' + (act && act.k === 'place' && act.item.key === it.key ? ' is-on' : ''), { type: 'button', 'data-key': it.key, 'aria-pressed': act && act.k === 'place' && act.item.key === it.key ? 'true' : 'false' });
          const icon = document.createElementNS(SVGNS, 'svg');
          icon.setAttribute('viewBox', '-20 -14 40 28');
          icon.setAttribute('class', 'bb-item__icon');
          icon.setAttribute('aria-hidden', 'true');
          icon.appendChild(toDom(binIcon(it)));
          b.appendChild(icon);
          b.appendChild(hostEl('span', 'bb-item__name', null, label));
          b.appendChild(hostEl('span', 'bb-item__n', null, '×' + it.n));
          if (it.type === 'resistor' && it.ohms && spec.hide_values) b.setAttribute('aria-label', fill('Resistor with bands {bands}', { bands: andList(C.bands(it.ohms).map((x) => bandName(x, t))) }) + ' ×' + it.n);
          b.addEventListener('click', () => choose(it));
          b.addEventListener('pointerdown', (e) => binDrag(e, it));
          row.appendChild(b);
          if ((it.type === 'led' && it.color === 'any') || (it.type === 'resistor' && !it.ohms)) {
            const s = hostEl('select', 'bb-item__pick', { 'aria-label': it.type === 'led' ? t('LED colour') : t('Resistor value') });
            const opts = it.type === 'led' ? C.LED_COLORS : C.STANDARD;
            opts.forEach((o) => { const op = hostEl('option', null, { value: String(o) }, it.type === 'led' ? colorName(o, t) : C.fmtOhms(o)); s.appendChild(op); });
            s.value = String(pickVal[it.key] || (it.type === 'led' ? 'red' : 220));
            s.addEventListener('change', () => { pickVal[it.key] = it.type === 'led' ? s.value : Number(s.value); drawOverlay(); });
            row.appendChild(s);
          }
          binList.appendChild(row);
        });
        if (had) { const again = binList.querySelector(`[data-key="${CSS.escape(had)}"]`); if (again) again.focus({ preventScroll: true }); }
        if (locked) binList.querySelectorAll('button, select').forEach((b) => { b.disabled = true; });
      }
      function binIcon(it) {
        if (it.type === 'led') { const c = it.color === 'any' ? 'red' : it.color; return el('g', {}, [el('line', { x1: -4, y1: 4, x2: -4, y2: 13, stroke: LEG, 'stroke-width': 2 }), el('line', { x1: 4, y1: 4, x2: 4, y2: 11, stroke: LEG, 'stroke-width': 2 }), el('path', { d: 'M -8 6 V -3 A 8 8 0 0 1 8 -3 V 6 Z', fill: LED_ON[c], stroke: '#00000055' })]); }
        if (it.type === 'resistor') { const b = C.bands(it.ohms || 220); return el('g', {}, [el('line', { x1: -19, y1: 0, x2: 19, y2: 0, stroke: LEG, 'stroke-width': 2 }), el('rect', { x: -12, y: -5, width: 24, height: 10, rx: 5, fill: '#e3c995', stroke: '#9c7a43' }), el('rect', { x: -8, y: -5, width: 2.5, height: 10, fill: BAND[b[0]] }), el('rect', { x: -4, y: -5, width: 2.5, height: 10, fill: BAND[b[1]] }), el('rect', { x: 0, y: -5, width: 2.5, height: 10, fill: BAND[b[2]] }), el('rect', { x: 6, y: -5, width: 2.5, height: 10, fill: BAND[b[3]] })]); }
        if (it.type === 'button') return el('g', {}, [el('rect', { x: -9, y: -9, width: 18, height: 18, rx: 2, fill: '#3b3d40' }), el('circle', { r: 5.5, fill: '#d9453a' })]);
        if (it.type === 'switch') return el('g', {}, [el('rect', { x: -15, y: -6, width: 30, height: 12, rx: 2, fill: '#3b3f45' }), el('rect', { x: -12, y: -4, width: 9, height: 8, rx: 1.5, fill: '#ececec' })]);
        if (it.type === 'pot') return el('g', {}, [el('rect', { x: -11, y: -11, width: 22, height: 22, rx: 2, fill: '#2f63b3' }), el('circle', { r: 7.5, fill: '#ece8de' }), el('line', { x1: 0, y1: 0, x2: -4, y2: -5, stroke: '#222', 'stroke-width': 2 })]);
        if (it.type === 'ldr') return el('g', {}, [el('circle', { r: 8, fill: '#e4b14d', stroke: '#9b6a1d' }), el('path', { d: 'M -4.5 -3.5 H 4.5 V -1.2 H -4.5 V 1.2 H 4.5 V 3.5 H -4.5', fill: 'none', stroke: '#7a4a1a', 'stroke-width': 1 })]);
        if (it.type === 'buzzer') return el('g', {}, [el('circle', { r: 10, fill: '#1f1f1f' }), el('circle', { r: 2.5, fill: '#555' })]);
        return el('g');
      }
      function choose(it) {
        if (locked) return;
        if (act && act.k === 'place' && act.item.key === it.key) { act = null; setHint(''); drawBin(); drawOverlay(); return; }
        act = { k: 'place', item: it, rot: act && act.k === 'place' ? act.rot : 0 };
        sel = null;
        ghostAt = cursorOn && C.HOLES.has(cursor) ? cursor : null;
        drawBin();
        drawOverlay();
        const what = it.type === 'led' ? t('Tap a hole for the LED’s + leg (the anode); the − leg goes in the next column. R turns it.') : it.type === 'pot' || it.type === 'switch' ? t('Tap a hole for its first leg; the others go in the next two columns. R turns it.') : t('Tap a hole for its first leg. R turns it.');
        setHint(what);
        announce(what);
      }
      // dragging from the bin onto the board
      function binDrag(e, it) {
        if (locked || e.button > 0) return;
        const x0 = e.clientX, y0 = e.clientY;
        let dragging = false;
        const target = e.currentTarget;
        try { target.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        const move = (ev) => {
          if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) return;
          if (!dragging) { dragging = true; act = { k: 'place', item: it, rot: act && act.k === 'place' ? act.rot : 0 }; sel = null; }
          const r = svg.getBoundingClientRect();
          const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
          const h = inside ? pointNear(...toSvg(ev)) : null;
          ghostAt = h && C.HOLES.has(h) ? h : null;
          drawOverlay();
        };
        const up = (ev) => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          if (!dragging) return; // a click: choose() handles it
          if (ev.type === 'pointercancel') { ghostAt = null; act = null; drawBin(); drawOverlay(); return; } // the page scrolled instead
          target.addEventListener('click', swallow, { once: true, capture: true });
          setTimeout(() => target.removeEventListener('click', swallow, { capture: true }), 400);
          if (ghostAt) placeAt(ghostAt); else { setHint(t('Drop it on a hole of the board.')); drawBin(); }
          ghostAt = null;
          drawOverlay();
        };
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }

      /* the controls row: what the learner can press, flip and turn */
      const ctlRefs = {};
      function drawControls() {
        const had = document.activeElement && controls.contains(document.activeElement) ? document.activeElement.getAttribute('data-ctl') : null;
        controls.textContent = '';
        Object.keys(ctlRefs).forEach((k) => delete ctlRefs[k]);
        build.parts.forEach((p) => {
          if (p.type === 'button') {
            const b = button('bb-ctl bb-ctl--press', fill('Hold to press {id}', { id: p.id }));
            const down = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } press(p.id, true); b.classList.add('is-down'); };
            const upF = () => { press(p.id, false); b.classList.remove('is-down'); };
            b.addEventListener('pointerdown', down);
            b.addEventListener('pointerup', upF);
            b.addEventListener('pointercancel', upF);
            b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(p.id, true); b.classList.add('is-down'); } });
            b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') upF(); });
            b.addEventListener('blur', upF);
            controls.appendChild(b);
          } else if (p.type === 'switch') {
            const b = button('bb-ctl', fill(p.on ? 'Switch {id}: on' : 'Switch {id}: off', { id: p.id }), () => tapPart(p.id), { 'aria-pressed': p.on ? 'true' : 'false', 'data-ctl': p.id });
            ctlRefs[p.id] = b;
            controls.appendChild(b);
          } else if (p.type === 'pot' || p.type === 'ldr') {
            const lab = hostEl('label', 'bb-ctl bb-ctl--slider');
            lab.appendChild(hostEl('span', null, null, p.type === 'pot' ? fill('Knob {id}', { id: p.id }) : fill('Light on {id}', { id: p.id })));
            const input = hostEl('input', null, { type: 'range', min: '0', max: '100', step: '1' });
            input.value = String(Math.round((p.type === 'pot' ? p.knob : p.light) * 100));
            const out = hostEl('output', null, null, p.type === 'pot' ? input.value + '%' : lightWord(p.light));
            input.addEventListener('input', () => {
              if (locked) { input.value = String(Math.round((p.type === 'pot' ? p.knob : p.light) * 100)); return; }
              const x = Number(input.value) / 100;
              if (p.type === 'pot') { p.knob = x; S.set('knob', p.id, x); out.textContent = input.value + '%'; const kn = R['knob:' + p.id]; if (kn) { const pts = p.at.map(holeXY); const ang = Math.atan2(pts[2][1] - pts[0][1], pts[2][0] - pts[0][0]) * 180 / Math.PI; kn.setAttribute('transform', `rotate(${r1(-135 + 270 * x - ang)})`); } }
              else { p.light = x; S.set('light', p.id, x); out.textContent = lightWord(x); }
              input.setAttribute('aria-valuetext', out.textContent);
              touched = true;
              paintLive();
              changed(false);
            });
            lab.append(input, out);
            controls.appendChild(lab);
          }
        });
        controls.hidden = !controls.childNodes.length;
        if (had) { const again = controls.querySelector(`[data-ctl="${had}"]`); if (again) again.focus({ preventScroll: true }); }
      }
      const lightWord = (x) => (x < 0.2 ? t('dark') : x < 0.5 ? t('dim') : x < 0.8 ? t('bright') : t('very bright'));

      /* the sketch */
      let raf = 0, realBase = 0, simBase = 0, onScreen = true, lastShown = -1;
      function markErrLine(line) {
        if (!nums) return;
        nums.classList.toggle('has-err', Boolean(line));
        if (!line) { codeErr.hidden = true; return; }
      }
      function showErr(err) {
        codeErr.textContent = sketchText(err, t, fill);
        codeErr.hidden = false;
        if (err && err.line && codeIn) {
          const lines = codeIn.value.split('\n');
          let at = 0;
          for (let i = 0; i < err.line - 1 && i < lines.length; i++) at += lines[i].length + 1;
          try { codeIn.focus({ preventScroll: true }); codeIn.setSelectionRange(at, at + (lines[err.line - 1] || '').length); } catch (e) { /* fine */ }
        }
      }
      function runSketch() {
        if (!spec.arduino) return;
        build.code = codeIn.value;
        compileBench();
        if (B.codeError) { stopSketch(); showErr(B.codeError); return; }
        codeErr.hidden = true;
        if (!B.program) { stopSketch(); codeErr.textContent = t('Write a sketch first: void setup() { } and void loop() { }.'); codeErr.hidden = false; return; }
        serialOut.textContent = '';
        serialText = '';
        S.start();
        running = true;
        realBase = performance.now();
        simBase = 0;
        runBtn.textContent = t('Upload again');
        stopBtn.disabled = false;
        paintLive();
        scheduleAnim();
      }
      function stopSketch() {
        if (!running) return;
        running = false;
        if (S) S.stop();
        if (stopBtn) stopBtn.disabled = true;
        if (runBtn) runBtn.textContent = t('Upload and run');
        if (runState) runState.textContent = t('Stopped');
        paintLive();
      }
      const animating = () => !destroyed && onScreen && !document.hidden && ((running && S && S.vm && !S.vm.done) || (!reduce && spinSpeed));
      function scheduleAnim() { if (!raf && animating()) { raf = requestAnimationFrame(frame); } }
      let lastFrame = 0;
      function frame(now) {
        raf = 0;
        if (!animating()) { lastFrame = 0; return; }
        const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
        lastFrame = now;
        if (running && S.vm && !S.vm.done) {
          const target = simBase + (now - realBase) * 1000;
          const before = S.vm.t;
          C.advance(S.vm, target, 30000);
          S.tones();
          if (S.vm.t < target - 150000) { realBase = now; simBase = S.vm.t; } // a busy sketch: let it run slower than real time
          if (S.vm.error) { const err = S.vm.error; stopSketch(); showErr(err); }
          if (serialText) {
            const cur = serialOut.textContent + serialText;
            serialOut.textContent = cur.length > 6000 ? cur.slice(-5000) : cur;
            serialText = '';
            serialOut.scrollTop = serialOut.scrollHeight;
            if (R.ledTX) { R.ledTX.setAttribute('fill', '#ffd76e'); setTimeout(() => { if (R.ledTX) R.ledTX.setAttribute('fill', '#6b5a3a'); }, 60); }
          }
          if (S.dirty || S.vm.t !== before) paintLive();
          const sec = Math.floor(S.vm.t / 100000) / 10;
          if (sec !== lastShown && runState) { lastShown = sec; runState.textContent = fill('Running · {s} s', { s: sec.toFixed(1) }); }
          if (S.vm && S.vm.noBegin && !serialOut.textContent && !S.vm.toldBegin) { S.vm.toldBegin = true; serialOut.textContent = t('(Nothing is sent until setup() calls Serial.begin(9600);)'); }
        }
        if (spinSpeed && !reduce && R.prop && L.mot) {
          spinAngle = (spinAngle + spinSpeed * dt * 900) % 360;
          const cx = L.mot.x + 44, cy = L.mot.y + 48;
          R.prop.setAttribute('transform', `rotate(${r1(spinAngle)} ${cx} ${cy})`);
        }
        raf = requestAnimationFrame(frame);
      }
      const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
        const was = onScreen;
        onScreen = es.some((x) => x.isIntersecting);
        if (onScreen && !was && running) { realBase = performance.now(); simBase = S && S.vm ? S.vm.t : 0; }
        if (!onScreen) sound.set(false);
        scheduleAnim();
      }) : null;
      if (io) io.observe(root);
      const onVis = () => { if (!document.hidden && running) { realBase = performance.now(); simBase = S && S.vm ? S.vm.t : 0; } if (document.hidden) sound.set(false); scheduleAnim(); };
      document.addEventListener('visibilitychange', onVis);

      // first drawing
      rebuilt();
      setHint(isTask ? t('Build it on the board, then press Check.') : (spec.parts.length ? t('Try it: press, slide and turn the parts, or change the build.') : t('Choose a part from the bin, then tap a hole to place it. Tap two holes or pins to wire them.')));

      function value() {
        if (!touched) return null;
        return { parts: build.parts.map((p) => Object.assign({}, p, { at: p.at.slice() })), wires: build.wires.map((w) => Object.assign({}, w)), code: build.code || '' };
      }

      return {
        value,
        reset() { stopSketch(); build = clone(startB); if (codeIn) { codeIn.value = build.code || ''; codeIn.dispatchEvent(new Event('input')); } sel = null; act = null; history.length = 0; rebuilt(); touched = false; setHint(''); },
        reveal() {
          const tk = goal ? { spec, goal } : null;
          const ref = tk && referenceOf(tk);
          if (!ref) return;
          stopSketch();
          build = clone(ref.build);
          if (codeIn) { codeIn.value = build.code || ''; codeIn.dispatchEvent(new Event('input')); }
          sel = null; act = null;
          rebuilt();
          touched = true;
          if (spec.arduino && build.code && build.code.trim()) runSketch();
        },
        lock(on) {
          locked = Boolean(on);
          root.classList.toggle('is-locked', locked);
          if (locked) { act = null; sel = null; dragPart = null; rubber = null; drawOverlay(); }
          [btnRotate, btnDelete, btnUndo, btnMeter, btnReset, goBtn].forEach((b) => { b.disabled = locked; });
          goIn.disabled = locked;
          Object.values(swBtns).forEach((b) => { b.disabled = locked; });
          binList.querySelectorAll('button, select').forEach((b) => { b.disabled = locked; });
          controls.querySelectorAll('input').forEach((b) => { b.disabled = locked; });
          if (codeIn) codeIn.readOnly = locked;
        },
        destroy() {
          destroyed = true;
          running = false;
          if (raf) cancelAnimationFrame(raf);
          clearTimeout(sayTimer);
          if (io) io.disconnect();
          document.removeEventListener('visibilitychange', onVis);
          svg.removeEventListener('pointerdown', onDown);
          svg.removeEventListener('pointermove', onMove);
          svg.removeEventListener('pointerup', onUp);
          svg.removeEventListener('pointercancel', onUp);
          svg.removeEventListener('pointerleave', onLeave);
          svg.removeEventListener('wheel', onWheel);
          svg.removeEventListener('contextmenu', noMenu);
          svg.removeEventListener('keydown', onKey);
          sound.close();
          if (root.parentNode) root.parentNode.removeChild(root);
        }
      };
    }

    function failed(host, err) {
      host.classList.remove('is-loading');
      host.classList.add('is-failed');
      host.textContent = T('This interactive part couldn’t be shown here.');
      if (err) console.warn('[Primer] breadboard:', err.message || err);
    }

    // the words for a build: "a red LED, a 220 Ω resistor and 3 wires; a 9-line sketch"
    function buildWords(b, spec) {
      const bits = b.parts.map((p) => (p.type === 'led' ? F('a {color} LED', { color: colorName(p.color, T) }) : p.type === 'resistor' ? F('a {ohms} resistor', { ohms: C.fmtOhms(p.ohms) }) : partName(p.type, T)));
      if (b.wires.length) bits.push(F(b.wires.length === 1 ? '{n} wire' : '{n} wires', { n: b.wires.length }));
      let s = bits.length ? andList(bits) : T('Nothing built');
      const lines = (b.code || '').trim() ? b.code.trim().split('\n').length : 0;
      if (spec.arduino && lines) s += '; ' + F(lines === 1 ? 'a sketch of {n} line' : 'a sketch of {n} lines', { n: lines });
      return s;
    }

    P.widgets.register('breadboard', {
      block(host, spec, ctx) {
        const s = cleanSpec(spec);
        if (!s) { failed(host, new Error('this bench does not hold together')); return null; }
        return mount(host, s, null, ctx || {}, 'block');
      },
      task(host, spec, goal, ctx) {
        const tk = cleanTask(spec, goal);
        if (!tk) { failed(host, new Error('this breadboard task does not hold together')); return null; }
        return mount(host, tk.spec, tk.goal, ctx || {}, 'task');
      },
      check(goal, value, spec) {
        const tk = cleanTask(spec, goal);
        if (!tk) return { correct: false, invalid: true };
        const r = C.check(tk.spec, tk.goal, value);
        const build = C.normBuild(value, tk.spec);
        const B = build ? C.bench(tk.spec, build) : null;
        const note = whyNote(r.why, B, T, F);
        if (r.invalid) return { correct: false, invalid: true, note };
        return { correct: r.correct, note: r.correct ? '' : note };
      },
      describe(value, spec) {
        const s = cleanSpec(spec);
        if (!s || !value) return '';
        const b = C.normBuild(value, s);
        return b ? buildWords(b, s) : '';
      },
      answer(goal, spec) {
        const tk = cleanTask(spec, goal);
        if (!tk) return '';
        const ref = referenceOf(tk);
        if (!ref) return '';
        const g = tk.goal, ohms = ref.info.ohms ? C.fmtOhms(ref.info.ohms) : '';
        const color = ref.info.color ? colorName(ref.info.color, T) : '';
        switch (g.type) {
          case 'light': return g.part === 'motor' ? T('Join the motor’s two terminals to the battery’s + and −.') : g.part === 'buzzer' ? T('Join the buzzer’s + leg towards +, and its other leg back to −.')
            : g.pin != null ? F('From pin {pin}, a {ohms} resistor, then the LED’s + leg; its − leg to GND; and a sketch that sets pin {pin} HIGH.', { pin: g.pin, ohms })
              : F('A loop from + through a {ohms} resistor and the {color} LED’s + leg (the anode), then from its − leg back to −.', { ohms, color });
          case 'series': return F('One loop: + → a {ohms} resistor → each LED in turn, + leg first → −.', { ohms });
          case 'parallel': return F('Each LED in its own branch from + to −, each with a {ohms} resistor.', { ohms });
          case 'button': return g.pin != null ? F('The button between pin {pin} and GND, read with INPUT_PULLUP (LOW when pressed); the LED on pin {led} through a {ohms} resistor.', { pin: g.pin < 14 ? g.pin : 'A' + (g.pin - 14), led: ref.build.code.match(/ledPin = (\d+)/) ? ref.build.code.match(/ledPin = (\d+)/)[1] : '', ohms })
            : g.when === 'released' ? F('A {ohms} resistor and the LED in a loop, with the button across the LED: pressing it takes the current away from the LED.', { ohms })
              : F('The button in the loop with a {ohms} resistor and the LED: pressing it closes the loop.', { ohms });
          case 'switch': return F('The switch’s middle leg and one end leg in the loop with a {ohms} resistor and the LED.', { ohms });
          case 'dimmer': return g.by === 'pot' ? F('The pot’s end and middle legs in the loop with a {ohms} resistor and the LED: turning it changes the resistance.', { ohms })
            : g.lit === 'dark' ? F('A {ohms} resistor to the LED, with the LDR across the LED: in bright light its resistance drops and it takes the current.', { ohms })
              : F('The LDR in the loop with a {ohms} resistor and the LED: more light, less resistance, a brighter LED.', { ohms });
          case 'blink': return F('Pin {pin} through a {ohms} resistor to the LED’s + leg, its − leg to GND; in loop(): HIGH, delay({on}), LOW, delay({off}).', { pin: g.pin, ohms, on: g.on_ms, off: g.off_ms });
          case 'serial': return F('In setup(): Serial.begin(9600); then Serial.println("{text}");', { text: g.text });
          default: return buildWords(ref.build, tk.spec);
        }
      },
      still(spec) {
        const s = cleanSpec(spec);
        if (!s) return '';
        try { return stillSvg(s); } catch (e) { return ''; }
      }
    });
  }
})();
