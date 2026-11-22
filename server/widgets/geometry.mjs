// =====================================================================
// The geometry board, for lessons on geometry (server/widgets.mjs): points
// the learner drags, with the segments, lines, circles, polygons and
// marked angles made from them following along, and live measurements
// (lengths, angles, areas, sums and ratios). In a lesson it shows that
// something stays true as a figure changes ("drag any corner: the angles
// still add up to 180°"); as a task the learner makes something true
// ("drag C so that angle ACB is 90°").
//
// The model, the measurements and the checks are shared with the page, in
// assets/js/widgets/geometry-core.js: every board the AI writes must hold
// together (names that exist, nothing made from itself, everything there
// and inside the view at the start, measurements that read), and every
// task's example solution must meet its conditions while the start
// doesn't. Anything else is left out of the lesson; why() says why, in a
// sentence the AI can act on.
//
// PRIMER_WIDGET_DEBUG=1 logs why a board was left out.
// =====================================================================
import core from '../../assets/js/widgets/geometry-core.js';

export const label = 'a geometry board: points to drag, with lines, circles and angles that follow, and live measurements';

/* ---------- which lessons are offered it ---------- */

const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const word = (w) => START + w + END;   // a whole word
const stem = (w) => START + w;         // a word that starts so
const any = (w) => w;                  // anywhere (scripts where words join up)
// Words that mean school geometry wherever they appear.
const STRONG = [
  // English
  stem('geometr'), stem('pythagor'), stem('parallelogram'), stem('quadrilateral'), stem('polygon'), stem('rhomb'), stem('trapezi'), stem('trapezoid'),
  stem('isosceles'), stem('equilateral'), stem('scalene'), stem('hypotenuse'), stem('circumcent'), stem('circumcircle'), stem('incircle'), stem('incent(?:re|er)'),
  stem('orthocent'), stem('centroid'), word('perpendicular bisectors?'), word('angle bisectors?'), word('bisect(?:s|ing)? (?:an|the|a) (?:angle|line|segment)'),
  stem('transversal'), word('congruen(?:t|ce|cy) (?:of )?(?:triangles|figures|shapes)'), word('congruence of'), word('criteria (?:for|of) congruence'),
  word('(?:sss|sas|asa|aas|rhs) (?:rule|criteri(?:on|a)|congruence|test)'), word('similar (?:triangles|figures|shapes|polygons)'), word('similarity of'),
  word('circle theorems?'), word('theorems? on circles'), word('chords? of (?:a |the )?circles?'), word('tangents? (?:to|of|from) (?:a |an |the )?(?:circle|point|external)'),
  word('inscribed angles?'), word('cyclic quadrilaterals?'), word('angles? subtended'), word('arcs? of (?:a |the )?circle'), word('sectors? of (?:a |the )?circle'),
  word('vertically opposite'), word('complementary angles?'), word('supplementary angles?'), word('alternate (?:interior |exterior )?angles?'),
  word('corresponding angles?'), word('co-?interior angles?'), word('linear pairs?'), word('angle sum'), word('exterior angles?'), word('interior angles?'),
  word('angles? (?:of|in) (?:a |the )?(?:triangle|quadrilateral|polygon)s?'), word('sum of (?:the )?angles'), word('parallel lines'), word('lines and angles'),
  word('types of angles'), word('(?:acute|obtuse|reflex|right|straight) angles?'), word('right[- ]angled'), word('area of (?:a |the )?(?:triangles?|parallelograms?|trapeziums?|rhombus|quadrilaterals?|polygons?|circles?)'),
  word('heron[\'’]?s formula'), word('loci'), stem('euclid'), word('(?:compass|compasses) and (?:a )?(?:ruler|straightedge)'), word('ruler and (?:a )?compass(?:es)?'),
  stem('protractor'), word('constructions? of (?:a |an |the )?(?:triangles?|angles?|bisectors?|perpendiculars?|tangents?)'), word('lines? of symmetry'),
  word('rotational symmetry'), word('reflection symmetry'), word('geometric transformations?'), word('distance formula'), word('section formula'),
  word('mid-?point formula'), word('mid-?point theorem'), word('basic proportionality'), word('thales'), word('heights and distances'), word('angles? of (?:elevation|depression)'),
  word('trigonometric ratios?'),
  // Hindi, Marathi, Bhojpuri, Maithili, Nepali
  any('ज्यामिति'), any('रेखागणित'), any('भूमिती'), any('भूमिति'), any('त्रिभुज'), any('स्पर्श रेखा'), any('स्पर्शरेखा'), any('चतुर्भुज'), any('समांतर रेखा'), any('समान्तर रेखा'),
  any('समानांतर रेखा'), any('सर्वांगसम'), any('पाइथागोरस'), any('पायथागोरस'), any('बहुभुज'), any('समद्विबाहु'), any('समबाहु'), any('समकोण'), any('न्यूनकोण'), any('अधिककोण'),
  any('त्रिज्या'), any('समलंब'), any('समचतुर्भुज'), any('समांतर चतुर्भुज'), any('समांतरभुज'), any('कोण समद्विभाजक'), any('लंब समद्विभाजक'), any('त्रिकोण'),
  // Bengali, Assamese
  any('জ্যামিতি'), any('ত্রিভুজ'), any('ত্ৰিভুজ'), any('স্পর্শক'), any('চতুর্ভুজ'), any('সামান্তরিক'), any('সর্বসম'), any('পিথাগোরাস'), any('পিথাগোৰাছ'), any('বহুভুজ'),
  any('সমদ্বিবাহু'), any('সমবাহু'), any('অতিভুজ'), any('সমকোণ'),
  // Gujarati
  any('ભૂમિતિ'), any('ત્રિકોણ'), any('સ્પર્શક'), any('ચતુષ્કોણ'), any('સમાંતરબાજુ'), any('એકરૂપ'), any('પાયથાગોરસ'), any('બહુકોણ'), any('સમદ્વિબાજુ'), any('સમબાજુ'), any('કાટકોણ'),
  // Kannada
  any('ರೇಖಾಗಣಿತ'), any('ತ್ರಿಭುಜ'), any('ಸ್ಪರ್ಶಕ'), any('ಚತುರ್ಭುಜ'), any('ಸರ್ವಸಮ'), any('ಪೈಥಾಗರಸ್'), any('ಬಹುಭುಜ'), any('ಸಮದ್ವಿಬಾಹು'), any('ಸಮಬಾಹು'), any('ಲಂಬಕೋನ'),
  // Malayalam
  any('ജ്യാമിതി'), any('ത്രികോണ'), any('തൊടുവര'), any('ചതുർഭുജ'), any('സാമാന്തരിക'), any('സർവസമ'), any('പൈതഗോറസ്'), any('ബഹുഭുജ'), any('സമപാർശ്വ'), any('സമഭുജ'), any('മട്ടകോണ'),
  // Odia
  any('ଜ୍ୟାମିତି'), any('ତ୍ରିଭୁଜ'), any('ସ୍ପର୍ଶକ'), any('ଚତୁର୍ଭୁଜ'), any('ସାମାନ୍ତରିକ'), any('ସର୍ବସମ'), any('ପିଥାଗୋରାସ'), any('ବହୁଭୁଜ'), any('ସମଦ୍ୱିବାହୁ'), any('ସମବାହୁ'),
  // Punjabi
  any('ਜਿਆਮਿਤੀ'), any('ਰੇਖਾਗਣਿਤ'), any('ਤ੍ਰਿਭੁਜ'), any('ਸਪਰਸ਼ ਰੇਖਾ'), any('ਚਤੁਰਭੁਜ'), any('ਸਰਬੰਗਸਮ'), any('ਪਾਇਥਾਗੋਰਸ'), any('ਬਹੁਭੁਜ'), any('ਸਮਦੋਭੁਜੀ'), any('ਸਮਭੁਜੀ'),
  // Tamil
  any('வடிவியல்'), any('வடிவியல'), any('முக்கோண'), any('தொடுகோடு'), any('நாற்கர'), any('இணைகர'), any('சர்வசம'), any('பிதாகரஸ்'), any('பைதாகரஸ்'), any('பலகோண'), any('இருசமபக்க'), any('சமபக்க'), any('செங்கோண'),
  // Telugu
  any('జ్యామితి'), any('త్రిభుజ'), any('స్పర్శరేఖ'), any('చతుర్భుజ'), any('సర్వసమాన'), any('పైథాగరస్'), any('బహుభుజి'), any('సమద్విబాహు'), any('సమబాహు'), any('లంబకోణ'),
  // Urdu
  any('جیومیٹری'), any('علم ہندسہ'), any('مماس'), any('متوازی الاضلاع'), any('فیثاغورث'), any('فیثاغورس'), any('کثیرالاضلاع'), any('کثیر الاضلاع'), any('متساوی الساقین'), any('متساوی الاضلاع'), any('چوکور'),
  // Arabic
  any('الهندسة المستوية'), any('الهندسة الإقليدية'), any('هندسة إقليدية'), any('رباعي الأضلاع'), any('متوازي الأضلاع'), any('تطابق المثلثات'), any('تشابه المثلثات'), any('فيثاغورس'),
  any('مضلع'), any('متساوي الساقين'), any('متساوي الأضلاع'), any('منصف الزاوية'), any('المنصف العمودي'), any('الزاوية المحيطية'), any('الزوايا المتقابلة'),
  // Spanish, Portuguese, French
  stem('geometr[ií]a'), stem('cuadril[aá]tero'), stem('paralelogramo'), stem('pit[aá]goras'), stem('pol[ií]gono'), stem('is[oó]sceles'), stem('equil[aá]tero'), stem('mediatriz'),
  stem('bisectriz'), stem('hipotenusa'), stem('trapecio'), word('teorema de tales'), word('[aá]ngulos? (?:inscrito|central|opuestos|complementarios|suplementarios|alternos|correspondientes)'),
  word('tri[aá]ngulos (?:congruentes|semejantes)'), word('semejanza de tri[aá]ngulos'), word('congruencia de tri[aá]ngulos'),
  stem('quadril[aá]tero'), stem('pol[íi]gono'), stem('bissetriz'), word('semelhan[cç]a de tri[aâ]ngulos'), word('congru[eê]ncia de tri[aâ]ngulos'),
  stem('g[ée]om[ée]trie'), stem('quadrilat[èe]re'), stem('parall[ée]logramme'), stem('pythagore'), stem('polygone'), stem('isoc[èe]le'), stem('[ée]quilat[ée]ral'),
  stem('m[ée]diatrice'), stem('bissectrice'), stem('hypot[ée]nuse'), word('th[ée]or[èe]me de thal[èe]s'), word('triangles (?:isom[ée]triques|semblables)'),
  // Russian
  stem('геометри'), stem('четыр[её]хугольник'), stem('параллелограмм'), stem('пифагор'), stem('многоугольник'), stem('равнобедренн'), stem('равносторонн'),
  word('серединн[а-я]* перпендикуляр'), stem('биссектрис'), stem('гипотенуз'), word('признак[а-я]* равенства'), word('подоби[а-я]* треугольник'), stem('трапеци')
];
// Words that mean it only with maths around them (or a second of them): "the angle of the story",
// "a circle of friends", "the reflection of light", "a chord on the guitar" are not geometry.
const WEAK = [
  ['triangle', stem('triang')], ['angle', stem('angles?') + END], ['circle', word('circles?')], ['chord', word('chords?')], ['tangent', word('tangents?')],
  ['radius', word('radius|radii')], ['diameter', word('diameters?')], ['arc', word('arcs?')], ['sector', word('sectors?')], ['perpendicular', stem('perpendicular')],
  ['parallel', stem('parallel')], ['symmetry', stem('symmetr')], ['reflection', word('reflections?')], ['rotation', word('rotations?')], ['translation', word('translations?')],
  ['area', word('areas?')], ['perimeter', word('perimeters?')], ['theorem', word('theorems?')], ['proof', word('proofs?|prove')], ['construction', word('constructions?|construct')],
  ['congruent', stem('congruen')], ['similar', word('similar|similarity')], ['vertex', word('vertex|vertices')], ['bisect', stem('bisect')], ['midpoint', stem('mid-?points?')],
  ['diagonal', word('diagonals?')], ['square', word('squares?')], ['rectangle', word('rectangles?')], ['compass', word('compass(?:es)?')], ['segment', word('line segments?')],
  ['ray', word('rays?')], ['shapes', word('shapes|figures')], ['coordinates', word('coordinates?')], ['trigonometry', stem('trigonometr')],
  ['कोण', any('कोण')], ['वृत्त', any('वृत्त')], ['जीवा', any('जीवा')], ['समरूप', any('समरूप')], ['लंब', any('लंब')], ['क्षेत्रफल', any('क्षेत्रफल')], ['परिमाप', any('परिमाप')], ['प्रमेय', any('प्रमेय')], ['रचना', any('रचना')],
  ['কোণ', any('কোণ')], ['বৃত্ত', any('বৃত্ত')], ['সদৃশ', any('সদৃশ')], ['ক্ষেত্রফল', any('ক্ষেত্রফল')], ['উপপাদ্য', any('উপপাদ্য')],
  ['ખૂણ', any('ખૂણ')], ['વર્તુળ', any('વર્તુળ')], ['સમરૂપ', any('સમરૂપ')], ['ಕೋನ', any('ಕೋನ')], ['ವೃತ್ತ', any('ವೃತ್ತ')], ['ಸಮರೂಪ', any('ಸಮರೂಪ')],
  ['കോൺ', any('കോൺ|കോണ')], ['വൃത്ത', any('വൃത്ത')], ['ସଦୃଶ', any('ସଦୃଶ')], ['କୋଣ', any('କୋଣ')], ['ବୃତ୍ତ', any('ବୃତ୍ତ')], ['ਕੋਣ', any('ਕੋਣ')], ['ਚੱਕਰ', any('ਚੱਕਰ')],
  ['கோண', any('கோண')], ['வட்ட', START + 'வட்ட'], ['వృత్త', any('వృత్త')], ['కోణ', any('కోణ')],
  ['مثلث', any('مثلث')], ['زاویہ', any('زاویہ|زاویے')], ['دائرہ', any('دائرہ|دائرے')], ['زاوية', any('زاوية|زوايا')], ['دائرة', any('دائرة|الدائرة')], ['هندسة', any('هندسة|الهندسة')],
  ['triángulo', stem('tri[aâá]ngulo')], ['ángulo', stem('[aâá]ngulos?') + END], ['círculo', stem('c[ií]rculo|circunfer[eê]ncia')], ['cercle', word('cercles?')],
  ['треугольник', stem('треугольник')], ['угол', stem('уг(?:ол|л)')], ['окружност', stem('окружност')]
];
// Maths being taught.
const MATHS = /\bmaths?\b|mathemat|\bgeometr|algebra|arithmetic|numeracy|\bncert maths|गणित|ज्यामिति|গণিত|জ্যামিতি|கணித|வடிவியல்|జ్యామితి|గణిత|ಗಣಿತ|ഗണിത|ગણિત|ਗਣਿਤ|ଗଣିତ|ریاضی|رياضيات|matem[aá]tic|math[ée]matique|математик|mathematik/u;
// ...unless the lesson is plainly about something else.
const ELSEWHERE = /\bstor(?:y|ies)\b|\bnovel|\bpoe(?:m|try)|literature|\bfilm|\bmovie|camera|photograph|journalis|\bnews\b|reporter|\bfriends?\b|social|\bmusic|guitar|piano|\bsongs?\b|\bdance|\boptics?\b|\blight\b|mirror|\blens|refract|chemi|molecul|\bbond|biolog|\bcells?\b|marketing|\bsales\b|business|politic|\bhistory\b|language|grammar|\bplanet|\borbit|\bearth\b|\bcrops?\b|football|cricket|\bsport/u;
// phrases where geometry words mean something else
const NOT = /geometric (?:progressions?|sequences?|series|means?|distributions?|growth|brownian)|circles? of (?:friends|life|trust)|(?:vicious|inner|full|family|social|reading|story|talking) circles?|circle time|love triangles?|bermuda triangle|triangular trade|angles? of (?:approach|attack|incidence|reflection|refraction)|(?:news|story|camera|marketing|sales|new|different|personal) angles?|chord progressions?|(?:guitar|piano|music(?:al)?) chords?|congruence modulo|modular congruence|parallel (?:universe|processing|computing|circuits?|session|lives)|in parallel|(?:self[- ])?reflections? (?:on|about|journal)|crop rotation|rotation of (?:the )?(?:earth|crops|planets?)|earth'?s rotation|translations? (?:of|from|into) (?:the )?(?:text|word|book|language|english|hindi)|machine translation|on a tangent|go(?:es|ing)? off on a tangent/g;
const strongRe = new RegExp(STRONG.join('|'), 'u');
const weakRe = WEAK.map(([k, w]) => [k, new RegExp(w, 'u')]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (!s.trim()) return false;
  if (strongRe.test(s)) return true;
  const weak = weakRe.filter(([, re]) => re.test(s)).length;
  if (!weak || ELSEWHERE.test(s)) return false;
  return weak >= 2 || MATHS.test(s);
}

