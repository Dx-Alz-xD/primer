// =====================================================================
// The chemistry lab, for lessons on chemistry (server/widgets.mjs), in
// three modes:
//   balance   an equation with a coefficient before each formula and a
//             live count of every element on each side
//   atom      an atom or ion built from protons, neutrons and electrons:
//             its element, mass number, charge, A and Z, Bohr shells
//   compound  ions combined into a neutral formula (valency, criss-cross)
// and tasks done in it: balance this, build carbon-12 or Na+, make the
// formula of aluminium oxide.
//
// The chemistry and the checks are shared with the page, in
// assets/js/widgets/chem-core.js: every formula must read (real element
// symbols, closed brackets), every equation must balance in exactly one
// way with every element on both sides, every atom goal must agree with
// itself and be reachable, every compound goal must be the neutral
// formula of two of the spec's ions. Anything else is left out, and why()
// says why in a line the AI can act on.
//
// The spec has no free words to translate: element and ion names come
// from the page's own lists (chem-core.js NAMES and ION_NAMES).
// PRIMER_WIDGET_DEBUG=1 logs why a part was left out.
// =====================================================================
import core from '../../assets/js/widgets/chem-core.js';

export const label = 'a chemistry lab (balancing equations, building atoms and ions, writing formulae)';

/* ---------- which lessons are offered it ---------- */

const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const word = (w) => START + w + END;   // a whole word
const stem = (w) => START + w;         // a word that starts so
const any = (w) => w;                  // anywhere (scripts where words join up)

