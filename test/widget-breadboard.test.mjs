// The breadboard bench: the board's connectivity, the solver, the Arduino sketch interpreter, the goal checks and
// reference builds (assets/js/widgets/breadboard-core.js), and the server's checks of what the AI writes
// (server/widgets/breadboard.mjs, through server/widgets.mjs).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import B from '../assets/js/widgets/breadboard-core.js';
import * as bb from '../server/widgets/breadboard.mjs';
import { KINDS, normWidgetBlock, normTask, widgetKinds, widgetPrompt } from '../server/widgets.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);
const benchOf = (raw, opts) => { const spec = B.normSpec(raw, Object.assign({ loose: true }, opts)); return { spec, B: B.bench(spec, B.startBuild(spec)) }; };
const joined = (b, x, y) => { const n = (h) => b.pts.get(b.nodeOf(h)); return n(x) !== undefined && n(y) !== undefined && b.uf[n(x)] === b.uf[n(y)]; };
// a 9 V battery, a resistor and an LED in a loop along row h
const loop = (ohms, led = { at: ['g10', 'g11'] }) => ({
  battery: '9V',
  parts: [{ id: 'R1', type: 'resistor', ohms, at: ['h6', 'h10'] }, Object.assign({ id: 'L1', type: 'led', color: 'red' }, led)],
  wires: [{ from: 'BAT+', to: 'j6' }, { from: 'j11', to: 'BAT-' }]
});

test('the board: strips of five, the centre gap, the rails', () => {
  const { B: b } = benchOf({ battery: '9V', wires: [
    { from: 'a5', to: 'a20' }, { from: 'e5', to: 'e21' }, { from: 'f5', to: 'f22' }, { from: 'a6', to: 'a23' },
    { from: '+T2', to: 'a24' }, { from: '+T30', to: 'a25' }, { from: '-T2', to: 'a26' }, { from: '+B2', to: 'a27' }
  ] });
  assert.ok(joined(b, 'a20', 'a21'), 'a5 and e5 are in one strip');
  assert.ok(!joined(b, 'a20', 'a22'), 'e5 and f5 are on either side of the gap');
  assert.ok(!joined(b, 'a20', 'a23'), 'columns 5 and 6 are apart');
  assert.ok(joined(b, 'a24', 'a25'), 'a rail runs the whole length');
  assert.ok(!joined(b, 'a24', 'a26') && !joined(b, 'a24', 'a27'), 'the four rails are apart');
  // holes, rails and pins as the AI writes them
  assert.deepEqual(B.parsePoint('A12'), { hole: 'a12' });
  assert.deepEqual(B.parsePoint('12c'), { hole: 'c12' });
  assert.deepEqual(B.parsePoint('A0', true), { term: 'A0' }, 'with an Arduino, A0 is a pin');
  assert.deepEqual(B.parsePoint('D13', true), { term: 'D13' });
  assert.deepEqual(B.parsePoint('d13', true), { hole: 'd13' }, 'lower case is always a hole');
  assert.deepEqual(B.parsePoint('+T'), { rail: '+T', col: null });
  assert.deepEqual(B.parsePoint('bottom-'), { rail: '-B', col: null });
  assert.deepEqual(B.parsePoint('battery+'), { term: 'BAT+' });
  assert.equal(B.parsePoint('k5'), null);
  assert.equal(B.parsePoint('a31'), null);
});

test('the solver: an LED with a resistor, without one, backwards, and a short circuit', () => {
  // 470 ohms on 9 V: (9 - 1.8) / (470 + 15 + 1.5) is about 14.8 mA
  let { B: b } = benchOf(loop(470));
  let v = B.session(b).view();
  near(v.parts.L1.I, (9 - 1.8) / (470 + 15 + 1.5), 2e-5, 'the LED current');
  assert.ok(v.parts.L1.lit && !v.parts.L1.burn);
  near(v.volt('g10') - v.volt('g11'), 1.8 + 15 * v.parts.L1.I, 1e-3, 'the voltage across it');
  // no resistor: hundreds of milliamps, and it burns out
  ({ B: b } = benchOf({ battery: '9V', parts: [{ id: 'L1', type: 'led', at: ['g10', 'g11'] }], wires: [{ from: 'BAT+', to: 'j10' }, { from: 'j11', to: 'BAT-' }] }));
  v = B.session(b).view();
  assert.ok(v.parts.L1.burn && !v.parts.L1.lit, 'it burns');
  assert.ok(v.parts.L1.I > 0.2);
  assert.throws(() => B.normSpec({ battery: '9V', parts: [{ id: 'L1', type: 'led', at: ['g10', 'g11'] }], wires: [{ from: 'BAT+', to: 'j10' }, { from: 'j11', to: 'BAT-' }] }), /burns out/);
  // the wrong way round: no current, and the diagnosis says so
  ({ B: b } = benchOf(loop(470, { at: ['g11', 'g10'] })));
  const S = B.session(b);
  assert.equal(S.view().parts.L1.lit, false);
  assert.equal(B.diagnose(b, S, ['L1']).code, 'reversed');
  // + joined to - with a wire: a short circuit, not a crash
  ({ B: b } = benchOf({ battery: '9V', wires: [{ from: 'BAT+', to: 'j3' }, { from: 'i3', to: 'BAT-' }] }));
  assert.equal(B.session(b).view().short, true);
  assert.throws(() => B.normSpec({ battery: '9V', bin: { led: 1 }, wires: [{ from: 'BAT+', to: 'j3' }, { from: 'i3', to: 'BAT-' }] }), /short circuit/);
  // a 3 V pack can't light a blue LED (2.8 V knee) brightly through 470 ohms, but can a red one
  const blue = B.session(benchOf(Object.assign(loop(470, { at: ['g10', 'g11'], color: 'blue' }), { battery: '3V' })).B).view();
  const red = B.session(benchOf(Object.assign(loop(470), { battery: '3V' })).B).view();
  assert.ok(blue.parts.L1.I < red.parts.L1.I / 2, 'a blue LED needs more voltage');
});

test('the solver: a pot, an LDR, a switch, a button, the motor, the buzzer', () => {
  const pot = (knob) => B.session(benchOf({ battery: '9V', parts: [
    { id: 'P1', type: 'pot', at: ['h3', 'h4', 'h5'], knob }, { id: 'R1', type: 'resistor', ohms: 220, at: ['g4', 'g8'] }, { id: 'L1', type: 'led', at: ['h8', 'h9'] }
  ], wires: [{ from: 'BAT+', to: 'j3' }, { from: 'j9', to: 'BAT-' }] }).B).view().parts.L1.I;
  assert.ok(pot(0) > 3 * pot(1), 'turning the pot dims the LED');
  const ldr = (light) => B.session(benchOf({ battery: '9V', parts: [{ id: 'D1', type: 'ldr', at: ['h3', 'h5'], light }, { id: 'R1', type: 'resistor', ohms: 220, at: ['g5', 'g9'] }, { id: 'L1', type: 'led', at: ['h9', 'h10'] }], wires: [{ from: 'BAT+', to: 'j3' }, { from: 'j10', to: 'BAT-' }] }).B).view().parts.L1.I;
  assert.ok(ldr(1) > 10 * ldr(0), 'more light, more current');
  // the button and the switch close the loop when pressed, or when on
  const { B: b } = benchOf({ battery: '9V', motor: true, parts: [
    { id: 'BTN1', type: 'button', at: ['e3', 'f3'] }, { id: 'R1', type: 'resistor', ohms: 470, at: ['g3', 'g7'] }, { id: 'L1', type: 'led', at: ['h7', 'h8'] },
    { id: 'SW1', type: 'switch', at: ['h14', 'h15', 'h16'], on: false }, { id: 'BZ1', type: 'buzzer', at: ['h20', 'h22'] }
  ], wires: [{ from: 'BAT+', to: 'a3' }, { from: 'j8', to: 'BAT-' }, { from: 'j14', to: 'BAT+' }, { from: 'j15', to: 'j20' }, { from: 'j22', to: 'BAT-' }, { from: 'BAT+', to: 'M+' }, { from: 'M-', to: 'BAT-' }] });
  const S = B.session(b);
  assert.equal(S.view().parts.L1.lit, false);
  assert.equal(S.view().parts.BZ1.on, false, 'the switch is off');
  assert.equal(S.view().parts.MOTOR.on, true, 'the motor turns');
  S.set('press', 'BTN1', true);
  S.set('on', 'SW1', true);
  assert.equal(S.view().parts.L1.lit, true, 'pressed: lit');
  assert.equal(S.view().parts.BZ1.on, true, 'on: it buzzes');
});

