// =====================================================================
// The graph (server half; server/widgets.mjs): curves y = f(x) on a
// coordinate plane, with sliders, points to drag, a tangent with its
// slope and a shaded area with its value. The browser half is
// assets/js/widgets/graph.js; the maths both use (expressions, specs,
// goals) is assets/js/widgets/graph-expr.js, so a spec the server lets
// through is read the same way where it is drawn.
//
// Every spec is checked strictly (graph-expr.js cleanSpec): the window
// is sane, sliders' ranges hold their start values, every expression
// reads and has values over most of the window and is seen in it, and
// there are size limits. A task's goal must be reachable with the
// sliders' steps and the points' snap (a grid search), and not already
// met at the start. Anything else is left out of the lesson.
// =====================================================================
import G from '../../assets/js/widgets/graph-expr.js';

export const label = 'a graph of functions, with sliders and points to drag';

/* ---------- which lessons are offered it ---------- */

// Words that mean graphs of functions wherever they appear.
const STRONG = new RegExp([
  // English
  'quadratic', 'parabol', 'polynomial', 'calculus', 'trigonometr', 'logarithm', 'asymptot', 'hyperbola', 'sinusoid',
  'coordinate geometry', 'cartesian (?:plane|coordinate|graph|ax)', 'linear (?:function|equation|graph|relation)',
  'equation of (?:a |the )?(?:straight )?line', 'straight[- ]line graph', 'simultaneous (?:linear )?equations', 'systems? of (?:linear )?equations',
  'y-intercept', 'x-intercept', 'turning point', 'stationary point', 'point of inflection', 'inflection point', 'vertex form', 'completing the square',
  'rate of change', 'tangent line', 'tangent to (?:a|the) curve', 'curve sketching', 'area under (?:a |the )?curve', 'definite integral',
  'antiderivative', 'riemann sum', 'first principles', 'power rule', 'chain rule', 'product rule', 'quotient rule',
  'graphs? of (?:a |the )?(?:function|equation|line|curve|sine|cosine)', 'graphing (?:function|equation|line)', 'function graph',
  'f\\(x\\)', 'y\\s*=\\s*mx', 'exponential (?:function|growth|decay|graph|curve)', 'logarithmic', 'sine (?:wave|curve|function|graph|rule)',
  'cosine', 'inverse function', 'domain and range', 'trig functions?', 'maxima and minima',
  '(?:velocity|distance|displacement|speed)[- ]time graph', 'supply and demand', '(?:demand|supply) curve',
  // Hindi, Marathi, Nepali, Bhojpuri, Maithili
  'द्विघात', 'वर्गसमीकरण', 'परवलय', 'बहुपद', 'त्रिकोणमिति', 'अवकल', 'समाकल', 'लघुगणक', 'घातांकी', 'निर्देशांक ज्यामिति',
  // Bengali, Assamese
  'দ্বিঘাত', 'অধিবৃত্ত', 'বহুপদী', 'ত্রিকোণমিতি', 'অন্তরকলন', 'অবকলন', 'সমাকলন', 'লগারিদম', 'স্থানাঙ্ক জ্যামিতি', 'কলনবিদ্যা',
  // Tamil
  'இருபடி', 'பரவளை', 'பல்லுறுப்பு', 'முக்கோணவியல்', 'வகைக்கெழு', 'வகையிடல்', 'தொகையீடு', 'நுண்கணிதம்', 'மடக்கை', 'ஆயத்தொலை வடிவியல்',
  // Telugu
  'వర్గ సమీకరణ', 'పరావలయ', 'బహుపది', 'త్రికోణమితి', 'అవకల', 'సమాకలన', 'కలన గణిత', 'సంవర్గమాన', 'నిరూపక జ్యామితి',
  // Kannada
  'ವರ್ಗ ಸಮೀಕರಣ', 'ಪರವಲಯ', 'ಬಹುಪದ', 'ತ್ರಿಕೋನಮಿತಿ', 'ಕಲನಶಾಸ್ತ್ರ', 'ಅವಕಲನ', 'ಅನುಕಲನ', 'ಲಘುಗಣಕ', 'ನಿರ್ದೇಶಾಂಕ ರೇಖಾಗಣಿತ',
  // Malayalam
  'ദ്വിമാന സമവാക്യ', 'പരാബോള', 'ബഹുപദ', 'ത്രികോണമിതി', 'അവകല', 'സമാകലന', 'ലോഗരിതം', 'നിർദ്ദേശാങ്ക ജ്യാമിതി',
  // Gujarati, Punjabi, Odia
  'દ્વિઘાત', 'પરવલય', 'બહુપદી', 'ત્રિકોણમિતિ', 'વિકલન', 'કલનશાસ્ત્ર', 'લઘુગણક',
  'ਤ੍ਰਿਕੋਣਮਿਤੀ', 'ਬਹੁਪਦ', 'ਪੈਰਾਬੋਲਾ', 'ਕੈਲਕੂਲਸ',
  'ଦ୍ୱିଘାତ', 'ତ୍ରିକୋଣମିତି', 'ବହୁପଦ', 'ଅବକଳନ', 'ସମାକଳନ',
  // Urdu, Arabic
  'دو درجی', 'قطع مکافی', 'کثیر رکنی', 'مثلثیات', 'لوگارتھم',
  'تربيعي', 'قطع مكافئ', 'كثيرة الحدود', 'كثيرات الحدود', 'حساب المثلثات', 'المثلثية', 'التفاضل', 'المشتقة', 'لوغاريتم', 'الهندسة التحليلية',
  // Spanish, Portuguese, French
  'cuadr[aá]tic', 'quadr[aá]tic', 'polinomi', 'polin[ôo]mi', 'c[aá]lculo diferencial', 'c[aá]lculo integral', 'logaritm',
  'geometr[ií]a anal[ií]tica', 'as[ií]ntota', 'pendiente de (?:la|una) recta', 'ecuaci[oó]n de (?:la|una) recta', 'sistemas? de ecuaciones', 'inclinação da reta',
  'polyn[ôo]me', 'second degr[ée]', 'g[ée]om[ée]trie analytique', 'coefficient directeur', 'taux de variation', 'tableau de variations',
  'fonction (?:affine|lin[ée]aire|exponentielle|carr[ée]e|d[ée]riv[ée]e)', '[ée]quation de (?:la |une )?droite',
  // Russian, German, Italian
  'квадратичн', 'квадратн[а-я]* уравнени', 'парабол', 'многочлен', 'полином', 'тригонометр', 'производная', 'интеграл', 'логарифм', 'асимптот',
  'аналитическая геометрия', 'график функци', 'угловой коэффициент',
  'quadratisch', 'ableitung', 'integralrechnung', 'funktionsgraph', 'polynom', 'logarithmus', 'trigonometrie', 'derivata', 'equazione di secondo grado'
].join('|'), 'u');

