/* =====================================================================
   The chemistry lab in lessons: the chemistry, shared by the server
   (server/widgets/chem.mjs checks every spec the AI writes, and that
   each task can be done) and the page (assets/js/widgets/chem.js draws
   it and checks the learner's tasks). The server imports this file; the
   page loads it with a script element (window.PrimerChem).

   - Formulas: element symbols (all 118), counts, nested ( ) and [ ]
     groups, hydrates (CuSO4·5H2O, or with "." or "*"), charges written
     "Fe^3+", "SO4^2-", "e^-", "SO₄²⁻", or plainly "Na+", "Cl-", "Fe3+",
     "SO42-", "NO3-", and states (s) (l) (g) (aq). An unknown symbol, a
     lower-case start (co2) or an unclosed bracket is an error.
   - Equations: "Fe + O2 -> Fe2O3" (also → = <=> ⇌), species split on
     "+" (a "+" that ends a charge stays with it). The balancer finds the
     null space of the atom (and charge) matrix exactly, over rationals
     with BigInt, and scales it to the smallest whole numbers. It refuses
     an element on one side only, an equation that can't be balanced,
     one that balances in more than one independent way (two reactions
     mixed), a species that would need 0, and coefficients over 40.
   - Atoms: protons, neutrons and electrons give the element, the mass
     number, the charge, the shells (2, 8, 8 for the first 20 elements;
     4s empties before 3d in the ions of 21 to 30), the valence
     electrons, and whether the isotope is stable (data for Z = 1 to 30).
   - Ions and valency: the criss-cross method; formulas written with
     brackets where a polyatomic ion is taken more than once, Al2(SO4)3;
     names for the common ions, from the school tables.

   A spec, after normSpec:
     { mode: 'balance', equation: 'Fe + O2 -> Fe2O3', start: [1, 1, 1] }
     { mode: 'atom', protons, neutrons, electrons, max, lock: [...], hide: [...] }
     { mode: 'compound', ions: ['Na^+', 'Al^3+', 'Cl^-', 'O^2-'] }
   A task's goal, after normTask:
     balance   { coefficients: [4, 3, 2], multiples: false }
     atom      any of { element, protons, neutrons, electrons, mass, charge,
               valence, stable }; charge 0 unless electrons or charge is given
     compound  { formula: 'Al2O3' }
   The learner's attempt ("value"):
     balance { c: [4, 3, 2] }   atom { p, n, e }   compound { ions: [cation, anion], n: [2, 3] }
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerChem = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  class ChemError extends Error {}
  const fail = (msg) => { throw new ChemError(msg); };
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
  const short = (s, n = 40) => { const t = String(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

  const LIMITS = { species: 8, side: 6, formula: 40, equation: 240, coef: 40, stepper: 99, ions: 10, count: 6, ionCharge: 4, zAtom: 30 };

  /* ---------------- the elements ---------------- */

  const SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr '
    + 'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re '
    + 'Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh '
    + 'Fl Mc Lv Ts Og').split(' ');

  // i18n-list: element names. The page shows each through ctx.t(name) (or P.t), so every string in this
  // list is an interface string to translate (NCERT spellings: Aluminium, Sulphur, Caesium).
  const NAMES = [
    'Hydrogen', 'Helium', 'Lithium', 'Beryllium', 'Boron', 'Carbon', 'Nitrogen', 'Oxygen', 'Fluorine', 'Neon',
    'Sodium', 'Magnesium', 'Aluminium', 'Silicon', 'Phosphorus', 'Sulphur', 'Chlorine', 'Argon', 'Potassium', 'Calcium',
    'Scandium', 'Titanium', 'Vanadium', 'Chromium', 'Manganese', 'Iron', 'Cobalt', 'Nickel', 'Copper', 'Zinc',
    'Gallium', 'Germanium', 'Arsenic', 'Selenium', 'Bromine', 'Krypton', 'Rubidium', 'Strontium', 'Yttrium', 'Zirconium',
    'Niobium', 'Molybdenum', 'Technetium', 'Ruthenium', 'Rhodium', 'Palladium', 'Silver', 'Cadmium', 'Indium', 'Tin',
    'Antimony', 'Tellurium', 'Iodine', 'Xenon', 'Caesium', 'Barium', 'Lanthanum', 'Cerium', 'Praseodymium', 'Neodymium',
    'Promethium', 'Samarium', 'Europium', 'Gadolinium', 'Terbium', 'Dysprosium', 'Holmium', 'Erbium', 'Thulium', 'Ytterbium',
    'Lutetium', 'Hafnium', 'Tantalum', 'Tungsten', 'Rhenium', 'Osmium', 'Iridium', 'Platinum', 'Gold', 'Mercury',
    'Thallium', 'Lead', 'Bismuth', 'Polonium', 'Astatine', 'Radon', 'Francium', 'Radium', 'Actinium', 'Thorium',
    'Protactinium', 'Uranium', 'Neptunium', 'Plutonium', 'Americium', 'Curium', 'Berkelium', 'Californium', 'Einsteinium', 'Fermium',
    'Mendelevium', 'Nobelium', 'Lawrencium', 'Rutherfordium', 'Dubnium', 'Seaborgium', 'Bohrium', 'Hassium', 'Meitnerium', 'Darmstadtium',
    'Roentgenium', 'Copernicium', 'Nihonium', 'Flerovium', 'Moscovium', 'Livermorium', 'Tennessine', 'Oganesson'
  ];
  const Z_OF = new Map(SYMBOLS.map((s, i) => [s, i + 1]));
  const zOf = (sym) => Z_OF.get(sym) || 0;
  const symbolOf = (z) => SYMBOLS[z - 1] || '';
  const nameOf = (z) => NAMES[z - 1] || '';

  // The stable isotopes of the first 30 elements, as neutron counts, the most common first (V-50 and
  // Ca-48 decay so slowly that they count as stable, as in school tables; K-40 is radioactive).
  const STABLE = [null,
    [0, 1], [2, 1], [4, 3], [5], [6, 5], [6, 7], [7, 8], [8, 10, 9], [10], [10, 12, 11],
    [12], [12, 14, 13], [14], [14, 15, 16], [16], [16, 18, 17, 20], [18, 20], [22, 18, 20], [20, 22], [20, 24, 22, 28, 23, 26],
    [24], [26, 24, 25, 27, 28], [28, 27], [28, 29, 26, 30], [30], [30, 28, 31, 32], [32], [30, 32, 34, 33, 36], [34, 36], [34, 36, 38, 37, 40]];
  // The simple ions each of them forms (school tables): charges
  const IONS_OF = [null, [1, -1], [], [1], [2], [], [], [-3], [-2], [-1], [],
    [1], [2], [3], [], [-3], [-2], [-1], [], [1], [2],
    [3], [4, 3, 2], [2, 3, 4, 5], [3, 2], [2, 3, 4], [2, 3], [2, 3], [2], [1, 2], [2]];

  // The common ions, with their names (lower case, as in a compound's name). [formula, charge, name]
  const ION_LIST = [
    ['H', 1, 'hydrogen'], ['Li', 1, 'lithium'], ['Na', 1, 'sodium'], ['K', 1, 'potassium'], ['Rb', 1, 'rubidium'], ['Cs', 1, 'caesium'],
    ['Ag', 1, 'silver'], ['Cu', 1, 'copper(I)'], ['Hg', 1, 'mercury(I)'], ['NH4', 1, 'ammonium'], ['H3O', 1, 'hydronium'],
    ['Be', 2, 'beryllium'], ['Mg', 2, 'magnesium'], ['Ca', 2, 'calcium'], ['Sr', 2, 'strontium'], ['Ba', 2, 'barium'], ['Zn', 2, 'zinc'],
    ['Fe', 2, 'iron(II)'], ['Cu', 2, 'copper(II)'], ['Pb', 2, 'lead(II)'], ['Sn', 2, 'tin(II)'], ['Ni', 2, 'nickel'], ['Co', 2, 'cobalt(II)'],
    ['Mn', 2, 'manganese(II)'], ['Hg', 2, 'mercury(II)'], ['Cd', 2, 'cadmium'], ['Cr', 2, 'chromium(II)'],
    ['Al', 3, 'aluminium'], ['Fe', 3, 'iron(III)'], ['Cr', 3, 'chromium(III)'], ['Co', 3, 'cobalt(III)'], ['Au', 3, 'gold(III)'], ['Sc', 3, 'scandium'],
    ['Sn', 4, 'tin(IV)'], ['Pb', 4, 'lead(IV)'], ['Ti', 4, 'titanium(IV)'], ['Mn', 4, 'manganese(IV)'],
    ['H', -1, 'hydride'], ['F', -1, 'fluoride'], ['Cl', -1, 'chloride'], ['Br', -1, 'bromide'], ['I', -1, 'iodide'], ['OH', -1, 'hydroxide'],
    ['NO3', -1, 'nitrate'], ['NO2', -1, 'nitrite'], ['HCO3', -1, 'hydrogen carbonate'], ['HSO4', -1, 'hydrogen sulphate'], ['HSO3', -1, 'hydrogen sulphite'],
    ['MnO4', -1, 'permanganate'], ['CN', -1, 'cyanide'], ['ClO', -1, 'hypochlorite'], ['ClO3', -1, 'chlorate'], ['ClO4', -1, 'perchlorate'],
    ['CH3COO', -1, 'acetate'], ['H2PO4', -1, 'dihydrogen phosphate'], ['AlO2', -1, 'aluminate'],
    ['O', -2, 'oxide'], ['S', -2, 'sulphide'], ['O2', -2, 'peroxide'], ['SO4', -2, 'sulphate'], ['SO3', -2, 'sulphite'], ['CO3', -2, 'carbonate'],
    ['CrO4', -2, 'chromate'], ['Cr2O7', -2, 'dichromate'], ['HPO4', -2, 'hydrogen phosphate'], ['SiO3', -2, 'silicate'], ['C2O4', -2, 'oxalate'],
    ['S2O3', -2, 'thiosulphate'], ['ZnO2', -2, 'zincate'],
    ['N', -3, 'nitride'], ['P', -3, 'phosphide'], ['PO4', -3, 'phosphate'], ['PO3', -3, 'phosphite'], ['BO3', -3, 'borate']
  ];
  // i18n-list: ion names (shown through ctx.t(name)), and the template that joins two into a compound's name
  const ION_NAMES = [...new Set(ION_LIST.map((x) => x[2]))];
  const ION_BY = new Map(ION_LIST.map(([f, c, n]) => [f + '|' + c, n]));
  const ionName = (body, charge) => ION_BY.get(body + '|' + charge) || '';

  /* ---------------- formulas ---------------- */

  const SUPMAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
  const SUBS = '₀₁₂₃₄₅₆₇₈₉', SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const STATES = ['s', 'l', 'g', 'aq'];

  // one way of writing everything: ASCII digits and signs, "^" before a charge, "·" in a hydrate
  function tidy(s) {
    return String(s).normalize('NFC')
      .replace(/[−‒–‐‑﹣－]/g, '-')
      .replace(/[＋﹢]/g, '+')
      .replace(/[₀-₉]/g, (c) => String(SUBS.indexOf(c)))
      .replace(/\^?([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)/g, (m, g) => '^' + [...g].map((c) => SUPMAP[c]).join(''))
      .replace(/[·•∙⋅∗*]/g, '·')
      .replace(/\s+/g, ' ');
  }

  // a count after a symbol or a bracket: 1 if none; never 0
  function count(str, i, raw) {
    const m = /^\d+/.exec(str.slice(i));
    if (!m) return { value: 1, end: i };
    if (m[0][0] === '0') fail(`"${short(raw)}": a count can't be 0 or start with 0`);
    const value = Number(m[0]);
    if (value > 999) fail(`"${short(raw)}": a count of ${value} is too big`);
    return { value, end: i + m[0].length };
  }
  const addInto = (out, atoms, k) => { Object.keys(atoms).forEach((s) => { out[s] = (out[s] || 0) + atoms[s] * k; }); };

  // a run of symbols and groups, up to the bracket that closes it (or the end)
  function group(str, i, close, raw, order) {
    const out = {};
    while (i < str.length) {
      const ch = str[i];
      if (ch === '(' || ch === '[') {
        const want = ch === '(' ? ')' : ']';
        const inner = group(str, i + 1, want, raw, order);
        if (!Object.keys(inner.atoms).length) fail(`"${short(raw)}": empty brackets`);
        const n = count(str, inner.end + 1, raw);
        addInto(out, inner.atoms, n.value);
        i = n.end;
      } else if (ch === ')' || ch === ']') {
        if (ch !== close) fail(`"${short(raw)}": a "${ch}" with no "${ch === ')' ? '(' : '['}" before it`);
        return { atoms: out, end: i };
      } else if (ch >= 'A' && ch <= 'Z') {
        let sym = ch;
        i++;
        if (i < str.length && str[i] >= 'a' && str[i] <= 'z') sym += str[i++];
        if (i < str.length && str[i] >= 'a' && str[i] <= 'z') fail(`"${short(raw)}": "${sym + str[i]}" is not an element symbol`);
        if (!Z_OF.has(sym)) fail(`"${short(raw)}": "${sym}" is not an element symbol`);
        const n = count(str, i, raw);
        out[sym] = (out[sym] || 0) + n.value;
        if (!order.includes(sym)) order.push(sym);
        i = n.end;
      } else if (ch >= 'a' && ch <= 'z') {
        fail(`"${short(raw)}": an element symbol starts with a capital letter ("${ch.toUpperCase()}", not "${ch}")`);
      } else if (ch >= '0' && ch <= '9') {
        fail(`"${short(raw)}": a number in the wrong place (counts go after a symbol, as in H2O)`);
      } else {
        fail(`"${short(raw)}": "${ch}" can't be read in a formula`);
      }
    }
    if (close) fail(`"${short(raw)}": a "${close === ')' ? '(' : '['}" is never closed`);
    return { atoms: out, end: i };
  }

  const chargeText = (c) => (c ? '^' + (Math.abs(c) > 1 ? Math.abs(c) : '') + (c > 0 ? '+' : '-') : '');

  // one species: { coef, body, charge, state, electron, atoms, order, text }; text is how it is written
  // from now on (no coefficient), e.g. "Fe^3+(aq)"
  function parseSpecies(raw) {
    let s = tidy(raw).trim();
    if (!s) fail('an empty formula');
    if (s.length > LIMITS.formula) fail(`"${short(s)}" is too long for one formula`);
    let coef = 1;
    const cm = /^(\d+)\s*(?=[A-Z([e])/.exec(s);
    if (cm) {
      coef = Number(cm[1]);
      if (cm[1][0] === '0' || coef > 999) fail(`"${short(s)}": a coefficient must be a whole number from 1`);
      s = s.slice(cm[0].length);
    }
    s = s.replace(/\s+/g, '').replace(/[↑↓]+$/, '');
    let state = '';
    const sm = /\((s|l|g|aq)\)$/i.exec(s);
    if (sm) { state = sm[1].toLowerCase(); s = s.slice(0, -sm[0].length); }
    if (/^e(?:-|\^\{?(?:-|1-|-1)\}?)$/.test(s)) {
      return { coef, body: 'e', charge: -1, state: '', electron: true, atoms: {}, order: [], text: 'e^-' };
    }
    let charge = 0;
    let m = /\^\{?(\d*)([+-])(\d*)\}?$/.exec(s);
    if (m) {
      if (m[1] && m[3]) fail(`"${short(raw)}": write a charge once, as "^2-"`);
      const mag = Number(m[1] || m[3] || 1);
      if (!mag) fail(`"${short(raw)}": a charge of 0`);
      charge = (m[2] === '+' ? 1 : -1) * mag;
      s = s.slice(0, -m[0].length);
    } else if ((m = /(\d*)(\++|-+)$/.exec(s))) {
      // plain text: "Na+", "Cl-", "Ca++"; "Fe3+" and "O2-" (one element: the digit is the charge);
      // "NO3-", "NH4+" (a group: the digit is its count, the charge is one); "SO42-", "PO43-" (the last digit is the charge)
      let base = s.slice(0, -m[0].length);
      const digits = m[1], signs = m[2];
      let mag = signs.length;
      if (/[+-]/.test(signs.slice(1)) && signs.length > 1 && signs !== signs[0].repeat(signs.length)) fail(`"${short(raw)}": write the charge with "^", as "Fe^3+"`);
      if (digits) {
        if (signs.length > 1) fail(`"${short(raw)}": write the charge with "^", as "Fe^3+"`);
        if (digits.length >= 2) { mag = Number(digits.slice(-1)); base += digits.slice(0, -1); }
        else if (/^[A-Z][a-z]?$/.test(base)) mag = Number(digits);
        else { base += digits; mag = 1; }
        if (!mag) fail(`"${short(raw)}": write the charge with "^", as "SO4^2-"`);
      }
      if (!base) fail(`"${short(raw)}": a charge with no formula`);
      charge = (signs[0] === '+' ? 1 : -1) * mag;
      s = base;
    }
    if (s.includes('^')) fail(`"${short(raw)}": a charge goes at the very end, as "SO4^2-(aq)"`);
    if (Math.abs(charge) > 8) fail(`"${short(raw)}": a charge of ${charge} is too big`);
    // a "." between two parts is a hydrate's dot
    s = s.replace(/([A-Za-z0-9)\]])\.(?=[0-9A-Z([])/g, '$1·');
    const atoms = {}, order = [];
    const parts = s.split('·');
    if (parts.some((p) => !p)) fail(`"${short(raw)}": a dot needs a formula on each side, as "CuSO4·5H2O"`);
    parts.forEach((part, k) => {
      let mult = 1, i = 0;
      const mm = /^\d+/.exec(part);
      if (mm) {
        if (k === 0) fail(`"${short(raw)}": a number in the wrong place`);
        if (mm[0][0] === '0') fail(`"${short(raw)}": a count can't be 0`);
        mult = Number(mm[0]);
        i = mm[0].length;
      }
      const r = group(part, i, '', raw, order);
      if (!Object.keys(r.atoms).length) fail(`"${short(raw)}": no elements`);
      addInto(atoms, r.atoms, mult);
    });
    const total = Object.values(atoms).reduce((a, b) => a + b, 0);
    if (total > 300) fail(`"${short(raw)}": too many atoms for one formula`);
    return { coef, body: s, charge, state, electron: false, atoms, order, text: s + chargeText(charge) + (state ? `(${state})` : '') };
  }

  // a formula with no charge (a compound in a goal): its atoms
  function parseFormula(raw) {
    const sp = parseSpecies(raw);
    if (sp.electron || sp.charge) fail(`"${short(raw)}" should be a neutral formula, with no charge`);
    if (sp.coef !== 1) fail(`"${short(raw)}": write the formula with no number before it`);
    return sp;
  }

  const sameAtoms = (a, b) => {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  };

  /* ---------------- written formulas: pieces for the page, Unicode for words ---------------- */

  // [{ k: 't' | 'b' | 'p', s }]: text, a subscript (below), a superscript (charge)
  function pieces(text) {
    const out = [];
    const push = (k, s) => { const last = out[out.length - 1]; if (last && last.k === k) last.s += s; else out.push({ k, s }); };
    let s = String(text);
    let state = '';
    const sm = /\((?:s|l|g|aq)\)$/.exec(s);
    if (sm) { state = sm[0]; s = s.slice(0, -state.length); }
    let charge = '';
    const cm = /\^(\d*)([+-])$/.exec(s);
    if (cm) { charge = cm[1] + (cm[2] === '-' ? '−' : '+'); s = s.slice(0, -cm[0].length); }
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const prev = s[i - 1];
      const last = out[out.length - 1];
      if (ch >= '0' && ch <= '9' && prev && (/[A-Za-z)\]]/.test(prev) || (/\d/.test(prev) && last && last.k === 'b'))) push('b', ch);
      else push('t', ch);
    }
    if (charge) push('p', charge);
    if (state) push('t', state);
    return out;
  }
  const uniSub = (s) => s.replace(/\d/g, (d) => SUBS[d]);
  const uniSup = (s) => s.replace(/\d/g, (d) => SUPS[d]).replace(/\+/g, '⁺').replace(/−|-/g, '⁻');
  const plain = (text) => pieces(text).map((p) => (p.k === 'b' ? uniSub(p.s) : p.k === 'p' ? uniSup(p.s) : p.s)).join('');

  /* ---------------- equations ---------------- */

  // "+" between species; a "+" that ends a charge ("Na+ + Cl-", "Fe^3+") stays with its species
  function splitSide(side) {
    const out = [];
    let cur = '';
    for (let i = 0; i < side.length; i++) {
      const ch = side[i];
      if (ch !== '+') { cur += ch; continue; }
      const spaceBefore = i === 0 || /\s/.test(side[i - 1]);
      const inCaret = /\^\{?\d*$/.test(cur);
      const next = side.slice(i + 1).replace(/^\s+/, '');
      const nextSpecies = /^[0-9A-Z([]/.test(next) && !/^\((?:s|l|g|aq)\)/i.test(next);
      if (!inCaret && (spaceBefore || nextSpecies)) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    const parts = out.map((x) => x.trim());
    if (parts.some((x) => !x)) fail(`"${short(side.trim())}": a "+" with nothing on one side`);
    return parts;
  }

  // { left: [species], right: [species], species, elements (in order), charged, coefs (as written), text }
  function parseEquation(text) {
    if (typeof text !== 'string' || !text.trim()) fail('"equation" must be a string, like "Fe + O2 -> Fe2O3"');
    let s = tidy(text).trim();
    if (s.length > LIMITS.equation) fail('the equation is too long');
    s = s.replace(/\s*(?:<-+>|<=+>|⇌|⇄|↔|⟷|-{1,2}>|={1,2}>|→|⟶|⟹|⇒|=)\s*/g, ' -> ');
    const sides = s.split(' -> ');
    if (sides.length < 2) fail('the equation needs an arrow "->" between the reactants and the products');
    if (sides.length > 2) fail('the equation has more than one arrow; give one reaction');
    const left = splitSide(sides[0]).map(parseSpecies), right = splitSide(sides[1]).map(parseSpecies);
    const species = left.concat(right);
    if (species.length > LIMITS.species || left.length > LIMITS.side || right.length > LIMITS.side) fail(`too many formulas (at most ${LIMITS.species}, ${LIMITS.side} on a side)`);
    const key = (x) => x.text.replace(/\((?:s|l|g|aq)\)$/, '');
    [left, right].forEach((side, k) => side.forEach((x, i) => {
      if (side.findIndex((y) => key(y) === key(x)) !== i) fail(`"${x.text}" is written twice on the ${k ? 'right' : 'left'}`);
    }));
    left.forEach((x) => { if (right.some((y) => key(y) === key(x))) fail(`"${key(x)}" is on both sides of the arrow`); });
    const elements = [];
    species.forEach((x) => x.order.forEach((el) => { if (!elements.includes(el)) elements.push(el); }));
    const charged = species.some((x) => x.charge !== 0);
    return {
      left, right, species, elements, charged,
      coefs: species.map((x) => x.coef),
      text: left.map((x) => x.text).join(' + ') + ' -> ' + right.map((x) => x.text).join(' + ')
    };
  }

  // atoms (and charge) on each side for these coefficients: [{ el, left, right }], the charge row last ({ el: '' })
  function tally(eq, coefs) {
    const nL = eq.left.length;
    const side = (j) => (j < nL ? 'left' : 'right');
    const rows = eq.elements.map((el) => ({ el, left: 0, right: 0 }));
    const charge = { el: '', left: 0, right: 0 };
    eq.species.forEach((x, j) => {
      const c = coefs[j];
      rows.forEach((r) => { r[side(j)] += c * (x.atoms[r.el] || 0); });
      charge[side(j)] += c * x.charge;
    });
    if (eq.charged) rows.push(charge);
    return rows;
  }
  const balanced = (eq, coefs) => tally(eq, coefs).every((r) => r.left === r.right);

  // exact fractions with BigInt: [numerator, denominator > 0]
  const babs = (a) => (a < 0n ? -a : a);
  const bgcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
  const fr = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d) || 1n; return [n / g, d / g]; };
  const fsub = (a, b) => fr(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
  const fmul = (a, b) => fr(a[0] * b[0], a[1] * b[1]);
  const fdiv = (a, b) => fr(a[0] * b[1], a[1] * b[0]);

  // a basis of the null space of an integer matrix (rows), by reduced row echelon form
  function nullspace(rows, n) {
    const A = rows.map((r) => r.map((x) => fr(BigInt(x))));
    const pivots = [];
    let r = 0;
    for (let c = 0; c < n && r < A.length; c++) {
      let p = r;
      while (p < A.length && A[p][c][0] === 0n) p++;
      if (p === A.length) continue;
      [A[r], A[p]] = [A[p], A[r]];
      const lv = A[r][c];
      A[r] = A[r].map((x) => fdiv(x, lv));
      for (let i = 0; i < A.length; i++) {
        if (i === r || A[i][c][0] === 0n) continue;
        const f = A[i][c];
        A[i] = A[i].map((x, j) => fsub(x, fmul(f, A[r][j])));
      }
      pivots.push(c);
      r++;
    }
    const free = [];
    for (let c = 0; c < n; c++) if (!pivots.includes(c)) free.push(c);
    return free.map((f) => {
      const v = Array.from({ length: n }, () => fr(0n));
      v[f] = fr(1n);
      pivots.forEach((pc, i) => { v[pc] = fr(-A[i][f][0], A[i][f][1]); });
      return v;
    });
  }
  // a fraction vector as the smallest whole numbers in the same ratio, the first one not negative
  function whole(v) {
    let L = 1n;
    v.forEach(([, d]) => { L = (L / bgcd(L, d)) * d; });
    let ints = v.map(([nn, d]) => nn * (L / d));
    const g = ints.reduce((a, b) => bgcd(a, b), 0n) || 1n;
    ints = ints.map((x) => x / g);
    if (ints.some((x) => x < 0n) && !ints.some((x) => x > 0n)) ints = ints.map((x) => -x);
    return ints;
  }
  function matrix(eq, withCharge) {
    const nL = eq.left.length;
    const sign = (j) => (j < nL ? 1 : -1);
    const rows = eq.elements.map((el) => eq.species.map((x, j) => (x.atoms[el] || 0) * sign(j)));
    if (withCharge && eq.charged) rows.push(eq.species.map((x, j) => x.charge * sign(j)));
    return rows;
  }

  // the smallest whole-number coefficients, or a ChemError saying why there are none
  function balance(eq) {
    if (typeof eq === 'string') eq = parseEquation(eq);
    for (const el of eq.elements) {
      const l = eq.left.some((x) => x.atoms[el]), r = eq.right.some((x) => x.atoms[el]);
      if (!l || !r) fail(`${el} is only in the ${l ? 'reactants' : 'products'}: every element must be on both sides`);
    }
    const n = eq.species.length;
    const ns = nullspace(matrix(eq, true), n);
    if (!ns.length) {
      if (eq.charged) {
        const atomsOnly = nullspace(matrix(eq, false), n);
        if (atomsOnly.length === 1) {
          const v = whole(atomsOnly[0]).map(Number);
          if (v.every((x) => x > 0)) {
            const t = tally(eq, v).pop();
            fail(`the atoms balance (${v.join(',')}) but the charge doesn't (${signed(t.left)} on the left, ${signed(t.right)} on the right): add electrons (e^-) or check the charges`);
          }
        }
      }
      fail('it can\'t be balanced: no whole numbers make every element equal on both sides (check each formula)');
    }
    if (ns.length > 1) fail('it balances in more than one independent way (it mixes two reactions), so there is no single answer; give one reaction');
    const v = whole(ns[0]);
    const zero = v.findIndex((x) => x === 0n);
    if (zero >= 0) fail(`"${eq.species[zero].text}" would need a coefficient of 0: it takes no part, so leave it out (or check the formulas)`);
    if (v.some((x) => x < 0n)) {
      const neg = eq.species[v.findIndex((x) => x < 0n)];
      fail(`it can't be balanced with "${neg.text}" on that side of the arrow (check the formulas)`);
    }
    const out = v.map(Number);
    const big = Math.max(...out);
    if (big > LIMITS.coef) fail(`the smallest balance needs a coefficient of ${big} (${out.join(',')}): too big for a lesson; choose a simpler equation`);
    return out;
  }
  const signed = (x) => (x > 0 ? '+' + x : String(x));

  // in words: "4 Fe + 3 O₂ → 2 Fe₂O₃" (no coefficient: blanks, "□ Fe + □ O₂ …")
  function eqPlain(eq, coefs, blank) {
    const term = (x, j) => (coefs ? (coefs[j] === 1 ? '' : coefs[j] + ' ') : blank ? blank + ' ' : '') + plain(x.text);
    const nL = eq.left.length;
    return eq.left.map((x, j) => term(x, j)).join(' + ') + ' → ' + eq.right.map((x, j) => term(x, j + nL)).join(' + ');
  }

  /* ---------------- atoms ---------------- */

  // the order subshells fill in: [n, l, capacity]
  const AUFBAU = [[1, 0, 2], [2, 0, 2], [2, 1, 6], [3, 0, 2], [3, 1, 6], [4, 0, 2], [3, 2, 10], [4, 1, 6], [5, 0, 2], [4, 2, 10], [5, 1, 6], [6, 0, 2]];
  function fillTo(k) { return AUFBAU.map(([n, l, cap]) => { const x = Math.min(cap, Math.max(0, k)); k -= x; return [n, l, x]; }); }
  // electrons in each shell (K, L, M, N...) for e electrons around Z protons
  function shells(Z, e) {
    let c;
    if (e >= Z) {
      c = fillTo(e);
      if (e === Z && (Z === 24 || Z === 29)) { c[5][2] -= 1; c[6][2] += 1; } // chromium and copper: 3d5 4s1, 3d10 4s1
    } else {
      c = fillTo(Z);
      if (Z === 24 || Z === 29) { c[5][2] -= 1; c[6][2] += 1; }
      let k = Z - e; // an ion: electrons leave the outermost shell first (4s before 3d)
      const order = c.map((x, i) => i).sort((a, b) => c[b][0] - c[a][0] || c[b][1] - c[a][1]);
      for (const i of order) { const x = Math.min(c[i][2], k); c[i][2] -= x; k -= x; if (!k) break; }
    }
    const out = [];
    c.forEach(([n, , x]) => { out[n - 1] = (out[n - 1] || 0) + x; });
    for (let i = 0; i < out.length; i++) out[i] = out[i] || 0;
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }
  const valence = (Z, e) => { const s = shells(Z, e); return s.length ? s[s.length - 1] : 0; };
  const isStable = (Z, n) => Boolean(STABLE[Z] && STABLE[Z].includes(n));
  // neutron counts an isotope of Z can sensibly have in a lesson (its stable ones, give or take a few)
  function plausibleN(Z) {
    const s = STABLE[Z];
    if (!s) return [0, 0];
    return [Math.max(0, Math.min(...s) - 3), Math.max(...s) + 4];
  }

  function atomFacts(p, n, e) {
    const sh = shells(p, e);
    const charge = p - e;
    return {
      Z: p, symbol: symbolOf(p), name: nameOf(p), A: p + n, N: n, electrons: e, charge, shells: sh,
      valence: sh.length ? sh[sh.length - 1] : 0,
      stable: isStable(p, n), stableN: STABLE[p] ? STABLE[p].slice() : [],
      ionName: charge ? ionName(symbolOf(p), charge) : '',
      commonIon: !charge || Boolean(IONS_OF[p] && IONS_OF[p].includes(charge))
    };
  }
  // how far the counts can go in a lab that goes up to max protons
  const atomLimits = (max) => ({ p: max, n: Math.min(40, Math.round(max * 1.4) + 4), e: max + 4 });

  /* ---------------- ions and valency ---------------- */

  function parseIon(raw) {
    if (typeof raw !== 'string') fail('each ion must be a string, like "Na^+" or "SO4^2-"');
    const sp = parseSpecies(raw);
    if (sp.electron) fail('an electron is not an ion to combine');
    if (sp.coef !== 1) fail(`"${short(raw)}": an ion in the list has no number before it`);
    if (!sp.charge) fail(`"${short(raw)}" has no charge: write it as "Na^+" or "SO4^2-"`);
    if (Math.abs(sp.charge) > LIMITS.ionCharge) fail(`"${short(raw)}": a charge of ${sp.charge} is too big for this`);
    if (sp.body.includes('·')) fail(`"${short(raw)}" is not an ion`);
    return {
      text: sp.body + chargeText(sp.charge), body: sp.body, charge: sp.charge, atoms: sp.atoms,
      poly: !/^[A-Z][a-z]?$/.test(sp.body), name: ionName(sp.body, sp.charge)
    };
  }
  // the counts that make a cation and an anion neutral, smallest first: Al^3+ and O^2- -> [2, 3]
  function crissCross(cat, an) {
    const g = gcd(cat.charge, an.charge);
    return [Math.abs(an.charge) / g, Math.abs(cat.charge) / g];
  }
  function formulaOf(cat, an, nc, na) {
    const part = (ion, k) => (k === 1 ? ion.body : ion.poly ? `(${ion.body})${k}` : ion.body + k);
    return part(cat, nc) + part(an, na);
  }
  function atomsOf(cat, an, nc, na) {
    const out = {};
    addInto(out, cat.atoms, nc);
    addInto(out, an.atoms, na);
    return out;
  }

  /* ---------------- specs ---------------- */

  const MODES = ['balance', 'atom', 'compound'];
  function modeOf(spec) {
    if (!isObj(spec)) fail('the spec must be an object');
    let mode = typeof spec.mode === 'string' ? spec.mode.trim().toLowerCase() : '';
    if (!mode) mode = has(spec, 'equation') ? 'balance' : has(spec, 'ions') ? 'compound' : (has(spec, 'protons') || has(spec, 'element')) ? 'atom' : '';
    if (!MODES.includes(mode)) fail(`"mode" must be "balance", "atom" or "compound"${spec.mode ? `, not "${short(spec.mode, 20)}"` : ''}`);
    return mode;
  }
  function int(v, lo, hi, what) {
    const x = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
    if (!Number.isInteger(x) || x < lo || x > hi) fail(`${what} must be a whole number from ${lo} to ${hi}${v === undefined ? '' : `, not ${short(JSON.stringify(v), 20)}`}`);
    return x;
  }
  function elementZ(v, what) {
    const sym = typeof v === 'string' ? v.trim() : '';
    const z = zOf(sym) || (sym ? NAMES.findIndex((nm) => nm.toLowerCase() === sym.toLowerCase()) + 1 : 0);
    if (!z) fail(`${what} "${short(String(v), 20)}" is not an element symbol (like "C" or "Na")`);
    return z;
  }

  // a balance spec; task: true makes it a task's (coefficients in the equation are ignored)
  function normBalance(spec, task) {
    const eq = parseEquation(spec.equation);
    const answer = balance(eq);
    let start = task ? eq.species.map(() => 1) : eq.coefs.slice();
    if (spec.start != null) {
      if (!Array.isArray(spec.start) || spec.start.length !== eq.species.length) fail(`"start" must list ${eq.species.length} coefficients, one for each formula`);
      start = spec.start.map((x) => int(x, 1, LIMITS.stepper, 'each start coefficient'));
    }
    return { spec: { mode: 'balance', equation: eq.text, start }, eq, answer };
  }

  const ATOM_KEYS = ['protons', 'neutrons', 'electrons'];
  const HIDE = ['name', 'mass', 'charge', 'shells', 'valence', 'stable'];
  function normAtom(spec, needZ) {
    let p, n, e;
    if (spec.element != null) {
      p = elementZ(spec.element, '"element"');
      if (spec.protons != null && int(spec.protons, 1, LIMITS.zAtom, '"protons"') !== p) fail(`"element" ${symbolOf(p)} has ${p} protons, but "protons" is ${spec.protons}`);
      if (p > LIMITS.zAtom) fail(`${symbolOf(p)} has ${p} protons: the atom lab goes up to ${LIMITS.zAtom} (zinc)`);
      n = spec.neutrons != null ? int(spec.neutrons, 0, 40, '"neutrons"') : spec.mass != null ? int(spec.mass, 1, 70, '"mass"') - p : STABLE[p][0];
      if (n < 0) fail(`a mass number of ${spec.mass} is less than ${symbolOf(p)}'s ${p} protons`);
    } else {
      p = spec.protons != null ? int(spec.protons, 1, LIMITS.zAtom, '"protons"') : 1;
      n = spec.neutrons != null ? int(spec.neutrons, 0, 40, '"neutrons"') : spec.mass != null ? int(spec.mass, 1, 70, '"mass"') - p : p === 1 ? 0 : STABLE[p][0];
      if (n < 0) fail(`a mass number of ${spec.mass} is less than ${p} protons`);
    }
    e = spec.electrons != null ? int(spec.electrons, 0, LIMITS.zAtom + 4, '"electrons"') : p;
    let max = spec.max != null ? int(spec.max, 2, LIMITS.zAtom, '"max"') : 20;
    max = Math.max(max, p, needZ || 0);
    const lim = atomLimits(max);
    if (n > lim.n) fail(`${n} neutrons is more than this lab's ${lim.n} (raise "max" or use fewer)`);
    if (e > lim.e) fail(`${e} electrons is more than this lab's ${lim.e}`);
    const lock = [];
    if (spec.lock != null) {
      if (!Array.isArray(spec.lock)) fail('"lock" must be a list, like ["protons"]');
      spec.lock.forEach((k) => {
        const key = typeof k === 'string' ? k.trim().toLowerCase() : '';
        if (!ATOM_KEYS.includes(key)) fail(`"lock" can hold "protons", "neutrons" and "electrons", not ${short(JSON.stringify(k), 20)}`);
        if (!lock.includes(key)) lock.push(key);
      });
      if (lock.length === 3) fail('"lock" can\'t hold all three counts: then there is nothing to try');
    }
    const hide = [];
    if (spec.hide != null) {
      if (!Array.isArray(spec.hide)) fail('"hide" must be a list, like ["name"]');
      spec.hide.forEach((k) => {
        const key = typeof k === 'string' ? k.trim().toLowerCase() : '';
        if (!HIDE.includes(key)) fail(`"hide" can hold ${HIDE.map((x) => `"${x}"`).join(', ')}, not ${short(JSON.stringify(k), 20)}`);
        if (!hide.includes(key)) hide.push(key);
      });
    }
    const out = { mode: 'atom', protons: p, neutrons: n, electrons: e, max };
    if (lock.length) out.lock = lock;
    if (hide.length) out.hide = hide;
    return out;
  }

  const GOAL_KEYS = ['element', 'protons', 'neutrons', 'electrons', 'mass', 'charge', 'valence', 'stable'];
  function normAtomGoal(goal) {
    Object.keys(goal).forEach((k) => {
      if (!GOAL_KEYS.includes(k)) fail(`the atom goal has an unknown key "${short(k, 20)}" (use ${GOAL_KEYS.join(', ')})`);
    });
    const g = {};
    if (goal.element != null) g.element = symbolOf(elementZ(goal.element, 'the goal\'s "element"'));
    if (goal.protons != null) g.protons = int(goal.protons, 1, LIMITS.zAtom, 'the goal\'s "protons"');
    if (goal.neutrons != null) g.neutrons = int(goal.neutrons, 0, 40, 'the goal\'s "neutrons"');
    if (goal.electrons != null) g.electrons = int(goal.electrons, 0, LIMITS.zAtom + 4, 'the goal\'s "electrons"');
    if (goal.mass != null) g.mass = int(goal.mass, 1, 70, 'the goal\'s "mass"');
    if (goal.charge != null) g.charge = int(goal.charge, -4, 4, 'the goal\'s "charge"');
    if (goal.valence != null) g.valence = int(goal.valence, 0, 8, 'the goal\'s "valence" (electrons in the outer shell)');
    if (goal.stable != null) {
      if (typeof goal.stable !== 'boolean') fail('the goal\'s "stable" must be true or false');
      g.stable = goal.stable;
    }
    if (!Object.keys(g).length) fail('the atom goal needs at least one of protons, neutrons, electrons, element, mass, charge, valence, stable');
    if (!has(g, 'electrons') && !has(g, 'charge')) g.charge = 0; // an atom, unless an ion is asked for
    // what it fixes must agree
    const Z = g.element ? zOf(g.element) : 0;
    if (Z > LIMITS.zAtom) fail(`${g.element} has ${Z} protons: the atom lab goes up to ${LIMITS.zAtom} (zinc)`);
    if (Z && has(g, 'protons') && g.protons !== Z) fail(`${g.element} has ${Z} protons, but the goal's "protons" is ${g.protons}`);
    const P = Z || g.protons || 0;
    if (P) {
      const name = g.element || symbolOf(P);
      let N = has(g, 'neutrons') ? g.neutrons : null;
      if (has(g, 'mass')) {
        if (g.mass - P < 0) fail(`a mass number of ${g.mass} is less than ${name}'s ${P} protons`);
        if (N != null && g.mass !== P + N) fail(`${P} protons and ${N} neutrons make a mass number of ${P + N}, not ${g.mass}`);
        N = g.mass - P;
      }
      if (N != null) {
        const [lo, hi] = plausibleN(P);
        if (N < lo || N > hi) fail(`${name}-${P + N} would have ${N} neutrons, far from ${name}'s isotopes (about ${lo} to ${hi} neutrons; its stable ones have ${STABLE[P].slice().sort((a, b) => a - b).join(', ')})`);
        if (has(g, 'stable') && isStable(P, N) !== g.stable) fail(`${name}-${P + N} is ${isStable(P, N) ? '' : 'not '}stable, but the goal's "stable" is ${g.stable}`);
      }
      let C = has(g, 'charge') ? g.charge : null;
      if (has(g, 'electrons')) {
        if (C != null && P - g.electrons !== C) fail(`${P} protons and ${g.electrons} electrons make a charge of ${signed(P - g.electrons)}, not ${signed(C)}`);
        C = P - g.electrons;
      }
      if (C != null && C !== 0 && !IONS_OF[P].includes(C)) {
        const usual = IONS_OF[P].map((c) => name + chargeText(c)).join(' or ');
        fail(`${name} with a charge of ${signed(C)} is not one of its ions${usual ? ` (${name} forms ${usual})` : ` (${name} doesn't usually form a simple ion)`}`);
      }
      if (has(g, 'valence') && C != null) {
        const v = valence(P, P - C);
        if (v !== g.valence) fail(`${name}${chargeText(C)} has ${v} electrons in its outer shell, not ${g.valence}`);
      }
    }
    return g;
  }
  // does (p, n, e) meet an atom goal? { ok, why: the first thing that is wrong }
  function meetsAtom(g, p, n, e) {
    const f = { protons: p, neutrons: n, electrons: e, mass: p + n, charge: p - e };
    if (g.element && zOf(g.element) !== p) return { ok: false, why: 'element' };
    for (const k of ['protons', 'mass', 'neutrons', 'electrons', 'charge']) if (has(g, k) && g[k] !== f[k]) return { ok: false, why: k };
    if (has(g, 'valence') && valence(p, e) !== g.valence) return { ok: false, why: 'valence' };
    if (has(g, 'stable') && isStable(p, n) !== g.stable) return { ok: false, why: 'stable' };
    return { ok: true };
  }
  // the best way to meet it from the spec's counts: a common, stable isotope, a usual ion, few changes
  function atomSolution(spec, g) {
    const lim = atomLimits(spec.max);
    const locked = (k) => Boolean(spec.lock && spec.lock.includes(k));
    let best = null, bestScore = Infinity;
    const P0 = g.element ? [zOf(g.element)] : has(g, 'protons') ? [g.protons] : null;
    for (let p = 1; p <= lim.p; p++) {
      if (locked('protons') && p !== spec.protons) continue;
      if (P0 && !P0.includes(p)) continue;
      for (let n = 0; n <= lim.n; n++) {
        if (locked('neutrons') && n !== spec.neutrons) continue;
        for (let e = 0; e <= lim.e; e++) {
          if (locked('electrons') && e !== spec.electrons) continue;
          if (!meetsAtom(g, p, n, e).ok) continue;
          const st = STABLE[p] || [];
          const score = (n === st[0] ? 0 : st.includes(n) ? 1000 : 2000) + (p - e && !(IONS_OF[p] || []).includes(p - e) ? 500 : 0)
            + Math.abs(p - spec.protons) + Math.abs(n - spec.neutrons) + Math.abs(e - spec.electrons);
          if (score < bestScore) { bestScore = score; best = { p, n, e }; }
        }
      }
    }
    return best;
  }

  function normCompound(spec) {
    if (!Array.isArray(spec.ions)) fail('"ions" must be a list of ions, like ["Na^+", "Cl^-"]');
    const seen = new Set();
    const ions = [];
    spec.ions.forEach((raw) => {
      const ion = parseIon(raw);
      if (!seen.has(ion.text)) { seen.add(ion.text); ions.push(ion); }
    });
    if (ions.length > LIMITS.ions) fail(`too many ions (at most ${LIMITS.ions})`);
    if (!ions.some((x) => x.charge > 0) || !ions.some((x) => x.charge < 0)) fail('"ions" needs at least one positive ion (like "Na^+") and one negative ion (like "Cl^-")');
    return { spec: { mode: 'compound', ions: ions.map((x) => x.text) }, ions };
  }
  function normCompoundGoal(goal, ions) {
    Object.keys(goal).forEach((k) => { if (k !== 'formula' && k !== 'name') fail(`the compound goal has an unknown key "${short(k, 20)}" (use "formula")`); });
    if (typeof goal.formula !== 'string') fail('the compound goal needs "formula", the neutral formula, like "Al2O3"');
    const want = parseFormula(goal.formula);
    const cats = ions.filter((x) => x.charge > 0), ans = ions.filter((x) => x.charge < 0);
    const pairs = [];
    cats.forEach((c) => ans.forEach((a) => { const k = crissCross(c, a); pairs.push({ c, a, k, atoms: atomsOf(c, a, k[0], k[1]), formula: formulaOf(c, a, k[0], k[1]) }); }));
    const hit = pairs.find((x) => sameAtoms(x.atoms, want.atoms));
    if (hit) return { formula: hit.formula };
    // what went wrong: a multiple, the wrong numbers, or ions that aren't in the list
    for (const x of pairs) {
      const els = Object.keys(x.atoms);
      if (els.length !== Object.keys(want.atoms).length || !els.every((el) => want.atoms[el])) continue;
      const k = want.atoms[els[0]] / x.atoms[els[0]];
      if (Number.isInteger(k) && k > 1 && els.every((el) => want.atoms[el] === x.atoms[el] * k)) fail(`the goal "${short(goal.formula, 20)}" is not in the smallest whole numbers: write "${x.formula}"`);
      fail(`the goal "${short(goal.formula, 20)}" is not neutral: ${x.c.text} and ${x.a.text} make "${x.formula}"`);
    }
    fail(`the goal "${short(goal.formula, 20)}" can't be made from the ions given (${ions.map((x) => x.text).join(', ')}): add the ions it needs to "ions"`);
    return null;
  }

  // A spec, checked and cleaned (throws a ChemError saying why not)
  function normSpec(spec) {
    const mode = modeOf(spec);
    if (mode === 'balance') return normBalance(spec, false).spec;
    if (mode === 'atom') return normAtom(spec);
    return normCompound(spec).spec;
  }

  // A task: its spec and goal, checked; the goal must be reachable and not met at the start
  function normTask(spec, goal) {
    const mode = modeOf(spec);
    if (!isObj(goal)) fail('the goal must be an object');
    if (mode === 'balance') {
      Object.keys(goal).forEach((k) => { if (!['coefficients', 'multiples', 'answer'].includes(k)) fail(`the balance goal has an unknown key "${short(k, 20)}" (use "coefficients" or "multiples")`); });
      const b = normBalance(spec, true);
      const multiples = goal.multiples === true;
      if (goal.multiples != null && typeof goal.multiples !== 'boolean') fail('the goal\'s "multiples" must be true or false');
      const said = goal.coefficients != null ? goal.coefficients : goal.answer;
      if (said != null) {
        if (!Array.isArray(said) || said.length !== b.eq.species.length || !said.every((x) => Number.isInteger(x) && x > 0)) {
          fail(`the goal's "coefficients" must be ${b.eq.species.length} whole numbers, one for each formula; the smallest balance is ${b.answer.join(',')}`);
        }
        if (!balanced(b.eq, said)) {
          const r = tally(b.eq, said).find((x) => x.left !== x.right);
          fail(`${b.eq.text}: the answer ${said.join(',')} leaves ${r.el || 'the charge'} unbalanced (${r.left} left, ${r.right} right); the smallest balance is ${b.answer.join(',')}`);
        }
        if (!multiples && said.reduce(gcd, 0) > 1) fail(`${b.eq.text}: the answer ${said.join(',')} balances but is not the smallest; the smallest is ${b.answer.join(',')} (or set "multiples": true)`);
      }
      if (balanced(b.eq, b.spec.start)) {
        fail(b.spec.start.every((x) => x === 1)
          ? `"${b.eq.text}" is already balanced with every coefficient 1, so there is nothing to do; choose an equation that needs balancing`
          : `the "start" coefficients already balance "${b.eq.text}"`);
      }
      return { spec: b.spec, goal: { coefficients: b.answer, multiples } };
    }
    if (mode === 'atom') {
      const g = normAtomGoal(goal);
      const s = normAtom(spec, g.element ? zOf(g.element) : g.protons || 0);
      if (meetsAtom(g, s.protons, s.neutrons, s.electrons).ok) {
        fail(`the starting counts (${s.protons} protons, ${s.neutrons} neutrons, ${s.electrons} electrons) already meet the goal; start from other counts (or leave them out: 1, 0, 1)`);
      }
      if (!atomSolution(s, g)) {
        const lim = atomLimits(s.max);
        fail(`no atom in this lab (1 to ${lim.p} protons, 0 to ${lim.n} neutrons, 0 to ${lim.e} electrons${s.lock ? `, with ${s.lock.join(' and ')} locked` : ''}) meets the goal ${JSON.stringify(g)}`);
      }
      return { spec: s, goal: g };
    }
    const c = normCompound(spec);
    return { spec: c.spec, goal: normCompoundGoal(goal, c.ions) };
  }

  /* ---------------- the learner's attempt ---------------- */

  // { correct, invalid?, why: {...} } for a checked spec and goal
  function check(spec, goal, value) {
    if (!isObj(value)) return { correct: false, invalid: true, why: {} };
    if (spec.mode === 'balance') {
      const eq = parseEquation(spec.equation);
      const c = value.c;
      if (!Array.isArray(c) || c.length !== eq.species.length || !c.every((x) => Number.isInteger(x) && x >= 1 && x <= LIMITS.stepper)) return { correct: false, invalid: true, why: {} };
      const rows = tally(eq, c);
      const off = rows.filter((r) => r.left !== r.right);
      if (off.length) return { correct: false, why: { rows: off } };
      const g = c.reduce(gcd, 0);
      if (!goal.multiples && g > 1) return { correct: false, why: { divide: g } };
      return { correct: true, why: {} };
    }
    if (spec.mode === 'atom') {
      const { p, n, e } = value;
      const lim = atomLimits(spec.max);
      if (![p, n, e].every(Number.isInteger) || p < 1 || p > lim.p || n < 0 || n > lim.n || e < 0 || e > lim.e) return { correct: false, invalid: true, why: {} };
      const m = meetsAtom(goal, p, n, e);
      return { correct: m.ok, why: m.ok ? {} : { atom: m.why, facts: atomFacts(p, n, e) } };
    }
    // compound
    const ions = spec.ions.map(parseIon);
    const pick = Array.isArray(value.ions) ? value.ions : [];
    const cat = ions.find((x) => x.text === pick[0] && x.charge > 0), an = ions.find((x) => x.text === pick[1] && x.charge < 0);
    if (!cat || !an) return { correct: false, invalid: true, why: { pick: true } };
    const k = Array.isArray(value.n) ? value.n : [];
    if (!k.every((x) => Number.isInteger(x) && x >= 1 && x <= LIMITS.count) || k.length !== 2) return { correct: false, invalid: true, why: { pick: true } };
    const total = k[0] * cat.charge + k[1] * an.charge;
    if (total) return { correct: false, why: { charge: total } };
    const want = parseFormula(goal.formula).atoms;
    const got = atomsOf(cat, an, k[0], k[1]);
    if (sameAtoms(got, want)) return { correct: true, why: {} };
    const g = gcd(k[0], k[1]);
    const low = crissCross(cat, an);
    if (g > 1 && sameAtoms(atomsOf(cat, an, low[0], low[1]), want)) return { correct: false, why: { divide: g } };
    return { correct: false, why: { other: formulaOf(cat, an, low[0], low[1]) } };
  }

  // a right answer, as a value (for "show the answer")
  function solution(spec, goal) {
    if (spec.mode === 'balance') return { c: goal.coefficients.slice() };
    if (spec.mode === 'atom') return atomSolution(spec, goal);
    const ions = spec.ions.map(parseIon);
    const want = parseFormula(goal.formula).atoms;
    for (const c of ions.filter((x) => x.charge > 0)) {
      for (const a of ions.filter((x) => x.charge < 0)) {
        const k = crissCross(c, a);
        if (sameAtoms(atomsOf(c, a, k[0], k[1]), want)) return { ions: [c.text, a.text], n: k };
      }
    }
    return null;
  }

  return {
    LIMITS, SYMBOLS, NAMES, ION_NAMES, ION_LIST, STABLE, IONS_OF, ChemError,
    zOf, symbolOf, nameOf, ionName,
    tidy, parseSpecies, parseFormula, parseEquation, splitSide, tally, balanced, balance, nullspace,
    pieces, plain, eqPlain, chargeText,
    shells, valence, isStable, atomFacts, atomLimits, plausibleN,
    parseIon, crissCross, formulaOf, atomsOf, sameAtoms,
    normSpec, normTask, meetsAtom, atomSolution, check, solution, modeOf
  };
});
