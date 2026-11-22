// The chess board in lessons: the rules (assets/js/widgets/chess-rules.js, shared with the browser)
// and the server's checks on what the AI writes (server/widgets/chess.mjs).   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import R from '../assets/js/widgets/chess-rules.js';
import * as chess from '../server/widgets/chess.mjs';
import { normWidgetBlock, normTask, widgetKinds, widgetPrompt } from '../server/widgets.mjs';

const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const pos = (fen) => R.parseFEN(fen);
const after = (fen, line) => line.reduce((p, w) => { const m = R.parseMove(p, w); assert.ok(m, `${w} is legal`); return R.play(p, m); }, pos(fen));

// ------------------------------------------------------------------ move generation
const PERFT = [
  ['the start', R.START, [20, 400, 8902]],
  ['Kiwipete: castling, pins, promotions', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['en passant along a pinned rank', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['promotions and checks', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['promotion by capture, castling rights', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]]
];
for (const [name, fen, counts] of PERFT) {
  test(`perft: ${name}`, () => {
    const p = pos(fen);
    counts.forEach((n, d) => assert.equal(R.perft(p, d + 1), n, `depth ${d + 1}`));
  });
}

// ------------------------------------------------------------------ positions
test('FEN: read and written back the same', () => {
  for (const [, fen] of PERFT) assert.equal(R.toFEN(pos(fen)), fen);
  assert.equal(R.toFEN(pos('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq')), R.START, 'the counters may be left out');
  assert.equal(R.toFEN(after(R.START, ['e4'])), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
});

test('FEN: impossible positions are refused', () => {
  const bad = [
    '', 'hello', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1',
    'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',      // nine squares
    'rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',     // nine on a rank
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1',      // not a piece
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',      // no such side
    '4k3/8/8/8/8/8/8/8 w - - 0 1',                                    // no white king
    '4k3/8/8/8/8/8/8/3KK3 w - - 0 1',                                 // two white kings
    'P3k3/8/8/8/8/8/8/4K3 w - - 0 1',                                 // a pawn on the last rank
    '4k3/8/8/8/8/8/8/p3K3 w - - 0 1',                                 // a pawn on the first rank
    '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',                                // Black in check with White to move
    '3k4/3K4/8/8/8/8/8/8 w - - 0 1',                                  // kings touching
    'QQQQkQQQ/QQQQQQQQ/8/8/8/8/8/4K3 b - - 0 1'                       // far too many queens
  ];
  for (const fen of bad) assert.throws(() => pos(fen), Error, fen);
});

test('FEN: castling rights and en passant squares that do not fit are dropped', () => {
  assert.equal(pos('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1').castle, '');
  assert.equal(pos('r3k3/8/8/8/8/8/8/4K2R w KQkq - 0 1').castle, 'Kq');
  assert.equal(pos(R.START.replace('KQkq -', 'KQkq e6')).ep, -1, 'no pawn has just moved');
  assert.equal(R.sqName(pos('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3').ep), 'd6');
});

// ------------------------------------------------------------------ SAN and UCI
test('SAN: checks, mates, captures, castling, en passant and promotion', () => {
  const s = (fen, line, u) => { const p = typeof fen === 'string' ? pos(fen) : fen; const q = line.length ? after(R.toFEN(p), line) : p; return R.san(q, R.parseMove(q, u)); };
  assert.equal(s(R.START, [], 'g1f3'), 'Nf3');
  assert.equal(s(R.START, ['f3', 'e5', 'g4'], 'd8h4'), 'Qh4#');
  assert.equal(s(R.START, ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'], 'h5f7'), 'Qxf7#');
  assert.equal(s(R.START, ['e4', 'f5', 'Qh5'], 'g7g6'), 'g6');
  assert.equal(s(R.START, ['e4', 'f6', 'd4', 'g5'], 'd1h5'), 'Qh5#');
  assert.equal(s(R.START, ['e4', 'd5'], 'e4d5'), 'exd5');
  assert.equal(s(R.START, ['e4', 'a6', 'e5', 'd5'], 'e5d6'), 'exd6');
  const kiwi = pos(PERFT[1][1]);
  assert.equal(R.san(kiwi, R.parseMove(kiwi, 'e1g1')), 'O-O');
  assert.equal(R.san(kiwi, R.parseMove(kiwi, 'e1c1')), 'O-O-O');
  assert.equal(s('8/4P3/8/8/k7/8/8/4K3 w - - 0 1', [], 'e7e8q'), 'e8=Q+');
  assert.equal(s('8/4P3/8/8/k7/8/8/4K3 w - - 0 1', [], 'e7e8n'), 'e8=N');
  assert.equal(s(PERFT[4][1], [], 'd7c8q'), 'dxc8=Q');
});

test('SAN: a piece is named by file, rank or square only when another could go there too', () => {
  const two = after(R.START, ['Nf3', 'Nf6', 'd3', 'd6']);
  assert.equal(R.san(two, R.parseMove(two, 'b1d2')), 'Nbd2');
  assert.equal(R.san(two, R.parseMove(two, 'f3d2')), 'Nfd2');
  const rooks = pos('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
  assert.equal(R.san(rooks, R.parseMove(rooks, 'a1a3')), 'R1a3');
  assert.equal(R.san(rooks, R.parseMove(rooks, 'a5a3')), 'R5a3');
  const queens = pos('4k3/8/8/8/8/Q7/8/Q1Q1K3 w - - 0 1');
  assert.equal(R.san(queens, R.parseMove(queens, 'a1b2')), 'Qa1b2');
});

test('SAN and UCI: every legal move reads back as itself', () => {
  const fens = [R.START, ...PERFT.map(([, f]) => f), 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3', '8/4P3/8/8/k7/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/Q7/8/Q1Q1K3 w - - 0 1'];
  let n = 0;
  for (const fen of fens) {
    const p0 = pos(fen);
    for (const p of [p0, ...R.legal(p0).map((m) => R.play(p0, m))]) {
      for (const m of R.legal(p)) {
        assert.deepEqual(R.parseMove(p, R.san(p, m)), m, `${R.toFEN(p)} ${R.san(p, m)}`);
        assert.deepEqual(R.parseMove(p, R.uci(m)), m, `${R.toFEN(p)} ${R.uci(m)}`);
        n += 1;
      }
    }
  }
  assert.ok(n > 5000, `${n} moves read back`);
});

test('moves as people write them: long form, figurines, zeros, missing = and annotations', () => {
  const p = pos(R.START);
  for (const w of ['Nf3', 'Ng1f3', 'Ng1-f3', 'g1-f3', 'g1f3', 'N1f3', '♘f3', 'Nf3!', 'Nf3!?']) assert.equal(R.uci(R.parseMove(p, w)), 'g1f3', w);
  const kiwi = pos(PERFT[1][1]);
  for (const w of ['O-O', '0-0', 'o-o', 'e1g1', 'e1h1']) assert.equal(R.parseMove(kiwi, w).castle, 'K', w);
  for (const w of ['O-O-O', '0-0-0', 'e1c1']) assert.equal(R.parseMove(kiwi, w).castle, 'Q', w);
  const promo = pos('8/4P3/8/8/k7/8/8/4K3 w - - 0 1');
  for (const w of ['e8=Q+', 'e8Q', 'e8=Q', 'e7e8q', 'e8']) assert.equal(R.uci(R.parseMove(promo, w)), 'e7e8q', w);
  assert.equal(R.uci(R.parseMove(promo, 'e8=N')), 'e7e8n');
  const ep = pos('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
  assert.equal(R.parseMove(ep, 'exd6 e.p.').ep, true);
  for (const w of ['', 'Nf4', 'Ke2', 'e5', 'Qd4', 'O-O', 'z9', 'hello', 'e2e5', null]) assert.equal(R.parseMove(p, w), null, String(w));
  const two = after(R.START, ['Nf3', 'Nf6', 'd3', 'd6']);
  assert.equal(R.parseMove(two, 'Nd2'), null, 'two knights can go to d2');
  assert.deepEqual(R.words('1. e4 e5 2. Nf3 {a comment} Nc6 (2... d6) 3. Bb5 1-0', 20), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  assert.equal(R.sanLine(pos(R.START), ['e2e4', 'e7e5', 'g1f3']), '1. e4 e5 2. Nf3');
  assert.equal(R.sanLine(after(R.START, ['e4']), ['e7e5', 'g1f3']), '1... e5 2. Nf3');
});

// ------------------------------------------------------------------ the end of a game
test('checkmate, stalemate, check and dead positions', () => {
  assert.equal(R.status(after(R.START, ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])), 'checkmate');
  assert.equal(R.status(after(R.START, ['f3', 'e5', 'g4', 'Qh4#'])), 'checkmate');
  assert.equal(R.status(pos('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), 'stalemate');
  assert.equal(R.status(after(R.START, ['e4', 'f5', 'Qh5+'])), 'check');
  assert.equal(R.status(pos('8/8/4k3/8/8/3NK3/8/8 w - - 0 1')), 'material');
  assert.equal(R.status(pos('8/8/4k3/8/8/3RK3/8/8 w - - 0 1')), '');
  assert.equal(R.status(pos(R.START)), '');
});

test('mate in one and two: the moves that force it, and the defence the board plays', () => {
  const scholar = after(R.START, ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']);
  assert.deepEqual(R.mateMoves(scholar, 1).map(R.uci), ['h5f7']);
  assert.deepEqual(R.mateMoves(pos(R.START), 1), []);
  // two rooks: Ra7 (or Rb7) shuts the king in, then the other rook mates on the back rank
  const ladder = pos('7k/8/R7/1R6/8/8/8/3K4 w - - 0 1');
  assert.deepEqual(R.mateMoves(ladder, 1), []);
  const two = R.mateMoves(ladder, 2).map(R.uci);
  assert.ok(two.includes('a6a7') && two.includes('b5b7'), two.join(' '));
  assert.ok(!two.includes('b5b8'), 'Rb8+ lets the king out');
  // after a move that doesn't force mate, the board finds the escape
  const loose = R.play(ladder, R.parseMove(ladder, 'Rb8+'));
  const reply = R.defend(loose, 1);
  assert.ok(reply && R.mateMoves(R.play(loose, reply), 1).length === 0, 'the defence leaves no mate in one');
  // a stalemating move is no mate
  const stale = pos('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1');
  assert.ok(!R.mateMoves(stale, 2).some((m) => R.uci(m) === 'e7f7'), 'Qf7 is stalemate');
  assert.ok(R.mateMoves(stale, 1).some((m) => R.uci(m) === 'e7e8'), 'Qe8 is mate');
  assert.deepEqual(R.mateMoves(ladder, 3), [], 'only mate in one or two is searched');
});

// ------------------------------------------------------------------ what the AI writes
test('a board block: moves become UCI, the position after the setup a FEN, the rest checked', () => {
  const spec = chess.block({ setup: ['e4', 'e5', 'Nf3', 'Nc6'], moves: '3. Bb5 a6 4. Ba4 Nf6 5. O-O', arrows: [['f3', 'e5', 'red'], ['c6', 'e5']], highlight: 'e5' });
  assert.deepEqual(spec, {
    start: R.START,
    setup: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    moves: ['f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1'],
    orientation: 'white',
    arrows: [['f3', 'e5', 'r'], ['c6', 'e5', 'g']],
    highlight: ['e5'],
    play: true
  });
  assert.deepEqual(chess.block(spec), spec, 'a checked spec checks the same again');
  assert.deepEqual(chess.block(JSON.parse(JSON.stringify(spec))), spec);
  const fromFen = chess.block({ fen: '8/8/8/8/8/4k3/4p3/2K5 b - - 0 1', moves: ['Kf2', 'Kd2', 'e1=Q+'], orientation: 'black', play: false });
  assert.equal(fromFen.start, '8/8/8/8/8/4k3/4p3/2K5 b - - 0 1');
  assert.deepEqual(fromFen.moves, ['e3f2', 'c1d2', 'e2e1q']);
  assert.equal(fromFen.orientation, 'black');
  assert.equal(fromFen.play, false);
  assert.deepEqual(chess.block({}).moves, [], 'an empty spec is the starting position');
});

test('a board block that does not hold together is left out, with the reason', () => {
  quiet(() => {
    assert.equal(chess.block({ setup: ['e4', 'e5', 'Nf6'] }), null);
    assert.equal(chess.block({ setup: ['e4'], moves: ['e5', 'e5'] }), null);
    assert.equal(chess.block({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1' }), null);
    assert.equal(chess.block({ moves: ['f3', 'e5', 'g4', 'Qh4#', 'Kf2'] }), null, 'no move after mate');
    assert.equal(chess.block({ arrows: [['e2', 'e9']] }), null);
    assert.equal(chess.block({ arrows: [['e2', 'e4', 'purple']] }), null);
    assert.equal(chess.block({ highlight: ['x1'] }), null);
    assert.equal(chess.block({ fen: 42 }), null);
    assert.equal(chess.block('e4 e5'), null);
    assert.equal(chess.block({ moves: Array(61).fill(['Nf3', 'Nf6', 'Ng1', 'Ng8']).flat() }), null, 'too long');
  });
  assert.match(chess.explain({ setup: ['e4', 'e5', 'Nf6'] }), /setup move 3 \(Nf6\) is not legal/);
  assert.match(chess.explain({ moves: ['f3', 'e5', 'g4', 'Qh4#', 'Kf2'] }), /demo move 5 .*game is already over/);
  assert.equal(chess.explain({ setup: ['e4'] }), '');
});

test('tasks: find the move', () => {
  const t = chess.task({ setup: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6'] }, { type: 'move', best: ['Nxe5', 'Nxe5!'] });
  assert.deepEqual(t.goal, { type: 'move', best: ['f3e5'] });
  assert.equal(t.spec.orientation, 'white');
  assert.equal(t.spec.fen, 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5');
  const black = chess.task({ setup: ['e4'] }, { type: 'best', best: 'e5' });
  assert.equal(black.spec.orientation, 'black', 'the board turns to the side to move');
  assert.deepEqual(black.goal.best, ['e7e5']);
  quiet(() => {
    assert.equal(chess.task({ setup: ['e4'] }, { type: 'move', best: ['e4'] }), null, 'not legal for Black');
    assert.equal(chess.task({}, { type: 'move', best: [] }), null);
    assert.equal(chess.task({}, { type: 'move' }), null);
    assert.equal(chess.task({ moves: ['f3', 'e5', 'g4', 'Qh4#'], setup: ['f3', 'e5', 'g4', 'Qh4#'] }, { type: 'move', best: ['Kf2'] }), null, 'the game is over');
    assert.equal(chess.task({}, { type: 'dance', best: ['e4'] }), null);
  });
});

test('tasks: play the line, the board answering', () => {
  // the Legal trap: 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 5.Nxe5 Bxd1 6.Bxf7+ Ke7 7.Nd5#
  const spec = { setup: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6'] };
  const t = chess.task(spec, { type: 'line', moves: ['Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'] });
  assert.deepEqual(t.goal, { type: 'line', moves: ['f3e5', 'g4d1', 'c4f7', 'e8e7', 'c3d5'] });
  const even = chess.task(spec, { type: 'sequence', moves: '5. Nxe5 Bxd1 6. Bxf7+ Ke7' });
  assert.deepEqual(even.goal.moves, ['f3e5', 'g4d1', 'c4f7'], 'a line ends on the learner’s move');
  quiet(() => assert.equal(chess.task(spec, { type: 'line', moves: ['Nxe5', 'Bxd1', 'Bxf7+', 'Kd7', 'Nd5#'] }), null, 'Kd7 is not legal'));
});

test('tasks: mate in one or two, checked to be a real mate', () => {
  const scholar = { setup: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'] };
  assert.deepEqual(chess.task(scholar, { type: 'mate', n: 1 }).goal, { type: 'mate', n: 1, best: ['h5f7'], line: ['h5f7'] });
  const ladder = chess.task({ fen: '7k/8/R7/1R6/8/8/8/3K4 w - - 0 1' }, { type: 'checkmate', n: 2, best: ['Rb7'] });
  assert.equal(ladder.goal.n, 2);
  assert.ok(ladder.goal.best.includes('a6a7'));
  assert.equal(ladder.goal.line[0], 'b5b7', 'the AI’s own key move, as it is one');
  assert.equal(ladder.goal.line.length, 3);
  assert.equal(R.status(after(ladder.spec.fen, ladder.goal.line)), 'checkmate', 'the main line ends in mate');
  quiet(() => {
    assert.equal(chess.task({ setup: ['e4', 'e5'] }, { type: 'mate', n: 1 }), null, 'no mate here');
    assert.equal(chess.task({ fen: '7k/8/R7/1R6/8/8/8/3K4 w - - 0 1' }, { type: 'mate', n: 1 }), null, 'mate in two is not mate in one');
    assert.equal(chess.task(scholar, { type: 'mate', n: 3 }), null);
  });
  assert.match(chess.explain({ setup: ['e4', 'e5'] }, { type: 'mate', n: 1 }), /no mate in 1 for white/);
});

test('tasks: tap the squares, named or worked out from a piece', () => {
  assert.deepEqual(chess.task({}, { type: 'square', from: 'g1' }).goal, { type: 'square', squares: ['f3', 'h3'], from: 'g1' });
  assert.deepEqual(chess.task({}, { type: 'square', from: 'g1', squares: ['h3', 'f3'] }).goal.squares, ['f3', 'h3']);
  assert.deepEqual(chess.task({ setup: ['e4'] }, { type: 'square', from: 'f1' }).goal.squares, ['a6', 'b5', 'c4', 'd3', 'e2'], 'a white piece while Black is to move');
  assert.deepEqual(chess.task({}, { type: 'squares', squares: 'e4 d4 e5 d5' }).goal.squares, ['d4', 'd5', 'e4', 'e5']);
  quiet(() => {
    assert.equal(chess.task({ fen: '4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1' }, { type: 'square', from: 'e2' }), null, 'a pinned knight has nowhere to go');
    assert.equal(chess.task({}, { type: 'square', from: 'z9' }), null);
    assert.equal(chess.task({}, { type: 'square', from: 'g1', squares: ['f3', 'e2'] }), null, 'the AI’s squares are wrong');
    assert.equal(chess.task({}, { type: 'square', from: 'e4' }), null, 'no piece there');
    assert.equal(chess.task({}, { type: 'square', from: 'a1' }), null, 'the rook can’t move');
    assert.equal(chess.task({}, { type: 'square' }), null);
  });
});

test('a checked task checks the same again (the browser checks what the server kept)', () => {
  const cases = [
    [{ setup: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6'], arrows: ['f3e5'] }, { type: 'line', moves: ['Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'] }],
    [{ fen: '7k/8/R7/1R6/8/8/8/3K4 w - - 0 1', orientation: 'black' }, { type: 'mate', n: 2 }],
    [{ setup: 'e4 e5' }, { type: 'move', best: ['Nf3', 'Nc3', 'd4'] }],
    [{ highlight: ['b1'] }, { type: 'square', from: 'b1' }]
  ];
  for (const [spec, goal] of cases) {
    const once = chess.task(spec, goal);
    assert.ok(once, chess.explain(spec, goal));
    assert.deepEqual(chess.task(JSON.parse(JSON.stringify(once.spec)), JSON.parse(JSON.stringify(once.goal))), once);
  }
});

test('the core takes chess blocks and tasks through this module', () => {
  const b = normWidgetBlock({ t: 'widget', kind: 'chess', spec: { setup: 'e4 e5' }, caption: 'Both sides take the centre.' });
  assert.equal(b.kind, 'chess');
  assert.deepEqual(b.spec.setup, ['e2e4', 'e7e5']);
  const q = normTask({ type: 'task', kind: 'chess', spec: {}, goal: { type: 'square', from: 'b1' } }, { prompt: 'Where can the knight go?', hint: '', explain: '' });
  assert.deepEqual(q.goal.squares, ['a3', 'c3']);
  quiet(() => assert.equal(normWidgetBlock({ t: 'widget', kind: 'chess', spec: { setup: 'e4 e4' } }), null));
  assert.ok(widgetPrompt(['chess']).includes('"kind": "chess"'));
});

test('the examples in the prompt are themselves legal', () => {
  const blockJSON = /Example block: (\{.*\})$/m.exec(chess.prompt)[1];
  const taskJSON = /Example task: (\{.*\})$/m.exec(chess.prompt)[1];
  const b = JSON.parse(blockJSON), t = JSON.parse(taskJSON);
  assert.ok(chess.block(b.spec), chess.explain(b.spec));
  assert.ok(chess.task(t.spec, t.goal), chess.explain(t.spec, t.goal));
  assert.ok(chess.prompt.length < 4000, `the prompt is short (${chess.prompt.length} characters)`);
});

test('the positions the prompt calls right are right, and each one in it is tested', () => {
  for (const [what, spec, line] of chess.KNOWN) {
    const b = chess.block({ ...spec, moves: line });
    assert.ok(b, `${what}: ${chess.explain({ ...spec, moves: line })}`);
    // a piece list is written in the prompt as JSON with a space after each colon and comma
    const written = spec.pieces ? JSON.stringify(spec.pieces).replace(/":/g, '": ').replace(/,/g, ', ') : spec.setup || spec.fen;
    assert.ok(chess.prompt.includes(written), `${what} is in the prompt as tested`);
    if (/#$/.test(line)) assert.equal(R.status(after(b.fen, b.moves)), 'checkmate', what);
  }
  assert.equal((chess.prompt.match(/pieces {/g) || []).length, chess.KNOWN.filter(([, s]) => s.pieces).length, 'every piece list in the prompt is tested');
  assert.equal(chess.prompt.match(/setup "/g).length, chess.KNOWN.filter(([, s]) => s.setup).length, 'every setup in the prompt is tested');
});

test('a position can be written piece by piece, and a wrong one says what is wrong', () => {
  const b = chess.block({ pieces: { white: ['Kf6', 'Qg1'], black: ['Kh8'] } });
  assert.equal(b.fen, '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1');
  assert.equal(chess.block({ pieces: { white: 'Kf6, Qg1', black: ['Kh8'] }, turn: 'black' }).fen, '7k/8/5K2/8/8/8/8/6Q1 b - - 0 1');
  assert.match(chess.explain({ pieces: { white: ['Ke1'], black: ['e7'] } }), /each side needs exactly one king/);
  assert.match(chess.explain({ pieces: { white: ['Ke1', 'Qe7'], black: ['Ke8'] } }), /side not to move is in check/);
  assert.match(chess.explain({ pieces: { white: ['Ke1', 'Ke1'], black: ['Ke8'] } }), /two pieces are on e1/);
  assert.match(chess.explain({ pieces: { white: ['Kx9'], black: ['Ke8'] } }), /isn't a piece and a square/);
  // a checked spec keeps its FEN: the list is only how the AI writes it
  assert.equal(chess.block(b).fen, b.fen);
});

test('which lessons are offered a board: chess, in the languages Primer serves', () => {
  const yes = [
    'chess for beginners', 'the queen’s gambit declined', 'checkmate patterns', 'knight\'s tour puzzles', 'how to play chess openings',
    'शतरंज की शुरुआत', 'शतरंज', 'बुद्धिबळ खेळ', 'சதுரங்கம் கற்போம்', 'দাবা খেলার নিয়ম', 'দাবার চাল', 'चेस खेलना सीखें',
    'చదరంగం ఆట', 'ಚದುರಂಗ ಆಟ', 'ചെസ്സ് കളി', 'ajedrez para principiantes', 'les règles des échecs', 'jeu d\'échecs', 'aux échecs, le roque',
    'xadrez para iniciantes', 'шахматы для начинающих', 'الشطرنج للمبتدئين', 'ਸ਼ਤਰੰਜ', 'શતરંજ', 'ଶତରଞ୍ଜ', 'شطرنج سیکھیں', 'dasa schach-spiel', 'scacchi', 'satranç',
    'les échecs pour débutants \n le roque', 'stalemate: when the king has no move but is not attacked by a pawn or rook'
  ];
  for (const s of yes) assert.ok(chess.match(s.toLowerCase()), s);
  const no = [
    'photosynthesis', 'a political stalemate', 'bona fide contracts', 'mentioned en passant', 'les échecs scolaires', 'the opening of a business',
    'দাবানল ও জলবায়ু', 'মাথা দাবানো', 'chassis design', 'चेसिस का डिज़ाइन', 'a gambit in diplomacy', 'manchester history', 'castles of rajasthan', 'king and queen of england'
  ];
  for (const s of no) assert.ok(!chess.match(s.toLowerCase()), s);
  assert.deepEqual(widgetKinds({ topic: 'Chess openings', title: 'The Italian Game' }).filter((k) => k === 'chess'), ['chess']);
  assert.deepEqual(widgetKinds({ topic: 'World history', title: 'The French Revolution' }).filter((k) => k === 'chess'), []);
});
