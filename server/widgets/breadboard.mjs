// =====================================================================
// The breadboard bench, for hands-on lessons (server/widgets.mjs): the
// learner builds real circuits, as in Tinkercad: they place LEDs,
// resistors, buttons, a switch, a pot, an LDR and a buzzer on a
// breadboard, wire them to a battery, a motor or an Arduino Uno, write
// the Arduino's sketch, and watch it work. (The "circuit" kind, with
// textbook diagrams, stays for circuit theory.)
//
// The checks, the simulator and the sketch interpreter are shared with
// the page, in assets/js/widgets/breadboard-core.js: every bench the AI
// writes must hold together (real holes, legs as far apart as the part's
// legs reach, one leg or wire end in a hole, a starter sketch that
// compiles, no short circuit and no LED burning as it starts), a block
// that is built must be able to work, and every task must be possible:
// the core builds a working answer from the bench's own parts and proves
// it with the simulator, and the bench must not meet the goal as it
// starts. Anything else is left out, and why() says what to repair.
//
// PRIMER_WIDGET_DEBUG=1 logs why a bench was left out.
// =====================================================================
import core from '../../assets/js/widgets/breadboard-core.js';

export const label = 'a breadboard bench (an Arduino, LEDs, resistors, buttons and wires to build with)';

// Words that say a lesson is about building circuits, electronics or the Arduino, in the languages
// Primer serves. Strong words are enough alone; weak ones also mean other things, so two must appear.
const START = '(?<![\\p{L}\\p{M}\\p{N}])', END = '(?![\\p{L}\\p{M}\\p{N}])';
const latin = (w) => START + w + END;
const stem = (w) => START + w;
const any = (w) => w;
const STRONG = [
  // English
  stem('breadboard'), latin('arduinos?'), latin('microcontrollers?'), stem('electronic'), stem('tinker'), stem('robotics'), latin('robot kits?'),
  latin('sensors?'), stem('resistors?'), latin('leds'), latin('led\'s'), latin('(?:an?|the|one|two|three|each|this|that|red|green|blue|yellow|white|rgb|single|first|second) leds?'),
  latin('leds? (?:lights?|bulbs?|lamps?|blinks?|blinking|strips?|circuits?|glows?)'), latin('light[- ]emitting diodes?'), latin('(?:build|building|make|making|wire|wiring) (?:a |your own |simple )?circuits?'),
  latin('colou?r codes?'), stem('electric'), latin('jumper wires?'), latin('potentiometers?'), latin('photoresistors?'), latin('ldrs?'), latin('buzzers?'), latin('circuit diagrams?'),
  latin('short[- ]circuits?'), latin('series circuits?'), latin('parallel circuits?'), latin('ohm\'?s law'), latin('voltage'), stem('physical computing'),
  // Hindi, Marathi, Bhojpuri, Maithili
  any('इलेक्ट्रॉनिक'), any('इलेक्ट्रानिक'), any('इलेक्ट्रोनिक'), any('एलईडी'), any('एल.ई.डी'), any('अर्डुइनो'), any('आर्डुइनो'), any('अर्दुइनो'), any('आरडुइनो'), any('आर्दुइनो'),
  any('ब्रेडबोर्ड'), any('परिपथ'), any('रोबोटिक्स'), any('सेंसर'), any('संवेदक'), any('प्रतिरोधक'), any('विद्युत'), any('बिजली'), any('सर्किट'), any('माइक्रोकंट्रोलर'),
  // Bengali, Assamese
  any('ইলেকট্রনিক'), any('ইলেক্ট্রনিক'), any('ইলেকট্ৰনিক'), any('আরডুইনো'), any('আৰডুইনো'), any('এলইডি'), any('ব্রেডবোর্ড'), any('বর্তনী'), any('বৰ্তনী'), any('রোবোটিক্স'), any('ৰবটিক্স'),
  any('সেন্সর'), any('বিদ্যুৎ'), any('তড়িৎ'), any('রোধক'),
  // Tamil
  any('மின்னணு'), any('எலக்ட்ரானிக்ஸ்'), any('ஆர்டுயினோ'), any('ஆர்டுவினோ'), any('ஆர்டினோ'), any('எல்இடி'), any('எல்.இ.டி'), any('மின்சுற்று'), any('ரோபோட்டிக்ஸ்'), any('சென்சார்'), any('மின்தடை'), any('மின்சாரம்'),
  // Telugu
  any('ఎలక్ట్రానిక్'), any('ఆర్డునో'), any('ఆర్డుయినో'), any('ఎల్ఈడీ'), any('ఎల్ఇడి'), any('విద్యుత్'), any('రోబోటిక్స్'), any('సెన్సార్'), any('నిరోధకం'),
  // Kannada
  any('ಎಲೆಕ್ಟ್ರಾನಿಕ್'), any('ಆರ್ಡುನೋ'), any('ಆರ್ಡುಯಿನೊ'), any('ಎಲ್ಇಡಿ'), any('ವಿದ್ಯುತ್'), any('ರೋಬೋಟಿಕ್ಸ್'), any('ಸೆನ್ಸಾರ್'), any('ರೋಧಕ'),
  // Malayalam
  any('ഇലക്ട്രോണിക്'), any('ആർഡ്വിനോ'), any('ആർഡുയിനോ'), any('എൽഇഡി'), any('വൈദ്യുത'), any('സർക്യൂട്ട്'), any('റോബോട്ടിക്സ്'), any('സെൻസർ'),
  // Gujarati
  any('ઇલેક્ટ્રોનિક'), any('આર્ડુઇનો'), any('એલઇડી'), any('વિદ્યુત'), any('પરિપથ'), any('રોબોટિક્સ'), any('સેન્સર'), any('અવરોધક'),
  // Punjabi
  any('ਇਲੈਕਟ੍ਰਾਨਿਕ'), any('ਆਰਡੂਇਨੋ'), any('ਐਲਈਡੀ'), any('ਬਿਜਲੀ'), any('ਸਰਕਟ'), any('ਰੋਬੋਟਿਕਸ'), any('ਸੈਂਸਰ'),
  // Odia
  any('ଇଲେକ୍ଟ୍ରୋନିକ'), any('ଆର୍ଡୁଇନୋ'), any('ଏଲଇଡି'), any('ବିଦ୍ୟୁତ'), any('ପରିପଥ'), any('ରୋବୋଟିକ୍ସ'), any('ସେନ୍ସର'),
  // Urdu
  any('الیکٹرانک'), any('آرڈوینو'), any('ایل ای ڈی'), any('سرکٹ'), any('برقی'), any('بجلی'), any('روبوٹکس'), any('سینسر'),
  // Arabic
  any('إلكتروني'), any('الكتروني'), any('أردوينو'), any('اردوينو'), any('دائرة كهربائية'), any('الدوائر الكهربائية'), any('كهرباء'), any('كهربائي'), any('الروبوت'), any('مستشعر'), any('لوحة التجارب'), any('الصمام الثنائي الباعث للضوء'),
  // Spanish, Portuguese, French
  stem('electr[oó]nic'), stem('eletr[oô]nic'), stem('protoboard'), stem('rob[oó]tic'), stem('microcontrolador'), latin('(?:un|el|los|diodo|diodos|o|os) leds?'), stem('el[eé]ctric'),
  stem('[ée]lectronique'), stem('[ée]lectrique'), stem('robotique'), stem('microcontr[ôo]leur'), latin('capteurs?'), latin('plaques? d\'essai'), latin('platines? d\'essai'), latin('(?:une|la|les|des) leds?'),
  // Russian
  stem('электроник'), stem('электрическ'), stem('макетн'), stem('ардуино'), stem('светодиод'), stem('робототехник'), stem('микроконтроллер'), stem('датчик'), stem('резистор')
];
const WEAK = [
  ['circuit', stem('circuits?')], ['current', latin('currents?')], ['series', latin('series')], ['parallel', latin('parallel')], ['battery', stem('batter(?:y|ies)')],
  ['switch', latin('switch(?:es)?')], ['wire', latin('wires?')], ['bulb', latin('bulbs?')], ['prototype', stem('prototyp')], ['resistance', latin('resistance')], ['cell', latin('cells?')],
  ['motor', latin('motors?')], ['code', latin('coding')], ['robot', latin('robots?')],
  ['धारा', any('धारा')], ['श्रेणी', any('श्रेणी')], ['समांतर', any('समांतर|समानांतर|समान्तर|पार्श्व')], ['प्रतिरोध', any('प्रतिरोध')], ['बैटरी', any('बैटरी')],
  ['சுற்று', any('சுற்று')], ['వలయం', any('వలయం')], ['রোধ', any('রোধ')], ['ಮಂಡಲ', any('ಮಂಡಲ')], ['مزاحمت', any('مزاحمت')], ['مقاومة', any('مقاومة')], ['تيار', any('تيار')],
  ['circuito', stem('circuitos?')], ['corriente', latin('corriente')], ['corrente', latin('corrente')], ['resistencia', stem('resist[eê]ncia')], ['courant', latin('courant')], ['résistance', latin('r[ée]sistance')],
  ['цепь', stem('цеп[ьи]')], ['ток', latin('ток[аи]?')], ['сопротивлени', stem('сопротивлени')]
];
const NOT = /circuit[- ]training|circuit court|circuit judge|(?:racing|race|grand prix|f1|formula (?:one|1)|lecture|comedy|festival|tennis|tour) circuits?|electric (?:guitar|blue|eel)s?|current (?:affairs|events|account)|(?:ocean|sea|air|rip) currents?|cell (?:biology|membrane|division|wall)s?|prison cells?|resistance (?:movement|fighters?)|french resistance|antibiotic resistance|series of|tv series|parallel (?:lines?|universe)|sensory|dress codes?|colou?r codes? (?:in|for) (?:fashion|design|maps?)/g;
const strongRe = new RegExp(STRONG.join('|'), 'u');
const weakRe = WEAK.map(([k, w]) => [k, new RegExp(w, 'u')]);