/* ---------- what the AI is told ---------- */

const EXAMPLE_BLOCK = '{"t": "widget", "kind": "geometry", "spec": {"x": [0, 12], "y": [0, 11], "grid": true, "points": {"O": [6, 5], "A": [2, 2], "B": [10, 2], "C": {"at": [6, 10], "on": "c"}}, "objects": [{"type": "circle", "center": "O", "through": "A", "name": "c"}, {"type": "segment", "of": ["O", "A"]}, {"type": "segment", "of": ["O", "B"]}, {"type": "segment", "of": ["C", "A"]}, {"type": "segment", "of": ["C", "B"]}, {"type": "angle", "at": "O", "from": "A", "to": "B"}, {"type": "angle", "at": "C", "from": "A", "to": "B"}], "drag": ["C"], "measure": ["angle AOB", "angle ACB", "angle AOB / angle ACB"]}, "caption": "Drag C round the upper arc: angle ACB changes place but stays half of angle AOB."}';
const EXAMPLE_TASK = '{"type": "task", "kind": "geometry", "prompt": "Drag C so that angle ACB is a right angle.", "spec": {"x": [0, 8], "y": [0, 6], "grid": true, "points": {"A": [1, 1], "B": [7, 1], "C": [2, 5]}, "objects": [{"type": "polygon", "of": ["A", "B", "C"]}, {"type": "angle", "at": "C", "from": "A", "to": "B"}], "drag": ["C"], "measure": ["angle ACB"]}, "goal": {"all": ["angle ACB = 90"], "solution": {"C": [4, 4]}}, "hint": "Try the circle with diameter AB.", "explain": "Any point on the circle with diameter AB gives 90°, such as (4, 4)."}';

