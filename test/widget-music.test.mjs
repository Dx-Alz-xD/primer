// The piano and drums of interactive lessons: the shared theory (assets/js/widgets/music-core.js) and
// the server's checks (server/widgets/music.mjs), which hold every spec and goal the AI writes.   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import M from '../assets/js/widgets/music-core.js';
import * as music from '../server/widgets/music.mjs';
import { widgetKinds, widgetPrompt, normWidgetBlock, normTask } from '../server/widgets.mjs';

const twice = (f, ...a) => { const x = f(...a); return [x, x && (x.spec ? f(x.spec, x.goal) : f(x))]; };

test('note names: letters, accidentals and octaves to MIDI and back', () => {
  assert.equal(M.toMidi('C4'), 60);
  assert.equal(M.toMidi('A4'), 69);
  assert.equal(M.toMidi('c#4'), 61);
  assert.equal(M.toMidi('Db4'), 61);
  assert.equal(M.toMidi('F♯3'), 54);
  assert.equal(M.toMidi('B flat 3'), 58);
  assert.equal(M.toMidi('E-flat 4'), 63);
  assert.equal(M.toMidi('B#3'), 60, 'B#3 is C4');
  assert.equal(M.toMidi('Cb4'), 59, 'Cb4 is B3');
  assert.equal(M.toMidi('bb4'), 70, 'b flat');
  assert.equal(M.toMidi('A0'), 21);
  assert.equal(M.toMidi('C8'), 108);
  for (const bad of ['H4', 'C9', 'G#8', 'Ab0', '', 'C#-1', 'do', 'C4 E4', null, {}, 12]) assert.equal(M.toMidi(bad), null, String(bad));
  assert.equal(M.parseNote('Eb').midi, null, 'no octave: a pitch class');
  assert.equal(M.parseNote('Eb').pc, 3);
  assert.equal(M.noteName(61), 'C#4');
  assert.equal(M.noteName(61, true), 'Db4');
  assert.equal(M.noteName(21), 'A0');
  assert.equal(M.pretty('C#4'), 'C♯4');
  assert.equal(M.pretty('Bb3', false), 'B♭');
  assert.ok(M.isBlack(61) && !M.isBlack(60) && !M.isBlack(64) && M.isBlack(70));
  assert.equal(Math.round(M.freq(69)), 440);
  assert.equal(Math.round(M.freq(60) * 100) / 100, 261.63);
});

test('sargam: Sa Re Ga Ma Pa Dha Ni from any Sa, with komal, tivra and the octaves', () => {
  const names = [];
  for (let m = 60; m < 72; m++) names.push(M.sargam(m, 60).name);
  assert.deepEqual(names, ['Sa', 'Re', 'Re', 'Ga', 'Ga', 'Ma', 'Ma', 'Pa', 'Dha', 'Dha', 'Ni', 'Ni']);
  assert.deepEqual(M.sargam(61, 60), { name: 'Re', komal: true, tivra: false, octave: 0 });
  assert.deepEqual(M.sargam(66, 60), { name: 'Ma', komal: false, tivra: true, octave: 0 });
  assert.equal(M.sargamText(63, 60), 'komal Ga');
  assert.equal(M.sargamText(66, 60), 'tivra Ma');
  assert.equal(M.sargamText(72, 60), "Sa'", 'taar saptak');
  assert.equal(M.sargamText(59, 60), '.Ni', 'mandra saptak');
  assert.equal(M.sargam(62, 62).name, 'Sa', 'Sa on D');
  assert.equal(M.sargam(69, 62).name, 'Pa', 'A is Pa when Sa is D');
});