export function match(text) {
  const s = String(text || '').normalize('NFC').toLowerCase().replace(NOT, ' ');
  if (strongRe.test(s)) return true;
  return weakRe.filter(([, re]) => re.test(s)).length >= 2;
}

export const prompt = String.raw`
Breadboard ("kind": "breadboard"): a bench where the learner builds real circuits, as in Tinkercad; the app simulates it live (LEDs glow by their current and burn out above about 30 mA; short circuits warn) and runs Arduino sketches. Use it for building and tinkering (LEDs, Arduino, class 6-10 activities, robotics, sensors); use "circuit" for diagrams and calculations.
"spec": {"battery": "9V" or "3V", "arduino": true, "motor": true, "bin": {...}, "parts": [...], "wires": [...], "code": "..."}, all optional.
- Holes "a1"-"j30" (row, column). In each column a-e are joined, and f-j (the centre gap parts them). Rails "+T", "-T", "+B", "-B" are each joined end to end ("+T12": a rail hole). Terminals: "BAT+", "BAT-", the motor's "M+", "M-", the Arduino's "D0"-"D13" (PWM on 3, 5, 6, 9, 10, 11), "A0"-"A5", "5V", "3V3", "GND".
- "bin", parts to place: {"led": ["red", "green"], "resistor": [220, 1000], "button": 1, "switch": 1, "pot": 1, "ldr": 1, "buzzer": 1}; "any" lets the learner pick ("resistor": ["any"]). Wires are unlimited.
- "parts", placed at the start: {"id": "L1", "type": "led", "color": "red", "at": [anode, cathode]}; "resistor" ("ohms"), "button", "ldr" ("light" 0-1) and "buzzer" [+, -] take 2 holes; "switch" [first, middle, last] ("on": middle joined to first) and "pot" [end, wiper, end] ("knob" 0-1) take 3 in a row. A part's legs go in different strips. An LED needs a resistor in series: about 470 ohms on 9 V, 220 on 5 V.
- "wires": [{"from": "BAT+", "to": "a3"}]; one leg or wire end per hole. "code": a starter sketch: setup, loop, pinMode, digitalWrite, digitalRead, analogRead, analogWrite, delay, millis, Serial.
Block example: {"t": "widget", "kind": "breadboard", "caption": "Press the button: the loop closes and the LED lights.", "spec": {"battery": "9V", "parts": [{"id": "BTN1", "type": "button", "at": ["e3", "f3"]}, {"id": "R1", "type": "resistor", "ohms": 470, "at": ["g3", "g7"]}, {"id": "L1", "type": "led", "color": "red", "at": ["h7", "h8"]}], "wires": [{"from": "BAT+", "to": "a3"}, {"from": "j8", "to": "BAT-"}]}}
Task goals, checked by simulating the learner's own build: {"type": "light", "count": 1} LEDs lit safely (or "color", "ohms" the resistor to use, "part": "buzzer" or "motor", "pin": 13 lit by code); "series" or "parallel" with "count": 2; "button" the LED lit only while pressed; "switch"; "dimmer" with "by": "pot" or "ldr" ("lit": "dark" a night light); "blink" with "pin", "on_ms", "off_ms"; "serial" with "text". Button, switch and dimmer take "pin" (2, or "A0") and "led_pin" (9) to work through code. The bin holds every part the goal needs; leave the building to the learner.
Task example: {"type": "task", "kind": "breadboard", "prompt": "Wire the LED to pin 13 and make it blink: 1 second on, 1 second off.", "spec": {"arduino": true, "bin": {"led": ["red"], "resistor": [220]}, "code": "void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n}\n"}, "goal": {"type": "blink", "pin": 13, "on_ms": 1000, "off_ms": 1000}, "hint": "In loop(): digitalWrite(13, HIGH); delay(1000); then LOW and delay again.", "explain": "Pin 13 switches between 5 V and 0 V; the resistor keeps the current safe."}`.trim();

const debug = () => Boolean(process.env.PRIMER_WIDGET_DEBUG);
const known = (err) => err instanceof core.BBError || err instanceof core.SketchError;
function note(what, err, data) {
  if (debug()) console.log(`[widgets] breadboard ${what} left out: ${err && err.message}${data ? ' ' + JSON.stringify(data).slice(0, 1500) : ''}`);
}

// A widget block's spec, checked; null leaves it out.
export function block(spec) {
  try { return core.normBlock(spec); } catch (err) {
    if (!known(err)) throw err;
    note('block', err, spec);
    return null;
  }
}

// A task's spec and goal, checked: a build from the bench's own parts meets the goal (proved), and the start doesn't.
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
    if (goal === undefined) core.normBlock(spec); else core.normTask(spec, goal);
    return '';
  } catch (err) {
    return String((err && err.message) || err).replace(/\s+/g, ' ').slice(0, 300);
  }
}
