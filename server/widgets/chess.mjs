// =====================================================================
// The chess board in lessons (server/widgets.mjs): an opening, a tactic
// or a mate shown as moves on a board the learner can also play on, and
// checkpoint tasks done on the board (find the move, play the line, mate
// in one or two, tap the squares).
//
// Every board the AI writes is checked with the same rules the browser
// plays by (assets/js/widgets/chess-rules.js): the position must be one
// that could happen, each setup, demo and answer move legal, and a mate
// a real forced mate. What comes back is the checked spec, with every
// move as UCI and the position after the setup as a FEN:
//   block: { start, setup: [uci], fen, moves: [uci], orientation,
//            arrows?: [[from, to, 'g'|'r'|'y'|'b']], highlight?: [sq], play }
//   task:  { spec: { start, setup, fen, orientation, arrows?, highlight? },
//            goal: { type: 'move', best } | { type: 'line', moves }
//                | { type: 'mate', n, best, line } | { type: 'square', squares, from? } }
// =====================================================================
import rules from '../../assets/js/widgets/chess-rules.js';

export const label = 'an interactive chess board';

// Words for chess in the languages Primer serves (and a few more). Text is already lower-cased.
// Words that also mean something else ("stalemate" in politics, "en passant" in French prose,
// "échecs" as failures, "gambit", "bona fide") only count with a chess word next to them.
const L = '\\p{L}\\p{M}\\p{N}';
const word = (src) => new RegExp(`(?<![${L}])(?:${src})`, 'u');
const whole = (src) => new RegExp(`(?<![${L}])(?:${src})(?![${L}])`, 'u');
const WORDS = [
  word('chess|checkmat|zugzwang|ruy lopez|caro[- ]kann|nimzo|scholar[\'’]?s mate|knight[\'’]?s tour|eight queens|n[- ]queens'),
  word('(?:sicilian|french|scandinavian|pirc|dutch|slav|grünfeld|gruenfeld) defen[cs]e|queen[\'’]?s gambit|king[\'’]?s (?:gambit|indian)|italian game|london system'),
  word('(?:capture|captures|capturing|prise|prendre) en passant'),
  word('ajedrez|jaque mate|xadrez|xeque[- ]?mate|échiquier|echiquier|échec et mat|echec et mat|(?:jouer|joue|jouent|jouons) aux [ée]checs'),
  word('(?:jeu|jeux|partie|parties|joueur|joueuse|joueurs|club|problème|problèmes|ouverture|ouvertures|tournoi|championnat|leçon|leçons|cours|initiation|règles|regles|pièces|stratégie|tactique|tactiques|finales) (?:d[\'’]|des |aux )échecs'),
  word('schach(?!t)|scacchi|scacco matto|schaak|schaken|szachy|szachów|szachow|šachy|šach|satranç|satranc|sataranji|σκάκι|cờ vua|co vua'),
  word('шахмат|шахи|шахів|шахіст|шах и мат'),
  /شطرنج|שחמט/u, // Arabic, Urdu and Persian write it after the article (الشطرنج)
  /国际象棋|西洋棋|チェス|체스|หมากรุก/u,
  // Devanagari (Hindi, Marathi, Nepali, Bhojpuri, Maithili, Konkani), Gujarati, Gurmukhi, Odia
  word('शतरंज|शतरञ्ज|बुद्धिबळ|बुद्धिचाल|शह और मात|शह-मात|शह मात'), whole('चेस'),
  word('શતરંજ'), whole('ચેસ'),
  word('ਸ਼ਤਰੰਜ|ਸ਼ਤਰੰਜ'), whole('ਚੈੱਸ|ਚੈਸ'),
  word('ଶତରଞ୍ଜ'), whole('ଚେସ୍?'),
  // Bengali দাবা (not দাবানল, wildfire, or দাবানো, to press), Assamese দবা
  word('দাবা(?!ন)'), whole('দবা(?:ৰ|খন)?|চেস'),
  // Tamil, Telugu, Kannada, Malayalam, Sinhala
  word('சதுரங்க'), whole('செஸ்'),
  word('చదరంగ'), whole('చెస్'),
  word('ಚದುರಂಗ'), whole('ಚೆಸ್'),
  word('ചെസ്സ|ചതുരംഗ'), whole('ചെസ്'),
  word('චෙස්')
];

// a word that is chess only next to another chess word
const PAIRS = [
  [word('stalemate|gambit|en passant|castling'), word('pawns?\\b|rooks?\\b|bishops?\\b|knights?\\b|checkmate|chess')],
  [word('[ée]checs'), word('roque|échiquier|pions?(?![\\p{L}])|cavaliers?(?![\\p{L}])|gambit|échec et mat')]
];

export function match(text) {
  const s = String(text || '');
  return WORDS.some((re) => re.test(s)) || PAIRS.some(([a, b]) => a.test(s) && b.test(s));
}