// Words that mean it only with maths around them (or a second of them): "the function of the liver",
// "an integral part", "financial derivatives" and "chemical equations" are not graphs.
const WEAK = new RegExp([
  /\bfunctions?\b/, /\bgraph(?:s|ing)?\b/, /\bequations?\b/, /\blinear\b/, /\bslopes?\b/, /\bgradients?\b/, /\bderivatives?\b/,
  /\bdifferentiat/, /\bintegra(?:l|ls|tion|te|ting)\b/, /\bsine\b/, /\bexponential/, /\bintercepts?\b/, /\bcurves?\b/, /\bplot/, /\btangents?\b/,
  /फलन|ग्राफ|आलेख|समीकरण|रैखिक|प्रवणता|ढाल|वक्र|निर्देशांक/,
  /ফাংশন|অপেক্ষক|লেখচিত্র|গ্রাফ|সমীকরণ|রৈখিক|ঢাল|বক্ররেখা|স্থানাঙ্ক/,
  /சார்பு|வரைபட|சமன்பாடு|நேரியல்|சாய்வு|வளைவரை/,
  /ప్రమేయ|గ్రాఫ్|రేఖాచిత్ర|సమీకరణ|రేఖీయ|వాలు/,
  /ಫಲನ|ಗ್ರಾಫ್|ಸಮೀಕರಣ|ರೇಖೀಯ|ಇಳಿಜಾರು/,
  /ഫലന|ഗ്രാഫ്|സമവാക്യ|രേഖീയ|ചരിവ്/,
  /વિધેય|આલેખ|ગ્રાફ|સમીકરણ|સુરેખ|ઢાળ|ਫਲਨ|ਗ੍ਰਾਫ|ਸਮੀਕਰਨ|ଫଳନ|ଗ୍ରାଫ|ଲେଖଚିତ୍ର|ସମୀକରଣ/,
  /تفاعل|فنکشن|گراف|مساوات|خطی|ڈھلوان|مشتق|تکمل/,
  /دالة|دوال|رسم بياني|التمثيل البياني|منحنى|معادلة|معادلات|خطية|ميل|تكامل|مماس/,
  /funci[oó]n|funciones|gr[aá]fic[ao]|ecuaci[oó]n|ecuaciones|\blineal\b|pendiente|derivada|\bintegral\b|\bcurva\b|tangente|\bseno\b|exponencial/,
  /função|funções|equaç[ãa]o|equações|inclinação/,
  /\bfonctions?\b|graphique|courbe|[ée]quations?\b|lin[ée]aire|\bpente\b|d[ée]riv[ée]e|int[ée]grale|\bsinus\b|exponentielle/,
  /функци|график|уравнени|линейн|наклон|кривая|касательн|синус|экспонент/,
  /\bfunktion|gleichung|steigung|funzione|grafico|equazione|pendenza|\bintegrale\b/
].map((re) => re.source).join('|'), 'gu');
// Maths (or physics, or economics) being taught.
const MATHS = /\bmaths?\b|mathemat|algebra|geometr|calculus|trigonometr|physics|kinematic|mechanics|velocity|acceleration|economics|\bx\b|variable|\baxis\b|\baxes\b|coordinate|formula|गणित|ज्यामिति|भौतिकी|अर्थशास्त्र|গণিত|জ্যামিতি|পদার্থবিদ্যা|கணித|வடிவியல்|இயற்பியல்|గణిత|జ్యామితి|భౌతిక|ಗಣಿತ|ರೇಖಾಗಣಿತ|ಭೌತಶಾಸ್ತ್ರ|ഗണിത|ജ്യാമിതി|ഭൗതിക|ગણિત|ભૂમિતિ|ભૌતિક|ਗਣਿਤ|ਰੇਖਾਗਣਿਤ|ਭੌਤਿਕ|ଗଣିତ|ଜ୍ୟାମିତି|ریاضی|الجبرا|جیومیٹری|طبیعیات|رياضيات|الجبر|الهندسة|الفيزياء|matem[aá]tic|[aá]lgebra|f[ií]sica|c[aá]lculo|math[ée]matique|alg[èe]bre|physique|математик|алгебр|геометри|физик|mathematik/u;
// ...unless the lesson is plainly about something else.
const ELSEWHERE = /chemi|chimi|qu[ií]mica|химич|रसायन|রসায়ন|வேதியியல்|python|javascript|\bjava\b|programm|coding|\bcode\b|\bsql\b|excel|spreadsheet|liver|kidney|\bheart\b|\blungs?\b|\bbrain\b|executive function|\borgans?\b|\bcells?\b|biolog|anatom|physiolog|graph theory|bar (?:graph|chart)|pie chart|pictograph|histogram|\bsocial\b|racial|european|financial|stock market|grammar|linguistic|hígado|corazón|cerveau|\bfoie\b|c(?:oe|œ)ur/u;

