// =====================================================================
// Numbers, for primary and middle-school maths (server/widgets.mjs):
// fraction shapes to shade, a number line to place values and make jumps
// on, and place-value blocks (Indian lakh and crore too). The browser
// half is assets/js/widgets/numbers.js; the maths and the checks both
// use are assets/js/widgets/numbers-core.js, with exact fractions, so a
// spec the server lets through is read the same way where it is drawn.
//
// Every spec is checked strictly: shapes cut into a sensible number of
// parts, a line whose steps fit from "from" to "to", places that hold
// the numbers; and every task must be possible (the fraction can be
// shaded on those parts, the value is on a tick, the jumps can add up)
// and not already done as it starts. why() says what is wrong, in a line
// the AI can act on.
// =====================================================================
import N from '../../assets/js/widgets/numbers-core.js';

export const label = 'a number tool (fraction shapes, a number line or place-value blocks)';

/* ---------- which lessons are offered it ---------- */

const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const word = (w) => START + '(?:' + w + ')' + END; // a whole word (Latin and Cyrillic scripts)
// Words that mean school number work wherever they appear.
const STRONG = new RegExp([
  // English
  word('numerators?|denominators?|place[- ]values?|number[- ]lines?|integers?|decimal (?:numbers?|fractions?|point)|tenths|hundredths|fractions'),
  word('(?:equivalent|proper|improper|like|unlike|unit|mixed|simple|comparing|adding|subtracting) fractions?|fractions? (?:of a (?:whole|shape|group|collection)|on (?:a|the) number line)|mixed numbers?'),
  word('(?:negative|positive|whole|natural|rational|even|odd|ordinal) numbers|number names?|expanded form|skip[- ]counting|counting (?:in|by) (?:ones|twos|fives|tens)|counting (?:to|up to|from) \\d+|numbers (?:up )?to \\d{2,}'),
  word('tens and ones|ones and tens|hundreds, tens and ones|(?:thousands|hundreds|tens|ones) place|regrouping|carrying and borrowing|lakhs? and crores?|(?:indian|international) (?:system of numeration|number(?:ing)? system)|place value chart'),
  // Hindi, Marathi, Bhojpuri, Maithili, Nepali (Devanagari)
  'भिन्नों', 'समतुल्य भिन्न', 'उचित भिन्न', 'अनुचित भिन्न', 'मिश्रित भिन्न', 'भिन्न संख्या', 'अंश और हर', 'अंश तथा हर', 'संख्या रेखा', 'संख्यारेखा', 'स्थानीय मान', 'स्थान मान', 'स्थानीयमान',
  'दशमलव', 'पूर्णांक', 'ऋणात्मक संख्या', 'पूर्ण संख्या', 'प्राकृत संख्या', 'परिमेय संख्या', 'दहाई', 'भारतीय संख्या पद्धति', 'अंतर्राष्ट्रीय संख्या पद्धति', 'लाख और करोड़',
  'अपूर्णांक', 'संख्यारेषा', 'संख्या रेषा', 'स्थानिक किंमत', 'दशांश',
  // Bengali, Assamese
  'ভগ্নাংশ', 'সংখ্যারেখা', 'সংখ্যা রেখা', 'স্থানীয় মান', 'দশমিক', 'পূর্ণসংখ্যা', 'অখণ্ড সংখ্যা',
  // Gujarati
  'અપૂર્ણાંક', 'સંખ્યા રેખા', 'સંખ્યારેખા', 'સ્થાનકિંમત', 'સ્થાન કિંમત', 'દશાંશ', 'પૂર્ણાંક',
  // Punjabi
  'ਭਿੰਨਾਂ', 'ਸੰਖਿਆ ਰੇਖਾ', 'ਸਥਾਨਕ ਮੁੱਲ', 'ਸਥਾਨ ਮੁੱਲ', 'ਦਸ਼ਮਲਵ', 'ਸੰਪੂਰਨ ਸੰਖਿਆ',
  // Odia
  'ଭଗ୍ନାଂଶ', 'ସଂଖ୍ୟାରେଖା', 'ସଂଖ୍ୟା ରେଖା', 'ସ୍ଥାନୀୟ ମାନ', 'ଦଶମିକ', 'ପୂର୍ଣ୍ଣସଂଖ୍ୟା',
  // Tamil
  'பின்னம்', 'பின்னங்கள்', 'எண் கோடு', 'எண்கோடு', 'இட மதிப்பு', 'இடமதிப்பு', 'தசம எண்', 'முழுக்கள்',
  // Telugu
  'భిన్నాలు', 'భిన్న సంఖ్య', 'సంఖ్యా రేఖ', 'సంఖ్యారేఖ', 'స్థాన విలువ', 'స్థానవిలువ', 'దశాంశ', 'పూర్ణాంకాలు', 'పూర్ణ సంఖ్యలు',
  // Kannada
  'ಭಿನ್ನರಾಶಿ', 'ಸಂಖ್ಯಾರೇಖೆ', 'ಸಂಖ್ಯಾ ರೇಖೆ', 'ಸ್ಥಾನಬೆಲೆ', 'ಸ್ಥಾನ ಬೆಲೆ', 'ದಶಮಾಂಶ', 'ಪೂರ್ಣಾಂಕ',
  // Malayalam
  'ഭിന്നസംഖ്യ', 'സംഖ്യാരേഖ', 'സ്ഥാനവില', 'ദശാംശ', 'പൂർണ്ണസംഖ്യ', 'പൂര്‍ണ്ണസംഖ്യ',
  // Urdu
  'شمار کنندہ', 'نسب نما', 'عددی خط', 'اعداد کی لکیر', 'مقامی قیمت', 'اعشاریہ', 'صحیح اعداد', 'منفی اعداد',
  // Arabic
  'البسط والمقام', 'الكسور العشرية', 'الكسور المتكافئة', 'خط الأعداد', 'القيمة المكانية', 'الأعداد العشرية', 'الأعداد الصحيحة', 'الأعداد السالبة', 'منزلة الآحاد',
  // Spanish, Portuguese, French
  word('fracciones|numerador|denominador|recta num[ée]rica|valor posicional|valor de posici[oó]n|n[uú]meros (?:decimales|enteros|negativos|naturales|racionales|mixtos)'),
  word('fra[cç][õo]es|reta num[ée]rica|n[uú]meros (?:decimais|inteiros|negativos|naturais|racionais|mistos)'),
  word('num[ée]rateur|d[ée]nominateur|droite (?:num[ée]rique|gradu[ée]e)|valeur (?:de position|positionnelle)|nombres (?:d[ée]cimaux|entiers|relatifs|n[ée]gatifs|rationnels)|fractions [ée]quivalentes'),
  // Russian
  'дроби', 'дробей', 'числител', 'знаменател', 'числовая прямая', 'числовой прямой', 'координатная прямая', 'десятичн', 'целые числа', 'отрицательные числа', 'натуральные числа'
].join('|'), 'u');