const run = (code, ms, extra) => {
  const spec = B.normSpec(Object.assign({ arduino: true }, extra || {}), { loose: true });
  const b = B.bench(spec, { parts: spec.parts, wires: spec.wires, code });
  if (b.codeError) throw b.codeError;
  const S = B.session(b);
  S.record = [];
  S.run(ms);
  return S;
};

test('the sketch: a blink keeps its time, delay() is simulated time', () => {
  const S = run('void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(250);\n}\n', 3000);
  const ups = S.record.filter((r, i, a) => r.pins[13].level === 1 && (i === 0 || a[i - 1].pins[13].level === 0)).map((r) => r.t / 1000);
  const downs = S.record.filter((r, i, a) => i > 0 && r.pins[13].level === 0 && a[i - 1].pins[13].level === 1).map((r) => r.t / 1000);
  assert.ok(ups.length >= 4, 'four blinks in three seconds');
  near(downs[0] - ups[0], 500, 1, 'on for 500 ms');
  near(ups[1] - downs[0], 250, 1, 'off for 250 ms');
  near(S.vm.t / 1000, 3000, 1, 'three simulated seconds');
});

test('the sketch: digitalRead with a pull-up, analogRead of a pot, Serial', () => {
  const code = 'void setup() {\n  Serial.begin(9600);\n  pinMode(2, INPUT_PULLUP);\n}\nvoid loop() {\n  Serial.print(digitalRead(2));\n  Serial.print(" ");\n  Serial.println(analogRead(A0));\n  delay(100);\n}\n';
  const spec = B.normSpec({ arduino: true, parts: [{ id: 'POT1', type: 'pot', at: ['h5', 'h6', 'h7'], knob: 0.25 }, { id: 'BTN1', type: 'button', at: ['f12', 'f14'] }],
    wires: [{ from: '5V', to: 'j5' }, { from: 'j6', to: 'A0' }, { from: 'j7', to: 'GND' }, { from: 'D2', to: 'j12' }, { from: 'j14', to: 'GND' }], code });
  const S = B.session(B.bench(spec, B.startBuild(spec)));
  S.run(250);
  S.set('press', 'BTN1', true);
  S.run(200);
  const lines = S.serial.trim().split('\n');
  assert.equal(lines[0], '1 767', 'released: the pull-up reads HIGH; the pot a quarter turned from 5 V reads 3.75 V');
  assert.equal(lines[lines.length - 1], '0 767', 'pressed: the button pulls pin 2 to GND');
});

test('the sketch: the C subset (types, arrays, functions, switch, #define)', () => {
  const S = run(`#define N 3
const int pins[] = {2, 3, 4};
int square(int x) { return x * x; }
void setup() {
  Serial.begin(9600);
  int total = 0;
  for (int i = 0; i < N; i++) total += pins[i];
  Serial.println(total);
  Serial.println(sizeof(pins) / sizeof(pins[0]));
  Serial.println(square(12));
  int big = 32767; big++; Serial.println(big);
  float f = 7 / 2; Serial.println(f);
  Serial.println(7 / 2.0, 3);
  Serial.println(255, HEX);
  switch (total % 3) { case 0: Serial.println("zero"); break; default: Serial.println("other"); }
  Serial.println(map(512, 0, 1023, 0, 255));
}
void loop() {}`, 100);
  assert.equal(S.serial, '9\n3\n144\n-32768\n3.00\n3.500\nFF\nzero\n127\n');
});