export const prompt = [
  '',
  'Geometry board ("kind": "geometry"): points the learner drags; the segments, lines, circles, polygons and marked angles made from them follow, with live measurements. A block shows what stays true as the figure changes; a task has the learner make something true.',
  '"spec": {"x": [0, 10], "y": [0, 8], "grid": true, "points": {...}, "objects": [...], "drag": [...], "measure": [...]}',
  '- x, y: the view (one scale both ways), holding every point at the start and in the solution. "grid": true: squares, and dragged points move square by square ("snap": 0.5 for halves); "axes": true: numbered axes.',
  '- points: {"A": [0, 0], "P": {"at": [3, 4], "on": "c"}}: capital names (A, B1, A\'). "on" keeps a point on a segment, line or circle: a point dragged round a circle needs it. drag: the points the learner moves.',
  '- objects, each {"type": ...}: "segment", "ray", "line" {"of": ["A", "B"]}; "polygon" {"of": ["A", "B", "C"]}; "circle" {"center": "O", "through": "A"} or {"center": "O", "radius": 3} (O must be a point); "angle" {"at": "C", "from": "A", "to": "B"} (marks angle ACB with its size).',
  '  Points made from others, with a "name": "midpoint" {"of": ["A", "B"]}; "intersection" {"of": ["AB", "c"]} (meeting twice: add "near": [x, y]); "foot" {"from": "P", "to": "AB"}; "centroid", "circumcentre", "incentre", "orthocentre" {"of": ["A", "B", "C"]}.',
  '  Lines made from others: "perpendicular", "parallel" {"through": "P", "to": "AB"}; "perpendicular bisector" {"of": ["A", "B"]}; "angle bisector" {"at": "B", "from": "A", "to": "C"}; "tangent" {"at": "T", "to": "c"} or {"from": "P", "to": "c", "points": ["T", "U"]}.',
  '  Images A\', B\'...: "reflect" {"of": ["A", "B", "C"], "in": "l"}, "rotate" {..., "about": "O", "by": 90}, "translate" {..., "by": [3, 1]}, "enlarge" {..., "center": "O", "by": 2}.',
  '  Make what must stay true stay true as points move: C "on" the perpendicular to AB through A keeps angle A right; a parallelogram ABCD makes D in "objects" from the others: {"type": "translate", "of": ["A"], "by": "BC", "names": ["D"]}.',
  '  A line or circle used by others needs a "name" ("l", "c"); "AB" is the line through A and B. Options: "color" (ink, red, blue, green, gold), "dashed": true, "label": "a few words", "length": true (a segment\'s length).',
  '- measure, live: "AB", "angle ACB", "angle A" (a polygon\'s), "area ABC", "perimeter ABCD", "radius c", and sums, ratios, squares: "angle A + angle B + angle C", "AB/DE", "AB^2 + BC^2".',
  'A task\'s "goal": {"all": [conditions], "solution": {"C": [3, 3]}}: all must hold after the learner drags. Conditions: "angle ACB = 90", "AB = AC", "area ABC = 12", "AB/DE = 2", "P on c", "AB parallel CD", "AB perpendicular CD", "ABC isosceles" (equilateral, right), "ABCD parallelogram" (rectangle, rhombus, square, trapezium, kite, cyclic), "ABC congruent DEF", "ABC similar DEF". "solution": where the dragged points go so all hold (on the grid\'s squares); the start must not meet them. Work every number out: the app checks it all.',
  'Example block: ' + EXAMPLE_BLOCK,
  'Example task: ' + EXAMPLE_TASK
].join('\n');

