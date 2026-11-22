// =====================================================================
// The logic gates lab, for lessons on digital logic (server/widgets.mjs):
// input switches, AND, OR, NOT, NAND, NOR, XOR and XNOR gates drawn as
// textbook symbols, ready blocks (a half adder, a full adder, an SR
// latch, a D flip-flop), lamps and a seven-segment digit. The wires glow
// with the signals and a truth table fills in live. In a lesson it shows
// a circuit to explore; as a task the learner builds a circuit for a
// truth table ("make XOR from NAND gates only"), fills in a circuit's
// truth table, sets the switches to light a lamp, or swaps the one wrong
// gate.
//
// The model, the expression reader and the checks are shared with the
// page, in assets/js/widgets/logic-core.js: every circuit the AI writes
// must hold together (names that exist, one wire into each input, no
// loop except a latch that settles, sizes within bounds), and every task
// must be possible and not done at the start: a build task's goal must
// use only the inputs, and a circuit from the palette's own gates (the
// AI's solution, checked, or one the core makes) must meet it; a find
// task's lamps must be reachable; a fix task's circuit must come right
// with one gate changed. Anything else is left out, and why() says what
// to repair.
//
// PRIMER_WIDGET_DEBUG=1 logs why a circuit was left out.
// =====================================================================
import core from '../../assets/js/widgets/logic-core.js';

export const label = 'a logic gates lab (switches, AND, OR, NOT, NAND, NOR, XOR and XNOR gates, lamps and a live truth table)';

