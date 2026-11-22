// =====================================================================
// The coding window (server half; server/widgets.mjs): a code editor in
// the lesson where the learner writes and runs real programs (Python, or
// a subset of JavaScript), with an output console and an input box. The
// browser half is assets/js/widgets/code.js; the interpreters both use
// are assets/js/widgets/code-core.js, so a program the server ran is run
// the same way on the page.
//
// A block is a runnable example: { language, code, stdin? }. It must
// parse, run without an error within the step budget (with the input it
// is given), and print or draw something.
// A task is starter code (buggy, with ___ blanks, or a start, or empty)
// and a goal: tests of what the program prints for some input, or of
// what a function returns, and a reference solution. The solution is run
// on every test here, and must pass them all; the starter code must fail
// at least one. Anything else is left out of the lesson, and why() says
// why in a line the AI can act on.
//
// PRIMER_WIDGET_DEBUG=1 logs why a part was left out.
// =====================================================================
import core from '../../assets/js/widgets/code-core.js';

export const label = 'a coding window where the learner writes and runs programs';

/* ---------- which lessons are offered it ---------- */

// Words that mean programming wherever they appear, in the languages Primer serves; weak ones ("loop",
// "array", "code") need a second programming word, and "variable" and "function" (which maths has too)
// count only beside a word that is about code.
const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const word = (w) => START + '(?:' + w + ')' + END;  // a whole word
const stem = (w) => START + '(?:' + w + ')';       // a word that starts so
const any = (w) => w;                               // anywhere (scripts where words join up)
const STRONG = [
  // English
  word('python'), stem('javascript'), word('js'), word('node\\.?js'), stem('programming'), stem('programmer'), word('coding'), word('coders?'),
  stem('computer programs?'), word('computer science'), word('cs'), word('comp sci'), stem('algorithms?'), stem('pseudo-?code'), stem('recursi(?:on|ve)'),
  word('debug(?:ging)?'), word('source code'), word('for[- ]loops?'), word('while[- ]loops?'), word('if[- ]statements?'), word('if[- ]else'),
  word('print statements?'), word('data structures?'), word('data types?'), word('bubble sort'), word('selection sort'), word('insertion sort'),
  word('merge sort'), word('quick ?sort'), word('binary search'), word('linear search'), word('sorting algorithms?'), word('flow ?charts?'),
  word('string methods?'), word('list comprehensions?'), word('turtle graphics'), word('python turtle'), word('ncert computer'),
  word('informatics practices'), word('ip class'), word('class (?:11|12|xi|xii) (?:cs|ip)'),
  // Hindi, Marathi, Bhojpuri, Maithili (Devanagari)
  any('प्रोग्रामिंग'), any('प्रोग्राम'), any('कोडिंग'), any('पायथन'), any('पाइथन'), any('जावास्क्रिप्ट'), any('एल्गोरिदम'), any('एल्गोरिथम'), any('अल्गोरिदम'),
  any('कलनविधि'), any('कंप्यूटर विज्ञान'), any('कम्प्यूटर विज्ञान'), any('संगणक विज्ञान'), any('संगणक प्रणाली'), any('रिकर्शन'), any('पुनरावर्ती फ़ंक्शन'),
  any('डिबग'), any('फ्लोचार्ट'), any('प्रवाह चार्ट'),
  // Bengali, Assamese
  any('প্রোগ্রামিং'), any('প্ৰোগ্ৰামিং'), any('প্রোগ্রাম'), any('কোডিং'), any('পাইথন'), any('জাভাস্ক্রিপ্ট'), any('অ্যালগরিদম'), any('অ্যালগোরিদম'), any('এলগৰিদম'),
  any('কম্পিউটার বিজ্ঞান'), any('কম্পিউটাৰ বিজ্ঞান'),
  // Gujarati
  any('પ્રોગ્રામિંગ'), any('પ્રોગ્રામ'), any('કોડિંગ'), any('પાયથન'), any('અલ્ગોરિધમ'), any('કમ્પ્યુટર વિજ્ઞાન'),
  // Kannada
  any('ಪ್ರೋಗ್ರಾಮಿಂಗ್'), any('ಪ್ರೋಗ್ರಾಂ'), any('ಕೋಡಿಂಗ್'), any('ಪೈಥಾನ್'), any('ಅಲ್ಗಾರಿದಮ್'), any('ಕಂಪ್ಯೂಟರ್ ವಿಜ್ಞಾನ'),
  // Malayalam
  any('പ്രോഗ്രാമിങ്'), any('പ്രോഗ്രാമിംഗ്'), any('കോഡിംഗ്'), any('കോഡിങ്'), any('പൈത്തൺ'), any('അൽഗോരിതം'), any('കമ്പ്യൂട്ടർ സയൻസ്'),
  // Odia
  any('ପ୍ରୋଗ୍ରାମିଂ'), any('ପ୍ରୋଗ୍ରାମ'), any('କୋଡିଂ'), any('ପାଇଥନ'), any('ଆଲଗୋରିଦମ'), any('କମ୍ପ୍ୟୁଟର ବିଜ୍ଞାନ'),
  // Punjabi
  any('ਪ੍ਰੋਗਰਾਮਿੰਗ'), any('ਕੋਡਿੰਗ'), any('ਪਾਈਥਨ'), any('ਐਲਗੋਰਿਦਮ'), any('ਕੰਪਿਊਟਰ ਵਿਗਿਆਨ'),
  // Tamil
  any('நிரலாக்க'), any('புரோகிராமிங்'), any('ப்ரோகிராமிங்'), any('கோடிங்'), any('பைத்தான்'), any('அல்காரிதம்'), any('படிமுறைத் தீர்வு'), any('கணினி அறிவியல்'),
  // Telugu
  any('ప్రోగ్రామింగ్'), any('ప్రోగ్రాం'), any('కోడింగ్'), any('పైథాన్'), any('అల్గోరిథం'), any('అల్గారిథం'), any('కంప్యూటర్ సైన్స్'), any('కంప్యూటర్ విజ్ఞాన'),
  // Urdu
  any('پروگرامنگ'), any('کوڈنگ'), any('پائتھن'), any('الگورتھم'), any('کمپیوٹر سائنس'),
  // Arabic
  any('البرمجة'), any('برمجة'), any('بايثون'), any('جافا سكريبت'), any('خوارزمي'), any('علوم الحاسوب'), any('علوم الحاسب'), any('علوم الكمبيوتر'),
  // Spanish, Portuguese, French
  stem('programaci[oó]n'), stem('programa[cç][aã]o'), stem('programmation'), word('programar'), stem('algoritm'), stem('algorithme'),
  word('ciencias? de la computaci[oó]n'), word('ci[eê]ncia da computa[cç][aã]o'), stem('inform[aá]tica'), stem('informatique'),
  stem('recursivi'), stem('recurs[aã]o'), stem('r[ée]cursivit'), word('codage'), word('codifica[cç][aã]o de (?:programas|computadores)'),
  // Russian
  stem('программировани'), stem('программист'), stem('алгоритм'), stem('информатик'), stem('рекурси'), word('питон'), word('пайтон'), stem('джаваскрипт')
];
const HARD = [
  // words that are about code, but mean other things too
  ['loop', word('loops?|looping')], ['array', word('arrays?')], ['code', word('codes?')], ['program', word('programs?|programmes?')],
  ['sort', word('sort(?:ing|s)?')], ['list', word('lists?')], ['string', word('strings?')], ['computer', word('computers?')], ['software', word('software')],
  ['iteration', word('iterations?|iterate')], ['input', word('input|inputs')], ['output', word('outputs?')], ['boolean', word('booleans?')],
  ['logic', word('logic')], ['app', word('apps?')], ['condition', word('conditionals?|conditions')], ['game', word('games?')],
  ['लूप', any('लूप')], ['कोड', any('कोड')], ['ऐरे', any('ऐरे|एरे')], ['सूची', any('सूची')], ['कंप्यूटर', any('कंप्यूटर|कम्प्यूटर|संगणक')],
  ['लুপ', any('লুপ')], ['কোড', any('কোড')], ['কম্পিউটার', any('কম্পিউটার|কম্পিউটাৰ')],
  ['கணினி', any('கணினி')], ['நிரல்', any('நிரல்')], ['కంప్యూటర్', any('కంప్యూటర్')], ['లూప్', any('లూప్')], ['ಲೂಪ್', any('ಲೂಪ್')], ['ലൂപ്പ്', any('ലൂപ്പ്')],
  ['کوڈ', any('کوڈ')], ['کمپیوٹر', any('کمپیوٹر')], ['حلقة', any('حلقة تكرار|حلقات التكرار')], ['كود', any('كود|شيفرة')], ['حاسوب', any('حاسوب|كمبيوتر')],
  ['bucle', word('bucles?')], ['laço', word('la[cç]os? de repeti[cç][aã]o')], ['boucle', word('boucles?')], ['código', word('c[oó]digos?')],
  ['ordenar', word('ordenaci[oó]n|ordena[cç][aã]o|ordenamiento')], ['tri', word('tri des?')], ['цикл', stem('цикл')], ['массив', stem('массив')],
  ['код', word('код|кода|коду')], ['сортировк', stem('сортировк')], ['компьютер', stem('компьютер')]
];
const SOFT = [
  // words that maths and science use too: they count only beside a word that is about code
  ['variable', word('variables?')], ['function', word('functions?')], ['integer', word('integers?')], ['recursion', word('recurrence')],
  ['चर', word('चर')], ['फ़ंक्शन', any('फ़ंक्शन|फंक्शन')], ['ফাংশন', any('ফাংশন')], ['மாறி', any('மாறி')], ['ఫంక్షన్', any('ఫంక్షన్')],
  ['متغير', any('متغير')], ['دالة', any('دالة|دوال')], ['función', word('funci[oó]n|funciones|fun[cç][aã]o|fun[cç][oõ]es|fonctions?')],
  ['variable2', word('vari[aá]vel|vari[aá]veis|variables?')], ['функци', stem('функци')], ['переменн', stem('переменн')]
];
// phrases where those words mean something else
const NOT = new RegExp([
  'code of (?:conduct|ethics|practice|honou?r|hammurabi|manu|law|laws)', 'genetic code', 'morse code', '(?:postal|pin|zip|area|post|country|dialling|dialing) codes?',
  'dress codes?', '(?:civil|penal|criminal|building|traffic|highway|tax|labou?r|legal|colou?r|bar|qr|secret) codes?', 'barcodes?', 'da vinci code', 'codes? of',
  'genetic coding', 'coding (?:region|sequence|strand|dna|gene)s?', 'non-coding', 'linear programming', 'integer programming', 'goal programming',
  'neuro-?linguistic programming', '(?:tv|television|radio|space|training|exchange|welfare|government|literacy|vaccination|immuni[sz]ation|nutrition|development|health) programm?es?',
  'python (?:snake|snakes)', '(?:burmese|ball|reticulated|rock|indian|royal) pythons?', 'monty python', 'feedback loops?', 'loop of henle', 'string instruments?',
  '(?:food|life|water|carbon|nitrogen|rock) (?:chain|cycle|web)', 'shopping lists?', 'word lists?', 'computer (?:hardware|parts|basics|peripherals)',
  'पिन कोड', 'ड्रेस कोड', 'मोर्स कोड', 'आनुवंशिक कोड', 'जेनेटिक कोड', 'टीवी प्रोग्राम', 'रेडियो प्रोग्राम', 'खाद्य श्रृंखला'
].join('|'), 'gu');
// programming in a language the coding window can't run: no Python or JavaScript here, so it isn't offered
const OTHER_LANG = /(?<![\p{L}\p{N}])(?:c\+\+|c#|cpp|java(?!\s*script)|kotlin|php|sql|mysql|html|css|visual basic|vb\.net|qbasic|golang|rust programming|swift programming|ruby programming|r programming|matlab|typescript|scratch (?:programming|coding|blocks|projects?|3)|mit scratch|c programming|c language|programming in c|logo programming)(?![\p{L}\p{N}])/u;
const PY_OR_JS = /(?<![\p{L}\p{N}])(?:python|javascript|js|node\.?js|पायथन|पाइथन|জাভাস্ক্রিপ্ট|পাইথন|பைத்தான்|పైథాన్|ಪೈಥಾನ್|പൈത്തൺ|ପାଇଥନ|ਪਾਈਥਨ|પાયથન|پائتھن|بايثون|питон|пайтон)(?![\p{L}\p{N}])/u;
const strongRe = new RegExp(STRONG.join('|'), 'u');
const hardRe = HARD.map(([k, w]) => [k, new RegExp(w, 'u')]);
const softRe = SOFT.map(([k, w]) => [k, new RegExp(w, 'u')]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (OTHER_LANG.test(s) && !PY_OR_JS.test(s)) return false;
  if (strongRe.test(s)) return true;
  const hard = hardRe.filter(([, re]) => re.test(s)).length;
  if (!hard) return false;
  return hard + softRe.filter(([, re]) => re.test(s)).length >= 2;
}

/* ---------- the prompt ---------- */

export const prompt = String.raw`
Code ("kind": "code"): a coding window where the learner writes and runs real programs (Python 3, or JavaScript) and sees what they print.
Block: "spec": {"language": "python", "code": "...", "stdin": "lines for input(), one per line (only if it reads input)"}: a short runnable example (3 to 20 lines) that prints something; the caption invites the learner to change one thing and run it again.
Block example: {"t": "widget", "kind": "code", "caption": "Run it. Then change 5 to 10 and run it again.", "spec": {"language": "python", "code": "n = 5\nfor i in range(1, n + 1):\n    print(i, 'x', i, '=', i * i)"}}
Task: the learner writes code, fixes the starter code's bug, or fills in each ___; the app runs it on the tests. "spec": {"language": "python", "code": "starter code: with a bug, ___ blanks, or a start (may be empty)"}; "goal" is one of:
- {"type": "output", "tests": [{"stdin": "3\n4", "stdout": "7"}, ...], "solution": "..."}: each test gives the input lines and exactly what is printed (line by line; input()'s prompt text is not part of it).
- {"type": "function", "name": "area", "tests": [{"args": [3, 4], "returns": 12}, ...], "solution": "..."}: each test calls the learner's function and checks its return value (JSON; floats within 1e-6).
Give 2 to 5 tests with different inputs, one an edge case, so printing the answer fails. The solution must pass them all and the starter code fail one: the app runs both, and leaves out a task that doesn't hold.
Task examples: {"type": "task", "kind": "code", "prompt": "Fix the bug: print the sum of the two numbers read.", "spec": {"language": "python", "code": "a = input()\nb = input()\nprint(a + b)"}, "goal": {"type": "output", "tests": [{"stdin": "3\n4", "stdout": "7"}, {"stdin": "10\n-2", "stdout": "8"}], "solution": "a = int(input())\nb = int(input())\nprint(a + b)"}, "hint": "input() gives text. What turns text into a number?", "explain": "int() turns \"3\" into 3, so + adds instead of joining."}
{"type": "task", "kind": "code", "prompt": "Complete area(w, h) so it returns the area of a rectangle.", "spec": {"language": "python", "code": "def area(w, h):\n    ___"}, "goal": {"type": "function", "name": "area", "tests": [{"args": [3, 4], "returns": 12}, {"args": [5, 0], "returns": 0}], "solution": "def area(w, h):\n    return w * h"}, "hint": "Width times height.", "explain": "return w * h gives the area back."}
In a programming lesson, put a code block in most sections, and make code tasks the main test: at least two, on what the sections taught, at the learner's level (the examples only show the format). Test a function the learner writes with a "function" goal. Code must run exactly as written: Python 3 (modules: math, random, string, time, turtle; no files) or JavaScript (let, const, functions, arrays, objects, console.log, prompt(); no classes, no DOM). A Python block may draw with import turtle; tasks never use random or turtle. Write \n for a new line in JSON strings, and 4 spaces per indent.`.trim();

/* ---------- checking ---------- */

const MAX_CODE = 3000, MAX_LINES = 80, MAX_TESTS = 6, MAX_IN = 600, MAX_OUT = 1500;
const STEPS = 200000;       // for one run of an example or a solution here (learners get several times this)
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
class Why extends Error {}
const no = (msg) => { throw new Why(msg); };
function note(what, err, data) {
  if (debug()) console.log(`[widgets] code ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}
const cut = (s, n = 60) => { const t = String(s).replace(/\n/g, '\\n'); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const shownOut = (s) => (String(s).trim() === '' ? 'nothing' : JSON.stringify(cut(core.outLines(s).join('\n'), 80)));

// the language: "python" or "javascript" (also "py", "js"...); a missing one is worked out from the code
function language(spec, code) {
  if (spec.language == null && spec.lang == null) {
    return /\bconsole\.log\s*\(|\b(?:let|const|var)\s+\w+\s*=|\bfunction\s+\w+\s*\(|=>/.test(code) && !/^\s*def\s|\bprint\s*\(/m.test(code) ? 'javascript' : 'python';
  }
  const l = core.langOf(spec.language != null ? spec.language : spec.lang);
  if (!l) no(`"language" must be "python" or "javascript", not ${JSON.stringify(cut(spec.language || spec.lang, 30))}`);
  return l;
}

// code as the AI wrote it, made tidy: no ``` fences, real new lines (not "\n" written out), spaces for tabs
function code(v, what, lang, allowEmpty) {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) v = v.join('\n');
  if (v == null && allowEmpty) v = '';
  if (typeof v !== 'string') no(`"${what}" must be a string of code`);
  let s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const fence = /^\s*```[\w+-]*[ \t]*\n([\s\S]*?)\n?```\s*$/.exec(s);
  if (fence) s = fence[1];
  if (!s.includes('\n') && /\\n/.test(s)) {
    const un = s.replace(/\\n/g, '\n').replace(/\\t/g, '    ');
    if (core.parse(lang, s) && !core.parse(lang, un)) s = un;
  }
  // the lesson's JSON repair (for LaTeX, server/ai.mjs) turns a tab before a letter into "\t", and, in a string that
  // also holds escapes like "\tAge", a new line before "i", "e", "u"... into "\n": undo that where it makes the code read
  if (/\\[tn]/.test(s) && core.parse(lang, s)) {
    const un = s.replace(/^((?:\\t)+)/gm, (m) => '    '.repeat(m.length / 2))
      .replace(/\\n(?=(?:eq|e\b|e\s|abla|u\b|u\s|ot\b|otin|ewline|leq|geq|mid|exists|i\b|parallel|subseteq|subset|cdot))/g, '\n');
    if (un !== s && !core.parse(lang, un)) s = un;
  }
  s = s.split('\n').map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length)).replace(/[ \t]+$/, '')).join('\n');
  s = s.replace(/^\n+/, '').replace(/\n+$/, '');
  if (!s && !allowEmpty) no(`"${what}" is empty`);
  if (s.length > MAX_CODE) no(`"${what}" is ${s.length} characters long: keep it under ${MAX_CODE}`);
  if (s.split('\n').length > MAX_LINES) no(`"${what}" has more than ${MAX_LINES} lines: keep it short`);
  return s;
}
// the lines a program reads: a string (or a list of lines, or a number)
function inputText(v, what) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.map((x) => String(x)).join('\n');
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
  if (typeof v !== 'string') no(`"${what}" must be a string, one line for each input()`);
  let s = v.replace(/\r\n?/g, '\n');
  if (!s.includes('\n') && /\\n/.test(s)) s = s.replace(/\\n/g, '\n');
  s = s.replace(/\n+$/, '');
  if (s.length > MAX_IN) no(`"${what}" is too long (over ${MAX_IN} characters)`);
  if (s.split('\n').length > 30) no(`"${what}" has more than 30 lines`);
  return s;
}
function outputText(v, what) {
  if (Array.isArray(v)) v = v.map((x) => String(x)).join('\n');
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
  if (typeof v !== 'string') no(`${what} must be a string: exactly what the program prints`);
  let s = v.replace(/\r\n?/g, '\n');
  if (!s.includes('\n') && /\\n/.test(s)) s = s.replace(/\\n/g, '\n');
  s = core.outLines(s).join('\n');
  if (s.length > MAX_OUT) no(`${what} is too long (over ${MAX_OUT} characters)`);
  if (s.split('\n').length > 40) no(`${what} has more than 40 lines`);
  return s;
}
const plainJSON = (v, max) => { try { const s = JSON.stringify(v); return s !== undefined && s.length <= max ? JSON.parse(s) : undefined; } catch { return undefined; } };

