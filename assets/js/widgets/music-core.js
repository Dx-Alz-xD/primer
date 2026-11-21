/* =====================================================================
   Music for interactive lessons: the theory and the checks behind the
   piano and drums (assets/js/widgets/music.js), shared by the server
   (server/widgets/music.mjs imports it, like packfmt.js) and the browser
   (music.js loads it first), so a spec is checked by the same code
   when the AI writes it, when a course file is imported, and when a
   lesson draws it.

   Notes are a letter, an accidental and an octave: "C4" is middle C
   (MIDI 60), "F#3", "Bb4"; the spelling a lesson uses is kept (F major
   has Bb, not A#). Lengths are in beats (1 = one beat at the tempo).

     parseNote("Db4")         -> { letter, acc, octave, pc, midi, name }
     noteName(61, flats?)     -> "C#4"        toMidi("C#4") -> 61
     sargam(62, 60)           -> { name: "Re", komal, tivra, octave }
     parseChord("Am7")        -> { root, quality, intervals, symbol }
     chordNotes("C", 4)       -> [60, 64, 67]
     scaleNotes(62, "major")  -> D major, D4 up to D5
     parseBeats("dotted quarter") -> 1.5
     soundName("hi-hat")      -> "hihat"    (drum sounds and tabla bols)
     parseTrack("x...x...", 8) -> "x...x..."

     block(spec)        -> a clean piano or drums spec, or null
     task(spec, goal)   -> { spec, goal } clean, or null
     checkNotes(goal, played), checkPattern(goal, tracks), checkTaps(goal, taps)

   Spec shapes (the AI is told them in server/widgets/music.mjs):
     piano: { instrument: "piano", from: "C4", to: "C5",
              labels: "letters" | "sargam" | "none", sa: "C4",
              highlight: ["C4", "E4", "G4"],       // "C" marks every C
              demo: { tempo: 90, steps: [{ notes: ["C4"], beats: 1 }, ...] } }
     drums: { instrument: "drums", pads: ["kick", "snare", "hihat"],
              pattern: { tempo: 100, steps: 16, per_beat: 4,
                         tracks: { kick: "x.......x.......", ... },
                         groups: [4, 4, 4, 4], marks: ["X", "2", "0", "3"] } }
   Goal shapes:
     { type: "notes", notes: ["C4", "E4", "G4"], in_order: false, any_octave: true }
     { type: "pattern", tracks: { kick: "x...x...", snare: "..x...x." } }
     { type: "tap", tempo: 80, beats: 8, per_beat: 1, rhythm?: "x.x.xxx.",
       tolerance_ms: 150, count_in: 4, sound: "clap" }
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerMusic = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const mod12 = (m) => ((m % 12) + 12) % 12;

  /* ---------------- notes ---------------- */
  const LOW = 21, HIGH = 108;          // A0 to C8, a full piano
  const MAX_SPAN = 48;                 // a keyboard shows at most four octaves
  const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ACC = { '': 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2 };
  const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  const NOTE_RE = /^([A-Ga-g])(##|#|x|bb|b)?(\d)?$/;

  // "C4", "c#4", "Db3", "F♯5", "B flat 4", "Bb" (no octave), or a MIDI number
  function parseNote(v) {
    if (typeof v === 'number') {
      if (!Number.isInteger(v) || v < LOW || v > HIGH) return null;
      return parseNote(noteName(v));
    }
    if (typeof v !== 'string' || v.length > 16) return null;
    const s = v.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/♮/g, '')
      .replace(/[\s-]*sharp/gi, '#').replace(/[\s-]*flat/gi, 'b').replace(/\s+/g, '');
    const m = NOTE_RE.exec(s);
    if (!m) return null;
    const letter = m[1].toUpperCase(), accStr = m[2] === 'x' ? '##' : (m[2] || ''), acc = ACC[accStr];
    const pc = mod12(LETTERS[letter] + acc);
    if (m[3] == null) return { letter, accStr, acc, octave: null, pc, midi: null, name: letter + accStr };
    const octave = Number(m[3]);
    const midi = 12 * (octave + 1) + LETTERS[letter] + acc;
    if (midi < LOW || midi > HIGH) return null;
    return { letter, accStr, acc, octave, pc, midi, name: letter + accStr + octave };
  }
  const toMidi = (v) => { const p = parseNote(v); return p && p.midi != null ? p.midi : null; };
  const noteName = (m, flats) => (flats ? FLATS : SHARPS)[mod12(m)] + (Math.floor(m / 12) - 1);
  const pcName = (m, flats) => (flats ? FLATS : SHARPS)[mod12(m)];
  const isBlack = (m) => BLACK[mod12(m)];
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // the same spelling (letter and accidental) at another pitch: "B#" at MIDI 60 is "B#3"
  const spell = (p, m) => p.letter + p.accStr + (Math.round((m - LETTERS[p.letter] - p.acc) / 12) - 1);
  // "C#4" -> "C♯4", for showing; strip the octave with octave: false
  function pretty(name, octave = true) {
    const m = /^([A-G])(##|#|bb|b)?(\d)?$/.exec(String(name || ''));
    if (!m) return String(name || '');
    const acc = { '#': '♯', '##': '𝄪', b: '♭', bb: '𝄫' }[m[2]] || '';
    return m[1] + acc + (octave && m[3] != null ? m[3] : '');
  }
  // the pitch class nearest to a MIDI number
  function nearest(pc, near) {
    let m = near - mod12(near - pc);
    if (near - m > 6) m += 12;
    return m;
  }

  /* ---------------- sargam ---------------- */
  // the twelve swaras from Sa: 1 = komal, 2 = tivra
  const SWARAS = [['Sa', 0], ['Re', 1], ['Re', 0], ['Ga', 1], ['Ga', 0], ['Ma', 0], ['Ma', 2], ['Pa', 0], ['Dha', 1], ['Dha', 0], ['Ni', 1], ['Ni', 0]];
  function sargam(m, sa = 60) {
    const d = m - sa, [name, k] = SWARAS[mod12(d)];
    return { name, komal: k === 1, tivra: k === 2, octave: Math.floor(d / 12) }; // octave: -1 mandra, 0 madhya, 1 taar
  }
  // in words: "Sa", "komal Re", "tivra Ma", ".Ni" (lower octave), "Sa'" (upper octave)
  function sargamText(m, sa = 60) {
    const s = sargam(m, sa);
    const dots = s.octave < 0 ? '.'.repeat(Math.min(2, -s.octave)) : '';
    const ticks = s.octave > 0 ? "'".repeat(Math.min(2, s.octave)) : '';
    return (s.komal ? 'komal ' : s.tivra ? 'tivra ' : '') + dots + s.name + ticks;
  }

  /* ---------------- chords ---------------- */
  const CHORDS = {
    maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], 5: [0, 7],
    6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], mmaj7: [0, 3, 7, 11],
    dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug7: [0, 4, 8, 10], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
    9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14]
  };
  const SUFFIX = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4', 5: '5', 6: '6', m6: 'm6', 7: '7', maj7: 'maj7', m7: 'm7', mmaj7: 'm(maj7)', dim7: 'dim7', m7b5: 'm7b5', aug7: 'aug7', add9: 'add9', madd9: 'm(add9)', 9: '9', maj9: 'maj9', m9: 'm9' };
  // what follows the root, as written; then without spaces; then in lower case
  const QUALITY = {
    '': 'maj', M: 'maj', maj: 'maj', major: 'maj', m: 'min', min: 'min', minor: 'min', '-': 'min',
    dim: 'dim', diminished: 'dim', '°': 'dim', o: 'dim', aug: 'aug', augmented: 'aug', '+': 'aug',
    sus: 'sus4', sus4: 'sus4', suspended4: 'sus4', sus2: 'sus2', suspended2: 'sus2', 5: '5', power: '5', powerchord: '5',
    6: '6', major6: '6', m6: 'm6', min6: 'm6', minor6: 'm6', 7: '7', dom7: '7', dominant7: '7', dominantseventh: '7', seventh: '7', dominant: '7',
    maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', major7: 'maj7', majorseventh: 'maj7',
    m7: 'm7', min7: 'm7', '-7': 'm7', minor7: 'm7', minorseventh: 'm7', mmaj7: 'mmaj7', mM7: 'mmaj7', 'm(maj7)': 'mmaj7', minormajor7: 'mmaj7',
    dim7: 'dim7', '°7': 'dim7', o7: 'dim7', diminished7: 'dim7', diminishedseventh: 'dim7',
    m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', halfdiminished: 'm7b5', halfdiminished7: 'm7b5',
    aug7: 'aug7', '+7': 'aug7', augmented7: 'aug7', add9: 'add9', madd9: 'madd9', 'm(add9)': 'madd9',
    9: '9', dominant9: '9', maj9: 'maj9', major9: 'maj9', m9: 'm9', min9: 'm9', minor9: 'm9'
  };
  function quality(rest) {
    const a = rest.trim(), b = a.replace(/\s+/g, ''), c = b.toLowerCase().replace(/[-_]/g, '').replace(/(\d)(st|nd|rd|th)$/, '$1').replace(/chord$/, '');
    for (const k of [a, b, c, c.replace(/triad$/, '')]) if (Object.prototype.hasOwnProperty.call(QUALITY, k)) return QUALITY[k];
    return null;
  }
  // "C", "F#m", "Bb7", "Gsus4", "C/E", "A minor", "D major seventh"
  function parseChord(sym) {
    if (typeof sym !== 'string' || sym.length > 40) return null;
    const s = sym.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/[\s-]*sharp/i, '#').replace(/[\s-]+flat/i, 'b');
    const m = /^([A-Ga-g])(#|b)?(.*?)(?:\/([A-Ga-g][#b]?))?$/.exec(s);
    if (!m) return null;
    const q = quality(m[3] || '');
    if (!q) return null;
    const root = parseNote(m[1] + (m[2] || ''));
    const bass = m[4] ? parseNote(m[4]) : null;
    if (!root || (m[4] && !bass)) return null;
    return { root: root.pc, rootName: root.name, quality: q, intervals: CHORDS[q].slice(), bass: bass ? bass.pc : null, symbol: root.name + SUFFIX[q] + (bass ? '/' + bass.name : '') };
  }
  // A chord's or a scale's notes spelled by their degrees: G minor is G Bb D, D major has F# and C#.
  const ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  function spellLetter(li, m) {
    const L = ORDER[((li % 7) + 7) % 7], base = LETTERS[L];
    let acc = mod12(m - base);
    if (acc > 6) acc -= 12;
    if (Math.abs(acc) > 2) return null;
    return L + ({ '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' })[acc] + (Math.round((m - base - acc) / 12) - 1);
  }
  const DEGREE = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6, 13: 1, 14: 1 };
  function spellChord(c, ms) {
    const li = ORDER.indexOf(c.rootName[0]);
    const root = ms.find((m) => mod12(m) === c.root);
    return ms.map((m) => {
      if (c.bass != null && m < root) return spellLetter(ORDER.indexOf(c.symbol.split('/')[1][0]), m) || noteName(m, /b/.test(c.symbol));
      const iv = m - root, deg = c.quality === 'dim7' && iv === 9 ? 6 : DEGREE[iv];
      return (deg != null && spellLetter(li + deg, m)) || noteName(m, /b/.test(c.rootName));
    });
  }
  function spellScale(tonic, key, ms) {
    const seven = SCALES[key].length === 7, li = ORDER.indexOf(tonic.letter);
    // the others (pentatonic, blues, chromatic): flats from a flat tonic, and for the minor-sounding ones on C, D, F and G
    const flats = tonic.acc < 0 || (tonic.acc === 0 && (/minor|blues/.test(key) ? [0, 2, 5, 7].includes(tonic.pc) : tonic.pc === 5));
    return ms.map((m) => {
      const d = mod12(m - ms[0]), i = SCALES[key].indexOf(d);
      return (seven && i >= 0 && spellLetter(li + i, m)) || noteName(m, flats);
    });
  }

  // its notes, the root in the given octave (or nearest a MIDI number, { near: 60 }, or at or above one, { from: 60 })
  function chordNotes(sym, where = 4) {
    const c = typeof sym === 'string' ? parseChord(sym) : sym;
    if (!c) return null;
    const r = !isObj(where) ? 12 * (where + 1) + c.root : where.from != null ? where.from + mod12(c.root - where.from) : nearest(c.root, where.near);
    const out = c.intervals.map((i) => r + i);
    if (c.bass != null && c.bass !== c.root) out.unshift(r - mod12(r - c.bass) - (mod12(r - c.bass) === 0 ? 12 : 0));
    return out.every((m) => m >= LOW && m <= HIGH) ? out : null;
  }

  /* ---------------- scales and the ten thaats ---------------- */
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], 'natural minor': [0, 2, 3, 5, 7, 8, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
    'melodic minor': [0, 2, 3, 5, 7, 9, 11], 'major pentatonic': [0, 2, 4, 7, 9], 'minor pentatonic': [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'whole tone': [0, 2, 4, 6, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
    bilawal: [0, 2, 4, 5, 7, 9, 11], khamaj: [0, 2, 4, 5, 7, 9, 10], kafi: [0, 2, 3, 5, 7, 9, 10], asavari: [0, 2, 3, 5, 7, 8, 10],
    bhairavi: [0, 1, 3, 5, 7, 8, 10], bhairav: [0, 1, 4, 5, 7, 8, 11], kalyan: [0, 2, 4, 6, 7, 9, 11],
    marwa: [0, 1, 4, 6, 7, 9, 11], purvi: [0, 1, 4, 6, 7, 8, 11], todi: [0, 1, 3, 6, 7, 8, 11]
  };
  const SCALE_ALIAS = {
    ionian: 'major', minor: 'natural minor', aeolian: 'natural minor', 'harmonic': 'harmonic minor', 'melodic': 'melodic minor',
    pentatonic: 'major pentatonic', 'pentatonic major': 'major pentatonic', 'pentatonic minor': 'minor pentatonic',
    yaman: 'kalyan', bilaval: 'bilawal', 'major scale': 'major', 'minor scale': 'natural minor', bhairavi: 'bhairavi', asavari: 'asavari'
  };
  function scaleKey(name) {
    const k = String(name || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+(scale|thaat|that|mode|raga|raag)$/, '').replace(/\s+/g, ' ').trim();
    return SCALES[k] ? k : SCALE_ALIAS[k] || null;
  }
  // "D major", "A harmonic minor", "C4 kalyan", { tonic: "D4", name: "major" }
  function parseScale(v) {
    let tonic, name;
    if (isObj(v)) { tonic = v.tonic || v.root || v.key; name = v.name || v.scale || v.type || v.mode || 'major'; }
    else if (typeof v === 'string' && v.length <= 60) {
      const m = /^\s*([A-Ga-g](?:#|b(?![a-z])|♯|♭)?\d?)\s*(.*)$/.exec(v);
      if (!m) return null;
      tonic = m[1]; name = m[2] || 'major';
    } else return null;
    const t = parseNote(tonic), key = scaleKey(name);
    return t && key ? { tonic: t, name: key, steps: SCALES[key].slice() } : null;
  }
  // up from the tonic to the tonic an octave higher (down again with descending)
  function scaleNotes(tonic, name, opts = {}) {
    const key = scaleKey(name);
    if (!key || !Number.isInteger(tonic)) return null;
    const up = SCALES[key].map((i) => tonic + i).concat([tonic + 12]);
    const out = opts.descending ? up.slice().reverse() : opts.both ? up.concat(up.slice(0, -1).reverse()) : up;
    return out.every((m) => m >= LOW && m <= HIGH) ? out : null;
  }

  /* ---------------- lengths ---------------- */
  const LENGTHS = {
    whole: 4, w: 4, semibreve: 4, half: 2, h: 2, minim: 2, quarter: 1, q: 1, crotchet: 1, beat: 1,
    eighth: 0.5, e: 0.5, quaver: 0.5, sixteenth: 0.25, s: 0.25, semiquaver: 0.25, thirtysecond: 0.125, demisemiquaver: 0.125
  };
  const MIN_BEATS = 0.125, MAX_BEATS = 8;
  // a length in beats: 1, 0.5, "1/2" (half a beat), "quarter", "dotted half", "q.", "eighth triplet"
  function parseBeats(v) {
    let b = NaN;
    if (typeof v === 'number') b = v;
    else if (typeof v === 'string' && v.length <= 40) {
      let s = v.trim().toLowerCase().replace(/[\s-]*notes?$/, '').replace(/[\s-]*beats?$/, '').trim();
      let k = 1;
      if (/^dotted[\s-]+/.test(s)) { k = 1.5; s = s.replace(/^dotted[\s-]+/, ''); }
      if (/\.$/.test(s) && !/^\d*\.\d*$/.test(s)) { k = 1.5; s = s.slice(0, -1); }
      if (/[\s-]*triplets?$/.test(s)) { k = 2 / 3; s = s.replace(/[\s-]*triplets?$/, ''); }
      s = s.replace(/[\s-]+/g, '').replace(/^thirty-?second$/, 'thirtysecond').replace(/^1\/(\d+)th$/, '1/$1');
      const f = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
      if (LENGTHS[s] != null) b = LENGTHS[s] * k;
      else if (f && Number(f[2]) > 0) b = (Number(f[1]) / Number(f[2])) * k;
      else if (/^\d+(\.\d+)?$|^\.\d+$/.test(s)) b = Number(s) * k;
    }
    if (!Number.isFinite(b) || b < MIN_BEATS - 1e-9 || b > MAX_BEATS + 1e-9) return null;
    return Math.round(b * 10000) / 10000;
  }
  const tempoOf = (v, def, lo = 40, hi = 200) => { const n = num(v); return Number.isFinite(n) && n > 0 ? Math.round(clamp(n, lo, hi)) : def; };

  /* ---------------- drum sounds ---------------- */
  const DRUMS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom_low', 'tom_high'];
  const BOLS = ['na', 'tin', 'te', 'ge', 'ke', 'dha', 'dhin']; // tabla: dayan (na tin te), bayan (ge ke), both (dha dhin)
  const SOUNDS = DRUMS.concat(BOLS);
  // in English, for the browser to translate (the bols are syllables and stay as they are)
  const SOUND_LABEL = { kick: 'Kick', snare: 'Snare', hihat: 'Hi-hat', openhat: 'Open hi-hat', clap: 'Clap', tom_low: 'Low tom', tom_high: 'High tom', na: 'Na', tin: 'Tin', te: 'Te', ge: 'Ge', ke: 'Ke', dha: 'Dha', dhin: 'Dhin' };
  const SOUND_ALIAS = {
    kick: 'kick', 'kick drum': 'kick', 'bass drum': 'kick', bassdrum: 'kick', bass: 'kick', bd: 'kick', kik: 'kick',
    snare: 'snare', 'snare drum': 'snare', sd: 'snare', sn: 'snare',
    hihat: 'hihat', 'hi hat': 'hihat', 'high hat': 'hihat', hat: 'hihat', hh: 'hihat', ch: 'hihat', chh: 'hihat', 'closed hihat': 'hihat', 'closed hi hat': 'hihat', 'closed hat': 'hihat', closedhat: 'hihat', 'hihat closed': 'hihat',
    openhat: 'openhat', 'open hat': 'openhat', 'open hihat': 'openhat', 'open hi hat': 'openhat', oh: 'openhat', ohh: 'openhat', 'hihat open': 'openhat',
    clap: 'clap', handclap: 'clap', 'hand clap': 'clap', claps: 'clap', cp: 'clap',
    tom_low: 'tom_low', 'tom low': 'tom_low', 'low tom': 'tom_low', 'floor tom': 'tom_low', tom: 'tom_low', lt: 'tom_low', tom1: 'tom_low',
    tom_high: 'tom_high', 'tom high': 'tom_high', 'high tom': 'tom_high', 'hi tom': 'tom_high', 'rack tom': 'tom_high', ht: 'tom_high', tom2: 'tom_high',
    na: 'na', naa: 'na', ta: 'na', tin: 'tin', tinn: 'tin', tun: 'tin', te: 'te', ti: 'te', tit: 'te', tete: 'te', tr: 'te',
    ge: 'ge', ghe: 'ge', gha: 'ge', ga: 'ge', ke: 'ke', ka: 'ke', kat: 'ke', kath: 'ke', ki: 'ke',
    dha: 'dha', dhaa: 'dha', dhin: 'dhin', dhi: 'dhin', dhee: 'dhin'
  };
  function soundName(v) {
    if (typeof v !== 'string' || v.length > 30) return null;
    const k = v.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    return SOUND_ALIAS[k] || SOUND_ALIAS[k.replace(/ /g, '_')] || SOUND_ALIAS[k.replace(/ /g, '')] || null;
  }

  /* ---------------- step patterns ---------------- */
  const MIN_STEPS = 4, MAX_STEPS = 32;
  // "x...x..." (x hit, . rest; | and spaces ignored), [1,0,0,0], or the steps hit, counted from 1: [1, 5, 9]
  function parseTrack(v, steps) {
    let cells = null;
    if (typeof v === 'string' && v.length <= 200) {
      const s = v.replace(/[\s|/]+/g, '');
      if (!s || !/^[xX*o1.\-_0]+$/.test(s)) return null;
      cells = [...s].map((c) => /[xX*o1]/.test(c));
    } else if (Array.isArray(v) && v.length <= 64) {
      if (!v.length) cells = [];
      else if (v.every((x) => x === 0 || x === 1 || typeof x === 'boolean') && (!steps || v.length === steps || v.some((x) => x === 0 || x === false))) cells = v.map(Boolean);
      else if (steps && v.every((x) => Number.isInteger(x) && x >= 1 && x <= steps)) { cells = new Array(steps).fill(false); v.forEach((x) => { cells[x - 1] = true; }); }
      else return null;
      if (!cells.length && steps) cells = new Array(steps).fill(false);
    } else return null;
    if (steps) {
      // a bar written once, for a pattern of two or four: repeated
      if (cells.length && cells.length < steps && steps % cells.length === 0) cells = new Array(steps / cells.length).fill(cells).flat();
      if (cells.length !== steps) return null;
    }
    if (cells.length < 1 || cells.length > MAX_STEPS) return null;
    return cells.map((c) => (c ? 'x' : '.')).join('');
  }
  function defaultPerBeat(steps) {
    if (steps === 4) return 1;
    if (steps === 8) return 2;
    if (steps === 12 || steps === 6) return 3;
    if (steps % 4 === 0) return 4;
    if (steps % 3 === 0) return 3;
    if (steps % 2 === 0) return 2;
    return 1;
  }
  // a step's place in the count: "1", "1&" (with 2 a beat), "1e" "1&" "1a" (with 4), "1&" "1a" (with 3)
  function countName(i, perBeat) {
    const beat = Math.floor(i / perBeat) + 1, sub = i % perBeat;
    if (!sub) return String(beat);
    const subs = perBeat === 2 ? ['', '&'] : perBeat === 3 ? ['', '&', 'a'] : ['', 'e', '&', 'a'];
    return beat + (subs[sub] || '.' + (sub + 1));
  }

  /* ---------------- reading the AI's notes ---------------- */
  // a list of notes: ["C4", "E4"], "C4 E4 G4", "C4-E4-G4", "C4, E4"
  function noteList(v, max) {
    let items;
    if (Array.isArray(v)) items = v;
    else if (typeof v === 'string' || typeof v === 'number') items = String(v).replace(/[\s-]*sharp/gi, '#').replace(/[\s-]+flat/gi, 'b').split(/[\s,;+–—-]+/).filter(Boolean);
    else return null;
    if (items.length > max) return null;
    const out = items.map(parseNote);
    return out.every(Boolean) ? out : null;
  }
  // the first occurrence of a pitch class at or above a MIDI number
  const above = (pc, from) => from + mod12(pc - from);
  // Notes with no octave: a melody's first note at or above start (or near the note before, with near),
  // each next one near the one before it
  function placeSeq(parsed, start, near) {
    let prev = near;
    return parsed.map((p) => {
      const m = p.midi != null ? p.midi : prev == null ? above(p.pc, start) : nearest(p.pc, prev);
      prev = m;
      return m;
    });
  }
  // a chord's notes stacked upward from the first
  function placeStack(parsed, start, near) {
    let prev = null;
    return parsed.map((p) => {
      let m;
      if (p.midi != null) m = p.midi;
      else if (prev == null) m = near != null ? nearest(p.pc, near) : above(p.pc, start);
      else m = prev + (mod12(p.pc - prev) || 12);
      prev = m;
      return m;
    });
  }
  // a shape of notes moved by whole octaves so it fits from..to, if it can
  function fitOctaves(ms, from, to) {
    const lo = Math.min(...ms), hi = Math.max(...ms);
    if (from == null || to == null || hi - lo > to - from) return ms;
    for (let k = -8; k <= 8; k++) {
      const a = lo + 12 * k, b = hi + 12 * k;
      if (a >= from && b <= to) return ms.map((m) => m + 12 * k);
    }
    return ms;
  }
  const unique = (xs) => [...new Set(xs)];
  const sortNum = (xs) => xs.slice().sort((a, b) => a - b);

  /* ---------------- the piano spec ---------------- */
  function labelsOf(v) {
    if (v === false || v === null) return 'none';
    const s = String(v == null ? '' : v).toLowerCase().trim();
    if (/sargam|swar|indian|hindustani|carnatic|^sa re/.test(s)) return 'sargam';
    if (/^(none|off|no|false|hide|hidden|blank|nothing|no labels?)$/.test(s)) return 'none';
    return 'letters';
  }
  function rangeOf(spec) {
    let from = spec.from != null ? spec.from : spec.low != null ? spec.low : spec.start;
    let to = spec.to != null ? spec.to : spec.high != null ? spec.high : spec.end;
    const r = spec.range || spec.keys;
    if (from == null && to == null && r != null) {
      const list = Array.isArray(r) ? r : typeof r === 'string' ? r.split(/\s*(?:–|—|-|to|\.\.)\s*/) : [];
      if (list.length === 2) [from, to] = list;
    }
    const a = from != null ? toMidi(from) : null, b = to != null ? toMidi(to) : null;
    // bad: an end was given that isn't a note with its octave
    return { from: a, to: b, bad: (from != null && a == null) || (to != null && b == null) };
  }

  // the demo: steps of notes (a chord when several) and lengths, at a tempo
  const MAX_DEMO_STEPS = 64, MAX_DEMO_BEATS = 128, MAX_CHORD = 6;
  function readDemo(d, start, range = {}) {
    let steps = Array.isArray(d) ? d : isObj(d) ? (d.steps || d.notes || d.melody || d.sequence || d.chords || d.play || d.score) : null;
    if (typeof steps === 'string') steps = steps.split(/[\s,]+/).filter(Boolean);
    if (!Array.isArray(steps) || !steps.length) return null;
    const tempo = tempoOf(isObj(d) ? (d.tempo != null ? d.tempo : d.bpm) : null, 90);
    const out = [];
    let prev = start, total = 0;
    for (const st of steps) {
      if (out.length >= MAX_DEMO_STEPS) break;
      let notes = null, chord = null, beats = 1;
      if (typeof st === 'string' || typeof st === 'number') {
        const [n, b] = String(st).split(':');
        notes = /^(-|rest|r|_)$/i.test(n.trim()) ? [] : n.split('+');
        beats = b != null ? parseBeats(b) : 1;
      } else if (isObj(st)) {
        const len = [st.beats, st.len, st.length, st.dur, st.duration, st.value, st.time].find((x) => x != null);
        if (st.rest != null && st.notes == null && st.note == null && st.chord == null) {
          notes = [];
          beats = parseBeats(st.rest === true ? (len != null ? len : 1) : st.rest);
        } else {
          notes = [st.notes, st.note, st.n, st.keys, st.pitch, st.pitches].find((x) => x != null);
          chord = st.chord != null ? st.chord : null;
          if (notes == null && chord == null) notes = [];
          beats = parseBeats(len != null ? len : 1);
        }
      } else return null;
      if (beats == null) return null;
      let ms;
      const near = out.length ? prev : null; // the first notes go at or above start, the rest near what came before
      // notes written without an octave are moved by octaves to stay on the keyboard shown, if they can
      if (chord != null) {
        const c = parseChord(String(chord));
        let cm = c ? chordNotes(c, near != null ? { near } : { from: start }) : null;
        if (!cm) return null;
        cm = fitOctaves(cm, range.from, range.to);
        const names = spellChord(c, cm);
        ms = cm.map((m, i) => ({ m, name: names[i] }));
      } else {
        const parsed = noteList(notes, MAX_CHORD);
        if (!parsed) return null;
        let pm = parsed.length > 1 ? placeStack(parsed, start, near) : placeSeq(parsed, start, near);
        if (parsed.length && parsed.every((p) => p.midi == null)) pm = fitOctaves(pm, range.from, range.to);
        ms = pm.map((m, i) => ({ m, name: parsed[i].midi != null ? parsed[i].name : spell(parsed[i], m) }));
      }
      if (ms.length > MAX_CHORD || ms.some((x) => x.m < LOW || x.m > HIGH)) return null;
      if (total + beats > MAX_DEMO_BEATS) break;
      total += beats;
      if (ms.length) prev = ms[0].m;
      out.push({ notes: ms.map((x) => x.name), beats });
    }
    if (!out.some((s) => s.notes.length)) return null;
    return { tempo, steps: out };
  }

  // need: MIDI notes the keyboard must show (a goal's); null if it can't be drawn
  function normPiano(spec, need = []) {
    const labels = labelsOf(spec.labels != null ? spec.labels : spec.label != null ? spec.label : spec.names);
    const range = rangeOf(spec);
    if (range.bad) return null;
    let { from, to } = range;
    const start = from != null ? from : 60;

    // marked keys: "C4" one key, "C" every C
    const hl = spec.highlight != null ? spec.highlight : spec.highlights != null ? spec.highlights : spec.marked != null ? spec.marked : spec.mark;
    let highlight = [];
    if (hl != null) {
      const parsed = noteList(hl, 24);
      if (!parsed) return null;
      highlight = unique(parsed.map((p) => p.name));
    }
    const demo = spec.demo != null ? readDemo(spec.demo, start, { from, to }) : null;
    if (spec.demo != null && !demo) return null;

    const used = need.slice();
    highlight.forEach((n) => { const m = toMidi(n); if (m != null) used.push(m); });
    if (demo) demo.steps.forEach((s) => s.notes.forEach((n) => used.push(toMidi(n))));

    if (from != null && to != null && to <= from) to = null;
    if (from == null || to == null) {
      // what the notes need: from the C at or below the lowest, to the highest, at least an octave
      const lo = used.length ? Math.min(...used) : 60, hi = used.length ? Math.max(...used) : 72;
      if (from == null) { const base = to != null ? Math.min(lo, to - 12) : lo; from = base - mod12(base); }
      if (to == null) to = Math.max(hi, from + 12);
    }
    if (used.length) { from = Math.min(from, ...used); to = Math.max(to, ...used); }
    if (isBlack(from)) from -= 1;
    if (isBlack(to)) to += 1;
    if (to - from < 4) to = Math.min(HIGH, from + 12);
    if (from < LOW || to > HIGH || to - from > MAX_SPAN) return null;

    const out = { instrument: 'piano', from: noteName(from), to: noteName(to), labels };
    if (labels === 'sargam' || spec.sa != null) {
      const p = spec.sa != null ? parseNote(spec.sa) : null;
      if (spec.sa != null && !p) return null;
      let sa = p ? (p.midi != null ? p.midi : null) : null;
      if (sa == null) {
        const pc = p ? p.pc : 0;
        sa = from + mod12(pc - from);
        if (sa > to) sa = from;
      }
      out.sa = p ? spell(p, sa) : noteName(sa);
    }
    out.highlight = highlight;
    if (demo) out.demo = demo;
    return out;
  }

  // the MIDI numbers of a clean piano spec's marked keys ("C" marks every C on it)
  function markedKeys(piano) {
    const lo = toMidi(piano.from), hi = toMidi(piano.to), out = [];
    (piano.highlight || []).forEach((n) => {
      const p = parseNote(n);
      if (!p) return;
      if (p.midi != null) { if (p.midi >= lo && p.midi <= hi) out.push(p.midi); } else for (let m = lo; m <= hi; m++) if (mod12(m) === p.pc) out.push(m);
    });
    return unique(out);
  }

  /* ---------------- the drums spec ---------------- */
  const MAX_PADS = 10;
  function padsOf(v) {
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [];
    return unique(list.slice(0, 30).map(soundName).filter(Boolean));
  }
  function readPattern(p, needSteps) {
    if (!isObj(p)) return null;
    let tracks = p.tracks || p.rows || p.lanes || p.instruments;
    if (Array.isArray(tracks)) {
      // [{ sound: "kick", steps: "x..." }]
      const o = {};
      tracks.forEach((t) => { if (isObj(t)) { const k = t.sound || t.name || t.pad || t.drum; const v = t.steps != null ? t.steps : t.pattern != null ? t.pattern : t.hits; if (typeof k === 'string') o[k] = v; } });
      tracks = o;
    }
    if (!isObj(tracks)) return null;
    const entries = Object.entries(tracks).slice(0, 20).map(([k, v]) => [soundName(k), v]).filter(([k]) => k);
    if (!entries.length) return null;
    let steps = num(p.steps != null ? p.steps : p.length != null ? p.length : p.count);
    if (!Number.isInteger(steps)) steps = needSteps || Math.max(...entries.map(([, v]) => (typeof v === 'string' ? v.replace(/[\s|/]+/g, '').length : Array.isArray(v) && v.every((x) => x === 0 || x === 1 || typeof x === 'boolean') ? v.length : 0)));
    if (needSteps && steps !== needSteps) return null;
    if (!Number.isInteger(steps) || steps < MIN_STEPS || steps > MAX_STEPS) return null;
    const out = {};
    for (const [k, v] of entries) {
      if (out[k] != null) continue;
      const t = parseTrack(v, steps);
      if (t) out[k] = t;
    }
    if (!Object.keys(out).length) return null;
    let per = num(p.per_beat != null ? p.per_beat : p.perBeat != null ? p.perBeat : p.subdivision != null ? p.subdivision : p.division);
    if (!Number.isInteger(per) || per < 1 || per > 4 || steps % per) per = defaultPerBeat(steps);
    const pat = { tempo: tempoOf(p.tempo != null ? p.tempo : p.bpm, 100, 40, 220), steps, per_beat: per, tracks: out };
    const g = p.groups != null ? p.groups : p.vibhag != null ? p.vibhag : p.vibhags;
    if (Array.isArray(g) && g.length >= 1 && g.length <= 16 && g.every((x) => Number.isInteger(x) && x >= 1) && g.reduce((a, b) => a + b, 0) === steps) {
      pat.groups = g.slice();
      const mk = p.marks != null ? p.marks : p.signs;
      if (Array.isArray(mk) && mk.length === g.length && mk.every((x) => (typeof x === 'string' || typeof x === 'number') && String(x).trim().length <= 3)) {
        pat.marks = mk.map((x) => String(x).trim().replace(/[\u0000-\u001f\u007f<>&"']/g, ''));
      }
    }
    return pat;
  }
  // needSounds: pads a goal plays; needSteps: the grid a goal fills
  function normDrums(spec, needSounds = [], needSteps = null) {
    let pads = padsOf(spec.pads != null ? spec.pads : spec.sounds != null ? spec.sounds : spec.kit != null ? spec.kit : spec.instruments);
    const praw = spec.pattern != null ? spec.pattern : spec.tracks != null ? { tracks: spec.tracks, steps: spec.steps, tempo: spec.tempo, per_beat: spec.per_beat } : null;
    const pattern = praw != null ? readPattern(praw, needSteps) : null;
    if (praw != null && !pattern && !needSteps) return null;
    if (!pads.length) pads = pattern ? Object.keys(pattern.tracks) : needSounds.length ? [] : DRUMS.slice();
    if (pattern) Object.keys(pattern.tracks).forEach((k) => { if (!pads.includes(k)) pads.push(k); });
    needSounds.forEach((k) => { if (!pads.includes(k)) pads.push(k); });
    if (pads.length > MAX_PADS) {
      const keep = new Set(needSounds.concat(pattern ? Object.keys(pattern.tracks) : []));
      pads = pads.filter((k) => keep.has(k)).concat(pads.filter((k) => !keep.has(k))).slice(0, MAX_PADS);
      if ([...keep].some((k) => !pads.includes(k))) return null;
    }
    const out = { instrument: 'drums', pads };
    if (pattern) {
      // the rows in the order of the pads
      const tracks = {};
      pads.forEach((k) => { if (pattern.tracks[k] != null) tracks[k] = pattern.tracks[k]; });
      out.pattern = Object.assign({}, pattern, { tracks });
    }
    return out;
  }

  function instrumentOf(spec) {
    const v = String(spec.instrument || spec.type || spec.kind || '').toLowerCase();
    if (/piano|keyboard|keys|harmonium|organ|synth/.test(v)) return 'piano';
    if (/drum|percussion|tabla|beat|rhythm|kit/.test(v)) return 'drums';
    if (spec.pads != null || spec.pattern != null || spec.tracks != null) return 'drums';
    if (spec.from != null || spec.to != null || spec.range != null || spec.highlight != null || spec.demo != null || spec.labels != null) return 'piano';
    return null;
  }

  // A block's spec, clean; null if it can't be drawn as it is. (opts.keepEmpty: a task's grid, drawn for the book.)
  function block(spec, opts = {}) {
    if (!isObj(spec)) return null;
    const kind = instrumentOf(spec);
    if (kind === 'piano') return normPiano(spec);
    if (kind === 'drums') {
      const d = normDrums(spec);
      // a pattern with no hits shows nothing to play along with: the pads alone
      if (d && d.pattern && !opts.keepEmpty && !Object.values(d.pattern.tracks).some((tr) => tr.includes('x'))) delete d.pattern;
      return d;
    }
    return null;
  }

  /* ---------------- tasks ---------------- */
  const MAX_GOAL_NOTES = 16;
  const flag = (v) => v === true || v === 1 || (typeof v === 'string' && /^(true|yes|1|any)$/i.test(v.trim()));
  function goalType(goal, spec) {
    const t = String(goal.type || goal.kind || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (/^(notes?|chord|chords|melody|scale|keys|play|sequence|interval)$/.test(t)) return 'notes';
    if (/^(tap|taps|tapalong|clap|clapalong|tapintime|keeptime|pulse)$/.test(t)) return 'tap';
    if (/^(pattern|rhythm|beat|grid|steps|sequencer|groove)$/.test(t)) return goal.tracks != null || goal.pattern != null ? 'pattern' : t === 'rhythm' || t === 'beat' ? 'tap' : 'pattern';
    if (goal.tracks != null || goal.pattern != null) return 'pattern';
    if (goal.notes != null || goal.chord != null || goal.scale != null) return 'notes';
    if (goal.beats != null || goal.tempo != null || goal.rhythm != null) return 'tap';
    return instrumentOf(spec) === 'piano' ? 'notes' : null;
  }

  function notesTask(spec, goal) {
    const { from, to } = rangeOf(spec);
    const start = from != null ? from : 60;
    const ord = String(goal.order || '').toLowerCase();
    let inOrder = goal.in_order != null ? flag(goal.in_order) : goal.inOrder != null ? flag(goal.inOrder) : goal.ordered != null ? flag(goal.ordered)
      : /^(exact|sequence|in ?order|melody|ordered|strict)$/.test(ord) ? true : /^(any|set|chord|together|unordered)$/.test(ord) ? false : null;
    let anyOct = goal.any_octave != null ? flag(goal.any_octave) : goal.anyOctave != null ? flag(goal.anyOctave) : goal.octave != null ? /^any$/i.test(String(goal.octave)) : null;
    let ms, names;
    if (goal.notes != null) {
      const parsed = noteList(goal.notes, MAX_GOAL_NOTES);
      if (!parsed || !parsed.length) return null;
      if (inOrder == null) inOrder = /melody|scale|sequence/.test(String(goal.type || '').toLowerCase());
      const bare = parsed.every((p) => p.midi == null); // no octaves: placed near each other, in any octave
      if (anyOct == null) anyOct = bare;
      ms = inOrder ? placeSeq(parsed, start) : placeStack(parsed, start);
      if (bare) ms = fitOctaves(ms, from, to);
      names = parsed.map((p, i) => (p.midi != null ? p.name : spell(p, ms[i])));
    } else if (goal.chord != null) {
      const c = parseChord(String(goal.chord));
      if (!c) return null;
      ms = fitOctaves(chordNotes(c, { from: start }) || [], from, to);
      if (!ms.length) return null;
      names = spellChord(c, ms);
      if (inOrder == null) inOrder = false;
      if (anyOct == null) anyOct = true;
    } else if (goal.scale != null) {
      const s = parseScale(goal.scale);
      if (!s) return null;
      const t = s.tonic.midi != null ? s.tonic.midi : above(s.tonic.pc, start);
      ms = scaleNotes(t, s.name, { descending: /desc|down/i.test(String(goal.direction || '')) });
      if (!ms) return null;
      if (s.tonic.midi == null) ms = fitOctaves(ms, from, to);
      names = spellScale(s.tonic, s.name, ms);
      if (inOrder == null) inOrder = true;
      if (anyOct == null) anyOct = false;
    } else return null;
    if (ms.some((m) => m < LOW || m > HIGH)) return null;
    if (!inOrder) {
      // a set of keys: each once (each pitch class once, in any octave)
      const seen = new Set(), keep = [];
      ms.forEach((m, i) => { const k = anyOct ? mod12(m) : m; if (!seen.has(k)) { seen.add(k); keep.push(i); } });
      ms = keep.map((i) => ms[i]); names = keep.map((i) => names[i]);
      const order = ms.map((m, i) => i).sort((a, b) => ms[a] - ms[b]);
      ms = order.map((i) => ms[i]); names = order.map((i) => names[i]);
    }
    const piano = normPiano(spec, ms);
    if (!piano) return null;
    // marked keys that give the whole answer away are taken off
    const key = (m) => (anyOct ? mod12(m) : m);
    const marked = new Set(markedKeys(piano).map(key));
    if (ms.length > 1 && ms.every((m) => marked.has(key(m)))) piano.highlight = [];
    return { spec: piano, goal: { type: 'notes', notes: names, in_order: Boolean(inOrder), any_octave: Boolean(anyOct) } };
  }

  function patternTask(spec, goal) {
    let gt = goal.tracks != null ? goal.tracks : isObj(goal.pattern) ? goal.pattern.tracks : goal.pattern;
    if (Array.isArray(gt)) { const o = {}; gt.forEach((t) => { if (isObj(t) && typeof (t.sound || t.name) === 'string') o[t.sound || t.name] = t.steps != null ? t.steps : t.pattern; }); gt = o; }
    if (!isObj(gt)) return null;
    const entries = Object.entries(gt);
    if (!entries.length || entries.length > MAX_PADS) return null;
    const sp = isObj(spec.pattern) ? spec.pattern : null;
    let steps = num(sp && sp.steps != null ? sp.steps : goal.steps);
    if (!Number.isInteger(steps)) steps = Math.max(...entries.map(([, v]) => (typeof v === 'string' ? v.replace(/[\s|/]+/g, '').length : Array.isArray(v) && v.every((x) => x === 0 || x === 1 || typeof x === 'boolean') ? v.length : 0)));
    if (!Number.isInteger(steps) || steps < MIN_STEPS || steps > MAX_STEPS) return null;
    const tracks = {};
    for (const [k, v] of entries) {
      const s = soundName(k), t = parseTrack(v, steps);
      if (!s || !t || tracks[s] != null) return null;
      tracks[s] = t;
    }
    if (!Object.values(tracks).some((t) => t.includes('x'))) return null;
    const goalSounds = Object.keys(tracks);
    const base = Object.assign({}, spec, { pattern: Object.assign({ tempo: 100, steps }, sp || {}, { steps, tracks: Object.assign({}, sp && isObj(sp.tracks) ? sp.tracks : {}) }) });
    // the rows to fill start empty (an answer copied into the spec is taken out); the others are given
    goalSounds.forEach((k) => { base.pattern.tracks[k] = '.'.repeat(steps); });
    const drums = normDrums(base, goalSounds, steps);
    if (!drums || !drums.pattern) return null;
    goalSounds.forEach((k) => { if (drums.pattern.tracks[k] == null) drums.pattern.tracks[k] = '.'.repeat(steps); });
    // the goal's rows in the order of the pads
    const ordered = {};
    drums.pads.forEach((k) => { if (tracks[k] != null) ordered[k] = tracks[k]; });
    return { spec: drums, goal: { type: 'pattern', tracks: ordered } };
  }

  function tapTask(spec, goal) {
    const sp = isObj(spec.pattern) ? spec.pattern : {};
    const tempo = tempoOf(goal.tempo != null ? goal.tempo : goal.bpm != null ? goal.bpm : sp.tempo, 80, 40, 200);
    let per = num(goal.per_beat != null ? goal.per_beat : goal.perBeat);
    let rhythm = null, beats;
    if (goal.rhythm != null || goal.track != null) {
      if (!Number.isInteger(per) || per < 1 || per > 4) per = 1;
      rhythm = parseTrack(goal.rhythm != null ? goal.rhythm : goal.track, null);
      if (!rhythm || rhythm.length % per || !rhythm.includes('x')) return null;
      beats = rhythm.length / per;
      if (rhythm.length < 2) return null;
    } else {
      per = 1;
      beats = num(goal.beats != null ? goal.beats : goal.count);
      if (!Number.isFinite(beats)) beats = 8;
      beats = Math.round(beats);
    }
    if (beats < 2 || beats > 16) return null;
    const expected = rhythm ? [...rhythm].filter((c) => c === 'x').length : beats;
    if (expected < 2) return null;
    // no wider than 45% of the shortest gap between two taps, so each tap is counted once
    const stepMs = 60000 / tempo / per;
    let minGap = Infinity;
    if (rhythm) { let last = null; [...rhythm].forEach((c, i) => { if (c === 'x') { if (last != null) minGap = Math.min(minGap, (i - last) * stepMs); last = i; } }); } else minGap = 60000 / tempo;
    let tol = num(goal.tolerance_ms != null ? goal.tolerance_ms : goal.toleranceMs != null ? goal.toleranceMs : goal.tolerance);
    if (Number.isFinite(tol) && tol > 0 && tol < 1) tol *= 1000; // seconds
    if (!Number.isFinite(tol)) tol = 150;
    tol = Math.round(clamp(Math.min(tol, minGap * 0.45), 60, 300));
    if (tol > minGap * 0.45) return null; // faster than anyone can be checked fairly
    let countIn = num(goal.count_in != null ? goal.count_in : goal.countIn);
    if (!Number.isInteger(countIn) || countIn < 2 || countIn > 8) countIn = 4;
    const sound = soundName(String(goal.sound || '')) || padsOf(spec.pads)[0] || 'clap';
    const drums = normDrums(Object.assign({}, spec, { pattern: undefined, tracks: undefined, pads: [sound] }), [sound]);
    if (!drums) return null;
    const g = { type: 'tap', tempo, beats, per_beat: per, tolerance_ms: tol, count_in: countIn, sound };
    if (rhythm) g.rhythm = rhythm;
    return { spec: drums, goal: g };
  }

  // A task's spec and goal, clean; null if the goal can't be done on what is shown.
  function task(spec, goal) {
    if (!isObj(spec) || !isObj(goal)) return null;
    const type = goalType(goal, spec);
    const kind = instrumentOf(spec);
    if (type === 'notes' && kind !== 'drums') return notesTask(spec, goal);
    if (type === 'pattern' && kind !== 'piano') return patternTask(spec, goal);
    if (type === 'tap' && kind !== 'piano') return tapTask(spec, goal);
    return null;
  }

  /* ---------------- checking an answer ---------------- */
  // played: note names (or MIDI numbers) in the order played, or the keys chosen
  function checkNotes(goal, played) {
    const want = (goal.notes || []).map(toMidi), got = (played || []).map((x) => (typeof x === 'number' ? x : toMidi(x)));
    if (!want.length || want.some((m) => m == null) || got.some((m) => m == null)) return { correct: false, invalid: true };
    const key = goal.any_octave ? mod12 : (m) => m;
    if (goal.in_order) {
      const a = want.map(key), b = got.map(key);
      const firstWrong = a.findIndex((x, i) => x !== b[i]);
      return { correct: a.length === b.length && firstWrong < 0, need: a.length, length: b.length, firstWrong: firstWrong < 0 && b.length > a.length ? a.length : firstWrong };
    }
    const A = new Set(want.map(key)), B = new Set(got.map(key));
    const missing = [...A].filter((x) => !B.has(x)), extra = [...B].filter((x) => !A.has(x));
    return { correct: !missing.length && !extra.length, need: A.size, length: B.size, missing, extra };
  }
  // tracks: { kick: "x...", ... } as the learner left them; the rows that differ
  function checkPattern(goal, tracks) {
    const wrong = Object.keys(goal.tracks || {}).filter((k) => String((tracks || {})[k] || '').replace(/[^x]/g, '.') !== goal.tracks[k]);
    return { correct: !wrong.length, wrong };
  }
  // when each tap should come, in ms from the first
  function tapTimes(goal) {
    const per = goal.per_beat || 1, stepMs = 60000 / goal.tempo / per;
    if (goal.rhythm) return [...goal.rhythm].map((c, i) => (c === 'x' ? i * stepMs : null)).filter((x) => x != null);
    return Array.from({ length: goal.beats }, (_, i) => i * (60000 / goal.tempo));
  }
  // taps: ms from the first expected one; each expected tap takes the nearest unused tap within the tolerance
  function checkTaps(goal, taps) {
    const want = tapTimes(goal), tol = goal.tolerance_ms || 150;
    const list = (taps || []).filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
    const used = new Array(list.length).fill(false), offsets = [];
    want.forEach((w) => {
      let best = -1;
      list.forEach((t, i) => { if (!used[i] && Math.abs(t - w) <= tol && (best < 0 || Math.abs(t - w) < Math.abs(list[best] - w))) best = i; });
      if (best >= 0) { used[best] = true; offsets.push(list[best] - w); }
    });
    const hits = offsets.length, n = want.length;
    const extra = list.filter((t, i) => !used[i] && t > -tol && t < want[n - 1] + tol).length;
    const allow = Math.floor(n / 8);
    const mean = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;
    return { correct: n - hits <= allow && extra <= allow + 1, hits, n, extra, mean: Math.round(mean) };
  }

  /* ---------------- in words ---------------- */
  // "C – E – G", or "Sa – Ga – Pa (C – E – G)"; with octaves when the keyboard has the same note twice
  function notesText(names, opts = {}) {
    const ms = names.map(toMidi);
    const letters = names.map((n) => pretty(n, opts.octave !== false)).join(' – ');
    if (opts.sargam == null || ms.some((m) => m == null)) return letters;
    return ms.map((m) => sargamText(m, opts.sargam)).join(' – ') + ' (' + letters + ')';
  }

  return {
    LOW, HIGH, MAX_SPAN, SHARPS, FLATS, CHORDS, SCALES, LENGTHS, DRUMS, BOLS, SOUNDS, SOUND_LABEL, MIN_STEPS, MAX_STEPS,
    parseNote, toMidi, noteName, pcName, isBlack, freq, pretty, nearest, mod12,
    sargam, sargamText, parseChord, chordNotes, spellChord, parseScale, scaleNotes, spellScale, scaleKey, parseBeats,
    soundName, parseTrack, defaultPerBeat, countName, markedKeys,
    block, task, checkNotes, checkPattern, tapTimes, checkTaps, notesText
  };
});