// Words that say a lesson is about logic gates, Boolean algebra or digital circuits, in the languages Primer
// serves. Strong words are enough alone; weak ones also mean other things ("gates", "latch", "adder"), so two
// different ones must appear together. "Logic" and "gate" alone are never enough: the logic of an argument, the
// gate of a city.
const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const latin = (w) => START + w + END;      // a whole word
const stem = (w) => START + w;             // a word that starts so
const any = (w) => w;                      // anywhere (scripts where words join up)
const STRONG = [
  // English
  latin('logic(?:al)? gates?'), latin('logic(?:al)? circuits?'), latin('logic design'), latin('digital logic'), latin('gate[- ]level'),
  latin('boolean (?:algebra|logic|expressions?|functions?|identit(?:y|ies)|laws?|theorems?|simplification|postulates?)'), latin('laws of boolean'),
  latin('truth[- ]tables?'), latin('digital (?:electronics|circuits?|systems? design|ics?)'),
  latin('(?:nand|nor|xor|xnor|ex-?or|ex-?nor|exclusive[- ]or|exclusive[- ]nor) gates?'), latin('nand'), latin('xnor'), latin('xor'),
  latin('(?:the|an?|one|two|each|every|basic|single|input|output|2-input|3-input|two-input|three-input) (?:and|or|not) gates?'),
  latin('and,? or,? (?:and |& )?not'), latin('universal gates?'), latin('half[- ]adders?'), latin('full[- ]adders?'),
  latin('(?:sr|rs|jk|d|t)[- ](?:flip[- ]?flops?|latch(?:es)?)'), latin('flip[- ]?flops? and latch(?:es)?'), latin('latch(?:es)? and flip[- ]?flops?'),
  latin('binary logic'), stem('karnaugh'), latin('k-?maps?'), latin('de ?morgan[\'’]?s theorems?'), latin('combinational (?:circuits?|logic)'),
  latin('sequential (?:circuits?|logic)'), latin('logic levels?'), latin('binary adders?'), latin('switching (?:algebra|theory|circuits)'),
  // Hindi, Marathi, Bhojpuri, Maithili
  any('लॉजिक गेट'), any('लाजिक गेट'), any('लॉजिक सर्किट'), any('तर्क गेट'), any('तर्क द्वार'), any('तर्कद्वार'), any('तार्किक द्वार'), any('तार्किक गेट'),
  any('सत्यता सारणी'), any('सत्य सारणी'), any('सत्यमान सारणी'), any('सत्यता तालिका'), any('सत्य तालिका'), any('सत्यता तक्ता'), any('ट्रुथ टेबल'), any('बूलियन'), any('बुलियन'),
  any('अंकीय इलेक्ट्रॉनिकी'), any('डिजिटल इलेक्ट्रॉनिक'), any('अर्ध योजक'), any('अर्धयोजक'), any('पूर्ण योजक'), any('पूर्णयोजक'), any('हाफ ऐडर'), any('फुल ऐडर'),
  any('फ्लिप-फ्लॉप'), any('फ्लिप फ्लॉप'), any('फ्लिप-फ्लोप'), any('नैंड'), any('सार्वत्रिक गेट'), any('सार्वभौमिक गेट'), any('डी मॉर्गन'), any('डि मॉर्गन'), any('कार्नो'),
  any('(?:and|or|not|nand|nor|xor|xnor|एंड|ऑर|नॉट|नैंड|नॉर) गेट'),
  // Bengali, Assamese
  any('লজিক গেট'), any('লজিক গেইট'), any('যুক্তি গেট'), any('যুক্তিদ্বার'), any('যুক্তি দ্বার'), any('যুক্তি দ্বাৰ'), any('সত্যক সারণি'), any('সত্যতা সারণি'), any('সত্য সারণি'),
  any('সত্যতা তালিকা'), any('ট্রুথ টেবিল'), any('বুলিয়ান'), any('বুলীয়'), any('ডিজিটাল ইলেকট্রনিক'), any('অর্ধ যোজক'), any('পূর্ণ যোজক'), any('ফ্লিপ-ফ্লপ'), any('ফ্লিপ ফ্লপ'),
  // Tamil
  any('லாஜிக் கேட்'), any('தர்க்க வாயில்'), any('தருக்க வாயில்'), any('லாஜிக் வாயில்'), any('உண்மை அட்டவணை'), any('மெய் அட்டவணை'), any('பூலியன்'), any('டிஜிட்டல் மின்னணு'),
  any('அரை கூட்டி'), any('முழு கூட்டி'), any('ஃபிளிப்-ஃபிளாப்'),
  // Telugu
  any('లాజిక్ గేట్'), any('తర్క ద్వార'), any('తార్కిక ద్వార'), any('సత్య పట్టిక'), any('సత్యపట్టిక'), any('ట్రూత్ టేబుల్'), any('బూలియన్'), any('డిజిటల్ ఎలక్ట్రానిక్'),
  any('అర్ధ సంకలని'), any('పూర్ణ సంకలని'),
  // Kannada
  any('ಲಾಜಿಕ್ ಗೇಟ್'), any('ತರ್ಕ ದ್ವಾರ'), any('ತಾರ್ಕಿಕ ದ್ವಾರ'), any('ಸತ್ಯ ಕೋಷ್ಟಕ'), any('ಸತ್ಯಕೋಷ್ಟಕ'), any('ಬೂಲಿಯನ್'), any('ಡಿಜಿಟಲ್ ಎಲೆಕ್ಟ್ರಾನಿಕ್'),
  // Malayalam
  any('ലോജിക് ഗേറ്റ്'), any('ലോജിക് ഗേറ്റു'), any('ലോജിക്ക് ഗേറ്റ്'), any('സത്യപ്പട്ടിക'), any('സത്യ പട്ടിക'), any('ട്രൂത്ത് ടേബിൾ'), any('ബൂളിയൻ'), any('ബൂലിയൻ'), any('ഡിജിറ്റൽ ഇലക്ട്രോണിക്'),
  // Gujarati
  any('લોજિક ગેટ'), any('તર્ક દ્વાર'), any('તાર્કિક દ્વાર'), any('સત્યાર્થતા કોષ્ટક'), any('સત્ય કોષ્ટક'), any('ટ્રુથ ટેબલ'), any('બુલિયન'), any('ડિજિટલ ઇલેક્ટ્રોનિક'),
  // Punjabi
  any('ਲਾਜਿਕ ਗੇਟ'), any('ਲੌਜਿਕ ਗੇਟ'), any('ਤਰਕ ਗੇਟ'), any('ਤਰਕ ਦੁਆਰ'), any('ਸੱਚਾਈ ਸਾਰਣੀ'), any('ਸਤਿ ਸਾਰਣੀ'), any('ਟਰੁੱਥ ਟੇਬਲ'), any('ਬੂਲੀਅਨ'), any('ਡਿਜੀਟਲ ਇਲੈਕਟ੍ਰਾਨਿਕ'),
  // Odia
  any('ଲଜିକ ଗେଟ'), any('ଲଜିକ୍ ଗେଟ୍'), any('ତର୍କ ଦ୍ୱାର'), any('ତର୍କ ଗେଟ'), any('ସତ୍ୟତା ସାରଣୀ'), any('ସତ୍ୟ ସାରଣୀ'), any('ବୁଲିଆନ'), any('ବୁଲିୟାନ'),
  // Urdu
  any('لاجک گیٹ'), any('منطقی گیٹ'), any('منطقی دروازے'), any('ٹروتھ ٹیبل'), any('صداقت جدول'), any('سچائی جدول'), any('بولین'), any('بولیئن'), any('ڈیجیٹل الیکٹرانکس'),
  // Arabic
  any('البوابات المنطقية'), any('بوابة منطقية'), any('بوابات منطقية'), any('البوابة المنطقية'), any('جدول الحقيقة'), any('جداول الحقيقة'), any('جبر بول'), any('الجبر البولياني'),
  any('الجبر البولي'), any('الدوائر المنطقية'), any('الإلكترونيات الرقمية'), any('الدوائر الرقمية'), any('نصف جامع'), any('جامع كامل'),
  // Spanish, Portuguese, French
  latin('(?:puertas?|compuertas?) l[oó]gicas?'), latin('tablas? de (?:la )?verdad'), latin('[aá]lgebra (?:de boole|booleana)'), latin('l[oó]gica booleana'),
  latin('electr[oó]nica digital'), latin('circuitos? (?:digitales|l[oó]gicos)'), stem('semisumador'), latin('sumador completo'), latin('compuertas? (?:and|or|not|nand|nor|xor)'),
  latin('portas? l[oó]gicas?'), latin('tabelas?[- ]verdade'), latin('tabelas? de verdade'), latin('l[oó]gica booleana'), latin('eletr[oô]nica digital'),
  latin('circuitos? (?:digitais|l[oó]gicos)'), latin('meio[- ]somador'), latin('somador completo'),
  latin('portes? logiques?'), latin('tables? de v[ée]rit[ée]'), latin('alg[èe]bre (?:de boole|bool[ée]enne)'), latin('logique bool[ée]enne'),
  latin('[ée]lectronique num[ée]rique'), latin('circuits? (?:logiques?|num[ée]riques)'), latin('demi[- ]additionneur'), latin('additionneur complet'),
  latin('bascules? (?:rs|sr|d|jk)'),
  // Russian
  stem('логическ(?:ие|ий|их|ого|ая) (?:элемент|вентил|схем)'), stem('таблиц[аыуе] истинности'), stem('булев(?:а|ой|у|ой) алгебр'), stem('алгебр[аыу] логики'),
  stem('цифров(?:ая|ой|ую) электроник'), stem('цифров(?:ые|ых|ая) (?:схем|логик)'), stem('полусумматор'), stem('логические функции')
];
const WEAK = [
  ['and-gate', latin('and[- ]gates?')], ['or-gate', latin('or[- ]gates?')], ['not-gate', latin('not[- ]gates?')], ['gates', latin('gates')],
  ['semiconductor', latin('semiconductor electronics')], ['inverter', latin('inverters?')], ['boolean', stem('boolean')],
  ['flipflop', latin('flip[- ]?flops?')], ['latch', latin('latch(?:es)?')], ['adder', latin('adders?')], ['demorgan', latin('de ?morgan')],
  ['binary', latin('binary (?:inputs?|outputs?|signals?|digits?|numbers?|addition|variables?)')], ['digital', latin('digital (?:signals?|circuits?|systems?|inputs?|outputs?)')],
  ['high-low', latin('(?:high|low) (?:and|or) (?:high|low)')], ['01', latin('0s? and 1s?')],
  ['गेट', any('गेट')], ['द्वार', any('द्वार')], ['तर्क', any('तर्क')], ['योजक', any('योजक')], ['गेट-bn', any('গেট')], ['वाயில்', any('வாயில்')], ['ద్వార', any('ద్వార')],
  ['ದ್ವಾರ', any('ದ್ವಾರ')], ['ഗേറ്റ്', any('ഗേറ്റ്')], ['દ્વાર', any('દ્વાર')], ['ਗੇਟ', any('ਗੇਟ')], ['ଗେଟ', any('ଗେଟ')], ['گیٹ', any('گیٹ')], ['بوابة', any('بوابة|بوابات')],
  ['puerta', latin('(?:puertas?|compuertas?|portas?|portes?)')], ['вентиль', stem('вентил')], ['триггер', stem('триггер')], ['сумматор', stem('сумматор')]
];
// phrases where those words mean something else
const NOT = /bill gates|melinda gates|gates foundation|watergate|gates of (?:the )?(?:city|heaven|hell|palace|fort|temple)|city gates|(?:sandals?|footwear|shoes?|wear(?:ing)?) (?:and )?flip[- ]?flops?|flip[- ]?flops? (?:sandals?|footwear|shoes?)|door latch(?:es)?|latch(?:es)? (?:on|of) (?:the )?(?:doors?|gates?|windows?)|latch(?:ing)? on|logic of (?:the|an?|his|her|their)/g;
const strongRe = new RegExp(STRONG.join('|'), 'u');
const weakRe = WEAK.map(([k, w]) => [k, new RegExp(w, 'u')]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (strongRe.test(s)) return true;
  return weakRe.filter(([, re]) => re.test(s)).length >= 2;
}