// Words that mean it only in a maths lesson: "a fraction of the cost", "in addition", "lakhs of
// people", "the first half of the century". Two different "pair" words together are enough too
// ("lakhs and crores", "counting and addition").
const WEAK = [
  ['fraction', word('fractions?'), 1], ['decimal', word('decimals?'), 1], ['addition', word('addition'), 1], ['subtraction', word('subtraction|subtracting'), 1],
  ['count', word('counting'), 1], ['lakh', word('lakhs?|lacs?'), 1], ['crore', word('crores?'), 1], ['negative', word('negatives?|below zero'), 1], ['part', word('equal parts|parts of a whole|shaded parts?'), 1],
  ['number', word('numbers?|numerals?|digits?')], ['half', word('half|halves|quarters?|thirds?')], ['place', word('hundreds|thousands|ones|tens')],
  ['भिन्न', 'भिन्न'], ['अंश', 'अंश'], ['जोड़', 'जोड़'], ['घटाव', 'घटाव', 1], ['गिनती', 'गिनती', 1], ['संख्या', 'संख्या'], ['लाख', 'लाख', 1], ['करोड़', 'करोड़|करोड', 1],
  ['ਭਿੰਨ', 'ਭਿੰਨ'], ['کسر', 'کسر|کسور'], ['كسر', 'كسر|كسور'], ['لاکھ', 'لاکھ', 1], ['کروڑ', 'کروڑ', 1], ['লক্ষ', 'লক্ষ|লাখ', 1], ['কোটি', 'কোটি', 1], ['যোগ', 'যোগ|বিয়োগ'],
  ['భిన్నం', 'భిన్నం'], ['fracción', word('fracci[oó]n|fra[cç][ãa]o|fraction'), 1], ['suma', word('suma|resta|adi[cç][ãa]o|subtra[cç][ãa]o|soustraction')],
  ['число', word('числ[аоы]|сложени[ея]|вычитани[ея]')], ['дробь', word('дробь')]
].map(([k, re, pair]) => [k, new RegExp(re, 'u'), Boolean(pair)]);
// Maths being taught.
const MATHS = /(?<![\p{L}\p{M}])(?:maths?|mathematics|arithmetic|numeracy|sums)(?![\p{L}\p{M}])|गणित|অংক|গণিত|ગણિત|ਗਣਿਤ|ଗଣିତ|கணித|గణిత|ಗಣಿತ|ഗണിത|ریاضی|حساب|رياضيات|matem[aá]tic|math[ée]matique|математик|арифметик/u;
// ...unless it is plainly about something else (and not maths as well).
const ELSEWHERE = /chemi|distill|petroleum|crude oil|programm|coding|python|javascript|\bjava\b|\bsql\b|excel|spreadsheet|binary|hexadecimal|computer|finance|stock market|economics|nutrition|calorie|biolog|music|grammar|रसायन|রসায়ন|வேதியியல்/u;
// phrases where those words mean something else
const NOT = /(?:a|small|tiny|large|the) fraction of (?:a|an|the|his|her|their|its)? ?\w+|fractions? of a second|in addition(?: to)?|addition reactions?|counting (?:sheep|calories|the cost|down)|line of best fit|negative (?:feedback|thinking|emotions?|thoughts?|reinforcement|charges?|ions?)|decimal places? in|dewey decimal/g;

