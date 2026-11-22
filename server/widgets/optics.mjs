// =====================================================================
// The optics bench, for lessons on light (server/widgets.mjs): a live ray
// diagram for lenses and mirrors, where the learner drags the object and
// the image moves (the principal rays, F and 2F, and the readouts u, v, f,
// m with NCERT's signs), and refraction with a laser they turn (Snell's
// law, the critical angle, total internal reflection, a glass slab's
// lateral shift, a prism's deviation and dispersion).
//
// The physics and the checks are shared with the page, in
// assets/js/widgets/optics-core.js: every bench the AI writes must hold
// together (a known lens or mirror, a sensible focal length, an object in
// front, known media, steps that the learner can reach), and every task
// must be possible (some position of the object, focal length or laser
// meets the goal) and not already done. Anything else is left out, and
// why() says what to change.
//
// PRIMER_WIDGET_DEBUG=1 logs why a bench was left out.
// =====================================================================
import core from '../../assets/js/widgets/optics-core.js';

export const label = 'an optics bench: a live ray diagram for lenses and mirrors, and refraction with a laser';

/* ---------- which lessons are offered it ---------- */

// Words that say a lesson is about light and optics, in the languages Primer serves. Strong ones are enough
// alone; weak ones ("light", "mirror", "lens", "image") also mean other things, so two different ones must
// appear together, or one in a physics or science lesson.
const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const latin = (w) => START + '(?:' + w + ')' + END;   // a whole word
const stem = (w) => START + '(?:' + w + ')';          // a word that starts so
const any = (w) => '(?:' + w + ')';                   // anywhere (scripts where words join up)
const STRONG = [
  // English
  stem('refract'), latin('snell(?:\'s|’s|s)?'), latin('total internal reflection'), latin('critical angles?'), latin('focal (?:length|point|plane)s?'),
  latin('principal (?:focus|axis)'), latin('ray diagrams?'), latin('ray optics'), latin('optics'), latin('optical'),
  latin('(?:concave|convex|spherical|plane|curved|converging|diverging) (?:mirrors?|lens(?:es)?)'), latin('(?:lens|mirror) formula'), stem('lens ?makers?'),
  stem('magnification'), latin('image formation'), latin('formation of (?:an |the )?images?'), latin('(?:real|virtual) images?'),
  latin('cent(?:re|er) of curvature'), latin('human eye'), latin('power of (?:a |the )?lens(?:es)?'), stem('myopi'), stem('hypermetropi'), stem('hyperopi'), stem('presbyopi'),
  latin('(?:near|far|short|long)[- ]?sighted(?:ness)?'), latin('dispersion of (?:white )?light'), latin('spectrum of (?:white )?light'), latin('laws? of reflection'),
  latin('angles? of (?:incidence|reflection|refraction|emergence|deviation)'), latin('(?:reflection|scattering) of light'), latin('rays? of light'), latin('light rays?'),
  latin('beams? of light'), latin('light beams?'), stem('periscope'), stem('kaleidoscope'), latin('lateral (?:shift|displacement|inversion)'), latin('glass (?:slab|prism|block)s?'),
  latin('dioptres?'), latin('diopters?'), latin('mirages?'), latin('twinkling of (?:the )?stars'), latin('tyndall effect'),
  // Hindi, Marathi, Bhojpuri, Maithili
  any('अपवर्तन'), any('परावर्तन'), any('लेंस'), any('लेन्स'), any('अवतल'), any('उत्तल'), any('फोकस दूरी'), any('फ़ोकस दूरी'), any('फोकल दूरी'), any('क्रांतिक कोण'),
  any('वर्ण विक्षेपण'), any('आवर्धन'), any('मानव नेत्र'), any('दृष्टि दोष'), any('प्रकाशिकी'), any('किरण आरेख'), any('स्नेल'), any('गोलीय दर्पण'), any('समतल दर्पण'),
  any('वक्रता केंद्र'), any('वक्रता केन्द्र'), any('भिंग'), any('अंतर्गोल'), any('अन्तर्गोल'), any('बहिर्गोल'), any('नाभीय अंतर'), any('नाभीय अन्तर'),
  // Bengali, Assamese
  any('প্রতিসরণ'), any('প্রতিসরাঙ্ক'), any('প্ৰতিসৰণ'), any('প্ৰতিসৰণাংক'), any('লেন্স'), any('অবতল'), any('অৱতল'), any('উত্তল'), any('ফোকাস দূরত্ব'), any('সংকট কোণ'),
  any('আলোর বিচ্ছুরণ'), any('আলোকবিজ্ঞান'),
  // Tamil
  any('ஒளிவிலகல்'), any('விலகல் எண்'), any('லென்சு'), any('லென்ஸ்'), any('குழி ஆடி'), any('குவி ஆடி'), any('குழியாடி'), any('குவியாடி'), any('குவிலென்ஸ்'), any('குழிலென்ஸ்'),
  any('குவியத் தொலைவு'), any('குவிய தூரம்'), any('முப்பட்டகம்'), any('நிறப்பிரிகை'), any('ஒளியியல்'), any('மாறுநிலைக் கோணம்'),
  // Telugu
  any('వక్రీభవన'), any('కటకం'), any('కటకాలు'), any('పుటాకార'), any('కుంభాకార'), any('నాభ్యంతరం'), any('సందిగ్ధ కోణం'), any('పట్టకం'), any('కాంతి పరావర్తన'),
  // Kannada
  any('ವಕ್ರೀಭವನ'), any('ಮಸೂರ'), any('ಸಂಗಮ ದೂರ'), any('ಅಶ್ರಗ'), any('ದೃಗ್ವಿಜ್ಞಾನ'), any('ನಿಮ್ನ ದರ್ಪಣ'), any('ಪೀನ ದರ್ಪಣ'), any('ಬೆಳಕಿನ ಪ್ರತಿಫಲನ'),
  // Malayalam
  any('അപവർത്തന'), any('ലെൻസ്'), any('കോൺകേവ്'), any('കോൺവെക്സ്'), any('ഫോക്കസ് ദൂരം'), any('ഫോക്കൽ ദൂരം'), any('പ്രകാശത്തിന്റെ പ്രതിഫലനം'),
  // Gujarati
  any('વક્રીભવન'), any('પરાવર્તન'), any('લેન્સ'), any('અંતર્ગોળ'), any('બહિર્ગોળ'), any('કેન્દ્રલંબાઈ'),
  // Punjabi
  any('ਅਪਵਰਤਨ'), any('ਪਰਾਵਰਤਨ'), any('ਲੈਂਜ਼'), any('ਲੈਨਜ਼'), any('ਲੈਂਸ'), any('ਅਵਤਲ'), any('ਉੱਤਲ'), any('ਉਤਲ'), any('ਫੋਕਸ ਦੂਰੀ'),
  // Odia
  any('ପ୍ରତିସରଣ'), any('ଲେନ୍ସ'), any('ଅବତଳ'), any('ଉତ୍ତଳ'), any('ଫୋକସ ଦୂରତା'),
  // Urdu
  any('انعطاف نور'), any('انعطافِ نور'), any('اشاریہ انعطاف'), any('عدسہ'), any('عدسے'), any('مقعر'), any('محدب'), any('ماسکی فاصلہ'), any('فوکل لمبائی'), any('بصریات'),
  // Arabic
  any('انكسار الضوء'), any('معامل الانكسار'), any('عدسة'), any('عدسات'), any('مقعرة'), any('محدبة'), any('البعد البؤري'), any('الزاوية الحرجة'), any('الانعكاس الكلي'),
  any('البصريات'), any('تشتت الضوء'), any('تحلل الضوء'),
  // Spanish, Portuguese, French
  stem('refracci'), stem('refraç'), stem('refracç'), stem('réfraction'), latin('reflexi[oó]n total'), latin('reflexão total'), latin('réflexion totale'),
  stem('c[óô]ncav'), latin('convex[oae]s?'), latin('distancia focal'), latin('distância focal'), latin('distance focale'), latin('[aá]ngulo (?:cr[ií]tico|l[ií]mite)'),
  latin('angle (?:critique|limite)'), latin('dispersi[oó]n de la luz'), latin('dispersão da luz'), latin('dispersion de la lumi[eè]re'), latin('[oó]ptica'), latin('ótica'), latin('optique'),
  // Russian
  stem('преломлени'), stem('линз'), stem('вогнут'), stem('выпукл'), stem('фокусн'), latin('полное внутреннее отражение'), latin('предельный угол'), stem('оптик'), latin('дисперсия света')
];
const WEAK = [
  ['light', latin('light|lights')], ['reflection', stem('reflect')], ['mirror', latin('mirrors?')], ['lens', latin('lens(?:es)?')], ['prism', latin('prisms?')],
  ['concave', stem('concav')], ['convex', stem('convex')],
  ['dispersion', latin('dispersion')], ['image', latin('images?')], ['ray', latin('rays?')], ['beam', latin('beams?')], ['laser', latin('lasers?')], ['eye', latin('eyes?')],
  ['spectacles', latin('spectacles')], ['telescope', stem('telescop')], ['microscope', stem('microscop')], ['camera', latin('cameras?')], ['shadow', latin('shadows?')],
  ['rainbow', latin('rainbows?')], ['spectrum', latin('spectrum')],
  ['प्रकाश', any('प्रकाश')], ['दर्पण', any('दर्पण')], ['प्रतिबिंब', any('प्रतिबिंब|प्रतिबिम्ब')], ['किरण', any('किरण')], ['प्रिज्म', any('प्रिज़्म|प्रिज्म')], ['नेत्र', any('नेत्र')], ['आरसा', any('आरसा|आरशा')],
  ['আলো', any('আলো|পোহৰ')], ['প্রতিফলন', any('প্রতিফলন|প্ৰতিফলন')], ['দর্পণ', any('দর্পণ|আয়না|দাপোণ')], ['প্রিজম', any('প্রিজম')], ['প্রতিবিম্ব', any('প্রতিবিম্ব|প্ৰতিবিম্ব')], ['রশ্মি', any('রশ্মি')],
  ['ஒளி', any('ஒளி')], ['எதிரொளிப்பு', any('எதிரொளிப்பு')], ['ஆடி', any('ஆடி')], ['பிம்பம்', any('பிம்பம்|பிம்ப')],
  ['కాంతి', any('కాంతి')], ['పరావర్తన', any('పరావర్తన')], ['దర్పణ', any('దర్పణ')], ['ప్రతిబింబ', any('ప్రతిబింబ')],
  ['ಬೆಳಕು', any('ಬೆಳಕ')], ['ಪ್ರತಿಫಲನ', any('ಪ್ರತಿಫಲನ')], ['ದರ್ಪಣ', any('ದರ್ಪಣ')], ['ಪ್ರತಿಬಿಂಬ', any('ಪ್ರತಿಬಿಂಬ')],
  ['പ്രകാശം', any('പ്രകാശ')], ['പ്രതിഫലനം', any('പ്രതിഫലന')], ['ദർപ്പണം', any('ദർപ്പണ')], ['പ്രതിബിംബം', any('പ്രതിബിംബ')],
  ['પ્રકાશ', any('પ્રકાશ')], ['અરીસો', any('અરીસ')], ['પ્રતિબિંબ', any('પ્રતિબિંબ')], ['ਪ੍ਰਕਾਸ਼', any('ਪ੍ਰਕਾਸ਼')], ['ਦਰਪਣ', any('ਦਰਪਣ')], ['ਪ੍ਰਤੀਬਿੰਬ', any('ਪ੍ਰਤੀਬਿੰਬ|ਪ੍ਰਤਿਬਿੰਬ')],
  ['ଆଲୋକ', any('ଆଲୋକ')], ['ପ୍ରତିଫଳନ', any('ପ୍ରତିଫଳନ')], ['ଦର୍ପଣ', any('ଦର୍ପଣ')], ['ପ୍ରତିବିମ୍ବ', any('ପ୍ରତିବିମ୍ବ')],
  ['روشنی', any('روشنی')], ['انعکاس', any('انعکاس')], ['آئینہ', any('آئینہ|آئینے')], ['عکس', any('عکس')], ['شعاع', any('شعاع')],
  ['ضوء', any('ضوء|الضوء')], ['انكسار', any('انكسار')], ['انعكاس', any('انعكاس')], ['مرآة', any('مرآة|مرايا|المرآة')], ['منشور', any('منشور')], ['أشعة', any('أشعة')],
  ['luz', latin('luz')], ['lumière', latin('lumi[eè]re')], ['reflexión', latin('reflexi[oó]n|reflexão|réflexion')], ['lente', latin('lentes?|lentilles?')],
  ['espejo', latin('espejos?|espelhos?|miroirs?')], ['prisma', latin('prismas?|prismes?')], ['imagen', latin('imagen|imagem')], ['rayo', latin('rayos?|raios?|rayons?')],
  ['свет', stem('свет')], ['отражени', stem('отражени')], ['зеркал', stem('зеркал')], ['призм', stem('призм')], ['изображени', stem('изображени')], ['луч', stem('луч')]
];
// phrases where those words mean something else
const NOT = new RegExp([
  'in (?:the )?light of', '(?:shed|sheds|shedding|throw|throws|throwing|threw|cast|casts|casting) (?:some |new )?light on', '(?:bring|brings|bringing|brought|came|come|comes|coming) to light',
  'make light of', 'light[- ](?:music|years?|weight|industry|industries|meal|rail|novels?|reactions?|dependent|independent|infantry|cavalry|house|heavy|bulbs? moment)', 'lightweight',
  'traffic lights?', 'festival of lights?', 'light and shade', 'speed of light in a vacuum is constant',
  'mirror[- ]images?', 'mirror(?:s|ed|ing)? (?:of|to) (?:society|the soul|life|the world)', 'mirrored', 'mirroring',
  'self[- ]reflection', 'reflect(?:s|ed|ing)? (?:on|upon|about)', 'reflections? (?:on|upon|about)', 'reflective (?:writing|practice|essays?|journals?|thinking|learning)',
  'reflection(?:al)? symmetry', 'lines? of (?:reflection|symmetry)', 'reflections? (?:in|across|over|about) (?:the )?(?:x|y)[- ]axis', 'reflections?,? (?:and )?(?:rotations?|translations?)',
  '(?:rotations?|translations?),? (?:and )?reflections?', 'reflection (?:in|of) (?:a |the )?(?:point|line|shape|graph|function)', 'geometric(?:al)? transformations?',
  'convex (?:polygons?|sets?|hulls?|functions?|optimi[sz]ation|quadrilaterals?|shapes?|polyhedr\\S*|combinations?|analysis|cones?|preferences?)', 'concave (?:polygons?|functions?|up|down|quadrilaterals?|shapes?)',
  'indifference curves? (?:are |is )?(?:convex|concave)',
  'concavity', 'convexity', '(?:through|from|with|using|under|via) (?:the |a |an |this |that |their |our |my |his |her )?(?:\\S+ )?lens(?:es)?', 'lens(?:es)? of (?!the eye|an eye|a camera|the camera)',
  'volume of (?:a |the )?(?:\\S+ )?prisms?', '(?:surface )?area of (?:a |the )?(?:\\S+ )?prisms?', 'prisms?,? (?:and )?(?:pyramids|cylinders|cones)', '(?:rectangular|triangular|hexagonal|pentagonal|square) prisms?(?! of glass)',
  'measures? of dispersion', 'dispersion (?:of|in) (?:the )?(?:data|statistics|scores|values)', 'statistical dispersion', 'seed dispersal',
  'image of (?:a |the )?(?:function|point|set|map)', 'self[- ]image', 'brand image', 'body image', 'public image', 'image processing', 'images? of (?:women|men|god|india)',
  'optical character recognition', 'optical (?:mouse|drives?|discs?|disks?)', 'optics of', '(?:x|gamma|cosmic|manta|sting)[- ]?rays?', 'rays? of hope', 'eye of the storm',
  // Hindi and others
  'प्रकाश डाल', 'के प्रकाश में', 'उत्तल बहुभुज', 'अवतल बहुभुज', 'प्रिज्म का आयतन', 'प्रिज़्म का आयतन', 'في ضوء', 'على ضوء', 'کی روشنی میں',
  'a la luz de', 'dar a luz', 'salir a la luz', 'à luz de', 'dar à luz', 'na [oó]tica d', 'à la lumière d', 'mettre en lumière',
  '(?:funci[oó]n|fun[cç][aã]o|fonction|pol[ií]gono|polygone|conjunto|ensemble) (?:c[oóô]ncav|convex)\\S*', 'medidas de dispersi\\S+', 'mesures de dispersion',
  'в свете', 'выпукл\\S* (?:функци|многоугольник|множеств)\\S*', 'вогнут\\S* функци\\S*'
].join('|'), 'gu');
// what weak words alone mean in a physics or science lesson
const CONTEXT = new RegExp([
  stem('physic'), latin('sciences?'), stem('ncert'), 'भौतिक', 'विज्ञान', 'পদার্থ', 'বিজ্ঞান', 'இயற்பியல்', 'அறிவியல்', 'భౌతిక', 'విజ్ఞాన', 'ಭೌತ', 'ವಿಜ್ಞಾನ',
  'ഭൗതിക', 'ശാസ്ത്ര', 'ભૌતિક', 'વિજ્ઞાન', 'ਭੌਤਿਕ', 'ਵਿਗਿਆਨ', 'ଭୌତିକ', 'ବିଜ୍ଞାନ', 'طبیعیات', 'سائنس', 'فيزياء', 'الفيزياء', 'العلوم',
  latin('f[ií]sica'), latin('ciencias?'), latin('ci[êe]ncias?'), latin('physique'), stem('физик'), latin('естествознани\\S*')
].join('|'), 'u');
// ...unless the lesson is plainly about something else
const ELSEWHERE = new RegExp([
  stem('photosynth'), stem('chlorophyll'), latin('plants?'), stem('paint'), stem('watercolou?r'), latin('portraits?'), latin('poe(?:m|ms|try)'), latin('novels?'),
  stem('literatur'), latin('stories|story'), latin('songs?'), latin('music'), stem('statistic'), latin('data'), stem('geometr'), stem('polygon'), latin('symmetry'),
  latin('volumes?'), latin('surface area'), latin('functions?'), latin('graphs?'), stem('religio'), stem('spiritual'), latin('diwali|deepavali'), latin('festivals?'),
  stem('meditat'), latin('god'), latin('prayers?'), stem('photograph'), latin('pixels?'), latin('digital'), stem('comput'), latin('history'), latin('makeup|make-up'),
  'प्रकाश पर्व', 'दीपावली', 'प्रकाश संश्लेषण', 'সালোকসংশ্লেষ', 'ஒளிச்சேர்க்கை', 'కిరణజన్య', 'ದ್ಯುತಿಸಂಶ್ಲೇಷಣೆ', 'പ്രകാശസംശ്ലേഷണ', 'પ્રકાશસંશ્લેષણ', 'ਪ੍ਰਕਾਸ਼ ਸੰਸ਼ਲੇਸ਼ਣ', 'ଆଲୋକଶ୍ଳେଷଣ',
  'ضيائي', 'ضوئي', 'fotos[ií]ntesis', 'fotoss[ií]ntese', 'photosynthèse', 'фотосинтез'
].join('|'), 'u');
const strongRe = new RegExp(STRONG.join('|'), 'u');
const weakRe = WEAK.map(([k, w]) => [k, new RegExp(w, 'u')]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (!s.trim()) return false;
  if (strongRe.test(s)) return true;
  const weak = new Set(weakRe.filter(([, re]) => re.test(s)).map(([k]) => k)).size;
  if (!weak || ELSEWHERE.test(s)) return false;
  return weak >= 2 || CONTEXT.test(s);
}