export const prompt = String.raw`
Logic gates ("kind": "logic"): a digital logic lab: switches, gates drawn as textbook symbols, lamps; wires glow for 1, and a live truth table fills in. The learner flips switches, and can place and wire gates.
"spec": {"inputs": [...], "outputs": {...}, "gates": [...], "palette": {...}}
- "inputs": 1 to 6 switch names (A, B, C, Cin, S, R, D); "set": {"A": 1} starts a switch on; "clock": "CLK" adds an input that ticks.
- "outputs": each lamp and what drives it: {"Y": "G2"}, or an expression the app builds as gates: {"S": "A XOR B", "C": "A AND B"}; a list ["Y"] leaves the lamps for the learner to wire.
- "gates" (optional): [{"id": "G1", "type": "NOR", "in": ["A", "B"]}]: AND, OR, NOT, NAND, NOR, XOR, XNOR; "in" names what feeds each input in order (an input or a gate's id), 2 inputs (or 3), NOT 1. Ready blocks: "HA" half adder (A, B; outputs S, C), "FA" full adder (A, B, Cin; S, Cout), "SR" latch (S, R; Q, Qn), "D" flip-flop (D, CLK; Q, Qn), wired as "U1.S", "U1.Q".
- No loops, except a latch: two NOR gates feeding each other (G1 = NOR(R, G2), G2 = NOR(S, G1)).
- "palette": gates the learner may add, how many: {"NAND": 4} or {"AND": 2, "OR": 1, "NOT": 2}; it makes the circuit editable.
- "seg7": true shows up to 4 lamps as a binary number on a digit (the first lamp is the highest bit).
Expressions: AND as · or AND (AB is A·B), OR as + or OR, NOT as ' or NOT, XOR as ⊕ or XOR; NAND(A, B) also works. NOT binds first, then AND, XOR, OR; add brackets.
Block example: {"t": "widget", "kind": "logic", "caption": "Flip A and B: S is 1 when exactly one is on; the carry C needs both.", "spec": {"inputs": ["A", "B"], "outputs": {"S": "A XOR B", "C": "A AND B"}}}
Task goals. Truth-table rows count in binary, the first input highest (A B: 00, 01, 10, 11).
- {"type": "build", "expr": "A·B' + A'·B"} or "table": {"Y": [0, 1, 1, 0]}: the learner builds it on an empty board ("outputs": ["Y"], a "palette"); optional "only": ["NAND"], "max": 4 gates; then add "solution", the circuit that does it.
- {"type": "fill"}: the learner fills in the truth table of the spec's circuit (up to 4 inputs).
- {"type": "find", "want": {"Y": 1}}: set the switches so the lamps show this (they must start wrong). For a latch, "inputs": {"S": 0, "R": 0} asks for it with the switches so.
- {"type": "fix", "expr": "(A·B)'"}: the circuit has one gate of the wrong type; the learner swaps it.
Task example: {"type": "task", "kind": "logic", "prompt": "Make XOR from NAND gates only.", "spec": {"inputs": ["A", "B"], "outputs": ["Y"], "palette": {"NAND": 4}}, "goal": {"type": "build", "expr": "A XOR B", "only": ["NAND"], "solution": {"Y": "NAND(NAND(A, NAND(A, B)), NAND(B, NAND(A, B)))"}}, "hint": "Start with NAND(A, B).", "explain": "Each of A and B is NANDed with NAND(A, B); a last NAND joins them."}
Use it for logic gates, Boolean algebra, truth tables and digital circuits.`.trim();

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
const known = (err) => err instanceof core.LogicError || err instanceof core.ParseError;
function note(what, err, data) {
  if (debug()) console.log(`[widgets] logic ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}
// a block is a circuit to explore: it needs a lamp with a wire, unless the learner is to build on it
function normBlock(spec) {
  const s = core.normSpec(spec);
  if (!s.edit && !s.outputs.some((o) => o.from != null)) throw new core.LogicError('a block needs a lamp with a wire, to show what the circuit does');
  return s;
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try { return normBlock(spec); } catch (err) {
    if (!known(err)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: it can be done (with the palette's own gates, for a build) and is not done at the start.
export function task(spec, goal) {
  try { return core.normTask(spec, goal); } catch (err) {
    if (!known(err)) throw err;
    note('task', err, { spec, goal });
    return null;
  }
}

// Why a block (no goal) or a task would be left out, in one line the AI can act on; '' when it's fine.
export function why(spec, goal) {
  try {
    if (goal === undefined) normBlock(spec); else core.normTask(spec, goal);
    return '';
  } catch (err) {
    if (!known(err)) throw err;
    return String(err.message || err).replace(/\s+/g, ' ').slice(0, 300);
  }
}

// The words a translator should translate (server/widgets.mjs): the switches' and lamps' labels ("door open");
// names (A, Y), gate types and expressions stay as they are.
export function texts(spec) {
  if (!spec || typeof spec !== 'object') return [];
  const list = (xs) => (Array.isArray(xs) ? xs.map((x) => x && typeof x === 'object' && x.label) : []);
  return [...list(spec.inputs), ...list(spec.outputs)].filter((s) => typeof s === 'string' && s);
}

// The same (already checked) spec with those words translated, in the same order; null keeps the original.
export function withTexts(spec, words) {
  const want = texts(spec);
  if (!want.length || !Array.isArray(words) || words.length !== want.length) return null;
  let k = 0;
  const next = (was) => core.text(typeof words[k] === 'string' ? words[k++] : (k++, ''), core.LIMITS.label) || was;
  const put = (xs) => (Array.isArray(xs) ? xs.map((x) => (x && typeof x === 'object' && typeof x.label === 'string' && x.label ? { ...x, label: next(x.label) } : x)) : xs);
  return { ...spec, inputs: put(spec.inputs), outputs: put(spec.outputs) };
}
