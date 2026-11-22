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
        case 'npn': return t('NPN transistor');
        case 'mosfet': return t('MOSFET');
        case 'diode': return t('Diode');
        case 'zener': return t('Zener diode');
        case 'capacitor': return t('Capacitor');
        case 'electrolytic': return t('Electrolytic capacitor');
        case 'tmp36': return t('Temperature sensor (TMP36)');
        case 'rgb': return t('RGB LED');
        case 'seg7': return t('7-segment display');
        case 'servo': return t('Servo motor');
        case 'sonar': return t('Ultrasonic sensor');
        case 'lcd': return t('LCD screen');
        case 'relay': return t('Relay module');
        case 'pir': return t('Motion sensor (PIR)');
        case 'dht11': return t('Temperature and humidity sensor');
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
      if (p.type === 'capacitor' || p.type === 'electrolytic') return fill('the {uf} capacitor ({id})', { uf: C.fmtFarads(p.uf), id: p.id });
      if (p.type === 'motor') return t('the motor');
      return fill('{name} {id}', { name: partName(p.type, t), id: p.id });
    }
    // a point's name for people: "hole a12", "Arduino pin 13"
    function pointWords(name, t, fill) {
      if (!name) return '';
      if (C.HOLES.has(name)) {
        const h = C.HOLES.get(name);
        const col = { col: h.col };
        if (h.row === '+T') return fill('Top + rail, column {col}', col);
        if (h.row === '-T') return fill('Top − rail, column {col}', col);
        if (h.row === '+B') return fill('Bottom + rail, column {col}', col);
        if (h.row === '-B') return fill('Bottom − rail, column {col}', col);
        return fill('Hole {hole}', { hole: name });
      }
      if (name === 'BAT+') return t('Battery +');
      if (name === 'BAT-') return t('Battery −');
      if (name === 'M+' || name === 'M-') return fill('Motor terminal {n}', { n: name === 'M+' ? '1' : '2' });
      if (/\./.test(name)) { const [id, pin] = name.split('.'); return fill('{id} pin {pin}', { id, pin }); }
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
        case 'string': return fill('Line {line}: text in a char array isn’t supported here; use a String, like String name = "Asha";', v);
        case 'concat': return fill('Line {line}: "text" + a number doesn’t join them in Arduino C. Make one a String: String("text") + x, or use two prints.', v);
        case 'library': return fill('Line {line}: there is no {name} library on this bench (it has Servo.h, Wire.h, LiquidCrystal_I2C.h and DHT.h).', v);
        case 'include': return fill('Line {line}: {name} needs #include <{lib}> at the top of the sketch.', v);
        case 'strnum': return fill('Line {line}: a String is text, not a number: use {name}.toInt() to read a number from it.', v);
        case 'isobject': return fill('Line {line}: {name} is a {cls}: use its functions, like {name}.{eg}().', v);
        case 'method': return fill('Line {line}: a {cls} has no {name}() function.', v);
        case 'isr': return fill('Line {line}: attachInterrupt needs the name of a void function with no ( ) values, like attachInterrupt(digitalPinToInterrupt(2), pressed, FALLING);', v);
        case 'intpin': return fill('Line {line}: only pins 2 and 3 have interrupts on the Uno: use digitalPinToInterrupt(2) or digitalPinToInterrupt(3).', v);
        case 'isrlong': return fill('The interrupt function {name}() runs too long: keep it short, with no delay() or waiting loops.', v);
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
        case 'qburn': return fill('{name} gets too hot: {mA} mA flows through it. Put a resistor of about 1 kΩ between the pin and its base.', { name: name(why.name), mA: why.mA });
        case 'capreversed': return fill('{name} is the wrong way round: an electrolytic capacitor’s + leg (the longer one) must face the + side, or it bursts.', { name: name(why.name) });
        case 'flyback': return t('The motor works. Now add the diode across the motor, its striped end towards +, to catch the kick when the motor stops.');
        case 'ground': return t('The battery’s − isn’t joined to the Arduino’s GND. Add a wire between them so both share one ground.');
        case 'common': return why.common === 'anode' ? fill('{name} is a common-anode display: its COM pin goes to +, and a segment lights when its pin is LOW.', { name: name(why.name) }) : fill('{name} is a common-cathode display: its COM pin goes to GND, and a segment lights when its pin is HIGH.', { name: name(why.name) });
        case 'noservo': return t('There’s no servo on the bench yet.');
        case 'servopin': return fill('Wire the servo’s SIG (orange) wire to pin {pin}.', why);
        case 'servosig': return fill('{name} gets no signal: wire its SIG to a pin, then attach() it to that pin in the sketch and write() an angle.', { name: name(why.name) });
        case 'servopower': return fill('{name} has no power: wire its VCC (red) to 5V and its GND (brown) to GND.', { name: name(why.name) });
        case 'servoangle': return fill('The servo is at {at}°; the goal is {want}°.', why);
        case 'servosweep': return fill('The servo should sweep from {lo}° to {hi}° and back, again and again.', why);
        case 'nodisplay': return t('There’s no 7-segment display on the board yet.');
        case 'digit': return fill('The display lights segments {segs}; the digit {want} needs {want_segs}.', why);
        case 'segdark': return t('No segment of the display lights. Is its COM pin joined, through a resistor, to the right side?');
        case 'nolcd': return t('There’s no LCD screen on the bench yet.');
        case 'lcdpower': return t('The LCD has no power: wire its VCC to 5V and its GND to GND.');
        case 'lcdwires': return t('The LCD talks over I2C: wire its SDA to A4 and its SCL to A5.');
        case 'lcdinit': return t('The LCD is never started: call lcd.init(); (and lcd.backlight();) in setup().');
        case 'lcdoff': return t('The LCD is switched off: call lcd.display();');
        case 'lcdtext': return fill('The LCD shows "{shows}"; it should show "{text}".', why);
        case 'nosonar': return t('There’s no ultrasonic sensor on the bench yet.');
        case 'notmp': return t('There’s no temperature sensor on the board yet.');
        case 'nodht': return t('There’s no temperature and humidity sensor on the bench yet.');
        case 'modpower': return fill('{name} has no power: wire its VCC to 5V and its GND to GND.', { name: name(why.name) });
        case 'noping': return fill('{name} never measures: wire its TRIG to a pin and send it a 10 µs HIGH pulse, then read its ECHO with pulseIn().', { name: name(why.name) });
        case 'nearalways': return fill('The output stays on even when nothing is near. It should come on only nearer than {cm} cm.', why);
        case 'nearflip': return fill('The output comes on when things are far away. It should come on only nearer than {cm} cm.', why);
        case 'neardark': return fill('Nothing comes on, even with something nearer than {cm} cm.', why);
        case 'tempalways': return fill('The output stays on even when it’s cool. It should come on only above {above} °C.', why);
        case 'tempflip': return fill('The output comes on when it’s cool. It should come on only above {above} °C.', why);
        case 'tempdark': return fill('Nothing comes on, even above {above} °C.', why);
        case 'nocap': return t('There’s no capacitor on the board yet.');
        case 'fadequick': return fill('The LED goes out {ms} ms after the switch opens; it should glow for at least {want} ms. A capacitor across it keeps it lit.', why);
        case 'fadestays': return t('The LED stays lit after the switch opens. Should the switch cut its power?');
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
    const FONT = 'Arial, Helvetica, sans-serif';
    // the modules beside the board: their size, and where their pins are (in the order their type lists them)
    const MOD = {
      servo: { w: 150, h: 98, pins: [[30, 88], [52, 88], [74, 88]] },
      sonar: { w: 172, h: 122, pins: [[52, 112], [74, 112], [96, 112], [118, 112]] },
      lcd: { w: 250, h: 108, pins: [[24, 98], [46, 98], [68, 98], [90, 98]] },
      relay: { w: 178, h: 104, pins: [[20, 94], [42, 94], [64, 94], [114, 94], [136, 94], [158, 94]] },
      pir: { w: 112, h: 106, pins: [[34, 96], [56, 96], [78, 96]] },
      dht11: { w: 96, h: 106, pins: [[26, 96], [48, 96], [70, 96]] }
    };
    const SEG_LINE = { a: [-13, -32, 13, -32], b: [17, -28, 17, -4], c: [17, 4, 17, 28], d: [-13, 32, 13, 32], e: [-17, 4, -17, 28], f: [-17, -28, -17, -4], g: [-13, 0, 13, 0] };
    // a ceramic capacitor's printed code: 104 is 10 and four zeros, in picofarads
    function capCode(uf) {
      const pf = uf * 1e6;
      if (pf < 100) return String(Math.round(pf));
      const e = Math.floor(Math.log10(pf)) - 1;
      return String(Math.round(pf / Math.pow(10, e))) + e;
    }
    // how far away the sonar's obstacle looks: 2 cm close, 400 cm at the top
    const wallAt = (cm) => clamp(Math.log(clamp(cm, 2, 400) / 2) / Math.log(200), 0, 1);
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
      // the modules (servo, sensors, screen, relay) beside it: a place for each one the bench has, wherever there's room
      const taken = [[0, 0, BW, BH]];
      if (L.ard) taken.push([L.ard.x - 14, L.ard.y, L.ard.w + 14, L.ard.h]);
      if (L.bat) taken.push([L.bat.x - 6, L.bat.y - 6, L.bat.w + 40, L.bat.h + 24]);
      if (L.mot) taken.push([L.mot.x, L.mot.y, L.mot.w + 4, L.mot.h + 10]);
      const clash = (x, y, w, h) => taken.some(([a, b, c, d]) => x < a + c + 10 && x + w + 10 > a && y < b + d + 10 && y + h + 10 > b);
      L.slots = [];
      C.inventory(spec).filter((x) => C.TYPES[x.type].dock).forEach((it) => {
        const g = MOD[it.type];
        let at = null;
        for (let y = FY; y < 4000 && !at; y += 6) for (let x = 14; x + g.w <= BW + 4 && !at; x += 6) if (!clash(x, y, g.w, g.h)) at = [x, y];
        if (!at) return;
        taken.push([at[0], at[1], g.w, g.h]);
        L.slots.push({ type: it.type, x: at[0], y: at[1], w: g.w, h: g.h });
      });
      const bottom = Math.max(BH, L.ard ? L.ard.y + L.ard.h : 0, L.bat ? L.bat.y + L.bat.h + 8 : 0, L.mot ? L.mot.y + L.mot.h : 0, ...L.slots.map((s) => s.y + s.h + 6));
      L.vb = [-8, -8, BW + 16, bottom + 18];
      L.base = new Map(L.terms);
      return L;
    }
    // each module of a build in its place: id -> slot
    function slotsFor(L, build) {
      const out = new Map(), free = L.slots.slice();
      build.parts.forEach((p) => {
        if (!C.TYPES[p.type].dock) return;
        const i = free.findIndex((s) => s.type === p.type);
        if (i >= 0) out.set(p.id, free.splice(i, 1)[0]);
      });
      return out;
    }
    // the terminals: the fixtures', and the pins of the modules this build has
    function placeTerms(L, build) {
      L.terms = new Map(L.base);
      L.mods = slotsFor(L, build);
      L.mods.forEach((s, id) => {
        const p = build.parts.find((x) => x.id === id);
        C.TYPES[p.type].pins.forEach((pin, i) => { const q = MOD[p.type].pins[i]; L.terms.set(id + '.' + pin, [[r1(s.x + q[0]), r1(s.y + q[1])]]); });
      });
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
        el('text', { x: cx, y: m.y + m.h + 4, 'text-anchor': 'middle', 'font-size': 10, fill: SOFT, 'font-family': 'Arial, Helvetica, sans-serif' }, [T('DC motor')]),
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
      } else if (p.type === 'npn' || p.type === 'tmp36' || p.type === 'mosfet') {
        // a TO-92 (a half-disc, its flat face towards you) or a TO-220 with its metal tab; the legs named
        const m = pts[1];
        pts.forEach((q) => kids.push(leg(q, [m[0] + (q[0] - m[0]) * 0.3, m[1] + (q[1] - m[1]) * 0.3]), tip(q)));
        const mrot = `translate(${r1(m[0])} ${r1(m[1])}) rotate(${ang})`;
        if (p.type === 'mosfet') {
          kids.push(el('g', { transform: mrot }, [
            el('rect', { x: -15, y: -25, width: 30, height: 15, rx: 2, fill: '#b9bec4', stroke: '#7f868e' }),
            el('circle', { cx: 0, cy: -18, r: 3.5, fill: '#e9e3d3', stroke: '#7f868e' }),
            el('rect', { x: -15, y: -11, width: 30, height: 16, rx: 1.5, fill: '#232323', stroke: '#000' }),
            el('text', { x: 0, y: -3, 'text-anchor': 'middle', 'font-size': 5.5, fill: '#c8c8c8', 'font-family': FONT }, ['IRF540'])
          ]));
        } else {
          kids.push(el('g', { transform: mrot }, [
            el('path', { d: 'M -14 4 L 14 4 A 15 15 0 0 0 -14 4 Z', fill: '#232323', stroke: '#000' }),
            el('text', { x: 0, y: -3, 'text-anchor': 'middle', 'font-size': 5, fill: '#c8c8c8', 'font-family': FONT }, [p.type === 'tmp36' ? 'TMP36' : '2N2222'])
          ], ref('body')));
        }
        C.TYPES[p.type].pins.forEach((nm, i) => { const q = pts[i]; kids.push(el('text', { x: r1(q[0] + n[0] * 11), y: r1(q[1] + n[1] * 11), dy: '0.35em', 'text-anchor': 'middle', 'font-size': nm.length > 2 ? 5.5 : 7, 'font-weight': 700, fill: SOFT, 'font-family': FONT }, [nm])); });
      } else if (p.type === 'diode' || p.type === 'zener') {
        const s = Math.min(1, (len - 6) / 30);
        kids.push(leg(a, at(-12 * s)), leg(at(12 * s), b), tip(a), tip(b));
        const z = p.type === 'zener';
        kids.push(el('g', { transform: rot + (s < 1 ? ` scale(${r1(Math.max(0.4, s) * 100) / 100})` : '') }, [
          el('rect', { x: -12, y: -4.5, width: 24, height: 9, rx: 2, fill: z ? '#e9a23b' : '#262626', stroke: '#111', 'stroke-width': 0.8 }),
          el('rect', { x: 6, y: -4.5, width: 3.5, height: 9, fill: z ? '#262626' : '#cfd3d6' })
        ]));
        if (z) kids.push(el('text', { x: r1(c[0] + n[0] * 11), y: r1(c[1] + n[1] * 11), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 7, fill: SOFT, 'font-family': FONT }, [String(p.volts).replace('.', 'V') + (String(p.volts).includes('.') ? '' : 'V')]));
      } else if (p.type === 'capacitor') {
        kids.push(leg(a, c), leg(b, c), tip(a), tip(b));
        kids.push(el('g', { transform: rot }, [
          el('ellipse', { cx: 0, cy: -7, rx: 10, ry: 8, fill: '#e3a13a', stroke: '#9c6a1d' }),
          el('text', { x: 0, y: -7, dy: '0.35em', 'text-anchor': 'middle', 'font-size': 6.5, fill: '#3b2a10', 'font-family': FONT }, [capCode(p.uf)])
        ]));
      } else if (p.type === 'electrolytic') {
        // seen from above: the can, its − stripe on the − leg's side, and how full of charge it is
        kids.push(leg(a, c), leg(b, c), tip(a), tip(b));
        const bad = look.burnt || look.fault;
        const frac = clamp((look.vc || 0) / 9, 0, 1);
        kids.push(el('g', { transform: rot }, [
          el('circle', { cx: 0, cy: 0, r: 12.5, fill: bad ? '#4a3426' : '#2a4f9c', stroke: bad ? '#20150e' : '#16305f' }),
          el('path', { d: 'M 7 -10.3 A 12.5 12.5 0 0 1 7 10.3 Z', fill: bad ? '#6b5444' : '#d8deeb' }),
          el('text', { x: 10, y: 0, dy: '0.35em', 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: '#16305f', 'font-family': FONT }, ['−']),
          el('circle', { cx: 0, cy: 0, r: 10.2, fill: 'none', stroke: '#ffcf3a', 'stroke-width': 2.4, 'stroke-dasharray': `${r1(frac * 64.1)} 64.1`, transform: 'rotate(-90)', opacity: bad ? 0 : 1 }, [], ref('charge')),
          el('circle', { cx: 0, cy: 0, r: 7, fill: bad ? '#8a7a6a' : '#c9ccd0', stroke: '#888' }),
          bad ? el('path', { d: 'M -5 -4 L -1 0 L -4 3 L 2 5', fill: 'none', stroke: '#2b1d11', 'stroke-width': 1.2 }) : el('path', { d: 'M -4 0 H 4 M 0 -4 V 4', stroke: '#8d9095', 'stroke-width': 1 })
        ]));
        const plus = [a[0] + n[0] * 11, a[1] + n[1] * 11];
        kids.push(el('text', { x: r1(plus[0]), y: r1(plus[1]), dy: '0.36em', 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: '#b02a1d', 'font-family': FONT }, ['+']));
        kids.push(el('text', { x: r1(c[0] - n[0] * 19), y: r1(c[1] - n[1] * 19), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 7.5, fill: SOFT, 'font-family': FONT, class: 'bb-id' }, [(look.vc || 0).toFixed(1) + ' V'], ref('cv')));
        if (bad) kids.push(el('g', { class: 'bb-smoke', fill: '#8e8a86' }, [el('circle', { cx: r1(c[0] + 3), cy: r1(c[1] - 16), r: 4, opacity: 0.55 }), el('circle', { cx: r1(c[0] - 2), cy: r1(c[1] - 23), r: 5, opacity: 0.4 })]));
      } else if (p.type === 'rgb') {
        const m = [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
        pts.forEach((q) => kids.push(leg(q, m), tip(q)));
        const col = rgbOf(look.dies);
        kids.push(el('circle', { cx: r1(m[0]), cy: r1(m[1]), r: 24, fill: col.c, opacity: col.on ? r1(0.2 + 0.6 * col.k) : 0, class: 'bb-glow' }, [], ref('rglow')));
        kids.push(el('circle', { cx: r1(m[0]), cy: r1(m[1]), r: 11, fill: col.on ? col.c : '#ece8ef', stroke: '#9d97a3', 'fill-opacity': col.on ? 0.9 : 0.85 }, [], ref('rdome')));
        kids.push(el('ellipse', { cx: r1(m[0] - 3), cy: r1(m[1] - 3.5), rx: 3, ry: 2, fill: '#fff', opacity: 0.7 }));
        C.TYPES.rgb.pins.forEach((nm, i) => { const q = pts[i]; kids.push(el('text', { x: r1(q[0] + n[0] * 11), y: r1(q[1] + n[1] * 11), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 7, 'font-weight': 700, fill: nm === 'R' ? '#b02a1d' : nm === 'G' ? '#2e7d32' : nm === 'B' ? '#2f5fb3' : SOFT, 'font-family': FONT }, [nm])); });
      } else if (p.type === 'seg7') {
        // the body over its ten pins, and the segments, each an LED lit by its own current
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const x0 = Math.min(...xs) - 9, x1 = Math.max(...xs) + 9, y0 = Math.min(...ys) - 7, y1 = Math.max(...ys) + 7;
        kids.push(el('rect', { x: r1(x0), y: r1(y0), width: r1(x1 - x0), height: r1(y1 - y0), rx: 3, fill: '#1c1c1c', stroke: '#000' }));
        pts.forEach((q) => kids.push(tip(q)));
        const segs = look.segs || {};
        const segEls = Object.keys(SEG_LINE).map((s) => { const [p1, q1, p2, q2] = SEG_LINE[s]; return el('line', { x1: p1, y1: q1, x2: p2, y2: q2, stroke: segColor(segs[s]), 'stroke-width': 6.5, 'stroke-linecap': 'round' }, [], ref('s' + s)); });
        segEls.push(el('circle', { cx: 25, cy: 33, r: 3.6, fill: segColor(segs.dp) }, [], ref('sdp')));
        kids.push(el('g', { transform: `translate(${r1((x0 + x1) / 2)} ${r1((y0 + y1) / 2)}) skewX(-6)` }, segEls));
        C.TYPES.seg7.pins.forEach((nm, i) => { const q = pts[i]; kids.push(el('text', { x: r1(q[0]), y: r1(q[1] + (i < 5 ? 9 : -9)), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 5.5, fill: '#9a9a9a', 'font-family': FONT }, [nm])); });
        kids.push(el('text', { x: r1(x1 - 5), y: r1((y0 + y1) / 2), dy: '0.35em', 'text-anchor': 'end', 'font-size': 5.5, fill: '#8a8a8a', 'font-family': FONT }, [p.common === 'anode' ? 'CA' : 'CC']));
      }
      // its id, small, beside it
      const off = p.type === 'pot' ? 26 : p.type === 'button' ? 24 : p.type === 'buzzer' ? 20 : p.type === 'switch' ? 17 : p.type === 'electrolytic' ? 30 : ['npn', 'tmp36', 'mosfet'].includes(p.type) ? 30 : p.type === 'rgb' ? 22 : p.type === 'capacitor' ? 20 : 14;
      const lab = p.type === 'seg7' ? [pts[0][0] - 16, pts[0][1] - 12] : [c[0] - n[0] * off, c[1] - n[1] * off];
      kids.push(el('text', { x: r1(lab[0]), y: r1(lab[1]), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 8.5, fill: SOFT, 'font-family': 'Arial, Helvetica, sans-serif', class: 'bb-id' }, [p.id]));
      return el('g', { class: 'bb-part' + (opts.ghost ? ' bb-ghost' : '') + (opts.bad ? ' is-bad' : ''), 'data-part': live ? id : null, opacity: opts.ghost ? 0.6 : null }, kids, live ? 'part:' + id : null);
    }

    const mix = (c1, c2, k) => { const pc = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); const x = pc(c1), y = pc(c2); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
    const segColor = (s) => (!s || !s.lit ? (s && s.burn ? '#262120' : '#3d1d1a') : mix('#a3302a', '#ff4a3a', clamp(0.45 + 0.55 * (s.glow || 0), 0, 1)));
    // an RGB LED's colour from its three dies
    function rgbOf(dies) {
      const g = (k) => (dies && dies[k] && dies[k].lit ? dies[k].glow || 0.05 : 0);
      const r = g('r'), gg = g('g'), b = g('b'), k = Math.max(r, gg, b);
      if (!k) return { on: false, c: '#ece8ef', k: 0 };
      const ch = (x) => (x > 0 ? Math.round(255 * Math.min(1, 0.1 + 0.9 * x / k)) : 0);
      return { on: true, c: `rgb(${ch(r)},${ch(gg)},${ch(b)})`, k };
    }
    const lcdRow = (s) => (s || '').padEnd(16, ' ').slice(0, 16).replace(/ /g, ' ');
    const LCD_X = Array.from({ length: 16 }, (_, i) => i);

    // a module beside the board, in its place s; look: what it is doing (angle, distance, text, power)
    function moduleTree(p, s, look, opts) {
      look = look || {};
      const live = opts && opts.live, id = p.id;
      const ref = (k) => (live ? k + ':' + id : null);
      const x = s.x, y = s.y, w = s.w, h = s.h;
      const kids = [];
      const txt = (tx, ty, str, more, rf) => el('text', Object.assign({ x: r1(tx), y: r1(ty), dy: '0.35em', 'text-anchor': 'middle', 'font-size': 7.5, fill: '#f4f1e6', 'font-family': FONT }, more || {}), [str], rf);
      kids.push(el('rect', { x: x - 3, y: y - 3, width: w + 6, height: h + 6, rx: 6, fill: '#000', opacity: 0, class: 'bb-mod__hit' }));
      if (p.type === 'servo') {
        const cx = x + 44, cy = y + 40;
        kids.push(el('rect', { x: x + 8, y: y + 32, width: 120, height: 16, rx: 3, fill: '#4f8be8', stroke: '#1d4b9a' }),
          el('rect', { x: x + 20, y: y + 18, width: 96, height: 44, rx: 4, fill: '#2f6fd6', stroke: '#1d4b9a' }),
          el('circle', { cx: x + 14, cy: y + 40, r: 2.5, fill: '#e9e3d3' }), el('circle', { cx: x + 122, cy: y + 40, r: 2.5, fill: '#e9e3d3' }),
          txt(x + 88, y + 33, 'SG90', { 'font-size': 10, 'font-weight': 700 }),
          txt(x + 88, y + 48, Math.round(look.angle != null ? look.angle : 90) + '°', { 'font-size': 9 }, ref('deg')));
        // its cable: brown, red and orange, to the pins
        [['#7b4a20', 0], ['#d93a2b', 1], ['#ef7d1a', 2]].forEach(([col, i]) => { const [px, py] = MOD.servo.pins[i]; kids.push(el('path', { d: `M${x + 96 + i * 5} ${y + 62} C ${x + 96 + i * 5} ${y + 74} ${x + px} ${y + 66} ${x + px} ${y + py - 4}`, fill: 'none', stroke: col, 'stroke-width': 2.4 })); });
        kids.push(el('circle', { cx, cy, r: 10, fill: '#f2f2f2', stroke: '#9a9a9a' }));
        kids.push(el('g', { transform: `rotate(${r1(-(look.angle != null ? look.angle : 90))} ${cx} ${cy})`, class: 'bb-horn' }, [
          el('path', { d: `M${cx - 7} ${cy - 5} H${cx + 34} A5 5 0 0 1 ${cx + 34} ${cy + 5} H${cx - 7} A5 5 0 0 1 ${cx - 7} ${cy - 5} Z`, fill: '#fbfbfb', stroke: '#a5a5a5' }),
          el('circle', { cx: cx + 16, cy, r: 1.4, fill: '#bbb' }), el('circle', { cx: cx + 26, cy, r: 1.4, fill: '#bbb' }), el('circle', { cx, cy, r: 3, fill: '#d0d0d0', stroke: '#999' })
        ], ref('horn')));
      } else if (p.type === 'sonar') {
        const f = wallAt(look.cm != null ? look.cm : p.cm || 100);
        const wy = y + 30 - f * 24;
        kids.push(el('path', { d: `M${x + 46} ${y + 50} L${x + 30} ${y + 6} M${x + 46} ${y + 50} L${x + 62} ${y + 6} M${x + 126} ${y + 50} L${x + 110} ${y + 6} M${x + 126} ${y + 50} L${x + 142} ${y + 6}`, stroke: GOLD, 'stroke-width': 0.8, 'stroke-dasharray': '3 3', opacity: 0.6 }));
        kids.push(el('g', { transform: `translate(0 ${r1(wy - (y + 30))})`, class: 'bb-wall' }, [
          el('rect', { x: x + 26, y: y + 28, width: 120, height: 6, rx: 1.5, fill: '#8a6128', stroke: '#5b4730' }),
          el('text', { x: x + 150, y: y + 31, dy: '0.35em', 'font-size': 8, fill: INK, 'font-family': FONT }, [Math.round(look.cm != null ? look.cm : p.cm || 100) + ' cm'], ref('cm'))
        ], ref('wall')));
        kids.push(el('rect', { x: x + 6, y: y + 40, width: 160, height: 56, rx: 3, fill: '#1d5fa8', stroke: '#12407a' }));
        [x + 46, x + 126].forEach((ex) => kids.push(el('circle', { cx: ex, cy: y + 68, r: 19, fill: '#c9cdd2', stroke: '#7a7f86' }), el('circle', { cx: ex, cy: y + 68, r: 13, fill: '#4a4a4a' }), el('circle', { cx: ex, cy: y + 68, r: 9, fill: 'none', stroke: '#666', 'stroke-dasharray': '1.5 1.5' })));
        kids.push(txt(x + 86, y + 56, 'HC-SR04', { 'font-size': 7.5, 'font-weight': 700 }), el('rect', { x: x + 78, y: y + 66, width: 16, height: 8, rx: 2, fill: '#c9ccd0' }));
      } else if (p.type === 'lcd') {
        const d = look.lcd || {};
        kids.push(el('rect', { x, y, width: w, height: h - 26, rx: 4, fill: '#1f7a3a', stroke: '#125226' }));
        [[8, 8], [w - 8, 8], [8, h - 34], [w - 8, h - 34]].forEach(([hx2, hy2]) => kids.push(el('circle', { cx: x + hx2, cy: y + hy2, r: 3.5, fill: '#e9e3d3' })));
        kids.push(el('rect', { x: x + 16, y: y + 10, width: 218, height: 54, rx: 2, fill: '#1b1b1b' }));
        kids.push(el('rect', { x: x + 22, y: y + 15, width: 206, height: 44, rx: 1, fill: lcdScreen(look) }, [], ref('scr')));
        const xs = LCD_X.map((i) => r1(x + 31 + i * 12.6)).join(' ');
        const ink = lcdInk(look);
        [0, 1].forEach((r) => kids.push(el('text', { x: xs, y: y + 29 + r * 18, dy: '0.35em', 'text-anchor': 'middle', 'font-size': 14, fill: ink, 'font-family': 'ui-monospace, Menlo, Consolas, monospace' }, [lcdRow(d.rows ? d.rows[r] : '')], ref('row' + r))));
        kids.push(txt(x + 226, y + 74, 'I2C', { 'font-size': 6.5 }));
      } else if (p.type === 'relay') {
        const on = Boolean(look.on);
        kids.push(el('rect', { x: x + 2, y: y + 2, width: w - 4, height: h - 26, rx: 3, fill: '#1d5fa8', stroke: '#12407a' }));
        kids.push(el('rect', { x: x + 64, y: y + 8, width: 56, height: 44, rx: 2, fill: '#2c62c4', stroke: '#173f85' }), txt(x + 92, y + 24, 'SRD-05VDC', { 'font-size': 5.5 }), txt(x + 92, y + 34, '10A 250VAC', { 'font-size': 5 }));
        kids.push(el('circle', { cx: x + 24, cy: y + 18, r: 4, fill: on ? '#ff4433' : '#5a2a2a', stroke: '#2a1010' }, [], ref('rled')), txt(x + 24, y + 28, 'IN', { 'font-size': 6 }));
        kids.push(el('rect', { x: x + 100, y: y + 58, width: 70, height: 18, rx: 2, fill: '#2e8b57', stroke: '#1d5c39' }));
        [114, 136, 158].forEach((sx) => kids.push(el('circle', { cx: x + sx, cy: y + 67, r: 5, fill: '#c9ccd0', stroke: '#777' }), el('line', { x1: x + sx - 3, y1: y + 67, x2: x + sx + 3, y2: y + 67, stroke: '#666', 'stroke-width': 1.2 })));
        // its contact, drawn: COM swings to NO when the coil is on, back to NC when off
        kids.push(el('circle', { cx: x + 136, cy: y + 18, r: 2, fill: '#f4f1e6' }), el('circle', { cx: x + 156, cy: y + 10, r: 2, fill: '#f4f1e6' }), el('circle', { cx: x + 156, cy: y + 30, r: 2, fill: '#f4f1e6' }),
          txt(x + 166, y + 10, 'NO', { 'font-size': 5.5 }), txt(x + 166, y + 30, 'NC', { 'font-size': 5.5 }), txt(x + 132, y + 26, 'COM', { 'font-size': 5.5 }),
          el('line', { x1: x + 136, y1: y + 18, x2: x + 155, y2: on ? y + 11 : y + 29, stroke: '#ffd23a', 'stroke-width': 2, 'stroke-linecap': 'round' }, [], ref('arm')));
        kids.push(el('text', { x: x + 40, y: y + 46, dy: '0.35em', 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#ffd23a', opacity: 0, 'font-family': FONT, class: 'bb-click' }, [T('click!')], ref('click')));
      } else if (p.type === 'pir') {
        const out = look.out > 2;
        kids.push(el('rect', { x: x + 6, y: y + 34, width: 100, height: 46, rx: 3, fill: '#1f7a3a', stroke: '#125226' }));
        kids.push(el('circle', { cx: x + 56, cy: y + 36, r: 28, fill: '#f6f4ec', stroke: '#c9c4b4' }), el('circle', { cx: x + 56, cy: y + 36, r: 18, fill: 'none', stroke: '#ddd8c8' }), el('circle', { cx: x + 56, cy: y + 36, r: 8, fill: 'none', stroke: '#ddd8c8' }));
        kids.push(el('g', { fill: 'none', stroke: GOLD, 'stroke-width': 1.6, opacity: look.motion ? 1 : 0, class: 'bb-waves' }, [el('path', { d: `M${x + 18} ${y + 22} q -6 8 0 16` }), el('path', { d: `M${x + 11} ${y + 18} q -8 12 0 24` })], ref('wave')));
        kids.push(el('circle', { cx: x + 94, cy: y + 72, r: 3.5, fill: out ? '#ff4433' : '#5a2a2a' }, [], ref('pled')));
      } else if (p.type === 'dht11') {
        kids.push(el('rect', { x: x + 14, y: y + 4, width: 68, height: 76, rx: 4, fill: '#2f7fd0', stroke: '#1d5a9a' }));
        for (let i = 0; i < 5; i++) kids.push(el('rect', { x: x + 24, y: y + 12 + i * 10, width: 48, height: 5, rx: 2.5, fill: '#1d5a9a' }));
        kids.push(txt(x + 48, y + 70, 'DHT11', { 'font-size': 8, 'font-weight': 700 }));
      }
      // the pins, a header along the bottom, each named
      C.TYPES[p.type].pins.forEach((pin, i) => {
        const [px, py] = MOD[p.type].pins[i];
        kids.push(el('line', { x1: x + px, y1: y + h - 26, x2: x + px, y2: y + py, stroke: '#9aa3ab', 'stroke-width': 1.6 }));
        kids.push(el('rect', { x: x + px - 4, y: y + py - 4, width: 8, height: 8, rx: 1, fill: '#55585c', stroke: '#111', 'stroke-width': 0.8 }));
        kids.push(el('text', { x: x + px, y: y + py - 12, dy: '0.35em', 'text-anchor': 'middle', 'font-size': 6.5, 'font-weight': 700, fill: p.type === 'servo' ? ['#6b3d16', '#b02a1d', '#c0640e'][i] : INK, 'font-family': FONT }, [pin]));
      });
      kids.push(el('text', { x: x + 2, y: y - 4, 'font-size': 8.5, fill: SOFT, 'font-family': FONT, class: 'bb-id' }, [id]));
      kids.push(el('text', { x: x + w, y: y - 4, 'text-anchor': 'end', 'font-size': 8, 'font-style': 'italic', fill: RED, 'font-family': FONT, opacity: look.powered === false ? 1 : 0, class: 'bb-id' }, [T('no power')], ref('nopow')));
      return el('g', { class: 'bb-part bb-mod', 'data-part': live ? id : null }, kids, live ? 'part:' + id : null);
    }
    const lcdScreen = (look) => (!look.powered ? '#3a4433' : look.lcd && look.lcd.light ? '#9fd64e' : '#5d7a3c');
    const lcdInk = (look) => (look.lcd && look.lcd.light ? '#14240a' : '#1f2e14');

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

    // a part in the bin, small, centred on 0 (about 40 by 28)
    function binIcon(it) {
      if (it.type === 'led') { const c = it.color === 'any' ? 'red' : it.color; return el('g', {}, [el('line', { x1: -4, y1: 4, x2: -4, y2: 13, stroke: LEG, 'stroke-width': 2 }), el('line', { x1: 4, y1: 4, x2: 4, y2: 11, stroke: LEG, 'stroke-width': 2 }), el('path', { d: 'M -8 6 V -3 A 8 8 0 0 1 8 -3 V 6 Z', fill: LED_ON[c], stroke: '#00000055' })]); }
      if (it.type === 'resistor') { const b = C.bands(it.ohms || 220); return el('g', {}, [el('line', { x1: -19, y1: 0, x2: 19, y2: 0, stroke: LEG, 'stroke-width': 2 }), el('rect', { x: -12, y: -5, width: 24, height: 10, rx: 5, fill: '#e3c995', stroke: '#9c7a43' }), el('rect', { x: -8, y: -5, width: 2.5, height: 10, fill: BAND[b[0]] }), el('rect', { x: -4, y: -5, width: 2.5, height: 10, fill: BAND[b[1]] }), el('rect', { x: 0, y: -5, width: 2.5, height: 10, fill: BAND[b[2]] }), el('rect', { x: 6, y: -5, width: 2.5, height: 10, fill: BAND[b[3]] })]); }
      if (it.type === 'button') return el('g', {}, [el('rect', { x: -9, y: -9, width: 18, height: 18, rx: 2, fill: '#3b3d40' }), el('circle', { r: 5.5, fill: '#d9453a' })]);
      if (it.type === 'switch') return el('g', {}, [el('rect', { x: -15, y: -6, width: 30, height: 12, rx: 2, fill: '#3b3f45' }), el('rect', { x: -12, y: -4, width: 9, height: 8, rx: 1.5, fill: '#ececec' })]);
      if (it.type === 'pot') return el('g', {}, [el('rect', { x: -11, y: -11, width: 22, height: 22, rx: 2, fill: '#2f63b3' }), el('circle', { r: 7.5, fill: '#ece8de' }), el('line', { x1: 0, y1: 0, x2: -4, y2: -5, stroke: '#222', 'stroke-width': 2 })]);
      if (it.type === 'ldr') return el('g', {}, [el('circle', { r: 8, fill: '#e4b14d', stroke: '#9b6a1d' }), el('path', { d: 'M -4.5 -3.5 H 4.5 V -1.2 H -4.5 V 1.2 H 4.5 V 3.5 H -4.5', fill: 'none', stroke: '#7a4a1a', 'stroke-width': 1 })]);
      if (it.type === 'buzzer') return el('g', {}, [el('circle', { r: 10, fill: '#1f1f1f' }), el('circle', { r: 2.5, fill: '#555' })]);
      const legs3 = [-7, 0, 7].map((x) => el('line', { x1: x, y1: 2, x2: x, y2: 13, stroke: LEG, 'stroke-width': 1.8 }));
      if (it.type === 'npn' || it.type === 'tmp36') return el('g', {}, legs3.concat([el('path', { d: 'M -11 4 L 11 4 A 12 12 0 0 0 -11 4 Z', fill: '#232323' }), el('text', { x: 0, y: -1, 'text-anchor': 'middle', 'font-size': 5, fill: '#ccc', 'font-family': FONT }, [it.type === 'npn' ? 'NPN' : 'TMP'])]));
      if (it.type === 'mosfet') return el('g', {}, legs3.concat([el('rect', { x: -10, y: -13, width: 20, height: 8, rx: 1.5, fill: '#b9bec4' }), el('rect', { x: -10, y: -6, width: 20, height: 10, rx: 1, fill: '#232323' })]));
      if (it.type === 'diode' || it.type === 'zener') return el('g', {}, [el('line', { x1: -19, y1: 0, x2: 19, y2: 0, stroke: LEG, 'stroke-width': 2 }), el('rect', { x: -10, y: -4.5, width: 20, height: 9, rx: 2, fill: it.type === 'zener' ? '#e9a23b' : '#262626' }), el('rect', { x: 5, y: -4.5, width: 3, height: 9, fill: it.type === 'zener' ? '#262626' : '#cfd3d6' })]);
      if (it.type === 'capacitor') return el('g', {}, [el('line', { x1: -4, y1: 2, x2: -4, y2: 13, stroke: LEG, 'stroke-width': 1.8 }), el('line', { x1: 4, y1: 2, x2: 4, y2: 13, stroke: LEG, 'stroke-width': 1.8 }), el('ellipse', { cx: 0, cy: -3, rx: 9, ry: 7.5, fill: '#e3a13a', stroke: '#9c6a1d' })]);
      if (it.type === 'electrolytic') return el('g', {}, [el('line', { x1: -3, y1: 8, x2: -3, y2: 14, stroke: LEG, 'stroke-width': 1.8 }), el('line', { x1: 3, y1: 8, x2: 3, y2: 12, stroke: LEG, 'stroke-width': 1.8 }), el('rect', { x: -8, y: -12, width: 16, height: 21, rx: 3, fill: '#2a4f9c' }), el('rect', { x: 3, y: -12, width: 4, height: 21, fill: '#d8deeb' })]);
      if (it.type === 'rgb') return el('g', {}, [-6, -2, 2, 6].map((x) => el('line', { x1: x, y1: 4, x2: x, y2: 13, stroke: LEG, 'stroke-width': 1.6 })).concat([el('path', { d: 'M -8 6 V -3 A 8 8 0 0 1 8 -3 V 6 Z', fill: '#ece8ef', stroke: '#9d97a3' }), el('circle', { cx: -3, cy: -1, r: 2, fill: '#ff3b2f' }), el('circle', { cx: 0, cy: -4, r: 2, fill: '#35d24c' }), el('circle', { cx: 3, cy: -1, r: 2, fill: '#3f86ff' })]));
      if (it.type === 'seg7') return el('g', {}, [el('rect', { x: -10, y: -13, width: 20, height: 26, rx: 2, fill: '#1c1c1c' }), el('path', { d: 'M -4 -9 H 4 M 5 -8 V -1 M 5 1 V 8 M -4 9 H 4 M -5 1 V 8 M -5 -8 V -1 M -4 0 H 4', stroke: '#ff3b2f', 'stroke-width': 2, 'stroke-linecap': 'round' })]);
      if (it.type === 'servo') return el('g', {}, [el('rect', { x: -15, y: -7, width: 30, height: 14, rx: 2, fill: '#2f6fd6' }), el('path', { d: 'M -9 -3 H 6 A 3 3 0 0 1 6 3 H -9 Z', fill: '#fbfbfb', stroke: '#aaa' }), el('circle', { cx: -8, cy: 0, r: 3, fill: '#ddd' })]);
      if (it.type === 'sonar') return el('g', {}, [el('rect', { x: -17, y: -8, width: 34, height: 16, rx: 2, fill: '#1d5fa8' }), el('circle', { cx: -8, cy: 0, r: 6, fill: '#c9cdd2' }), el('circle', { cx: 8, cy: 0, r: 6, fill: '#c9cdd2' }), el('circle', { cx: -8, cy: 0, r: 3.5, fill: '#4a4a4a' }), el('circle', { cx: 8, cy: 0, r: 3.5, fill: '#4a4a4a' })]);
      if (it.type === 'lcd') return el('g', {}, [el('rect', { x: -18, y: -10, width: 36, height: 20, rx: 2, fill: '#1f7a3a' }), el('rect', { x: -14, y: -6, width: 28, height: 12, fill: '#9fd64e' }), el('path', { d: 'M -12 -2 H 4 M -12 3 H 0', stroke: '#14240a', 'stroke-width': 1.6 })]);
      if (it.type === 'relay') return el('g', {}, [el('rect', { x: -17, y: -10, width: 34, height: 20, rx: 2, fill: '#1d5fa8' }), el('rect', { x: -6, y: -8, width: 14, height: 12, fill: '#2c62c4', stroke: '#173f85' }), el('rect', { x: 9, y: 2, width: 7, height: 7, fill: '#2e8b57' })]);
      if (it.type === 'pir') return el('g', {}, [el('rect', { x: -14, y: 0, width: 28, height: 10, rx: 2, fill: '#1f7a3a' }), el('circle', { cx: 0, cy: 0, r: 9, fill: '#f6f4ec', stroke: '#c9c4b4' })]);
      if (it.type === 'dht11') return el('g', {}, [el('rect', { x: -9, y: -12, width: 18, height: 24, rx: 2, fill: '#2f7fd0' })].concat([0, 1, 2, 3].map((i) => el('rect', { x: -6, y: -9 + i * 5, width: 12, height: 2.5, rx: 1, fill: '#1d5a9a' }))));
      return el('g');
    }
    // the bin's parts, grouped: [{ type, color, ohms, n }]
    function binGroups(items) {
      const m = new Map();
      items.forEach((x) => { const v = C.variantOf(x); const k = x.type + ':' + (v == null ? '' : v); if (!m.has(k)) m.set(k, Object.assign({ n: 0 }, x)); m.get(k).n++; });
      return [...m.values()];
    }
    function binLabel(it, spec, t, fill) {
      if (it.type === 'led') return it.color === 'any' ? partName('led', t) : fill('{color} LED', { color: colorName(it.color, t) });
      if (it.type === 'resistor') return it.ohms && !spec.hide_values ? fill('Resistor {ohms}', { ohms: C.fmtOhms(it.ohms) }) : partName('resistor', t);
      if (it.type === 'capacitor' || it.type === 'electrolytic') return it.uf ? fill('{name} {uf}', { name: partName(it.type, t), uf: C.fmtFarads(it.uf) }) : partName(it.type, t);
      if (it.type === 'seg7') return it.common === 'anode' ? t('7-segment display (common anode)') : t('7-segment display (common cathode)');
      return partName(it.type, t);
    }

    // what a solved state (and the run, S) does to each part
    function looks(build, v, extra) {
      const out = {};
      const S = extra && extra.S;
      build.parts.forEach((p) => {
        const o = (v && v.parts[p.id]) || {};
        const burnt = Boolean(extra && extra.burnt && extra.burnt.has(p.id));
        const k = { lit: Boolean(o.lit), glow: o.glow || 0, burnt: burnt || Boolean(o.burn), on: p.type === 'switch' ? Boolean(p.on) : Boolean(o.on), pressed: Boolean(extra && extra.press && extra.press[p.id]), knob: p.knob };
        if (o.segs) { k.segs = {}; Object.keys(o.segs).forEach((s) => { k.segs[s] = Object.assign({}, o.segs[s], extra && extra.burnt && extra.burnt.has(p.id + '#' + s) ? { burn: true, lit: false } : {}); }); }
        if (o.dies) k.dies = o.dies;
        if (p.type === 'electrolytic' || p.type === 'capacitor') { k.vc = Math.max(0, o.vc != null ? o.vc : 0); k.fault = burnt || Boolean(o.fault); }
        if (C.TYPES[p.type].dock) {
          k.powered = Boolean(o.powered);
          if (p.type === 'servo') k.angle = S && S.servo[p.id] != null ? S.servo[p.id] : 90;
          if (p.type === 'sonar') k.cm = S ? S.inputs.cm[p.id] : p.cm;
          if (p.type === 'pir') { k.motion = S ? Boolean(S.inputs.motion[p.id]) : Boolean(p.motion); k.out = o.out || 0; }
          if (p.type === 'lcd') { const d = S && S.lcd[p.id]; k.lcd = { light: Boolean(d && d.light), rows: !k.powered ? ['', ''] : d && d.on ? (d.disp ? S.lcdText(p.id) : ['', '']) : ['█'.repeat(16), ''] }; }
        }
        out[p.id] = k;
      });
      return out;
    }

    // the still picture: the bench as it starts
    function stillSvg(spec) {
      const L = layout(spec);
      const build = C.startBuild(spec);
      placeTerms(L, build);
      let v = null, S = null;
      try { S = C.session(C.bench(spec, build), { run: false }); v = S.view(); } catch (e) { v = null; S = null; }
      const lk = looks(build, v, { S });
      const gid = 'bbs' + (++uid);
      const kids = [glowDefs(gid), boardTree()];
      if (L.ard) kids.push(arduinoTree(L, {}));
      if (L.bat) kids.push(batteryTree(L, { hot: v && v.short }));
      if (L.mot) kids.push(motorTree(L, {}));
      kids.push(el('g', {}, build.parts.filter((p) => C.TYPES[p.type].dock && L.mods.has(p.id)).map((p) => moduleTree(p, L.mods.get(p.id), lk[p.id]))));
      kids.push(el('g', {}, build.parts.filter((p) => !C.TYPES[p.type].dock).map((p) => partTree(p, lk[p.id], { gid }))));
      kids.push(el('g', {}, build.wires.map((w, i) => wireTree(L, w, i))));
      // the parts still to place, in a row underneath
      const vb = L.vb.slice();
      const groups = binGroups(spec.bin);
      if (groups.length) {
        const y = vb[1] + vb[3] + 4;
        const row = [el('text', { x: 4, y: y + 16, 'font-size': 14, fill: SOFT, 'font-style': 'italic' }, [T('Parts to place:')])];
        let x = 150, line = 0;
        groups.forEach((g) => {
          const label = binLabel(g, spec, T, F) + (g.n > 1 ? ' ×' + g.n : '');
          const w = 34 + label.length * 7.2;
          if (x + w > vb[2] - 8) { x = 150; line++; }
          const yy = y + 14 + line * 30;
          row.push(el('g', { transform: `translate(${x + 14} ${yy}) scale(0.8)` }, [binIcon(g)]), el('text', { x: x + 32, y: yy, dy: '0.35em', 'font-size': 13, fill: INK }, [label]));
          x += w + 12;
        });
        kids.push(el('g', {}, row));
        vb[3] += 30 + line * 30 + 8;
      }
      return toStr(el('svg', { xmlns: SVGNS, viewBox: vb.join(' '), width: vb[2], height: vb[3], role: 'img', 'aria-label': T('A breadboard bench'), 'font-family': 'Georgia, \'Times New Roman\', serif' }, kids));
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
      placeTerms(L, build);
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
      const goIn = hostEl('input', 'bb-go__in', { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'a12', 'aria-label': t('Hole or pin to tap, like a12 or D13'), maxlength: '10' });
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
      zoomBox.setAttribute('role', 'group');
      zoomBox.setAttribute('aria-label', t('Zoom'));
      bar.insertBefore(zoomBox, swatches); // in the toolbar, so it never covers a hole or a pin
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
      let codeIn = null, nums = null, codeErr = null, runBtn = null, stopBtn = null, runState = null, serialOut = null, sendIn = null;
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
        // what the learner types goes to the sketch's Serial.read(), parseInt() and readString(), with a newline
        const sendBox = hostEl('form', 'bb-serial__send');
        sendIn = hostEl('input', 'bb-serial__in', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '120', 'aria-label': t('Text to send to the Arduino'), placeholder: t('Send to the Arduino') });
        sendBox.append(sendIn, hostEl('button', 'bb-btn bb-btn--small', { type: 'submit' }, t('Send')));
        sendBox.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!S || !sendIn.value) return;
          S.send(sendIn.value + '\n');
          announce(fill('Sent "{text}" to the Arduino.', { text: sendIn.value.slice(0, 40) }));
          sendIn.value = '';
        });
        ser.append(sbar, serialOut, sendBox);
        panel.append(cbar, edit, codeErr, ser);
        root.appendChild(panel);
        let shownLines = 0;
        const syncNums = () => {
          const n = Math.max(1, codeIn.value.split('\n').length);
          let s = '';
          for (let i = 1; i <= n; i++) s += i + '\n';
          nums.textContent = s;
          // as tall as the sketch (6 to 18 lines), growing as it does
          const want = clamp(n + 1, 6, 18);
          if (want > shownLines) {
            shownLines = want;
            const h = `calc(${want} * 1.5 * 13.5px + 1.1rem)`;
            codeIn.style.height = h;
            nums.style.height = h;
          }
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
      function drawFixtures(v, lk) {
        if (fixtures) fixtures.remove();
        const kids = [];
        if (L.ard) kids.push(arduinoTree(L, {}));
        if (L.bat) kids.push(batteryTree(L, { hot: v && v.short }));
        if (L.mot) kids.push(motorTree(L, {}));
        // the modules beside it, and the one chosen
        L.mods.forEach((s, id) => {
          const p = build.parts.find((x) => x.id === id);
          if (p) kids.push(moduleTree(p, s, lk && lk[id], { live: true }));
        });
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
        build.parts.forEach((p) => C.take(inv, p.type, C.variantOf(p)));
        const groups = new Map();
        inv.forEach((x) => {
          const vr = C.variantOf(x);
          const key = x.type + ':' + (vr == null ? '' : vr || 'any');
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
        if (C.TYPES[type].fixed) rot = 0;
        return C.TYPES[type].foot.map(([dx, dy]) => {
          let x = dx, y = dy;
          for (let k = 0; k < rot; k++) { const nx = -y; y = x; x = nx; }
          return [x, y];
        });
      }
      // the holes a part's legs would go in, anchored at a hole; null where they can't (a rigid part's pins
      // go in the board's strips, never a rail)
      function legsAt(anchor, offsets, ignoreId, type) {
        const h0 = C.HOLES.get(anchor);
        if (!h0) return null;
        const occ = occupancy(build);
        const rigid = type && C.TYPES[type].rigid;
        const at = [];
        for (const [dx, dy] of offsets) {
          const name = C.holeAt(h0.x + dx, h0.y + dy);
          if (!name || (rigid && !/^[UD]/.test(C.HOLES.get(name).strip))) return null;
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
        placeTerms(L, build);
        B = C.bench(spec, build);
        S = C.session(B, { run: false, onSerial: (s) => { serialText += s; } });
        // the same time, charges, servo angles and screens carry on; and the sketch, if it is running
        if (old) S.adopt(old, Boolean(running && old.vm && !old.vm.done));
        // the inputs as the learner set them
        build.parts.forEach((p) => {
          if (p.type === 'switch') S.set('on', p.id, Boolean(p.on));
          if (p.type === 'pot') S.set('knob', p.id, p.knob);
          if (p.type === 'ldr') S.set('light', p.id, p.light);
          if (p.type === 'sonar') S.set('cm', p.id, p.cm);
          if (p.type === 'tmp36' || p.type === 'dht11') S.set('temp', p.id, p.temp);
          if (p.type === 'dht11') S.set('hum', p.id, p.hum);
          if (p.type === 'pir') S.set('motion', p.id, Boolean(p.motion));
        });
        termList = [...L.terms.keys()];
        lastClicks = S.clicks;
      }
      function rebuilt() {
        compileBench();
        drawBuild();
        drawBin();
        drawControls();
        paintLive();
      }
      const lookNow = (v) => looks(build, v, { burnt: S.burnt, press: S.inputs.press, S });
      function drawBuild() {
        while (gParts.firstChild) gParts.removeChild(gParts.firstChild);
        while (gWires.firstChild) gWires.removeChild(gWires.firstChild);
        const v = S.latch();
        lastView = v;
        const lk = lookNow(v);
        drawFixtures(v, lk);
        build.parts.forEach((p) => { if (!C.TYPES[p.type].dock) gParts.appendChild(toDom(partTree(p, lk[p.id], { live: true, gid }), R)); });
        build.wires.forEach((w, i) => gWires.appendChild(toDom(wireTree(L, w, i, { live: true, sel: sel && sel.k === 'wire' && sel.i === i }), R)));
        drawOverlay();
      }
      // what changes as the circuit runs: glows, the buzzer, the motor, warnings, the meter
      let spinAngle = 0, spinSpeed = 0, lastClicks = 0, clickTimer = 0;
      function paintLive() {
        if (!S) return;
        const v = S.latch();
        lastView = v;
        const lk = lookNow(v);
        let buzzing = false, freq = 0;
        const attr = (k, a, val) => { const n = R[k]; if (n && n.getAttribute(a) !== String(val)) n.setAttribute(a, val); };
        const text = (k, s) => { const n = R[k]; if (n && n.textContent !== s) n.textContent = s; };
        build.parts.forEach((p) => {
          const k = lk[p.id], id = p.id;
          if (p.type === 'led') {
            const g = R['glow:' + id], d = R['dome:' + id];
            if (g) g.setAttribute('opacity', k.lit ? r1(0.25 + 0.75 * k.glow) : 0);
            if (d && !k.burnt) d.setAttribute('fill', k.lit ? LED_ON[p.color] : LED_OFF[p.color]);
            if (k.burnt && d && d.getAttribute('fill') !== '#3a3433') { redrawPart(p, k); }
          } else if (p.type === 'buzzer') {
            const w = R['waves:' + id];
            if (w) w.setAttribute('opacity', k.on ? 1 : 0);
            if (k.on) { buzzing = true; S.pins.forEach((ps) => { if (ps.freq) freq = ps.freq; }); }
          } else if (p.type === 'button') {
            const cap = R['cap:' + id];
            if (cap) { cap.setAttribute('r', k.pressed ? 5.6 : 6.8); cap.setAttribute('fill', k.pressed ? '#9c2b22' : '#d9453a'); }
          } else if (p.type === 'seg7') {
            Object.keys(SEG_LINE).forEach((s) => attr('s' + s + ':' + id, 'stroke', segColor(k.segs && k.segs[s])));
            attr('sdp:' + id, 'fill', segColor(k.segs && k.segs.dp));
          } else if (p.type === 'rgb') {
            const col = rgbOf(k.dies);
            attr('rglow:' + id, 'fill', col.c); attr('rglow:' + id, 'opacity', col.on ? r1(0.2 + 0.6 * col.k) : 0);
            attr('rdome:' + id, 'fill', col.on ? col.c : '#ece8ef');
          } else if (p.type === 'electrolytic') {
            if (k.fault && R['charge:' + id] && R['charge:' + id].getAttribute('opacity') !== '0') { redrawPart(p, k); return; }
            attr('charge:' + id, 'stroke-dasharray', `${r1(clamp(k.vc / 9, 0, 1) * 64.1)} 64.1`);
            text('cv:' + id, k.vc.toFixed(1) + ' V');
          } else if (p.type === 'servo') {
            const m = L.mods.get(id);
            if (m) attr('horn:' + id, 'transform', `rotate(${r1(-k.angle)} ${m.x + 44} ${m.y + 40})`);
            text('deg:' + id, Math.round(k.angle) + '°');
          } else if (p.type === 'sonar') {
            attr('wall:' + id, 'transform', `translate(0 ${r1(-wallAt(k.cm) * 24)})`);
            text('cm:' + id, Math.round(k.cm) + ' cm');
          } else if (p.type === 'lcd') {
            attr('scr:' + id, 'fill', lcdScreen(k));
            [0, 1].forEach((r) => { text('row' + r + ':' + id, lcdRow(k.lcd.rows[r])); attr('row' + r + ':' + id, 'fill', lcdInk(k)); });
          } else if (p.type === 'relay') {
            const m = L.mods.get(id);
            attr('rled:' + id, 'fill', k.on ? '#ff4433' : '#5a2a2a');
            if (m) attr('arm:' + id, 'y2', k.on ? m.y + 11 : m.y + 29);
          } else if (p.type === 'pir') {
            attr('wave:' + id, 'opacity', k.motion ? 1 : 0);
            attr('pled:' + id, 'fill', k.out > 2 ? '#ff4433' : '#5a2a2a');
          }
          if (C.TYPES[p.type].dock) attr('nopow:' + id, 'opacity', k.powered ? 0 : 1);
        });
        // a relay that just moved: it clicks
        if (S.clicks !== lastClicks) {
          lastClicks = S.clicks;
          build.parts.forEach((p) => {
            const c = p.type === 'relay' && R['click:' + p.id];
            if (!c) return;
            c.setAttribute('opacity', 1);
            clearTimeout(clickTimer);
            clickTimer = setTimeout(() => { if (!destroyed && c) c.setAttribute('opacity', 0); }, reduce ? 900 : 450);
          });
          announce(t('The relay clicks.'));
        }
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
        else if (S.burnt.size) {
          const id = [...S.burnt][0].split('#')[0], bp = B.parts.get(id), name = partWords(bp, t, fill);
          const ty = bp ? bp.type : 'led';
          msg = ty === 'electrolytic' ? fill('{name} burst: it was the wrong way round. Its + leg must face the + side; move it, or undo.', { name })
            : ty === 'npn' || ty === 'mosfet' ? fill('{name} burnt out: too much current. Put a resistor of about 1 kΩ before its base, then move it, or undo.', { name })
              : fill('{name} burnt out: too much current. Add a resistor in series, then put in a new LED (move it, or undo).', { name });
          bad = true;
        }
        else if (v.overload.length) { const p = v.overload[0]; msg = fill('Pin {pin} is giving {mA} mA, more than an Arduino pin can. Add a resistor.', { pin: p < 14 ? p : 'A' + (p - 14), mA: C.mA(v.pinPeak[p]) }); bad = true; }
        status.textContent = msg ? msg.charAt(0).toUpperCase() + msg.slice(1) : '';
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
          const m = p && L.mods.get(p.id);
          if (m) add(el('rect', { x: m.x - 6, y: m.y - 14, width: m.w + 12, height: m.h + 20, rx: 6, fill: 'none', stroke: GOLD, 'stroke-width': 1.8, 'stroke-dasharray': '4 3' }));
          else if (p) {
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
          const at = legsAt(ghostAt, dragPart.offs, p.id, p.type);
          return at ? { part: Object.assign({}, p, { at }), ok: true } : null;
        }
        if (!act || act.k !== 'place' || !ghostAt) return null;
        const at = legsAt(ghostAt, footprint(act.item.type, act.rot), null, act.item.type);
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
        if (item.type === 'capacitor' || item.type === 'electrolytic') p.uf = item.uf || Number(pickVal[item.key] || (item.type === 'capacitor' ? 0.1 : 100));
        if (item.type === 'zener') p.volts = 5.1;
        if (item.type === 'seg7') p.common = item.common || 'cathode';
        if (item.type === 'tmp36') p.temp = 25;
        if (item.type === 'sonar') p.cm = 100;
        if (item.type === 'pir') p.motion = false;
        if (item.type === 'dht11') { p.temp = 25; p.hum = 50; }
        return p;
      }
      // a module goes straight to its place beside the board
      function placeModule(item) {
        snapshot();
        const p = newPart(item, [], false);
        build.parts.push(p);
        sel = { k: 'part', id: p.id };
        act = null;
        rebuilt();
        changed(true);
        const pins = C.TYPES[p.type].pins.join(', ');
        announce(fill('Placed {name} beside the board. Its pins: {pins}.', { name: partWords(p, t, fill), pins }));
        setHint(fill('{name} is beside the board: tap one of its pins, then a pin of the Arduino, to wire them. Its pins: {pins}.', { name: partWords(p, t, fill), pins }));
      }

      /* edits */
      function changed(structure) {
        touched = true;
        quiet = 0;
        if (structure) { S && S.burnt.clear(); }
        scheduleAnim();
        try { ctx.onChange && ctx.onChange(value()); } catch (e) { /* the page's own handler */ }
      }
      function placeAt(hole) {
        const item = act.item;
        const at = legsAt(hole, footprint(item.type, act.rot), null, item.type);
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
        if (p.type === 'npn') return fill('The transistor’s legs: E (emitter) in {a}, B (base) in {b}, C (collector) in {c}. A small current into B lets a big one flow from C to E.', { a: p.at[0], b: p.at[1], c: p.at[2] });
        if (p.type === 'mosfet') return fill('The MOSFET’s legs: G (gate) in {a}, D (drain) in {b}, S (source) in {c}. 5 V on G lets current flow from D to S.', { a: p.at[0], b: p.at[1], c: p.at[2] });
        if (p.type === 'diode' || p.type === 'zener') return fill('The diode’s anode is in {a}, its cathode (the striped end) in {b}. Current flows only from anode to cathode.', { a: p.at[0], b: p.at[1] });
        if (p.type === 'electrolytic') return fill('The capacitor’s + leg is in {a}, its − leg (the striped side) in {b}. It must not go in backwards.', { a: p.at[0], b: p.at[1] });
        if (p.type === 'tmp36') return fill('The TMP36’s legs: +Vs in {a} (to 5V), Vout in {b} (to an analog pin), GND in {c}.', { a: p.at[0], b: p.at[1], c: p.at[2] });
        if (p.type === 'rgb') return fill('The RGB LED’s legs: red in {a}, the common − in {b}, green in {c}, blue in {d}.', { a: p.at[0], b: p.at[1], c: p.at[2], d: p.at[3] });
        if (p.type === 'seg7') return fill('The display’s top pins are g, f, COM, a, b ({a} to {b}); its bottom pins e, d, COM, c, dp ({c} to {d}).', { a: p.at[0], b: p.at[4], c: p.at[5], d: p.at[9] });
        return fill('Placed in {holes}.', { holes: p.at.join(', ') });
      }
      function rotate() {
        if (locked) return;
        if (act && act.k === 'place') { act.rot = C.TYPES[act.item.type].fixed ? 0 : (act.rot + 1) % 4; drawOverlay(); return; }
        if (!sel || sel.k !== 'part') return;
        const p = build.parts.find((x) => x.id === sel.id);
        if (!p) return;
        if (C.TYPES[p.type].dock || C.TYPES[p.type].fixed) { setHint(t('This part sits one way only.')); return; }
        const offs = offsetsOf(p).map(([x, y]) => [-y, x]);
        // turn about each leg in turn until it fits
        for (let i = 0; i < p.at.length; i++) {
          const piv = offs[i], h = C.HOLES.get(p.at[i]);
          const anchor = C.holeAt(h.x - piv[0], h.y - piv[1]);
          const at = anchor && legsAt(anchor, offs, p.id, p.type);
          if (at) { snapshot(); p.at = at; rebuilt(); changed(true); announce(fill('Turned {name}: now in {holes}.', { name: partWords(p, t, fill), holes: at.join(', ') })); return; }
        }
        setHint(t('There’s no room to turn it here.'));
      }
      function removeSel() {
        if (locked || !sel) return;
        snapshot();
        if (sel.k === 'part') {
          const p = build.parts.find((x) => x.id === sel.id);
          build.parts = build.parts.filter((x) => x.id !== sel.id);
          // a module's wires go with it
          if (p && C.TYPES[p.type].dock) build.wires = build.wires.filter((w) => !w.from.startsWith(p.id + '.') && !w.to.startsWith(p.id + '.'));
          announce(fill('Took {name} back to the bin.', { name: partWords(p, t, fill) }));
        }
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
          rubber = null;
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
        if (act && act.k === 'probe') { const p = build.parts.find((x) => x.id === id); if (p) tapPoint(p.at[0] || p.id + '.' + C.TYPES[p.type].pins[0]); return; }
        if (act && act.k === 'wire') { act = null; setHint(''); }
        const p = build.parts.find((x) => x.id === id);
        if (!p) return;
        if (p.type === 'pir') { setMotion(p, !p.motion); }
        if (C.TYPES[p.type].dock) {
          sel = { k: 'part', id };
          drawBuild();
          setHint(fill('{name}: tap one of its pins ({pins}) to wire it. Delete takes it back to the bin.', { name: partWords(p, t, fill), pins: C.TYPES[p.type].pins.join(', ') }));
          announce(partWords(p, t, fill));
          return;
        }
        if (p.type === 'switch') {
          p.on = !p.on;
          S.set('on', id, p.on);
          changed(false);
          redrawPart(p, looks(build, S.view(), { burnt: S.burnt, press: S.inputs.press })[p.id]);
          paintLive();
          const ctl = ctlRefs[id];
          if (ctl) { ctl.textContent = switchWords(p); ctl.setAttribute('aria-pressed', p.on ? 'true' : 'false'); }
          announce(switchWords(p));
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
        quiet = 0;
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
        // and a part under a wire wins over the wire: look through everything under the pointer
        const stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target];
        const findIn = (sel) => { for (const x of stack) { const m = x.closest && x.closest(sel); if (m && svg.contains(m)) return m; } return null; };
        const partEl = !onTerm && findIn('[data-part]');
        const wireEl = !onTerm && !onHole && !partEl && findIn('[data-wire]');
        const termEl = findIn('[data-term]');
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
          const gp = g.part && build.parts.find((x) => x.id === g.part);
          if (locked || (gp && C.TYPES[gp.type].dock)) g.k = root.classList.contains('is-zoomed') || locked ? 'pan' : 'none'; // a module stays in its place
          else if (g.part && !(act && act.k === 'probe')) {
            const p = gp;
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
          const at = ghostAt && legsAt(ghostAt, dragPart.offs, p.id, p.type);
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
      let termList = [...L.terms.keys()];
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
        // a module's pin, like SV1.SIG
        const typed = goIn.value.trim().toLowerCase();
        if (!name && /\./.test(typed)) name = [...L.terms.keys()].find((k) => k.toLowerCase() === typed) || null;
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
        // an empty bin isn't shown (a part taken off the board comes back to it)
        binWrap.hidden = !left.length;
        left.forEach((it) => {
          const row = hostEl('div', 'bb-item', { role: 'listitem' });
          const label = binLabel(it, spec, t, fill);
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
          const cap = it.type === 'capacitor' || it.type === 'electrolytic';
          if ((it.type === 'led' && it.color === 'any') || (it.type === 'resistor' && !it.ohms) || (cap && !it.uf)) {
            const s = hostEl('select', 'bb-item__pick', { 'aria-label': it.type === 'led' ? t('LED colour') : cap ? t('Capacitor value') : t('Resistor value') });
            const opts = it.type === 'led' ? C.LED_COLORS : cap ? C.CAP_STANDARD.filter((u) => (it.type === 'capacitor' ? u <= 1 : u >= 1)) : C.STANDARD;
            opts.forEach((o) => { const op = hostEl('option', null, { value: String(o) }, it.type === 'led' ? colorName(o, t) : cap ? C.fmtFarads(o) : C.fmtOhms(o)); s.appendChild(op); });
            s.value = String(pickVal[it.key] || (it.type === 'led' ? 'red' : it.type === 'capacitor' ? 0.1 : cap ? 100 : 220));
            s.addEventListener('change', () => { pickVal[it.key] = it.type === 'led' ? s.value : Number(s.value); drawOverlay(); });
            row.appendChild(s);
          }
          binList.appendChild(row);
        });
        if (had) { const again = binList.querySelector(`[data-key="${CSS.escape(had)}"]`); if (again) again.focus({ preventScroll: true }); }
        if (locked) binList.querySelectorAll('button, select').forEach((b) => { b.disabled = true; });
      }
      function choose(it) {
        if (locked) return;
        if (C.TYPES[it.type].dock) { placeModule(it); return; }
        if (act && act.k === 'place' && act.item.key === it.key) { act = null; setHint(''); drawBin(); drawOverlay(); return; }
        act = { k: 'place', item: it, rot: act && act.k === 'place' ? act.rot : 0 };
        sel = null;
        ghostAt = cursorOn && C.HOLES.has(cursor) ? cursor : null;
        drawBin();
        drawOverlay();
        const ty = it.type;
        const what = ty === 'led' ? t('Tap a hole for the LED’s + leg (the anode); the − leg goes in the next column. R turns it.')
          : ty === 'pot' || ty === 'switch' ? t('Tap a hole for its first leg; the others go in the next two columns. R turns it.')
            : ty === 'npn' ? t('Tap a hole for the transistor’s E leg; B and C go in the next two columns. R turns it.')
              : ty === 'mosfet' ? t('Tap a hole for the MOSFET’s G leg; D and S go in the next two columns. R turns it.')
                : ty === 'tmp36' ? t('Tap a hole for the TMP36’s +Vs leg; Vout and GND go in the next two columns. R turns it.')
                  : ty === 'diode' || ty === 'zener' ? t('Tap a hole for the diode’s anode; the striped end (the cathode) goes four columns on. R turns it.')
                    : ty === 'electrolytic' ? t('Tap a hole for the capacitor’s + leg; the − leg goes in the next column. R turns it.')
                      : ty === 'rgb' ? t('Tap a hole for the red leg; the common −, green and blue legs follow in the next columns. R turns it.')
                        : ty === 'seg7' ? t('Tap a hole in row a to e for the display’s top-left pin (g); it sits across the centre gap.')
                          : t('Tap a hole for its first leg. R turns it.');
        setHint(what);
        announce(what);
      }
      // dragging from the bin onto the board
      function binDrag(e, it) {
        if (locked || e.button > 0 || C.TYPES[it.type].dock) return;
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
      const switchWords = (p) => (p.on ? fill('Switch {id}: on', { id: p.id }) : fill('Switch {id}: off', { id: p.id }));
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
            const b = button('bb-ctl', switchWords(p), () => tapPart(p.id), { 'aria-pressed': p.on ? 'true' : 'false', 'data-ctl': p.id });
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
          } else if (p.type === 'sonar') {
            // the distance to the obstacle: 2 cm to 4 m, finer close up
            const toCm = (x) => Math.round(2 * Math.pow(200, x / 100)), toX = (cm) => Math.round(100 * Math.log(cm / 2) / Math.log(200));
            slider(p, fill('Distance from {id}', { id: p.id }), toX(p.cm), (x) => { p.cm = toCm(x); S.set('cm', p.id, p.cm); return fill('{cm} cm', { cm: p.cm }); }, fill('{cm} cm', { cm: Math.round(p.cm) }));
          } else if (p.type === 'tmp36' || p.type === 'dht11') {
            const lo = p.type === 'tmp36' ? -10 : 0, hi = p.type === 'tmp36' ? 60 : 50;
            slider(p, fill('Temperature at {id}', { id: p.id }), Math.round((p.temp - lo) / (hi - lo) * 100), (x) => { p.temp = Math.round(lo + (hi - lo) * x / 100); S.set('temp', p.id, p.temp); return fill('{c} °C', { c: p.temp }); }, fill('{c} °C', { c: Math.round(p.temp) }));
            if (p.type === 'dht11') slider(p, fill('Humidity at {id}', { id: p.id }), Math.round((p.hum - 20) / 70 * 100), (x) => { p.hum = Math.round(20 + 70 * x / 100); S.set('hum', p.id, p.hum); return fill('{h}%', { h: p.hum }); }, fill('{h}%', { h: Math.round(p.hum) }));
          } else if (p.type === 'pir') {
            const b = button('bb-ctl', motionWords(p), () => { if (!locked) setMotion(p, !p.motion); }, { 'aria-pressed': p.motion ? 'true' : 'false', 'data-ctl': p.id });
            ctlRefs[p.id] = b;
            controls.appendChild(b);
          }
        });
        controls.hidden = !controls.childNodes.length;
        if (had) { const again = controls.querySelector(`[data-ctl="${had}"]`); if (again) again.focus({ preventScroll: true }); }
      }
      const lightWord = (x) => (x < 0.2 ? t('dark') : x < 0.5 ? t('dim') : x < 0.8 ? t('bright') : t('very bright'));
      // a slider below the bench for a sensor's world: set(0-100) changes it and gives the words to show
      function slider(p, label, x0, set, words) {
        const lab = hostEl('label', 'bb-ctl bb-ctl--slider');
        lab.appendChild(hostEl('span', null, null, label));
        const input = hostEl('input', null, { type: 'range', min: '0', max: '100', step: '1', 'aria-valuetext': words });
        input.value = String(clamp(x0, 0, 100));
        const out = hostEl('output', null, null, words);
        input.addEventListener('input', () => {
          if (locked) return;
          out.textContent = set(Number(input.value));
          input.setAttribute('aria-valuetext', out.textContent);
          touched = true;
          paintLive();
          changed(false);
        });
        lab.append(input, out);
        controls.appendChild(lab);
      }
      const motionWords = (p) => (p.motion ? fill('Motion at {id}: someone moves', { id: p.id }) : fill('Motion at {id}: still', { id: p.id }));
      function setMotion(p, x) {
        if (locked) return;
        p.motion = Boolean(x);
        S.set('motion', p.id, p.motion);
        touched = true;
        changed(false);
        paintLive();
        const ctl = ctlRefs[p.id];
        if (ctl) { ctl.textContent = motionWords(p); ctl.setAttribute('aria-pressed', p.motion ? 'true' : 'false'); }
        announce(motionWords(p));
      }

      /* the sketch */
      let raf = 0, onScreen = true, lastShown = -1;
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
        lastFrame = 0;
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
      // time moves on while a sketch runs, or while a capacitor charges or discharges (until it settles)
      let quiet = 0, lastVc = null;
      const sketchOn = () => Boolean(running && S && S.vm && !S.vm.done);
      const timeFlows = () => Boolean(S && (sketchOn() || (S.dynamic && quiet < 2000) || S.events.length));
      const animating = () => !destroyed && onScreen && !document.hidden && (timeFlows() || (!reduce && spinSpeed));
      function scheduleAnim() { if (!raf && animating()) { raf = requestAnimationFrame(frame); } }
      let lastFrame = 0;
      function frame(now) {
        raf = 0;
        if (!animating()) { lastFrame = 0; return; }
        const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
        lastFrame = now;
        if (timeFlows() && dt > 0) {
          const t0 = S.tc;
          // a busy sketch runs slower than real time rather than freezing the page
          S.runTo(S.tc + dt * 1e6, 30000);
          if (S.vm && S.vm.error) { const err = S.vm.error; stopSketch(); showErr(err); }
          if (S.dynamic) {
            const most = lastVc && lastVc.length === S.vc.length ? Math.max(0, ...Array.from(S.vc, (x, i) => Math.abs(x - lastVc[i]))) : 1;
            quiet = most < 1e-4 && !sketchOn() ? quiet + dt * 1000 : 0;
            lastVc = Float64Array.from(S.vc);
          }
          if (serialOut && serialText) {
            const cur = serialOut.textContent + serialText;
            serialOut.textContent = cur.length > 6000 ? cur.slice(-5000) : cur;
            serialText = '';
            serialOut.scrollTop = serialOut.scrollHeight;
            if (R.ledTX) { R.ledTX.setAttribute('fill', '#ffd76e'); setTimeout(() => { if (R.ledTX) R.ledTX.setAttribute('fill', '#6b5a3a'); }, 60); }
          }
          if (S.dirty || S.tc !== t0) paintLive();
          if (sketchOn()) {
            const sec = Math.floor(S.tc / 100000) / 10;
            if (sec !== lastShown && runState) { lastShown = sec; runState.textContent = fill('Running · {s} s', { s: sec.toFixed(1) }); }
            if (S.vm.noBegin && !serialOut.textContent && !S.vm.toldBegin) { S.vm.toldBegin = true; serialOut.textContent = t('(Nothing is sent until setup() calls Serial.begin(9600);)'); }
          }
        }
        if (spinSpeed && !reduce && R.prop && L.mot) {
          spinAngle = (spinAngle + spinSpeed * dt * 900) % 360;
          const cx = L.mot.x + 44, cy = L.mot.y + 48;
          R.prop.setAttribute('transform', `rotate(${r1(spinAngle)} ${cx} ${cy})`);
        }
        raf = requestAnimationFrame(frame);
      }
      const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
        onScreen = es.some((x) => x.isIntersecting);
        if (!onScreen) sound.set(false);
        lastFrame = 0;
        scheduleAnim();
      }) : null;
      if (io) io.observe(root);
      const onVis = () => { if (document.hidden) sound.set(false); lastFrame = 0; scheduleAnim(); };
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
          clearTimeout(clickTimer);
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
      const bits = b.parts.map((p) => (p.type === 'led' ? F('a {color} LED', { color: colorName(p.color, T) }) : p.type === 'resistor' ? F('a {ohms} resistor', { ohms: C.fmtOhms(p.ohms) }) : p.type === 'capacitor' || p.type === 'electrolytic' ? F('a {uf} capacitor', { uf: C.fmtFarads(p.uf) }) : partName(p.type, T)));
      if (b.wires.length) bits.push(b.wires.length === 1 ? T('1 wire') : F('{n} wires', { n: b.wires.length }));
      let s = bits.length ? andList(bits) : T('Nothing built');
      const lines = (b.code || '').trim() ? b.code.trim().split('\n').length : 0;
      if (spec.arduino && lines) s += '; ' + F('a sketch of {n} lines', { n: lines });
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
        const drv = ref.info.driver;
        const motorWords = (pin) => (drv === 'relay' ? F('Pin {pin} to the relay’s IN, its VCC to 5V and GND to GND; the battery’s + through COM and NO to the motor, and the motor back to −.', { pin })
          : drv === 'mosfet' ? F('Pin {pin} through a {ohms} resistor to the MOSFET’s gate; its source to GND; the motor from + to its drain.', { pin, ohms })
            : F('Pin {pin} through a {ohms} resistor to the transistor’s base; its emitter to GND; the motor from + to its collector, with a diode across the motor (stripe towards +) and the battery’s − joined to GND.', { pin, ohms }));
        switch (g.type) {
          case 'light': return g.part === 'motor' && g.pin != null ? motorWords(g.pin) : g.part === 'motor' ? T('Join the motor’s two terminals to the battery’s + and −.') : g.part === 'buzzer' ? T('Join the buzzer’s + leg towards +, and its other leg back to −.')
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
          case 'servo': return g.sweep ? F('The servo’s GND (brown) to GND, VCC (red) to 5V, SIG (orange) to pin 9; in loop(), write() each angle from {lo} to {hi} and back, with a short delay().', { lo: g.sweep[0], hi: g.sweep[1] })
            : F('The servo’s GND (brown) to GND, VCC (red) to 5V, SIG (orange) to pin {pin}; then #include <Servo.h>, attach({pin}) and write({angle}).', { pin: g.pin != null ? g.pin : 9, angle: g.angle });
          case 'display': return F('The segments a to g wired to pins 2 to 8, COM through a {ohms} resistor to GND (or 5V, for common anode); then light the segments the digit {digit} needs.', { ohms, digit: g.digit });
          case 'lcd': return F('The LCD’s GND to GND, VCC to 5V, SDA to A4, SCL to A5; then lcd.init(), lcd.backlight(), lcd.setCursor(0, 0) and lcd.print("{text}").', { text: g.text });
          case 'distance': return F('The sensor’s VCC to 5V, GND to GND, TRIG to pin 9, ECHO to pin 10; send a 10 µs pulse on TRIG, time the echo with pulseIn(), and light the LED when the distance (duration × 0.034 / 2) is under {cm} cm.', { cm: g.cm });
          case 'temperature': return (g.by === 'dht11' ? F('The DHT11’s DATA to a pin (with DHT dht(pin, DHT11)); read dht.readTemperature(), and switch the output on above {above} °C.', { above: g.above }) : F('The TMP36 from 5V to GND, its middle leg to A0; temperature = (volts − 0.5) × 100; switch the output on above {above} °C.', { above: g.above })) + (g.part === 'motor' ? ' ' + motorWords(g.led_pin != null ? g.led_pin : 9) : '');
          case 'fade': return F('The switch feeds a {uf} capacitor (+ leg towards +) and, through a {ohms} resistor, the LED: when the switch opens, the capacitor keeps the LED glowing as it empties.', { ohms, uf: C.fmtFarads((ref.build.parts.find((p) => p.type === 'electrolytic' || p.type === 'capacitor') || { uf: 1000 }).uf) });
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
