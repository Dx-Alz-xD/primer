/* =====================================================================
   The rules of chess, for the chess board in lessons. One file, used in
   two places: the server checks every board the AI writes with it
   (server/widgets/chess.mjs), and the browser plays on it
   (assets/js/widgets/chess.js), so both agree on every move.

   Positions
     parseFEN(fen) -> position          throws Error(reason) if it can't be
                                        a real position (two white kings, a
                                        pawn on the back rank, the side not
                                        to move in check, ...); castling
                                        rights and an en passant square that
                                        don't fit the board are dropped
     toFEN(position) -> fen
     A position is plain data: { b: [64 pieces, a1 = 0 … h8 = 63, '' for
     an empty square, 'P' 'N' 'B' 'R' 'Q' 'K' white, lower case black],
     turn: 'w'|'b', castle: 'KQkq' or part of it, ep: square index or -1,
     half, full }.

   Moves
     legal(pos) -> [move]               every legal move
     pseudo(pos) -> [move]              the same, before ruling out those that
                                        leave the king in check
     play(pos, move) -> position        a new position (pos is untouched)
     move = { from, to, piece, cap, promo, ep, castle } (indexes, letters)
     parseMove(pos, text) -> move|null  UCI (g1f3, e7e8q), SAN (Nf3, exd5,
                                        O-O, e8=Q+) or long form (Ng1-f3)
     san(pos, move) -> 'Nf3'            for display
     uci(move) -> 'g1f3'
     status(pos) -> 'checkmate' | 'stalemate' | 'material' | 'check' | ''
     mateMoves(pos, n) -> [move]        the moves that force mate in n or
                                        fewer (n = 1 or 2)
     defend(pos, n) -> move|null        the reply that best resists mate
                                        in n by the other side
     perft(pos, depth) -> number        move-path count, for testing

   Lesson specs (the same checks on the server and in the browser)
     normBlock(spec, why?) -> spec|null
     normTask(spec, goal, why?) -> { spec, goal }|null
     why: an optional array that gets the reason when null is returned.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerChessRules = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const FILES = 'abcdefgh';
  const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
  const sqIndex = (s) => (typeof s === 'string' && /^[a-h][1-8]$/.test(s) ? (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97) : -1);
  const colorOf = (p) => (p ? (p < 'a' ? 'w' : 'b') : '');
  const typeOf = (p) => (p ? p.toLowerCase() : '');
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const fail = (reason) => { throw new Error(reason); };

  // ---------------------------------------------------------------- geometry
  const at = (i, df, dr) => {
    const f = (i & 7) + df, r = (i >> 3) + dr;
    return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
  };
  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const jumps = (dirs) => Array.from({ length: 64 }, (_, i) => dirs.map(([df, dr]) => at(i, df, dr)).filter((x) => x >= 0));
  const rays = (dirs) => Array.from({ length: 64 }, (_, i) => dirs.map(([df, dr]) => {
    const out = [];
    for (let j = at(i, df, dr); j >= 0; j = at(j, df, dr)) out.push(j);
    return out;
  }).filter((r) => r.length));
  const N_JUMPS = jumps(KNIGHT), K_JUMPS = jumps(KING), O_RAYS = rays(ORTHO), D_RAYS = rays(DIAG);

  // is square sq attacked by a piece of colour by?
  function attacked(b, sq, by) {
    const w = by === 'w';
    const pawn = w ? 'P' : 'p', knight = w ? 'N' : 'n', king = w ? 'K' : 'k';
    const rook = w ? 'R' : 'r', bishop = w ? 'B' : 'b', queen = w ? 'Q' : 'q';
    const pr = w ? -1 : 1; // a white pawn attacks from the rank below
    const p1 = at(sq, -1, pr), p2 = at(sq, 1, pr);
    if ((p1 >= 0 && b[p1] === pawn) || (p2 >= 0 && b[p2] === pawn)) return true;
    for (const j of N_JUMPS[sq]) if (b[j] === knight) return true;
    for (const j of K_JUMPS[sq]) if (b[j] === king) return true;
    for (const ray of O_RAYS[sq]) {
      for (const j of ray) { const p = b[j]; if (p) { if (p === rook || p === queen) return true; break; } }
    }
    for (const ray of D_RAYS[sq]) {
      for (const j of ray) { const p = b[j]; if (p) { if (p === bishop || p === queen) return true; break; } }
    }
    return false;
  }
  const kingOf = (b, c) => b.indexOf(c === 'w' ? 'K' : 'k');
  // is the side to move (or colour c) in check?
  const inCheck = (pos, c = pos.turn) => { const k = kingOf(pos.b, c); return k >= 0 && attacked(pos.b, k, other(c)); };

  // ---------------------------------------------------------------- FEN
  const PIECES = 'PNBRQKpnbrqk';

  function parseFEN(fen) {
    const parts = String(fen == null ? '' : fen).trim().split(/\s+/);
    if (!parts[0] || parts.length > 6) fail('not a FEN');
    const rows = parts[0].split('/');
    if (rows.length !== 8) fail('a FEN needs 8 ranks');
    const b = new Array(64).fill('');
    rows.forEach((row, ri) => {
      const r = 7 - ri;
      let f = 0;
      for (const ch of row) {
        if (/[1-8]/.test(ch)) f += Number(ch);
        else if (PIECES.includes(ch)) { if (f > 7) fail(`rank ${r + 1} has more than 8 squares`); b[r * 8 + f] = ch; f += 1; } else fail(`"${ch}" is not a piece`);
        if (f > 8) fail(`rank ${r + 1} has more than 8 squares`);
      }
      if (f !== 8) fail(`rank ${r + 1} has ${f} squares, not 8`);
    });
    const turn = (parts[1] || 'w').toLowerCase();
    if (turn !== 'w' && turn !== 'b') fail('the side to move must be w or b');
    const cs = parts[2] || '-';
    if (!/^(-|K?Q?k?q?)$/.test(cs)) fail('bad castling field');
    const eps = parts[3] || '-';
    if (eps !== '-' && !/^[a-h][36]$/.test(eps)) fail('bad en passant field');
    const half = parts[4] == null ? 0 : Number(parts[4]);
    const full = parts[5] == null ? 1 : Number(parts[5]);
    if (!Number.isInteger(half) || half < 0 || half > 999) fail('bad halfmove clock');
    if (!Number.isInteger(full) || full < 0 || full > 9999) fail('bad move number');
    const pos = { b, turn, castle: cs === '-' ? '' : cs, ep: eps === '-' ? -1 : sqIndex(eps), half, full: Math.max(1, full) };
    checkPosition(pos);
    return pos;
  }

  // A position that could happen in a game, as far as is cheap to tell; fixes castling and en passant.
  function checkPosition(pos) {
    const b = pos.b;
    const count = (p) => b.reduce((n, x) => n + (x === p ? 1 : 0), 0);
    if (count('K') !== 1 || count('k') !== 1) fail('each side needs exactly one king');
    for (let f = 0; f < 8; f++) if (typeOf(b[f]) === 'p' || typeOf(b[56 + f]) === 'p') fail('a pawn cannot stand on the first or last rank');
    for (const c of ['w', 'b']) {
      const up = (p) => (c === 'w' ? p.toUpperCase() : p);
      const pawns = count(up('p'));
      const all = b.filter((x) => colorOf(x) === c).length;
      const extra = Math.max(0, count(up('q')) - 1) + Math.max(0, count(up('r')) - 2) + Math.max(0, count(up('b')) - 2) + Math.max(0, count(up('n')) - 2);
      if (pawns > 8 || all > 16 || extra > 8 - pawns) fail(`${c === 'w' ? 'White' : 'Black'} has too many pieces`);
    }
    if (inCheck(pos, other(pos.turn))) fail('the side not to move is in check');
    const k = kingOf(b, pos.turn), them = other(pos.turn);
    let checkers = 0;
    for (let i = 0; i < 64; i++) if (colorOf(b[i]) === them && attacksSquare(b, i, k)) checkers += 1;
    if (checkers > 2) fail('the king is in check from more than two pieces');
    // castling rights only where king and rook are still at home
    pos.castle = [...pos.castle].filter((r) => {
      if (r === 'K') return b[4] === 'K' && b[7] === 'R';
      if (r === 'Q') return b[4] === 'K' && b[0] === 'R';
      if (r === 'k') return b[60] === 'k' && b[63] === 'r';
      return b[60] === 'k' && b[56] === 'r';
    }).join('');
    // an en passant square only right behind a pawn that has just moved two squares
    if (pos.ep >= 0) {
      const w = pos.turn === 'w';
      const ok = (pos.ep >> 3) === (w ? 5 : 2) && !b[pos.ep] && !b[at(pos.ep, 0, w ? 1 : -1)] && b[at(pos.ep, 0, w ? -1 : 1)] === (w ? 'p' : 'P');
      if (!ok) pos.ep = -1;
    }
    return pos;
  }

  // does the piece on square i attack square t (on board b)?
  function attacksSquare(b, i, t) {
    const p = b[i], c = colorOf(p), kind = typeOf(p);
    if (kind === 'p') return at(i, -1, c === 'w' ? 1 : -1) === t || at(i, 1, c === 'w' ? 1 : -1) === t;
    if (kind === 'n') return N_JUMPS[i].includes(t);
    if (kind === 'k') return K_JUMPS[i].includes(t);
    const sets = kind === 'r' ? O_RAYS : kind === 'b' ? D_RAYS : null;
    const check = (rs) => rs[i].some((ray) => { for (const j of ray) { if (j === t) return true; if (b[j]) return false; } return false; });
    return sets ? check(sets) : check(O_RAYS) || check(D_RAYS);
  }

  function toFEN(pos) {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = pos.b[r * 8 + f];
        if (!p) { empty += 1; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
      rows.push(row + (empty || ''));
    }
    return `${rows.join('/')} ${pos.turn} ${pos.castle || '-'} ${pos.ep >= 0 ? sqName(pos.ep) : '-'} ${pos.half} ${pos.full}`;
  }

  // ---------------------------------------------------------------- moves
  const mv = (from, to, piece, cap, extra) => Object.assign({ from, to, piece, cap: cap || '', promo: '', ep: false, castle: '' }, extra);

  // every move that obeys how the pieces move, before checking the king is safe
  function pseudo(pos) {
    const { b, turn } = pos;
    const out = [];
    const w = turn === 'w';
    const enemy = (p) => p && colorOf(p) !== turn;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || colorOf(p) !== turn) continue;
      const kind = typeOf(p);
      if (kind === 'p') {
        const dr = w ? 1 : -1, last = w ? 7 : 0, home = w ? 1 : 6;
        const push = (to, cap, extra) => {
          if ((to >> 3) === last) for (const pr of 'qrbn') out.push(mv(i, to, p, cap, { promo: pr }));
          else out.push(mv(i, to, p, cap, extra));
        };
        const one = at(i, 0, dr);
        if (one >= 0 && !b[one]) {
          push(one, '');
          const two = at(one, 0, dr);
          if ((i >> 3) === home && two >= 0 && !b[two]) out.push(mv(i, two, p, '', {}));
        }
        for (const df of [-1, 1]) {
          const t = at(i, df, dr);
          if (t < 0) continue;
          if (enemy(b[t])) push(t, b[t]);
          else if (t === pos.ep) out.push(mv(i, t, p, w ? 'p' : 'P', { ep: true }));
        }
      } else if (kind === 'n' || kind === 'k') {
        for (const t of (kind === 'n' ? N_JUMPS : K_JUMPS)[i]) if (!b[t] || enemy(b[t])) out.push(mv(i, t, p, b[t]));
        if (kind === 'k') castles(pos, i, out);
      } else {
        const sets = kind === 'r' ? [O_RAYS] : kind === 'b' ? [D_RAYS] : [O_RAYS, D_RAYS];
        for (const rs of sets) for (const ray of rs[i]) {
          for (const t of ray) {
            if (!b[t]) { out.push(mv(i, t, p, '')); continue; }
            if (enemy(b[t])) out.push(mv(i, t, p, b[t]));
            break;
          }
        }
      }
    }
    return out;
  }

  function castles(pos, k, out) {
    const { b, turn, castle } = pos;
    const w = turn === 'w', home = w ? 4 : 60, them = other(turn);
    if (k !== home || !castle) return;
    const free = (...sqs) => sqs.every((s) => !b[s]);
    const safe = (...sqs) => sqs.every((s) => !attacked(b, s, them));
    if (castle.includes(w ? 'K' : 'k') && b[home + 3] === (w ? 'R' : 'r') && free(home + 1, home + 2) && safe(home, home + 1, home + 2)) {
      out.push(mv(home, home + 2, b[home], '', { castle: 'K' }));
    }
    if (castle.includes(w ? 'Q' : 'q') && b[home - 4] === (w ? 'R' : 'r') && free(home - 1, home - 2, home - 3) && safe(home, home - 1, home - 2)) {
      out.push(mv(home, home - 2, b[home], '', { castle: 'Q' }));
    }
  }

  const RIGHTS = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' };

  function play(pos, m) {
    const b = pos.b.slice();
    const w = pos.turn === 'w';
    b[m.to] = m.promo ? (w ? m.promo.toUpperCase() : m.promo) : b[m.from];
    b[m.from] = '';
    if (m.ep) b[at(m.to, 0, w ? -1 : 1)] = '';
    if (m.castle) {
      const [rf, rt] = m.castle === 'K' ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      b[rt] = b[rf];
      b[rf] = '';
    }
    let castle = pos.castle;
    if (castle) {
      if (typeOf(m.piece) === 'k') castle = castle.replace(w ? /[KQ]/g : /[kq]/g, '');
      for (const s of [m.from, m.to]) if (RIGHTS[s]) castle = castle.replace(RIGHTS[s], '');
    }
    const double = typeOf(m.piece) === 'p' && Math.abs(m.to - m.from) === 16;
    return {
      b,
      turn: other(pos.turn),
      castle,
      ep: double ? (m.from + m.to) / 2 : -1,
      half: typeOf(m.piece) === 'p' || m.cap ? 0 : pos.half + 1,
      full: pos.full + (w ? 0 : 1)
    };
  }

  const legal = (pos) => pseudo(pos).filter((m) => !inCheck(play(pos, m), pos.turn));
  const hasLegal = (pos) => pseudo(pos).some((m) => !inCheck(play(pos, m), pos.turn));

  // not enough pieces left for either side to mate: K v K, K+minor v K, K+B v K+B on one colour
  function material(pos) {
    const left = [];
    pos.b.forEach((p, i) => { if (p && typeOf(p) !== 'k') left.push([typeOf(p), i]); });
    if (!left.length) return true;
    if (left.some(([k]) => k === 'p' || k === 'r' || k === 'q')) return false;
    if (left.length === 1) return true;
    const shade = (i) => ((i >> 3) + (i & 7)) % 2;
    return left.every(([k]) => k === 'b') && new Set(left.map(([, i]) => shade(i))).size === 1;
  }

  function status(pos) {
    const check = inCheck(pos);
    if (!hasLegal(pos)) return check ? 'checkmate' : 'stalemate';
    if (material(pos)) return 'material';
    return check ? 'check' : '';
  }

  const uci = (m) => sqName(m.from) + sqName(m.to) + (m.promo || '');

  function san(pos, m, moves) {
    let s;
    if (m.castle) s = m.castle === 'K' ? 'O-O' : 'O-O-O';
    else if (typeOf(m.piece) === 'p') {
      s = (m.cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    } else {
      s = m.piece.toUpperCase();
      const rivals = (moves || legal(pos)).filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      if (rivals.length) {
        if (!rivals.some((o) => (o.from & 7) === (m.from & 7))) s += FILES[m.from & 7];
        else if (!rivals.some((o) => (o.from >> 3) === (m.from >> 3))) s += String((m.from >> 3) + 1);
        else s += sqName(m.from);
      }
      s += (m.cap ? 'x' : '') + sqName(m.to);
    }
    const after = play(pos, m);
    if (inCheck(after)) s += hasLegal(after) ? '+' : '#';
    return s;
  }

  const FIGURINES = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': '', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♟': '' };

  // a move written as UCI, SAN or long algebraic; null if it isn't one legal move here
  function parseMove(pos, text, moves) {
    if (text && typeof text === 'object' && Number.isInteger(text.from)) text = uci(text);
    let s = String(text == null ? '' : text).trim();
    if (!s || s.length > 16) return null;
    s = s.replace(/[♔♕♖♗♘♙♚♛♜♝♞♟]/g, (c) => FIGURINES[c]);
    s = s.replace(/\s*(e\.?\s?p\.?)$/i, '').replace(/[!?]+$/, '').replace(/[+#‡†]+$/, '').replace(/[!?]+$/, '').trim();
    const all = moves || legal(pos);
    if (/^[O0o]-?[O0o]-?[O0o]$/.test(s)) return all.find((m) => m.castle === 'Q') || null;
    if (/^[O0o]-?[O0o]$/.test(s)) return all.find((m) => m.castle === 'K') || null;
    let g = /^([a-h][1-8])-?([a-h][1-8])=?\(?([qrbnQRBN])?\)?$/.exec(s) || /^[KQRBN]([a-h][1-8])[-x:]([a-h][1-8])=?\(?([QRBNqrbn])?\)?$/.exec(s);
    if (g) {
      const from = sqIndex(g[1]), to = sqIndex(g[2]), promo = (g[3] || '').toLowerCase();
      let found = all.filter((m) => m.from === from && m.to === to);
      // a king taking its own rook means castling, as some programs write it
      if (!found.length && typeOf(pos.b[from]) === 'k' && pos.b[to] === (pos.turn === 'w' ? 'R' : 'r')) {
        found = all.filter((m) => m.from === from && m.castle === (to > from ? 'K' : 'Q'));
      }
      if (found.length > 1) found = found.filter((m) => m.promo === (promo || 'q'));
      return found.length === 1 ? found[0] : null;
    }
    g = /^([KQRBN])?([a-h])?([1-8])?[x:]?([a-h][1-8])(?:=?\(?([QRBNqrbn])\)?)?$/.exec(s);
    if (!g) return null;
    const kind = (g[1] || 'P').toLowerCase(), ff = g[2], fr = g[3], to = sqIndex(g[4]), promo = (g[5] || '').toLowerCase();
    let found = all.filter((m) => typeOf(m.piece) === kind && m.to === to && !m.castle &&
      (!ff || FILES[m.from & 7] === ff) && (!fr || String((m.from >> 3) + 1) === fr));
    if (found.length > 1 && found.every((m) => m.promo)) found = found.filter((m) => m.promo === (promo || 'q'));
    else if (promo) found = found.filter((m) => m.promo === promo);
    return found.length === 1 ? found[0] : null;
  }

  // ---------------------------------------------------------------- mates
  const mates = (pos, m) => { const a = play(pos, m); return inCheck(a) && !hasLegal(a); };
  const mateIn1 = (pos) => legal(pos).filter((m) => mates(pos, m));
  const hasMateIn1 = (pos) => legal(pos).some((m) => mates(pos, m));

  function mateMoves(pos, n) {
    if (n <= 1) return mateIn1(pos);
    if (n !== 2) return [];
    return legal(pos).filter((m) => {
      const a = play(pos, m);
      const replies = legal(a);
      if (!replies.length) return inCheck(a); // mate at once; stalemate is no mate
      return replies.every((r) => hasMateIn1(play(a, r)));
    });
  }

  // pos: the defender to move. The reply after which the attacker has no mate in n left, if there is one;
  // otherwise the one that leaves the fewest mating moves. null when the defender has no move.
  function defend(pos, n) {
    const replies = legal(pos);
    if (!replies.length) return null;
    let best = null, fewest = Infinity;
    for (const r of replies) {
      const k = n >= 1 ? mateMoves(play(pos, r), n).length : 0;
      if (k === 0) return r;
      if (k < fewest) { fewest = k; best = r; }
    }
    return best;
  }

  function perft(pos, depth) {
    if (depth <= 0) return 1;
    const ms = legal(pos);
    if (depth === 1) return ms.length;
    let n = 0;
    for (const m of ms) n += perft(play(pos, m), depth - 1);
    return n;
  }

  // ---------------------------------------------------------------- lines of moves
  // moves as the AI writes them: an array, or one string ("1. e4 e5 2. Nf3"), move numbers and results dropped
  function words(v, max) {
    let list;
    if (Array.isArray(v)) list = v.map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : x && typeof x === 'object' && typeof x.san === 'string' ? x.san : x && typeof x === 'object' && typeof x.uci === 'string' ? x.uci : ''));
    else if (typeof v === 'string') list = [v];
    else return [];
    const out = [];
    for (const item of list) {
      for (let w of String(item).replace(/\{[^}]*\}|\([^)]*\)/g, ' ').split(/[\s,;]+/)) {
        w = w.replace(/^\d+\.+/, '').trim();
        if (!w || /^(\d+\.*|\.\.\.|…|1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(w)) continue;
        out.push(w);
        if (out.length > max) return out;
      }
    }
    return out;
  }

  // plays moves from pos; throws with the first one that isn't legal
  function playLine(pos, list, what) {
    const ucis = [];
    let p = pos;
    list.forEach((w, k) => {
      const m = parseMove(p, w);
      if (!m) {
        const st = status(p);
        fail(`${what} move ${k + 1} (${String(w).slice(0, 12)}) is not legal${st === 'checkmate' || st === 'stalemate' ? ` — the game is already over (${st})` : ` for ${p.turn === 'w' ? 'White' : 'Black'} in ${toFEN(p)}`}`);
      }
      ucis.push(uci(m));
      p = play(p, m);
    });
    return { ucis, pos: p };
  }

  // SAN for a line from pos, numbered: "1. e4 e5 2. Nf3", or "3... Nc6 4. Bb5"
  function sanLine(pos, ucis, numbered = true) {
    const out = [];
    let p = pos;
    for (let k = 0; k < (ucis || []).length; k++) {
      const m = parseMove(p, ucis[k]);
      if (!m) break;
      const s = san(p, m);
      if (numbered && p.turn === 'w') out.push(`${p.full}. ${s}`);
      else if (numbered && k === 0) out.push(`${p.full}... ${s}`);
      else out.push(s);
      p = play(p, m);
    }
    return out.join(' ');
  }

  // ---------------------------------------------------------------- lesson specs
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const MAX_SETUP = 80, MAX_DEMO = 60, MAX_LINE = 15;

  // A position written piece by piece, which a model gets right far more often than a FEN:
  //   { "white": ["Kg1", "Rd1", "f2"], "black": ["Kg8", "f7"] }   a pawn may be just its square; the
  // piece letter is always a capital (K Q R B N P), the side comes from the list it is in.
  function fenFromPieces(pieces, turn) {
    if (!isObj(pieces)) fail('"pieces" must be {"white": ["Ke1", ...], "black": ["Ke8", ...]}');
    const board = Array(64).fill('');
    for (const side of ['white', 'black']) {
      let list = pieces[side] != null ? pieces[side] : pieces[side[0]];
      if (typeof list === 'string') list = list.split(/[\s,;]+/).filter(Boolean);
      if (!Array.isArray(list) || !list.length) fail(`"pieces" needs a "${side}" list, like ["Ke1", "Qd1", "e2"]`);
      if (list.length > 16) fail(`${side} has more than 16 pieces`);
      for (const w of list) {
        const g = /^\s*([KQRBNP])?\s*([a-h][1-8])\s*$/.exec(String(w));
        if (!g) fail(`"${String(w).slice(0, 12)}" in the ${side} pieces isn't a piece and a square, like "Ke1" or "e4"`);
        const i = sqIndex(g[2]);
        if (board[i]) fail(`two pieces are on ${g[2]}`);
        const letter = g[1] || 'P';
        board[i] = side === 'white' ? letter : letter.toLowerCase();
      }
    }
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const c = board[r * 8 + f];
        if (!c) { empty++; continue; }
        if (empty) row += empty;
        empty = 0;
        row += c;
      }
      rows.push(row + (empty || ''));
    }
    return `${rows.join('/')} ${/^b/i.test(String(turn || 'w').trim()) ? 'b' : 'w'} - - 0 1`;
  }

  // the position a spec describes: from "start" (a checked spec), "pieces" or "fen" (as the AI writes it), then "setup"
  function position(spec) {
    let given = spec.start != null ? spec.start : spec.fen != null ? spec.fen : spec.position;
    if (given != null && typeof given !== 'string') fail('the FEN must be a string');
    given = String(given || '').trim();
    const listed = spec.start == null && spec.pieces != null;
    const fen = listed ? fenFromPieces(spec.pieces, spec.turn != null ? spec.turn : spec.to_move)
      : !given || /^(start|startpos|initial|standard|new game)$/i.test(given) ? START : given;
    let start;
    try { start = parseFEN(fen); } catch (err) { fail(listed ? `bad position (${fen.split(' ')[0]}): ${err.message}` : `bad FEN: ${err.message}`); }
    const list = words(spec.setup, MAX_SETUP);
    if (list.length > MAX_SETUP) fail(`more than ${MAX_SETUP} setup moves`);
    const { ucis, pos } = playLine(start, list, 'setup');
    return { start: toFEN(start), setup: ucis, pos, fen: toFEN(pos) };
  }

  const COLORS = { g: 'g', green: 'g', r: 'r', red: 'r', y: 'y', yellow: 'y', gold: 'y', orange: 'y', o: 'y', b: 'b', blue: 'b' };
  function arrows(v) {
    if (v == null) return [];
    const list = Array.isArray(v) ? v : [v];
    const out = [];
    for (const a of list.slice(0, 24)) {
      let from, to, color;
      if (typeof a === 'string') {
        const g = /^\s*([a-h][1-8])\s*[-–>x ]*\s*([a-h][1-8])\s*(\w+)?\s*$/i.exec(a);
        if (!g) fail(`bad arrow "${a.slice(0, 20)}"`);
        [from, to, color] = [g[1], g[2], g[3]];
      } else if (Array.isArray(a)) {
        if (a.length === 1 && typeof a[0] === 'string' && /^[a-h][1-8][a-h][1-8]$/.test(a[0])) [from, to] = [a[0].slice(0, 2), a[0].slice(2)];
        else [from, to, color] = a;
      } else if (isObj(a)) ({ from, to, color } = a);
      else fail('bad arrow');
      from = String(from || '').toLowerCase(); to = String(to || '').toLowerCase();
      if (sqIndex(from) < 0 || sqIndex(to) < 0 || from === to) fail('an arrow needs two different squares');
      const c = COLORS[String(color || 'g').toLowerCase()];
      if (!c) fail(`unknown arrow colour "${String(color).slice(0, 12)}"`);
      if (!out.some((x) => x[0] === from && x[1] === to)) out.push([from, to, c]);
    }
    if (out.length > 12) fail('more than 12 arrows');
    return out;
  }

  function squares(v, max) {
    if (v == null) return [];
    const list = (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof x === 'string' ? x.split(/[\s,;]+/) : [x])).filter((x) => x !== '');
    const out = [];
    for (const s of list) {
      const n = String(s).trim().toLowerCase();
      if (sqIndex(n) < 0) fail(`"${String(s).slice(0, 12)}" is not a square`);
      if (!out.includes(n)) out.push(n);
    }
    if (out.length > max) fail(`more than ${max} squares`);
    return out;
  }

  function orientation(v, fallback) {
    const o = String(v == null ? '' : v).toLowerCase();
    if (o === 'white' || o === 'w') return 'white';
    if (o === 'black' || o === 'b') return 'black';
    return fallback;
  }

  function sharedParts(spec, out, fallbackSide) {
    out.orientation = orientation(spec.orientation || spec.side || spec.flip && 'black', fallbackSide);
    const a = arrows(spec.arrows);
    const h = squares(spec.highlight != null ? spec.highlight : spec.highlights, 16);
    if (a.length) out.arrows = a;
    if (h.length) out.highlight = h;
    return out;
  }

  function guard(fn, why) {
    try { return fn(); } catch (err) { if (Array.isArray(why)) why.push(String(err && err.message || err)); return null; }
  }

  // A board shown in a lesson: { start, setup, fen, moves, orientation, arrows?, highlight?, play }
  function normBlock(spec, why) {
    return guard(() => {
      if (!isObj(spec)) fail('the spec must be an object');
      const p = position(spec);
      const list = words(spec.moves != null ? spec.moves : spec.line, MAX_DEMO);
      if (list.length > MAX_DEMO) fail(`more than ${MAX_DEMO} demo moves`);
      const demo = playLine(p.pos, list, 'demo');
      const out = { start: p.start, setup: p.setup, fen: p.fen, moves: demo.ucis };
      sharedParts(spec, out, 'white');
      out.play = spec.play !== false && spec.interactive !== false;
      return out;
    }, why);
  }

  const GOALS = { move: 'move', best: 'move', bestmove: 'move', 'best-move': 'move', line: 'line', sequence: 'line', puzzle: 'line', combination: 'line', mate: 'mate', checkmate: 'mate', square: 'square', squares: 'square', tap: 'square' };

  // A task: the learner plays the side to move in the spec's position (or taps squares on it).
  //   { type: 'move', best: [uci] }        any of these
  //   { type: 'line', moves: [uci] }       the learner's moves are 1st, 3rd, …; the board plays the rest
  //   { type: 'mate', n, best: [uci], line: [uci] }   any move that forces mate in n; line: a way it goes
  //   { type: 'square', squares: [sq], from? }        exactly these squares
  function normTask(spec, goal, why) {
    return guard(() => {
      if (!isObj(spec) || !isObj(goal)) fail('the spec and goal must be objects');
      const p = position(spec);
      const side = p.pos.turn === 'w' ? 'white' : 'black';
      const outSpec = sharedParts(spec, { start: p.start, setup: p.setup, fen: p.fen }, side);
      const type = GOALS[String(goal.type || '').toLowerCase()];
      if (!type) fail(`unknown goal type "${String(goal.type).slice(0, 20)}"`);
      const moves = legal(p.pos);
      if (type !== 'square' && !moves.length) fail('the game is already over in this position');
      let out;
      if (type === 'move') {
        const list = words(goal.best != null ? goal.best : goal.moves != null ? goal.moves : goal.move != null ? goal.move : goal.answer, 12);
        if (!list.length) fail('a move goal needs "best" moves');
        if (list.length > 8) fail('more than 8 best moves');
        const best = [];
        list.forEach((w) => {
          const m = parseMove(p.pos, w, moves);
          if (!m) fail(`best move "${String(w).slice(0, 12)}" is not legal in ${p.fen}`);
          if (!best.includes(uci(m))) best.push(uci(m));
        });
        out = { type, best };
      } else if (type === 'line') {
        let list = words(goal.moves != null ? goal.moves : goal.line != null ? goal.line : goal.best, MAX_LINE + 1);
        if (!list.length) fail('a line goal needs "moves"');
        if (list.length > MAX_LINE + 1) fail(`more than ${MAX_LINE} moves in the line`);
        if (list.length % 2 === 0) list = list.slice(0, -1); // it ends on the learner's move
        if (list.length > MAX_LINE) fail(`more than ${MAX_LINE} moves in the line`);
        out = { type, moves: playLine(p.pos, list, 'line').ucis };
      } else if (type === 'mate') {
        const n = Number(goal.n != null ? goal.n : goal.in != null ? goal.in : goal.moves != null && typeof goal.moves === 'number' ? goal.moves : 1);
        if (n !== 1 && n !== 2) fail('mate goals are mate in 1 or 2');
        const best = mateMoves(p.pos, n);
        if (!best.length) fail(`there is no mate in ${n} for ${side} in ${p.fen}`);
        // the main line: the move the AI meant if it is one of them, the best defence, the mate
        const said = words(goal.best != null ? goal.best : goal.solution != null ? goal.solution : goal.line, 4).map((w) => parseMove(p.pos, w, moves)).find(Boolean);
        const quick = mateIn1(p.pos);
        const key = (said && best.some((m) => uci(m) === uci(said)) && said) || (quick.length ? quick[0] : best[0]);
        const line = [uci(key)];
        const a = play(p.pos, key);
        if (hasLegal(a)) {
          const r = defend(a, 1);
          const b = play(a, r);
          line.push(uci(r), uci(mateIn1(b)[0]));
        }
        out = { type, n, best: best.map(uci), line };
      } else {
        const listed = squares(goal.squares != null ? goal.squares : goal.square != null ? goal.square : goal.answer, 32);
        let from = '';
        let sqs = listed;
        if (goal.from != null) {
          from = String(goal.from).toLowerCase();
          const i = sqIndex(from);
          if (i < 0 || !p.pos.b[i]) fail(`there is no piece on "${String(goal.from).slice(0, 12)}"`);
          const mover = colorOf(p.pos.b[i]);
          const view = mover === p.pos.turn ? p.pos : { ...p.pos, turn: mover, ep: -1 };
          const reach = [...new Set(legal(view).filter((m) => m.from === i).map((m) => sqName(m.to)))];
          if (!reach.length) fail(`the piece on ${from} has no legal move`);
          if (listed.length && (listed.length !== reach.length || listed.some((s) => !reach.includes(s)))) {
            fail(`the squares listed (${listed.join(' ')}) are not where the piece on ${from} can go (${reach.join(' ')})`);
          }
          sqs = reach;
        }
        if (!sqs.length) fail('a square goal needs "squares" or "from"');
        out = { type, squares: sqs.slice().sort() };
        if (from) out.from = from;
      }
      return { spec: outSpec, goal: out };
    }, why);
  }

  return {
    START, FILES, sqName, sqIndex, colorOf, typeOf,
    parseFEN, toFEN, legal, pseudo, play, inCheck, status, san, uci, parseMove,
    mateMoves, defend, perft, words, sanLine, normBlock, normTask
  };
});
