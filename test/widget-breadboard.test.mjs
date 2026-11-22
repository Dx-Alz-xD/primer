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
  const tk = JSON.parse(bb.prompt.match(/Task example: (\{.*\})$/)[1]);
  assert.ok(normTask(tk, { prompt: tk.prompt, hint: '', explain: '' }), 'the task example');
  assert.ok(bb.prompt.length <= 3250, `the prompt is short (${bb.prompt.length})`);
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