// Words that say chemistry wherever they appear.
const STRONG = [
  // English
  stem('chemi(?:cal|stry)'), stem('stoichiometr'), word('reactants?'), stem('valenc[ey]'), word('valency'), word('valencies'),
  word('atomic (?:structure|number|mass|theory|model|radius|orbitals?)'), word('structure of (?:the |an )?atoms?'), word('atoms and molecules'),
  word('protons?'), word('neutrons?'), word('isotopes?'), word('periodic table'), word('bohr(?:\'s|’s)?(?: atomic)? model'), word('bohr'),
  word('electron(?:ic)? (?:configuration|arrangement|shells?|distribution)'), word('subatomic'), word('nucleons?'),
  word('(?:combination|decomposition|displacement|double displacement|precipitation|redox|neutrali[sz]ation|exothermic|endothermic|oxidation|reduction|combustion) reactions?'),
  word('oxidation (?:state|number)s?'), word('oxidi[sz](?:ing|ed|ation)'), word('redox'), word('half[- ]equations?'), word('oxidation and reduction'), word('reducing agents?'),
  word('molar mass'), word('mole concept'), word('the mole'), word('avogadro'), word('molecular (?:formula|mass)'), word('formula (?:unit|mass)'),
  word('ionic (?:compounds?|bonds?|bonding|equations?)'), word('covalent'), word('polyatomic'), word('cations?'), word('anions?'),
  word('law of (?:conservation of mass|constant proportions|definite proportions|multiple proportions)'), word('dalton(?:\'s|’s)? atomic theory'),
  word('rutherford'), word('thomson(?:\'s|’s)? (?:model|atom)'), word('hydrocarbons?'), word('alkanes?'), word('alkenes?'), word('alkynes?'),
  word('metals and non[- ]?metals'), word('acids?,? bases? and salts?'), word('carbon and its compounds'), word('rancidity'), word('electrolysis'),
  word('reactions? of metals'), word('balanc(?:e|es|ed|ing) (?:the )?(?:chemical )?equations?'), word('balancing equations?'),
  word('noble gas(?:es)?'), word('alkali metals?'), word('halogens?'), word('molecules? and ions?'),
  // Hindi, Marathi, Bhojpuri, Maithili (Devanagari)
  any('रासायनिक'), any('रसायन'), any('परमाणु'), any('परमाणू'), any('संयोजकता'), any('संयुजा'), any('प्रोटॉन'), any('प्रोटोन'), any('न्यूट्रॉन'),
  any('न्यूट्रोन'), any('समस्थानिक'), any('समभारिक'), any('आवर्त सारणी'), any('आवर्त सारिणी'), any('अभिकारक'), any('अभिक्रिया'), any('आयनिक'),
  any('धनायन'), any('ऋणायन'), any('इलेक्ट्रॉनिक विन्यास'), any('इलेक्ट्रॉन विन्यास'), any('मूलद्रव्य'), any('संयुग'), any('अणुसूत्र'), any('रेणू'),
  any('उपचयन'), any('अपचयन'), any('ऑक्सीकरण'),
  // Bengali, Assamese
  any('রাসায়নিক'), any('ৰাসায়নিক'), any('রসায়ন'), any('ৰসায়ন'), any('পরমাণু'), any('পৰমাণু'), any('যোজ্যতা'), any('প্রোটন'), any('প্ৰ’টন'),
  any('নিউট্রন'), any('আইসোটোপ'), any('পর্যায় সারণি'), any('বিক্রিয়া'), any('বিক্ৰিয়া'),
  // Tamil
  any('வேதி'), any('அணுக்கள்'), any('அணுவின்'), any('அணு அமைப்பு'), any('அணு எண்'), any('இணைதிறன்'), any('ஐசோடோப்'), any('புரோட்டான்'),
  any('நியூட்ரான்'), any('தனிம வரிசை'), any('சேர்மங்கள்'),
  // Telugu
  any('రసాయన'), any('పరమాణు'), any('సంయోజకత'), any('ఐసోటోప'), any('ప్రోటాన్'), any('న్యూట్రాన్'), any('ఆవర్తన పట్టిక'),
  // Kannada
  any('ರಾಸಾಯನಿಕ'), any('ರಸಾಯನ'), any('ಪರಮಾಣು'), any('ವೇಲೆನ್ಸಿ'), any('ಸಂಯೋಜಕತೆ'), any('ಐಸೋಟೋಪ್'), any('ಪ್ರೋಟಾನ್'), any('ನ್ಯೂಟ್ರಾನ್'), any('ಆವರ್ತಕ ಕೋಷ್ಟಕ'),
  // Malayalam
  any('രാസപ്രവർത്തന'), any('രാസസമവാക്യ'), any('രാസ സമവാക്യ'), any('രസതന്ത്ര'), any('ആറ്റം'), any('ആറ്റങ്ങ'), any('ആറ്റത്തി'), any('സംയോജകത'),
  any('ഐസോടോപ്പ'), any('പ്രോട്ടോൺ'), any('ന്യൂട്രോൺ'), any('ആവർത്തനപ്പട്ടിക'),
  // Gujarati
  any('રાસાયણિક'), any('રસાયણ'), any('પરમાણુ'), any('સંયોજકતા'), any('સમસ્થાનિક'), any('પ્રોટોન'), any('ન્યુટ્રોન'), any('આવર્ત કોષ્ટક'),
  // Punjabi
  any('ਰਸਾਇਣ'), any('ਪਰਮਾਣੂ'), any('ਸੰਯੋਜਕਤਾ'), any('ਪ੍ਰੋਟੋਨ'), any('ਨਿਊਟ੍ਰੋਨ'), any('ਆਈਸੋਟੋਪ'), any('ਆਵਰਤੀ ਸਾਰਣੀ'),
  // Odia
  any('ରାସାୟନିକ'), any('ରସାୟନ'), any('ପରମାଣୁ'), any('ଯୋଜ୍ୟତା'), any('ପ୍ରୋଟନ'), any('ନ୍ୟୁଟ୍ରନ'),
  // Urdu
  any('کیمیائی'), any('کیمیا'), any('ایٹم'), any('پروٹون'), any('نیوٹران'), any('آئسوٹوپ'), any('دوری جدول'),
  // Arabic (الذرة is also maize, and تكافؤ also "equality", so they are weak words below)
  any('كيميائي'), any('الكيمياء'), any('كيمياء'), any('بروتون'), any('نيوترون'), any('الجدول الدوري'), any('الذرات'), any('العدد الذري'), any('البنية الذرية'),
  // Spanish, Portuguese, French
  word('qu[ií]mic[ao]s?'), stem('estequiometr'), stem('[aá]tomos?'), stem('prot[oó]n'), stem('neutr[oó]n'), stem('is[oó]topo'), word('tabla peri[oó]dica'),
  word('tabela peri[oó]dica'), word('reactivos'), word('reagentes'), stem('prot[aã]o'), stem('neutr[aã]o'),
  word('chimi(?:e|que)s?'), stem('st[oœ]chiom[ée]tri'), stem('atomes?'), word('isotopes?'), word('tableau p[ée]riodique'), word('r[ée]actifs'),
  // Russian
  stem('химическ'), stem('хими'), stem('атом'), stem('протон'), stem('нейтрон'), stem('изотоп'), stem('валентност'), word('таблица менделеева'),
  word('периодическ(?:ая|ой) (?:таблиц|систем)[а-я]*'), stem('стехиометр'), stem('молекул'), stem('окислени'),
  // German
  stem('chemisch'), stem('chemie'), stem('periodensystem')
];
// Words that may mean chemistry: two different ones together are enough. The generic ones ('g': equations,
// formulae, metals, electrons, products...) also belong to mathematics or physics, so they count only
// beside a word of the first kind ("reactions of acids", but not "equations and formulae").
const WEAK = [
  ['atom', word('atoms?')], ['molecule', word('molecules?')], ['element', word('elements?')], ['compound', word('compounds?')], ['ion', word('ions?')],
  ['acid', word('acids?')], ['salt', word('salts?')], ['oxygen', word('oxygen')], ['hydrogen', word('hydrogen')], ['nitrogen', word('nitrogen')],
  ['oxide', stem('oxides?')], ['carbonate', stem('carbonates?')], ['sulphate', stem('sul(?:ph|f)ates?')], ['isobar', word('isobars?')],
  ['rust', word('rust(?:ing)?')], ['corrosion', word('corrosion')], ['oxidation', word('oxidation')], ['combustion', word('combustion')],
  ['gas', word('gas(?:es)?'), 'g'], ['nucleus', word('nucle(?:us|i)'), 'g'], ['metal', word('metals?'), 'g'], ['electron', word('electrons?'), 'g'],
  ['reaction', word('reactions?'), 'g'], ['equation', word('equations?'), 'g'], ['formula', word('formula(?:e|s)?'), 'g'], ['mass', word('mass(?:es)?'), 'g'],
  ['product', word('products?'), 'g'], ['mixture', word('mixtures?'), 'g'], ['substance', word('substances?'), 'g'], ['base', word('bases?'), 'g'],
  ['अणु', any('अणु')], ['तत्व', any('तत्व|तत्त्व')], ['यौगिक', any('यौगिक')], ['आयन', any('आयन')], ['अम्ल', any('अम्ल')], ['लवण', any('लवण')],
  ['इलेक्ट्रॉन', any('इलेक्ट्रॉन'), 'g'], ['समीकरण', any('समीकरण'), 'g'], ['धातु', any('धातु'), 'g'],
  ['মৌল', any('মৌল')], ['যৌগ', any('যৌগ')], ['অণু', any('অণু')], ['ইলেকট্রন', any('ইলেকট্রন|ইলেক্ট্রন'), 'g'],
  ['அணு', any('அணு')], ['தனிமம்', any('தனிம')], ['சேர்மம்', any('சேர்ம')], ['மூலக்கூறு', any('மூலக்கூறு')], ['அயனி', any('அயனி')], ['எலக்ட்ரான்', any('எலக்ட்ரான்'), 'g'],
  ['అణువు', any('అణువు')], ['మూలకం', any('మూలక')], ['అయాన్', any('అయాన్')], ['సమ్మేళనం', any('సమ్మేళన'), 'g'], ['ఎలక్ట్రాన్', any('ఎలక్ట్రాన్'), 'g'],
  ['ಅಣು', any('ಅಣು')], ['ಧಾತು', any('ಧಾತು')], ['ಸಂಯುಕ್ತ', any('ಸಂಯುಕ್ತ')], ['ಎಲೆಕ್ಟ್ರಾನ್', any('ಎಲೆಕ್ಟ್ರಾನ್'), 'g'],
  ['തന്മാത്ര', any('തന്മാത്ര')], ['മൂലകം', any('മൂലകം|മൂലകങ്ങ')], ['സംയുക്ത', any('സംയുക്ത')], ['ഇലക്ട്രോൺ', any('ഇലക്ട്രോൺ'), 'g'],
  ['અણુ', any('અણુ')], ['તત્વ', any('તત્વ')], ['સંયોજન', any('સંયોજન')], ['ઇલેક્ટ્રોન', any('ઇલેક્ટ્રોન'), 'g'],
  ['ਅਣੂ', any('ਅਣੂ')], ['ਤੱਤ', any('ਤੱਤ')], ['ਇਲੈਕਟ੍ਰੋਨ', any('ਇਲੈਕਟ੍ਰੋਨ|ਇਲੈਕਟ੍ਰਾਨ'), 'g'],
  ['ଅଣୁ', any('ଅଣୁ')], ['ମୌଳିକ', any('ମୌଳିକ')], ['ଯୌଗିକ', any('ଯୌଗିକ')],
  ['عنصر', any('عنصر|عناصر')], ['سالمہ', any('سالمہ|سالمے')], ['جزيء', any('جزيء|جزيئات')], ['أيون', any('أيون|آئن')], ['ذرة', any('ذرة')],
  ['نظائر', any('نظائر')], ['تكافؤ', any('تكافؤ|گرفت')], ['مرکب', any('مرکب|مركب'), 'g'], ['الیکٹران', any('الیکٹران|إلكترون|الإلكترون'), 'g'],
  ['elemento', stem('elementos?')], ['compuesto', stem('compuestos?')], ['composto', stem('compostos?')], ['molécula', stem('mol[eé]culas?')],
  ['ion', stem('i[oó]n(?:es)?' + END)], ['élément', stem('[ée]l[ée]ments?')], ['composé', stem('compos[ée]s?')], ['molécule', stem('mol[ée]cules?')],
  ['элемент', stem('элемент')], ['ион', stem('ион(?:ы|ов|а)?' + END)], ['электрон', stem('электрон'), 'g'], ['соединени', stem('соединени'), 'g']
];
// phrases where those words mean something else
const NOT = new RegExp([
  'chemistry (?:between|with)', '(?:team|good|great|bad|romantic|on[- ]screen|personal|sexual|instant) chemistry', 'chemistry of (?:love|attraction|friendship|a team)',
  'compound (?:interest|words?|sentences?|nouns?|adjectives?|fractures?|eyes?|microscopes?|annual|growth|bows?|leaves?)', 'compounding',
  'elements? of (?:art|design|style|a story|the story|fiction|music|poetry|drama|a poem|the plot|literature|grammar|nature|surprise)', 'design elements?',
  'atomic habits', 'atom (?:text )?editor', 'salt (?:satyagraha|march)', 'dandi', 'isobars? (?:on|of) (?:a |the )?(?:weather )?map', 'weather maps?',
  'cell nucle(?:us|i)', 'nucleus of (?:a |the )?cell', 'nuclear family', 'heavy metal', 'metal (?:music|band)s?', 'product (?:design|management|manager|launch)s?',
  'products of (?:two|the) (?:numbers|factors)', 'product of (?:two|the|its|their|prime)', 'cartesian product', 'dot product', 'cross product', 'mass media', 'body mass', 'critical mass',
  'quadratic equations?', 'linear equations?', 'equations? of (?:a |the )?(?:straight )?line', 'reaction time', 'chain reaction', 'audience reactions?', 'formula (?:one|1)', 'element of surprise',
  'elements? of (?:a|the) set', 'set elements?', 'elements? in (?:a|the) set', 'matrix elements?', 'elements? of (?:a|the) matrix', 'array elements?',
  'química entre', 'chimie entre', 'химия (?:между|отношений)', 'compuestos? (?:de palabras|léxicos)', 'تكافؤ الفرص'
].join('|'), 'gu');
const strongRe = new RegExp(STRONG.join('|'), 'u');
const weakRe = WEAK.map(([k, w, g]) => [k, new RegExp(w, 'u'), Boolean(g)]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (strongRe.test(s)) return true;
  const hits = weakRe.filter(([, re]) => re.test(s));
  const chem = new Set(hits.filter((h) => !h[2]).map((h) => h[0])), generic = new Set(hits.filter((h) => h[2]).map((h) => h[0]));
  return chem.size >= 2 || (chem.size >= 1 && generic.size >= 1);
}