export function match(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return false;
  if (STRONG.test(s)) return true;
  // how many different such words ("graph" and "graphs" are one)
  const weak = new Set((s.match(WEAK) || []).map((w) => w.slice(0, 4))).size;
  return weak > 0 && (MATHS.test(s) || weak > 1) && !ELSEWHERE.test(s);
}

/* ---------- what the AI is told ---------- */

const EXAMPLE_BLOCK = String.raw`{"t": "widget", "kind": "graph", "spec": {"x": [-6, 6], "y": [-6, 10], "params": [{"name": "a", "min": -3, "max": 3, "step": 0.5, "value": 1, "label": "stretch"}, {"name": "k", "min": -5, "max": 5, "step": 1, "value": 0, "label": "lift"}], "plots": [{"expr": "a*x^2 + k", "color": "blue", "label": "\\(y = ax^2 + k\\)"}], "points": [{"x": 0, "y": "k", "label": "vertex"}]}, "caption": "Move \\(a\\) and \\(k\\): \\(a\\) stretches or flips the parabola, \\(k\\) lifts its vertex."}`;
const EXAMPLE_TASK = String.raw`{"type": "task", "kind": "graph", "prompt": "Set \\(m\\) and \\(c\\) so the line passes through \\((2, 5)\\).", "spec": {"x": [-5, 5], "y": [-5, 10], "params": [{"name": "m", "min": -4, "max": 4, "step": 0.5, "value": 1}, {"name": "c", "min": -5, "max": 5, "step": 0.5, "value": 0}], "plots": [{"expr": "m*x + c", "color": "blue", "label": "\\(y = mx + c\\)"}], "points": [{"x": 2, "y": 5, "label": "\\((2, 5)\\)", "color": "red"}]}, "goal": {"type": "params", "through": [[2, 5]]}, "hint": "Choose \\(m\\) first; then \\(c\\) must make \\(2m + c = 5\\).", "explain": "Any \\(m\\) and \\(c\\) with \\(2m + c = 5\\) work, for example \\(m = 2\\), \\(c = 1\\)."}`;