// what a run of an example went wrong with, as something to fix
function runProblem(r, who) {
  const e = r.error;
  if (!e) return '';
  switch (e.kind) {
    case 'syntax': return `${who} has a syntax error: ${e.text}`;
    case 'eof': return `${who} reads more lines with input() than "stdin" gives: add them to "stdin", one per line`;
    case 'timeout': return `${who} ran for too long (over ${STEPS} steps): make it smaller, or check for a loop that never ends`;
    case 'output': return `${who} prints too much: make it smaller`;
    case 'memory': return `${who} makes something too big (a huge list or string, or too much drawing): make it smaller`;
    case 'unsupported': return `${who} uses something not available here: ${e.text}`;
    default: return `${who} stops with an error: ${e.text}${/[.?!]$/.test(e.text) ? '' : '.'} Fix the code (to show an error on purpose, catch it with try/except and print a message)`;
  }
}

function checkBlock(spec) {
  if (!isObj(spec)) no('"spec" must be an object: {"language": "python", "code": "..."}');
  const raw = spec.code != null ? spec.code : spec.source != null ? spec.source : spec.program;
  const lang = language(spec, typeof raw === 'string' ? raw : '');
  const src = code(raw, 'code', lang, false);
  let stdin = inputText(spec.stdin != null ? spec.stdin : spec.input, 'stdin');
  const syn = core.parse(lang, src);
  if (syn) no(`the code has a syntax error: ${syn.text}`);
  const r = core.run(lang, src, { stdin, steps: STEPS, output: 6000 });
  const bad = runProblem(r, 'the example');
  if (bad) no(bad);
  const drew = r.turtle && r.turtle.ops.some((o) => o.o === 'line' || o.o === 'dot' || o.o === 'fill' || o.o === 'text');
  if (!r.stdout.trim() && !drew) no('the example prints nothing: print something so the learner sees what it does');
  if (stdin && !r.asked) stdin = ''; // input for a program that doesn't read any: dropped
  const out = { language: lang, code: src };
  if (stdin) out.stdin = stdin;
  return out;
}

