// =====================================================================
// Music (server/widgets.mjs): a piano and a drum kit, with a tabla pair,
// for lessons on notes, chords, scales, melody, sargam and ragas, beats,
// rhythm and taals. A block shows the keyboard or the pads (with a demo
// melody, or a step pattern with a moving playhead, to play along with);
// a task asks the learner to play some notes (a chord, a scale, a
// melody), to fill in a step grid, or to tap in time with a click.
//
// The checks themselves are in assets/js/widgets/music-core.js, shared
// with the browser (assets/js/widgets/music.js), so a spec is held to the
// same rules wherever it comes from: note names and ranges, lengths and
// tempo, known drum sounds, 4 to 32 steps, goals that can be played on the
// instrument shown, and limits on every list.
// =====================================================================
import core from '../../assets/js/widgets/music-core.js';

export const label = 'a piano or drums to play';

/* ---------------- which lessons are offered it ---------------- */
// One strong word is enough; weak ones ("notes", "scale", "beat") need a second music word, since
// they are everyday words too (lecture notes, the pH scale, beat the odds, social harmony).
const L = '\\p{L}\\p{M}\\p{N}';
const whole = (alts) => new RegExp(`(?<![${L}])(?:${alts.join('|')})(?![${L}])`, 'u');
const front = (alts) => new RegExp(`(?<![${L}])(?:${alts.join('|')})`, 'u'); // a stem, or a word that takes endings
const inside = (alts) => new RegExp(`(?:${alts.join('|')})`, 'u');           // scripts written without spaces

