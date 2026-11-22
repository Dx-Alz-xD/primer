// =====================================================================
// The physics sandbox, for lessons on mechanics (server/widgets.mjs): a
// live 2D scene (things falling with and without air, a launch, two balls
// colliding on a track, a block on a ramp, a box pushed across a floor, a
// mass on a spring, a pendulum, a ball against a brick wall, bodies in a
// tank of water) whose objects the learner drags and throws, with sliders
// for its numbers and a panel that shows every quantity live. Tasks are
// done by moving the sliders: land in a zone, make a value come out right,
// stop ball A, break the wall (or not).
//
// The checks and the engine are shared with the page, in
// assets/js/widgets/physics-core.js: every scene the AI writes must hold
// together (known scenes, sizes, masses and speeds that make sense, no
// spring too stiff for its mass, nothing overlapping), and every task
// must be possible (some setting of its sliders meets the goal when the
// scene is run) and not already done. Anything else is left out, and
// why() says what to fix.
//
// PRIMER_WIDGET_DEBUG=1 logs why a scene was left out.
// =====================================================================
import core from '../../assets/js/widgets/physics-core.js';

export const label = 'a physics simulation with live values';

/* ---------- which lessons are offered it ---------- */

// Mechanics, in the languages Primer serves. Strong words are enough alone; weak ones ("force", "motion",
// "speed", "energy"...) also mean other things, so two different ones must appear, or one with physics
// around it. With electricity or light about, it takes two strong ones: "the kinetic energy of
// photoelectrons" is not a lesson on mechanics.
const B = '(?<![\\p{L}\\p{M}\\p{N}])', E = '(?![\\p{L}\\p{M}\\p{N}])';
const whole = (w) => B + '(?:' + w + ')' + E;
const front = (w) => B + '(?:' + w + ')';
const any = (w) => '(?:' + w + ')';
const STRONG = [
  // English
  whole('air resistance|air drag|drag force|terminal (?:velocity|speed)|free[- ]fall(?:ing)?|friction|gravity|work and energy|work, energy'), front('projectile'), whole('trajector(?:y|ies)'),
  whole('(?:conservation of|linear) momentum|momentum and impulse|impulse[- ]momentum'), whole('(?:elastic|inelastic) collisions?|coefficient of restitution|restitution'),
  whole('(?:coefficient of|static|kinetic|sliding|rolling|limiting) friction|frictional force|force of friction'), whole('inclined planes?|incline'),
  whole('hooke(?:\'s|’s|s)? law|spring constant|simple harmonic motion|s\\.?h\\.?m'), front('pendul'), whole('oscillations? of a (?:spring|pendulum|mass)'),
  whole('kinetic (?:and potential )?energy|potential energy|mechanical energy|work[- ]energy(?: theorem| principle)?|conservation of (?:mechanical )?energy'),
  whole('newton(?:\'s|’s|s)? (?:laws?|first|second|third)|laws? of motion|(?:first|second|third) law of motion|equations? of motion'),
  front('gravitation'), whole('acceleration due to gravity|centre of gravity|center of gravity'), front('buoyan'), front('archimedes'), whole('upthrust'),
  whole('young(?:\'s|’s|s)? modulus|tensile strength|breaking (?:stress|strength|point)|stress[- ]strain|elastic (?:limit|deformation)|elasticity of (?:materials?|solids?)|strength of materials|material strength'),
  front('kinematic'), whole('uniform(?:ly)? accelerat\\w*|accelerated motion|(?:uniform|non-uniform|rectilinear) motion|motion in a (?:straight line|plane)'),
  whole('mechanics|dynamics of (?:a )?(?:particle|body|bodies)'),
  // Hindi, Marathi, Bhojpuri, Maithili
  any('गुरुत्वाकर्षण|गुरुत्व|घर्षण|संवेग|त्वरण|वायु प्रतिरोध|हवा का प्रतिरोध|हवेचा रोध|प्रक्षेप्य|प्रक्षेपित|गति के नियम|गतीचे नियम|न्यूटन के|न्यूटनचे|लोलक|गतिज ऊर्जा|स्थितिज ऊर्जा|यांत्रिक ऊर्जा|उत्प्लावन|उत्प्लावक|आर्किमिडीज|सरल आवर्त गति|मुक्त पतन|सीमांत वेग|आनत तल|प्रत्यास्थ संघट्ट|संघट्ट|प्रत्यास्थता|जड़त्व|जडत्व'),
  // Bengali, Assamese
  any('মহাকর্ষ|মাধ্যাকর্ষণ|মাধ্যাকৰ্ষণ|অভিকর্ষ|ঘর্ষণ|ঘৰ্ষণ|ভরবেগ|ভৰবেগ|ত্বরণ|ত্বৰণ|বায়ুর বাধা|প্রক্ষিপ্ত|গতির সূত্র|গতিৰ সূত্ৰ|দোলক|গতিশক্তি|স্থিতিশক্তি|প্লবতা|প্লৱতা|সংঘর্ষ|সংঘৰ্ষ|জাড্য'),
  // Tamil
  any('ஈர்ப்பு|உராய்வு|உந்தம்|முடுக்கம்|காற்றுத் தடை|எறிபொருள்|இயக்க விதி|நியூட்டனின்|ஊசல்|இயக்க ஆற்றல்|நிலை ஆற்றல்|மிதப்பு|மோதல்|நிலைமம்'),
  // Telugu
  any('గురుత్వాకర్షణ|గురుత్వ|ఘర్షణ|ద్రవ్యవేగం|త్వరణం|గాలి నిరోధం|ప్రక్షేపకం|చలన నియమాలు|న్యూటన్ నియమ|లోలకం|గతిజ శక్తి|స్థితిజ శక్తి|ప్లవనం|ప్లవన|అభిఘాతం|జడత్వం'),
  // Kannada
  any('ಗುರುತ್ವಾಕರ್ಷಣೆ|ಗುರುತ್ವ|ಘರ್ಷಣೆ|ಸಂವೇಗ|ವೇಗೋತ್ಕರ್ಷ|ಗಾಳಿಯ ಪ್ರತಿರೋಧ|ಪ್ರಕ್ಷೇಪಕ|ಚಲನೆಯ ನಿಯಮ|ನ್ಯೂಟನ್‌ನ ನಿಯಮ|ಲೋಲಕ|ಚಲನ ಶಕ್ತಿ|ಸ್ಥಿತಿ ಶಕ್ತಿ|ಪ್ಲವನ|ಜಡತ್ವ'),
  // Malayalam
  any('ഗുരുത്വാകർഷണ|ഗുരുത്വ|ഘർഷണ|ആക്കം|ത്വരണം|വായു പ്രതിരോധ|പ്രക്ഷേപ്യ|ചലന നിയമ|ന്യൂട്ടന്റെ|പെൻഡുലം|ദോലകം|ഗതികോർജ|സ്ഥിതികോർജ|പ്ലവക്ഷമ|ജഡത്വ'),
  // Gujarati
  any('ગુરુત્વાકર્ષણ|ગુરુત્વ|ઘર્ષણ|વેગમાન|પ્રવેગ|હવાનો અવરોધ|પ્રક્ષિપ્ત|ગતિના નિયમ|ન્યૂટનના|લોલક|ગતિ ઊર્જા|સ્થિતિ ઊર્જા|ઉત્પ્લાવક|અથડામણ|જડત્વ'),
  // Punjabi
  any('ਗੁਰੂਤਾ|ਗੁਰੂਤਾਕਰਸ਼ਣ|ਰਗੜ|ਸੰਵੇਗ|ਪ੍ਰਵੇਗ|ਹਵਾ ਦਾ ਵਿਰੋਧ|ਗਤੀ ਦੇ ਨਿਯਮ|ਨਿਊਟਨ ਦੇ|ਪੈਂਡੂਲਮ|ਗਤਿਜ ਊਰਜਾ|ਸਥਿਤਿਜ ਊਰਜਾ|ਜੜ੍ਹਤਾ'),
  // Odia
  any('ମାଧ୍ୟାକର୍ଷଣ|ଘର୍ଷଣ|ସଂବେଗ|ତ୍ୱରଣ|ବାୟୁ ପ୍ରତିରୋଧ|ଗତି ନିୟମ|ନିଉଟନ୍‌ଙ୍କ|ଦୋଳକ|ଗତିଜ ଶକ୍ତି|ସ୍ଥିତିଜ ଶକ୍ତି|ଜଡ଼ତା'),
  // Urdu
  any('کشش ثقل|رگڑ|معیار حرکت|اسراع|ہوا کی مزاحمت|حرکت کے قوانین|نیوٹن کے قوانین|پنڈولم|رقاص|حرکی توانائی|مخفی توانائی|تصادم|جمود'),
  // Arabic
  any('الجاذبية|الاحتكاك|كمية الحركة|الزخم الخطي|التسارع|مقاومة الهواء|المقذوف|قوانين نيوتن|قوانين الحركة|البندول|النواس|النابض|الطاقة الحركية|طاقة الوضع|الطفو|التصادم|السقوط الحر|السرعة الحدية|القصور الذاتي'),
  // Spanish, Portuguese, French
  whole('resistencia del aire|velocidad (?:terminal|l[ií]mite)|ca[ií]da libre|proyectil(?:es)?|tiro parab[oó]lico|cantidad de movimiento|momento lineal|choques? (?:el[aá]stic|inel[aá]stic)\\w*|colisi[oó]n(?:es)? (?:el[aá]stic|inel[aá]stic)\\w*|coeficiente de (?:restituci[oó]n|rozamiento|fricci[oó]n)|rozamiento|plano inclinado|ley de hooke|p[ée]ndulo|energ[ií]a (?:cin[ée]tica|potencial|mec[aá]nica)|leyes de newton|principio de arqu[ií]medes|flotabilidad|empuje hidrost[aá]tico'),
  whole('resist[êe]ncia do ar|velocidade terminal|queda livre|proj[ée]teis?|lan[çc]amento obl[ií]quo|quantidade de movimento|colis[ãa]o (?:el[aá]stica|inel[aá]stica)|coeficiente de (?:restitui[çc][ãa]o|atrito)|atrito|plano inclinado|lei de hooke|p[êe]ndulo|energia (?:cin[ée]tica|potencial|mec[aâ]nica)|leis de newton|empuxo'),
  whole('r[ée]sistance de l\'air|r[ée]sistance de l’air|vitesse limite|chute libre|quantit[ée] de mouvement|chocs? (?:[ée]lastiques?|in[ée]lastiques?|mous)|coefficient de (?:restitution|frottement)|frottements?|plan inclin[ée]|loi de hooke|pendules?|[ée]nergie (?:cin[ée]tique|potentielle|m[ée]canique)|lois de newton|pouss[ée]e d\'archim[èe]de|pouss[ée]e d’archim[èe]de|pesanteur'),
  // Russian
  front('сопротивлени[ея] воздуха|предельн\\p{L}* скорост|свободн\\p{L}* падени|тело,? брошенн|импульс тела|закон сохранения импульса|упруг\\p{L}* удар|неупруг\\p{L}* удар|коэффициент восстановлени|силы? трения|трени[ея]|наклонн\\p{L}* плоскост|закон гука|маятник|кинетическ\\p{L}* энерги|потенциальн\\p{L}* энерги|механическ\\p{L}* энерги|законы? ньютона|сила архимеда|выталкивающ|сила тяжести|тяготени|ускорени[ея] свободного')
];
const WEAK = [
  ['force', whole('forces?')], ['motion', whole('motion')], ['velocity', whole('velocit(?:y|ies)')], ['speed', whole('speeds?')], ['accel', front('accelerat')],
  ['mass', whole('mass(?:es)?')], ['weight', whole('weights?')], ['energy', whole('energy')], ['gravity', whole('gravity')], ['momentum', whole('momentum')],
  ['collision', whole('collisions?|collide')], ['elastic', front('elastic')], ['stress', whole('stress')], ['strain', whole('strain')], ['oscill', front('oscillat')],
  ['spring', whole('springs?')], ['drag', whole('drag')], ['friction', whole('friction')], ['inertia', whole('inertia')], ['impulse', whole('impulse')],
  ['displacement', whole('displacement')], ['newton', whole('newtons?')], ['joule', whole('joules?')], ['work', whole('work done')], ['density', whole('density')],
  ['falling', whole('falling (?:bodies|objects?)|fall(?:s|ing)? (?:to the ground|freely)')], ['ramp', whole('ramps?|slopes?')], ['bounce', whole('bounc(?:e|es|ing)')],
  ['बल', whole('बल|बलों')], ['वेग', whole('वेग')], ['गति', whole('गति|गती')], ['ऊर्जा', whole('ऊर्जा')], ['द्रव्यमान', any('द्रव्यमान')], ['भार', whole('भार')], ['स्प्रिंग', any('स्प्रिंग')], ['टक्कर', any('टक्कर')],
  ['বল', whole('বল')], ['বেগ', whole('বেগ')], ['গতি', whole('গতি')], ['শক্তি', whole('শক্তি')], ['ভর', whole('ভর|ভৰ')],
  ['விசை', any('விசை')], ['திசைவேகம்', any('திசைவேக')], ['இயக்கம்', any('இயக்கம்')], ['ஆற்றல்', any('ஆற்றல்')], ['நிறை', whole('நிறை')],
  ['బలం', whole('బలం|బలాలు')], ['వేగం', whole('వేగం')], ['చలనం', any('చలన')], ['శక్తి', whole('శక్తి')], ['ద్రవ్యరాశి', any('ద్రవ్యరాశి')],
  ['ಬಲ', whole('ಬಲ|ಬಲಗಳು')], ['ವೇಗ', whole('ವೇಗ')], ['ಚಲನೆ', any('ಚಲನೆ')], ['ರಾಶಿ', any('ರಾಶಿ')],
  ['ബലം', whole('ബലം')], ['പ്രവേഗം', any('പ്രവേഗ')], ['ചലനം', any('ചലന')], ['പിണ്ഡം', any('പിണ്ഡ')],
  ['બળ', whole('બળ')], ['વેગ', whole('વેગ')], ['ગતિ', whole('ગતિ')], ['દળ', whole('દળ')],
  ['ਬਲ', whole('ਬਲ')], ['ਵੇਗ', whole('ਵੇਗ')], ['ਗਤੀ', whole('ਗਤੀ')], ['ਪੁੰਜ', whole('ਪੁੰਜ')],
  ['ବଳ', whole('ବଳ')], ['ବେଗ', whole('ବେଗ')], ['ଗତି', whole('ଗତି')], ['ବସ୍ତୁତ୍ୱ', any('ବସ୍ତୁତ୍ୱ')],
  ['قوت', whole('قوت|قوتیں')], ['رفتار', any('رفتار')], ['حرکت', whole('حرکت')], ['کمیت', whole('کمیت')],
  ['القوة', any('القوة|القوى')], ['السرعة', any('السرعة')], ['الحركة', any('الحركة')], ['الكتلة', any('الكتلة')],
  ['fuerza', whole('fuerzas?|força|forças|forces?')], ['velocidad', whole('velocidad|velocidade|vitesse')], ['movimiento', whole('movimiento|movimento|mouvement')], ['masa', whole('masa|massa|masse')],
  ['aceleración', front('aceleraci|acelera[çc]|acc[ée]l[ée]ration')], ['energía', whole('energ[ií]a|[ée]nergie')],
  ['сила', whole('сила|силы|сил')], ['скорость', front('скорост')], ['движение', front('движени')], ['ускорение', front('ускорени')], ['масса', whole('масса|массы')], ['энергия', front('энерги')]
];
// physics being taught
const PHYS = new RegExp([
  '\\bphysics\\b', '\\bscience\\b', '\\bclass (?:8|9|10|11|12)\\b', '\\bgrade (?:8|9|10|11|12)\\b', '\\bncert\\b', '\\bcbse\\b', '\\bobjects?\\b', '\\bbod(?:y|ies)\\b', '\\bball\\b',
  'भौतिकी|भौतिक विज्ञान|विज्ञान|পদার্থবিদ্যা|পদার্থবিজ্ঞান|বিজ্ঞান|இயற்பியல்|அறிவியல்|భౌతిక|విజ్ఞాన|ಭೌತಶಾಸ್ತ್ರ|ವಿಜ್ಞಾನ|ഭൗതിക|ശാസ്ത്ര|ભૌતિક|વિજ્ઞાન|ਭੌਤਿਕ|ਵਿਗਿਆਨ|ପଦାର୍ଥ|ବିଜ୍ଞାନ|طبیعیات|سائنس|الفيزياء|فيزياء|العلوم',
  'f[ií]sica|physique|физик'
].join('|'), 'u');
// electricity, light and the atom: a physics lesson, but not one on mechanics
const ELSE = /electr|circuit|current|voltage|volt\b|charge|magnet|coulomb|lens|lenses|mirror|refract|reflect|optic|light|photon|photoelectric|wave|sound|nuclear|atom|विद्युत|बिजली|चुंबक|प्रकाश|लेंस|দর্পণ|আলো|তড়িৎ|மின்|ஒளி|విద్యుత్|కాంతి|ವಿದ್ಯುತ್|ಬೆಳಕು|വൈദ്യുത|പ്രകാശ|વિદ્યુત|પ્રકાશ|ਬਿਜਲੀ|ਪ੍ਰਕਾਸ਼|ବିଦ୍ୟୁତ|ଆଲୋକ|بجلی|روشنی|كهرباء|الضوء|électri|eléctri|elétric|lumi[èe]re|\bluz\b|электр|свет/u;
// phrases where those words mean something else
const NOT = new RegExp([
  'force of habit', 'air ?forces?', 'task ?forces?', 'work ?forces?', 'police force', 'labou?r force', 'armed forces', 'special forces', 'market forces', 'driving forces? (?:of|behind)',
  'tour de force', 'in force', 'force majeure', 'use of force', 'forced? (?:labou?r|marriage|migration)', 'join forces', 'life force',
  '(?:sales|market|business|economic|political|campaign|brand|growth|stock|price) momentum', 'momentum (?:investing|strategy|trading|stocks?|in (?:sales|business|marketing))',
  '(?:gain|gains|gained|gaining|build|builds|building|lose|loses|losing|lost) momentum', 'elastic(?:ity)? (?:of )?(?:demand|supply)', 'price elasticity', 'income elasticity', 'elastic search', 'elasticsearch',
  '(?:emotional|mental|exam|work|academic) stress', 'stress (?:management|relief|and anxiety)', '(?:post-)?traumatic stress', 'spring (?:season|break|festival|term|flowers?|onions?|rolls?)', 'in (?:the )?spring', 'hot springs?',
  'gravity of (?:the|this|a)', 'motion pictures?', 'motion to', 'slow motion', 'speed (?:reading|dating|typing)', 'kinetic (?:typography|art|sculpture)', 'collision (?:course|insurance|repair)',
  '(?:prices?|markets?|stocks?|economy|currency|rupee|sales) (?:\\w+ ){0,3}in free ?fall', 'trajectory of (?:the|his|her|their|a) (?:career|life|nation|economy)', 'career trajectory',
  'potential energy of (?:an? )?(?:charge|electron)', 'electric(?:al)? potential energy', 'chemical potential energy', 'energy (?:drinks?|bills?|sector|policy|crisis|security|efficiency|audit)',
  'weight (?:loss|gain|training|lifting|watchers)', 'body weight exercises?', 'mass (?:media|communication|production|extinction|movement|protest|tourism)', 'critical mass', 'catholic mass',
  'friction (?:between|in) (?:teams?|people|countries|nations|the party)', 'frictionless (?:onboarding|checkout|experience)', 'trade friction', 'inertia of (?:the )?(?:bureaucracy|government|habit)',
  'drag (?:and drop|queens?|racing|shows?)', 'pendulum of (?:public )?opinion', 'political pendulum'
].join('|'), 'gu');
const strongRe = new RegExp(STRONG.join('|'), 'gu');
const weakRe = WEAK.map(([k, w]) => [k, new RegExp(w, 'u')]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (!s.trim()) return false;
  const strong = new Set((s.match(strongRe) || []).map((w) => w.replace(/\s+/g, ' ').slice(0, 6)));
  const weak = weakRe.filter(([, re]) => re.test(s)).length;
  if (ELSE.test(s)) return strong.size >= 2 || (strong.size >= 1 && weak >= 3);
  if (strong.size) return true;
  return weak >= 2 || (weak >= 1 && PHYS.test(s));
}