// "class 3 maths", "grade 2 math", "std 4 mathematics": primary school maths is mostly number work
const PRIMARY = /(?:class|grade|std\.?|standard|year|कक्षा|শ্রেণি|শ্রেণী|ધોરણ|ਜਮਾਤ|ଶ୍ରେଣୀ|வகுப்பு|తరగతి|ತರಗತಿ|ക്ലാസ്|جماعت|الصف)\s*(?:[1-5]|i{1,3}|iv|v|१|२|३|४|५)(?![\p{L}\p{N}])/iu;

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (!s) return false;
  const maths = MATHS.test(s);
  if (!maths && ELSEWHERE.test(s)) return false;
  if (STRONG.test(s)) return true;
  if (maths && PRIMARY.test(s)) return true;
  const hits = WEAK.filter(([, re]) => re.test(s));
  return hits.length > 0 && (maths || hits.filter(([, , pair]) => pair).length > 1);
}

/* ---------- what the AI is told ---------- */

const EXAMPLE_BLOCK = '{"t": "widget", "kind": "numbers", "spec": {"mode": "blocks", "places": 3, "start": {"tens": 3, "ones": 14}}, "caption": "Bundle 10 ones into a ten: 3 tens and 14 ones make 44."}';
const EXAMPLE_TASK = '{"type": "task", "kind": "numbers", "prompt": "Show 3 + 4 with jumps of 1.", "spec": {"mode": "line", "from": 0, "to": 10, "step": 1, "hops": [1]}, "goal": {"type": "jumps", "sum": "3 + 4", "hop": 1}, "hint": "Start on 3.", "explain": "Four jumps of 1 from 3 land on 7."}';