const X = '[\\p{L}\\p{M}]*'; // the rest of a word: its letters and, in Indic scripts, its vowel signs
const STRONG = [
  whole([
    // English, and music words borrowed into other languages
    'pianos?', 'pianists?', 'pianoforte', 'music', 'musical', 'musicians?', 'musicology', 'melod(?:y|ies|ic)',
    'drums?', 'drummers?', 'drumming', 'drum ?kits?', 'percussion', 'percussionists?', 'rhythms?', 'rhythmic',
    'chord progressions?', 'arpeggios?', 'metronomes?', 'octaves?', 'semitones?', 'solf[eè]ge', 'sheet music', 'time signatures?',
    'key signatures?', '(?:major|minor|chromatic|pentatonic|blues) scales?', 'pentatonic', 'clefs?', 'treble clef', 'bass clef',
    'keyboard instruments?', 'piano keyboard', 'musical keyboard', 'electronic keyboard', 'synthesi[sz]ers?',
    'guitars?', 'ukuleles?', 'violins?', 'flutes?', 'songwriting', 'composing music', 'music composition',
    // Indian music, as it is written in English
    'tabla', 'harmonium', 'sargam', 'r(?:aa|ā)g(?:a|am|as)?', 'ragas', 'ragam', 'taa?lam', 'taala', '(?:teen|tin|jhap|ek|chau|roopak|rupak|deepchandi)?taal', 'teental', 'tintal', 'jhaptal', 'keherwa', 'kaharwa', 'thaats?', 'swara?s?',
    'carnatic', 'hindustani (?:music|classical|sangeet)', 'sangeet', 'mridangam', 'sitar', 'veena', 'bansuri', 'dholak?',
    'alankaar?s?', 'aa?roh(?:a|an)?', 'ava?roh(?:a|an)?', 'saptak',
    // Spanish, Portuguese, French
    'música', 'musica', 'musicales?', 'melodía', 'melodia', 'tambor(?:es)?', 'percusión', 'percussão', 'solfeo', 'solfejo', 'partitura',
    'escalas? musica(?:l|is|les)', 'notas musica(?:is|les)', 'musique', 'musicale?s?', 'musicaux', 'mélodies?', 'tambours?',
    // other course languages
    'musik', 'muzik', 'muziek', 'muzyk' + X, 'muzyc' + X, 'muziki', 'müzik', 'klavier', 'schlagzeug', 'akkorde?', 'piyano', 'davul',
    'pianino', 'fortepian', 'perkusja', 'nhạc', 'μουσικ' + X, 'πιάνο',
    'мелоди' + X, 'музык' + X, 'музик' + X, 'фортепиано', 'фортепіано', 'пианино', 'рояль', 'аккорд' + X, 'акорд' + X,
    'барабан' + X, 'сольфеджио', 'синтезатор' + X, 'нотн' + X, 'מוזיקה', 'פסנתר', 'תופים',
    // Hindi, Marathi, Nepali and the other Devanagari languages
    'संगीत' + X, 'सरगम', 'पियानो', 'ड्रम' + X, 'तबल' + X, 'हारमोनियम', 'सप्तक', 'थाट', 'ताल', 'तालों', 'स्वरलिपि', 'वाद्य' + X, 'रिदम', 'मेलोडी', 'कॉर्ड',
    // Bengali and Assamese, Gujarati, Punjabi, Odia
    'সংগীত' + X, 'সঙ্গীত' + X, 'তবলা', 'পিয়ানো', 'ড্রাম', 'সরগম', 'হারমোনিয়াম',
    'સંગીત' + X, 'તબલા', 'પિયાનો', 'હાર્મોનિયમ', 'ਸੰਗੀਤ' + X, 'ਤਬਲਾ', 'ਪਿਆਨੋ', 'ਢੋਲ', 'ਰਾਗ', 'ସଙ୍ଗୀତ' + X, 'ସଂଗୀତ' + X, 'ପିଆନୋ', 'ତବଲା',
    // Urdu, Persian, Arabic
    'موسیقی', 'طبلہ', 'طبلے', 'پیانو', 'ہارمونیم', 'ڈرم', 'راگ', '(?:ال|وال|بال|لل)?موسيق' + X, 'بيانو', 'طبول'
  ]),
  // Tamil, Telugu, Kannada, Malayalam, Sinhala: words take their endings joined on
  front(['இசை', 'தாளம்', 'தாளங்', 'ராகம்', 'ராகங்', 'ஸ்வர', 'பியானோ', 'மிருதங்க', 'தபேலா', 'సంగీత', 'రాగం', 'రాగాల', 'పియానో', 'తబలా',
    'ಸಂಗೀತ', 'ರಾಗ', 'ಪಿಯಾನೋ', 'ತಬಲಾ', 'സംഗീത', 'താളം', 'രാഗം', 'രാഗങ്ങ', 'പിയാനോ', 'തബല', 'സ്വര', 'සංගීත']),
  // Chinese, Japanese, Korean, Thai
  inside(['音乐', '音樂', '钢琴', '鋼琴', '节奏', '節奏', '和弦', '音阶', '音階', '乐理', '架子鼓', '打击乐', '音楽', 'ピアノ', 'ドラム', 'リズム', '和音',
    '음악', '피아노', '드럼', '리듬', '화음', '음계', 'ดนตรี', 'เปียโน', 'กลอง', 'จังหวะดนตรี'])
];
// each of these counts once, however often it appears
const WEAK = [
  'keyboards?', 'notes?', 'scales?', 'chords?', 'beats?', 'harmon(?:y|ies|ise|ize)', 'tempo', 'songs?', 'singing', 'tunes?', 'pitch',
  'ritmos?', 'rythmes?', 'rhythmus', 'ritim', 'ritme', 'rytm', 'irama', 'ρυθμός', 'tala',
  'acordes?', 'armonía', 'harmonia', 'batería', 'bateria', 'compás', 'accords?', 'harmonie', 'batterie', 'gammes?', 'notas',
  'ритм' + X, 'гармони' + X, 'гамм' + X, 'нот[аыу]?', 'темп(?:а|е|ом|ы)?', 'такт(?:а|е|ы|ов)?', 'ударн' + X,
  'राग', 'लय', 'धुन', 'सुर', 'स्वर', 'गीत', 'गायन', 'তাল', 'রাগ', 'সুর', 'গান', 'તાલ', 'રાગ', 'ਤਾਲ', 'ତାଳ', 'ରାଗ',
  'تال', 'سُر', 'دھن', 'لحن', 'إيقاع', 'مقام', 'نوتة'
].map((w) => whole([w])).concat(['சுர', 'பாட', 'తాళ', 'స్వర', 'ತಾಳ', 'ಸ್ವರ'].map((w) => front([w])));
// everyday phrases that look like music: taken out before looking
const NOT_MUSIC = new RegExp([
  '(?:circadian|heart|cardiac|sinus|biological|body|daily|breathing|respiratory|sleep|alpha|brain)[\\s-]+rhythms?',
  'rhythms? of (?:the )?(?:heart|day|life|sleep)', 'heart ?beats?', 'beats per minute', 'drum[\\s-]+brakes?', 'oil[\\s-]+drums?', 'ear[\\s-]?drums?',
  'chords? (?:of|in) (?:a|the) circle', 'chords? and tangents?', 'chord length',
  "(?:newlands'?s? )?law of octaves", 'carnatic wars?', 'percussion and auscultation', 'chest percussion',
  '(?:richter|ph|map|mohs|likert|decibel|kelvin|celsius|fahrenheit|temperature|time|pay|salary|grading|rating|large|small|full|industrial) scales?',
  'scale (?:drawings?|factors?|models?|of (?:a|the) map|of \\d)', 'economies of scale', 'to scale', 'scale up', 'fish scales?',
  '(?:lecture|study|revision|class|bank|sticky|short|case|field|clinical|release|speaker|exam|course) notes?', 'notes? taking', 'taking notes?', 'notes? on',
  '(?:sales|elevator|cricket|football|soccer|hockey|rugby) pitch(?:es)?', 'pitch (?:deck|of (?:a|the) (?:screw|roof|thread))',
  '(?:computer|typing|qwerty|on-?screen) keyboards?', 'keyboard (?:shortcuts?|typing|skills)',
  '(?:communal|social|racial|religious|national|marital|ecological) harmony', 'harmony (?:with|in) nature',
  'ritmos? (?:card[ií]aco|circadiano|de vida|biol[oó]gico|respirat[oó]rio|de crecimiento|de crescimento|económico|econômico)',
  'rythmes? (?:cardiaques?|circadiens?|biologiques?|de vie|scolaires?)', 'ритм' + X + '\\s+(?:сердц|жизн)' + X, '(?:сердечн|циркадн)' + X + '\\s+ритм' + X,
  'tempo (?:verbal|livre|real)', 'tempos? verba' + X, '(?:batería|bateria|batterie) (?:de|du|au|lithium|litio|lítio)', 'tala de árboles',
  'harmonic (?:motion|oscillat' + X + '|series|mean|function)', 'simple harmonic', 'तालाब', 'ताला'
].join('|'), 'giu');