/* ---------- what the AI is told ---------- */

const EXAMPLE_BLOCK = '{"t": "widget", "kind": "physics", "caption": "In air the ball stops speeding up at its terminal velocity. Try a heavier one.", "spec": {"scene": "drop", "height": 60, "bodies": [{"id": "A", "label": "in air", "r": 0.1, "mass": 0.05, "cd": 0.5}, {"id": "B", "label": "no air", "r": 0.1, "mass": 0.05, "air": false}], "sliders": [{"var": "A.mass", "min": 0.01, "max": 0.2, "step": 0.01}]}}';
const EXAMPLE_TASK = '{"type": "task", "kind": "physics", "prompt": "Set the angle so the ball lands on the target.", "spec": {"scene": "projectile", "speed": 15, "angle": 70, "sliders": [{"var": "angle", "min": 10, "max": 80, "step": 5}]}, "goal": {"type": "land", "body": "A", "x": [21, 24]}, "hint": "R = v² sin 2θ / g", "explain": "At 45°, 15² / 9.8 = 23 m."}';

export const prompt = [
  '',
  'Physics ("kind": "physics"): a live 2D scene the learner plays with (drag, throw, sliders) while a panel lists its numbers (velocity, acceleration, each force, momentum, energy) and graphs one against time.',
  '"spec": {"scene", its numbers, "bodies", "sliders", "show", "graph"}; SI units, defaults in ():',
  '- drop: "height" (10); 1-4 bodies side by side. Air resistance, terminal velocity.',
  '- projectile: "angle" (45), "speed" (15), "height" (0, a cliff); 1-3 bodies.',
  '- collision: 2-3 bodies {"mass", "v"} on a frictionless track; "e" (1; 0: they stick).',
  '- ramp: "angle" (30), "length" (5), a box {"mass", "mu", "mus"}; "force" up the slope.',
  '- push: a box on a floor, "force" (10), "mu" (0.3), "mus" (0.4).',
  '- spring: "k" (20), "damping", "length" (0.5), "pull" (0.15 from rest), "orient": vertical|horizontal.',
  '- pendulum: "length" (1), "angle" (20); 1-3 bobs.',
  '- wall: a ball at "speed" (8) hits a brick wall of "strength" (2000 N); "pad" (0): the contact time in s of a cushion on it.',
  '- float: water "density" (1000); 1-4 bodies with "density".',
  '- free: bodies at [x, y] ("at", "v", "fixed"); "walls" [{"x", "height"}], "ramps" [{"x", "angle", "length"}], "ropes" or "springs" [{"a": "A", "b": [x, y], "length", "k"}].',
  'Body: {"id": "A", "label", "shape": ball|box, "r" or "size": [w, h], "mass", "e", "mu", "cd" (air drag; none without)}. "g": 9.8, "moon", "mars".',
  '"sliders": {"var": "angle", "min": 15, "max": 75, "step": 5}, or a body\'s "A.mass", "A.cd", "A.v", "A.mu"; a block has 1-3 for what the lesson varies. "show" and "graph" (speed|height|x|vx|energy) are optional.',
  'Block example: ' + EXAMPLE_BLOCK,
  'A task is done with the sliders; the app runs the scene to check its "goal":',
  '- {"type": "land", "body": "A", "x": [40, 45]}',
  '- {"type": "value", "of": "range", "value": 20, "tol": 1} (or "min"/"max" for at least/at most); of: range, height, time (to land, reach the ramp\'s foot, or collide), speed (then), vx, terminal, period, extension, distance, accel, force',
  '- {"type": "stop", "body": "A"} (after colliding); {"type": "break", "breaks": true}; {"type": "slide", "moves": true}; {"type": "float", "floats": true}',
  'It starts NOT meeting the goal, and some slider step meets it: work it out (range v² sin 2θ / g; terminal velocity √(2mg / (1.2 Cd πr²)); impact m(1+e)v / (1/120 s or the pad); period 2π√(m/k), 2π√(L/g)).',
  'Task example: ' + EXAMPLE_TASK,
  'Use a block to explore an idea, a task to test it; build each for this lesson, as the examples only show the format. Only for mechanics: motion, forces, gravity, friction, collisions, springs, pendulums, energy, material strength, buoyancy.'
].join('\n');