/* ---------- what the AI is told ---------- */

const EXAMPLE_BLOCK = '{"t": "widget", "kind": "optics", "spec": {"mode": "lens", "kind": "convex", "f": 12, "object": {"u": -40, "h": 4}, "sliders": ["f"], "record": true}, "caption": "Drag the object towards the lens: the image grows, moves away, then turns virtual past F1."}';
const EXAMPLE_TASK = '{"type": "task", "kind": "optics", "prompt": "Place the object so the image is real, inverted and the same size.", "spec": {"mode": "lens", "kind": "convex", "f": 10, "object": {"u": -35, "h": 3}}, "goal": {"type": "image", "nature": "real", "orientation": "inverted", "size": "same"}, "hint": "Where is v = -u?", "explain": "At 2F1, u = -20 cm: 1/v = 1/10 - 1/20, so v = +20 cm and m = v/u = -1."}';

export const prompt = [
  '',
  'Optics bench ("kind": "optics"): a live ray diagram the app solves exactly, with NCERT\'s New Cartesian signs (light goes left to right; distances in cm from the lens or mirror; the object\'s u is negative). Two modes:',
  '- Lens or mirror: {"mode": "lens" (kind "convex" or "concave") or "mirror" (kind "concave", "convex" or "plane"), "f": focal length in cm (1 to 100, signed by the kind; none for a plane mirror), "object": {"u": -30, "h": 3}}. The learner drags the object along the axis in whole cm; "drag": ["object", "height"] adds its height, "sliders": ["f"] a focal-length slider ("range": {"f": [5, 20]}), "record": true a table to note u, v and m. It draws the principal rays, F and 2F (F and C for a mirror) and the image, and reads out u, v, f, m and the image\'s nature.',
  '- Refraction: {"mode": "refraction", "from": "air", "to": "glass", "angle": 30}: a laser in "from" shines into "to"; the learner turns it (0 to 89°, whole degrees). Media: air, water, ice, kerosene, glass, flint glass, diamond, or {"n": 1.6, "name": "plastic"}. It shows i, r, the normal, Snell\'s law, the critical angle and total internal reflection. "shape": "slab" (with "thickness" in cm) shows the lateral shift; "shape": "prism" ("apex": 60; "white": true splits white light) the deviation. "media": ["water", "glass", "diamond"] lets the learner choose "to".',
  'Use it for image formation by lenses and mirrors, and for refraction, total internal reflection, slabs and prisms; call it "the bench below".',
  'A task\'s "goal" is checked on the readouts: the start and some positions miss it, others meet it (an open question is not a task):',
  '- {"type": "image", "nature": "real", "orientation": "inverted", "size": "same"}: any of these (size: "magnified", "diminished" or "same"); or values, {"type": "image", "v": 30} (also "u", "f", "m"; a number or [low, high]); or {"type": "image", "infinity": true}.',
  '- {"type": "ray", "tir": true}; {"type": "ray", "r": 20} (also "i", "deviation", or "shift" for a slab); {"type": "ray", "critical": true}; {"type": "ray", "minimum": true} (prism).',
  'Make the learner work it out ("place the object so the image is the same size", not "put it at -20 cm"); work numbers out exactly (f = 10 cm and u = -15 cm give v = +30 cm). Use the lesson\'s own cases and numbers; the examples show only the format.',
  'Example block: ' + EXAMPLE_BLOCK,
  'Example task: ' + EXAMPLE_TASK
].join('\n');

