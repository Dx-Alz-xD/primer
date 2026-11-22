// The chemistry lab: the formula parser, the balancer, atoms and ions, valency (assets/js/widgets/chem-core.js),
// and the server's checks of what the AI writes (server/widgets/chem.mjs, through server/widgets.mjs).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import C from '../assets/js/widgets/chem-core.js';
import * as chem from '../server/widgets/chem.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt, KINDS } from '../server/widgets.mjs';

const atoms = (f) => C.parseSpecies(f).atoms;
const bal = (e) => C.balance(C.parseEquation(e));

test('the elements: all 118 symbols and names, in order', () => {
  assert.equal(C.SYMBOLS.length, 118);
  assert.equal(C.NAMES.length, 118);
  assert.equal(new Set(C.SYMBOLS).size, 118);
  assert.equal(C.zOf('H'), 1);
  assert.equal(C.zOf('Fe'), 26);
  assert.equal(C.zOf('Og'), 118);
  assert.equal(C.nameOf(13), 'Aluminium');
  assert.equal(C.nameOf(16), 'Sulphur');
  assert.equal(C.symbolOf(30), 'Zn');
  assert.equal(C.zOf('Xx'), 0);
});

test('formulas: counts, nested brackets, hydrates', () => {
  assert.deepEqual(atoms('H2O'), { H: 2, O: 1 });
  assert.deepEqual(atoms('Ca(OH)2'), { Ca: 1, O: 2, H: 2 });
  assert.deepEqual(atoms('Al2(SO4)3'), { Al: 2, S: 3, O: 12 });
  assert.deepEqual(atoms('(NH4)2SO4'), { N: 2, H: 8, S: 1, O: 4 });
  assert.deepEqual(atoms('K4[Fe(CN)6]'), { K: 4, Fe: 1, C: 6, N: 6 });
  assert.deepEqual(atoms('[Co(NH3)6]Cl3'), { Co: 1, N: 6, H: 18, Cl: 3 });
  assert.deepEqual(atoms('Mg3(PO4)2'), { Mg: 3, P: 2, O: 8 });
  assert.deepEqual(atoms('CH3COOH'), { C: 2, H: 4, O: 2 });
  for (const f of ['CuSO4·5H2O', 'CuSO4.5H2O', 'CuSO4*5H2O', 'CuSO4•5H2O']) assert.deepEqual(atoms(f), { Cu: 1, S: 1, O: 9, H: 10 }, f);
  assert.equal(C.parseSpecies('CuSO4.5H2O').text, 'CuSO4·5H2O');
  assert.deepEqual(atoms('H₂O'), { H: 2, O: 1 }, 'Unicode subscripts');
  assert.equal(C.parseSpecies('Co').atoms.Co, 1, 'Co is cobalt');
  assert.deepEqual(atoms('CO'), { C: 1, O: 1 }, 'CO is carbon monoxide');
  // a coefficient in front, and a state at the end
  const s = C.parseSpecies('2H2O(l)');
  assert.equal(s.coef, 2);
  assert.equal(s.state, 'l');
  assert.equal(s.text, 'H2O(l)');
  assert.equal(C.parseSpecies('Ca(OH)2(aq)').state, 'aq');
});

test('charges: with ^, in Unicode, and the plain way textbooks print them', () => {
  const q = (f) => C.parseSpecies(f).charge;
  assert.equal(q('Fe^3+'), 3);
  assert.equal(q('SO4^2-'), -2);
  assert.equal(q('SO4^{2-}'), -2);
  assert.equal(q('SO₄²⁻'), -2);
  assert.equal(q('Na+'), 1);
  assert.equal(q('Cl-'), -1);
  assert.equal(q('Ca++'), 2);
  assert.equal(q('Fe3+'), 3, 'one element: the digit is the charge');
  assert.equal(q('O2-'), -2);
  assert.equal(q('NO3-'), -1, 'a group: the digit is its count');
  assert.deepEqual(atoms('NO3-'), { N: 1, O: 3 });
  assert.equal(q('NH4+'), 1);
  assert.equal(q('SO42-'), -2, 'two digits: the last is the charge');
  assert.deepEqual(atoms('PO43-'), { P: 1, O: 4 });
  assert.equal(q('PO43-'), -3);
  assert.equal(q('Fe^3+(aq)'), 3);
  assert.equal(C.parseSpecies('Fe3+(aq)').text, 'Fe^3+(aq)');
  const e = C.parseSpecies('e^-');
  assert.ok(e.electron);
  assert.equal(e.charge, -1);
  assert.ok(C.parseSpecies('e-').electron);
  assert.ok(C.parseSpecies('e⁻').electron);
  // written with real subscripts and superscripts
  assert.equal(C.plain('SO4^2-'), 'SO₄²⁻');
  assert.equal(C.plain('Ca(OH)2'), 'Ca(OH)₂');
  assert.equal(C.plain('CuSO4·5H2O'), 'CuSO₄·5H₂O');
  assert.equal(C.plain('NH4^+'), 'NH₄⁺');
  assert.deepEqual(C.pieces('Fe2O3'), [{ k: 't', s: 'Fe' }, { k: 'b', s: '2' }, { k: 't', s: 'O' }, { k: 'b', s: '3' }]);
});