/* ---------- what the AI is told ---------- */

export const prompt = String.raw`
Chemistry lab ("kind": "chem"), three modes, each "spec" with a "mode":
- "balance": {"mode": "balance", "equation": "Fe + O2 -> Fe2O3"}. The learner sets each coefficient and sees a live count of each element on both sides. Write "->" between the sides and " + " between formulas, with exact symbols (Co is cobalt, CO carbon monoxide), groups in brackets "Ca(OH)2", hydrates "CuSO4·5H2O", charges after "^" ("Fe^3+", "SO4^2-", electrons "e^-"), states optional ("(aq)"). Write it unbalanced, without coefficients: the app works out the smallest whole numbers. Every element must be on both sides, and it must balance in one way only (one reaction, not two mixed); at most 8 formulas.
- "atom": {"mode": "atom", "protons": 1, "neutrons": 0, "electrons": 1}: the learner adds and removes protons, neutrons and electrons and sees the element, mass number, charge, Bohr shells (2, 8, 8), valence electrons and stability. Up to 30 protons. Optional: "lock": ["protons"] (counts that can't change), "hide": ["name"] (also "mass", "charge", "shells", "valence", "stable").
- "compound": {"mode": "compound", "ions": ["Na^+", "Mg^2+", "Al^3+", "Cl^-", "O^2-", "SO4^2-"]}: 2 to 10 ions, positive and negative (polyatomic too: "NH4^+", "OH^-", "NO3^-", "CO3^2-", "PO4^3-"); the learner picks one of each and how many until the charges cancel, and sees the formula (criss-cross).
A task's "goal":
- balance: {} (only the smallest whole numbers count; {"multiples": true} accepts any multiple).
- atom: any of "element" (a symbol), "protons", "neutrons", "electrons", "mass" (mass number), "charge", "valence" (outer-shell electrons), "stable": true. Unless "electrons" or "charge" is given, the answer must be a neutral atom. Carbon-12: {"element": "C", "mass": 12}. A sodium ion: {"element": "Na", "charge": 1}. Hydrogen with one neutron: {"element": "H", "neutrons": 1}. Any atom with 3 valence electrons: {"valence": 3}. The starting counts must not already meet it (start from 1, 0, 1, or leave them out).
- compound: {"formula": "Al2O3"}: the neutral formula, in the smallest whole numbers, of two of the spec's ions; list 4 to 8 ions so there is a choice.
Never give a task the same spec as a block (the block would be dropped): use another equation, or other ions.
Block example: {"t": "widget", "kind": "chem", "caption": "Change the coefficients until every element is green.", "spec": {"mode": "balance", "equation": "CH4 + O2 -> CO2 + H2O"}}
Task example: {"type": "task", "kind": "chem", "prompt": "Build an atom of carbon-12.", "spec": {"mode": "atom", "protons": 1, "neutrons": 0, "electrons": 1}, "goal": {"element": "C", "mass": 12}, "hint": "Carbon's atomic number is 6.", "explain": "6 protons and 6 neutrons give a mass number of 12; 6 electrons make it neutral."}
Use "balance" for chemical reactions and equations, "atom" for the structure of the atom, isotopes, isobars and ions, "compound" for valency and writing formulae. Use it only in chemistry lessons, with their own reactions.`.trim();