export const prompt = String.raw`
Chess board ("kind": "chess"). The app draws the board, plays the moves and lets the learner move pieces.
Spec, for a block or a task:
  "setup": the moves that reach the position from the usual start (all 32 pieces), as one numbered string in SAN: "1. e4 e5 2. Nf3 Nc6 3. Bc4". Prefer this to a FEN, with moves you know exactly (a real opening or a famous game).
  "pieces": a starting position instead, for one no short game reaches (an endgame, a mate with few pieces), listed piece by piece: {"white": ["Kg1", "Rd1", "f2", "g2", "h2"], "black": ["Kg8", "f7", "g7", "h7"]}, with "turn": "white" or "black" (who moves first). Capital letters K Q R B N for the pieces, a pawn as just its square. Each side has exactly one king, and the side NOT to move must not be in check. "setup" then plays on from it. Never list where pieces stand as setup moves.
  "moves" (blocks only): the line to show after the setup, numbered on from it ("3... Nf6 4. Ng5"). The learner steps through it with Play and Step, then can try their own moves.
  "arrows": [["g1","f3"], ["d8","h4","red"]] (green, red, gold, blue) and "highlight": ["e5"], drawn on the position after setup.
  "orientation": "white" or "black" (default: White below for blocks, the side to move for tasks).
In a task the learner plays the side to move after the setup. Goals:
  {"type": "move", "best": ["Nxe5"]}: any listed move is right, and so is any mate. Use it only where one or two moves are clearly best (a tactic, a capture, a mate), and list every good one.
  {"type": "line", "moves": "5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#"}: the learner plays the 1st, 3rd, ... moves and the board answers with the others; end on the learner's move.
  {"type": "mate", "n": 1}: mate in 1 or 2 ("n": 2); any move that forces it is right.
  {"type": "square", "from": "g1"}: tap every square the piece on g1 can move to; or {"type": "square", "squares": ["d5","e4"]} for squares you name.
Use blocks for openings, plans, tactics and mates played out; use tasks to find a move, finish a mate, or say where a piece can go. Say in the task's "prompt" whose move it is.
Accuracy: the app replays every move and leaves out any board with an illegal one. Moves alternate White, Black, White...; before writing each, check on the board in your head: the piece is on that square, its path is clear, the square isn't held by its own side, and its king isn't left in check. Chess moves and squares are not maths: in every text and caption write them plainly (Nf3, the e4 square), never inside \( \).
Known to be right, to use as they are:
  Scholar's mate: setup "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6", then 4. Qxf7#. Fool's mate: setup "1. f3 e5 2. g4", then 2... Qh4#.
  Legal's mate: setup "1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6", then 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#.
  Fried Liver fork: setup "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5", then 6. Nxf7 forks queen and rook.
  Back-rank mate: pieces {"white": ["Kg1", "Rd1", "f2", "g2", "h2"], "black": ["Kg8", "f7", "g7", "h7"]}, then Rd8#. Smothered mate: pieces {"white": ["Kg1", "Ng5"], "black": ["Kh8", "Rg8", "g7", "h7"]}, then Nf7#.
  Queen and king: pieces {"white": ["Kf6", "Qg1"], "black": ["Kh8"]}, then Qg7#. Two rooks: pieces {"white": ["Kd1", "Ra6", "Rb5"], "black": ["Kh8"]}, mate in 2: 1. Ra7 Kg8 2. Rb8#.Example block: {"t": "widget", "kind": "chess", "spec": {"setup": "1. e4 e5 2. Nf3 Nc6", "moves": "3. Bb5 a6 4. Ba4 Nf6 5. O-O", "arrows": [["f3","e5","red"], ["c6","e5"]]}, "caption": "The Ruy Lopez: the bishop goes after the knight that guards e5."}
Example task: {"type": "task", "kind": "chess", "prompt": "White to move: mate in one.", "spec": {"setup": "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6"}, "goal": {"type": "mate", "n": 1}, "hint": "Only the king guards f7.", "explain": "Qxf7#: the bishop on c4 guards the queen, and the king has no square to go to."}`.trim();

// The positions the prompt calls right (for the tests): [what, spec, the moves that follow]
export const KNOWN = [
  ['Scholar’s mate', { setup: '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6' }, '4. Qxf7#'],
  ['Fool’s mate', { setup: '1. f3 e5 2. g4' }, '2... Qh4#'],
  ['Legal’s mate', { setup: '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6' }, '5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#'],
  ['Fried Liver fork', { setup: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5' }, '6. Nxf7'],
  ['Back-rank mate', { pieces: { white: ['Kg1', 'Rd1', 'f2', 'g2', 'h2'], black: ['Kg8', 'f7', 'g7', 'h7'] } }, 'Rd8#'],
  ['Smothered mate', { pieces: { white: ['Kg1', 'Ng5'], black: ['Kh8', 'Rg8', 'g7', 'h7'] } }, 'Nf7#'],
  ['Queen and king', { pieces: { white: ['Kf6', 'Qg1'], black: ['Kh8'] } }, 'Qg7#'],
  ['Two rooks', { pieces: { white: ['Kd1', 'Ra6', 'Rb5'], black: ['Kh8'] } }, '1. Ra7 Kg8 2. Rb8#']
];

// A reason for the server log when the AI's board is left out.
const note = (what, why) => { if (why[0]) console.log(`[widgets] chess ${what} left out: ${why[0].slice(0, 200)}`); };

export function block(spec) {
  const why = [];
  const out = rules.normBlock(spec, why);
  if (!out) note('board', why);
  return out;
}

export function task(spec, goal) {
  const why = [];
  const out = rules.normTask(spec, goal, why);
  if (!out) note('task', why);
  return out;
}

// Why a block's spec (or a task's spec and goal) is left out, or '' when it is fine: for tests and checks.
export function explain(spec, goal) {
  const why = [];
  const out = goal === undefined ? rules.normBlock(spec, why) : rules.normTask(spec, goal, why);
  return out ? '' : why[0] || 'not usable';
}