export function match(text) {
  if (typeof text !== 'string' || !text) return false;
  const s = text.toLowerCase().replace(NOT_MUSIC, ' ');
  if (STRONG.some((re) => re.test(s))) return true;
  return WEAK.filter((re) => re.test(s)).length >= 2;
}

/* ---------------- what the AI is told ---------------- */
export const prompt = String.raw`
Kind "music": a playable piano, or drum pads with a step grid; the learner can always play them freely.
Notes are letter names with an octave: "C4" is middle C, "F#3", "Bb4" (spelled as the key needs: Bb in F major), even when the keys show sargam. Lengths are in beats.
- Piano block spec: {"instrument": "piano", "from": "C4", "to": "C5", "labels": "letters", "highlight": ["C4", "E4", "G4"], "demo": {"tempo": 80, "steps": [{"notes": ["C4"], "beats": 1}, {"notes": ["E4"], "beats": 1}, {"notes": ["G4"], "beats": 1}, {"notes": ["C4", "E4", "G4"], "beats": 2}]}}
  "from"/"to": the keys shown, one or two octaves. "labels": "letters", "sargam" (Sa Re Ga, for Indian music, with "sa": the key that is Sa, e.g. "C4") or "none". "highlight": marked keys ("C" marks every C). "demo" (optional) plays with a Play button, lighting each key as it sounds: several notes in a step make a chord, "notes": [] is a rest; at most 64 steps.
- Drums block spec: {"instrument": "drums", "pads": ["kick", "snare", "hihat"], "pattern": {"tempo": 90, "steps": 8, "per_beat": 2, "tracks": {"kick": "x...x...", "snare": "..x...x.", "hihat": "xxxxxxxx"}}}
  Sounds: kick, snare, hihat, openhat, clap, tom_low, tom_high, and the tabla bols na, tin, te, ge, ke, dha, dhin. "pattern" (optional) plays on a grid with a moving playhead: 4 to 32 "steps", "per_beat" steps a beat (2 = eighths, 4 = sixteenths, 1 for a taal's matras). Each track is exactly "steps" characters, "x" a hit, "." a rest, in counting order: with "per_beat": 2 they are 1 & 2 & 3 & 4 &, so beat 2 is the 3rd character and beat 4 the 7th ("..x...x." is a snare on 2 and 4). For a taal add "groups" (the vibhags, e.g. [4, 4, 4, 4]) and "marks" (e.g. ["X", "2", "0", "3"]).
- Piano task goal: {"type": "notes", "notes": ["C4", "E4", "G4"], "in_order": false, "any_octave": true}: the learner taps keys; "in_order" false for a chord (keys chosen in any order), true for a melody or scale (that exact sequence); "any_octave" true when any C will do. Every note must be on the spec's keyboard; don't highlight the answer.
  Example: {"type": "task", "kind": "music", "prompt": "Choose the keys of the C major chord.", "spec": {"instrument": "piano", "from": "C4", "to": "C5", "labels": "letters"}, "goal": {"type": "notes", "notes": ["C4", "E4", "G4"], "in_order": false, "any_octave": true}, "hint": "Start on C and skip every other white key.", "explain": "A major chord is the root, a major third and a fifth: C, E, G."}
- Drums task goal: {"type": "pattern", "tracks": {"kick": "x...x...", "snare": "..x...x."}}: the learner clicks the grid's cells to fill in those rows, which start empty; the spec pattern's other tracks are given (give it "steps", "per_beat" and "tempo").
  Example: {"type": "task", "kind": "music", "prompt": "Add the kick on beats 1 and 3 and the snare on beats 2 and 4.", "spec": {"instrument": "drums", "pads": ["kick", "snare", "hihat"], "pattern": {"tempo": 90, "steps": 8, "per_beat": 2, "tracks": {"hihat": "xxxxxxxx"}}}, "goal": {"type": "pattern", "tracks": {"kick": "x...x...", "snare": "..x...x."}}, "hint": "Each beat is two steps: beat 2 starts at step 3.", "explain": "That is the basic rock beat."}
- To keep a steady beat, a tap task: goal {"type": "tap", "tempo": 80, "beats": 8}, spec {"instrument": "drums", "pads": ["clap"]}: the learner taps a pad along with a click they can also see.
Use the piano for notes, intervals, chords, scales, melodies, sargam and ragas; the drums for beat, tempo, rhythm and taals. Keep demos and patterns short (4 to 16 steps).
A task tests what its section taught: its prompt names what to play and the learner works out the keys or steps ("Choose the keys of the D major chord", "Play the G major scale up from G4"). Never put the answer's keys in the prompt or hint, and never ask for something known only by ear: some learners can't hear, and the keys, grid and lights must be enough.`;