export const prompt = [
  '',
  'Numbers ("kind": "numbers"), for school maths: fractions, decimals, integers, the number line, counting, adding and taking away, place value. Numbers: 3, -2.5 or "3/5".',
  '- "fraction" (parts of a whole): shapes in equal parts the learner taps to shade. {"mode": "fraction", "shape": "bar", "parts": 4} ("bar", "circle", or "grid" with "rows" and "cols", 10 by 10 for hundredths; "shaded": 1 starts one shaded). Two shapes, to compare or show equal fractions: "shapes": [{...}, {...}] ("join": "add" puts + between); "fixed": true locks one.',
  '  Goals: {"type": "shade", "value": "3/4"} (shape 0; "shape": 1 the other; "value": "1/2 + 1/4" to add; "sum": true adds both shapes, for 5/4); {"type": "equal"} (both, equal fractions). parts × value must be whole: 3/4 needs 4, 8 or 12 parts.',
  '- "line" (order, fractions and decimals, negatives, adding by jumps): a marker to drag or tap onto a tick. {"mode": "line", "from": -5, "to": 5, "step": 1} (at most 40 steps; "labels": "all", "ends", "whole" or "none"; "step": "1/4" labels fractions, 0.25 decimals; "marks": [{"at": 2, "label": "A"}] fixed points; "hops": [1, 2] jump buttons; "start": 3 puts the marker there).',
  '  Goals: {"type": "place", "value": "3/5"} (on a tick); {"type": "jumps", "sum": "3 + 4"} (from 3, jump 4 right; "6 - 2" jumps left; "hop": 1: every jump 1).',
  '- "blocks" (place value): base-10 blocks to add, take away, bundle (10 ones make a ten) and break; the number shows in digits and words. {"mode": "blocks", "places": 4, "start": 0} ("places": 4 is up to thousands, 6 lakhs, 8 crores; "start" may be {"tens": 5, "ones": 2}; "edit": false allows only bundling and breaking).',
  '  Goals: {"type": "build", "value": 3452} ("fewest": true: fewest blocks); {"type": "build", "counts": {"tens": 4, "ones": 12}}.',
  '"grouping": "indian" (any mode) writes 1,23,456 with lakhs and crores, for Indian syllabi; "international" 123,456.',
  'A task starts unsolved; don\'t give the answer away (in "place", label only some ticks). Use this lesson\'s own numbers: the examples only show the format.',
  'Example block: ' + EXAMPLE_BLOCK,
  'Example task: ' + EXAMPLE_TASK
].join('\n');

/* ---------- the checks ---------- */

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
function note(what, err, data) {
  if (debug()) console.log(`[widgets] numbers ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1200) : ''}`);
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try { return N.cleanBlock(spec); } catch (err) {
    if (!(err instanceof N.NumError)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: the goal must be possible and not done at the start; null leaves it out.
export function task(spec, goal) {
  try { return N.cleanTask(spec, goal == null ? {} : goal); } catch (err) {
    if (!(err instanceof N.NumError)) throw err;
    note('task', err, { spec, goal });
    return null;
  }
}

// Why a block (goal undefined) or a task would be left out, in one line the AI can act on; '' if it is fine.
export function why(spec, goal) {
  try {
    if (goal === undefined) N.cleanBlock(spec); else N.cleanTask(spec, goal == null ? {} : goal);
    return '';
  } catch (err) {
    return err instanceof N.NumError ? err.message : `error: ${String(err && err.message || err).slice(0, 200)}`;
  }
}

/* ---------- words for the translator (server/widgets.mjs widgetTexts) ---------- */

// The names on shapes, the labels of points on a line and its unit, in that order. Numbers stay as they are.
function slots(s) {
  if (!s || typeof s !== 'object') return [];
  if (s.mode === 'fraction') return (s.shapes || []).map((x, i) => (x && x.label ? ['shapes', i, 'label'] : null)).filter(Boolean);
  if (s.mode === 'line') {
    const out = (s.marks || []).map((m, i) => (m && m.label ? ['marks', i, 'label'] : null)).filter(Boolean);
    if (s.unit) out.push(['unit']);
    return out;
  }
  return [];
}
const at = (s, p) => (p.length === 1 ? s[p[0]] : s[p[0]][p[1]][p[2]]);

export function texts(spec) {
  try { const s = N.cleanSpec(spec); return slots(s).map((p) => at(s, p)); } catch { return []; }
}
export function withTexts(spec, words) {
  let s;
  try { s = N.cleanSpec(spec); } catch { return null; }
  const list = slots(s);
  if (!list.length || !Array.isArray(words) || words.length !== list.length) return null;
  const out = JSON.parse(JSON.stringify(s));
  list.forEach((p, i) => {
    const max = p[0] === 'unit' ? 8 : p[0] === 'marks' ? 14 : 40;
    const w = N.text(typeof words[i] === 'string' ? words[i] : '', max);
    if (!w) return;
    if (p.length === 1) out[p[0]] = w; else out[p[0]][p[1]][p[2]] = w;
  });
  try { return N.cleanSpec(out); } catch { return null; }
}