export const prompt = [
  '',
  'Graph ("kind": "graph"): a coordinate plane drawing curves y = f(x), with sliders, points to drag, an optional tangent (its slope shown) and an optional shaded area (its value shown).',
  'Use it only where seeing or changing a curve teaches: graphs of functions, lines and slope, quadratics, polynomials, trigonometric, exponential and logarithmic graphs, transformations, solving equations where curves meet, tangents and derivatives, areas and integrals, motion graphs. Arithmetic, proofs, algebra drill and anything without a curve get no graph, even if the lesson then has no interactive part.',
  'Its "spec": {"x": [xmin, xmax], "y": [ymin, ymax], "params": [...], "plots": [...], "points": [...], "lines": [...], "tangent": {...}, "area": {...}}',
  '- x, y: the window. Choose it so what matters (roots, vertex, crossings, the place to find) is well inside, at every slider setting the lesson asks for.',
  '- params: 0 to 4 sliders, {"name": "a", "min": -3, "max": 3, "step": 0.5, "value": 1, "label": "stretch"}. A name is a letter or short word (never x, y, e, pi or a function name); "value", the start, is min plus a whole number of steps.',
  '- plots: 1 to 4 curves, {"expr": "a*x^2", "color": "blue", "label": "..."}. Colours: blue, red, green, purple, gold, ink. Draw every curve the text or task names. A secant is a curve too: with sliders a and h, "((a + h)^2 - a^2)/h*(x - a) + a^2" for y = x^2.',
  '- points (optional, up to 8): {"x": 1, "y": 2, "label": "A"}. A fixed point may use expressions in the sliders, {"x": "-b/(2*a)", "y": "k"}. "drag": true makes one the learner drags: its x and y are numbers (moving in steps of "snap", default a twentieth of the window), or a slider\'s name, so dragging sets that slider ({"x": "h", "y": "k", "drag": true} is a vertex that moves h and k). "on": 0 keeps a point on curve 0.',
  '- lines (optional): {"x": 2} is vertical, {"y": "k"} horizontal.',
  '- tangent (optional): {"plot": 0, "x": 1}, a tangent to curve 0 the learner drags along it. area (optional): {"plot": 0, "from": 0, "to": 2}, shaded with its signed value; "from" and "to" may use slider names.',
  '- Expressions are plain text, never LaTeX: x, slider names, numbers, + - * / ^ and brackets. Write * in every product except a number times something (2x, 3(x - 1)); functions sin cos tan asin acos atan sqrt abs ln log (base 10) exp floor round min max; constants pi and e; angles in radians. For example "a*(x - h)^2 + k", "2*sin(b*x)", "exp(-x/2)", "1/(x - 1)". Labels may use \\( \\).',
  'A task\'s "goal" says what the learner must do in the graph. Make them work the answer out: "make the tangent flat", "find where the slope is 3", "put the vertex at (2, -1)"; never "move the tangent to x = 1", which gives the answer away. The goal must accept every right answer and nothing else: "tangent to y = x^2 at x = 2" is values {"m": 4, "c": -4}, not just "through" (2, 4).',
  '- {"type": "params", "values": {"a": 2, "k": -1}}: set those sliders to those values, each a value its slider reaches.',
  '- {"type": "params", "range": {"a": [1.5, 3]}}: any value from 1.5 to 3 on slider a, when several are right ("narrower than y = x^2 and opening upward").',
  '- {"type": "params", "through": [[2, 5]], "plot": 0}: any slider values that put curve 0 through every listed point. "values", "range" and "through" may be combined.',
  '- {"type": "point", "point": 0, "at": [3, 0]}: drag point 0 (a draggable one) to (3, 0); "at": [[-1, 0], [3, 0]] accepts either.',
  '- {"type": "x", "at": 2}: tap the graph at the x where something happens (a root, a peak, where curves cross, where the tangent is flat; with a tangent in the spec, the tangent moves there); "at" may be a list.',
  '- "tol" (optional) is how close counts. Every goal must be reachable with the sliders\' steps and the snap, and not already met at the start; the app checks this and drops any that fails.',
  'Example block: ' + EXAMPLE_BLOCK,
  'Example task: ' + EXAMPLE_TASK
].join('\n');