test('chords: symbols and names to notes, spelled by their degrees', () => {
  assert.deepEqual(M.chordNotes('C', 4), [60, 64, 67]);
  assert.deepEqual(M.chordNotes('Am', 4), [69, 72, 76]);
  assert.deepEqual(M.chordNotes('G7', 3), [55, 59, 62, 65]);
  assert.deepEqual(M.chordNotes('C/E', 4), [52, 60, 64, 67], 'a slash chord puts the bass below');
  assert.equal(M.parseChord('Bbmaj7').symbol, 'Bbmaj7');
  assert.equal(M.parseChord('F# minor').symbol, 'F#m');
  assert.equal(M.parseChord('D major seventh').quality, 'maj7');
  assert.equal(M.parseChord('E dominant 7th').quality, '7');
  assert.equal(M.parseChord('Bdim').quality, 'dim');
  assert.equal(M.parseChord('C+').quality, 'aug');
  assert.equal(M.parseChord('Hm'), null);
  assert.equal(M.parseChord('C wobbly'), null);
  const spell = (s) => { const c = M.parseChord(s); return M.spellChord(c, M.chordNotes(c, 4)); };
  assert.deepEqual(spell('Gm'), ['G4', 'Bb4', 'D5']);
  assert.deepEqual(spell('D'), ['D4', 'F#4', 'A4']);
  assert.deepEqual(spell('Bdim7'), ['B4', 'D5', 'F5', 'Ab5']);
  assert.deepEqual(spell('Eb'), ['Eb4', 'G4', 'Bb4']);
});