/* ---------------- the checks ---------------- */
export const block = (spec) => core.block(spec);
export const task = (spec, goal) => core.task(spec, goal);

// Why a spec (and goal) would be left out ('' when it is fine): the commonest slips, named so the AI can
// fix them. The core only says yes or no, so this tries the spec without each optional piece.
export function why(spec, goal) {
  if (goal === undefined ? core.block(spec) : core.task(spec, goal)) return '';
  if (!spec || typeof spec !== 'object') return 'the spec must be an object with "instrument": "piano" or "drums"';
  const without = (k) => { const s = { ...spec }; delete s[k]; return s; };
  const notes = (list) => (Array.isArray(list) ? list : [list]).filter((n) => typeof n === 'string' && !core.parseNote(n));
  const drums = String(spec.instrument || '').toLowerCase() === 'drums' || spec.pads != null || spec.pattern != null;
  const shown = core.block(spec, { keepEmpty: true });
  if (!shown) {
    if (spec.demo != null && core.block(without('demo'))) {
      const steps = spec.demo && Array.isArray(spec.demo.steps) ? spec.demo.steps : [];
      if (!steps.length || steps.length > 64) return `the demo needs 1 to 64 steps; it has ${steps.length}`;
      const odd = steps.flatMap((st) => notes(st && st.notes)).slice(0, 3);
      if (odd.length) return `the demo has notes that can't be read: ${odd.join(', ')} (write them like "C4", "F#3", "Bb4")`;
      return 'the demo can\'t be played: each step is {"notes": [...], "beats": n} with 0.25 to 8 beats, and all its notes fit within two octaves of the keyboard';
    }
    if (spec.highlight != null && core.block(without('highlight'))) return `a highlighted note can't be read: ${notes(spec.highlight).join(', ') || spec.highlight} (write "C4", or "C" for every C)`;
    if (drums) {
      const p = spec.pattern;
      const steps = p && Number(p.steps);
      const off = p && p.tracks && typeof p.tracks === 'object' ? Object.entries(p.tracks).find(([, t]) => typeof t !== 'string' || t.length !== steps) : null;
      if (off) return `the "${off[0]}" track has ${typeof off[1] === 'string' ? off[1].length : 0} characters but "steps" is ${steps}; every track is exactly "steps" characters of x and .`;
      return `the drums need "pads" from: ${Array.isArray(core.DRUMS) ? core.DRUMS.join(', ') : 'kick, snare, hihat, openhat, clap, tom_low, tom_high'} (or tabla bols), and a pattern of 4 to 32 steps`;
    }
    return 'the keyboard can\'t be drawn: "from" and "to" are notes like "C4", at most two octaves apart';
  }
  if (goal === undefined) return 'it breaks one of the rules for "music" given above';
  if (!goal || typeof goal !== 'object') return '"goal" must be an object';
  const odd = notes(goal.notes || []);
  if (odd.length) return `the goal has notes that can't be read: ${odd.join(', ')} (write them like "E4")`;
  if (Array.isArray(goal.notes) && shown.from) {
    const lo = core.toMidi(shown.from), hi = core.toMidi(shown.to);
    const out = goal.notes.filter((n) => { const m = core.toMidi(n); return m != null && (m < lo || m > hi); });
    if (out.length && !goal.any_octave) return `the goal's notes ${out.join(', ')} aren't on the keyboard, which runs from ${shown.from} to ${shown.to}`;
  }
  if (goal.tracks && typeof goal.tracks === 'object' && spec.pattern) {
    const steps = Number(spec.pattern.steps);
    const off = Object.entries(goal.tracks).find(([, t]) => typeof t !== 'string' || t.length !== steps);
    if (off) return `the goal's "${off[0]}" track must be exactly ${steps} characters (the spec's "steps")`;
  }
  return 'the goal can\'t be done on this instrument: a piano takes {"type": "notes"}, drums take {"type": "pattern"} or {"type": "tap"}';
}