/* ---------- checking what the AI wrote ---------- */

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
function note(what, err, data) {
  if (debug()) console.log(`[widgets] chem ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 800) : ''}`);
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try { return core.normSpec(spec); } catch (err) {
    if (!(err instanceof core.ChemError)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: the goal must be reachable and not met at the start; null leaves it out.
export function task(spec, goal) {
  try { return core.normTask(spec, goal || {}); } catch (err) {
    if (!(err instanceof core.ChemError)) throw err;
    note('task', err, { spec, goal });
    return null;
  }
}

// Why a spec (and goal: a task) would be left out, in one line the AI can act on; '' when it is fine.
export function why(spec, goal) {
  try {
    if (goal === undefined) core.normSpec(spec); else core.normTask(spec, goal || {});
    return '';
  } catch (err) {
    if (!(err instanceof core.ChemError)) return 'it could not be checked';
    const msg = String(err.message || 'not usable');
    // say which equation, unless the reason already does
    const raw = spec && typeof spec === 'object' && typeof spec.equation === 'string' ? spec.equation.trim().slice(0, 160) : '';
    if (!raw) return msg;
    let tidy = raw;
    try { tidy = core.parseEquation(raw).text; } catch { /* it doesn't read: say it as written */ }
    return msg.includes(raw) || msg.includes(tidy) ? msg : `${raw}: ${msg}`;
  }
}