/* ---------- the checks ---------- */

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
function note(what, msg, data) {
  if (debug()) console.log(`[widgets] geometry ${what} left out: ${msg}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function blockOf(spec) {
  const s = core.cleanSpec(spec);
  // a block is for trying things: one with nothing to drag is only a picture (lessons have figures for that)
  if (!s.drag.length) throw new core.GeoError('a block needs a point to drag: list it in "drag"');
  return s;
}
function taskOf(spec, goal) {
  // the points the solution moves are the ones dragged, if the spec doesn't say; and the view holds them
  const sol = isObj(goal) ? goal.solution || goal.answer || goal.example : null;
  const keys = isObj(sol) ? Object.keys(sol).filter((k) => /^[A-Z][0-9]{0,2}'{0,2}$/.test(k)) : [];
  const include = keys.map((k) => sol[k]).filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  const s = core.cleanSpec(spec, { drag: keys.length ? keys : undefined, include, task: true, solution: isObj(sol) ? sol : undefined });
  return { spec: s, goal: core.cleanGoal(goal, s) };
}
const reason = (err) => (err instanceof core.GeoError ? err.message : `error: ${String((err && err.message) || err).slice(0, 200)}`);

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try { return blockOf(spec); } catch (err) { note('block', reason(err), spec); return null; }
}

// A task's spec and goal, checked: the solution must meet the goal and the start must not; null leaves it out.
export function task(spec, goal) {
  try { return taskOf(spec, goal); } catch (err) { note('task', reason(err), { spec, goal }); return null; }
}

// Why a spec (and goal) would be left out, or '' if it holds together: a sentence the AI can act on.
export function why(spec, goal) {
  try { if (goal === undefined) blockOf(spec); else taskOf(spec, goal); return ''; } catch (err) { return reason(err); }
}

/* ---------- words for the translator (server/widgets.mjs widgetTexts) ---------- */

// The objects' labels, then the measurements' labels, in that order. Point names, measurements and
// conditions stay as they are.
export function texts(spec) {
  if (!isObj(spec)) return [];
  const objs = Array.isArray(spec.objects) ? spec.objects.map((o) => isObj(o) && o.label) : [];
  const ms = Array.isArray(spec.measure) ? spec.measure.map((m) => isObj(m) && m.label) : [];
  return [...objs, ...ms].filter((s) => typeof s === 'string' && s);
}

// The same (already checked) spec with those words translated, in the same order; null keeps the original.
export function withTexts(spec, words) {
  const want = texts(spec);
  if (!want.length || !Array.isArray(words) || words.length !== want.length) return null;
  let k = 0;
  const next = (was) => { const w = words[k++]; const s = typeof w === 'string' ? w.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, core.LIMITS.label) : ''; return s || was; };
  const out = { ...spec };
  if (Array.isArray(spec.objects)) out.objects = spec.objects.map((o) => (isObj(o) && typeof o.label === 'string' && o.label ? { ...o, label: next(o.label) } : o));
  if (Array.isArray(spec.measure)) out.measure = spec.measure.map((m) => (isObj(m) && typeof m.label === 'string' && m.label ? { ...m, label: next(m.label) } : m));
  try { return core.cleanSpec(out); } catch { return null; }
}