test('bad formulas are refused, saying why', () => {
  const bad = (f, re) => assert.throws(() => C.parseSpecies(f), (err) => err instanceof C.ChemError && re.test(err.message), f);
  bad('Xy', /"Xy" is not an element symbol/);
  bad('Fe2O3x', /capital letter/);
  bad('co2', /capital letter/);
  bad('Cxy', /not an element symbol/);
  bad('H2O)', /no "\(" before it/);
  bad('(OH', /never closed/);
  bad('Ca(OH]2', /no "\[" before it/);
  bad('H0', /can't be 0/);
  bad('()', /empty brackets/);
  bad('CuSO4·', /a dot needs a formula/);
  bad('', /empty/);
  bad('H2O$', /can't be read/);
  bad('SO4^2-^', /charge/);
  assert.throws(() => C.parseFormula('SO4^2-'), /neutral formula/);
});

// [equation, the smallest whole-number coefficients]
const TEXTBOOK = [
  ['H2 + O2 -> H2O', [2, 1, 2]],
  ['Fe + O2 -> Fe2O3', [4, 3, 2]],
  ['Al + O2 -> Al2O3', [4, 3, 2]],
  ['C3H8 + O2 -> CO2 + H2O', [1, 5, 3, 4]],                              // propane burns
  ['C6H12O6 + O2 -> CO2 + H2O', [1, 6, 6, 6]],                           // glucose, respiration
  ['C8H18 + O2 -> CO2 + H2O', [2, 25, 16, 18]],
  ['C2H5OH + O2 -> CO2 + H2O', [1, 3, 2, 3]],
  ['CH4(g) + O2(g) → CO2(g) + H2O(l)', [1, 2, 1, 2]],
  ['KMnO4 -> K2MnO4 + MnO2 + O2', [2, 1, 1, 1]],
  ['KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O', [2, 16, 2, 2, 5, 8]],
  ['Fe + H2O -> Fe3O4 + H2', [3, 4, 1, 4]],                              // NCERT
  ['Na + H2O -> NaOH + H2', [2, 2, 2, 1]],
  ['Pb(NO3)2 -> PbO + NO2 + O2', [2, 2, 4, 1]],
  ['BaCl2 + Na2SO4 -> BaSO4 + NaCl', [1, 1, 1, 2]],
  ['Zn + HCl -> ZnCl2 + H2', [1, 2, 1, 1]],
  ['Cu + HNO3 -> Cu(NO3)2 + NO + H2O', [3, 8, 3, 2, 4]],
  ['NH3 + O2 -> NO + H2O', [4, 5, 4, 6]],
  ['Al + CuCl2 -> AlCl3 + Cu', [2, 3, 2, 3]],
  ['MnO2 + HCl -> MnCl2 + Cl2 + H2O', [1, 4, 1, 1, 2]],
  ['Al2(SO4)3 + Ca(OH)2 -> Al(OH)3 + CaSO4', [1, 3, 2, 3]],
  ['P4 + O2 -> P4O10', [1, 5, 1]],
  ['CuSO4·5H2O -> CuSO4 + H2O', [1, 1, 5]],
  ['CaCO3 -> CaO + CO2', [1, 1, 1]],
  ['2H2+O2->2H2O', [2, 1, 2]],                                          // no spaces, coefficients ignored by the balancer
  // ions and redox: the charge must balance too
  ['MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O', [1, 5, 8, 1, 5, 4]],
  ['Cr2O7^2- + Fe^2+ + H^+ -> Cr^3+ + Fe^3+ + H2O', [1, 6, 14, 2, 6, 7]],
  ['Cu + Ag+ -> Cu2+ + Ag', [1, 2, 1, 2]],
  ['Fe^3+ + Cu -> Fe^2+ + Cu^2+', [2, 1, 2, 1]],
  ['Fe3+ + e- -> Fe2+', [1, 1, 1]],
  ['Na+ + Cl- -> NaCl', [1, 1, 1]],
  ['Zn + CuSO4 = ZnSO4 + Cu', [1, 1, 1, 1]]
];

test('the balancer: the smallest whole numbers for textbook equations', () => {
  for (const [e, want] of TEXTBOOK) {
    const eq = C.parseEquation(e);
    assert.deepEqual(C.balance(eq), want, e);
    assert.ok(C.balanced(eq, want), e);
    assert.ok(!C.balanced(eq, want.map((x, i) => (i ? x : x + 1))), e + ' (one changed)');
    assert.ok(C.balanced(eq, want.map((x) => x * 3)), e + ' (a multiple)');
  }
  assert.equal(C.eqPlain(C.parseEquation('Fe + O2 -> Fe2O3'), [4, 3, 2]), '4 Fe + 3 O₂ → 2 Fe₂O₃');
  assert.equal(C.eqPlain(C.parseEquation('MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O'), [1, 5, 8, 1, 5, 4]), 'MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O');
  assert.equal(C.eqPlain(C.parseEquation('Fe + O2 -> Fe2O3'), null, '□'), '□ Fe + □ O₂ → □ Fe₂O₃');
});

test('the balancer refuses what can\'t be balanced, saying why', () => {
  const no = (e, re) => assert.throws(() => bal(e), (err) => err instanceof C.ChemError && re.test(err.message), e);
  no('H2 + O2 -> H2O + N2', /N is only in the products/);
  no('Fe + Cl2 -> FeO', /Cl is only in the reactants|O is only in the products/);
  no('CO2 -> CO', /can't be balanced/);
  no('KMnO4 + H2O2 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O', /more than one independent way/);
  no('H2 + O2 -> H2O + H2O2', /more than one independent way/);
  no('Na -> Na^+', /the charge doesn't/);
  no('H2O + NaCl -> H2O2 + NaCl2', /0|can't be balanced|more than one/);
  assert.throws(() => C.parseEquation('Fe + O2'), /needs an arrow/);
  assert.throws(() => C.parseEquation('A -> B -> C'), /more than one arrow|not an element/);
  assert.throws(() => C.parseEquation('H2O -> H2O'), /on both sides/);
  assert.throws(() => C.parseEquation('H2 + H2 -> H4'), /twice/);
  assert.throws(() => C.parseEquation('H2 + -> H2O'), /nothing on one side/);
  // the atom (and charge) table
  const eq = C.parseEquation('Fe + O2 -> Fe2O3');
  assert.deepEqual(C.tally(eq, [2, 3, 1]), [{ el: 'Fe', left: 2, right: 2 }, { el: 'O', left: 6, right: 3 }]);
  const ionic = C.parseEquation('Cu + Ag^+ -> Cu^2+ + Ag');
  assert.deepEqual(C.tally(ionic, [1, 1, 1, 1]).pop(), { el: '', left: 1, right: 2 });
});

test('atoms: shells, valence electrons, ions, isotopes', () => {
  assert.deepEqual(C.shells(6, 6), [2, 4]);
  assert.deepEqual(C.shells(11, 11), [2, 8, 1]);
  assert.deepEqual(C.shells(11, 10), [2, 8], 'Na+');
  assert.deepEqual(C.shells(17, 18), [2, 8, 8], 'Cl-');
  assert.deepEqual(C.shells(18, 18), [2, 8, 8]);
  assert.deepEqual(C.shells(19, 19), [2, 8, 8, 1], 'K: 2, 8, 8, 1, as school books have it');
  assert.deepEqual(C.shells(20, 20), [2, 8, 8, 2]);
  assert.deepEqual(C.shells(26, 26), [2, 8, 14, 2]);
  assert.deepEqual(C.shells(26, 24), [2, 8, 14], 'Fe2+ loses its 4s electrons first');
  assert.deepEqual(C.shells(24, 24), [2, 8, 13, 1], 'chromium');
  assert.deepEqual(C.shells(29, 29), [2, 8, 18, 1], 'copper');
  assert.deepEqual(C.shells(1, 0), [], 'H+ has no electrons');
  assert.equal(C.valence(13, 13), 3);
  assert.equal(C.valence(8, 8), 6);
  const c12 = C.atomFacts(6, 6, 6);
  assert.equal(c12.symbol, 'C');
  assert.equal(c12.A, 12);
  assert.equal(c12.charge, 0);
  assert.ok(c12.stable);
  const c14 = C.atomFacts(6, 8, 6);
  assert.equal(c14.stable, false, 'carbon-14 is radioactive');
  assert.ok(C.isStable(1, 1), 'deuterium');
  assert.ok(!C.isStable(1, 2), 'tritium');
  assert.ok(!C.isStable(19, 21), 'potassium-40');
  assert.ok(C.isStable(17, 20), 'chlorine-37');
  const na = C.atomFacts(11, 12, 10);
  assert.equal(na.charge, 1);
  assert.equal(na.ionName, 'sodium');
  assert.equal(C.atomFacts(17, 18, 18).ionName, 'chloride');
  assert.equal(C.atomFacts(8, 8, 10).ionName, 'oxide');
  // isobars: the same mass number, different elements
  assert.equal(C.atomFacts(18, 22, 18).A, C.atomFacts(20, 20, 20).A);
  for (let z = 1; z <= 30; z++) assert.ok(C.STABLE[z].length >= 1, 'stable isotopes known for Z ' + z);
});

test('valency: the criss-cross method and formulas with brackets', () => {
  const f = (a, b) => { const c = C.parseIon(a), n = C.parseIon(b); const k = C.crissCross(c, n); return C.formulaOf(c, n, k[0], k[1]); };
  assert.equal(f('Al^3+', 'O^2-'), 'Al2O3');
  assert.equal(f('Na^+', 'Cl^-'), 'NaCl');
  assert.equal(f('Mg^2+', 'Cl^-'), 'MgCl2');
  assert.equal(f('Ca^2+', 'O^2-'), 'CaO', 'divided down');
  assert.equal(f('Ca^2+', 'OH^-'), 'Ca(OH)2');
  assert.equal(f('NH4^+', 'SO4^2-'), '(NH4)2SO4');
  assert.equal(f('Al^3+', 'SO4^2-'), 'Al2(SO4)3');
  assert.equal(f('Ca^2+', 'PO4^3-'), 'Ca3(PO4)2');
  assert.equal(f('Mg^2+', 'N^3-'), 'Mg3N2');
  assert.equal(f('Fe^3+', 'Cl^-'), 'FeCl3');
  assert.equal(f('Na^+', 'CO3^2-'), 'Na2CO3');
  assert.equal(f('Pb^4+', 'O^2-'), 'PbO2');
  assert.equal(C.parseIon('SO4^2-').name, 'sulphate');
  assert.equal(C.parseIon('NH4+').name, 'ammonium');
  assert.equal(C.parseIon('Fe^3+').name, 'iron(III)');
  assert.throws(() => C.parseIon('NaCl'), /no charge/);
  assert.throws(() => C.parseIon('Fe^7+'), /too big/);
  assert.throws(() => C.parseIon('2Na^+'), /no number before it/);
  assert.ok(C.ION_NAMES.includes('aluminium') && C.ION_NAMES.includes('oxide'));
});

test('balance specs and tasks: checked strictly, with a reason the AI can act on', () => {
  const b = chem.block({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' });
  assert.deepEqual(b, { mode: 'balance', equation: 'Fe + O2 -> Fe2O3', start: [1, 1, 1] });
  assert.deepEqual(chem.block({ equation: '2H2 + O2 -> 2H2O' }).start, [2, 1, 2], 'a block starts from the coefficients written, and the mode is guessed');
  assert.deepEqual(chem.block({ mode: 'balance', equation: 'Fe + O2 → Fe2O3' }), b, 'the same once cleaned');
  assert.deepEqual(chem.block(b), b, 'cleaning twice changes nothing');
  assert.equal(chem.block({ mode: 'balance', equation: 'H2 + O2 -> H2O + N2' }), null);
  assert.equal(chem.block({ mode: 'balance', equation: 'H2 + O2 -> H2O + N2' }), null);
  assert.equal(chem.block({ mode: 'fizz' }), null);

  const t = chem.task({ mode: 'balance', equation: '4Fe + 3O2 -> 2Fe2O3' }, {});
  assert.deepEqual(t.spec.start, [1, 1, 1], 'a task ignores coefficients written in, and starts from 1s');
  assert.deepEqual(t.goal, { coefficients: [4, 3, 2], multiples: false });
  assert.deepEqual(chem.task({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }, { coefficients: [4, 3, 2] }).goal.coefficients, [4, 3, 2]);
  assert.equal(chem.why({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }, { coefficients: [2, 3, 1] }),
    'Fe + O2 -> Fe2O3: the answer 2,3,1 leaves O unbalanced (6 left, 3 right); the smallest balance is 4,3,2');
  assert.match(chem.why({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }, { coefficients: [8, 6, 4] }), /not the smallest; the smallest is 4,3,2/);
  assert.equal(chem.task({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }, { coefficients: [8, 6, 4], multiples: true }).goal.multiples, true);
  assert.match(chem.why({ mode: 'balance', equation: 'NaOH + HCl -> NaCl + H2O' }, {}), /already balanced with every coefficient 1/);
  assert.match(chem.why({ mode: 'balance', equation: 'H2 + O2 -> H2O + N2' }, {}), /^H2 \+ O2 -> H2O \+ N2: N is only in the products/);
  assert.match(chem.why({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3x' }), /Fe2O3x.*capital letter/);
  assert.match(chem.why({ mode: 'balance', equation: 'KMnO4 + H2O2 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O' }), /more than one independent way/);
  assert.match(chem.why({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }, { coefficients: [4, 3] }), /3 whole numbers/);
  assert.match(chem.why({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }, { answer_is: 1 }), /unknown key/);
  assert.equal(chem.why({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }, {}), '');
  assert.equal(chem.why({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }), '');

  // checking the learner's coefficients
  const { spec, goal } = t;
  assert.deepEqual(C.check(spec, goal, { c: [4, 3, 2] }), { correct: true, why: {} });
  const off = C.check(spec, goal, { c: [2, 3, 1] });
  assert.equal(off.correct, false);
  assert.deepEqual(off.why.rows, [{ el: 'O', left: 6, right: 3 }]);
  assert.deepEqual(C.check(spec, goal, { c: [8, 6, 4] }).why, { divide: 2 });
  assert.equal(C.check(spec, { ...goal, multiples: true }, { c: [8, 6, 4] }).correct, true);
  assert.equal(C.check(spec, goal, { c: [4, 3] }).invalid, true);
  assert.equal(C.check(spec, goal, null).invalid, true);
  assert.equal(C.check(spec, goal, { c: [4, 0, 2] }).invalid, true);
});

test('atom specs and tasks', () => {
  assert.deepEqual(chem.block({ mode: 'atom', element: 'Na' }), { mode: 'atom', protons: 11, neutrons: 12, electrons: 11, max: 20 });
  assert.deepEqual(chem.block({ mode: 'atom' }), { mode: 'atom', protons: 1, neutrons: 0, electrons: 1, max: 20 });
  assert.equal(chem.block({ mode: 'atom', element: 'Na', mass: 24 }).neutrons, 13);
  assert.equal(chem.block({ mode: 'atom', protons: 26 }).max, 26, 'the lab grows to fit');
  assert.equal(chem.block({ mode: 'atom', element: 'U' }), null, 'beyond zinc');
  assert.match(chem.why({ mode: 'atom', element: 'U' }), /goes up to 30/);
  assert.equal(chem.block({ mode: 'atom', lock: ['protons', 'neutrons', 'electrons'] }), null, 'nothing to try');
  assert.match(chem.why({ mode: 'atom', hide: ['everything'] }), /"hide" can hold/);

  const carbon = chem.task({ mode: 'atom', protons: 1, neutrons: 0, electrons: 1 }, { element: 'C', mass: 12 });
  assert.deepEqual(carbon.goal, { element: 'C', mass: 12, charge: 0 }, 'an atom unless an ion is asked for');
  assert.ok(C.check(carbon.spec, carbon.goal, { p: 6, n: 6, e: 6 }).correct);
  assert.equal(C.check(carbon.spec, carbon.goal, { p: 6, n: 6, e: 7 }).why.atom, 'charge');
  assert.equal(C.check(carbon.spec, carbon.goal, { p: 6, n: 8, e: 6 }).why.atom, 'mass');
  assert.equal(C.check(carbon.spec, carbon.goal, { p: 7, n: 5, e: 7 }).why.atom, 'element');
  assert.deepEqual(C.solution(carbon.spec, carbon.goal), { p: 6, n: 6, e: 6 });

  const na = chem.task({ mode: 'atom', element: 'Na', lock: ['protons'] }, { element: 'Na', charge: 1 });
  assert.deepEqual(na.spec.lock, ['protons']);
  assert.deepEqual(C.solution(na.spec, na.goal), { p: 11, n: 12, e: 10 });
  assert.ok(C.check(na.spec, na.goal, { p: 11, n: 12, e: 10 }).correct);
  assert.ok(C.check(na.spec, na.goal, { p: 11, n: 13, e: 10 }).correct, 'any isotope of sodium will do');

  const h2 = chem.task({ mode: 'atom' }, { element: 'H', neutrons: 1 });
  assert.deepEqual(C.solution(h2.spec, h2.goal), { p: 1, n: 1, e: 1 }, 'deuterium');
  const v3 = chem.task({ mode: 'atom' }, { valence: 3 });
  assert.deepEqual(C.solution(v3.spec, v3.goal), { p: 5, n: 6, e: 5 }, 'boron-11 is the nearest');
  assert.ok(C.check(v3.spec, v3.goal, { p: 13, n: 14, e: 13 }).correct, 'aluminium has 3 too');
  assert.equal(C.check(v3.spec, v3.goal, { p: 13, n: 14, e: 10 }).correct, false, 'Al3+ is not an atom');
  const o2 = chem.task({ mode: 'atom' }, { element: 'O', electrons: 10 });
  assert.equal(C.solution(o2.spec, o2.goal).e, 10);
  assert.ok(chem.task({ mode: 'atom' }, { element: 'C', stable: true }));
  assert.ok(chem.task({ mode: 'atom', element: 'C' }, { element: 'C', mass: 14 }), 'carbon-14 is an isotope to build');

  // goals that contradict themselves, or the lab, or chemistry
  assert.match(chem.why({ mode: 'atom', protons: 6, neutrons: 6, electrons: 6 }, { element: 'C', mass: 12 }), /already meet the goal/);
  assert.match(chem.why({ mode: 'atom' }, { element: 'Na', charge: 2 }), /not one of its ions \(Na forms Na\^\+\)/);
  assert.match(chem.why({ mode: 'atom' }, { element: 'C', mass: 30 }), /far from C's isotopes/);
  assert.match(chem.why({ mode: 'atom' }, { element: 'C', protons: 7 }), /C has 6 protons/);
  assert.match(chem.why({ mode: 'atom' }, { element: 'C', mass: 12, neutrons: 7 }), /make a mass number of 13/);
  assert.match(chem.why({ mode: 'atom' }, { element: 'Ne', charge: -1 }), /doesn't usually form a simple ion/);
  assert.match(chem.why({ mode: 'atom' }, { element: 'C', mass: 14, stable: true }), /not stable/);
  assert.match(chem.why({ mode: 'atom' }, { element: 'Cl', charge: -1, valence: 7 }), /has 8 electrons in its outer shell, not 7/);
  assert.match(chem.why({ mode: 'atom' }, { colour: 'red' }), /unknown key "colour"/);
  assert.match(chem.why({ mode: 'atom' }, {}), /needs at least one/);
  assert.match(chem.why({ mode: 'atom', lock: ['protons'] }, { element: 'C', mass: 12 }), /no atom in this lab/);
  assert.match(chem.why({ mode: 'atom' }, { valence: 9 }), /from 0 to 8/);
});

test('compound specs and tasks', () => {
  const b = chem.block({ mode: 'compound', ions: ['Na+', 'Al^3+', 'Cl-', 'O^2-', 'SO₄²⁻', 'Na^+'] });
  assert.deepEqual(b.ions, ['Na^+', 'Al^3+', 'Cl^-', 'O^2-', 'SO4^2-'], 'written one way, without repeats');
  assert.equal(chem.block({ mode: 'compound', ions: ['Na^+', 'K^+'] }), null);
  assert.match(chem.why({ mode: 'compound', ions: ['Na^+', 'K^+'] }), /at least one positive ion .* and one negative ion/);
  assert.match(chem.why({ mode: 'compound', ions: ['Na^+', 'NaCl'] }), /"NaCl" has no charge/);
  assert.match(chem.why({ mode: 'compound', ions: 'Na^+' }), /must be a list/);

  const ions = ['Na^+', 'Mg^2+', 'Al^3+', 'Cl^-', 'O^2-', 'SO4^2-'];
  const t = chem.task({ mode: 'compound', ions }, { formula: 'Al2O3' });
  assert.deepEqual(t.goal, { formula: 'Al2O3' });
  assert.deepEqual(chem.task({ mode: 'compound', ions }, { formula: 'Al2(SO4)3' }).goal, { formula: 'Al2(SO4)3' });
  assert.deepEqual(chem.task({ mode: 'compound', ions }, { formula: 'Al2S3O12' }).goal, { formula: 'Al2(SO4)3' }, 'written the textbook way');
  assert.match(chem.why({ mode: 'compound', ions }, { formula: 'AlO' }), /not neutral: Al\^3\+ and O\^2- make "Al2O3"/);
  assert.match(chem.why({ mode: 'compound', ions }, { formula: 'Al4O6' }), /not in the smallest whole numbers: write "Al2O3"/);
  assert.match(chem.why({ mode: 'compound', ions }, { formula: 'CaCl2' }), /can't be made from the ions given/);
  assert.match(chem.why({ mode: 'compound', ions }, {}), /needs "formula"/);

  const ok = (v) => C.check(t.spec, t.goal, v);
  assert.ok(ok({ ions: ['Al^3+', 'O^2-'], n: [2, 3] }).correct);
  assert.deepEqual(ok({ ions: ['Al^3+', 'O^2-'], n: [1, 1] }).why, { charge: 1 });
  assert.deepEqual(ok({ ions: ['Al^3+', 'O^2-'], n: [4, 6] }).why, { divide: 2 });
  assert.deepEqual(ok({ ions: ['Mg^2+', 'O^2-'], n: [1, 1] }).why, { other: 'MgO' });
  assert.equal(ok({ ions: ['Al^3+'], n: [2, 3] }).invalid, true);
  assert.equal(ok({ ions: ['O^2-', 'Al^3+'], n: [3, 2] }).invalid, true, 'the positive ion comes first');
  assert.equal(ok({ ions: ['Fe^3+', 'O^2-'], n: [2, 3] }).invalid, true, 'only the spec\'s ions');
  assert.deepEqual(C.solution(t.spec, t.goal), { ions: ['Al^3+', 'O^2-'], n: [2, 3] });
});

test('the core frame takes chem blocks and tasks, and offers the lab to chemistry lessons', () => {
  assert.ok(KINDS.includes('chem'));
  const b = normWidgetBlock({ t: 'widget', kind: 'chem', spec: { mode: 'balance', equation: 'C3H8 + O2 -> CO2 + H2O' }, caption: 'Burn propane.' });
  assert.equal(b.kind, 'chem');
  assert.equal(b.spec.equation, 'C3H8 + O2 -> CO2 + H2O');
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'chem', spec: { mode: 'balance', equation: 'Q + O2 -> QO' } }), null);
  const q = normTask({ type: 'task', kind: 'chem', spec: { mode: 'atom' }, goal: { element: 'C', mass: 12 } }, { prompt: 'Build carbon-12.', hint: '', explain: '' });
  assert.deepEqual(q.goal, { element: 'C', mass: 12, charge: 0 });
  assert.ok(widgetKinds({ topic: 'Class 10 Science', title: 'Chemical reactions and equations' }).includes('chem'));
  assert.ok(!widgetKinds({ topic: 'Photosynthesis', title: 'Light and leaves' }).includes('chem'));
  assert.match(widgetPrompt(['chem']), /Chemistry lab \("kind": "chem"\)/);
});

test('which lessons are offered the lab, in the languages Primer serves', () => {
  const yes = ['Chemical reactions and equations', 'Balancing chemical equations', 'Structure of the atom', 'Atoms and molecules', 'Isotopes and isobars',
    'Valency and chemical formulae', 'The periodic table', 'Acids, bases and salts', 'Metals and non-metals', 'Carbon and its compounds',
    'Bohr model of the atom', 'Electron configuration', 'Oxidation and reduction', 'Stoichiometry', 'The mole concept', 'Redox reactions',
    'Elements, compounds and mixtures', 'Ions and ionic compounds', 'Protons, neutrons and electrons', 'Reactions of acids with metals', 'Combustion of fuels in oxygen',
    'Class 9 Chemistry', 'Corrosion and rusting of iron in oxygen',
    'रासायनिक अभिक्रियाएँ और समीकरण', 'परमाणु की संरचना', 'संयोजकता', 'समस्थानिक और समभारिक', 'इलेक्ट्रॉन, प्रोटॉन और न्यूट्रॉन', 'तत्व और यौगिक', 'आयन और अणु',
    'अणू आणि रेणू', 'রাসায়নিক বিক্রিয়া', 'পরমাণুর গঠন', 'வேதிவினைகள்', 'அணுவின் அமைப்பு', 'రసాయన చర్యలు', 'పరమాణు నిర్మాణం', 'ರಾಸಾಯನಿಕ ಕ್ರಿಯೆಗಳು',
    'ആറ്റത്തിന്റെ ഘടന', 'രാസപ്രവർത്തനങ്ങൾ', 'રાસાયણિક પ્રક્રિયાઓ', 'ਪਰਮਾਣੂ ਦੀ ਬਣਤਰ', 'ରାସାୟନିକ ପ୍ରତିକ୍ରିୟା', 'کیمیائی تعامل', 'ایٹم کی ساخت',
    'التفاعلات الكيميائية', 'بنية الذرات', 'reacciones químicas', 'el átomo y sus partículas', 'reações químicas', 'la structure de l\'atome', 'réactions chimiques',
    'химические реакции', 'строение атома', 'Valenz und chemische Formeln'];
  const no = ['Chemistry between people', 'Team chemistry in football', 'Compound interest', 'Compound words in English', 'Elements of art and design',
    'Atomic Habits: a book summary', 'Quadratic equations', 'Linear equations and formulae', 'The Salt Satyagraha and the Dandi March', 'Electric current and its effects',
    'Flow of electrons in a metal wire', 'Cell structure: the nucleus', 'Reading isobars on a weather map', 'Product of two numbers', 'Mass media and society',
    'Heavy metal music', 'Photosynthesis', 'Sets: elements of a set', 'Newton\'s laws of motion', 'Respiration in animals', 'Reaction time in sports',
    'Equations of a straight line', 'Formula One racing', 'The water cycle', 'पंच तत्व और योग', 'योग और ध्यान', 'química entre nosotros', 'Equal opportunity: تكافؤ الفرص', ''];
  for (const s of yes) assert.equal(chem.match(s.toLowerCase()), true, s);
  for (const s of no) assert.equal(chem.match(s.toLowerCase()), false, s);
});

test('the prompt\'s examples are themselves valid, and it stays short', () => {
  const p = chem.prompt;
  assert.ok(p.length <= 3000, `the prompt is ${p.length} characters`);
  const objects = [];
  for (const start of ['{"t": "widget"', '{"type": "task"']) {
    let i = p.indexOf(start);
    while (i >= 0) {
      let depth = 0, j = i;
      for (; j < p.length; j++) { if (p[j] === '{') depth++; else if (p[j] === '}' && --depth === 0) break; }
      objects.push(JSON.parse(p.slice(i, j + 1)));
      i = p.indexOf(start, j);
    }
  }
  const blocks = objects.filter((o) => o.t === 'widget'), tasks = objects.filter((o) => o.type === 'task');
  assert.ok(blocks.length >= 1 && tasks.length >= 1);
  blocks.forEach((b) => assert.ok(chem.block(b.spec), JSON.stringify(b)));
  tasks.forEach((q) => assert.ok(chem.task(q.spec, q.goal), JSON.stringify(q)));
  // the shapes it shows inline are valid too
  assert.ok(chem.block({ mode: 'balance', equation: 'Fe + O2 -> Fe2O3' }));
  assert.ok(chem.block({ mode: 'atom', protons: 1, neutrons: 0, electrons: 1 }));
  assert.ok(chem.block({ mode: 'compound', ions: ['Na^+', 'Mg^2+', 'Al^3+', 'Cl^-', 'O^2-', 'SO4^2-'] }));
  for (const g of [{ element: 'C', mass: 12 }, { element: 'Na', charge: 1 }, { element: 'H', neutrons: 1 }, { valence: 3 }]) assert.ok(chem.task({ mode: 'atom', protons: 1, neutrons: 0, electrons: 1 }, g), JSON.stringify(g));
  assert.equal(typeof chem.label, 'string');
});