/* ---------- the checks ---------- */

// Why a spec (and goal) would be left out, or null if it's fine: for logs and tests.
export function explain(spec, goal) {
  try {
    const s = G.cleanSpec(spec);
    if (goal !== undefined) G.cleanGoal(goal, s);
    return null;
  } catch (err) {
    return err instanceof G.GraphError || err instanceof G.ExprError ? err.message : `error: ${String(err && err.message || err)}`;
  }
}

export function block(spec) {
  try { return G.cleanSpec(spec); } catch { return null; }
}

export function task(spec, goal) {
  try {
    const s = G.cleanSpec(spec);
    return { spec: s, goal: G.cleanGoal(goal, s) };
  } catch {
    return null;
  }
}

/* ---------- words for the translator (server/widgets.mjs widgetTexts) ---------- */

// The labels of sliders, curves, points and lines, in that order (empty ones skipped). A label in
// LaTeX goes too: the translator keeps maths as it is and translates any words around it.
const LABELLED = ['params', 'plots', 'points', 'lines'];
const labelled = (s) => LABELLED.flatMap((k) => (Array.isArray(s[k]) ? s[k] : []).filter((o) => o && o.label));
export function texts(spec) {
  try { return labelled(G.cleanSpec(spec)).map((o) => o.label); } catch { return []; }
}
export function withTexts(spec, words) {
  let s;
  try { s = G.cleanSpec(spec); } catch { return null; }
  if (!Array.isArray(words) || words.length !== labelled(s).length) return null;
  let i = 0;
  const out = { ...s };
  for (const k of LABELLED) {
    if (Array.isArray(s[k])) out[k] = s[k].map((o) => (o && o.label ? { ...o, label: String(words[i++] || '').trim() || o.label } : o));
  }
  try { return G.cleanSpec(out); } catch { return null; }
}