/* ---------- the checks ---------- */

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
function note(what, err, data) {
  if (debug()) console.log(`[widgets] optics ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}
const known = (err) => err instanceof core.OpticsError;

// a block is for trying things: one with nothing to drag, slide or turn is only a picture
function cleanBlock(spec) {
  const out = core.normSpec(spec);
  if (!core.canChange(out)) throw new core.OpticsError('a block needs something to try: ' + core.nothingToChange(out).replace(/^nothing for the learner to change: /, ''));
  return out;
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try { return cleanBlock(spec); } catch (err) {
    if (!known(err)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: the goal must be reachable and not met at the start; null leaves it out.
export function task(spec, goal) {
  try { return core.normTask(spec, goal); } catch (err) {
    if (!known(err)) throw err;
    note('task', err, { spec, goal });
    return null;
  }
}

// Why a spec (and goal) would be left out, in a line the AI can act on; '' when it holds together.
export function why(spec, goal) {
  try {
    if (goal === undefined) cleanBlock(spec); else core.normTask(spec, goal);
    return '';
  } catch (err) {
    return String(err && err.message || err);
  }
}

/* ---------- words for the translator (server/widgets.mjs widgetTexts) ---------- */

// The names of media the AI made up ({"n": 1.6, "name": "plastic"}), each once; known media are named by the page.
function names(spec) {
  if (!spec || spec.mode !== 'refraction') return [];
  const all = [spec.from, spec.to, ...(Array.isArray(spec.media) ? spec.media : [])];
  return [...new Set(all.filter((m) => m && m.key === 'custom' && typeof m.name === 'string' && m.name).map((m) => m.name))];
}
export function texts(spec) {
  try { return names(spec); } catch { return []; }
}
export function withTexts(spec, words) {
  const want = names(spec);
  if (!want.length || !Array.isArray(words) || words.length !== want.length) return null;
  const map = new Map(want.map((w, k) => [w, core.text(typeof words[k] === 'string' ? words[k] : '', core.LIMITS.name) || w]));
  const put = (m) => (m && m.key === 'custom' && m.name && map.has(m.name) ? { ...m, name: map.get(m.name) } : m);
  const out = { ...spec, from: put(spec.from), to: put(spec.to) };
  if (Array.isArray(spec.media)) out.media = spec.media.map(put);
  return out;
}