function cleanTests(goal, type) {
  const list = goal.tests != null ? goal.tests : goal.cases != null ? goal.cases : goal.examples;
  if (!Array.isArray(list) || !list.length) no('"goal.tests" must be a list of 2 to 5 tests');
  if (list.length > MAX_TESTS) no(`"goal.tests" has ${list.length} tests: give at most ${MAX_TESTS}`);
  const seen = new Set();
  const out = [];
  list.forEach((t, i) => {
    const n = i + 1;
    if (!isObj(t)) no(`test ${n} must be an object`);
    let c;
    if (type === 'output') {
      const want = t.stdout != null ? t.stdout : t.output != null ? t.output : t.expected != null ? t.expected : t.expect;
      if (want == null) no(`test ${n} needs "stdout": exactly what the program prints`);
      const stdin = inputText(t.stdin != null ? t.stdin : t.input, `test ${n} "stdin"`);
      c = { stdin, stdout: outputText(want, `test ${n} "stdout"`) };
      if (!c.stdout) no(`test ${n} expects the program to print nothing: every test should check something printed`);
      if (!stdin) delete c.stdin;
    } else {
      let args = t.args != null ? t.args : t.arguments != null ? t.arguments : t.input != null ? t.input : t.inputs;
      if (args === undefined) args = [];
      if (!Array.isArray(args)) args = [args];
      const has = (k) => Object.prototype.hasOwnProperty.call(t, k);
      const rk = ['returns', 'return', 'expected', 'output', 'result'].find(has);
      if (!rk) no(`test ${n} needs "returns": what the function gives back`);
      const a = plainJSON(args, 1500), ret = plainJSON(t[rk], 1500);
      if (a === undefined) no(`test ${n} "args" must be a short list of JSON values`);
      if (ret === undefined) no(`test ${n} "returns" must be a short JSON value`);
      c = { args: a, returns: ret };
    }
    const key = JSON.stringify(c);
    if (seen.has(key)) return; // the same test twice: once is enough
    seen.add(key);
    out.push(c);
  });
  return out;
}