/* ---------- the checks ---------- */

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
function note(what, err, data) {
  if (debug()) console.log(`[widgets] physics ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try {
    const out = core.normSpec(spec);
    const problem = core.blockProblem(out);
    if (problem) throw new core.PhysicsError(problem);
    return out;
  } catch (err) {
    if (!(err instanceof core.PhysicsError)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: some slider setting meets the goal, and the start doesn't; null leaves it out.
export function task(spec, goal) {
  try { return core.normTask(spec, goal); } catch (err) {
    if (!(err instanceof core.PhysicsError)) throw err;
    note('task', err, { spec, goal });
    return null;
  }
}

// Why a spec (and goal) would be left out, or '' if it holds together: sent back to the AI to mend it.
export function why(spec, goal) {
  try {
    if (goal === undefined) return core.blockProblem(core.normSpec(spec));
    core.normTask(spec, goal);
    return '';
  } catch (err) {
    return err instanceof core.PhysicsError ? err.message : `error: ${String((err && err.message) || err).slice(0, 200)}`;
  }
}

/* ---------- words for the translator (server/widgets.mjs widgetTexts) ---------- */

// The notes on the scene, then the bodies' names, then the fluid's (ids, numbers and scene names stay as they are).
export function texts(spec) {
  if (!spec || typeof spec !== 'object') return [];
  const notes = Array.isArray(spec.labels) ? spec.labels.map((l) => l && l.text) : [];
  const names = Array.isArray(spec.bodies) ? spec.bodies.map((b) => b && b.label) : [];
  return [...notes, ...names, spec.liquid].filter((s) => typeof s === 'string' && s);
}

// The same (already checked) spec with those words translated, in the same order; null keeps the original.
export function withTexts(spec, words) {
  const want = texts(spec);
  if (!want.length || !Array.isArray(words) || words.length !== want.length) return null;
  let k = 0;
  const next = (max, was) => core.text(typeof words[k] === 'string' ? words[k++] : (k++, ''), max) || was;
  const out = { ...spec };
  if (Array.isArray(spec.labels)) out.labels = spec.labels.map((l) => (l && typeof l.text === 'string' && l.text ? { ...l, text: next(40, l.text) } : l));
  if (Array.isArray(spec.bodies)) out.bodies = spec.bodies.map((b) => (b && typeof b.label === 'string' && b.label ? { ...b, label: next(24, b.label) } : b));
  if (typeof spec.liquid === 'string' && spec.liquid) out.liquid = next(16, spec.liquid);
  return out;
}