test('scales and thaats, spelled with one letter a degree', () => {
  assert.deepEqual(M.scaleNotes(60, 'major'), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(M.scaleNotes(57, 'natural minor'), [57, 59, 60, 62, 64, 65, 67, 69]);
  assert.deepEqual(M.scaleNotes(60, 'major', { descending: true }), [72, 71, 69, 67, 65, 64, 62, 60]);
  assert.equal(M.scaleNotes(60, 'no such scale'), null);
  const s = M.parseScale('E blues');
  assert.equal(s.tonic.name, 'E', '"E blues" is not E flat');
  assert.equal(s.name, 'blues');
  assert.equal(M.parseScale('C4 yaman').name, 'kalyan');
  const f = M.parseScale('F major');
  assert.deepEqual(M.spellScale(f.tonic, f.name, M.scaleNotes(65, 'major')), ['F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'E5', 'F5']);
  const d = M.parseScale('D major');
  assert.deepEqual(M.spellScale(d.tonic, d.name, M.scaleNotes(62, 'major')).filter((n) => n.includes('#')), ['F#4', 'C#5']);
  const k = M.parseScale('C kalyan');
  assert.ok(M.spellScale(k.tonic, k.name, M.scaleNotes(60, 'kalyan')).includes('F#4'), 'kalyan thaat has tivra Ma');
});

test('lengths in beats, and drum sounds by any common name', () => {
  assert.equal(M.parseBeats(1), 1);
  assert.equal(M.parseBeats('quarter'), 1);
  assert.equal(M.parseBeats('half note'), 2);
  assert.equal(M.parseBeats('dotted quarter'), 1.5);
  assert.equal(M.parseBeats('q.'), 1.5);
  assert.equal(M.parseBeats('eighth'), 0.5);
  assert.equal(M.parseBeats('1/2'), 0.5);
  assert.equal(M.parseBeats('eighth triplet'), 0.3333);
  for (const bad of [0, -1, 9, 'forever', '', null]) assert.equal(M.parseBeats(bad), null, String(bad));
  assert.equal(M.soundName('Hi-Hat'), 'hihat');
  assert.equal(M.soundName('bass drum'), 'kick');
  assert.equal(M.soundName('Low Tom'), 'tom_low');
  assert.equal(M.soundName('open hi-hat'), 'openhat');
  assert.equal(M.soundName('Dhin'), 'dhin');
  assert.equal(M.soundName('ta'), 'na');
  assert.equal(M.soundName('cowbell'), null);
});

test('step tracks: x and dots, 0 and 1, or the steps hit; a bar written once repeats', () => {
  assert.equal(M.parseTrack('x...x...', 8), 'x...x...');
  assert.equal(M.parseTrack('X-x- | x-x-', 8), 'x.x.x.x.');
  assert.equal(M.parseTrack([1, 0, 0, 0, 1, 0, 0, 0], 8), 'x...x...');
  assert.equal(M.parseTrack([1, 5, 9, 13], 16), 'x...x...x...x...');
  assert.equal(M.parseTrack('x...', 16), 'x...x...x...x...');
  assert.equal(M.parseTrack('x....', 16), null, '5 does not go into 16');
  assert.equal(M.parseTrack('x...x...x', 8), null, 'too long');
  assert.equal(M.parseTrack('xyz', 3), null);
  assert.equal(M.parseTrack([0, 17], 16), null);
  assert.equal(M.countName(0, 2), '1');
  assert.equal(M.countName(1, 2), '1&');
  assert.equal(M.countName(5, 4), '2e');
  assert.equal(M.countName(6, 1), '7');
});

test('checking notes: a chord in any order (and octave), a melody in order', () => {
  const chord = { notes: ['C4', 'E4', 'G4'], in_order: false, any_octave: true };
  assert.equal(M.checkNotes(chord, ['G4', 'C4', 'E4']).correct, true);
  assert.equal(M.checkNotes(chord, ['G3', 'C5', 'E4']).correct, true, 'any octave');
  assert.equal(M.checkNotes(chord, ['C4', 'E4', 'A4']).correct, false);
  assert.equal(M.checkNotes(chord, ['C4', 'E4']).correct, false);
  assert.equal(M.checkNotes({ ...chord, any_octave: false }, ['G3', 'C4', 'E4']).correct, false, 'that octave only');
  const tune = { notes: ['E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4'], in_order: true, any_octave: false };
  assert.equal(M.checkNotes(tune, ['E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4']).correct, true);
  const r = M.checkNotes(tune, ['E4', 'D4', 'D4', 'D4', 'E4', 'E4', 'E4']);
  assert.equal(r.correct, false);
  assert.equal(r.firstWrong, 2);
  assert.equal(M.checkNotes(tune, ['E4', 'D4']).length, 2);
  assert.equal(M.checkNotes({ ...tune, any_octave: true }, ['E5', 'D5', 'C5', 'D5', 'E5', 'E5', 'E5']).correct, true);
  assert.equal(M.checkNotes(chord, ['nonsense']).invalid, true);
});

test('checking a grid and taps in time', () => {
  const goal = { tracks: { kick: 'x...x...', snare: '..x...x.' } };
  assert.deepEqual(M.checkPattern(goal, { kick: 'x...x...', snare: '..x...x.' }), { correct: true, wrong: [] });
  assert.deepEqual(M.checkPattern(goal, { kick: 'x...x...', snare: '..x..x..' }), { correct: false, wrong: ['snare'] });
  assert.equal(M.checkPattern(goal, {}).correct, false);
  const tap = { type: 'tap', tempo: 120, beats: 8, per_beat: 1, tolerance_ms: 120 };
  assert.deepEqual(M.tapTimes(tap).slice(0, 3), [0, 500, 1000]);
  assert.equal(M.checkTaps(tap, [5, 510, 990, 1530, 2000, 2480, 3010, 3500]).correct, true);
  assert.equal(M.checkTaps(tap, [5, 510, 990, 1530, 2000, 2480, 3010]).correct, true, 'one miss in eight is allowed');
  assert.equal(M.checkTaps(tap, [5, 510, 990, 1530, 2000, 2480]).correct, false, 'two misses are not');
  const late = M.checkTaps(tap, [200, 700, 1200, 1700, 2200, 2700, 3200, 3700]);
  assert.equal(late.correct, false);
  assert.equal(late.hits, 0);
  assert.equal(M.checkTaps(tap, [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3250, 3500]).correct, false, 'taps between the beats');
  const rhythm = { type: 'tap', tempo: 60, beats: 4, per_beat: 2, rhythm: 'x.xxx...', tolerance_ms: 150 };
  assert.deepEqual(M.tapTimes(rhythm), [0, 1000, 1500, 2000]);
  assert.equal(M.checkTaps(rhythm, [20, 990, 1520, 1980]).correct, true);
});

test('a piano block: range, names, marked keys and a demo, cleaned and held to the limits', () => {
  const [b, again] = twice(music.block, { instrument: 'piano', from: 'C4', to: 'C5', labels: 'letters', highlight: ['C4', 'E4', 'G4'],
    demo: { tempo: 90, steps: [{ notes: ['C4'], beats: 1 }, { notes: 'E4', beats: 'half' }, { rest: 1 }, { chord: 'C', beats: 2 }, 'G4:0.5'] } });
  assert.deepEqual(b, {
    instrument: 'piano', from: 'C4', to: 'C5', labels: 'letters', highlight: ['C4', 'E4', 'G4'],
    demo: { tempo: 90, steps: [{ notes: ['C4'], beats: 1 }, { notes: ['E4'], beats: 2 }, { notes: [], beats: 1 }, { notes: ['C4', 'E4', 'G4'], beats: 2 }, { notes: ['G4'], beats: 0.5 }] }
  });
  assert.deepEqual(again, b, 'cleaning a clean spec changes nothing');
  // no range: what the notes need; a black key at an end moves out to a white one; labels and Sa
  assert.deepEqual(music.block({ instrument: 'piano', demo: ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'] }).to, 'C5');
  assert.equal(music.block({ instrument: 'piano', from: 'C#4', to: 'F#5' }).from, 'C4');
  assert.equal(music.block({ instrument: 'piano', from: 'C#4', to: 'F#5' }).to, 'G5');
  assert.equal(music.block({ instrument: 'piano', from: 'C4', to: 'C5', highlight: ['E5'] }).to, 'E5', 'widened to show a marked key');
  const s = music.block({ instrument: 'piano', from: 'C4', to: 'C5', labels: 'sargam', sa: 'D' });
  assert.equal(s.labels, 'sargam');
  assert.equal(s.sa, 'D4');
  assert.equal(music.block({ instrument: 'piano', labels: 'none' }).labels, 'none');
  assert.deepEqual(music.block({ instrument: 'piano', from: 'C4', to: 'C5', highlight: 'C' }).highlight, ['C'], 'every C');
  // the tempo is kept sane; a long demo is cut short
  assert.equal(music.block({ instrument: 'piano', demo: { tempo: 900, steps: ['C4'] } }).demo.tempo, 200);
  assert.equal(music.block({ instrument: 'piano', demo: { steps: Array(100).fill('C4') } }).demo.steps.length, 64);
  // what can't be drawn is left out
  assert.equal(music.block({ instrument: 'piano', from: 'C1', to: 'C7' }), null, 'more than four octaves');
  assert.equal(music.block({ instrument: 'piano', highlight: ['H4'] }), null);
  assert.equal(music.block({ instrument: 'piano', demo: { steps: [{ notes: ['C4'], beats: 20 }] } }), null, 'a note of 20 beats');
  assert.equal(music.block({ instrument: 'piano', demo: { steps: [{ notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] }] } }), null, 'seven notes at once');
  assert.equal(music.block({ instrument: 'piano', demo: { steps: [] } }), null);
  assert.equal(music.block({ instrument: 'piano', highlight: Array(30).fill('C4') }), null);
  assert.equal(music.block({ instrument: 'banjo' }), null);
  assert.equal(music.block('piano'), null);
});

test('a drums block: known sounds, 4 to 32 steps, tracks as long as the grid', () => {
  const [b, again] = twice(music.block, { instrument: 'drums', pads: ['kick', 'Snare', 'hi-hat', 'cowbell'],
    pattern: { tempo: 100, steps: 16, tracks: { kick: 'x.......x.......', snare: '....x.......x...', hh: 'x.x.x.x.', cowbell: 'xxxxxxxxxxxxxxxx' } } });
  assert.deepEqual(b, {
    instrument: 'drums', pads: ['kick', 'snare', 'hihat'],
    pattern: { tempo: 100, steps: 16, per_beat: 4, tracks: { kick: 'x.......x.......', snare: '....x.......x...', hihat: 'x.x.x.x.x.x.x.x.' } }
  });
  assert.deepEqual(again, b);
  assert.deepEqual(music.block({ instrument: 'drums' }).pads, M.DRUMS, 'no pads named: the kit');
  assert.deepEqual(music.block({ instrument: 'drums', pattern: { steps: 8, tracks: { kick: 'x...x...', snare: '..x...x.' } } }).pads, ['kick', 'snare'], 'the pattern\'s sounds');
  const taal = music.block({ instrument: 'drums', pattern: { tempo: 80, steps: 16, per_beat: 1, groups: [4, 4, 4, 4], marks: ['X', '2', '0', '3'], tracks: { dha: 'x..xx..x....x..x', dhin: '.xx..xx......xx.' } } });
  assert.deepEqual(taal.pattern.groups, [4, 4, 4, 4]);
  assert.deepEqual(taal.pattern.marks, ['X', '2', '0', '3']);
  assert.equal(music.block({ instrument: 'drums', pattern: { steps: 16, groups: [4, 4, 4], tracks: { na: 'x' } } }).pattern.groups, undefined, 'groups that do not add up are dropped');
  assert.equal(music.block({ instrument: 'drums', pattern: { steps: 8, per_beat: 3, tracks: { kick: 'x...x...' } } }).pattern.per_beat, 2, 'per_beat must divide the steps');
  assert.equal(music.block({ instrument: 'drums', pattern: { steps: 2, tracks: { kick: 'xx' } } }), null, 'too few steps');
  assert.equal(music.block({ instrument: 'drums', pattern: { steps: 64, tracks: { kick: 'x' } } }), null, 'too many steps');
  assert.equal(music.block({ instrument: 'drums', pattern: { steps: 8, tracks: { cowbell: 'x...x...' } } }), null, 'nothing it can play');
  assert.equal(music.block({ instrument: 'drums', pattern: { steps: 8, tempo: 5, tracks: { kick: 'x' } } }).pattern.tempo, 40);
  const empty = { instrument: 'drums', pattern: { steps: 4, tracks: { kick: '....', snare: '....' } } };
  assert.equal(music.block(empty).pattern, undefined, 'a grid with no hits: the pads alone');
  assert.deepEqual(music.block(empty).pads, ['kick', 'snare']);
  assert.equal(M.block(empty, { keepEmpty: true }).pattern.steps, 4, 'kept for a task\'s picture in the book');
});

test('a piano task: the goal on the keyboard, shorthand for chords and scales, no answer marked', () => {
  const [t, again] = twice(music.task, { instrument: 'piano', from: 'C4', to: 'C5' }, { type: 'notes', notes: ['C4', 'E4', 'G4'], in_order: false, any_octave: true });
  assert.deepEqual(t.goal, { type: 'notes', notes: ['C4', 'E4', 'G4'], in_order: false, any_octave: true });
  assert.deepEqual(again, t);
  assert.equal(music.task({ instrument: 'piano', from: 'C4', to: 'C5' }, { type: 'notes', notes: ['C4', 'E5'] }).spec.to, 'E5', 'the keyboard grows to reach the goal');
  assert.deepEqual(music.task({ instrument: 'piano', from: 'C4', to: 'C5', highlight: ['C4', 'E4', 'G4'] }, { type: 'notes', notes: ['C4', 'E4', 'G4'] }).spec.highlight, [], 'marks that give the answer away are taken off');
  assert.deepEqual(music.task({ instrument: 'piano', from: 'C4', to: 'C5', highlight: ['C4'] }, { type: 'notes', notes: ['C4', 'E4', 'G4'] }).spec.highlight, ['C4'], 'a marked starting note stays');
  const g = music.task({ instrument: 'piano', from: 'C4', to: 'C5' }, { type: 'chord', chord: 'F' });
  assert.deepEqual(g.goal, { type: 'notes', notes: ['F4', 'A4', 'C5'], in_order: false, any_octave: true });
  const sc = music.task({ instrument: 'piano', from: 'C4', to: 'C6' }, { type: 'scale', scale: 'G major' });
  assert.deepEqual(sc.goal.notes, ['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5']);
  assert.equal(sc.goal.in_order, true);
  const melody = music.task({ instrument: 'piano', from: 'C4', to: 'C5' }, { type: 'melody', notes: 'E D C D E E E' });
  assert.deepEqual(melody.goal.notes, ['E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4']);
  assert.equal(melody.goal.in_order, true);
  assert.equal(melody.goal.any_octave, true, 'written without octaves');
  assert.deepEqual(music.task({ instrument: 'piano' }, { notes: ['C4', 'C4', 'E4'], in_order: false }).goal.notes, ['C4', 'E4'], 'a set has each key once');
  assert.equal(music.task({ instrument: 'piano' }, { type: 'notes', notes: ['C4', 'X9'] }), null);
  assert.equal(music.task({ instrument: 'piano' }, { type: 'notes', notes: Array(20).fill('C4') }), null, 'too many');
  assert.equal(music.task({ instrument: 'piano' }, { type: 'notes', notes: ['C1', 'C8'] }), null, 'can\'t be shown on one keyboard');
  assert.equal(music.task({ instrument: 'drums' }, { type: 'notes', notes: ['C4'] }), null, 'notes on drums');
});

test('a drums task: the rows to fill start empty, the others are given; tapping in time', () => {
  const [t, again] = twice(music.task, { instrument: 'drums', pads: ['kick', 'snare', 'hihat'], pattern: { tempo: 90, steps: 8, per_beat: 2, tracks: { hihat: 'xxxxxxxx', kick: 'x...x...' } } },
    { type: 'pattern', tracks: { kick: 'x...x...', snare: '..x...x.' } });
  assert.deepEqual(t.spec.pattern.tracks, { kick: '........', snare: '........', hihat: 'xxxxxxxx' }, 'the answer copied into the spec is taken out');
  assert.deepEqual(t.goal, { type: 'pattern', tracks: { kick: 'x...x...', snare: '..x...x.' } });
  assert.deepEqual(again, t);
  const made = music.task({ instrument: 'drums' }, { tracks: { kick: [1, 5, 9, 13] , snare: '....x.......x...' } });
  assert.equal(made.spec.pattern.steps, 16, 'a grid made for the goal');
  assert.equal(music.task({ instrument: 'drums' }, { type: 'pattern', tracks: { kick: '........' } }), null, 'nothing to fill in');
  assert.equal(music.task({ instrument: 'drums' }, { type: 'pattern', tracks: { cowbell: 'x...x...' } }), null, 'a sound it doesn\'t have');
  assert.equal(music.task({ instrument: 'drums', pattern: { steps: 16, tracks: { hihat: 'x' } } }, { type: 'pattern', tracks: { kick: 'x...x...x' } }), null, 'a row that doesn\'t fit the grid');
  assert.equal(music.task({ instrument: 'piano' }, { type: 'pattern', tracks: { kick: 'x...' } }), null);

  const tap = music.task({ instrument: 'drums', pads: ['clap'] }, { type: 'tap', tempo: 80, beats: 8 });
  assert.deepEqual(tap.goal, { type: 'tap', tempo: 80, beats: 8, per_beat: 1, tolerance_ms: 150, count_in: 4, sound: 'clap' });
  assert.deepEqual(tap.spec, { instrument: 'drums', pads: ['clap'] });
  const r = music.task({ instrument: 'drums' }, { type: 'tap', tempo: 60, per_beat: 2, rhythm: 'x.xxx...' });
  assert.equal(r.goal.beats, 4);
  assert.equal(r.goal.rhythm, 'x.xxx...');
  assert.equal(music.task({ instrument: 'drums' }, { type: 'tap', tempo: 200, per_beat: 4, rhythm: 'xxxxxxxx' }), null, 'too fast to check fairly');
  assert.equal(music.task({ instrument: 'drums' }, { type: 'tap', beats: 40 }), null);
  assert.ok(music.task({ instrument: 'drums' }, { type: 'tap', tempo: 120, tolerance_ms: 900 }).goal.tolerance_ms <= 300);
});

test('the core frame takes music blocks and tasks, and offers music to music lessons', () => {
  const b = normWidgetBlock({ t: 'widget', kind: 'music', spec: { instrument: 'piano', from: 'C4', to: 'C5' }, caption: 'The keys.' });
  assert.equal(b.kind, 'music');
  assert.equal(b.spec.instrument, 'piano');
  assert.equal(normWidgetBlock({ t: 'widget', kind: 'music', spec: { instrument: 'piano', from: 'Z9' } }), null);
  const q = normTask({ type: 'task', kind: 'music', spec: { instrument: 'piano' }, goal: { type: 'notes', chord: 'Am' } }, { prompt: 'Play A minor.', hint: '', explain: '' });
  assert.deepEqual(q.goal.notes, ['A4', 'C5', 'E5']);
  assert.ok(widgetKinds({ topic: 'Music theory', title: 'The major scale' }).includes('music'));
  assert.ok(!widgetKinds({ topic: 'Photosynthesis', title: 'Light reactions' }).includes('music'));
  assert.match(widgetPrompt(['music']), /Kind "music"/);
});

test('which lessons are offered the piano and drums, in the languages Primer serves', () => {
  const yes = ['Piano for beginners', 'Music theory', 'Basic drum beats', 'Reading notes and scales on the keyboard', 'Chords and scales', 'Tempo and beats',
    'Raga and taal', 'Learn the tabla', 'Harmonium sargam', 'Teentaal', 'Percussion', 'Harmony and melody', 'Rhythm in poetry',
    'भारतीय शास्त्रीय संगीत', 'तबला सीखें', 'संगीतकार', 'सरगम', 'पियानो', 'ड्रम बजाना', 'ताल और लय', 'சுரம் இசையின் வரலாறு', 'সংগীতের ইতিহাস',
    'música para niños', 'el piano', 'ritmo y compás', 'la musique', 'музыка для начинающих', 'Основы музыкальной грамоты', 'ராகம்', 'సంగీతం', 'ಸಂಗೀತ', 'സംഗീതം',
    'موسیقی', 'الموسيقى العربية', '音乐理论', 'ピアノ入門', '음악 이론', 'Carnatic music'];
  const no = ['Circadian rhythm and sleep', 'The pH scale', 'Taking good notes', 'Geometry: chords of a circle', 'Typing on a computer keyboard', 'Tempo verbal em português',
    'batería de litio', 'तालाब का पानी', 'ताला और चाबी', "Newlands' law of octaves", 'The Richter scale: lecture notes', 'Communal harmony', 'Heart beats per minute',
    'ritmo cardíaco', 'Температура и давление', 'Тактика', 'ритм сердца', 'Photosynthesis', 'Economies of scale', 'The Carnatic Wars', 'Simple harmonic motion',
    'स्वर और व्यंजन', 'Sales pitch notes', 'Map scale and scale drawings', 'Deforestation: tala de árboles', ''];
  for (const s of yes) assert.equal(music.match(s.toLowerCase()), true, s);
  for (const s of no) assert.equal(music.match(s.toLowerCase()), false, s);
});

test('the prompt\'s examples are themselves valid, and it stays short', () => {
  const p = music.prompt;
  assert.ok(p.length < 4000, `the prompt is ${p.length} characters`);
  // every JSON object in it that starts a spec or a task
  const objects = [];
  for (const start of ['{"instrument"', '{"type": "task"']) {
    let i = p.indexOf(start);
    while (i >= 0) {
      let depth = 0, j = i;
      for (; j < p.length; j++) { if (p[j] === '{') depth++; else if (p[j] === '}' && --depth === 0) break; }
      objects.push(JSON.parse(p.slice(i, j + 1)));
      i = p.indexOf(start, j);
    }
  }
  const specs = objects.filter((o) => o.instrument), tasks = objects.filter((o) => o.type === 'task');
  assert.ok(specs.length >= 4 && tasks.length >= 2);
  specs.forEach((s) => assert.ok(music.block(s), JSON.stringify(s)));
  tasks.forEach((q) => assert.ok(music.task(q.spec, q.goal), JSON.stringify(q)));
  assert.equal(typeof music.label, 'string');
});