// the solution's output for a test, written the ways an AI may have imagined a terminal: with input()'s
// prompts, and with the lines typed in as well
function terminalViews(r) {
  const withPrompts = r.out.filter((c) => c.k !== 'echo').map((c) => c.s).join('');
  const withEcho = r.out.map((c) => c.s).join('');
  return [withPrompts, withEcho];
}

function checkTask(spec, goal) {
  if (!isObj(spec)) no('"spec" must be an object: {"language": "python", "code": "starter code"}');
  if (!isObj(goal)) no('"goal" must be an object with "type", "tests" and "solution"');
  const solRaw = goal.solution != null ? goal.solution : goal.answer != null ? goal.answer : goal.reference;
  const lang = language(spec, typeof solRaw === 'string' ? solRaw : typeof spec.code === 'string' ? spec.code : '');
  const solution = code(solRaw, 'goal.solution', lang, false);
  let starter = code(spec.code != null ? spec.code : spec.starter, 'code', lang, true);
  let type = String(goal.type || '').toLowerCase().trim();
  if (!type) type = goal.name || goal.function ? 'function' : 'output';
  if (type === 'stdout' || type === 'print' || type === 'prints') type = 'output';
  if (type === 'return' || type === 'returns' || type === 'func') type = 'function';
  if (type !== 'output' && type !== 'function') no(`"goal.type" must be "output" or "function", not ${JSON.stringify(cut(type, 20))}`);
  let name = null;
  if (type === 'function') {
    name = String(goal.name || goal.function || '').trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || name.length > 40) no('a "function" goal needs "name": the name of the function the learner writes, like "area"');
  }
  const tests = cleanTests(goal, type);
  if (tests.length < 2 && (type === 'function' || tests.some((t) => t.stdin))) no('give at least 2 tests with different inputs, so a program can\'t just print the answer');
  const u = core.uses(lang, solution);
  if (u.random || core.uses(lang, starter).random) no('the task uses random numbers, so there is no one right output to check: take random out of tasks');
  if (u.turtle || core.uses(lang, starter).turtle) no('the task uses turtle: tasks are checked by what the program prints or returns, so use turtle only in blocks');
  const syn = core.parse(lang, solution);
  if (syn) no(`the solution has a syntax error: ${syn.text}`);
  let tolerance;
  if (goal.tolerance != null) {
    const t = Number(goal.tolerance);
    if (!Number.isFinite(t) || t < 0 || t > 0.5) no('"goal.tolerance" must be a small number, like 0.01');
    tolerance = t;
  }
  // the solution, on every test
  tests.forEach((t, i) => {
    const n = i + 1;
    if (type === 'output') {
      const r = core.run(lang, solution, { stdin: t.stdin || '', steps: STEPS, output: 20000 });
      if (r.error) {
        if (r.error.kind === 'eof') no(`test ${n}: the solution reads more lines with input() than the test's "stdin" gives`);
        if (r.error.kind === 'timeout') no(`test ${n}: the solution ran for too long`);
        no(`test ${n}: the solution stops with an error: ${r.error.text}`);
      }
      if (core.sameOutput(r.stdout, t.stdout, tolerance)) return;
      // a tab the lesson's JSON repair wrote out as "\t" (see code() above)
      if (/\\t/.test(t.stdout) && core.sameOutput(r.stdout, t.stdout.replace(/\\t/g, '\t'), tolerance)) { t.stdout = t.stdout.replace(/\\t/g, '\t'); return; }
      // the AI wrote the screen as a terminal shows it (prompts, typed lines): keep what the program itself prints
      if (terminalViews(r).some((v) => core.sameOutput(v, t.stdout, tolerance)) && r.stdout.trim()) { t.stdout = core.outLines(r.stdout).join('\n'); return; }
      const promptNote = r.asked && r.out.some((c) => c.k === 'prompt') ? ' (what input() shows as a prompt is not part of the output)' : '';
      no(`test ${n}: the solution printed ${shownOut(r.stdout)} but the test expects ${shownOut(t.stdout)}${promptNote}`);
    } else {
      const res = core.runTests(lang, { type, name, tests: [t], tolerance }, solution, { steps: STEPS, total: STEPS });
      const x = res.results[0];
      if (x.pass) return;
      if (x.why === 'missing') no(`the solution has no function named "${name}"`);
      if (x.why === 'error') {
        if (x.error && x.error.kind === 'timeout') no(`test ${n}: the solution ran for too long on ${x.call}`);
        if (x.error && x.error.kind === 'eof') no(`test ${n}: the solution calls input(), but a function task gets its values from "args"`);
        no(`test ${n}: ${x.call} stops with an error: ${x.error ? x.error.text : 'unknown'}`);
      }
      no(`test ${n}: the solution returned ${cut(x.got, 80)} for ${x.call}, but the test expects ${cut(x.want, 80)}`);
    }
  });
  // a function task's starter: at least the def line, from the solution
  if (type === 'function' && !starter.trim()) {
    starter = core.stub(lang, solution, name) || '';
    starter = starter.replace(/\n+$/, '');
  }
  // the starter code must not already pass
  const startGoal = { type, name, tests, tolerance };
  if (starter.trim() && !core.parse(lang, starter)) {
    const rs = core.runTests(lang, startGoal, starter, { steps: STEPS, total: STEPS * tests.length });
    if (rs.passed === rs.total) no('the starter code already passes every test: give code with a bug to fix, ___ blanks to fill in, or a part left for the learner to write');
  }
  if (starter.replace(/\s+/g, '') === solution.replace(/\s+/g, '')) no('the starter code is the same as the solution');
  const g = { type, tests, solution };
  if (name) g.name = name;
  if (tolerance !== undefined) g.tolerance = tolerance;
  if (JSON.stringify(g).length > 5800) no('the goal is too long: use a shorter solution or fewer, smaller tests');
  // what the learner does with the starting code: fill in its blanks, write (it is empty, or only a def line), or edit it
  const body = starter.split('\n').filter((l) => l.trim() && !/^\s*(?:#|\/\/)/.test(l) && !/^\s*pass\s*$/.test(l) && !/^\s*(?:def\s|function\s)/.test(l) && !/^\s*\}\s*$/.test(l));
  const mode = /_{3,}/.test(starter) ? 'fill' : body.length === 0 ? 'write' : 'edit';
  return { spec: { language: lang, code: starter, mode }, goal: g };
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try { return checkBlock(spec); } catch (err) {
    if (!(err instanceof Why)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: the solution passes, the starter doesn't; null leaves it out.
export function task(spec, goal) {
  try { return checkTask(spec, goal); } catch (err) {
    if (!(err instanceof Why)) throw err;
    note('task', err, { spec, goal });
    return null;
  }
}

// Why a spec (and goal) would be left out, or '' if it holds together: sent back to the AI to repair the part.
export function why(spec, goal) {
  try {
    if (goal === undefined) checkBlock(spec); else checkTask(spec, goal);
    return '';
  } catch (err) {
    if (err instanceof Why) return err.message;
    return 'it could not be checked: ' + String(err && err.message).slice(0, 200);
  }
}