test('the sketch: errors in plain words, with a line number', () => {
  const err = (code) => { try { B.compile(code); return null; } catch (e) { assert.ok(e instanceof B.SketchError, String(e)); return e; } };
  let e = err('void setup() {\n  pinMode(13, OUTPUT)\n  digitalWrite(13, HIGH);\n}\nvoid loop() {}');
  assert.equal(e.code, 'semi'); assert.equal(e.line, 2);
  e = err('void setup() {\n  pinMod(13, OUTPUT);\n}\nvoid loop() {}');
  assert.equal(e.code, 'suggest'); assert.match(e.message, /Line 2: pinMod\(\) isn't known\. Did you mean pinMode\(\)\?/);
  assert.equal(err('void loop() {}').code, 'nosetup');
  assert.equal(err('void setup() {\n  digitalWrite(13);\n}\nvoid loop() {}').code, 'args');
  e = err('void setup() {\n  if (1) {\n}\nvoid loop() {}');
  assert.equal(e.code, 'nested'); assert.equal(e.line, 4, 'a } is missing above loop()');
  assert.equal(err('void setup() {\n  if (1) {\n  }\n').code, 'brace');
  assert.equal(err('void setup() {\n  Serial.println(“hi”);\n}\nvoid loop() {}').code, 'quote');
  assert.equal(err('void setup() {\n  const int a = 1;\n  a = 2;\n}\nvoid loop() {}').code, 'constant');
  // at run time: outside an array, division by zero, endless recursion
  assert.equal(run('int a[3];\nvoid setup() {\n  for (int i = 0; i <= 3; i++) a[i] = i;\n}\nvoid loop() {}', 100).vm.error.code, 'index');
  assert.equal(run('void setup() {\n  int z = 0;\n  int q = 5 / z;\n}\nvoid loop() {}', 100).vm.error.code, 'div0');
  assert.equal(run('int f(int n) { return f(n + 1); }\nvoid setup() { f(0); }\nvoid loop() {}', 100).vm.error.code, 'deep');
  // a loop with no delay still lets simulated time run, and stops at its budget
  const S = run('long n = 0;\nvoid setup() {}\nvoid loop() { n++; }', 2000);
  assert.ok(S.vm.t >= 2e6 && !S.vm.error);
});

test('the sketch: PWM is an average brightness; a pin with no resistor is too much for it', () => {
  const led = (code) => {
    const spec = B.normSpec({ arduino: true, parts: [{ id: 'R1', type: 'resistor', ohms: 220, at: ['h4', 'h8'] }, { id: 'L1', type: 'led', at: ['g8', 'g9'] }], wires: [{ from: 'D9', to: 'j4' }, { from: 'j9', to: 'GND' }], code }, { loose: true });
    const S = B.session(B.bench(spec, B.startBuild(spec)));
    S.run(200);
    return S.view().parts.L1.I;
  };
  const full = led('void setup() { analogWrite(9, 255); }\nvoid loop() {}');
  const quarter = led('void setup() { analogWrite(9, 64); }\nvoid loop() {}');
  near(quarter / full, 64 / 255, 0.01, 'a quarter duty, a quarter of the current on average');
  const spec = B.normSpec({ arduino: true, parts: [{ id: 'L1', type: 'led', at: ['g8', 'g9'] }], wires: [{ from: 'D13', to: 'j8' }, { from: 'j9', to: 'GND' }], code: 'void setup() { pinMode(13, OUTPUT); digitalWrite(13, HIGH); }\nvoid loop() {}' });
  const S = B.session(B.bench(spec, B.startBuild(spec)));
  S.run(100);
  const v = S.view();
  assert.ok(v.parts.L1.burn, 'straight from a pin: it burns');
  assert.deepEqual(v.overload, [13], 'and pin 13 gives too much');
});

// every goal type: the server proves a reference build from the bin works, and the bench doesn't start done
const GOALS = [
  [{ battery: '9V', bin: { led: ['red'], resistor: [470] } }, { type: 'light' }],
  [{ battery: '9V', bin: { led: ['red', 'green'], resistor: [220] } }, { type: 'series', count: 2 }],
  [{ battery: '9V', bin: { led: ['red', 'green'], resistor: [470, 470] } }, { type: 'parallel', count: 2 }],
  [{ battery: '9V', bin: { led: ['red'], resistor: [470], button: 1 } }, { type: 'button' }],
  [{ battery: '9V', bin: { led: ['red'], resistor: [470], button: 1 } }, { type: 'button', when: 'released' }],
  [{ battery: '9V', bin: { led: ['red'], resistor: [470], switch: 1 } }, { type: 'switch' }],
  [{ battery: '9V', bin: { led: ['red'], resistor: [330], pot: 1 } }, { type: 'dimmer', by: 'pot' }],
  [{ battery: '9V', bin: { led: ['red'], resistor: [4700], ldr: 1 } }, { type: 'dimmer', by: 'ldr', lit: 'dark' }],
  [{ battery: '9V', bin: { buzzer: 1, button: 1 } }, { type: 'button', part: 'buzzer' }],
  [{ battery: '9V', motor: true }, { type: 'light', part: 'motor' }],
  [{ battery: '9V', bin: { led: ['red'], resistor: ['any'] } }, { type: 'light', ohms: 330 }],
  [{ arduino: true, bin: { led: ['red'], resistor: [220] } }, { type: 'blink', pin: 13, on_ms: 500, off_ms: 500 }],
  [{ arduino: true, bin: { led: ['red'], resistor: [220], button: 1 } }, { type: 'button', pin: 2, led_pin: 9 }],
  [{ arduino: true, bin: { led: ['red'], resistor: [220], pot: 1 } }, { type: 'dimmer', by: 'pot', pin: 'A0', led_pin: 9 }],
  [{ arduino: true, bin: { led: ['red'], resistor: [220, 10000], ldr: 1 } }, { type: 'dimmer', by: 'ldr', lit: 'dark', pin: 'A0', led_pin: 9 }],
  [{ arduino: true }, { type: 'serial', text: 'Hello, world' }]
];
test('goals: every type has a reference build that the simulator proves', () => {
  for (const [s, g] of GOALS) {
    const t = B.normTask(s, g);
    const spec = B.normSpec(t.spec);
    const goal = B.normGoal(t.goal, spec);
    const ref = B.reference(spec, goal);
    assert.ok(ref.build, `${JSON.stringify(g)}: ${ref.reason}`);
    assert.equal(B.check(spec, goal, ref.build).correct, true, JSON.stringify(g));
    assert.equal(bb.why(s, g), '', 'why() agrees');
  }
});

test('goals: the learner\'s own build is checked, whatever holes and ids', () => {
  const spec = B.normSpec({ battery: '9V', bin: { led: ['red', 'red'], resistor: [10, 470, 470] } });
  const light = B.normGoal({ type: 'light' }, spec);
  const build = (ohms, at) => ({ parts: [{ id: 'X7', type: 'resistor', ohms, at: ['c20', 'c24'] }, { id: 'Q', type: 'led', color: 'red', at }], wires: [{ from: 'BAT+', to: '+T21' }, { from: '+T20', to: 'a20' }, { from: 'a25', to: 'BAT-' }] });
  assert.equal(B.check(spec, light, build(470, ['b24', 'b25'])).correct, true);
  let r = B.check(spec, light, build(10, ['b24', 'b25']));
  assert.equal(r.correct, false); assert.equal(r.why.code, 'burn');
  r = B.check(spec, light, build(470, ['b25', 'b24']));
  assert.equal(r.why.code, 'reversed');
  r = B.check(spec, light, build(470, ['b26', 'b27']));
  assert.equal(r.why.code, 'alone', 'a leg in a strip with nothing else');
  assert.equal(B.check(spec, light, { parts: [], wires: [] }).invalid, true, 'nothing built: not an attempt');
  assert.equal(B.check(spec, light, { parts: [{ type: 'led', color: 'blue', at: ['a1', 'a2'] }] }).invalid, true, 'a part not in the bin');
  // series against parallel: the same two LEDs and resistors, wired the other way
  const two = B.normSpec({ battery: '9V', bin: { led: ['red', 'red'], resistor: [470, 470] } });
  const par = { parts: [
    { type: 'resistor', ohms: 470, at: ['h3', 'h7'] }, { type: 'led', color: 'red', at: ['g7', 'g8'] },
    { type: 'resistor', ohms: 470, at: ['h13', 'h17'] }, { type: 'led', color: 'red', at: ['g17', 'g18'] }
  ], wires: [{ from: 'BAT+', to: '+B2' }, { from: 'BAT-', to: '-B2' }, { from: '+B3', to: 'j3' }, { from: 'j8', to: '-B8' }, { from: '+B14', to: 'j13' }, { from: 'j18', to: '-B18' }] };
  assert.equal(B.check(two, B.normGoal({ type: 'parallel', count: 2 }, two), par).correct, true);
  assert.equal(B.check(two, B.normGoal({ type: 'series', count: 2 }, two), par).why.code, 'notseries');
  // a blink with the wrong timing, and with the LED on another pin
  const ard = B.normSpec({ arduino: true, bin: { led: ['red'], resistor: [220] } });
  const blink = B.normGoal({ type: 'blink', pin: 13, on_ms: 1000, off_ms: 1000 }, ard);
  const wired = (pin, on, off) => ({ parts: [{ type: 'resistor', ohms: 220, at: ['h4', 'h8'] }, { type: 'led', color: 'red', at: ['g8', 'g9'] }], wires: [{ from: 'D' + pin, to: 'j4' }, { from: 'j9', to: 'GND' }],
    code: `void setup() { pinMode(${pin}, OUTPUT); }\nvoid loop() { digitalWrite(${pin}, HIGH); delay(${on}); digitalWrite(${pin}, LOW); delay(${off}); }` });
  assert.equal(B.check(ard, blink, wired(13, 1000, 1000)).correct, true);
  r = B.check(ard, blink, wired(13, 1000, 500));
  assert.equal(r.why.code, 'blinktime'); assert.equal(r.why.off, 500);
  assert.equal(B.check(ard, blink, wired(12, 1000, 1000)).why.code, 'pinout');
  r = B.check(ard, blink, Object.assign(wired(13, 1000, 1000), { code: 'void setup() {\n  pinMode(13 OUTPUT);\n}\nvoid loop() {}' }));
  assert.equal(r.invalid, true); assert.equal(r.why.code, 'sketch', 'a sketch that does not compile is not an attempt');
});

test('server: blocks and tasks are checked; why() says what to repair', () => {
  assert.ok(KINDS.includes('breadboard'));
  // the prompt's own examples hold
  const blk = JSON.parse(bb.prompt.match(/Block example: (\{.*\})\n/)[1]);
  assert.ok(normWidgetBlock(blk), 'the block example');
  const tks = bb.prompt.split('Task examples: ')[1].split('\n').map((s) => JSON.parse(s));
  assert.ok(tks.length >= 2 && new Set(tks.map((x) => x.goal.type)).size === tks.length, 'the task examples are of different kinds');
  for (const tk of tks) assert.ok(normTask(tk, { prompt: tk.prompt, hint: '', explain: '' }), 'the task example ' + tk.goal.type);
  assert.ok(bb.prompt.length <= 4000, `the prompt is short (${bb.prompt.length})`);
  assert.match(widgetPrompt(['breadboard']), /Breadboard \("kind": "breadboard"\)/);
  // a block that can never work is left out, with a reason the AI can act on
  const dead = { battery: '9V', parts: [{ id: 'R1', type: 'resistor', ohms: 470, at: ['h3', 'h7'] }, { id: 'L1', type: 'led', at: ['g8', 'g9'] }], wires: [{ from: 'BAT+', to: 'j3' }, { from: 'j9', to: 'BAT-' }] };
  assert.equal(bb.block(dead), null);
  assert.match(bb.why(dead), /strip with nothing else/);
  assert.match(bb.why({ battery: '9V', parts: [{ id: 'L1', type: 'led', at: ['a5', 'b5'] }] }), /two legs in one strip/);
  assert.match(bb.why({ battery: '9V', parts: [{ id: 'L1', type: 'led', at: ['a5', 'a9'] }] }), /1 to 3 apart/);
  // what the AI means is read kindly: "5V" power is the Arduino's, and wires to its pins bring it
  const usb = B.normSpec({ battery: '5V', bin: { led: 1 }, wires: [{ from: 'D13', to: 'a1' }] });
  assert.equal(usb.arduino, true); assert.equal(usb.battery, null);
  assert.equal(B.normSpec({ bin: { led: 1 }, wires: [{ from: 'BAT+', to: 'a1' }] }).battery, '9V');
  // but an LED across the centre gap from its resistor, or a sketch working a pin nothing is wired to, is named
  const gap = { battery: '5V', parts: [{ id: 'R1', type: 'resistor', ohms: 220, at: ['e3', 'e7'] }, { id: 'L1', type: 'led', at: ['f7', 'f8'] }], wires: [{ from: '5V', to: 'a3' }, { from: 'j8', to: 'GND' }] };
  assert.match(bb.why(gap), /L1's leg in f7 and R1's leg in e7 are on opposite sides of the centre gap/);
  // a wire end written into a leg's hole, or across the gap from the leg it is meant for, is moved where it belongs
  const fixed = B.normSpec({ battery: '9V', parts: [{ id: 'R1', type: 'resistor', ohms: 470, at: ['a1', 'a5'] }, { id: 'L1', type: 'led', at: ['b5', 'b6'] }], wires: [{ from: 'BAT+', to: 'a1' }, { from: 'f6', to: 'BAT-' }] });
  assert.equal(B.HOLES.get(fixed.wires[0].to).strip, 'U1', 'into another hole of the strip');
  assert.equal(B.HOLES.get(fixed.wires[1].from).strip, 'U6', 'onto the LED\'s side of the gap');
  assert.ok(B.session(B.bench(fixed, B.startBuild(fixed))).view().parts.L1.lit);
  // a block wired to a pin, with no sketch: the reason says what to add
  assert.match(bb.why({ arduino: true, parts: [{ id: 'R1', type: 'resistor', ohms: 220, at: ['h4', 'h8'] }, { id: 'L1', type: 'led', at: ['g8', 'g9'] }], wires: [{ from: 'D13', to: 'j4' }, { from: 'j9', to: 'GND' }] }), /no "code" to turn that pin on/);
  const idle = { arduino: true, parts: [{ id: 'R1', type: 'resistor', ohms: 220, at: ['e3', 'e7'] }, { id: 'L1', type: 'led', at: ['d7', 'd8'] }], wires: [{ from: '5V', to: 'a3' }, { from: 'a8', to: 'GND' }], code: 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }' };
  assert.match(bb.why(idle), /the sketch works pin 13, but nothing on the bench is wired to it/);
  assert.match(bb.why({ battery: '9V', bin: { led: ['red'], resistor: [470] } }, { type: 'button' }), /needs a push button but the parts bin has none/);
  assert.match(bb.why({ battery: '9V', bin: { led: ['red'] } }, { type: 'light' }), /no resistor/);
  assert.match(bb.why({ battery: '3V', bin: { led: ['red', 'red'], resistor: [100] } }, { type: 'series', count: 2 }), /too weak/);
  assert.match(bb.why({ arduino: true, bin: { led: ['red'], resistor: [220] }, code: 'void setup() {}\nvoid loop() {}' }, { type: 'blink', pin: 13 }), /^$/);
  assert.match(bb.why({ arduino: true, bin: { led: ['red'], resistor: [220] }, code: 'void setup() {\n  x = 1;\n}\nvoid loop() {}' }, { type: 'blink' }), /starter code has an error: Line 2/);
  const done = { battery: '9V', parts: [{ id: 'R1', type: 'resistor', ohms: 470, at: ['h6', 'h10'] }, { id: 'L1', type: 'led', at: ['g10', 'g11'] }], wires: [{ from: 'BAT+', to: 'j6' }, { from: 'j11', to: 'BAT-' }] };
  assert.match(bb.why(done, { type: 'light' }), /already meets the goal/);
  assert.equal(bb.task(done, { type: 'light' }), null);
  // what comes out reads back the same
  const t = bb.task({ battery: '9V', bin: { leds: { red: 2 }, resistors: ['470', '1k'] } }, { type: 'parallel' });
  assert.deepEqual(t.spec.bin, { led: ['red', 'red'], resistor: [470, 1000] });
  assert.deepEqual(B.specOut(B.normSpec(t.spec)), t.spec);
});

test('server: match() finds lessons on building circuits, in the app\'s languages', () => {
  const yes = ['Arduino for beginners: blinking an LED', 'Class 8: electric circuits with LEDs', 'Robotics club: sensors and motors', 'Basic electronics', 'Build a circuit with a battery and a switch',
    'Resistor colour code', 'एलईडी और परिपथ', 'अर्डुइनो से शुरुआत', 'ब्रेडबोर्ड पर सर्किट', 'ইলেকট্রনিক্স', 'மின்சுற்று', 'ఆర్డునో', 'Electrónica básica con Arduino', 'Électronique : la LED', 'Светодиод и резистор', 'دائرة كهربائية بسيطة'];
  const no = ['Chemistry of acids and bases', 'Current affairs: the series of elections', 'World War 2: the generals who led armies', 'Cell biology', 'Parallel lines and angles'];
  yes.forEach((s) => assert.ok(bb.match(s.toLowerCase()), s));
  no.forEach((s) => assert.ok(!bb.match(s.toLowerCase()), s));
  assert.ok(widgetKinds({ topic: 'Arduino for beginners' }).includes('breadboard'));
});

/* ---------------- the new parts ---------------- */

// a bench and its build, ready to run (spec read loosely)
const make = (raw) => { const spec = B.normSpec(raw, { loose: true }); const b = B.bench(spec, B.startBuild(spec)); if (b.codeError) throw b.codeError; return b; };
const sketch = (code, raw) => { const S = B.session(make(Object.assign({ arduino: true, code }, raw || {}))); return S; };

test('the NPN transistor: cut off, active (Ic = beta Ib) and saturated, by Newton steps', () => {
  // 9 V through 1k to the collector; the base fed through rb from 9 V (or tied to ground)
  const q = (rb) => B.session(make({ battery: '9V', parts: [
    { id: 'Q1', type: 'npn', at: ['h10', 'h11', 'h12'] }, { id: 'RC', type: 'resistor', ohms: 1000, at: ['g12', 'g16'] },
    ...(rb ? [{ id: 'RB', type: 'resistor', ohms: rb, at: ['g11', 'g4'] }] : [])
  ], wires: [['BAT+', 'j16'], ['j10', 'BAT-']].concat(rb ? [['BAT+', 'j4']] : [['j11', 'BAT-']]) })).view().parts.Q1;
  const off = q(0);
  assert.ok(Math.abs(off.ic) < 1e-6 && !off.on, 'no base current: cut off');
  const act = q(1e6);
  near(act.ic / act.ib, 150, 2, 'active: Ic is beta times Ib');
  assert.ok(act.vce > 5 && act.on && !act.sat, `active: Vce well above 0 (${act.vce})`);
  const sat = q(10000);
  assert.ok(sat.sat && sat.vce < 0.2, `saturated: Vce near 0 (${sat.vce})`);
  near(sat.ic, (9 - sat.vce) / 1001.5, 2e-4, 'saturated: the collector resistor sets the current');
  assert.ok(sat.ic / sat.ib < 30, 'saturated: far less than beta');
  // a pin switching the motor through the transistor and a 1k base resistor: on with the pin, off without
  const S = sketch('void setup() { pinMode(9, OUTPUT); digitalWrite(9, HIGH); }\nvoid loop() {}', { battery: '9V', motor: true, parts: [
    { id: 'Q1', type: 'npn', at: ['h10', 'h11', 'h12'] }, { id: 'R1', type: 'resistor', ohms: 1000, at: ['g6', 'g11'] }, { id: 'D1', type: 'diode', at: ['d24', 'd20'] }
  ], wires: [['BAT+', 'a20'], ['b20', 'M+'], ['M-', 'a24'], ['c24', 'j12'], ['D9', 'j6'], ['j10', 'GND'], ['BAT-', 'GND']] });
  S.run(20);
  const v = S.view();
  assert.ok(v.parts.MOTOR.on && v.parts.Q1.sat, 'the motor runs');
  assert.ok(v.pinI[9] < 0.006 && !v.overload.length, `the pin gives only the base current (${v.pinI[9] * 1000} mA)`);
  assert.ok(Math.abs(v.parts.D1.I) < 1e-6, 'the flyback diode is reverse-biased while the motor runs');
  assert.equal(S.view({ pins: S.pins.map((p, i) => (i === 9 ? { mode: 1, level: 0, duty: null } : p)) }).parts.MOTOR.on, false, 'pin low: the motor stops');
  // the MOSFET: 5 V on its gate lets the motor run
  const M = sketch('void setup() { pinMode(6, OUTPUT); digitalWrite(6, HIGH); }\nvoid loop() {}', { motor: true, parts: [{ id: 'Q1', type: 'mosfet', at: ['h10', 'h11', 'h12'] }, { id: 'R1', type: 'resistor', ohms: 220, at: ['g6', 'g10'] }],
    wires: [['5V', 'M+'], ['M-', 'j11'], ['D6', 'j6'], ['j12', 'GND']] });
  M.run(20);
  assert.ok(M.view().parts.MOTOR.on && M.view().parts.Q1.on);
});

test('diodes: a rectifier drops about 0.65 V forward and blocks backward; a Zener holds its voltage', () => {
  const d = (at) => B.session(make({ battery: '9V', parts: [{ id: 'R1', type: 'resistor', ohms: 1000, at: ['h3', 'h7'] }, { id: 'D1', type: 'diode', at }], wires: [['BAT+', 'j3'], ['j11', 'BAT-']] })).view();
  let v = d(['g7', 'g11']);
  near(v.volt('g7') - v.volt('g11'), 0.65 + 0.4 * v.parts.D1.I, 1e-3, 'forward drop');
  near(v.parts.D1.I, (9 - 0.65) / 1001.9, 2e-4);
  v = d(['g11', 'g7']);
  assert.ok(Math.abs(v.parts.D1.I) < 1e-6, 'backwards: no current');
  // a 5.1 V Zener across the output of a 470 ohm resistor from 9 V
  v = B.session(make({ battery: '9V', parts: [{ id: 'R1', type: 'resistor', ohms: 470, at: ['h3', 'h7'] }, { id: 'Z1', type: 'zener', volts: 5.1, at: ['g11', 'g7'] }], wires: [['BAT+', 'j3'], ['j11', 'BAT-']] })).view();
  near(v.volt('h7') - v.volt('g11'), 5.1 + 5 * Math.abs(v.parts.Z1.I), 0.01, 'the Zener holds about 5.1 V');
});

test('capacitors: RC charging reaches 63% in one time constant, and an LED fades out after its switch opens', () => {
  // 10k and 100 uF: RC = 1 s
  const S = B.session(make({ battery: '9V', parts: [{ id: 'R1', type: 'resistor', ohms: 10000, at: ['h3', 'h7'] }, { id: 'C1', type: 'electrolytic', uf: 100, at: ['g7', 'g8'] }], wires: [['BAT+', 'j3'], ['j8', 'BAT-']] }));
  assert.equal(S.view().short, false, 'an empty capacitor is not a short circuit');
  S.run(1000);
  const top = 9 * 10000 / 10001.5;
  near(S.view().parts.C1.vc / top, 1 - Math.exp(-1), 0.01, '63% after RC');
  S.run(4000);
  near(S.view().parts.C1.vc / top, 1 - Math.exp(-5), 0.01, 'nearly full after 5 RC');
  // the LED keeps glowing from the capacitor, dimmer and dimmer, then goes out
  const F = B.session(make({ battery: '9V', parts: [{ id: 'SW1', type: 'switch', at: ['h3', 'h4', 'h5'], on: true }, { id: 'C1', type: 'electrolytic', uf: 1000, at: ['f4', 'f6'] }, { id: 'R1', type: 'resistor', ohms: 470, at: ['g4', 'g9'] }, { id: 'L1', type: 'led', at: ['h9', 'h10'] }],
    wires: [['BAT+', 'j3'], ['j6', 'BAT-'], ['j10', 'BAT-']] }));
  F.run(2000);
  const on = F.view().parts.L1.I;
  F.set('on', 'SW1', false);
  F.run(300);
  const mid = F.view().parts.L1.I;
  assert.ok(mid > 0.001 && mid < on, 'still lit, and dimmer, 300 ms after the switch opens');
  F.run(4000);
  assert.equal(F.view().parts.L1.lit, false, 'out in the end');
  // an electrolytic the wrong way round is a fault, named as the bench starts
  const bad = { battery: '9V', parts: [{ id: 'C1', type: 'electrolytic', uf: 100, at: ['h5', 'h6'] }], wires: [['BAT+', 'j6'], ['j5', 'BAT-']] };
  assert.equal(B.session(make(bad)).view().parts.C1.fault, true);
  assert.match(bb.why(bad), /C1 is the wrong way round/);
  // a debounce: a capacitor slows the pin's rise when the button is let go
  const D = sketch('void setup() { pinMode(2, INPUT_PULLUP); }\nvoid loop() {}', { parts: [{ id: 'BTN1', type: 'button', at: ['f12', 'f14'] }, { id: 'C1', type: 'capacitor', uf: 1, at: ['g12', 'g14'] }], wires: [['D2', 'j12'], ['j14', 'GND']] });
  D.run(200); D.set('press', 'BTN1', true); D.run(50); D.set('press', 'BTN1', false); D.run(5);
  const v5 = D.view().volt('D2');
  D.run(100);
  assert.ok(v5 < 1.5 && D.view().volt('D2') > 4.5, `the pin rises slowly through the pull-up and the capacitor (${v5} V after 5 ms)`);
});

test('the servo: attach() and write() turn it smoothly; read() gives the angle back', () => {
  const S = sketch('#include <Servo.h>\nServo arm;\nvoid setup() { Serial.begin(9600); arm.attach(9); arm.write(30); Serial.println(arm.read()); }\nvoid loop() {}',
    { parts: [{ id: 'SV1', type: 'servo' }], wires: [['servo.brown', 'GND'], ['SV1.red', '5V'], ['sv1:signal', 'D9']] });
  S.run(20);
  assert.ok(S.servo.SV1 < 90 && S.servo.SV1 > 60, `turning, not there yet (${S.servo.SV1})`);
  S.run(500);
  near(S.servo.SV1, 30, 0.5, 'at 30 degrees');
  assert.equal(S.serial.trim(), '30');
  assert.equal(S.pins[9].duty < 0.1 && S.pins[9].servo > 500, true, 'the pin carries the pulses');
  // no power: it doesn't move
  const N = sketch('#include <Servo.h>\nServo arm;\nvoid setup() { arm.attach(9); arm.write(0); }\nvoid loop() {}', { parts: [{ id: 'SV1', type: 'servo' }], wires: [['SV1.SIG', 'D9']] });
  N.run(500);
  assert.equal(N.servo.SV1, 90);
  // the library must be included
  assert.throws(() => B.compile('Servo arm;\nvoid setup() {}\nvoid loop() {}'), /Servo needs #include <Servo.h>/);
  assert.throws(() => B.compile('#include <Stepper.h>\nvoid setup() {}\nvoid loop() {}'), /no Stepper.h library on this bench/);
});

test('the HC-SR04: a 10 us trigger, and pulseIn() times the echo by the distance', () => {
  const code = 'void setup() { Serial.begin(9600); pinMode(9, OUTPUT); pinMode(10, INPUT); }\nvoid loop() { digitalWrite(9, HIGH); delayMicroseconds(10); digitalWrite(9, LOW); long us = pulseIn(10, HIGH); Serial.println(us); delay(100); }';
  const S = sketch(code, { parts: [{ id: 'US1', type: 'sonar', cm: 50 }], wires: [['US1.VCC', '5V'], ['US1.GND', 'GND'], ['US1.TRIG', 'D9'], ['US1.ECHO', 'D10']] });
  S.run(150);
  near(Number(S.serial.trim().split('\n')[0]), 50 * 58.3, 2, 'the echo lasts 58 us a centimetre');
  S.set('cm', 'US1', 200);
  S.run(300);
  const lines = S.serial.trim().split('\n');
  near(Number(lines[lines.length - 1]) * 0.0343 / 2, 200, 1, 'and measures the new distance');
  // with no trigger pulse, pulseIn() waits its timeout and gives 0
  const T = sketch('void setup() { Serial.begin(9600); Serial.println(pulseIn(10, HIGH, 20000)); }\nvoid loop() {}', { parts: [{ id: 'US1', type: 'sonar' }], wires: [['US1.VCC', '5V'], ['US1.GND', 'GND'], ['US1.ECHO', 'D10']] });
  T.run(100);
  assert.equal(T.serial.trim(), '0');
});

test('the 7-segment display shows digits by its segments\' own currents, common cathode or anode', () => {
  const wires = [['a13', 'D2'], ['a14', 'D3'], ['j13', 'D4'], ['j11', 'D5'], ['j10', 'D6'], ['a11', 'D7'], ['a10', 'D8']];
  const show = (digit, common) => {
    const S = B.session(make({ arduino: true, parts: [{ id: 'DSP1', type: 'seg7', at: 'c10', common }, { id: 'R1', type: 'resistor', ohms: 220, at: ['a12', 'a16'] }], wires: wires.concat([['b16', common === 'anode' ? '5V' : 'GND']]),
      code: `const byte d[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};\nvoid setup() { for (int s = 0; s < 7; s++) { pinMode(2 + s, OUTPUT); digitalWrite(2 + s, ${common === 'anode' ? '!' : ''}bitRead(d[${digit}], s)); } }\nvoid loop() {}` }));
    S.run(20);
    return S.view().parts.DSP1;
  };
  for (const d of [0, 1, 4, 7, 8]) assert.equal(show(d, 'cathode').digit, d, 'common cathode: ' + d);
  assert.equal(show(2, 'anode').digit, 2, 'common anode: segments light when their pin is LOW');
  const eight = show(8, 'cathode');
  assert.ok(Object.values(eight.segs).filter((s) => s.lit).length === 7 && eight.segs.a.I < show(1, 'cathode').segs.b.I, 'seven segments share the one resistor: each is dimmer');
  // the 10 pins, from the first: the display straddles the centre gap
  assert.deepEqual(B.normSpec({ arduino: true, parts: [{ type: 'seg7', at: 'c10' }] }, { loose: true }).parts[0].at, ['c10', 'c11', 'c12', 'c13', 'c14', 'h10', 'h11', 'h12', 'h13', 'h14']);
  assert.throws(() => B.normSpec({ arduino: true, parts: [{ type: 'seg7', at: 'g10' }] }), /doesn't fit/);
});

test('the 16x2 I2C LCD: init, backlight, setCursor and print, on A4 and A5', () => {
  const code = '#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\nLiquidCrystal_I2C lcd(0x27, 16, 2);\nvoid setup() { lcd.init(); lcd.backlight(); lcd.print("Hello"); lcd.setCursor(3, 1); lcd.print(42); lcd.print(" C"); }\nvoid loop() {}';
  const wires = [['LCD1.GND', 'GND'], ['LCD1.VCC', '5V'], ['LCD1.SDA', 'A4'], ['LCD1.SCL', 'A5']];
  let S = sketch(code, { parts: [{ id: 'LCD1', type: 'lcd' }], wires });
  S.run(200);
  assert.deepEqual(S.lcdText('LCD1'), ['Hello           ', '   42 C         ']);
  assert.equal(S.lcd.LCD1.light, true);
  // SDA and SCL swapped: it hears nothing
  S = sketch(code, { parts: [{ id: 'LCD1', type: 'lcd' }], wires: wires.slice(0, 2).concat([['LCD1.SDA', 'A5'], ['LCD1.SCL', 'A4']]) });
  S.run(200);
  assert.equal(S.lcdText('LCD1').join('').trim(), '');
  // a wrong method is named
  assert.throws(() => B.compile('#include <LiquidCrystal_I2C.h>\nLiquidCrystal_I2C lcd(0x27, 16, 2);\nvoid setup() { lcd.show("x"); }\nvoid loop() {}'), /a LiquidCrystal_I2C has no show\(\) function/);
});

test('the relay module switches a separate circuit, with a click; the PIR and the TMP36 and DHT11 read their world', () => {
  const S = sketch('void setup() { pinMode(7, OUTPUT); }\nvoid loop() { digitalWrite(7, HIGH); delay(500); digitalWrite(7, LOW); delay(500); }', { battery: '9V', motor: true, parts: [{ id: 'RLY1', type: 'relay' }],
    wires: [['RLY1.IN', 'D7'], ['RLY1.VCC', '5V'], ['RLY1.GND', 'GND'], ['RLY1.COM', 'BAT+'], ['RLY1.NO', 'M+'], ['M-', 'BAT-']] });
  S.run(100);
  assert.ok(S.view().parts.RLY1.on && S.view().parts.MOTOR.on, 'IN high: the coil pulls COM to NO, the motor runs');
  assert.ok(S.view().pinI[7] < 0.005, 'the pin only drives the module\'s input');
  S.run(500);
  assert.ok(!S.view().parts.RLY1.on && !S.view().parts.MOTOR.on, 'IN low: back to NC, the motor stops');
  assert.ok(S.clicks >= 2, 'it clicked each time');
  // the PIR's output follows motion; the TMP36 gives 10 mV a degree over 0.5 V; the DHT11 its whole degrees
  const P = sketch('#include <DHT.h>\nDHT dht(4, DHT11);\nvoid setup() { Serial.begin(9600); dht.begin(); }\nvoid loop() { Serial.print(digitalRead(2)); Serial.print(" "); Serial.print(analogRead(A0)); Serial.print(" "); Serial.print(dht.readTemperature(), 0); Serial.print(" "); Serial.println(dht.readHumidity(), 0); delay(2500); }',
    { parts: [{ id: 'PIR1', type: 'pir' }, { id: 'T1', type: 'tmp36', at: ['h3', 'h4', 'h5'], temp: 25 }, { id: 'DHT1', type: 'dht11', temp: 31, hum: 70 }],
      wires: [['PIR1.VCC', '5V'], ['PIR1.GND', 'GND'], ['PIR1.OUT', 'D2'], ['5V', 'j3'], ['j4', 'A0'], ['j5', 'GND'], ['DHT1.VCC', '5V'], ['DHT1.GND', 'GND'], ['DHT1.DATA', 'D4']] });
  P.run(100);
  P.set('motion', 'PIR1', true);
  P.set('temp', 'T1', 40);
  P.run(2600);
  const [first, second] = P.serial.trim().split('\n');
  assert.equal(first, `0 ${Math.round(0.75 / 5 * 1023)} 31 70`);
  assert.equal(second, `1 ${Math.round(0.9 / 5 * 1023)} 31 70`);
});

test('interrupts on pin 2: FALLING runs the function at once, and a button\'s contacts bounce', () => {
  const S = sketch('volatile int n = 0;\nvoid hit() { n++; }\nvoid setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(2), hit, FALLING); }\nvoid loop() { Serial.println(n); delay(1000); }',
    { parts: [{ id: 'BTN1', type: 'button', at: ['f12', 'f14'] }], wires: [['D2', 'j12'], ['j14', 'GND']] });
  S.run(100);
  S.set('press', 'BTN1', true);
  S.run(100);
  S.set('press', 'BTN1', false);
  S.run(1000);
  const n = Number(S.serial.trim().split('\n').pop());
  assert.ok(n >= 2 && n <= 6, `one press, counted more than once: the contacts bounced (${n})`);
  // with a debounce in the function, one press is one count
  const D = sketch('volatile int n = 0;\nunsigned long last = 0;\nvoid hit() { if (millis() - last > 50) { n++; last = millis(); } }\nvoid setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); attachInterrupt(0, hit, FALLING); }\nvoid loop() { Serial.println(n); delay(500); }',
    { parts: [{ id: 'BTN1', type: 'button', at: ['f12', 'f14'] }], wires: [['D2', 'j12'], ['j14', 'GND']] });
  D.run(100); D.set('press', 'BTN1', true); D.run(100); D.set('press', 'BTN1', false); D.run(600);
  assert.equal(D.serial.trim().split('\n').pop(), '1');
  assert.throws(() => B.compile('void f() {}\nvoid setup() { attachInterrupt(digitalPinToInterrupt(2), g, RISING); }\nvoid loop() {}'), /attachInterrupt needs the name of a void function/);
  const bad = sketch('void f() {}\nvoid setup() { attachInterrupt(2, f, RISING); }\nvoid loop() {}');
  bad.run(10);
  assert.equal(bad.vm.error.code, 'intpin', 'attachInterrupt(2, ...) is a common slip: pin 2 is interrupt 0');
});

test('Serial input: available, read, parseInt and readStringUntil, from the send box', () => {
  const S = sketch('void setup() { Serial.begin(9600); }\nvoid loop() { if (Serial.available() > 0) { int a = Serial.parseInt(); int b = Serial.parseInt(); Serial.println(a + b); } }');
  S.run(50);
  S.send('12 30\n');
  S.run(100);
  assert.equal(S.serial, '42\n');
  const R = sketch('String who;\nvoid setup() { Serial.begin(9600); }\nvoid loop() { if (Serial.available()) { char c = Serial.read(); Serial.print(c); who = Serial.readStringUntil(\'\\n\'); Serial.println("|" + who + "|"); } }');
  R.run(10);
  R.send('Ravi\n');
  R.run(50);
  assert.equal(R.serial, 'R|avi|\n');
});

test('String: joining, length, toInt, comparing, and its own functions', () => {
  const S = sketch(`String name = "Asha";
String greet(String who) { return "Hi " + who; }
void setup() {
  Serial.begin(9600);
  String s = greet(name) + ", " + 7 + 'x' + 2.5;
  Serial.println(s);
  Serial.println(s.length());
  String n = "123abc";
  Serial.println(n.toInt() + 1);
  if (name == "Asha") Serial.println("same");
  if (name != "Ravi") Serial.println("different");
  name.toUpperCase();
  Serial.println(name + " " + name.substring(1, 3) + " " + name.indexOf("SH") + " " + name.charAt(0));
  String t = "  pad  ";
  t.trim();
  Serial.println("[" + t + "]" + String(255, HEX) + String(3.14159, 3));
}
void loop() {}`);
  S.run(50);
  assert.equal(S.serial, 'Hi Asha, 7x2.50\n15\n124\nsame\ndifferent\nASHA SH 1 A\n[pad]ff3.142\n');
  assert.throws(() => B.compile('String s = "5";\nvoid setup() { int x = s; }\nvoid loop() {}'), /a String is text, not a number: use s\.toInt\(\)/);
  assert.throws(() => B.compile('void setup() { Serial.println("n = " + 5); }\nvoid loop() {}'), /Make one a String/);
  // map, constrain, random (seeded the same each run), abs, min, max
  const M = sketch('void setup() { Serial.begin(9600); randomSeed(7); Serial.println(map(512, 0, 1023, 0, 180)); Serial.println(constrain(300, 0, 255)); Serial.println(abs(-4) + min(3, 9) + max(3, 9)); Serial.println(random(1, 7)); }\nvoid loop() {}');
  M.run(10);
  const lines = M.serial.trim().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['90', '255', '16']);
  assert.ok(Number(lines[3]) >= 1 && Number(lines[3]) < 7);
  const again = sketch('void setup() { Serial.begin(9600); randomSeed(7); Serial.println(map(512, 0, 1023, 0, 180)); Serial.println(constrain(300, 0, 255)); Serial.println(abs(-4) + min(3, 9) + max(3, 9)); Serial.println(random(1, 7)); }\nvoid loop() {}');
  again.run(10);
  assert.equal(again.serial, M.serial, 'the same "random" numbers every run');
});

// the new goals: each has a reference build the simulator proves, and the start doesn't meet it
const GOALS2 = [
  [{ arduino: true, battery: '9V', motor: true, bin: { npn: 1, resistor: [1000], diode: 1 } }, { type: 'motor', pin: 9, flyback: true }],
  [{ arduino: true, motor: true, bin: { mosfet: 1, resistor: [220] } }, { type: 'light', part: 'motor', pin: 6 }],
  [{ arduino: true, battery: '9V', motor: true, bin: { relay: 1 } }, { type: 'relay', pin: 7 }],
  [{ arduino: true, bin: { servo: 1 } }, { type: 'servo', angle: 45 }],
  [{ arduino: true, bin: { servo: 1 } }, { type: 'servo', sweep: true }],
  [{ arduino: true, bin: { seg7: ['cathode'], resistor: [220] } }, { type: 'display', digit: 7 }],
  [{ arduino: true, bin: { seg7: ['anode'], resistor: [330] } }, { type: 'display', digit: 3 }],
  [{ battery: '9V', bin: { seg7: 1, resistor: [1000] } }, { type: 'display', digit: 1 }],
  [{ arduino: true, bin: { lcd: 1 } }, { type: 'lcd', text: 'Hello Class 8' }],
  [{ arduino: true, bin: { sonar: 1, led: ['red'], resistor: [220] } }, { type: 'distance', cm: 20 }],
  [{ arduino: true, motor: true, bin: { tmp36: 1, npn: 1, resistor: [1000], diode: 1 } }, { type: 'temperature', above: 30 }],
  [{ arduino: true, bin: { dht11: 1, led: ['blue'], resistor: [220] } }, { type: 'temperature', above: 28, part: 'led', by: 'dht11' }],
  [{ battery: '9V', bin: { switch: 1, electrolytic: [1000], resistor: [330], led: ['red'] } }, { type: 'fade', ms: 500 }],
  [{ battery: '9V', bin: { button: 1, electrolytic: [470], resistor: [220, 1000], led: ['green'] } }, { type: 'fade', by: 'button', ms: 300 }]
];
test('the new goals: a transistor-driven motor, a servo, the display, the LCD, distance, temperature, a fade', () => {
  for (const [s, g] of GOALS2) {
    const t = B.normTask(s, g);
    const spec = B.normSpec(t.spec);
    const goal = B.normGoal(t.goal, spec);
    const ref = B.reference(spec, goal);
    assert.ok(ref.build, `${JSON.stringify(g)}: ${ref.reason}`);
    assert.equal(B.check(spec, goal, ref.build).correct, true, JSON.stringify(g));
    assert.equal(bb.why(s, g), '', 'why() agrees');
    assert.deepEqual(B.specOut(B.normSpec(t.spec)), t.spec, 'what comes out reads back the same');
  }
});

test('the new goals say what is wrong with a learner\'s build', () => {
  // the motor straight from a pin: too much for the pin
  const ms = B.normSpec({ arduino: true, motor: true, bin: { npn: 1, resistor: [1000] } });
  const mg = B.normGoal({ type: 'motor', pin: 9 }, ms);
  const direct = { parts: [], wires: [['D9', 'M+'], ['M-', 'GND']], code: 'void setup() { pinMode(9, OUTPUT); digitalWrite(9, HIGH); }\nvoid loop() {}' };
  assert.equal(B.check(ms, mg, direct).why.code, 'pin');
  // no base resistor: the pin gives too much
  const nob = { parts: [{ type: 'npn', at: ['h10', 'h11', 'h12'] }], wires: [['D9', 'j11'], ['j10', 'GND'], ['5V', 'M+'], ['M-', 'j12']], code: direct.code };
  assert.equal(B.check(ms, mg, nob).why.code, 'qburn', 'no base resistor: the transistor (and the pin) take far too much');
  // a battery and the Arduino with no common ground
  const bs = B.normSpec({ arduino: true, battery: '9V', motor: true, bin: { npn: 1, resistor: [1000] } });
  const nog = { parts: [{ type: 'npn', at: ['h10', 'h11', 'h12'] }, { type: 'resistor', ohms: 1000, at: ['g6', 'g11'] }], wires: [['D9', 'j6'], ['j10', 'GND'], ['BAT+', 'M+'], ['M-', 'j12']], code: direct.code };
  assert.equal(B.check(bs, B.normGoal({ type: 'motor', pin: 9 }, bs), nog).why.code, 'ground');
  // the servo wired but never given an angle; and given the wrong one
  const ss = B.normSpec({ arduino: true, bin: { servo: 1 } });
  const sg = B.normGoal({ type: 'servo', angle: 120 }, ss);
  const sw = [['SV1.GND', 'GND'], ['SV1.VCC', '5V'], ['SV1.SIG', 'D9']];
  assert.equal(B.check(ss, sg, { parts: [{ id: 'SV1', type: 'servo' }], wires: sw, code: 'void setup() {}\nvoid loop() {}' }).why.code, 'servosig');
  const wrong = B.check(ss, sg, { parts: [{ id: 'SV1', type: 'servo' }], wires: sw, code: '#include <Servo.h>\nServo s;\nvoid setup() { s.attach(9); s.write(60); }\nvoid loop() {}' });
  assert.equal(wrong.why.code, 'servoangle'); assert.equal(wrong.why.at, 60);
  // the LCD with SDA and SCL swapped
  const ls = B.normSpec({ arduino: true, bin: { lcd: 1 } });
  const lw = B.check(ls, B.normGoal({ type: 'lcd', text: 'Hi' }, ls), { parts: [{ id: 'LCD1', type: 'lcd' }], wires: [['LCD1.GND', 'GND'], ['LCD1.VCC', '5V'], ['LCD1.SDA', 'A5'], ['LCD1.SCL', 'A4']], code: '#include <LiquidCrystal_I2C.h>\nLiquidCrystal_I2C lcd(0x27, 16, 2);\nvoid setup() { lcd.init(); lcd.print("Hi"); }\nvoid loop() {}' });
  assert.equal(lw.why.code, 'lcdwires');
  // a fade with no capacitor goes out at once
  const fs = B.normSpec({ battery: '9V', bin: { switch: 1, electrolytic: [1000], resistor: [330], led: ['red'] } });
  const fg = B.normGoal({ type: 'fade', ms: 500 }, fs);
  const nocap = { parts: [{ type: 'switch', at: ['h3', 'h4', 'h5'] }, { type: 'resistor', ohms: 330, at: ['g4', 'g9'] }, { type: 'led', color: 'red', at: ['h9', 'h10'] }], wires: [['BAT+', 'j3'], ['j10', 'BAT-']] };
  assert.equal(B.check(fs, fg, nocap).why.code, 'nocap');
  // the AI's slips are named so the repair round can fix them
  assert.match(bb.why({ arduino: true, motor: true, bin: { resistor: [1000] } }, { type: 'motor', pin: 9 }), /Add a transistor \("npn": 1\)/);
  assert.match(bb.why({ arduino: true, parts: [{ id: 'SV1', type: 'servo' }], wires: [['SV1.PWM2', 'D9']] }), /a servo's pins are GND, VCC, SIG/);
  assert.match(bb.why({ arduino: true, wires: [['US1.TRIG', 'D9']] }), /there is none: put it in "parts"/);
  assert.match(bb.why({ arduino: true, bin: { servo: 1 } }, { type: 'servo' }), /needs "angle" from 0 to 180/);
  assert.match(bb.why({ arduino: true, bin: { servo: 5 } }), /more than 4 modules/);
});

test('what the AI means is read kindly: a module plugged into the board, a leg named in a wire', () => {
  // an HC-SR04 written with "at": its four pins plug into a row of holes, each becoming a wire
  const plugged = B.normSpec({ arduino: true, parts: [{ id: 'US1', type: 'sonar', at: 'c10' }], wires: [['5V', 'a10'], ['D9', 'a11'], ['D10', 'a12'], ['GND', 'a13']] });
  assert.deepEqual(plugged.wires.slice(4).map((w) => [w.from, w.to]), [['US1.VCC', 'c10'], ['US1.TRIG', 'c11'], ['US1.ECHO', 'c12'], ['US1.GND', 'c13']]);
  assert.equal(plugged.parts[0].at.length, 0);
  // and when its pins are wired by name too, the "at" is let go
  assert.equal(B.normSpec({ arduino: true, parts: [{ id: 'L1', type: 'lcd', at: 'c10' }], wires: [['GND', 'L1.GND']] }).wires.length, 1);
  // a sonar wired in the wrong order never measures, and the reason gives the order
  assert.match(bb.why({ arduino: true, parts: [{ id: 'US1', type: 'sonar', at: 'c1' }], wires: [['5V', 'a1'], ['GND', 'a2'], ['D9', 'a3'], ['D10', 'a4']],
    code: 'void setup() { pinMode(9, OUTPUT); }\nvoid loop() { digitalWrite(9, HIGH); delayMicroseconds(10); digitalWrite(9, LOW); pulseIn(10, HIGH); delay(50); }' }), /its pins, in order: VCC, TRIG, ECHO, GND/);
  // a leg named in a wire: the wire goes in a free hole of that leg's strip
  const named = B.normSpec({ arduino: true, parts: [{ id: 'T1', type: 'tmp36', at: ['h3', 'h4', 'h5'] }], wires: [['5V', 'T1.Vs'], ['A0', 'T1.out'], ['GND', 't1.gnd']] });
  assert.deepEqual(named.wires.map((w) => B.HOLES.get(w.to).strip), ['D3', 'D4', 'D5']);
  // a battery wired to the Arduino's 5V: the reason says so
  assert.match(bb.why({ arduino: true, battery: '9V', bin: { led: 1 }, wires: [['BAT+', '5V'], ['BAT-', 'GND']] }), /BAT\+ is wired to the Arduino's 5V/);
});
