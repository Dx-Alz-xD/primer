/* =====================================================================
   The coding window's interpreters (assets/js/widgets/code.js), shared
   by the server (server/widgets/code.mjs runs the AI's reference
   solution against its tests, and checks that the starter code does not
   already pass) and the page (the editor's Run button, through
   code-worker.js, and the task's check, on the page itself).
   The server imports this file; the page loads it with a script element
   (window.PrimerCode), and the worker with importScripts.

   Two languages, each a lexer, a parser to a tree, and a tree-walking
   interpreter, with no eval and nothing of the host reachable from a
   program: it can only print, read the input it was given, and draw
   with the turtle.
     Python: int (any size, as BigInt), float, str, list, tuple, dict,
       set, None, bool; f-strings, slicing, comprehensions; if/elif/else,
       for and while (with else), break, continue; def with defaults,
       *args, keyword arguments; lambda, recursion, global, nonlocal;
       try/except/else/finally, raise; classes with inheritance, super(),
       properties; the usual built-ins; the modules math, random (seeded,
       so checks are deterministic), string, time and turtle.
     JavaScript (a subset): let, const, var, functions and arrows,
       closures; if, for, for...of, for...in, while, do...while, switch,
       try/catch/throw; arrays and objects with their common methods,
       template literals, destructuring, spread; console.log, Math,
       String, Number, JSON, prompt().

   Every run has limits: a step budget (a program that loops forever
   stops with error kind "timeout"), a recursion depth, the size of
   what it prints, and the size of numbers, strings and lists.

     run(lang, code, opts) -> result
       opts: { stdin: '3\n4' (input() takes the lines in turn),
               steps, output, depth (the limits), seed,
               call: { name, args } (then call this function),
               onOut(text, kind) (as it prints) }
       result: { out: [{ k: 'out' | 'prompt' | 'echo', s }],
                 stdout (only what print wrote: prompts are left out),
                 error: null | { kind, type, message, line, text },
                 turtle: null | { ops, turtles, bg },
                 steps, inputs (lines read), asked (input was called),
                 found / value / shown (for opts.call) }
       error.kind: 'syntax', 'error', 'eof' (ran out of input),
       'timeout', 'output' (printed too much), 'depth', 'unsupported'.
     runTests(lang, goal, code, opts) -> { passed, total, results }
       goal: { type: 'output', tests: [{ stdin, stdout }] }
          or { type: 'function', name, tests: [{ args, returns }], tolerance }
     sameOutput(got, want, tol), parse(lang, code), uses(lang, code)
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrimerCode = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LIMITS = {
    steps: 5000000,    // statements, calls and loop turns in one run
    output: 100000,    // characters printed
    depth: 400,        // nested calls
    turtle: 20000,     // things the turtle draws
    str: 2000000,      // characters in one string
    list: 1000000,     // items in one list
    bits: 20000        // the size of a whole number
  };
  const BIG = 1n << BigInt(LIMITS.bits);

  // stops a run: kind is 'timeout', 'output' or 'memory' (not something a program can catch)
  class Halt { constructor(kind, message) { this.kind = kind; this.message = message || ''; } }

  // what a program prints, in pieces: 'out' (print), 'prompt' (input's prompt), 'echo' (the line read)
  class Out {
    constructor(max, onOut) { this.chunks = []; this.size = 0; this.max = max; this.onOut = onOut || null; this.std = []; }
    write(s, k) {
      if (!s) return;
      s = String(s);
      let cut = false;
      if (this.size + s.length > this.max) { s = s.slice(0, Math.max(0, this.max - this.size)); cut = true; }
      this.size += s.length;
      if (s) {
        const last = this.chunks[this.chunks.length - 1];
        if (last && last.k === k) last.s += s; else this.chunks.push({ k, s });
        if (k === 'out') this.std.push(s);
        if (this.onOut) this.onOut(s, k);
      }
      if (cut) throw new Halt('output');
    }
    stdout() { return this.std.join(''); }
  }

  // a small seeded random number generator (mulberry32), so a program's "random" numbers are the same every run
  function makeRng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    const rng = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.seed = (s) => {
      let h = 2166136261;
      const str = String(s);
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      a = h >>> 0;
    };
    return rng;
  }

  const lines = (stdin) => {
    if (Array.isArray(stdin)) return stdin.map((x) => String(x));
    const s = String(stdin == null ? '' : stdin).replace(/\r\n?/g, '\n');
    if (!s) return [];
    const out = s.split('\n');
    if (out[out.length - 1] === '') out.pop();
    return out;
  };

  // the nearest of some names to a misspelt one ("Did you mean: 'total'?"), as Python 3.10+ suggests
  function nearest(name, names) {
    let best = null, bestD = Infinity;
    const max = Math.max(1, Math.floor((name.length + 2) / 3));
    for (const n of names) {
      if (typeof n !== 'string' || n === name || n.startsWith('__')) continue;
      if (Math.abs(n.length - name.length) > max) continue;
      const d = editDistance(name, n);
      if (d <= max && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }
  function editDistance(a, b) {
    const m = a.length, n = b.length;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0.5 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  const hasSur = (s) => /[\uD800-\uDFFF]/.test(s);

  // a digit in any script (Devanagari ०-९, Bengali, Tamil...) as 0-9, as Python's int() reads them
  function asciiDigits(s) {
    return s.replace(/\p{Nd}/gu, (d) => {
      let cp = d.codePointAt(0), first = cp;
      while (first > 0 && /\p{Nd}/u.test(String.fromCodePoint(first - 1)) && cp - first < 60) first--;
      return String((cp - first) % 10);
    });
  }

  /* =====================================================================
     Python: the lexer
     ===================================================================== */

  // a mistake in the program's text, found before it runs
  class PySyntax {
    constructor(msg, line, type) { this.msg = msg; this.line = line; this.type = type || 'SyntaxError'; }
  }

  const PY_KW = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
    'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
    'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
  const PY_OPS3 = new Set(['**=', '//=', '>>=', '<<=', '...']);
  const PY_OPS2 = new Set(['!=', '==', '<=', '>=', '->', '**', '//', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', ':=']);
  const PY_OPS1 = new Set(['+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '=']);
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  const CLOSE = { ')': '(', ']': '[', '}': '{' };
  const NAME_START = /[\p{L}\p{Nl}_]/u;
  const NAME_RE = /[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*/uy;

  function pyUnescape(s) {
    if (s.indexOf('\\') < 0) return s;
    return s.replace(/\\(\n|\\|'|"|a|b|f|n|r|t|v|[0-7]{1,3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|N\{[^}]*\}|[\s\S])/g, (m, e) => {
      switch (e[0]) {
        case '\n': return '';
        case '\\': return '\\';
        case "'": return "'";
        case '"': return '"';
        case 'a': return '\x07';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'v': return '\v';
        case 'x': return String.fromCharCode(parseInt(e.slice(1), 16));
        case 'u': return String.fromCharCode(parseInt(e.slice(1), 16));
        case 'U': { const cp = parseInt(e.slice(1), 16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
        case 'N': return m;
        default:
          if (/[0-7]/.test(e[0])) return String.fromCharCode(parseInt(e, 8));
          return m; // an unknown escape keeps its backslash, as in Python
      }
    });
  }

  function pyLex(src, firstLine) {
    src = String(src).replace(/\r\n?/g, '\n');
    const toks = [];
    const indents = [0];
    const brackets = [];
    const n = src.length;
    let i = 0, line = firstLine || 1, lineStart = true;
    const push = (t, v) => { toks.push({ t, v, line }); };
    while (i < n) {
      if (lineStart && brackets.length === 0) {
        let col = 0, j = i;
        while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\f')) {
          col = src[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : src[j] === ' ' ? col + 1 : 0;
          j++;
        }
        if (j >= n) { i = j; break; }
        if (src[j] === '\n') { i = j + 1; line++; continue; }
        if (src[j] === '#') { while (j < n && src[j] !== '\n') j++; i = j; continue; }
        if (src[j] === '\\' && src[j + 1] === '\n') { i = j + 2; line++; continue; }
        i = j;
        lineStart = false;
        const top = indents[indents.length - 1];
        if (col > top) { indents.push(col); push('INDENT', col); } else if (col < top) {
          while (indents.length > 1 && col < indents[indents.length - 1]) { indents.pop(); push('DEDENT', col); }
          if (col !== indents[indents.length - 1]) throw new PySyntax('unindent does not match any outer indentation level', line, 'IndentationError');
        }
        continue;
      }
      const c = src[i];
      if (c === '\n') {
        if (brackets.length === 0) { push('NEWLINE'); lineStart = true; }
        i++; line++;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\f') { i++; continue; }
      if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '\\') {
        if (src[i + 1] === '\n') { i += 2; line++; continue; }
        throw new PySyntax('unexpected character after line continuation character', line);
      }
      // strings, with their prefixes (r, f, rf; b is not available)
      let pre = '';
      if (c === '"' || c === "'") pre = '';
      else if (/[rRbBuUfF]/.test(c)) {
        const m = /^(?:[rRuUfFbB]|[rR][fFbB]|[fFbB][rR])(?=['"])/.exec(src.slice(i, i + 3));
        pre = m ? m[0] : null;
      } else pre = null;
      if (pre !== null) {
        i += pre.length;
        pre = pre.toLowerCase();
        const q = src[i];
        const triple = src.substr(i, 3) === q + q + q;
        const startLine = line;
        i += triple ? 3 : 1;
        let raw = '';
        for (;;) {
          if (i >= n) {
            if (triple) throw new PySyntax(`unterminated triple-quoted string literal (detected at line ${line})`, startLine);
            throw new PySyntax(`unterminated string literal (detected at line ${startLine})`, startLine);
          }
          const ch = src[i];
          if (ch === '\\') {
            raw += ch + (i + 1 < n ? src[i + 1] : '');
            if (src[i + 1] === '\n') line++;
            i += 2;
            continue;
          }
          if (ch === '\n') {
            if (!triple) throw new PySyntax(`unterminated string literal (detected at line ${startLine})`, startLine);
            line++;
          }
          if (triple ? (ch === q && src[i + 1] === q && src[i + 2] === q) : ch === q) { i += triple ? 3 : 1; break; }
          raw += ch;
          i++;
        }
        if (pre.includes('b')) throw new PySyntax('bytes (b"...") are not available here; use a normal string', startLine);
        if (pre.includes('f')) toks.push({ t: 'FSTR', v: raw, raw: pre.includes('r'), line: startLine });
        else toks.push({ t: 'STR', v: pre.includes('r') ? raw : pyUnescape(raw), line: startLine });
        continue;
      }
      // numbers
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        const rest = src.slice(i, i + 500);
        let m = /^0[xX](?:_?[0-9a-fA-F])+|^0[oO](?:_?[0-7])+|^0[bB](?:_?[01])+/.exec(rest);
        let v;
        if (m) v = BigInt(m[0].replace(/_/g, '').toLowerCase().replace(/^0o/, '0o'));
        else {
          m = /^(?:\d(?:_?\d)*)?(?:\.(?:\d(?:_?\d)*)?)?(?:[eE][+-]?\d(?:_?\d)*)?/.exec(rest);
          const txt = m[0].replace(/_/g, '');
          if (/[.eE]/.test(txt)) v = parseFloat(txt);
          else {
            if (/^0+[1-9]/.test(txt)) throw new PySyntax('leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers', line);
            v = BigInt(txt);
          }
        }
        i += m[0].length;
        if (/[jJ]/.test(src[i] || '')) throw new PySyntax('complex numbers are not available here', line);
        if (src[i] && NAME_START.test(src[i])) throw new PySyntax('invalid decimal literal', line);
        push('NUM', v);
        continue;
      }
      // names and keywords
      if (NAME_START.test(c) || (c >= '\uD800' && c <= '\uDBFF')) {
        NAME_RE.lastIndex = i;
        const m = NAME_RE.exec(src);
        if (m) {
          i += m[0].length;
          const w = m[0].normalize('NFKC');
          if (PY_KW.has(w)) push('OP', w); else push('NAME', w);
          continue;
        }
      }
      // operators and brackets
      const s3 = src.substr(i, 3), s2 = src.substr(i, 2);
      let op = PY_OPS3.has(s3) ? s3 : PY_OPS2.has(s2) ? s2 : PY_OPS1.has(c) ? c : null;
      if (op) {
        if (op === '->') op = '->';
        if (OPEN[op]) brackets.push([op, line]);
        else if (CLOSE[op]) {
          const top = brackets.pop();
          if (!top) throw new PySyntax(`unmatched '${op}'`, line);
          if (top[0] !== CLOSE[op]) throw new PySyntax(`closing parenthesis '${op}' does not match opening parenthesis '${top[0]}'` + (top[1] !== line ? ` on line ${top[1]}` : ''), line);
        }
        push('OP', op);
        i += op.length;
        continue;
      }
      if (c === '!' ) throw new PySyntax("invalid syntax: use 'not' for not, or '!=' for not equal", line);
      const cp = c.codePointAt(0);
      const hex = cp.toString(16).toUpperCase().padStart(4, '0');
      const shown = String.fromCodePoint(src.codePointAt(i));
      if (/[\u201c\u201d\u2018\u2019\u00ab\u00bb]/.test(c)) throw new PySyntax(`invalid character '${shown}' (U+${hex}): use straight quotes, ' or "`, line);
      throw new PySyntax(`invalid character '${shown}' (U+${hex})`, line);
    }
    if (brackets.length) { const [ch, l] = brackets[brackets.length - 1]; throw new PySyntax(`'${ch}' was never closed`, l); }
    if (toks.length && toks[toks.length - 1].t !== 'NEWLINE' && toks[toks.length - 1].t !== 'DEDENT') push('NEWLINE');
    while (indents.length > 1) { indents.pop(); push('DEDENT'); }
    push('EOF');
    return toks;
  }

  /* =====================================================================
     Python: the parser (a tree of { k: kind, line, ... })
     ===================================================================== */

  const AUG = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '>>=', '<<=', '@=']);
  const COMP_OPS = new Set(['<', '>', '==', '>=', '<=', '!=', 'in', 'not', 'is']);
  const STARTS_EXPR = new Set(['(', '[', '{', '-', '+', '~', 'not', 'lambda', 'None', 'True', 'False', '...', 'await', '*']);

  class PyParser {
    constructor(toks) { this.t = toks; this.p = 0; this.loops = 0; this.fns = 0; }
    get tok() { return this.t[this.p]; }
    at(v) { const t = this.t[this.p]; return t.t === 'OP' && t.v === v; }
    atT(type) { return this.t[this.p].t === type; }
    eat(v) { if (this.at(v)) { this.p++; return true; } return false; }
    expect(v, msg) { if (!this.eat(v)) this.fail(msg || `expected '${v}'`); }
    fail(msg, tok, type) { throw new PySyntax(msg || 'invalid syntax', (tok || this.tok).line, type); }
    canStart() { const t = this.tok; return t.t === 'NAME' || t.t === 'NUM' || t.t === 'STR' || t.t === 'FSTR' || (t.t === 'OP' && STARTS_EXPR.has(t.v)); }
    name() { const t = this.tok; if (t.t !== 'NAME') this.fail(t.t === 'OP' && PY_KW.has(t.v) ? `'${t.v}' is a keyword: it can't be used as a name` : 'invalid syntax'); this.p++; return t.v; }

    file() {
      const body = [];
      while (!this.atT('EOF')) {
        if (this.atT('NEWLINE')) { this.p++; continue; }
        if (this.atT('INDENT')) this.fail('unexpected indent', null, 'IndentationError');
        if (this.atT('DEDENT')) { this.p++; continue; }
        for (const s of this.statement()) body.push(s);
      }
      return body;
    }

    statement() {
      const t = this.tok;
      if (t.t === 'OP') {
        switch (t.v) {
          case 'if': return [this.ifStmt()];
          case 'while': return [this.whileStmt()];
          case 'for': return [this.forStmt()];
          case 'def': return [this.defStmt([])];
          case 'class': return [this.classStmt([])];
          case 'try': return [this.tryStmt()];
          case '@': return [this.decorated()];
          case 'with': this.fail("'with' is not available here: programs can't open files");
          case 'async': this.fail("'async' is not available here");
          case 'elif': case 'else': case 'except': case 'finally':
            this.fail(`invalid syntax: this '${t.v}' has no 'if'${t.v === 'except' || t.v === 'finally' ? " or 'try'" : ''} above it at the same indent`);
        }
      }
      if (t.t === 'NAME' && t.v === 'match' && this.t[this.p + 1].t !== 'OP') {
        // "match x:" (Python 3.10) is not available; "match = 3" still works
        const nx = this.t[this.p + 1];
        if (nx.t === 'NAME' || nx.t === 'NUM' || nx.t === 'STR') this.fail("'match' statements are not available here: use if and elif");
      }
      return this.simpleStmts();
    }

    suite(what, line) {
      if (!this.at(':')) {
        if (this.at('=')) this.fail("invalid syntax. Maybe you meant '==' or ':=' instead of '='?");
        this.fail("expected ':'");
      }
      this.p++;
      if (!this.atT('NEWLINE')) return this.simpleStmts();
      this.p++;
      if (!this.atT('INDENT')) this.fail(`expected an indented block after ${what} on line ${line}`, null, 'IndentationError');
      this.p++;
      const body = [];
      while (!this.atT('DEDENT') && !this.atT('EOF')) {
        if (this.atT('NEWLINE')) { this.p++; continue; }
        if (this.atT('INDENT')) this.fail('unexpected indent', null, 'IndentationError');
        for (const s of this.statement()) body.push(s);
      }
      if (this.atT('DEDENT')) this.p++;
      return body;
    }

    ifStmt() {
      const line = this.tok.line, kw = this.tok.v;
      this.p++;
      const test = this.namedTest();
      const body = this.suite(`'${kw}' statement`, line);
      let orelse = [];
      if (this.at('elif')) orelse = [this.ifStmt()];
      else if (this.at('else')) { const l = this.tok.line; this.p++; orelse = this.suite("'else' statement", l); }
      return { k: 'If', test, body, orelse, line };
    }
    whileStmt() {
      const line = this.tok.line;
      this.p++;
      const test = this.namedTest();
      this.loops++;
      const body = this.suite("'while' statement", line);
      this.loops--;
      let orelse = [];
      if (this.at('else')) { const l = this.tok.line; this.p++; orelse = this.suite("'else' statement", l); }
      return { k: 'While', test, body, orelse, line };
    }
    forStmt() {
      const line = this.tok.line;
      this.p++;
      const target = this.targetList();
      if (!this.at('in')) this.fail(this.at('=') ? "invalid syntax: a for loop is written 'for x in ...:'" : "expected 'in'");
      this.p++;
      const iter = this.testList();
      this.loops++;
      const body = this.suite("'for' statement", line);
      this.loops--;
      let orelse = [];
      if (this.at('else')) { const l = this.tok.line; this.p++; orelse = this.suite("'else' statement", l); }
      return { k: 'For', target, iter, body, orelse, line };
    }
    decorated() {
      const decs = [];
      while (this.at('@')) {
        this.p++;
        decs.push(this.namedTest());
        if (!this.atT('NEWLINE')) this.fail();
        this.p++;
      }
      if (this.at('def')) return this.defStmt(decs);
      if (this.at('class')) return this.classStmt(decs);
      this.fail('invalid syntax: a decorator goes just above def or class');
    }
    params(close) {
      const ps = [];
      let seenDefault = false, star = false;
      while (!this.at(close)) {
        if (this.eat('**')) { ps.push({ name: this.name(), kind: 3 }); this.annotation(close); this.eat(','); break; }
        if (this.eat('*')) {
          star = true;
          if (this.at(',')) { this.p++; continue; }
          ps.push({ name: this.name(), kind: 1 });
          this.annotation(close);
        } else if (this.eat('/')) {
          // positional-only marker: nothing to do
        } else {
          const name = this.name();
          this.annotation(close);
          let def = null;
          if (this.eat('=')) { def = this.test(); seenDefault = true; } else if (seenDefault && !star) this.fail('parameter without a default follows parameter with a default');
          ps.push({ name, kind: star ? 2 : 0, def });
        }
        if (!this.eat(',')) break;
      }
      const seen = new Set();
      for (const p of ps) { if (seen.has(p.name)) this.fail(`duplicate argument '${p.name}' in function definition`); seen.add(p.name); }
      return ps;
    }
    annotation(close) { if (close === ')' && this.eat(':')) this.test(); }
    defStmt(decs) {
      const line = this.tok.line;
      this.p++;
      const name = this.name();
      if (!this.at('(')) this.fail("invalid syntax: a function needs brackets, like def " + name + '():');
      this.p++;
      const params = this.params(')');
      this.expect(')', "expected ')'");
      if (this.eat('->')) this.test();
      const loops = this.loops;
      this.loops = 0; this.fns++;
      const body = this.suite('function definition', line);
      this.loops = loops; this.fns--;
      return { k: 'Def', name, params, body, decs, line, info: analyze(params, body) };
    }
    classStmt(decs) {
      const line = this.tok.line;
      this.p++;
      const name = this.name();
      let bases = [];
      if (this.eat('(')) {
        while (!this.at(')')) {
          if (this.tok.t === 'NAME' && this.t[this.p + 1].t === 'OP' && this.t[this.p + 1].v === '=') { this.p += 2; this.test(); } else bases.push(this.test());
          if (!this.eat(',')) break;
        }
        this.expect(')', "expected ')'");
      }
      const loops = this.loops, fns = this.fns;
      this.loops = 0; this.fns = 0;
      const body = this.suite('class definition', line);
      this.loops = loops; this.fns = fns;
      return { k: 'Class', name, bases, body, decs, line };
    }
    tryStmt() {
      const line = this.tok.line;
      this.p++;
      const body = this.suite("'try' statement", line);
      const handlers = [];
      let orelse = [], final = [];
      while (this.at('except')) {
        const l = this.tok.line;
        this.p++;
        let type = null, name = null;
        if (!this.at(':')) {
          type = this.test();
          if (this.at(',')) {
            const elts = [type];
            while (this.eat(',')) elts.push(this.test());
            type = { k: 'Tuple', elts, line: l };
          }
          if (this.eat('as')) name = this.name();
        }
        handlers.push({ type, name, body: this.suite("'except' statement", l), line: l });
      }
      if (this.at('else')) { const l = this.tok.line; this.p++; orelse = this.suite("'else' statement", l); }
      if (this.at('finally')) { const l = this.tok.line; this.p++; final = this.suite("'finally' statement", l); }
      if (!handlers.length && !final.length) this.fail("expected 'except' or 'finally' block");
      return { k: 'Try', body, handlers, orelse, final, line };
    }

    simpleStmts() {
      const out = [this.simple()];
      while (this.eat(';')) { if (this.atT('NEWLINE') || this.atT('EOF')) break; out.push(this.simple()); }
      if (!this.atT('NEWLINE') && !this.atT('EOF')) {
        const last = out[out.length - 1];
        if (last.k === 'Expr' && last.x.k === 'Name' && (last.x.id === 'print' || last.x.id === 'exec') && this.canStart()) {
          this.fail(`Missing parentheses in call to '${last.x.id}'. Did you mean ${last.x.id}(...)?`);
        }
        if (this.at('=') ) this.fail("invalid syntax. Maybe you meant '==' instead of '='?");
        if (this.canStart() && !this.at('(') && !this.at('[') && !this.at('-') && !this.at('+')) this.fail('invalid syntax. Perhaps you forgot a comma?');
        this.fail();
      }
      if (this.atT('NEWLINE')) this.p++;
      return out;
    }

    simple() {
      const t = this.tok, line = t.line;
      if (t.t === 'OP') {
        switch (t.v) {
          case 'pass': this.p++; return { k: 'Pass', line };
          case 'break': if (!this.loops) this.fail("'break' outside loop"); this.p++; return { k: 'Break', line };
          case 'continue': if (!this.loops) this.fail("'continue' not properly in loop"); this.p++; return { k: 'Continue', line };
          case 'return': {
            if (!this.fns) this.fail("'return' outside function");
            this.p++;
            const value = this.atT('NEWLINE') || this.atT('EOF') || this.at(';') ? null : this.testListStar();
            return { k: 'Return', value, line };
          }
          case 'raise': {
            this.p++;
            let exc = null, cause = null;
            if (this.canStart()) { exc = this.test(); if (this.eat('from')) cause = this.test(); }
            return { k: 'Raise', exc, cause, line };
          }
          case 'global': case 'nonlocal': {
            this.p++;
            const names = [this.name()];
            while (this.eat(',')) names.push(this.name());
            return { k: t.v === 'global' ? 'Global' : 'Nonlocal', names, line };
          }
          case 'del': {
            this.p++;
            const targets = [this.bitOr()];
            while (this.eat(',')) { if (!this.canStart()) break; targets.push(this.bitOr()); }
            targets.forEach((x) => this.checkTarget(x, 'delete'));
            return { k: 'Del', targets, line };
          }
          case 'assert': {
            this.p++;
            const test = this.test();
            const msg = this.eat(',') ? this.test() : null;
            return { k: 'Assert', test, msg, line };
          }
          case 'import': {
            this.p++;
            const names = [];
            do {
              let name = this.name();
              while (this.eat('.')) name += '.' + this.name();
              const as = this.eat('as') ? this.name() : null;
              names.push({ name, as });
            } while (this.eat(','));
            return { k: 'Import', names, line };
          }
          case 'from': {
            this.p++;
            while (this.eat('.')) { /* relative imports: there are no packages here */ }
            let mod = this.name();
            while (this.eat('.')) mod += '.' + this.name();
            this.expect('import', "expected 'import'");
            if (this.eat('*')) return { k: 'ImportFrom', mod, names: '*', line };
            const paren = this.eat('(');
            const names = [];
            do {
              if (paren && this.at(')')) break;
              const name = this.name();
              names.push({ name, as: this.eat('as') ? this.name() : null });
            } while (this.eat(','));
            if (paren) this.expect(')', "expected ')'");
            return { k: 'ImportFrom', mod, names, line };
          }
          case 'yield': this.fail("'yield' (generators) is not available here: build a list instead");
        }
      }
      const e = this.testListStar();
      if (this.at('=')) {
        const targets = [e];
        let value;
        for (;;) {
          this.p++;
          value = this.at('yield') ? this.fail("'yield' (generators) is not available here") : this.testListStar();
          if (!this.at('=')) break;
          targets.push(value);
        }
        targets.forEach((x) => this.checkTarget(x, 'assign'));
        return { k: 'Assign', targets, value, line };
      }
      if (this.tok.t === 'OP' && AUG.has(this.tok.v)) {
        const op = this.tok.v.slice(0, -1);
        if (e.k !== 'Name' && e.k !== 'Attr' && e.k !== 'Sub') this.fail(`'${describe(e)}' is an illegal expression for augmented assignment`);
        this.p++;
        return { k: 'Aug', target: e, op, value: this.testList(), line };
      }
      if (this.at(':') && (e.k === 'Name' || e.k === 'Attr' || e.k === 'Sub')) {
        this.p++;
        this.test();
        if (this.eat('=')) return { k: 'Assign', targets: [e], value: this.testListStar(), line };
        return { k: 'Pass', line };
      }
      return { k: 'Expr', x: e, line };
    }

    checkTarget(e, what) {
      switch (e.k) {
        case 'Name': case 'Attr': case 'Sub': return;
        case 'Tuple': case 'List': e.elts.forEach((x) => this.checkTarget(x.k === 'Starred' ? x.x : x, what)); return;
        case 'Starred': this.checkTarget(e.x, what); return;
      }
      const hint = what === 'assign' && (e.k === 'Num' || e.k === 'Str' || e.k === 'Const' || e.k === 'Call' || e.k === 'Compare') ? " Maybe you meant '==' instead of '='?" : '';
      throw new PySyntax(`cannot ${what} to ${describe(e)}${hint ? ' here.' + hint : ''}`, e.line);
    }

    // a, b, *c as one expression (a tuple when there is a comma)
    testListStar() {
      const line = this.tok.line;
      const first = this.at('*') ? this.starred() : this.namedTest();
      if (!this.at(',')) return first;
      const elts = [first];
      while (this.eat(',')) { if (!this.canStart()) break; elts.push(this.at('*') ? this.starred() : this.namedTest()); }
      return { k: 'Tuple', elts, line };
    }
    testList() {
      const line = this.tok.line;
      const first = this.at('*') ? this.starred() : this.test();
      if (!this.at(',')) return first;
      const elts = [first];
      while (this.eat(',')) { if (!this.canStart() || this.at('=')) break; elts.push(this.at('*') ? this.starred() : this.test()); }
      return { k: 'Tuple', elts, line };
    }
    starred() { const line = this.tok.line; this.p++; return { k: 'Starred', x: this.bitOr(), line }; }
    // the names a for loop sets: "for i, (a, b) in ..."
    targetList() {
      const line = this.tok.line;
      const one = () => (this.at('*') ? this.starred() : this.bitOr());
      const first = one();
      let e = first;
      if (this.at(',')) {
        const elts = [first];
        while (this.eat(',')) { if (this.at('in')) break; elts.push(one()); }
        e = { k: 'Tuple', elts, line };
      }
      this.checkTarget(e, 'assign');
      return e;
    }

    namedTest() {
      if (this.tok.t === 'NAME' && this.t[this.p + 1].t === 'OP' && this.t[this.p + 1].v === ':=') {
        const line = this.tok.line, name = this.tok.v;
        this.p += 2;
        return { k: 'Walrus', name, value: this.test(), line };
      }
      return this.test();
    }
    test() {
      if (this.at('lambda')) return this.lambda();
      const line = this.tok.line;
      const x = this.orTest();
      if (this.at('if')) {
        this.p++;
        const cond = this.orTest();
        if (!this.at('else')) this.fail("expected 'else' after 'if' expression");
        this.p++;
        return { k: 'IfExp', test: cond, body: x, orelse: this.test(), line };
      }
      return x;
    }
    lambda() {
      const line = this.tok.line;
      this.p++;
      const params = this.params(':');
      this.expect(':', "expected ':'");
      const fns = this.fns, loops = this.loops;
      this.fns = 1; this.loops = 0;
      const body = this.test();
      this.fns = fns; this.loops = loops;
      const ret = [{ k: 'Return', value: body, line }];
      return { k: 'Lambda', params, body: ret, line, info: analyze(params, ret) };
    }
    orTest() {
      const line = this.tok.line;
      let x = this.andTest();
      if (!this.at('or')) return x;
      const vals = [x];
      while (this.eat('or')) vals.push(this.andTest());
      return { k: 'Bool', op: 'or', vals, line };
    }
    andTest() {
      const line = this.tok.line;
      let x = this.notTest();
      if (!this.at('and')) return x;
      const vals = [x];
      while (this.eat('and')) vals.push(this.notTest());
      return { k: 'Bool', op: 'and', vals, line };
    }
    notTest() {
      if (this.at('not')) { const line = this.tok.line; this.p++; return { k: 'Not', x: this.notTest(), line }; }
      return this.comparison();
    }
    comparison() {
      const line = this.tok.line;
      const left = this.bitOr();
      const ops = [], rights = [];
      for (;;) {
        const t = this.tok;
        if (t.t !== 'OP' || !COMP_OPS.has(t.v)) break;
        let op = t.v;
        if (op === 'not') { if (!(this.t[this.p + 1].t === 'OP' && this.t[this.p + 1].v === 'in')) break; this.p += 2; op = 'not in'; } else if (op === 'is') { this.p++; if (this.eat('not')) op = 'is not'; } else this.p++;
        ops.push(op);
        rights.push(this.bitOr());
      }
      if (!ops.length) return left;
      return { k: 'Compare', left, ops, rights, line };
    }
    binLevel(next, opset) {
      const line = this.tok.line;
      let x = next.call(this);
      for (;;) {
        const t = this.tok;
        if (t.t !== 'OP' || !opset.has(t.v)) return x;
        this.p++;
        x = { k: 'Bin', op: t.v, l: x, r: next.call(this), line: t.line || line };
      }
    }
    bitOr() { return this.binLevel(this.bitXor, OR_OPS); }
    bitXor() { return this.binLevel(this.bitAnd, XOR_OPS); }
    bitAnd() { return this.binLevel(this.shift, AND_OPS); }
    shift() { return this.binLevel(this.arith, SHIFT_OPS); }
    arith() { return this.binLevel(this.term, ARITH_OPS); }
    term() { return this.binLevel(this.factor, TERM_OPS); }
    factor() {
      const t = this.tok;
      if (t.t === 'OP' && (t.v === '-' || t.v === '+' || t.v === '~')) {
        this.p++;
        const x = this.factor();
        if (t.v === '-' && x.k === 'Num') return { k: 'Num', v: -x.v, line: t.line };
        return { k: 'Unary', op: t.v, x, line: t.line };
      }
      return this.power();
    }
    power() {
      const line = this.tok.line;
      if (this.at('await')) this.fail("'await' is not available here");
      const x = this.primary();
      if (this.eat('**')) return { k: 'Bin', op: '**', l: x, r: this.factor(), line };
      return x;
    }
    primary() {
      let x = this.atom();
      for (;;) {
        const t = this.tok;
        if (t.t !== 'OP') return x;
        if (t.v === '(') { this.p++; x = this.call(x, t.line); } else if (t.v === '[') {
          this.p++;
          x = { k: 'Sub', obj: x, index: this.subscript(), line: t.line };
        } else if (t.v === '.') {
          this.p++;
          const nt = this.tok;
          if (nt.t !== 'NAME' && !(nt.t === 'OP' && /^[a-zA-Z]/.test(nt.v))) this.fail('invalid syntax: a name must follow the dot');
          this.p++;
          x = { k: 'Attr', obj: x, name: nt.v, line: t.line };
        } else return x;
      }
    }
    call(fn, line) {
      const args = [], kws = [];
      let simple = true;
      while (!this.at(')')) {
        if (this.eat('*')) { args.push({ k: 'Starred', x: this.test(), line }); simple = false; } else if (this.eat('**')) { kws.push({ name: null, x: this.test() }); simple = false; } else if (this.tok.t === 'NAME' && this.t[this.p + 1].t === 'OP' && this.t[this.p + 1].v === '=') {
          const name = this.tok.v;
          this.p += 2;
          kws.push({ name, x: this.test() });
        } else {
          if (kws.length) this.fail(kws.some((k) => k.name === null) ? 'positional argument follows keyword argument unpacking' : 'positional argument follows keyword argument');
          let x = this.namedTest();
          if (this.at('for')) x = this.comprehension('GenExp', x, null, x.line);
          else if (this.at('=')) this.fail('expression cannot contain assignment, perhaps you meant "=="?');
          args.push(x);
        }
        if (!this.eat(',')) break;
      }
      if (!this.at(')')) this.fail(this.canStart() ? 'invalid syntax. Perhaps you forgot a comma?' : "'(' was never closed");
      this.p++;
      return { k: 'Call', fn, args, kws, simple: simple && !kws.length, line };
    }
    subscript() {
      const line = this.tok.line;
      const items = [this.sliceItem()];
      let tuple = false;
      while (this.eat(',')) { tuple = true; if (this.at(']')) break; items.push(this.sliceItem()); }
      this.expect(']', "expected ']'");
      return tuple ? { k: 'Tuple', elts: items, line } : items[0];
    }
    sliceItem() {
      const line = this.tok.line;
      let lo = null, hi = null, step = null;
      if (!this.at(':')) { lo = this.namedTest(); if (!this.at(':')) return lo; }
      this.p++;
      if (!this.at(']') && !this.at(',') && !this.at(':')) hi = this.test();
      if (this.eat(':') && !this.at(']') && !this.at(',')) step = this.test();
      return { k: 'Slice', lo, hi, step, line };
    }
    comprehension(kind, elt, val, line) {
      const gens = [];
      while (this.at('for')) {
        this.p++;
        const target = this.targetList();
        this.expect('in', "expected 'in'");
        const iter = this.orTest();
        const ifs = [];
        while (this.at('if')) { this.p++; ifs.push(this.orTestNoCond()); }
        gens.push({ target, iter, ifs });
      }
      return { k: kind, elt, val, gens, line, targets: gens.reduce((s, g) => { targetNames(g.target, s); return s; }, new Set()) };
    }
    orTestNoCond() { return this.orTest(); }
    atom() {
      const t = this.tok, line = t.line;
      switch (t.t) {
        case 'NAME': this.p++; return { k: 'Name', id: t.v, line };
        case 'NUM': this.p++; return { k: 'Num', v: t.v, line };
        case 'STR': case 'FSTR': {
          const parts = [];
          let f = false;
          while (this.atT('STR') || this.atT('FSTR')) {
            const s = this.tok;
            this.p++;
            if (s.t === 'STR') parts.push(s.v); else { f = true; for (const x of parseFString(s.v, s.raw, s.line)) parts.push(x); }
          }
          if (!f) return { k: 'Str', v: parts.join(''), line };
          const merged = [];
          for (const x of parts) {
            if (typeof x === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] += x; else merged.push(x);
          }
          return { k: 'FStr', parts: merged, line };
        }
        case 'OP':
          switch (t.v) {
            case 'None': this.p++; return { k: 'Const', v: null, line };
            case 'True': this.p++; return { k: 'Const', v: true, line };
            case 'False': this.p++; return { k: 'Const', v: false, line };
            case '...': this.p++; return { k: 'Const', v: ELLIPSIS, line };
            case '(': {
              this.p++;
              if (this.eat(')')) return { k: 'Tuple', elts: [], line };
              if (this.at('yield')) this.fail("'yield' (generators) is not available here");
              const first = this.at('*') ? this.starred() : this.namedTest();
              if (this.at('for')) { const g = this.comprehension('GenExp', first, null, line); this.expect(')', "'(' was never closed"); return g; }
              if (this.eat(')')) return first.k === 'Starred' ? this.fail("cannot use starred expression here") : Object.assign({}, first, { paren: true });
              const elts = [first];
              while (this.eat(',')) { if (this.at(')')) break; elts.push(this.at('*') ? this.starred() : this.namedTest()); }
              if (!this.at(')')) this.fail(this.canStart() ? 'invalid syntax. Perhaps you forgot a comma?' : "'(' was never closed");
              this.p++;
              return { k: 'Tuple', elts, line };
            }
            case '[': {
              this.p++;
              if (this.eat(']')) return { k: 'List', elts: [], line };
              const first = this.at('*') ? this.starred() : this.namedTest();
              if (this.at('for')) { const g = this.comprehension('ListComp', first, null, line); this.expect(']', "'[' was never closed"); return g; }
              const elts = [first];
              while (this.eat(',')) { if (this.at(']')) break; elts.push(this.at('*') ? this.starred() : this.namedTest()); }
              if (!this.at(']')) this.fail(this.canStart() ? 'invalid syntax. Perhaps you forgot a comma?' : "'[' was never closed");
              this.p++;
              return { k: 'List', elts, line };
            }
            case '{': {
              this.p++;
              if (this.eat('}')) return { k: 'Dict', keys: [], vals: [], line };
              if (this.at('**')) return this.dictRest([], [], line);
              const first = this.at('*') ? this.starred() : this.test();
              if (this.eat(':')) {
                const v = this.test();
                if (this.at('for')) { const g = this.comprehension('DictComp', first, v, line); this.expect('}', "'{' was never closed"); return g; }
                return this.dictRest([first], [v], line);
              }
              if (this.at('for')) { const g = this.comprehension('SetComp', first, null, line); this.expect('}', "'{' was never closed"); return g; }
              const elts = [first];
              while (this.eat(',')) { if (this.at('}')) break; elts.push(this.at('*') ? this.starred() : this.test()); }
              this.expect('}', this.canStart() ? 'invalid syntax. Perhaps you forgot a comma?' : "'{' was never closed");
              return { k: 'Set', elts, line };
            }
          }
      }
      if (t.t === 'OP' && (t.v === ')' || t.v === ']' || t.v === '}')) this.fail(`unmatched '${t.v}'`);
      if (t.t === 'NEWLINE' || t.t === 'EOF') this.fail('invalid syntax: something is missing at the end of this line');
      if (t.t === 'INDENT') this.fail('unexpected indent', null, 'IndentationError');
      this.fail(t.t === 'OP' && PY_KW.has(t.v) ? `invalid syntax: '${t.v}' can't go here` : 'invalid syntax');
    }
    dictRest(keys, vals, line) {
      for (;;) {
        if (keys.length && !this.eat(',')) break;
        if (this.at('}')) break;
        if (this.eat('**')) { keys.push(null); vals.push(this.bitOr()); continue; }
        keys.push(this.test());
        this.expect(':', "expected ':'");
        vals.push(this.test());
      }
      this.expect('}', this.canStart() ? 'invalid syntax. Perhaps you forgot a comma?' : "'{' was never closed");
      return { k: 'Dict', keys, vals, line };
    }
  }
  const OR_OPS = new Set(['|']), XOR_OPS = new Set(['^']), AND_OPS = new Set(['&']), SHIFT_OPS = new Set(['<<', '>>']);
  const ARITH_OPS = new Set(['+', '-']), TERM_OPS = new Set(['*', '/', '//', '%', '@']);

  function describe(e) {
    switch (e.k) {
      case 'Num': case 'Str': return 'literal';
      case 'Const': return e.v === null ? 'None' : e.v === true ? 'True' : e.v === false ? 'False' : 'ellipsis';
      case 'Call': return 'function call';
      case 'Bin': case 'Unary': return 'expression';
      case 'Compare': return 'comparison';
      case 'Bool': return 'expression';
      case 'FStr': return 'f-string expression';
      case 'Lambda': return 'lambda';
      case 'IfExp': return 'conditional expression';
      case 'ListComp': return 'list comprehension';
      case 'Dict': return 'dict literal';
      case 'Set': return 'set display';
      default: return 'expression';
    }
  }

  // an f-string's text, as literal pieces and { x: expression, conv, spec, eq } fields
  function parseFString(raw, isRaw, line) {
    const parts = [];
    let lit = '', i = 0;
    const flush = () => { if (lit) { parts.push(isRaw ? lit : pyUnescape(lit)); lit = ''; } };
    while (i < raw.length) {
      const c = raw[i];
      if (c === '{') {
        if (raw[i + 1] === '{') { lit += '{'; i += 2; continue; }
        flush();
        let j = i + 1, depth = 0, q = null, eq = false;
        for (; j < raw.length; j++) {
          const d = raw[j];
          if (q) { if (d === q) q = null; continue; }
          if (d === "'" || d === '"') { q = d; continue; }
          if (d === '(' || d === '[' || d === '{') depth++;
          else if (d === ')' || d === ']' || d === '}') { if (depth === 0) break; depth--; } else if (depth === 0 && d === '!' && raw[j + 1] !== '=') break;
          else if (depth === 0 && d === ':') break;
          else if (depth === 0 && d === '=' && raw[j + 1] !== '=' && !'=!<>'.includes(raw[j - 1])) {
            const rest = raw.slice(j + 1).trimStart();
            if (rest[0] === '}' || rest[0] === '!' || rest[0] === ':') { eq = true; break; }
          }
        }
        const text = raw.slice(i + 1, j);
        if (!text.trim()) throw new PySyntax("f-string: empty expression not allowed", line);
        if (eq) j++;
        while (raw[j] === ' ' && eq) j++;
        let conv = null, spec = null;
        if (raw[j] === '!') { conv = raw[j + 1]; if (!'rsa'.includes(conv || '_')) throw new PySyntax("f-string: invalid conversion character: expected 's', 'r', or 'a'", line); j += 2; }
        if (raw[j] === ':') {
          let k = j + 1, d2 = 0;
          for (; k < raw.length; k++) { if (raw[k] === '{') d2++; else if (raw[k] === '}') { if (d2 === 0) break; d2--; } }
          spec = parseFString(raw.slice(j + 1, k), true, line);
          j = k;
        }
        if (raw[j] !== '}') throw new PySyntax("f-string: expecting '}'", line);
        const toks = pyLex('(' + text + ')', line);
        const p = new PyParser(toks);
        p.fns = 1; p.loops = 1;
        const x = p.testListStar();
        if (!p.atT('NEWLINE') && !p.atT('EOF')) throw new PySyntax('f-string: invalid syntax', line);
        parts.push({ x, conv: conv || (eq && !spec ? 'r' : null), spec, eq: eq ? text + '=' : null });
        i = j + 1;
        continue;
      }
      if (c === '}') {
        if (raw[i + 1] === '}') { lit += '}'; i += 2; continue; }
        throw new PySyntax("f-string: single '}' is not allowed", line);
      }
      if (c === '\\' && !isRaw) { lit += c + (raw[i + 1] || ''); i += 2; continue; }
      lit += c;
      i++;
    }
    flush();
    return parts;
  }

  // the names a target sets
  function targetNames(e, set) {
    if (!e) return set;
    if (e.k === 'Name') set.add(e.id);
    else if (e.k === 'Tuple' || e.k === 'List') e.elts.forEach((x) => targetNames(x, set));
    else if (e.k === 'Starred') targetNames(e.x, set);
    return set;
  }
  // which names are a function's own (assigned in it, not declared global): Python decides this before it runs
  function analyze(params, body) {
    const locals = new Set(params.map((p) => p.name)), globals = new Set(), nonlocals = new Set();
    const walrus = (x) => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) { x.forEach(walrus); return; }
      if (x.k === 'Lambda' || x.k === 'Def' || x.k === 'Class') return;
      if (x.k === 'Walrus') locals.add(x.name);
      for (const key in x) { if (key !== 'line' && key !== 'info' && key !== 'targets' && x[key] && typeof x[key] === 'object') walrus(x[key]); }
    };
    const walk = (stmts) => {
      for (const s of stmts) {
        switch (s.k) {
          case 'Assign': s.targets.forEach((t) => targetNames(t, locals)); walrus(s.value); break;
          case 'Aug': if (s.target.k === 'Name') locals.add(s.target.id); break;
          case 'For': targetNames(s.target, locals); walrus(s.iter); walk(s.body); walk(s.orelse); break;
          case 'While': walrus(s.test); walk(s.body); walk(s.orelse); break;
          case 'If': walrus(s.test); walk(s.body); walk(s.orelse); break;
          case 'Try': walk(s.body); s.handlers.forEach((h) => { if (h.name) locals.add(h.name); walk(h.body); }); walk(s.orelse); walk(s.final); break;
          case 'Def': case 'Class': locals.add(s.name); break;
          case 'Import': s.names.forEach((n) => locals.add(n.as || n.name.split('.')[0])); break;
          case 'ImportFrom': if (Array.isArray(s.names)) s.names.forEach((n) => locals.add(n.as || n.name)); break;
          case 'Global': s.names.forEach((n) => globals.add(n)); break;
          case 'Nonlocal': s.names.forEach((n) => nonlocals.add(n)); break;
          case 'Del': s.targets.forEach((t) => targetNames(t, locals)); break;
          case 'Expr': case 'Return': walrus(s.x || s.value); break;
        }
      }
    };
    walk(body);
    for (const g of globals) locals.delete(g);
    for (const g of nonlocals) locals.delete(g);
    return { locals, globals, nonlocals };
  }

  function pyParse(src) {
    const p = new PyParser(pyLex(src));
    return p.file();
  }

  /* =====================================================================
     Python: values
       int -> BigInt, float -> number, str -> string, bool -> boolean,
       None -> null, list -> Array; the rest are the classes below.
     ===================================================================== */

  const ELLIPSIS = Object.freeze({ ellipsis: true });
  const DONE = Symbol('done');
  class PyTuple { constructor(v) { this.v = v; } }
  class PyDict { constructor() { this.m = new Map(); } }
  class PySet { constructor() { this.m = new Map(); } }
  class PyRange {
    constructor(start, stop, step) { this.start = start; this.stop = stop; this.step = step; }
    get size() {
      const { start, stop, step } = this;
      if (step > 0n) return start < stop ? (stop - start + step - 1n) / step : 0n;
      return start > stop ? (start - stop - step - 1n) / -step : 0n;
    }
  }
  class PySlice { constructor(lo, hi, step) { this.lo = lo; this.hi = hi; this.step = step; } }
  class PyFunction {
    constructor(name, node, defaults, scope) {
      this.name = name; this.qual = name; this.params = node.params; this.body = node.body; this.info = node.info;
      this.defaults = defaults; this.scope = scope; this.owner = null; this.dict = null;
      let nPos = 0;
      this.varargs = null; this.varkw = null;
      this.byName = new Map();
      node.params.forEach((p, i) => {
        if (p.kind === 0) nPos++;
        if (p.kind === 1) this.varargs = p.name;
        else if (p.kind === 3) this.varkw = p.name;
        else this.byName.set(p.name, i);
      });
      this.nPos = nPos;
    }
  }
  class PyBuiltin { constructor(name, fn, self) { this.name = name; this.fn = fn; this.self = self === undefined ? null : self; } }
  class PyBound { constructor(self, fn) { this.self = self; this.fn = fn; } }
  class PyClass {
    constructor(name, bases, dict, extra) {
      this.name = name; this.bases = bases; this.dict = dict || new Map(); this.module = '__main__';
      if (extra) Object.assign(this, extra);
      const all = [this];
      bases.forEach((b) => b.mro.forEach((c) => all.push(c)));
      this.mro = all.filter((c, i) => all.lastIndexOf(c) === i);
      this.isExc = Boolean(this.isExc || bases.some((b) => b.isExc));
    }
  }
  class PyInstance { constructor(cls) { this.cls = cls; this.dict = new Map(); } }
  class PyModule { constructor(name, dict) { this.name = name; this.dict = dict; } }
  class PyIter { constructor(nx, name) { this.nx = nx; this.name = name; } }
  class PyView { constructor(d, kind) { this.d = d; this.kind = kind; } }
  class PyStatic { constructor(fn) { this.fn = fn; } }
  class PyClassMethod { constructor(fn) { this.fn = fn; } }
  class PyProperty { constructor(fget, fset) { this.fget = fget; this.fset = fset; } }
  class PySuper { constructor(cls, obj) { this.cls = cls; this.obj = obj; } }
  // a Python exception on its way up (exc is the exception object; line, where it was raised)
  class Raise { constructor(exc, line) { this.exc = exc; this.line = line; } }

  let CUR = null; // the program running now (runs never overlap: they are synchronous)

  /* the built-in classes */
  const T = (name, bases, extra) => new PyClass(name, bases, new Map(), Object.assign({ builtin: true, module: 'builtins' }, extra));
  const OBJECT = new PyClass('object', [], new Map(), { builtin: true, module: 'builtins' });
  const TYPE = T('type', [OBJECT]);
  const INT = T('int', [OBJECT]);
  const BOOL = T('bool', [INT]);
  const FLOAT = T('float', [OBJECT]);
  const STR = T('str', [OBJECT]);
  const LIST = T('list', [OBJECT]);
  const TUPLE = T('tuple', [OBJECT]);
  const DICT = T('dict', [OBJECT]);
  const SET = T('set', [OBJECT]);
  const FROZENSET = T('frozenset', [OBJECT]);
  const NONETYPE = T('NoneType', [OBJECT]);
  const RANGE = T('range', [OBJECT]);
  const FUNCTION = T('function', [OBJECT]);
  const BUILTIN_FN = T('builtin_function_or_method', [OBJECT]);
  const METHOD = T('method', [OBJECT]);
  const MODULE = T('module', [OBJECT]);
  const SLICE = T('slice', [OBJECT]);
  const ITER = T('iterator', [OBJECT]);
  const ELLIPSIS_T = T('ellipsis', [OBJECT]);
  const VIEW = { keys: T('dict_keys', [OBJECT]), values: T('dict_values', [OBJECT]), items: T('dict_items', [OBJECT]) };
  const PROPERTY = T('property', [OBJECT]);
  const STATICMETHOD = T('staticmethod', [OBJECT]);
  const CLASSMETHOD = T('classmethod', [OBJECT]);
  const SUPER = T('super', [OBJECT]);
  const TURTLE_T = T('Turtle', [OBJECT], { module: 'turtle' });
  const SCREEN_T = T('_Screen', [OBJECT], { module: 'turtle' });

  const EXC = {};
  const exc = (name, base) => { EXC[name] = T(name, base ? [EXC[base]] : [OBJECT], { isExc: true }); return EXC[name]; };
  exc('BaseException'); exc('SystemExit', 'BaseException'); exc('KeyboardInterrupt', 'BaseException'); exc('Exception', 'BaseException');
  exc('ArithmeticError', 'Exception'); exc('ZeroDivisionError', 'ArithmeticError'); exc('OverflowError', 'ArithmeticError');
  exc('AssertionError', 'Exception'); exc('AttributeError', 'Exception'); exc('EOFError', 'Exception'); exc('ImportError', 'Exception');
  exc('ModuleNotFoundError', 'ImportError'); exc('LookupError', 'Exception'); exc('IndexError', 'LookupError'); exc('KeyError', 'LookupError');
  exc('NameError', 'Exception'); exc('UnboundLocalError', 'NameError'); exc('RuntimeError', 'Exception'); exc('RecursionError', 'RuntimeError');
  exc('NotImplementedError', 'RuntimeError'); exc('StopIteration', 'Exception'); exc('SyntaxError', 'Exception'); exc('IndentationError', 'SyntaxError');
  exc('TypeError', 'Exception'); exc('ValueError', 'Exception'); exc('UnicodeError', 'ValueError'); exc('MemoryError', 'Exception');
  exc('OSError', 'Exception'); exc('FileNotFoundError', 'OSError'); exc('TurtleGraphicsError', 'Exception');
  EXC.TurtleGraphicsError.module = 'turtle';

  function newExc(cls, args) {
    const e = new PyInstance(cls);
    e.args = new PyTuple(args);
    return e;
  }
  // raise a built-in exception from inside the interpreter: throw err('TypeError', '...')
  function err(name, msg, extra) {
    const e = newExc(EXC[name], msg == null ? [] : [msg]);
    if (extra) Object.assign(e, extra);
    return new Raise(e, CUR ? CUR.line : 0);
  }

  function typeOf(v) {
    if (v === null) return NONETYPE;
    switch (typeof v) {
      case 'boolean': return BOOL;
      case 'bigint': return INT;
      case 'number': return FLOAT;
      case 'string': return STR;
    }
    if (Array.isArray(v)) return LIST;
    if (v instanceof PyInstance) return v.cls;
    if (v instanceof PyTuple) return TUPLE;
    if (v instanceof PyDict) return DICT;
    if (v instanceof PySet) return v.frozen ? FROZENSET : SET;
    if (v instanceof PyRange) return RANGE;
    if (v instanceof PyFunction) return FUNCTION;
    if (v instanceof PyBuiltin) return BUILTIN_FN;
    if (v instanceof PyBound) return METHOD;
    if (v instanceof PyClass) return TYPE;
    if (v instanceof PyModule) return MODULE;
    if (v instanceof PyIter) return v.cls || ITER;
    if (v instanceof PyView) return VIEW[v.kind];
    if (v instanceof PySlice) return SLICE;
    if (v instanceof PyProperty) return PROPERTY;
    if (v instanceof PyStatic) return STATICMETHOD;
    if (v instanceof PyClassMethod) return CLASSMETHOD;
    if (v instanceof PySuper) return SUPER;
    if (v instanceof PyTurtle) return TURTLE_T;
    if (v instanceof PyScreen) return SCREEN_T;
    if (v === ELLIPSIS) return ELLIPSIS_T;
    return OBJECT;
  }
  const typeName = (v) => (v instanceof PyIter ? v.name : typeOf(v).name);
  const classLookup = (cls, name) => {
    const mro = cls.mro;
    for (let i = 0; i < mro.length; i++) { const v = mro[i].dict.get(name); if (v !== undefined) return v; }
    return undefined;
  };
  const isSub = (cls, base) => cls === base || cls.mro.includes(base);
  const isNum = (v) => typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean';
  const isInt = (v) => typeof v === 'bigint' || typeof v === 'boolean';
  const toBig = (v) => (typeof v === 'boolean' ? (v ? 1n : 0n) : v);

  /* keys of dicts and sets: Python's equal-and-hashable values give the same key */
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => { let n = ids.get(o); if (!n) { n = nextId++; ids.set(o, n); } return n; };
  function hkey(k) {
    switch (typeof k) {
      case 'string': return k.charCodeAt(0) === 0 ? '\u0000S' + k : k;
      case 'bigint': return k;
      case 'number': return Number.isInteger(k) ? BigInt(k) : k;
      case 'boolean': return k ? 1n : 0n;
    }
    if (k === null) return null;
    if (k instanceof PyTuple) return '\u0000T' + k.v.map(hkeyStr).join('\u0001');
    if (Array.isArray(k) || k instanceof PyDict || (k instanceof PySet && !k.frozen)) throw err('TypeError', `unhashable type: '${typeName(k)}'`);
    if (k instanceof PySet) return '\u0000F' + [...k.m.keys()].map((x) => hkeyStr(x === null ? null : x)).sort().join('\u0001');
    return k;
  }
  function hkeyStr(k) {
    switch (typeof k) {
      case 'string': return 's' + k.length + ':' + k;
      case 'bigint': return 'i' + k;
      case 'number': return Number.isInteger(k) ? 'i' + BigInt(k) : 'f' + k;
      case 'boolean': return k ? 'i1' : 'i0';
    }
    if (k === null) return 'n';
    if (k instanceof PyTuple) return 't(' + k.v.map(hkeyStr).join(',') + ')';
    hkey(k); // unhashable ones say so
    return 'o' + idOf(k);
  }
  const dget = (d, k) => { const e = d.m.get(hkey(k)); return e === undefined ? undefined : e[1]; };
  const dset = (d, k, v) => { const h = hkey(k); const e = d.m.get(h); if (e) e[1] = v; else d.m.set(h, [k, v]); };
  const sadd = (s, k) => { const h = hkey(k); if (!s.m.has(h)) s.m.set(h, k); };
  const tuple = (a) => new PyTuple(a);
  // a set's items in the order Python shows them: small whole numbers come out in order ({1, 2, 3}), as
  // CPython's hash table puts them; anything else in the order it was added
  function setItems(s) {
    const a = [...s.m.values()];
    if (a.length > 1 && a.every((k) => (typeof k === 'bigint' && k >= 0n && k < 65536n) || typeof k === 'boolean')) return a.sort((x, y) => (toBig(x) < toBig(y) ? -1 : 1));
    return a;
  }

  /* numbers as Python writes them */
  function floatRepr(x) {
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (Number.isNaN(x)) return 'nan';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential());
    const sign = m[1], digits = m[2] + (m[3] || ''), exp = parseInt(m[4], 10);
    if (exp >= 16 || exp < -4) {
      const ex = Math.abs(exp);
      return sign + (digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits) + 'e' + (exp < 0 ? '-' : '+') + (ex < 10 ? '0' + ex : ex);
    }
    if (exp >= 0) {
      if (digits.length > exp + 1) return sign + digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
      return sign + digits.padEnd(exp + 1, '0') + '.0';
    }
    return sign + '0.' + '0'.repeat(-exp - 1) + digits;
  }
  function intStr(v) {
    const s = v.toString();
    if (s.length > 4300 + (v < 0n ? 1 : 0)) throw err('ValueError', 'Exceeds the limit (4300 digits) for integer string conversion; use sys.set_int_max_str_digits() to increase the limit');
    return s;
  }
  // toFixed, but halves go to the even neighbour, as Python's do
  function toFixedPy(x, p) {
    if (!Number.isFinite(x)) return floatRepr(x);
    if (Math.abs(x) >= 1e21) return BigInt(Math.round(x)).toString() + (p > 0 ? '.' + '0'.repeat(p) : '');
    p = Math.min(p, 100);
    let s = x.toFixed(p);
    if (p <= 70) {
      const longer = Math.abs(x).toFixed(p + 25);
      const tail = longer.slice(longer.length - 25);
      if (/^50*$/.test(tail)) {
        const down = longer.slice(0, longer.length - 25).replace(/\.$/, '');
        const last = Number(down.replace('.', '').slice(-1));
        if (last % 2 === 0) s = (x < 0 && Number(down) !== 0 ? '-' : '') + down;
      }
    }
    if (/^-0(?:\.0*)?$/.test(s) && !(x < 0)) s = s.slice(1);
    return s;
  }
  const expFix = (s) => s.replace(/e([+-])(\d)$/, 'e$10$2');
  function fmtG(x, p, alt, noneType) {
    if (p === 0) p = 1;
    if (!Number.isFinite(x)) return floatRepr(x);
    let exp = 0;
    if (x !== 0) exp = parseInt(x.toExponential(p - 1).split('e')[1], 10);
    let s;
    if (exp >= -4 && exp < p) {
      s = toFixedPy(x, p - 1 - exp);
      if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
      if (noneType && !s.includes('.')) s += '.0';
    } else {
      s = x.toExponential(p - 1);
      if (!alt) s = s.replace(/\.?0+e/, 'e');
      s = expFix(s);
    }
    return s;
  }
  function group(intDigits, sep) { return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, sep); }

  /* =====================================================================
     Python: the interpreter
     ===================================================================== */

  const BRK = 1, CONT = 2, RET = 3;

  class Py {
    constructor(opts) {
      this.maxSteps = opts.steps; this.steps = 0;
      this.maxDepth = opts.depth; this.depth = 0;
      this.out = opts.out; this.stdin = opts.stdin; this.inPos = 0; this.asked = false;
      this.line = 0; this.curExc = null;
      this.rng = makeRng(opts.seed);
      this.modules = new Map();
      this.world = null;
      this.clock = 0;
      this.globals = new Map([['__name__', '__main__']]);
      this.gscope = { vars: this.globals, kind: 'module', parent: null };
      this.reprDepth = 0;
    }
    tick(n) { if ((this.steps += n) > this.maxSteps) throw new Halt('timeout'); }

    /* names */
    load(name, s) {
      let sc = s;
      if (sc.kind === 'fn') {
        const info = sc.info;
        if (info.locals.has(name)) {
          const v = sc.vars.get(name);
          if (v === undefined) throw err('UnboundLocalError', `cannot access local variable '${name}' where it is not associated with a value`);
          return v;
        }
        if (info.globals.has(name)) return this.loadGlobal(name);
        sc = sc.parent;
      } else if (sc.kind === 'comp' || sc.kind === 'class') {
        const v = sc.vars.get(name);
        if (v !== undefined) return v;
        return sc.kind === 'comp' ? this.load(name, sc.parent) : this.loadFree(name, sc.parent);
      } else return this.loadGlobal(name);
      return this.loadFree(name, sc);
    }
    loadFree(name, sc) {
      while (sc && sc.kind !== 'module') {
        if (sc.kind === 'fn') {
          if (sc.info.globals.has(name)) break;
          const v = sc.vars.get(name);
          if (v !== undefined) return v;
          if (sc.info.locals.has(name)) throw err('NameError', `cannot access free variable '${name}' where it is not associated with a value in enclosing scope`);
        } else if (sc.kind === 'comp') {
          const v = sc.vars.get(name);
          if (v !== undefined) return v;
        }
        sc = sc.parent;
      }
      return this.loadGlobal(name);
    }
    loadGlobal(name) {
      let v = this.globals.get(name);
      if (v !== undefined) return v;
      v = BUILTINS.get(name);
      if (v !== undefined) return v;
      const near = nearest(name, [...this.globals.keys(), ...BUILTINS.keys()]);
      throw err('NameError', `name '${name}' is not defined` + (near ? `. Did you mean: '${near}'?` : ''));
    }
    store(name, v, s) {
      if (s.kind === 'fn') {
        const info = s.info;
        if (info.locals.has(name)) { s.vars.set(name, v); return; }
        if (info.globals.has(name)) { this.globals.set(name, v); return; }
        if (info.nonlocals.has(name)) {
          let sc = s.parent;
          while (sc && sc.kind !== 'module') {
            if (sc.kind === 'fn' && sc.info.locals.has(name)) { sc.vars.set(name, v); return; }
            sc = sc.parent;
          }
          throw err('SyntaxError', `no binding for nonlocal '${name}' found`);
        }
        s.vars.set(name, v);
        return;
      }
      if (s.kind === 'comp' && !s.targets.has(name)) { this.store(name, v, s.parent); return; }
      s.vars.set(name, v);
    }
    unset(name, s) {
      let vars = s.vars;
      if (s.kind === 'fn' && s.info.globals.has(name)) vars = this.globals;
      if (!vars.has(name)) throw err('NameError', `name '${name}' is not defined`);
      vars.delete(name);
    }

    /* statements */
    block(body, s) {
      for (let i = 0; i < body.length; i++) {
        const r = this.exec(body[i], s);
        if (r) return r;
      }
      return 0;
    }
    exec(st, s) {
      if (++this.steps > this.maxSteps) throw new Halt('timeout');
      this.line = st.line;
      switch (st.k) {
        case 'Expr': this.ev(st.x, s); return 0;
        case 'Assign': {
          const v = this.ev(st.value, s);
          const ts = st.targets;
          for (let i = 0; i < ts.length; i++) this.assign(ts[i], v, s);
          return 0;
        }
        case 'Aug': return this.aug(st, s);
        case 'If': {
          if (this.truthy(this.ev(st.test, s))) return this.block(st.body, s);
          return st.orelse.length ? this.block(st.orelse, s) : 0;
        }
        case 'While': {
          let broke = false;
          for (;;) {
            this.line = st.line;
            if (!this.truthy(this.ev(st.test, s))) break;
            const r = this.block(st.body, s);
            if (r === BRK) { broke = true; break; }
            if (r === RET) return r;
            if (++this.steps > this.maxSteps) throw new Halt('timeout');
          }
          return !broke && st.orelse.length ? this.block(st.orelse, s) : 0;
        }
        case 'For': {
          const nx = this.iter(this.ev(st.iter, s));
          let broke = false;
          for (;;) {
            const v = nx();
            if (v === DONE) break;
            this.assign(st.target, v, s);
            const r = this.block(st.body, s);
            if (r === BRK) { broke = true; break; }
            if (r === RET) return r;
            if (++this.steps > this.maxSteps) throw new Halt('timeout');
          }
          return !broke && st.orelse.length ? this.block(st.orelse, s) : 0;
        }
        case 'Pass': return 0;
        case 'Break': return BRK;
        case 'Continue': return CONT;
        case 'Return': s.ret = st.value ? this.ev(st.value, s) : null; return RET;
        case 'Def': {
          const defaults = st.params.map((p) => (p.def ? this.ev(p.def, s) : undefined));
          const fn = new PyFunction(st.name, st, defaults, s.kind === 'class' ? s.parent : s);
          if (s.kind === 'class') fn.qual = s.className + '.' + st.name;
          let v = fn;
          for (let i = st.decs.length - 1; i >= 0; i--) v = this.call(this.ev(st.decs[i], s), [v], null);
          this.store(st.name, v, s);
          return 0;
        }
        case 'Class': return this.classDef(st, s);
        case 'Try': return this.tryStmt(st, s);
        case 'Raise': {
          if (!st.exc) {
            if (this.curExc) throw this.curExc;
            throw err('RuntimeError', 'No active exception to reraise');
          }
          let v = this.ev(st.exc, s);
          if (v instanceof PyClass && v.isExc) v = this.call(v, [], null);
          if (!(v instanceof PyInstance && v.cls.isExc)) throw err('TypeError', 'exceptions must derive from BaseException');
          if (st.cause) this.ev(st.cause, s);
          throw new Raise(v, st.line);
        }
        case 'Global': case 'Nonlocal': return 0;
        case 'Import': {
          for (const { name, as } of st.names) {
            const mod = this.importModule(name);
            this.store(as || name.split('.')[0], mod, s);
          }
          return 0;
        }
        case 'ImportFrom': {
          const mod = this.importModule(st.mod);
          if (st.names === '*') {
            for (const [k, v] of mod.dict) if (!k.startsWith('_')) this.store(k, v, s);
            return 0;
          }
          for (const { name, as } of st.names) {
            const v = mod.dict.get(name);
            if (v === undefined) throw err('ImportError', `cannot import name '${name}' from '${mod.name}'`);
            this.store(as || name, v, s);
          }
          return 0;
        }
        case 'Del': {
          for (const t of st.targets) this.del(t, s);
          return 0;
        }
        case 'Assert': {
          if (!this.truthy(this.ev(st.test, s))) throw new Raise(newExc(EXC.AssertionError, st.msg ? [this.ev(st.msg, s)] : []), st.line);
          return 0;
        }
      }
      throw err('SyntaxError', 'this statement is not available here');
    }

    aug(st, s) {
      const t = st.target;
      if (t.k === 'Name') {
        const cur = this.load(t.id, s);
        this.store(t.id, this.inplace(st.op, cur, this.ev(st.value, s)), s);
      } else if (t.k === 'Attr') {
        const o = this.ev(t.obj, s);
        const cur = this.getattr(o, t.name);
        this.setattr(o, t.name, this.inplace(st.op, cur, this.ev(st.value, s)));
      } else {
        const o = this.ev(t.obj, s);
        const k = this.ev(t.index, s);
        const cur = this.getitem(o, k);
        this.setitem(o, k, this.inplace(st.op, cur, this.ev(st.value, s)));
      }
      return 0;
    }
    inplace(op, a, b) {
      if (Array.isArray(a) && op === '+') { const items = this.toArray(b); this.grow(a.length + items.length); for (const x of items) a.push(x); return a; }
      if (a instanceof PyInstance) {
        const f = classLookup(a.cls, '__i' + DUNDER[op].slice(2));
        if (f) return this.call(f, [a, b], null);
      }
      return this.binop(op, a, b);
    }

    classDef(st, s) {
      const bases = st.bases.map((b) => this.ev(b, s));
      for (const b of bases) {
        if (!(b instanceof PyClass)) throw err('TypeError', 'a class can only inherit from another class');
        if (b.builtin && !b.isExc && b !== OBJECT) throw err('TypeError', `inheriting from '${b.name}' is not available here: inherit from object, or keep a ${b.name} in an attribute`);
      }
      const cs = { vars: new Map(), kind: 'class', parent: s, className: st.name };
      this.block(st.body, cs);
      cs.vars.set('__module__', '__main__');
      const cls = new PyClass(st.name, bases.length ? bases : [OBJECT], cs.vars);
      for (const v of cs.vars.values()) {
        const f = v instanceof PyFunction ? v : (v instanceof PyStatic || v instanceof PyClassMethod) ? v.fn : v instanceof PyProperty ? v.fget : null;
        if (f instanceof PyFunction) f.owner = cls;
        if (v instanceof PyProperty && v.fset instanceof PyFunction) v.fset.owner = cls;
      }
      let out = cls;
      for (let i = st.decs.length - 1; i >= 0; i--) out = this.call(this.ev(st.decs[i], s), [out], null);
      this.store(st.name, out, s);
      return 0;
    }

    tryStmt(st, s) {
      let r = 0, pending = null;
      try {
        let failed = false;
        try {
          r = this.block(st.body, s);
        } catch (e) {
          if (!(e instanceof Raise)) throw e;
          failed = true;
          const h = this.handler(st.handlers, e.exc, s);
          if (!h) throw e;
          if (h.name) this.store(h.name, e.exc, s);
          const saved = this.curExc;
          this.curExc = e;
          try { r = this.block(h.body, s); } finally {
            this.curExc = saved;
            if (h.name && s.vars.has(h.name)) s.vars.delete(h.name);
          }
        }
        if (!failed && st.orelse.length) r = this.block(st.orelse, s);
      } catch (e) {
        if (!(e instanceof Raise) || !st.final.length) throw e;
        pending = e;
      }
      if (st.final.length) {
        const r2 = this.block(st.final, s);
        if (r2) return r2;
      }
      if (pending) throw pending;
      return r;
    }
    handler(handlers, ex, s) {
      for (const h of handlers) {
        if (!h.type) return h;
        const t = this.ev(h.type, s);
        const list = t instanceof PyTuple ? t.v : [t];
        for (const c of list) {
          if (!(c instanceof PyClass) || !c.isExc) throw err('TypeError', 'catching classes that do not inherit from BaseException is not allowed');
          if (isSub(ex.cls, c)) return h;
        }
      }
      return null;
    }

    /* targets */
    assign(t, v, s) {
      switch (t.k) {
        case 'Name': this.store(t.id, v, s); return;
        case 'Attr': this.setattr(this.ev(t.obj, s), t.name, v); return;
        case 'Sub': this.setitem(this.ev(t.obj, s), this.ev(t.index, s), v); return;
        case 'Tuple': case 'List': {
          const items = this.toArray(v, true);
          const elts = t.elts;
          const star = elts.findIndex((e) => e.k === 'Starred');
          if (star < 0) {
            if (items.length !== elts.length) {
              if (items.length > elts.length) throw err('ValueError', `too many values to unpack (expected ${elts.length})`);
              throw err('ValueError', `not enough values to unpack (expected ${elts.length}, got ${items.length})`);
            }
            for (let i = 0; i < elts.length; i++) this.assign(elts[i], items[i], s);
            return;
          }
          const after = elts.length - star - 1;
          if (items.length < elts.length - 1) throw err('ValueError', `not enough values to unpack (expected at least ${elts.length - 1}, got ${items.length})`);
          for (let i = 0; i < star; i++) this.assign(elts[i], items[i], s);
          this.assign(elts[star].x, items.slice(star, items.length - after), s);
          for (let i = 0; i < after; i++) this.assign(elts[star + 1 + i], items[items.length - after + i], s);
          return;
        }
        case 'Starred': throw err('SyntaxError', 'starred assignment target must be in a list or tuple');
      }
      throw err('SyntaxError', 'cannot assign to this');
    }
    del(t, s) {
      if (t.k === 'Name') this.unset(t.id, s);
      else if (t.k === 'Sub') this.delitem(this.ev(t.obj, s), this.ev(t.index, s));
      else if (t.k === 'Attr') {
        const o = this.ev(t.obj, s);
        if (o instanceof PyInstance && o.dict.has(t.name)) o.dict.delete(t.name);
        else throw err('AttributeError', `'${typeName(o)}' object has no attribute '${t.name}'`);
      } else if (t.k === 'Tuple' || t.k === 'List') t.elts.forEach((x) => this.del(x, s));
    }

    /* expressions */
    ev(e, s) {
      switch (e.k) {
        case 'Name': return this.load(e.id, s);
        case 'Num': case 'Str': case 'Const': return e.v;
        case 'Bin': return this.binop(e.op, this.ev(e.l, s), this.ev(e.r, s));
        case 'Call': return this.evCall(e, s);
        case 'Attr': return this.getattr(this.ev(e.obj, s), e.name);
        case 'Sub': return this.getitem(this.ev(e.obj, s), this.ev(e.index, s));
        case 'Compare': {
          let a = this.ev(e.left, s);
          for (let i = 0; i < e.ops.length; i++) {
            const b = this.ev(e.rights[i], s);
            if (!this.compare(e.ops[i], a, b)) return false;
            a = b;
          }
          return true;
        }
        case 'Bool': {
          let v;
          if (e.op === 'and') { for (const x of e.vals) { v = this.ev(x, s); if (!this.truthy(v)) return v; } return v; }
          for (const x of e.vals) { v = this.ev(x, s); if (this.truthy(v)) return v; }
          return v;
        }
        case 'Not': return !this.truthy(this.ev(e.x, s));
        case 'Unary': return this.unary(e.op, this.ev(e.x, s));
        case 'IfExp': return this.truthy(this.ev(e.test, s)) ? this.ev(e.body, s) : this.ev(e.orelse, s);
        case 'FStr': return this.fstr(e.parts, s);
        case 'List': return this.elts(e.elts, s);
        case 'Tuple': return new PyTuple(this.elts(e.elts, s));
        case 'Set': { const out = new PySet(); for (const x of this.elts(e.elts, s)) sadd(out, x); return out; }
        case 'Dict': {
          const d = new PyDict();
          for (let i = 0; i < e.keys.length; i++) {
            if (e.keys[i] === null) {
              const o = this.ev(e.vals[i], s);
              if (!(o instanceof PyDict)) throw err('TypeError', `'${typeName(o)}' object is not a mapping`);
              for (const [k, v] of o.m.values()) dset(d, k, v);
            } else { const k = this.ev(e.keys[i], s); dset(d, k, this.ev(e.vals[i], s)); }
          }
          return d;
        }
        case 'ListComp': case 'SetComp': case 'DictComp': case 'GenExp': return this.comp(e, s);
        case 'Lambda': return new PyFunction('<lambda>', e, e.params.map((p) => (p.def ? this.ev(p.def, s) : undefined)), s.kind === 'class' ? s.parent : s);
        case 'Slice': return new PySlice(e.lo ? this.ev(e.lo, s) : null, e.hi ? this.ev(e.hi, s) : null, e.step ? this.ev(e.step, s) : null);
        case 'Walrus': { const v = this.ev(e.value, s); this.store(e.name, v, s); return v; }
        case 'Starred': throw err('SyntaxError', "can't use starred expression here");
      }
      throw err('SyntaxError', 'this is not available here');
    }
    elts(list, s) {
      const out = [];
      for (const x of list) {
        if (x.k === 'Starred') { for (const y of this.toArray(this.ev(x.x, s))) out.push(y); } else out.push(this.ev(x, s));
      }
      return out;
    }
    comp(e, s) {
      const cs = { vars: new Map(), kind: 'comp', parent: s, targets: e.targets };
      const kind = e.k;
      const out = kind === 'DictComp' ? new PyDict() : kind === 'SetComp' ? new PySet() : [];
      const gens = e.gens;
      const run = (gi) => {
        const g = gens[gi];
        const nx = this.iter(this.ev(g.iter, gi === 0 ? s : cs));
        for (;;) {
          const v = nx();
          if (v === DONE) return;
          if (++this.steps > this.maxSteps) throw new Halt('timeout');
          this.assign(g.target, v, cs);
          let ok = true;
          for (const c of g.ifs) if (!this.truthy(this.ev(c, cs))) { ok = false; break; }
          if (!ok) continue;
          if (gi + 1 < gens.length) run(gi + 1);
          else if (kind === 'DictComp') dset(out, this.ev(e.elt, cs), this.ev(e.val, cs));
          else if (kind === 'SetComp') sadd(out, this.ev(e.elt, cs));
          else { out.push(this.ev(e.elt, cs)); if (out.length > LIMITS.list) throw new Halt('memory'); }
        }
      };
      run(0);
      if (kind === 'GenExp') return new PyIter(listNext(out), 'generator');
      return out;
    }
    fstr(parts, s) {
      let out = '';
      for (const p of parts) {
        if (typeof p === 'string') { out += p; continue; }
        let v = this.ev(p.x, s);
        const spec = p.spec ? this.fstr(p.spec, s) : '';
        if (p.conv === 'r' || p.conv === 'a') v = this.repr(v);
        else if (p.conv === 's') v = this.str(v);
        out += (p.eq || '') + this.format(v, spec);
      }
      return out;
    }

    /* calls */
    evCall(e, s) {
      const f = e.fn;
      let fn, self = undefined;
      if (f.k === 'Attr') {
        // a method call: skip making a bound method when we can
        const o = this.ev(f.obj, s);
        if (o instanceof PyInstance) {
          if (!o.dict.has(f.name)) {
            const m = classLookup(o.cls, f.name);
            if (m instanceof PyFunction) { fn = m; self = o; }
          }
        } else if (!(o instanceof PyModule) && !(o instanceof PyClass) && !(o instanceof PySuper)) {
          const tbl = methodsOf(o);
          const m = tbl && tbl[f.name];
          if (m) {
            const args = this.args(e, s);
            const line = this.line;
            const r = m.call(this, args, this.kwargs(e, s), o);
            this.line = line;
            return r;
          }
        }
        if (fn === undefined) fn = this.getattr(o, f.name);
      } else fn = this.ev(f, s);
      if (fn === SUPER_FN && e.args.length === 0) return this.superOf(s);
      const args = this.args(e, s);
      if (self !== undefined) args.unshift(self);
      const kw = this.kwargs(e, s);
      const line = this.line;
      const r = this.call(fn, args, kw);
      this.line = line;
      return r;
    }
    args(e, s) {
      if (e.simple) {
        const a = e.args, out = new Array(a.length);
        for (let i = 0; i < a.length; i++) out[i] = this.ev(a[i], s);
        return out;
      }
      return this.elts(e.args, s);
    }
    kwargs(e, s) {
      if (!e.kws.length) return null;
      const kw = new Map();
      for (const k of e.kws) {
        if (k.name === null) {
          const d = this.ev(k.x, s);
          if (!(d instanceof PyDict)) throw err('TypeError', `argument after ** must be a mapping, not ${typeName(d)}`);
          for (const [key, v] of d.m.values()) {
            if (typeof key !== 'string') throw err('TypeError', 'keywords must be strings');
            if (kw.has(key)) throw err('TypeError', `got multiple values for keyword argument '${key}'`);
            kw.set(key, v);
          }
        } else {
          if (kw.has(k.name)) throw err('SyntaxError', `keyword argument repeated: ${k.name}`);
          kw.set(k.name, this.ev(k.x, s));
        }
      }
      return kw;
    }
    call(fn, args, kw) {
      if (fn instanceof PyFunction) return this.callFn(fn, args, kw);
      if (fn instanceof PyBuiltin) return fn.fn.call(this, args, kw, fn.self);
      if (fn instanceof PyBound) { const a = [fn.self]; for (const x of args) a.push(x); return this.call(fn.fn, a, kw); }
      if (fn instanceof PyClass) return this.construct(fn, args, kw);
      if (fn instanceof PyInstance) {
        const m = classLookup(fn.cls, '__call__');
        if (m) return this.call(m, [fn, ...args], kw);
      }
      throw err('TypeError', `'${typeName(fn)}' object is not callable`);
    }
    callFn(fn, args, kw) {
      if (++this.depth > this.maxDepth) { this.depth--; throw err('RecursionError', 'maximum recursion depth exceeded'); }
      if (++this.steps > this.maxSteps) { this.depth--; throw new Halt('timeout'); }
      try {
        const scope = { vars: new Map(), kind: 'fn', info: fn.info, parent: fn.scope, fn, ret: null };
        this.bind(fn, args, kw, scope.vars);
        return this.block(fn.body, scope) === RET ? scope.ret : null;
      } finally { this.depth--; }
    }
    bind(fn, args, kw, vars) {
      const ps = fn.params, nPos = fn.nPos;
      const n = Math.min(nPos, args.length);
      for (let i = 0; i < n; i++) vars.set(ps[i].name, args[i]);
      if (args.length > nPos) {
        if (fn.varargs) vars.set(fn.varargs, new PyTuple(args.slice(nPos)));
        else {
          const req = ps.filter((p) => p.kind === 0 && !p.def).length;
          const takes = req === nPos ? `${nPos} positional argument${nPos === 1 ? '' : 's'}` : `from ${req} to ${nPos} positional arguments`;
          throw err('TypeError', `${fn.qual}() takes ${takes} but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`);
        }
      } else if (fn.varargs) vars.set(fn.varargs, new PyTuple([]));
      let extra = null;
      if (fn.varkw) { extra = new PyDict(); vars.set(fn.varkw, extra); }
      if (kw) {
        for (const [k, v] of kw) {
          const i = fn.byName.get(k);
          if (i !== undefined) {
            if (vars.has(k) && i < n) throw err('TypeError', `${fn.qual}() got multiple values for argument '${k}'`);
            vars.set(k, v);
          } else if (extra) dset(extra, k, v);
          else {
            const near = nearest(k, [...fn.byName.keys()]);
            throw err('TypeError', `${fn.qual}() got an unexpected keyword argument '${k}'` + (near ? `. Did you mean '${near}'?` : ''));
          }
        }
      }
      if (vars.size < ps.length) {
        let missing = null, kwMissing = null;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          if (p.kind === 1 || p.kind === 3 || vars.has(p.name)) continue;
          const d = fn.defaults[i];
          if (d !== undefined) vars.set(p.name, d);
          else if (p.kind === 0) (missing = missing || []).push(p.name);
          else (kwMissing = kwMissing || []).push(p.name);
        }
        if (missing) throw err('TypeError', `${fn.qual}() missing ${missing.length} required positional argument${missing.length === 1 ? '' : 's'}: ${nameList(missing)}`);
        if (kwMissing) throw err('TypeError', `${fn.qual}() missing ${kwMissing.length} required keyword-only argument${kwMissing.length === 1 ? '' : 's'}: ${nameList(kwMissing)}`);
      }
    }
    construct(cls, args, kw) {
      if (cls.native) return cls.native.call(this, args, kw, cls);
      const o = new PyInstance(cls);
      if (cls.isExc) o.args = new PyTuple(args.slice());
      const init = classLookup(cls, '__init__');
      if (init !== undefined && init !== OBJECT_INIT) {
        const r = this.call(init instanceof PyFunction ? init : init, [o, ...args], kw);
        if (r !== null) throw err('TypeError', `__init__() should return None, not '${typeName(r)}'`);
      } else if (args.length || (kw && kw.size)) throw err('TypeError', `${cls.name}() takes no arguments`);
      return o;
    }
    superOf(s) {
      let sc = s;
      while (sc && sc.kind !== 'fn') sc = sc.parent;
      if (!sc || !sc.fn.owner) throw err('RuntimeError', 'super(): no arguments');
      const first = sc.fn.params[0];
      const obj = first ? sc.vars.get(first.name) : undefined;
      if (obj === undefined) throw err('RuntimeError', 'super(): no arguments');
      return new PySuper(sc.fn.owner, obj);
    }
    callMethod(o, name, args) {
      const m = classLookup(o.cls, name);
      if (m === undefined) throw err('AttributeError', `'${o.cls.name}' object has no attribute '${name}'`);
      return this.call(m, [o, ...args], null);
    }

    /* attributes */
    getattr(o, name) {
      if (o instanceof PyInstance) {
        const v = o.dict.get(name);
        if (v !== undefined) return v;
        const cv = classLookup(o.cls, name);
        if (cv !== undefined) return this.bindAttr(cv, o, o.cls);
        if (o.cls.isExc && name === 'args') return o.args;
        if (name === '__class__') return o.cls;
        if (name === '__dict__') { const d = new PyDict(); for (const [k, x] of o.dict) dset(d, k, x); return d; }
        const ga = classLookup(o.cls, '__getattr__');
        if (ga) return this.call(ga, [o, name], null);
        const near = nearest(name, [...o.dict.keys(), ...o.cls.mro.flatMap((c) => [...c.dict.keys()])]);
        throw err('AttributeError', `'${o.cls.name}' object has no attribute '${name}'` + (near ? `. Did you mean: '${near}'?` : ''));
      }
      if (o instanceof PyModule) {
        const v = o.dict.get(name);
        if (v !== undefined) return v;
        if (name === '__name__') return o.name;
        const near = nearest(name, [...o.dict.keys()]);
        throw err('AttributeError', `module '${o.name}' has no attribute '${name}'` + (near ? `. Did you mean: '${near}'?` : ''));
      }
      if (o instanceof PyClass) {
        const cv = classLookup(o, name);
        if (cv !== undefined) {
          if (cv instanceof PyStatic) return cv.fn;
          if (cv instanceof PyClassMethod) return new PyBound(o, cv.fn);
          return cv;
        }
        if (name === '__name__') return o.name;
        if (name === '__mro__') return tuple(o.mro.slice());
        if (name === '__bases__') return tuple(o.bases.slice());
        if (o.methods && o.methods[name]) {
          const m = o.methods[name];
          return new PyBuiltin(name, function (args, kw) {
            if (!args.length) throw err('TypeError', `unbound method ${o.name}.${name}() needs an argument`);
            return m.call(this, args.slice(1), kw, args[0]);
          });
        }
        if (o.statics && o.statics[name]) return o.statics[name];
        throw err('AttributeError', `type object '${o.name}' has no attribute '${name}'`);
      }
      if (o instanceof PySuper) {
        const mro = o.obj instanceof PyClass ? o.obj.mro : o.obj.cls.mro;
        const i = mro.indexOf(o.cls);
        for (let j = i + 1; j < mro.length; j++) {
          const v = mro[j].dict.get(name);
          if (v !== undefined) return this.bindAttr(v, o.obj, o.obj instanceof PyClass ? o.obj : o.obj.cls);
        }
        throw err('AttributeError', `'super' object has no attribute '${name}'`);
      }
      const tbl = methodsOf(o);
      if (tbl && tbl[name]) return new PyBuiltin(name, tbl[name], o);
      if (name === '__class__') return typeOf(o);
      if (o instanceof PyFunction) {
        if (name === '__name__') return o.name;
        if (name === '__doc__') return null;
        if (o.dict && o.dict.has(name)) return o.dict.get(name);
      }
      if (o instanceof PyBuiltin && name === '__name__') return o.name;
      if (o instanceof PyProperty && (name === 'setter' || name === 'getter')) {
        return new PyBuiltin(name, (args) => (name === 'setter' ? new PyProperty(o.fget, args[0]) : new PyProperty(args[0], o.fset)));
      }
      if (typeof o === 'bigint' || typeof o === 'boolean') {
        if (name === 'real' || name === 'numerator') return toBig(o);
        if (name === 'imag') return 0n;
        if (name === 'denominator') return 1n;
      }
      if (typeof o === 'number') { if (name === 'real') return o; if (name === 'imag') return 0; }
      const near = tbl ? nearest(name, Object.keys(tbl)) : null;
      throw err('AttributeError', `'${typeName(o)}' object has no attribute '${name}'` + (near ? `. Did you mean: '${near}'?` : ''));
    }
    bindAttr(cv, inst, cls) {
      if (cv instanceof PyFunction) return new PyBound(inst, cv);
      if (cv instanceof PyStatic) return cv.fn;
      if (cv instanceof PyClassMethod) return new PyBound(cls, cv.fn);
      if (cv instanceof PyProperty) return this.call(cv.fget, [inst], null);
      if (cv instanceof PyBuiltin && cv.method) return new PyBuiltin(cv.name, cv.fn, inst);
      return cv;
    }
    setattr(o, name, v) {
      if (o instanceof PyInstance) {
        const cv = classLookup(o.cls, name);
        if (cv instanceof PyProperty) {
          if (!cv.fset) throw err('AttributeError', `property '${name}' of '${o.cls.name}' object has no setter`);
          this.call(cv.fset, [o, v], null);
          return;
        }
        if (o.cls.isExc && name === 'args') { o.args = tuple(this.toArray(v)); return; }
        o.dict.set(name, v);
        return;
      }
      if (o instanceof PyClass && !o.builtin) { o.dict.set(name, v); return; }
      if (o instanceof PyModule) { o.dict.set(name, v); return; }
      if (o instanceof PyFunction) { (o.dict = o.dict || new Map()).set(name, v); return; }
      throw err('AttributeError', `'${typeName(o)}' object has no attribute '${name}' (and it can't be given one)`);
    }

    /* items */
    index(i, n, what) {
      if (typeof i === 'boolean') i = i ? 1n : 0n;
      if (typeof i !== 'bigint') {
        if (i instanceof PyInstance && classLookup(i.cls, '__index__')) i = this.callMethod(i, '__index__', []);
        else throw err('TypeError', `${what} indices must be integers or slices, not ${typeName(i)}`);
      }
      let k = Number(i);
      if (k < 0) k += n;
      return k;
    }
    slice(sl, n) {
      const num = (v, name) => {
        if (v === null) return null;
        if (isInt(v)) return Number(toBig(v));
        if (v instanceof PyInstance && classLookup(v.cls, '__index__')) return Number(this.callMethod(v, '__index__', []));
        throw err('TypeError', 'slice indices must be integers or None or have an __index__ method');
      };
      let step = num(sl.step);
      if (step === 0) throw err('ValueError', 'slice step cannot be zero');
      if (step === null) step = 1;
      let lo = num(sl.lo), hi = num(sl.hi);
      if (step > 0) {
        lo = lo === null ? 0 : lo < 0 ? Math.max(0, lo + n) : Math.min(lo, n);
        hi = hi === null ? n : hi < 0 ? Math.max(0, hi + n) : Math.min(hi, n);
      } else {
        lo = lo === null ? n - 1 : lo < 0 ? Math.max(-1, lo + n) : Math.min(lo, n - 1);
        hi = hi === null ? -1 : hi < 0 ? Math.max(-1, hi + n) : Math.min(hi, n - 1);
      }
      return [lo, hi, step];
    }
    sliced(arr, sl) {
      const [lo, hi, step] = this.slice(sl, arr.length);
      if (step === 1) return arr.slice(lo, Math.max(lo, hi));
      const out = [];
      if (step > 0) for (let i = lo; i < hi; i += step) out.push(arr[i]);
      else for (let i = lo; i > hi; i += step) out.push(arr[i]);
      return out;
    }
    getitem(o, k) {
      if (Array.isArray(o)) {
        if (k instanceof PySlice) return this.sliced(o, k);
        const i = this.index(k, o.length, 'list');
        if (i < 0 || i >= o.length) throw err('IndexError', 'list index out of range');
        return o[i];
      }
      if (typeof o === 'string') {
        const sur = hasSur(o);
        const chars = sur ? Array.from(o) : null;
        const n = sur ? chars.length : o.length;
        if (k instanceof PySlice) {
          const [lo, hi, step] = this.slice(k, n);
          if (step === 1 && !sur) return o.slice(lo, Math.max(lo, hi));
          return this.sliced(chars || o.split(''), k).join('');
        }
        const i = this.index(k, n, 'string');
        if (i < 0 || i >= n) throw err('IndexError', 'string index out of range');
        return sur ? chars[i] : o[i];
      }
      if (o instanceof PyDict) {
        const v = dget(o, k);
        if (v === undefined) throw new Raise(newExc(EXC.KeyError, [k]), this.line);
        return v;
      }
      if (o instanceof PyTuple) {
        if (k instanceof PySlice) return tuple(this.sliced(o.v, k));
        const i = this.index(k, o.v.length, 'tuple');
        if (i < 0 || i >= o.v.length) throw err('IndexError', 'tuple index out of range');
        return o.v[i];
      }
      if (o instanceof PyRange) {
        const n = Number(o.size);
        if (k instanceof PySlice) {
          const [lo, hi, step] = this.slice(k, n);
          const st = o.step * BigInt(step);
          const start = o.start + o.step * BigInt(lo);
          const stop = o.start + o.step * BigInt(hi);
          return new PyRange(start, stop, st);
        }
        const i = this.index(k, n, 'range object');
        if (i < 0 || i >= n) throw err('IndexError', 'range object index out of range');
        return o.start + o.step * BigInt(i);
      }
      if (o instanceof PyInstance) {
        const m = classLookup(o.cls, '__getitem__');
        if (m) return this.call(m, [o, k], null);
      }
      if (o instanceof PyClass && (o === LIST || o === DICT || o === TUPLE || o === SET || o === TYPE)) return o; // list[int] in type hints
      throw err('TypeError', `'${typeName(o)}' object is not subscriptable`);
    }
    setitem(o, k, v) {
      if (Array.isArray(o)) {
        if (k instanceof PySlice) {
          const items = this.toArray(v);
          const [lo, hi, step] = this.slice(k, o.length);
          if (step === 1) { o.splice(lo, Math.max(0, hi - lo), ...items); return; }
          const idx = [];
          if (step > 0) for (let i = lo; i < hi; i += step) idx.push(i); else for (let i = lo; i > hi; i += step) idx.push(i);
          if (idx.length !== items.length) throw err('ValueError', `attempt to assign sequence of size ${items.length} to extended slice of size ${idx.length}`);
          idx.forEach((i, j) => { o[i] = items[j]; });
          return;
        }
        const i = this.index(k, o.length, 'list');
        if (i < 0 || i >= o.length) throw err('IndexError', 'list assignment index out of range');
        o[i] = v;
        return;
      }
      if (o instanceof PyDict) { dset(o, k, v); return; }
      if (o instanceof PyInstance) {
        const m = classLookup(o.cls, '__setitem__');
        if (m) { this.call(m, [o, k, v], null); return; }
      }
      throw err('TypeError', `'${typeName(o)}' object does not support item assignment`);
    }
    delitem(o, k) {
      if (Array.isArray(o)) {
        if (k instanceof PySlice) {
          const [lo, hi, step] = this.slice(k, o.length);
          if (step === 1) { o.splice(lo, Math.max(0, hi - lo)); return; }
          const idx = [];
          if (step > 0) for (let i = lo; i < hi; i += step) idx.push(i); else for (let i = lo; i > hi; i += step) idx.push(i);
          idx.sort((a, b) => b - a).forEach((i) => o.splice(i, 1));
          return;
        }
        const i = this.index(k, o.length, 'list');
        if (i < 0 || i >= o.length) throw err('IndexError', 'list assignment index out of range');
        o.splice(i, 1);
        return;
      }
      if (o instanceof PyDict) {
        const h = hkey(k);
        if (!o.m.has(h)) throw new Raise(newExc(EXC.KeyError, [k]), this.line);
        o.m.delete(h);
        return;
      }
      if (o instanceof PyInstance) {
        const m = classLookup(o.cls, '__delitem__');
        if (m) { this.call(m, [o, k], null); return; }
      }
      throw err('TypeError', `'${typeName(o)}' object doesn't support item deletion`);
    }

    /* iteration: a function that gives the next value, or DONE */
    iter(v) {
      if (Array.isArray(v)) { let i = 0; return () => (i < v.length ? v[i++] : DONE); }
      if (v instanceof PyRange) {
        let cur = v.start;
        const stop = v.stop, step = v.step;
        if (step > 0n) return () => { if (cur >= stop) return DONE; const r = cur; cur += step; return r; };
        return () => { if (cur <= stop) return DONE; const r = cur; cur += step; return r; };
      }
      if (typeof v === 'string') {
        const a = hasSur(v) ? Array.from(v) : v;
        let i = 0;
        return () => (i < a.length ? a[i++] : DONE);
      }
      if (v instanceof PyTuple) { const a = v.v; let i = 0; return () => (i < a.length ? a[i++] : DONE); }
      if (v instanceof PyDict) {
        const it = v.m.values(), size = v.m.size;
        return () => {
          if (v.m.size !== size) throw err('RuntimeError', 'dictionary changed size during iteration');
          const r = it.next();
          return r.done ? DONE : r.value[0];
        };
      }
      if (v instanceof PySet) { const a = setItems(v); let i = 0; return () => (i < a.length ? a[i++] : DONE); }
      if (v instanceof PyIter) return v.nx;
      if (v instanceof PyView) {
        const it = v.d.m.values(), kind = v.kind;
        return () => {
          const r = it.next();
          if (r.done) return DONE;
          return kind === 'keys' ? r.value[0] : kind === 'values' ? r.value[1] : tuple([r.value[0], r.value[1]]);
        };
      }
      if (v instanceof PyInstance) {
        const im = classLookup(v.cls, '__iter__');
        if (im) {
          const it = this.call(im, [v], null);
          if (it instanceof PyInstance) {
            const nm = classLookup(it.cls, '__next__');
            if (!nm) throw err('TypeError', `iter() returned non-iterator of type '${typeName(it)}'`);
            return () => {
              try { return this.call(nm, [it], null); } catch (e) {
                if (e instanceof Raise && isSub(e.exc.cls, EXC.StopIteration)) return DONE;
                throw e;
              }
            };
          }
          return this.iter(it);
        }
        const gm = classLookup(v.cls, '__getitem__');
        if (gm) {
          let i = 0n;
          return () => {
            try { return this.call(gm, [v, i++], null); } catch (e) {
              if (e instanceof Raise && (isSub(e.exc.cls, EXC.IndexError) || isSub(e.exc.cls, EXC.StopIteration))) return DONE;
              throw e;
            }
          };
        }
      }
      throw err('TypeError', `'${typeName(v)}' object is not iterable`);
    }
    // every value of an iterable, as an array (a new one; or the list itself when "same" is allowed)
    toArray(v, same) {
      if (Array.isArray(v)) return same ? v : v.slice();
      if (v instanceof PyTuple) return same ? v.v : v.v.slice();
      if (typeof v === 'string' && !hasSur(v)) return v.split('');
      if (v instanceof PyRange) {
        const n = v.size;
        if (n > BigInt(LIMITS.list)) throw new Halt('memory');
        this.tick(Number(n));
      }
      const nx = this.iter(v), out = [];
      for (;;) {
        const x = nx();
        if (x === DONE) return out;
        out.push(x);
        if ((out.length & 1023) === 0) { this.tick(1024); if (out.length > LIMITS.list) throw new Halt('memory'); }
      }
    }
    grow(n) { if (n > LIMITS.list) throw new Halt('memory'); }

    truthy(v) {
      if (v === true) return true;
      if (v === false || v === null) return false;
      switch (typeof v) {
        case 'bigint': return v !== 0n;
        case 'number': return v !== 0;
        case 'string': return v.length > 0;
      }
      if (Array.isArray(v)) return v.length > 0;
      if (v instanceof PyTuple) return v.v.length > 0;
      if (v instanceof PyDict || v instanceof PySet) return v.m.size > 0;
      if (v instanceof PyRange) return v.size > 0n;
      if (v instanceof PyView) return v.d.m.size > 0;
      if (v instanceof PyInstance) {
        const b = classLookup(v.cls, '__bool__');
        if (b) { const r = this.call(b, [v], null); if (typeof r !== 'boolean') throw err('TypeError', `__bool__ should return bool, returned ${typeName(r)}`); return r; }
        const l = classLookup(v.cls, '__len__');
        if (l) return this.truthy(this.call(l, [v], null));
      }
      return true;
    }
    len(v) {
      if (typeof v === 'string') return hasSur(v) ? Array.from(v).length : v.length;
      if (Array.isArray(v)) return v.length;
      if (v instanceof PyTuple) return v.v.length;
      if (v instanceof PyDict || v instanceof PySet) return v.m.size;
      if (v instanceof PyRange) return Number(v.size);
      if (v instanceof PyView) return v.d.m.size;
      if (v instanceof PyInstance) {
        const l = classLookup(v.cls, '__len__');
        if (l) { const r = this.call(l, [v], null); if (!isInt(r)) throw err('TypeError', `'${typeName(r)}' object cannot be interpreted as an integer`); return Number(r); }
      }
      throw err('TypeError', `object of type '${typeName(v)}' has no len()`);
    }

    /* operators */
    binop(op, a, b) {
      let ta = typeof a, tb = typeof b;
      if (ta === 'bigint' && tb === 'bigint') return intOp(op, a, b);
      if (ta === 'boolean' && tb === 'boolean' && (op === '&' || op === '|' || op === '^')) {
        return op === '&' ? a && b : op === '|' ? a || b : a !== b;
      }
      if ((ta === 'bigint' || ta === 'boolean') && (tb === 'bigint' || tb === 'boolean')) return intOp(op, toBig(a), toBig(b));
      if ((ta === 'number' || ta === 'bigint' || ta === 'boolean') && (tb === 'number' || tb === 'bigint' || tb === 'boolean')) {
        if (op === '&' || op === '|' || op === '^' || op === '<<' || op === '>>') throw this.opError(op, a, b);
        return floatOp(op, Number(a), Number(b));
      }
      switch (op) {
        case '+':
          if (ta === 'string' && tb === 'string') {
            if (a.length + b.length > LIMITS.str) throw new Halt('memory');
            return a + b;
          }
          if (Array.isArray(a) && Array.isArray(b)) { this.grow(a.length + b.length); return a.concat(b); }
          if (a instanceof PyTuple && b instanceof PyTuple) return tuple(a.v.concat(b.v));
          break;
        case '*': {
          let seq = null, n = null;
          if (isInt(b) && (ta === 'string' || Array.isArray(a) || a instanceof PyTuple)) { seq = a; n = b; } else if (isInt(a) && (tb === 'string' || Array.isArray(b) || b instanceof PyTuple)) { seq = b; n = a; }
          if (seq !== null) {
            let k = Number(toBig(n));
            if (k < 0) k = 0;
            const len = typeof seq === 'string' ? seq.length : Array.isArray(seq) ? seq.length : seq.v.length;
            if (len * k > (typeof seq === 'string' ? LIMITS.str : LIMITS.list)) throw new Halt('memory');
            this.tick(Math.floor(len * k / 64));
            if (typeof seq === 'string') return seq.repeat(k);
            const src = Array.isArray(seq) ? seq : seq.v;
            const out = [];
            for (let i = 0; i < k; i++) for (const x of src) out.push(x);
            return Array.isArray(seq) ? out : tuple(out);
          }
          break;
        }
        case '%':
          if (ta === 'string') return this.percent(a, b);
          break;
        case '|': case '&': case '-': case '^':
          if (a instanceof PySet && b instanceof PySet) return setOp(op, a, b);
          if (a instanceof PyView && b instanceof PySet) return setOp(op, this.toSet(a), b);
          if (op === '|' && a instanceof PyDict && b instanceof PyDict) {
            const d = new PyDict();
            for (const [k, v] of a.m.values()) dset(d, k, v);
            for (const [k, v] of b.m.values()) dset(d, k, v);
            return d;
          }
          break;
      }
      const name = DUNDER[op];
      if (a instanceof PyInstance) {
        const f = classLookup(a.cls, name);
        if (f) { const r = this.call(f, [a, b], null); if (r !== NOT_IMPL) return r; }
      }
      if (b instanceof PyInstance) {
        const f = classLookup(b.cls, '__r' + name.slice(2));
        if (f) { const r = this.call(f, [b, a], null); if (r !== NOT_IMPL) return r; }
      }
      throw this.opError(op, a, b);
    }
    opError(op, a, b) {
      if (op === '+' && (typeof a === 'string' || Array.isArray(a) || a instanceof PyTuple)) {
        return err('TypeError', `can only concatenate ${typeName(a)} (not "${typeName(b)}") to ${typeName(a)}`);
      }
      if (op === '*' && (typeof a === 'string' || Array.isArray(a)) && typeof b === 'number') return err('TypeError', `can't multiply sequence by non-int of type 'float'`);
      if (op === '*' && (typeof a === 'string' || Array.isArray(a)) && (typeof b === 'string' || Array.isArray(b))) return err('TypeError', `can't multiply sequence by non-int of type '${typeName(b)}'`);
      return err('TypeError', `unsupported operand type(s) for ${op === '**' ? '** or pow()' : op}: '${typeName(a)}' and '${typeName(b)}'`);
    }
    unary(op, v) {
      if (typeof v === 'boolean') v = v ? 1n : 0n;
      if (typeof v === 'bigint') return op === '-' ? -v : op === '+' ? v : ~v;
      if (typeof v === 'number') { if (op === '~') throw err('TypeError', "bad operand type for unary ~: 'float'"); return op === '-' ? -v : v; }
      if (v instanceof PyInstance) {
        const f = classLookup(v.cls, op === '-' ? '__neg__' : op === '+' ? '__pos__' : '__invert__');
        if (f) return this.call(f, [v], null);
      }
      throw err('TypeError', `bad operand type for unary ${op}: '${typeName(v)}'`);
    }
    compare(op, a, b) {
      switch (op) {
        case '==': return this.eq(a, b);
        case '!=': return !this.eq(a, b);
        case '<': case '>': case '<=': case '>=': return this.order(op, a, b);
        case 'in': return this.contains(b, a);
        case 'not in': return !this.contains(b, a);
        case 'is': return a === b || (a !== null && typeof a !== 'object' && typeof a !== 'function' && typeof a === typeof b && a === b);
        case 'is not': return !(a === b);
      }
      return false;
    }
    eq(a, b) {
      if (a === b) return typeof a !== 'number' || !Number.isNaN(a);
      const ta = typeof a, tb = typeof b;
      if ((ta === 'bigint' || ta === 'number' || ta === 'boolean') && (tb === 'bigint' || tb === 'number' || tb === 'boolean')) return a == b; // eslint-disable-line eqeqeq
      if (ta === 'string' || tb === 'string') return false;
      if (a === null || b === null) return false;
      if (a instanceof PyInstance || b instanceof PyInstance) {
        if (a instanceof PyInstance) {
          const f = classLookup(a.cls, '__eq__');
          if (f) { const r = this.call(f, [a, b], null); if (r !== NOT_IMPL) return this.truthy(r); }
        }
        if (b instanceof PyInstance) {
          const f = classLookup(b.cls, '__eq__');
          if (f) { const r = this.call(f, [b, a], null); if (r !== NOT_IMPL) return this.truthy(r); }
        }
        return false;
      }
      if (Array.isArray(a) && Array.isArray(b)) return this.seqEq(a, b);
      if (a instanceof PyTuple && b instanceof PyTuple) return this.seqEq(a.v, b.v);
      if (a instanceof PyDict && b instanceof PyDict) {
        if (a.m.size !== b.m.size) return false;
        for (const [h, [, v]] of a.m) { const e = b.m.get(h); if (!e || !this.eq(v, e[1])) return false; }
        return true;
      }
      if (a instanceof PySet && b instanceof PySet) {
        if (a.m.size !== b.m.size) return false;
        for (const h of a.m.keys()) if (!b.m.has(h)) return false;
        return true;
      }
      if (a instanceof PyRange && b instanceof PyRange) return this.seqEq(this.toArray(a), this.toArray(b));
      if (a instanceof PyView && b instanceof PyView && a.kind === 'keys' && b.kind === 'keys') return this.eq(this.toSet(a), this.toSet(b));
      if (a instanceof PyBound && b instanceof PyBound) return a.self === b.self && a.fn === b.fn;
      return false;
    }
    seqEq(x, y) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (!this.eq(x[i], y[i])) return false;
      return true;
    }
    order(op, a, b) {
      const ta = typeof a, tb = typeof b;
      if ((ta === 'bigint' || ta === 'number' || ta === 'boolean') && (tb === 'bigint' || tb === 'number' || tb === 'boolean')) {
        if (ta === 'boolean') a = a ? 1n : 0n;
        if (tb === 'boolean') b = b ? 1n : 0n;
        return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      }
      if (ta === 'string' && tb === 'string') return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      const seqs = (Array.isArray(a) && Array.isArray(b)) ? [a, b] : (a instanceof PyTuple && b instanceof PyTuple) ? [a.v, b.v] : null;
      if (seqs) {
        const [x, y] = seqs;
        const n = Math.min(x.length, y.length);
        for (let i = 0; i < n; i++) if (!this.eq(x[i], y[i])) return this.order(op, x[i], y[i]);
        return op === '<' ? x.length < y.length : op === '>' ? x.length > y.length : op === '<=' ? x.length <= y.length : x.length >= y.length;
      }
      if (a instanceof PySet && b instanceof PySet) {
        const sub = (p, q) => [...p.m.keys()].every((h) => q.m.has(h));
        if (op === '<=') return sub(a, b);
        if (op === '>=') return sub(b, a);
        if (op === '<') return a.m.size < b.m.size && sub(a, b);
        return a.m.size > b.m.size && sub(b, a);
      }
      const name = { '<': '__lt__', '>': '__gt__', '<=': '__le__', '>=': '__ge__' }[op];
      const rname = { '<': '__gt__', '>': '__lt__', '<=': '__ge__', '>=': '__le__' }[op];
      if (a instanceof PyInstance) {
        const f = classLookup(a.cls, name);
        if (f) { const r = this.call(f, [a, b], null); if (r !== NOT_IMPL) return this.truthy(r); }
      }
      if (b instanceof PyInstance) {
        const f = classLookup(b.cls, rname);
        if (f) { const r = this.call(f, [b, a], null); if (r !== NOT_IMPL) return this.truthy(r); }
      }
      throw err('TypeError', `'${op}' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
    }
    contains(c, x) {
      if (typeof c === 'string') {
        if (typeof x !== 'string') throw err('TypeError', `'in <string>' requires string as left operand, not ${typeName(x)}`);
        return c.includes(x);
      }
      if (Array.isArray(c)) { for (const y of c) if (this.eq(y, x)) return true; return false; }
      if (c instanceof PyTuple) { for (const y of c.v) if (this.eq(y, x)) return true; return false; }
      if (c instanceof PyDict) return c.m.has(hkey(x));
      if (c instanceof PySet) return c.m.has(hkey(x));
      if (c instanceof PyRange) {
        if (!isNum(x)) return false;
        if (typeof x === 'number') { if (!Number.isInteger(x)) return false; x = BigInt(x); }
        x = toBig(x);
        const { start, stop, step } = c;
        if (step > 0n ? x < start || x >= stop : x > start || x <= stop) return false;
        return (x - start) % step === 0n;
      }
      if (c instanceof PyView) {
        if (c.kind === 'keys') return c.d.m.has(hkey(x));
        for (const y of this.toArray(c)) if (this.eq(y, x)) return true;
        return false;
      }
      if (c instanceof PyInstance) {
        const f = classLookup(c.cls, '__contains__');
        if (f) return this.truthy(this.call(f, [c, x], null));
      }
      if (c instanceof PyIter || c instanceof PyInstance) {
        const nx = this.iter(c);
        for (;;) { const y = nx(); if (y === DONE) return false; if (this.eq(y, x)) return true; }
      }
      throw err('TypeError', `argument of type '${typeName(c)}' is not iterable`);
    }
    toSet(v) { const s = new PySet(); for (const x of this.toArray(v)) sadd(s, x); return s; }

    /* text */
    str(v) {
      if (typeof v === 'string') return v;
      if (v instanceof PyInstance) {
        const f = classLookup(v.cls, '__str__');
        if (f && f !== OBJECT_STR) {
          const r = this.call(f, [v], null);
          if (typeof r !== 'string') throw err('TypeError', `__str__ returned non-string (type ${typeName(r)})`);
          return r;
        }
        if (v.cls.isExc) {
          const a = v.args ? v.args.v : [];
          if (isSub(v.cls, EXC.KeyError) && a.length === 1) return this.repr(a[0]);
          return a.length === 0 ? '' : a.length === 1 ? this.str(a[0]) : this.repr(v.args);
        }
      }
      return this.repr(v);
    }
    repr(v) {
      if (v === null) return 'None';
      switch (typeof v) {
        case 'boolean': return v ? 'True' : 'False';
        case 'bigint': return intStr(v);
        case 'number': return floatRepr(v);
        case 'string': return strRepr(v);
      }
      if (++this.reprDepth > 60) { this.reprDepth--; throw err('RecursionError', 'maximum recursion depth exceeded while getting the repr of an object'); }
      try {
        if (Array.isArray(v)) {
          if (this.reprSeen(v)) return '[...]';
          try { return '[' + v.map((x) => this.repr(x)).join(', ') + ']'; } finally { this.reprSeen(v, true); }
        }
        if (v instanceof PyTuple) return v.v.length === 1 ? '(' + this.repr(v.v[0]) + ',)' : '(' + v.v.map((x) => this.repr(x)).join(', ') + ')';
        if (v instanceof PyDict) {
          if (this.reprSeen(v)) return '{...}';
          try { return '{' + [...v.m.values()].map(([k, x]) => this.repr(k) + ': ' + this.repr(x)).join(', ') + '}'; } finally { this.reprSeen(v, true); }
        }
        if (v instanceof PySet) {
          const items = setItems(v).map((x) => this.repr(x));
          if (v.frozen) return 'frozenset(' + (items.length ? '{' + items.join(', ') + '}' : '') + ')';
          return items.length ? '{' + items.join(', ') + '}' : 'set()';
        }
        if (v instanceof PyRange) return v.step === 1n ? `range(${v.start}, ${v.stop})` : `range(${v.start}, ${v.stop}, ${v.step})`;
        if (v instanceof PyInstance) {
          const f = classLookup(v.cls, '__repr__');
          if (f && f !== OBJECT_REPR) {
            const r = this.call(f, [v], null);
            if (typeof r !== 'string') throw err('TypeError', `__repr__ returned non-string (type ${typeName(r)})`);
            return r;
          }
          if (v.cls.isExc) return v.cls.name + '(' + (v.args ? v.args.v.map((x) => this.repr(x)).join(', ') : '') + ')';
          return `<${v.cls.module === 'builtins' ? '' : v.cls.module + '.'}${v.cls.name} object at 0x${(0x7f3a00000000 + idOf(v) * 16).toString(16)}>`;
        }
        if (v instanceof PyFunction) return v.name === '<lambda>' ? `<function <lambda> at 0x${(0x7f3a10000000 + idOf(v) * 16).toString(16)}>` : `<function ${v.qual} at 0x${(0x7f3a10000000 + idOf(v) * 16).toString(16)}>`;
        if (v instanceof PyBuiltin) return v.self !== null && v.self !== undefined ? `<built-in method ${v.name} of ${typeName(v.self)} object>` : `<built-in function ${v.name}>`;
        if (v instanceof PyBound) return `<bound method ${v.fn.qual || v.fn.name} of ${this.repr(v.self)}>`;
        if (v instanceof PyClass) return `<class '${v.module === 'builtins' ? '' : v.module + '.'}${v.name}'>`;
        if (v instanceof PyModule) return `<module '${v.name}'>`;
        if (v instanceof PyIter) return `<${v.name} object at 0x${(0x7f3a20000000 + idOf(v) * 16).toString(16)}>`;
        if (v instanceof PyView) return `dict_${v.kind}([${this.toArray(v).map((x) => this.repr(x)).join(', ')}])`;
        if (v instanceof PySlice) return `slice(${this.repr(v.lo)}, ${this.repr(v.hi)}, ${this.repr(v.step)})`;
        if (v instanceof PyTurtle) return '<turtle.Turtle object>';
        if (v instanceof PyScreen) return '<turtle._Screen object>';
        if (v === ELLIPSIS) return 'Ellipsis';
        if (v === NOT_IMPL) return 'NotImplemented';
        return '<object>';
      } finally { this.reprDepth--; }
    }
    reprSeen(v, done) {
      if (!this.seen) this.seen = new Set();
      if (done) { this.seen.delete(v); return false; }
      if (this.seen.has(v)) return true;
      this.seen.add(v);
      return false;
    }

    // format(value, spec), as f"{x:>8.2f}" and str.format write
    format(v, spec) {
      if (v instanceof PyInstance) {
        const f = classLookup(v.cls, '__format__');
        if (f) return this.call(f, [v, spec], null);
        if (!spec) return this.str(v);
        v = this.str(v);
      }
      if (!spec) return this.str(v);
      const m = /^(?:([\s\S])?([<>=^]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
      if (!m) throw err('ValueError', `Invalid format specifier '${spec}' for object of type '${typeName(v)}'`);
      let [, fill, align, sign, , alt, zero, width, grp, prec, type] = m;
      width = width ? Number(width) : 0;
      prec = prec != null ? Number(prec) : null;
      if (zero && !align) { fill = '0'; align = '='; }
      fill = fill || ' ';
      if (typeof v === 'boolean') { if (type && type !== 's') v = v ? 1n : 0n; else v = v ? 'True' : 'False'; }
      if (v === null || !isNum(v)) {
        if (typeof v !== 'string') v = this.str(v);
        if (type && type !== 's') throw err('ValueError', `Unknown format code '${type}' for object of type 'str'`);
        if (align === '=') throw err('ValueError', "'=' alignment not allowed in string format specifier");
        if (sign) throw err('ValueError', 'Sign not allowed in string format specifier');
        let s = prec != null ? Array.from(v).slice(0, prec).join('') : v;
        return pad(s, width, fill, align || '<');
      }
      let neg = false, body, prefix = '';
      if (typeof v === 'bigint' && (!type || 'bcdoxXn'.includes(type))) {
        if (prec != null) throw err('ValueError', 'Precision not allowed in integer format specifier');
        neg = v < 0n;
        const a = neg ? -v : v;
        switch (type) {
          case 'b': body = a.toString(2); if (alt) prefix = '0b'; break;
          case 'o': body = a.toString(8); if (alt) prefix = '0o'; break;
          case 'x': body = a.toString(16); if (alt) prefix = '0x'; break;
          case 'X': body = a.toString(16).toUpperCase(); if (alt) prefix = '0X'; break;
          case 'c': return pad(String.fromCodePoint(Number(v)), width, fill, align || '<');
          default: body = intStr(a); if (grp) body = group(body, grp);
        }
      } else {
        if (type === 'c' || (type && 'bdoxXn'.includes(type))) throw err('ValueError', `Unknown format code '${type}' for object of type '${typeName(v)}'`);
        let x = Number(v);
        neg = x < 0 || Object.is(x, -0);
        x = Math.abs(x);
        const p = prec == null ? 6 : prec;
        if (!Number.isFinite(x)) body = Number.isNaN(x) ? 'nan' : 'inf';
        else switch (type) {
          case 'f': case 'F': body = toFixedPy(x, p); break;
          case 'e': case 'E': body = expFix(x.toExponential(Math.min(p, 100))); break;
          case 'g': case 'G': body = fmtG(x, p, alt, false); break;
          case '%': body = toFixedPy(x * 100, p) + '%'; break;
          default:
            body = prec == null ? (typeof v === 'bigint' ? intStr(v < 0n ? -v : v) : floatRepr(x)) : fmtG(x, prec, alt, true);
        }
        if (type === 'F' || type === 'E' || type === 'G') body = body.toUpperCase();
        if (grp && Number.isFinite(x)) {
          const [ip, ...rest] = body.split('.');
          if (/^\d+$/.test(ip)) body = [group(ip, grp), ...rest].join('.');
        }
        if (neg && /^0(?:\.0*)?%?$/.test(body) && !Object.is(Number(v), -0) && !(Number(v) < 0)) neg = false;
      }
      const sg = neg ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
      if ((align || '>') === '=') {
        const n = width - sg.length - prefix.length - body.length;
        return sg + prefix + (n > 0 ? fill.repeat(n) : '') + body;
      }
      return pad(sg + prefix + body, width, fill, align || '>');
    }

    // "%d items cost %.2f" % (n, price)
    percent(fmt, arg) {
      const args = arg instanceof PyTuple ? arg.v.slice() : [arg];
      const map = arg instanceof PyDict ? arg : null;
      let ai = 0;
      const out = fmt.replace(/%(?:\(([^)]*)\))?([-+ #0]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfFgGcrsa%])/g, (all, key, flags, w, p, type) => {
        if (type === '%') return '%';
        const next = () => { if (ai >= args.length) throw err('TypeError', 'not enough arguments for format string'); return args[ai++]; };
        if (w === '*') w = String(next());
        if (p === '*') p = String(next());
        let v = key != null ? (map ? this.getitem(map, key) : next()) : (map && !(arg instanceof PyTuple) ? (ai++, map) : next());
        const left = flags.includes('-');
        const zero = flags.includes('0') && !left;
        const sign = flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        let spec;
        switch (type) {
          case 's': return pad(this.str(v), Number(w || 0), ' ', left ? '<' : '>');
          case 'r': case 'a': return pad(this.repr(v), Number(w || 0), ' ', left ? '<' : '>');
          case 'c': return pad(typeof v === 'string' ? v : String.fromCodePoint(Number(v)), Number(w || 0), ' ', left ? '<' : '>');
          case 'd': case 'i': case 'u':
            if (!isNum(v)) throw err('TypeError', `%${type} format: a real number is required, not ${typeName(v)}`);
            v = typeof v === 'number' ? BigInt(Math.trunc(v)) : toBig(v);
            spec = 'd'; break;
          case 'x': case 'X': case 'o':
            if (!isInt(v)) throw err('TypeError', `%${type} format: an integer is required, not ${typeName(v)}`);
            v = toBig(v); spec = type; break;
          default:
            if (!isNum(v)) throw err('TypeError', `must be real number, not ${typeName(v)}`);
            v = Number(v); spec = type;
            if (p == null) p = '6';
        }
        const f = (left ? '<' : zero ? '0' : '') + sign + (flags.includes('#') ? '#' : '') + (w || '') + (p != null && spec !== 'd' && spec !== 'x' && spec !== 'X' && spec !== 'o' ? '.' + p : '') + spec;
        return this.format(v, f.replace(/^0/, zero ? '0' : ''));
      });
      if (!map && ai < args.length) throw err('TypeError', 'not all arguments converted during string formatting');
      return out;
    }

    // "{} has {:.1f}".format(a, b)
    strFormat(fmt, args, kw) {
      let auto = 0;
      const field = (name) => {
        const m = /^([^.[]*)(.*)$/.exec(name);
        let v;
        const head = m[1];
        if (head === '') { if (auto < 0) throw err('ValueError', 'cannot switch from manual field specification to automatic field numbering'); v = args[auto++]; if (v === undefined) throw err('IndexError', `Replacement index ${auto - 1} out of range for positional args tuple`); } else if (/^\d+$/.test(head)) { auto = -1; v = args[Number(head)]; if (v === undefined) throw err('IndexError', `Replacement index ${head} out of range for positional args tuple`); } else {
          v = kw ? kw.get(head) : undefined;
          if (v === undefined) throw new Raise(newExc(EXC.KeyError, [head]), this.line);
        }
        const rest = m[2];
        const re = /\.(\w+)|\[([^\]]*)\]/g;
        let mm;
        while ((mm = re.exec(rest))) v = mm[1] != null ? this.getattr(v, mm[1]) : this.getitem(v, /^\d+$/.test(mm[2]) ? BigInt(mm[2]) : mm[2]);
        return v;
      };
      let out = '', i = 0;
      while (i < fmt.length) {
        const c = fmt[i];
        if (c === '{') {
          if (fmt[i + 1] === '{') { out += '{'; i += 2; continue; }
          let j = i + 1, depth = 0;
          for (; j < fmt.length; j++) { if (fmt[j] === '{') depth++; else if (fmt[j] === '}') { if (depth === 0) break; depth--; } }
          if (j >= fmt.length) throw err('ValueError', "Single '{' encountered in format string");
          const inner = fmt.slice(i + 1, j);
          const m = /^([^!:]*)(?:!([rsa]))?(?::([\s\S]*))?$/.exec(inner);
          if (!m) throw err('ValueError', 'unexpected character in format string');
          let v = field(m[1].trim());
          if (m[2] === 'r' || m[2] === 'a') v = this.repr(v); else if (m[2] === 's') v = this.str(v);
          const spec = m[3] ? m[3].replace(/\{([^{}]*)\}/g, (a, n) => this.str(field(n))) : '';
          out += this.format(v, spec);
          i = j + 1;
          continue;
        }
        if (c === '}') {
          if (fmt[i + 1] === '}') { out += '}'; i += 2; continue; }
          throw err('ValueError', "Single '}' encountered in format string");
        }
        out += c;
        i++;
      }
      return out;
    }

    /* input and output */
    print(s) { this.out.write(s, 'out'); }
    input(prompt) {
      this.asked = true;
      if (prompt) this.out.write(prompt, 'prompt');
      if (this.inPos >= this.stdin.length) throw err('EOFError', 'EOF when reading a line', { eof: true });
      const line = this.stdin[this.inPos++];
      this.out.write(line + '\n', 'echo');
      return line;
    }

    importModule(name) {
      let m = this.modules.get(name);
      if (m) return m;
      const make = MODULES[name];
      if (!make) {
        const near = nearest(name, Object.keys(MODULES));
        const known = { numpy: 1, pandas: 1, matplotlib: 1, requests: 1, tkinter: 1, pygame: 1, os: 1, sys: 1 };
        throw err('ModuleNotFoundError', `No module named '${name}'` + (near ? `. Did you mean: '${near}'?` : known[name.split('.')[0]] ? ' (only math, random, string, time and turtle are available here)' : ''));
      }
      m = new PyModule(name, make(this));
      this.modules.set(name, m);
      return m;
    }
  }

  const DUNDER = { '+': '__add__', '-': '__sub__', '*': '__mul__', '/': '__truediv__', '//': '__floordiv__', '%': '__mod__', '**': '__pow__', '@': '__matmul__', '&': '__and__', '|': '__or__', '^': '__xor__', '<<': '__lshift__', '>>': '__rshift__' };
  const NOT_IMPL = Object.freeze({ notImplemented: true });

  function nameList(names) {
    const q = names.map((n) => `'${n}'`);
    if (q.length === 1) return q[0];
    if (q.length === 2) return q[0] + ' and ' + q[1];
    return q.slice(0, -1).join(', ') + ', and ' + q[q.length - 1];
  }
  function pad(s, width, fill, align) {
    const len = Array.from(s).length;
    const n = width - len;
    if (n <= 0) return s;
    if (align === '<') return s + fill.repeat(n);
    if (align === '^') { const l = Math.floor(n / 2); return fill.repeat(l) + s + fill.repeat(n - l); }
    return fill.repeat(n) + s;
  }
  function strRepr(s) {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let out = q;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (ch === q || ch === '\\') out += '\\' + ch;
      else if (ch === '\n') out += '\\n';
      else if (ch === '\t') out += '\\t';
      else if (ch === '\r') out += '\\r';
      else if (c < 32 || c === 127) out += '\\x' + c.toString(16).padStart(2, '0');
      else out += ch;
    }
    return out + q;
  }
  const bigCheck = (r) => { if (r > BIG || r < -BIG) throw err('OverflowError', 'that number is too big to work out here'); return r; };
  function intOp(op, a, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return bigCheck(a * b);
      case '/':
        if (b === 0n) throw err('ZeroDivisionError', 'division by zero');
        return Number(a) / Number(b);
      case '//': {
        if (b === 0n) throw err('ZeroDivisionError', 'integer division or modulo by zero');
        let q = a / b;
        if (a % b !== 0n && (a < 0n) !== (b < 0n)) q -= 1n;
        return q;
      }
      case '%': {
        if (b === 0n) throw err('ZeroDivisionError', 'integer modulo by zero');
        let r = a % b;
        if (r !== 0n && (r < 0n) !== (b < 0n)) r += b;
        return r;
      }
      case '**': {
        if (b < 0n) {
          if (a === 0n) throw err('ZeroDivisionError', '0.0 cannot be raised to a negative power');
          return Math.pow(Number(a), Number(b));
        }
        if (a === 0n || a === 1n) return b === 0n ? 1n : a;
        if (a === -1n) return b % 2n === 0n ? 1n : -1n;
        const bits = (a < 0n ? -a : a).toString(2).length;
        if (BigInt(bits) * b > BigInt(LIMITS.bits)) throw err('OverflowError', 'that number is too big to work out here');
        return a ** b;
      }
      case '<<':
        if (b < 0n) throw err('ValueError', 'negative shift count');
        if (b > BigInt(LIMITS.bits)) throw err('OverflowError', 'that number is too big to work out here');
        return bigCheck(a << b);
      case '>>':
        if (b < 0n) throw err('ValueError', 'negative shift count');
        return a >> b;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '@': break;
    }
    throw err('TypeError', `unsupported operand type(s) for ${op}: 'int' and 'int'`);
  }
  function floatOp(op, a, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': if (b === 0) throw err('ZeroDivisionError', 'float division by zero'); return a / b;
      case '//': if (b === 0) throw err('ZeroDivisionError', 'float floor division by zero'); return Math.floor(a / b);
      case '%': {
        if (b === 0) throw err('ZeroDivisionError', 'float modulo');
        let r = a % b;
        if (r !== 0 && (r < 0) !== (b < 0)) r += b;
        return r;
      }
      case '**': {
        if (a === 0 && b < 0) throw err('ZeroDivisionError', '0.0 cannot be raised to a negative power');
        if (a < 0 && !Number.isInteger(b)) throw err('ValueError', 'a negative number to a fractional power gives a complex number, which is not available here');
        const r = Math.pow(a, b);
        if (!Number.isFinite(r) && Number.isFinite(a) && Number.isFinite(b)) throw err('OverflowError', "(34, 'Numerical result out of range')");
        return r;
      }
    }
    throw err('TypeError', `unsupported operand type(s) for ${op}: 'float' and 'float'`);
  }
  function setOp(op, a, b) {
    const out = new PySet();
    if (op === '|') { for (const [h, k] of a.m) out.m.set(h, k); for (const [h, k] of b.m) if (!out.m.has(h)) out.m.set(h, k); } else if (op === '&') { for (const [h, k] of a.m) if (b.m.has(h)) out.m.set(h, k); } else if (op === '-') { for (const [h, k] of a.m) if (!b.m.has(h)) out.m.set(h, k); } else { for (const [h, k] of a.m) if (!b.m.has(h)) out.m.set(h, k); for (const [h, k] of b.m) if (!a.m.has(h)) out.m.set(h, k); }
    return out;
  }
  const listNext = (a) => { let i = 0; return () => (i < a.length ? a[i++] : DONE); };

  /* =====================================================================
     Python: the built-ins
     ===================================================================== */

  const B = (name, fn) => new PyBuiltin(name, fn);
  // a built-in method kept in a class (object.__init__, BaseException.__init__): self comes first, or bound
  const methodB = (name, fn) => {
    const b = new PyBuiltin(name, function (args, kw, self) {
      if (self === null || self === undefined) { self = args[0]; args = args.slice(1); }
      return fn.call(this, args, kw, self);
    });
    b.method = true;
    return b;
  };
  function nargs(name, args, min, max) {
    const n = args.length;
    if (n >= min && n <= max) return;
    if (min === max) throw err('TypeError', `${name}() takes exactly ${min === 1 ? 'one argument' : min + ' arguments'} (${n} given)`);
    if (n < min) throw err('TypeError', `${name}() takes at least ${min} argument${min === 1 ? '' : 's'} (${n} given)`);
    throw err('TypeError', `${name}() takes at most ${max} argument${max === 1 ? '' : 's'} (${n} given)`);
  }
  const kwGet = (kw, name, def) => (kw && kw.has(name) ? kw.get(name) : def);
  function noKw(name, kw, allowed) {
    if (!kw) return;
    for (const k of kw.keys()) if (!allowed || !allowed.includes(k)) throw err('TypeError', `${name}() got an unexpected keyword argument '${k}'`);
  }
  function asInt(v, what) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'boolean') return v ? 1n : 0n;
    if (v instanceof PyInstance && CUR && classLookup(v.cls, '__index__')) return asInt(CUR.callMethod(v, '__index__', []), what);
    throw err('TypeError', `'${typeName(v)}' object cannot be interpreted as an integer`);
  }
  function real(v, what) {
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint' || typeof v === 'boolean') return Number(toBig(v));
    if (v instanceof PyInstance && CUR && classLookup(v.cls, '__float__')) return CUR.callMethod(v, '__float__', []);
    throw err('TypeError', `must be real number, not ${typeName(v)}`);
  }
  function parseIntPy(s, base) {
    const bad = () => err('ValueError', `invalid literal for int() with base ${base}: ${strRepr(s)}`);
    let t = asciiDigits(s.trim());
    let neg = false;
    if (t[0] === '+' || t[0] === '-') { neg = t[0] === '-'; t = t.slice(1); }
    if (base === 0) {
      if (/^0[xX]/.test(t)) base = 16; else if (/^0[oO]/.test(t)) base = 8; else if (/^0[bB]/.test(t)) base = 2; else base = 10;
    }
    if ((base === 16 && /^0[xX]/.test(t)) || (base === 8 && /^0[oO]/.test(t)) || (base === 2 && /^0[bB]/.test(t))) t = t.slice(2).replace(/^_/, '');
    if (!t || /^_|_$|__/.test(t)) throw bad();
    t = t.replace(/_/g, '');
    if (base < 2 || base > 36) throw err('ValueError', 'int() base must be >= 2 and <= 36, or 0');
    let v = 0n;
    const B2 = BigInt(base);
    for (const ch of t.toLowerCase()) {
      const d = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch >= 'a' && ch <= 'z' ? ch.charCodeAt(0) - 87 : 99;
      if (d >= base) throw bad();
      v = v * B2 + BigInt(d);
    }
    if (t.length > 4300) throw err('ValueError', 'Exceeds the limit (4300 digits) for integer string conversion');
    return neg ? -v : v;
  }
  function parseFloatPy(s) {
    const t = asciiDigits(s.trim());
    if (/^[+-]?(?:inf|infinity)$/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    if (/^[+-]?nan$/i.test(t)) return NaN;
    if (/^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/.test(t)) return parseFloat(t.replace(/_/g, ''));
    throw err('ValueError', `could not convert string to float: ${strRepr(s)}`);
  }
  function roundPy(x, nd) {
    if (nd === null) {
      if (typeof x === 'bigint' || typeof x === 'boolean') return toBig(x);
      if (!Number.isFinite(x)) throw err(Number.isNaN(x) ? 'ValueError' : 'OverflowError', Number.isNaN(x) ? 'cannot convert float NaN to integer' : 'cannot convert float infinity to integer');
      let r = Math.round(x);
      if (Math.abs(x % 1) === 0.5) r = 2 * Math.round(x / 2);
      return BigInt(r);
    }
    const n = Number(asInt(nd));
    if (typeof x === 'bigint' || typeof x === 'boolean') {
      x = toBig(x);
      if (n >= 0) return x;
      const p = 10n ** BigInt(-n);
      let q = x / p, r = x % p;
      if (r < 0n) { r += p; q -= 1n; }
      if (r * 2n > p || (r * 2n === p && q % 2n !== 0n)) q += 1n;
      return q * p;
    }
    if (!Number.isFinite(x)) return x;
    if (n > 15) return x;
    if (n >= 0) return parseFloat(toFixedPy(x, n));
    const p = Math.pow(10, -n);
    let r = Math.round(x / p);
    if (Math.abs((x / p) % 1) === 0.5) r = 2 * Math.round(x / p / 2);
    return r * p;
  }
  // a sum as Python 3.12 does it (floats added with compensation, so sum([0.1] * 10) is 1.0)
  function sumPy(py, items, start) {
    let total = start;
    let allNum = isNum(start);
    for (const x of items) if (!isNum(x)) { allNum = false; break; }
    if (allNum && items.some((x) => typeof x === 'number') || (allNum && typeof start === 'number')) {
      let s = 0, c = 0, ints = 0n;
      const add = (x) => { const t = s + x; c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s; s = t; };
      for (const x of [start, ...items]) { if (typeof x === 'number') add(x); else ints += toBig(x); }
      add(Number(ints));
      return s + c;
    }
    if (allNum) { let t = toBig(start); for (const x of items) t += toBig(x); return t; }
    for (const x of items) total = py.binop('+', total, x);
    return total;
  }

  const OBJECT_INIT = methodB('__init__', () => null);
  const OBJECT_STR = methodB('__str__', function (args, kw, self) { return this.repr(self); });
  const OBJECT_REPR = methodB('__repr__', function (args, kw, self) {
    return `<${self.cls.module}.${self.cls.name} object at 0x${(0x7f3a00000000 + idOf(self) * 16).toString(16)}>`;
  });
  OBJECT.dict.set('__init__', OBJECT_INIT);
  OBJECT.dict.set('__str__', OBJECT_STR);
  OBJECT.dict.set('__repr__', OBJECT_REPR);
  EXC.BaseException.dict.set('__init__', methodB('__init__', (args, kw, self) => { self.args = tuple(args.slice()); return null; }));

  INT.native = function (args, kw) {
    noKw('int', kw, ['base']);
    nargs('int', args, 0, 2);
    const base = kwGet(kw, 'base', args.length > 1 ? args[1] : null);
    if (!args.length) return 0n;
    const v = args[0];
    if (base !== null) {
      if (typeof v !== 'string') throw err('TypeError', "int() can't convert non-string with explicit base");
      return parseIntPy(v, Number(asInt(base)));
    }
    if (typeof v === 'bigint') return v;
    if (typeof v === 'boolean') return v ? 1n : 0n;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) throw err('ValueError', 'cannot convert float NaN to integer');
      if (!Number.isFinite(v)) throw err('OverflowError', 'cannot convert float infinity to integer');
      return BigInt(Math.trunc(v));
    }
    if (typeof v === 'string') return parseIntPy(v, 10);
    if (v instanceof PyInstance) {
      for (const m of ['__int__', '__index__', '__trunc__']) if (classLookup(v.cls, m)) return this.callMethod(v, m, []);
    }
    throw err('TypeError', `int() argument must be a string, a bytes-like object or a real number, not '${typeName(v)}'`);
  };
  FLOAT.native = function (args, kw) {
    noKw('float', kw);
    nargs('float', args, 0, 1);
    if (!args.length) return 0;
    const v = args[0];
    if (typeof v === 'number') return v;
    if (isInt(v)) { const r = Number(toBig(v)); if (!Number.isFinite(r)) throw err('OverflowError', 'int too large to convert to float'); return r; }
    if (typeof v === 'string') return parseFloatPy(v);
    if (v instanceof PyInstance && classLookup(v.cls, '__float__')) return this.callMethod(v, '__float__', []);
    throw err('TypeError', `float() argument must be a string or a real number, not '${typeName(v)}'`);
  };
  STR.native = function (args, kw) { nargs('str', args, 0, 3); return args.length ? this.str(args[0]) : ''; };
  BOOL.native = function (args) { nargs('bool', args, 0, 1); return args.length ? this.truthy(args[0]) : false; };
  LIST.native = function (args, kw) { noKw('list', kw); nargs('list', args, 0, 1); return args.length ? this.toArray(args[0]) : []; };
  TUPLE.native = function (args, kw) { noKw('tuple', kw); nargs('tuple', args, 0, 1); return args.length ? (args[0] instanceof PyTuple ? args[0] : tuple(this.toArray(args[0]))) : tuple([]); };
  SET.native = function (args, kw) { noKw('set', kw); nargs('set', args, 0, 1); return args.length ? this.toSet(args[0]) : new PySet(); };
  FROZENSET.native = function (args) { nargs('frozenset', args, 0, 1); const s = args.length ? this.toSet(args[0]) : new PySet(); s.frozen = true; return s; };
  DICT.native = function (args, kw) {
    nargs('dict', args, 0, 1);
    const d = new PyDict();
    if (args.length) dictUpdate(this, d, args[0]);
    if (kw) for (const [k, v] of kw) dset(d, k, v);
    return d;
  };
  RANGE.native = function (args, kw) {
    noKw('range', kw);
    if (!args.length) throw err('TypeError', 'range expected at least 1 argument, got 0');
    if (args.length > 3) throw err('TypeError', `range expected at most 3 arguments, got ${args.length}`);
    const n = args.map((a) => asInt(a));
    const [start, stop, step] = n.length === 1 ? [0n, n[0], 1n] : [n[0], n[1], n.length > 2 ? n[2] : 1n];
    if (step === 0n) throw err('ValueError', 'range() arg 3 must not be zero');
    return new PyRange(start, stop, step);
  };
  TYPE.native = function (args) {
    if (args.length === 1) return typeOf(args[0]);
    throw err('TypeError', 'type() with three arguments (making a class) is not available here: use a class statement');
  };
  SLICE.native = function (args) {
    nargs('slice', args, 1, 3);
    return args.length === 1 ? new PySlice(null, args[0], null) : new PySlice(args[0], args[1], args.length > 2 ? args[2] : null);
  };
  PROPERTY.native = (args, kw) => new PyProperty(args[0] || kwGet(kw, 'fget', null), args[1] || kwGet(kw, 'fset', null));
  STATICMETHOD.native = (args) => new PyStatic(args[0]);
  CLASSMETHOD.native = (args) => new PyClassMethod(args[0]);
  SUPER.native = function (args) {
    if (args.length === 2 && args[0] instanceof PyClass) return new PySuper(args[0], args[1]);
    throw err('RuntimeError', 'super(): no arguments');
  };
  [NONETYPE, FUNCTION, BUILTIN_FN, METHOD, MODULE, ITER, ELLIPSIS_T, VIEW.keys, VIEW.values, VIEW.items].forEach((c) => {
    c.native = () => { throw err('TypeError', `cannot create '${c.name}' instances`); };
  });
  const SUPER_FN = SUPER;

  function dictUpdate(py, d, src) {
    if (src instanceof PyDict) { for (const [k, v] of src.m.values()) dset(d, k, v); return; }
    if (src instanceof PyInstance && classLookup(src.cls, 'keys')) {
      for (const k of py.toArray(py.callMethod(src, 'keys', []))) dset(d, k, py.getitem(src, k));
      return;
    }
    let i = 0;
    const nx = py.iter(src);
    for (;;) {
      const item = nx();
      if (item === DONE) return;
      let pair;
      try { pair = py.toArray(item, true); } catch (e) { throw err('TypeError', `cannot convert dictionary update sequence element #${i} to a sequence`); }
      if (pair.length !== 2) throw err('ValueError', `dictionary update sequence element #${i} has length ${pair.length}; 2 is required`);
      dset(d, pair[0], pair[1]);
      i++;
    }
  }

  function minmax(py, name, args, kw) {
    noKw(name, kw, ['key', 'default']);
    if (!args.length) throw err('TypeError', `${name} expected at least 1 argument, got 0`);
    const key = kwGet(kw, 'key', null);
    const def = kwGet(kw, 'default', undefined);
    const items = args.length === 1 ? py.toArray(args[0], true) : args;
    if (!items.length) {
      if (def !== undefined) return def;
      throw err('ValueError', `${name}() iterable argument is empty`);
    }
    const op = name === 'max' ? '>' : '<';
    let best = items[0], bk = key !== null ? py.call(key, [best], null) : best;
    for (let i = 1; i < items.length; i++) {
      const k = key !== null ? py.call(key, [items[i]], null) : items[i];
      if (py.order(op, k, bk)) { best = items[i]; bk = k; }
    }
    return best;
  }
  function sortList(py, a, key, reverse) {
    const n = a.length;
    if (n < 2) return a;
    py.tick(Math.ceil(n * Math.log2(n + 1)));
    const keys = key !== null && key !== undefined ? a.map((x) => py.call(key, [x], null)) : a.slice();
    const idx = keys.map((_, i) => i);
    const allNum = keys.every((k) => typeof k === 'bigint' || typeof k === 'number' || typeof k === 'boolean');
    const allStr = !allNum && keys.every((k) => typeof k === 'string');
    let cmp;
    if (allNum) cmp = (i, j) => { const x = keys[i], y = keys[j]; return x < y ? -1 : x > y ? 1 : 0; };
    else if (allStr) cmp = (i, j) => { const x = keys[i], y = keys[j]; return x < y ? -1 : x > y ? 1 : 0; };
    else cmp = (i, j) => (py.order('<', keys[i], keys[j]) ? -1 : py.order('<', keys[j], keys[i]) ? 1 : 0);
    idx.sort(reverse ? (i, j) => cmp(j, i) : cmp);
    const out = idx.map((i) => a[i]);
    for (let i = 0; i < n; i++) a[i] = out[i];
    return a;
  }
  const iterOf = (py, v, name) => new PyIter(py.iter(v), name);
  const ITER_NAMES = (v) => (Array.isArray(v) ? 'list_iterator' : typeof v === 'string' ? 'str_ascii_iterator' : v instanceof PyTuple ? 'tuple_iterator'
    : v instanceof PyRange ? 'range_iterator' : v instanceof PyDict ? 'dict_keyiterator' : v instanceof PySet ? 'set_iterator' : 'iterator');

  const BUILTINS = new Map();
  const def = (name, fn) => BUILTINS.set(name, B(name, fn));
  [['int', INT], ['float', FLOAT], ['str', STR], ['bool', BOOL], ['list', LIST], ['tuple', TUPLE], ['dict', DICT], ['set', SET],
    ['frozenset', FROZENSET], ['range', RANGE], ['type', TYPE], ['object', OBJECT], ['slice', SLICE], ['property', PROPERTY],
    ['staticmethod', STATICMETHOD], ['classmethod', CLASSMETHOD], ['super', SUPER]].forEach(([n, c]) => BUILTINS.set(n, c));
  OBJECT.native = function (args, kw, cls) { if (args.length) throw err('TypeError', 'object() takes no arguments'); return new PyInstance(OBJECT); };
  Object.keys(EXC).forEach((n) => { if (n !== 'TurtleGraphicsError') BUILTINS.set(n, EXC[n]); });
  BUILTINS.set('NotImplemented', NOT_IMPL);
  BUILTINS.set('Ellipsis', ELLIPSIS);
  BUILTINS.set('__name__', '__main__');

  def('print', function (args, kw) {
    let sep = ' ', end = '\n';
    if (kw) {
      for (const k of kw.keys()) if (!['sep', 'end', 'file', 'flush'].includes(k)) throw err('TypeError', `'${k}' is an invalid keyword argument for print()`);
      const s = kw.get('sep'), e = kw.get('end');
      if (s !== undefined && s !== null) { if (typeof s !== 'string') throw err('TypeError', `sep must be None or a string, not ${typeName(s)}`); sep = s; }
      if (e !== undefined && e !== null) { if (typeof e !== 'string') throw err('TypeError', `end must be None or a string, not ${typeName(e)}`); end = e; }
    }
    let out = '';
    for (let i = 0; i < args.length; i++) { if (i) out += sep; out += this.str(args[i]); }
    this.print(out + end);
    return null;
  });
  def('input', function (args) { nargs('input', args, 0, 1); return this.input(args.length ? this.str(args[0]) : ''); });
  def('len', function (args) { nargs('len', args, 1, 1); return BigInt(this.len(args[0])); });
  def('abs', function (args) {
    nargs('abs', args, 1, 1);
    const v = args[0];
    if (typeof v === 'bigint' || typeof v === 'boolean') { const b = toBig(v); return b < 0n ? -b : b; }
    if (typeof v === 'number') return Math.abs(v);
    if (v instanceof PyInstance && classLookup(v.cls, '__abs__')) return this.callMethod(v, '__abs__', []);
    throw err('TypeError', `bad operand type for abs(): '${typeName(v)}'`);
  });
  def('min', function (args, kw) { return minmax(this, 'min', args, kw); });
  def('max', function (args, kw) { return minmax(this, 'max', args, kw); });
  def('sum', function (args, kw) {
    noKw('sum', kw, ['start']);
    nargs('sum', args, 1, 2);
    const start = kwGet(kw, 'start', args.length > 1 ? args[1] : 0n);
    if (typeof start === 'string') throw err('TypeError', "sum() can't sum strings [use ''.join(seq) instead]");
    const items = this.toArray(args[0], true);
    if (items.some((x) => typeof x === 'string')) throw err('TypeError', "unsupported operand type(s) for +: 'int' and 'str'");
    return sumPy(this, items, start);
  });
  def('round', function (args, kw) {
    noKw('round', kw, ['ndigits']);
    nargs('round', args, 1, 2);
    const nd = kwGet(kw, 'ndigits', args.length > 1 ? args[1] : null);
    const x = args[0];
    if (x instanceof PyInstance && classLookup(x.cls, '__round__')) return this.call(classLookup(x.cls, '__round__'), nd === null ? [x] : [x, nd], null);
    if (!isNum(x)) throw err('TypeError', `type ${typeName(x)} doesn't define __round__ method`);
    return roundPy(x, nd);
  });
  def('sorted', function (args, kw) {
    noKw('sorted', kw, ['key', 'reverse']);
    nargs('sorted', args, 1, 1);
    return sortList(this, this.toArray(args[0]), kwGet(kw, 'key', null), this.truthy(kwGet(kw, 'reverse', false)));
  });
  def('reversed', function (args) {
    nargs('reversed', args, 1, 1);
    const v = args[0];
    if (v instanceof PyInstance && classLookup(v.cls, '__reversed__')) return this.callMethod(v, '__reversed__', []);
    if (!(Array.isArray(v) || typeof v === 'string' || v instanceof PyTuple || v instanceof PyRange || v instanceof PyDict || v instanceof PyView || v instanceof PyInstance)) {
      throw err('TypeError', `'${typeName(v)}' object is not reversible`);
    }
    if (Array.isArray(v)) { let i = v.length - 1; return new PyIter(() => (i >= 0 && i < v.length ? v[i--] : DONE), 'list_reverseiterator'); }
    const a = this.toArray(v).reverse();
    return new PyIter(listNext(a), 'reversed');
  });
  def('enumerate', function (args, kw) {
    noKw('enumerate', kw, ['start']);
    nargs('enumerate', args, 1, 2);
    let i = asInt(kwGet(kw, 'start', args.length > 1 ? args[1] : 0n));
    const nx = this.iter(args[0]);
    return new PyIter(() => { const v = nx(); if (v === DONE) return DONE; return tuple([i++, v]); }, 'enumerate');
  });
  def('zip', function (args, kw) {
    noKw('zip', kw, ['strict']);
    const its = args.map((a) => this.iter(a));
    return new PyIter(() => {
      if (!its.length) return DONE;
      const row = [];
      for (const nx of its) { const v = nx(); if (v === DONE) return DONE; row.push(v); }
      return tuple(row);
    }, 'zip');
  });
  def('map', function (args) {
    if (args.length < 2) throw err('TypeError', 'map() must have at least two arguments.');
    const fn = args[0];
    const its = args.slice(1).map((a) => this.iter(a));
    return new PyIter(() => {
      const row = [];
      for (const nx of its) { const v = nx(); if (v === DONE) return DONE; row.push(v); }
      return this.call(fn, row, null);
    }, 'map');
  });
  def('filter', function (args) {
    nargs('filter', args, 2, 2);
    const fn = args[0], nx = this.iter(args[1]);
    return new PyIter(() => {
      for (;;) {
        const v = nx();
        if (v === DONE) return DONE;
        if (this.truthy(fn === null ? v : this.call(fn, [v], null))) return v;
      }
    }, 'filter');
  });
  def('any', function (args) { nargs('any', args, 1, 1); const nx = this.iter(args[0]); for (;;) { const v = nx(); if (v === DONE) return false; if (this.truthy(v)) return true; } });
  def('all', function (args) { nargs('all', args, 1, 1); const nx = this.iter(args[0]); for (;;) { const v = nx(); if (v === DONE) return true; if (!this.truthy(v)) return false; } });
  def('chr', function (args) {
    nargs('chr', args, 1, 1);
    const n = asInt(args[0]);
    if (n < 0n || n > 0x10ffffn) throw err('ValueError', 'chr() arg not in range(0x110000)');
    return String.fromCodePoint(Number(n));
  });
  def('ord', function (args) {
    nargs('ord', args, 1, 1);
    const s = args[0];
    if (typeof s !== 'string') throw err('TypeError', `ord() expected string of length 1, but ${typeName(s)} found`);
    const a = Array.from(s);
    if (a.length !== 1) throw err('TypeError', `ord() expected a character, but string of length ${a.length} found`);
    return BigInt(a[0].codePointAt(0));
  });
  const classes = (c) => {
    if (c instanceof PyClass) return [c];
    if (c instanceof PyTuple) return c.v.flatMap(classes);
    throw err('TypeError', 'isinstance() arg 2 must be a type, a tuple of types, or a union');
  };
  def('isinstance', function (args) { nargs('isinstance', args, 2, 2); const t = typeOf(args[0]); return classes(args[1]).some((c) => isSub(t, c)); });
  def('issubclass', function (args) {
    nargs('issubclass', args, 2, 2);
    if (!(args[0] instanceof PyClass)) throw err('TypeError', 'issubclass() arg 1 must be a class');
    return classes(args[1]).some((c) => isSub(args[0], c));
  });
  def('pow', function (args, kw) {
    nargs('pow', args, 2, 3);
    if (args.length === 3 && args[2] !== null) {
      let b = asInt(args[0]), e = asInt(args[1]);
      const m = asInt(args[2]);
      if (m === 0n) throw err('ValueError', 'pow() 3rd argument cannot be 0');
      if (e < 0n) throw err('ValueError', 'negative exponents with a modulus are not available here');
      let r = 1n;
      b = ((b % m) + m) % m;
      while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; this.tick(1); }
      return ((r % m) + m) % m;
    }
    return this.binop('**', args[0], args[1]);
  });
  def('divmod', function (args) { nargs('divmod', args, 2, 2); return tuple([this.binop('//', args[0], args[1]), this.binop('%', args[0], args[1])]); });
  const radix = (name, base, pre) => def(name, function (args) {
    nargs(name, args, 1, 1);
    const n = asInt(args[0]);
    return (n < 0n ? '-' : '') + pre + (n < 0n ? -n : n).toString(base);
  });
  radix('hex', 16, '0x'); radix('oct', 8, '0o'); radix('bin', 2, '0b');
  def('repr', function (args) { nargs('repr', args, 1, 1); return this.repr(args[0]); });
  def('ascii', function (args) { nargs('ascii', args, 1, 1); return this.repr(args[0]).replace(/[^\x00-\x7f]/gu, (c) => { const n = c.codePointAt(0); return n > 0xffff ? '\\U' + n.toString(16).padStart(8, '0') : n > 0xff ? '\\u' + n.toString(16).padStart(4, '0') : '\\x' + n.toString(16).padStart(2, '0'); }); });
  def('hash', function (args) {
    nargs('hash', args, 1, 1);
    const k = hkeyStr(args[0]);
    if (typeof args[0] === 'bigint') return args[0];
    let h = 0n;
    for (let i = 0; i < k.length; i++) h = (h * 31n + BigInt(k.charCodeAt(i))) & 0xfffffffffffffn;
    return h;
  });
  def('id', function (args) { nargs('id', args, 1, 1); const v = args[0]; return BigInt(140000000000000 + (v !== null && typeof v === 'object' ? idOf(v) : hkeyStr(v).length) * 16); });
  def('iter', function (args) { nargs('iter', args, 1, 1); return args[0] instanceof PyIter ? args[0] : iterOf(this, args[0], ITER_NAMES(args[0])); });
  def('next', function (args) {
    nargs('next', args, 1, 2);
    const it = args[0];
    let v;
    if (it instanceof PyIter) v = it.nx();
    else if (it instanceof PyInstance && classLookup(it.cls, '__next__')) {
      try { return this.callMethod(it, '__next__', []); } catch (e) {
        if (args.length > 1 && e instanceof Raise && isSub(e.exc.cls, EXC.StopIteration)) return args[1];
        throw e;
      }
    } else throw err('TypeError', `'${typeName(it)}' object is not an iterator`);
    if (v === DONE) { if (args.length > 1) return args[1]; throw err('StopIteration'); }
    return v;
  });
  def('callable', function (args) {
    nargs('callable', args, 1, 1);
    const v = args[0];
    return v instanceof PyFunction || v instanceof PyBuiltin || v instanceof PyBound || v instanceof PyClass || (v instanceof PyInstance && classLookup(v.cls, '__call__') !== undefined);
  });
  const attrName = (n) => { if (typeof n !== 'string') throw err('TypeError', `attribute name must be string, not '${typeName(n)}'`); return n; };
  def('hasattr', function (args) {
    nargs('hasattr', args, 2, 2);
    try { this.getattr(args[0], attrName(args[1])); return true; } catch (e) { if (e instanceof Raise && isSub(e.exc.cls, EXC.AttributeError)) return false; throw e; }
  });
  def('getattr', function (args) {
    nargs('getattr', args, 2, 3);
    try { return this.getattr(args[0], attrName(args[1])); } catch (e) {
      if (args.length > 2 && e instanceof Raise && isSub(e.exc.cls, EXC.AttributeError)) return args[2];
      throw e;
    }
  });
  def('setattr', function (args) { nargs('setattr', args, 3, 3); this.setattr(args[0], attrName(args[1]), args[2]); return null; });
  def('delattr', function (args) {
    nargs('delattr', args, 2, 2);
    const o = args[0], n = attrName(args[1]);
    if (o instanceof PyInstance && o.dict.has(n)) { o.dict.delete(n); return null; }
    throw err('AttributeError', `'${typeName(o)}' object has no attribute '${n}'`);
  });
  def('format', function (args) { nargs('format', args, 1, 2); return this.format(args[0], args.length > 1 ? this.str(args[1]) : ''); });
  def('vars', function (args) {
    nargs('vars', args, 1, 1);
    if (!(args[0] instanceof PyInstance)) throw err('TypeError', 'vars() argument must have __dict__ attribute');
    return this.getattr(args[0], '__dict__');
  });
  def('dir', function (args) {
    const o = args[0];
    const names = new Set();
    if (o instanceof PyInstance) { for (const k of o.dict.keys()) names.add(k); o.cls.mro.forEach((c) => { for (const k of c.dict.keys()) names.add(k); }); } else if (o instanceof PyModule) for (const k of o.dict.keys()) names.add(k);
    else if (args.length === 0) for (const k of this.globals.keys()) names.add(k);
    else { const t = methodsOf(o); if (t) Object.keys(t).forEach((k) => names.add(k)); }
    return [...names].sort();
  });
  def('globals', function () { const d = new PyDict(); for (const [k, v] of this.globals) dset(d, k, v); return d; });
  def('locals', function () { const d = new PyDict(); for (const [k, v] of this.globals) dset(d, k, v); return d; });
  def('open', () => { throw err('OSError', "open() is not available here: programs can't read or write files"); });
  def('eval', () => { throw err('NotImplementedError', 'eval() is not available here'); });
  def('exec', () => { throw err('NotImplementedError', 'exec() is not available here'); });
  def('compile', () => { throw err('NotImplementedError', 'compile() is not available here'); });
  def('breakpoint', () => null);
  def('help', function () { this.print('Help is not available here: look back at the lesson, or ask the tutor.\n'); return null; });
  const exit = function (args) { throw new Raise(newExc(EXC.SystemExit, args.slice(0, 1)), this.line); };
  def('exit', exit);
  def('quit', exit);
  def('__import__', function (args) { return this.importModule(this.str(args[0])); });

  /* ---------------- methods of the built-in types ---------------- */

  const isWs = (c) => /\s/.test(c);
  function stripChars(s, chars, left, right) {
    let a = 0, b = s.length;
    const strip = chars === null ? isWs : (c) => chars.includes(c);
    if (left) while (a < b && strip(s[a])) a++;
    if (right) while (b > a && strip(s[b - 1])) b--;
    return s.slice(a, b);
  }
  const strArg = (name, v) => { if (typeof v !== 'string') throw err('TypeError', `${name} arg must be None or str`); return v; };
  function bounds(py, s, args, from) {
    const n = s.length;
    let a = args.length > from && args[from] !== null ? Number(asInt(args[from])) : 0;
    let b = args.length > from + 1 && args[from + 1] !== null ? Number(asInt(args[from + 1])) : n;
    if (a < 0) a = Math.max(0, a + n);
    if (b < 0) b = Math.max(0, b + n);
    return [Math.min(a, n), Math.min(b, n)];
  }
  const sub = (name, v) => { if (typeof v !== 'string') throw err('TypeError', `must be str, not ${typeName(v)}`); return v; };
  function titleCase(s) { return s.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); }

  const STR_M = Object.assign(Object.create(null), {
    upper(args, kw, s) { return s.toUpperCase(); },
    lower(args, kw, s) { return s.toLowerCase(); },
    casefold(args, kw, s) { return s.toLowerCase(); },
    capitalize(args, kw, s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; },
    title(args, kw, s) { return titleCase(s); },
    swapcase(args, kw, s) { return Array.from(s).map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''); },
    strip(args, kw, s) { nargs('strip', args, 0, 1); return stripChars(s, args.length && args[0] !== null ? strArg('strip', args[0]) : null, true, true); },
    lstrip(args, kw, s) { nargs('lstrip', args, 0, 1); return stripChars(s, args.length && args[0] !== null ? strArg('lstrip', args[0]) : null, true, false); },
    rstrip(args, kw, s) { nargs('rstrip', args, 0, 1); return stripChars(s, args.length && args[0] !== null ? strArg('rstrip', args[0]) : null, false, true); },
    split(args, kw, s) {
      noKw('split', kw, ['sep', 'maxsplit']);
      nargs('split', args, 0, 2);
      const sep = kwGet(kw, 'sep', args.length > 0 ? args[0] : null);
      const max = Number(asInt(kwGet(kw, 'maxsplit', args.length > 1 ? args[1] : -1n)));
      if (sep === null) {
        const parts = [];
        let rest = s.replace(/^\s+/, '');
        while (rest && (max < 0 || parts.length < max)) {
          const m = /\s+/.exec(rest);
          if (!m) break;
          parts.push(rest.slice(0, m.index));
          rest = rest.slice(m.index + m[0].length);
        }
        if (rest) parts.push(rest);
        return parts;
      }
      sub('split', sep);
      if (sep === '') throw err('ValueError', 'empty separator');
      if (max < 0) return s.split(sep);
      const parts = [];
      let rest = s;
      while (parts.length < max) { const i = rest.indexOf(sep); if (i < 0) break; parts.push(rest.slice(0, i)); rest = rest.slice(i + sep.length); }
      parts.push(rest);
      return parts;
    },
    rsplit(args, kw, s) {
      noKw('rsplit', kw, ['sep', 'maxsplit']);
      const sep = kwGet(kw, 'sep', args.length > 0 ? args[0] : null);
      const max = Number(asInt(kwGet(kw, 'maxsplit', args.length > 1 ? args[1] : -1n)));
      if (max < 0) return STR_M.split.call(this, sep === null ? [] : [sep], null, s);
      const parts = [];
      if (sep === null) {
        let rest = s.replace(/\s+$/, '');
        while (rest && parts.length < max) {
          const m = /\s+(?=\S*$)/.exec(rest);
          if (!m) break;
          parts.unshift(rest.slice(m.index + m[0].length));
          rest = rest.slice(0, m.index);
        }
        if (rest) parts.unshift(rest);
        return parts;
      }
      sub('rsplit', sep);
      if (sep === '') throw err('ValueError', 'empty separator');
      let rest = s;
      while (parts.length < max) { const i = rest.lastIndexOf(sep); if (i < 0) break; parts.unshift(rest.slice(i + sep.length)); rest = rest.slice(0, i); }
      parts.unshift(rest);
      return parts;
    },
    splitlines(args, kw, s) {
      const keep = this.truthy(kwGet(kw, 'keepends', args.length ? args[0] : false));
      const out = [];
      const re = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/g;
      let last = 0, m;
      while ((m = re.exec(s))) { out.push(s.slice(last, keep ? m.index + m[0].length : m.index)); last = m.index + m[0].length; }
      if (last < s.length) out.push(s.slice(last));
      return out;
    },
    join(args, kw, s) {
      nargs('join', args, 1, 1);
      const items = this.toArray(args[0], true);
      for (let i = 0; i < items.length; i++) if (typeof items[i] !== 'string') throw err('TypeError', `sequence item ${i}: expected str instance, ${typeName(items[i])} found`);
      const len = items.reduce((n, x) => n + x.length, 0) + s.length * Math.max(0, items.length - 1);
      if (len > LIMITS.str) throw new Halt('memory');
      return items.join(s);
    },
    replace(args, kw, s) {
      nargs('replace', args, 2, 3);
      const a = sub('replace', args[0]), b = sub('replace', args[1]);
      let n = args.length > 2 ? Number(asInt(args[2])) : -1;
      if (a === '') {
        const chars = Array.from(s);
        let out = '';
        for (let i = 0; i <= chars.length; i++) { if (n < 0 || n-- > 0) out += b; if (i < chars.length) out += chars[i]; }
        return out;
      }
      if (n < 0) { const r = s.split(a).join(b); if (r.length > LIMITS.str) throw new Halt('memory'); return r; }
      let out = '', rest = s;
      while (n-- > 0) { const i = rest.indexOf(a); if (i < 0) break; out += rest.slice(0, i) + b; rest = rest.slice(i + a.length); }
      return out + rest;
    },
    find(args, kw, s) { nargs('find', args, 1, 3); const [a, b] = bounds(this, s, args, 1); const i = s.slice(0, b).indexOf(sub('find', args[0]), a); return BigInt(i); },
    rfind(args, kw, s) { nargs('rfind', args, 1, 3); const [a, b] = bounds(this, s, args, 1); const x = sub('rfind', args[0]); const i = s.slice(0, b).lastIndexOf(x); return BigInt(i >= a ? i : -1); },
    index(args, kw, s) { const i = STR_M.find.call(this, args, kw, s); if (i < 0n) throw err('ValueError', 'substring not found'); return i; },
    rindex(args, kw, s) { const i = STR_M.rfind.call(this, args, kw, s); if (i < 0n) throw err('ValueError', 'substring not found'); return i; },
    count(args, kw, s) {
      nargs('count', args, 1, 3);
      const x = sub('count', args[0]);
      const [a, b] = bounds(this, s, args, 1);
      const t = s.slice(a, b);
      if (x === '') return BigInt(Array.from(t).length + 1);
      return BigInt(t.split(x).length - 1);
    },
    startswith(args, kw, s) {
      nargs('startswith', args, 1, 3);
      const [a, b] = bounds(this, s, args, 1);
      const t = s.slice(a, b);
      const opts = args[0] instanceof PyTuple ? args[0].v : [args[0]];
      return opts.some((p) => { if (typeof p !== 'string') throw err('TypeError', `startswith first arg must be str or a tuple of str, not ${typeName(p)}`); return t.startsWith(p); });
    },
    endswith(args, kw, s) {
      nargs('endswith', args, 1, 3);
      const [a, b] = bounds(this, s, args, 1);
      const t = s.slice(a, b);
      const opts = args[0] instanceof PyTuple ? args[0].v : [args[0]];
      return opts.some((p) => { if (typeof p !== 'string') throw err('TypeError', `endswith first arg must be str or a tuple of str, not ${typeName(p)}`); return t.endsWith(p); });
    },
    isdigit(args, kw, s) { return /^[\p{Nd}\u00b2\u00b3\u00b9\u2070-\u2079]+$/u.test(s); },
    isdecimal(args, kw, s) { return /^\p{Nd}+$/u.test(s); },
    isnumeric(args, kw, s) { return /^\p{N}+$/u.test(s); },
    isalpha(args, kw, s) { return /^\p{L}+$/u.test(s); },
    isalnum(args, kw, s) { return /^[\p{L}\p{N}]+$/u.test(s); },
    isspace(args, kw, s) { return /^\s+$/.test(s); },
    isupper(args, kw, s) { return /\p{Lu}|\p{Lt}/u.test(s) && !/\p{Ll}/u.test(s); },
    islower(args, kw, s) { return /\p{Ll}/u.test(s) && !/\p{Lu}|\p{Lt}/u.test(s); },
    istitle(args, kw, s) { return /\p{Lu}|\p{Lt}/u.test(s) && titleCase(s) === s; },
    isidentifier(args, kw, s) { return /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*$/u.test(s); },
    isascii(args, kw, s) { return /^[\x00-\x7f]*$/.test(s); },
    isprintable(args, kw, s) { return !/[\x00-\x1f\x7f]/.test(s); },
    center(args, kw, s) {
      nargs('center', args, 1, 2);
      const w = Number(asInt(args[0])), f = args.length > 1 ? args[1] : ' ';
      if (typeof f !== 'string' || Array.from(f).length !== 1) throw err('TypeError', 'The fill character must be exactly one character long');
      const n = w - Array.from(s).length;
      if (n <= 0) return s;
      const left = Math.floor(n / 2) + (n & w & 1);
      return f.repeat(left) + s + f.repeat(n - left);
    },
    ljust(args, kw, s) { nargs('ljust', args, 1, 2); return pad(s, Number(asInt(args[0])), args.length > 1 ? args[1] : ' ', '<'); },
    rjust(args, kw, s) { nargs('rjust', args, 1, 2); return pad(s, Number(asInt(args[0])), args.length > 1 ? args[1] : ' ', '>'); },
    zfill(args, kw, s) {
      nargs('zfill', args, 1, 1);
      const w = Number(asInt(args[0]));
      const sign = s[0] === '-' || s[0] === '+' ? s[0] : '';
      const body = sign ? s.slice(1) : s;
      return sign + body.padStart(w - sign.length, '0');
    },
    format(args, kw, s) { return this.strFormat(s, args, kw); },
    format_map(args, kw, s) { const m = new Map(); for (const [k, v] of args[0].m.values()) m.set(k, v); return this.strFormat(s, [], m); },
    partition(args, kw, s) {
      nargs('partition', args, 1, 1);
      const x = sub('partition', args[0]);
      if (x === '') throw err('ValueError', 'empty separator');
      const i = s.indexOf(x);
      return i < 0 ? tuple([s, '', '']) : tuple([s.slice(0, i), x, s.slice(i + x.length)]);
    },
    rpartition(args, kw, s) {
      nargs('rpartition', args, 1, 1);
      const x = sub('rpartition', args[0]);
      if (x === '') throw err('ValueError', 'empty separator');
      const i = s.lastIndexOf(x);
      return i < 0 ? tuple(['', '', s]) : tuple([s.slice(0, i), x, s.slice(i + x.length)]);
    },
    removeprefix(args, kw, s) { const p = sub('removeprefix', args[0]); return p && s.startsWith(p) ? s.slice(p.length) : s; },
    removesuffix(args, kw, s) { const p = sub('removesuffix', args[0]); return p && s.endsWith(p) ? s.slice(0, -p.length) : s; },
    expandtabs(args, kw, s) {
      const size = args.length ? Number(asInt(args[0])) : 8;
      let col = 0, out = '';
      for (const c of s) {
        if (c === '\t') { const n = size > 0 ? size - (col % size) : 0; out += ' '.repeat(n); col += n; } else { out += c; col = c === '\n' || c === '\r' ? 0 : col + 1; }
      }
      return out;
    },
    encode() { throw err('NotImplementedError', 'bytes are not available here'); }
  });

  const LIST_M = Object.assign(Object.create(null), {
    append(args, kw, a) { nargs('list.append', args, 1, 1); a.push(args[0]); if (a.length > LIMITS.list) throw new Halt('memory'); return null; },
    extend(args, kw, a) { nargs('list.extend', args, 1, 1); const items = this.toArray(args[0]); this.grow(a.length + items.length); for (const x of items) a.push(x); return null; },
    insert(args, kw, a) {
      nargs('insert', args, 2, 2);
      let i = Number(asInt(args[0]));
      if (i < 0) i = Math.max(0, i + a.length);
      a.splice(Math.min(i, a.length), 0, args[1]);
      return null;
    },
    remove(args, kw, a) {
      nargs('list.remove', args, 1, 1);
      for (let i = 0; i < a.length; i++) if (this.eq(a[i], args[0])) { a.splice(i, 1); return null; }
      throw err('ValueError', 'list.remove(x): x not in list');
    },
    pop(args, kw, a) {
      nargs('pop', args, 0, 1);
      if (!a.length) throw err('IndexError', 'pop from empty list');
      let i = args.length ? Number(asInt(args[0])) : a.length - 1;
      if (i < 0) i += a.length;
      if (i < 0 || i >= a.length) throw err('IndexError', 'pop index out of range');
      return a.splice(i, 1)[0];
    },
    clear(args, kw, a) { a.length = 0; return null; },
    index(args, kw, a) {
      nargs('index', args, 1, 3);
      const [lo, hi] = bounds(this, a, args, 1);
      for (let i = lo; i < hi; i++) if (this.eq(a[i], args[0])) return BigInt(i);
      throw err('ValueError', `${this.repr(args[0])} is not in list`);
    },
    count(args, kw, a) { nargs('count', args, 1, 1); let n = 0n; for (const x of a) if (this.eq(x, args[0])) n++; return n; },
    sort(args, kw, a) {
      if (args.length) throw err('TypeError', 'sort() takes no positional arguments');
      noKw('sort', kw, ['key', 'reverse']);
      sortList(this, a, kwGet(kw, 'key', null), this.truthy(kwGet(kw, 'reverse', false)));
      return null;
    },
    reverse(args, kw, a) { a.reverse(); return null; },
    copy(args, kw, a) { return a.slice(); }
  });
  const TUPLE_M = Object.assign(Object.create(null), {
    count(args, kw, t) { nargs('count', args, 1, 1); let n = 0n; for (const x of t.v) if (this.eq(x, args[0])) n++; return n; },
    index(args, kw, t) {
      nargs('index', args, 1, 3);
      for (let i = 0; i < t.v.length; i++) if (this.eq(t.v[i], args[0])) return BigInt(i);
      throw err('ValueError', 'tuple.index(x): x not in tuple');
    }
  });
  const RANGE_M = Object.assign(Object.create(null), {
    count(args, kw, r) { return this.contains(r, args[0]) ? 1n : 0n; },
    index(args, kw, r) {
      if (!this.contains(r, args[0])) throw err('ValueError', `${this.repr(args[0])} is not in range`);
      return (toBig(typeof args[0] === 'number' ? BigInt(args[0]) : args[0]) - r.start) / r.step;
    }
  });
  const DICT_M = Object.assign(Object.create(null), {
    keys(args, kw, d) { return new PyView(d, 'keys'); },
    values(args, kw, d) { return new PyView(d, 'values'); },
    items(args, kw, d) { return new PyView(d, 'items'); },
    get(args, kw, d) { nargs('get', args, 1, 2); const v = dget(d, args[0]); return v === undefined ? (args.length > 1 ? args[1] : null) : v; },
    setdefault(args, kw, d) {
      nargs('setdefault', args, 1, 2);
      const v = dget(d, args[0]);
      if (v !== undefined) return v;
      const x = args.length > 1 ? args[1] : null;
      dset(d, args[0], x);
      return x;
    },
    pop(args, kw, d) {
      nargs('pop', args, 1, 2);
      const h = hkey(args[0]);
      const e = d.m.get(h);
      if (e === undefined) { if (args.length > 1) return args[1]; throw new Raise(newExc(EXC.KeyError, [args[0]]), this.line); }
      d.m.delete(h);
      return e[1];
    },
    popitem(args, kw, d) {
      if (!d.m.size) throw err('KeyError', 'popitem(): dictionary is empty');
      const last = [...d.m.keys()].pop();
      const e = d.m.get(last);
      d.m.delete(last);
      return tuple([e[0], e[1]]);
    },
    update(args, kw, d) { nargs('update', args, 0, 1); if (args.length) dictUpdate(this, d, args[0]); if (kw) for (const [k, v] of kw) dset(d, k, v); return null; },
    clear(args, kw, d) { d.m.clear(); return null; },
    copy(args, kw, d) { const o = new PyDict(); for (const [h, e] of d.m) o.m.set(h, [e[0], e[1]]); return o; }
  });
  DICT.statics = { fromkeys: B('fromkeys', function (args) { const d = new PyDict(); for (const k of this.toArray(args[0])) dset(d, k, args.length > 1 ? args[1] : null); return d; }) };
  const setArgs = (py, args) => args.map((a) => (a instanceof PySet ? a : py.toSet(a)));
  const SET_M = Object.assign(Object.create(null), {
    add(args, kw, s) { nargs('set.add', args, 1, 1); sadd(s, args[0]); if (s.m.size > LIMITS.list) throw new Halt('memory'); return null; },
    remove(args, kw, s) { nargs('set.remove', args, 1, 1); const h = hkey(args[0]); if (!s.m.has(h)) throw new Raise(newExc(EXC.KeyError, [args[0]]), this.line); s.m.delete(h); return null; },
    discard(args, kw, s) { nargs('set.discard', args, 1, 1); s.m.delete(hkey(args[0])); return null; },
    pop(args, kw, s) { if (!s.m.size) throw err('KeyError', 'pop from an empty set'); const k = setItems(s)[0]; s.m.delete(hkey(k)); return k; },
    clear(args, kw, s) { s.m.clear(); return null; },
    copy(args, kw, s) { const o = new PySet(); for (const [h, k] of s.m) o.m.set(h, k); return o; },
    union(args, kw, s) { return setArgs(this, args).reduce((a, b) => setOp('|', a, b), SET_M.copy.call(this, [], null, s)); },
    intersection(args, kw, s) { return setArgs(this, args).reduce((a, b) => setOp('&', a, b), SET_M.copy.call(this, [], null, s)); },
    difference(args, kw, s) { return setArgs(this, args).reduce((a, b) => setOp('-', a, b), SET_M.copy.call(this, [], null, s)); },
    symmetric_difference(args, kw, s) { return setOp('^', s, setArgs(this, args)[0]); },
    update(args, kw, s) { for (const o of setArgs(this, args)) for (const [h, k] of o.m) if (!s.m.has(h)) s.m.set(h, k); return null; },
    intersection_update(args, kw, s) { const r = SET_M.intersection.call(this, args, kw, s); s.m = r.m; return null; },
    difference_update(args, kw, s) { const r = SET_M.difference.call(this, args, kw, s); s.m = r.m; return null; },
    issubset(args, kw, s) { const o = setArgs(this, args)[0]; return [...s.m.keys()].every((h) => o.m.has(h)); },
    issuperset(args, kw, s) { const o = setArgs(this, args)[0]; return [...o.m.keys()].every((h) => s.m.has(h)); },
    isdisjoint(args, kw, s) { const o = setArgs(this, args)[0]; return ![...o.m.keys()].some((h) => s.m.has(h)); }
  });
  const INT_M = Object.assign(Object.create(null), {
    bit_length(args, kw, n) { const v = toBig(n); return v === 0n ? 0n : BigInt((v < 0n ? -v : v).toString(2).length); },
    is_integer() { return true; },
    conjugate(args, kw, n) { return toBig(n); }
  });
  const FLOAT_M = Object.assign(Object.create(null), {
    is_integer(args, kw, x) { return Number.isInteger(x); },
    conjugate(args, kw, x) { return x; }
  });
  STR.methods = STR_M; LIST.methods = LIST_M; DICT.methods = DICT_M; SET.methods = SET_M; TUPLE.methods = TUPLE_M; INT.methods = INT_M; FLOAT.methods = FLOAT_M;
  STR.statics = { maketrans: B('maketrans', () => { throw err('NotImplementedError', 'str.maketrans is not available here'); }) };

  function methodsOf(o) {
    switch (typeof o) {
      case 'string': return STR_M;
      case 'bigint': case 'boolean': return INT_M;
      case 'number': return FLOAT_M;
    }
    if (Array.isArray(o)) return LIST_M;
    if (o instanceof PyDict) return DICT_M;
    if (o instanceof PySet) return SET_M;
    if (o instanceof PyTuple) return TUPLE_M;
    if (o instanceof PyRange) return RANGE_M;
    if (o instanceof PyTurtle) return TURTLE_M;
    if (o instanceof PyScreen) return SCREEN_M;
    return null;
  }

  /* =====================================================================
     Python: the modules
     ===================================================================== */

  const MODULES = Object.create(null);
  const modFns = (d, fns) => { Object.keys(fns).forEach((k) => d.set(k, B(k, fns[k]))); return d; };

  MODULES.math = () => {
    const d = new Map([['pi', Math.PI], ['e', Math.E], ['tau', 2 * Math.PI], ['inf', Infinity], ['nan', NaN]]);
    const domain = () => err('ValueError', 'math domain error');
    const f1 = (name, fn, ok) => d.set(name, B(name, function (args) {
      nargs(name, args, 1, 1);
      const x = real(args[0]);
      if (ok && !ok(x)) throw domain();
      const r = fn(x);
      if (!Number.isFinite(r) && Number.isFinite(x)) throw err('OverflowError', 'math range error');
      return r;
    }));
    f1('sqrt', Math.sqrt, (x) => x >= 0 || Number.isNaN(x));
    f1('exp', Math.exp);
    f1('log10', Math.log10, (x) => x > 0);
    f1('log2', Math.log2, (x) => x > 0);
    f1('log1p', Math.log1p, (x) => x > -1);
    f1('expm1', Math.expm1);
    f1('sin', Math.sin, Number.isFinite); f1('cos', Math.cos, Number.isFinite); f1('tan', Math.tan, Number.isFinite);
    f1('asin', Math.asin, (x) => x >= -1 && x <= 1); f1('acos', Math.acos, (x) => x >= -1 && x <= 1); f1('atan', Math.atan);
    f1('sinh', Math.sinh); f1('cosh', Math.cosh); f1('tanh', Math.tanh);
    f1('asinh', Math.asinh); f1('acosh', Math.acosh, (x) => x >= 1); f1('atanh', Math.atanh, (x) => x > -1 && x < 1);
    f1('degrees', (x) => x * 180 / Math.PI); f1('radians', (x) => x * Math.PI / 180); f1('fabs', Math.abs);
    f1('gamma', gammaFn, (x) => !(x <= 0 && Number.isInteger(x)));
    f1('lgamma', (x) => Math.log(Math.abs(gammaFn(x))));
    f1('erf', erf); f1('erfc', (x) => 1 - erf(x));
    const toInt = (name, fn) => d.set(name, B(name, function (args) {
      nargs(name, args, 1, 1);
      const x = args[0];
      if (isInt(x)) return toBig(x);
      const v = real(x);
      if (Number.isNaN(v)) throw err('ValueError', 'cannot convert float NaN to integer');
      if (!Number.isFinite(v)) throw err('OverflowError', 'cannot convert float infinity to integer');
      return BigInt(fn(v));
    }));
    toInt('floor', Math.floor); toInt('ceil', Math.ceil); toInt('trunc', Math.trunc);
    const ints = (args) => args.map((a) => asInt(a));
    const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
    return modFns(d, {
      log(args) {
        nargs('log', args, 1, 2);
        const x = args[0];
        const ln = (v) => {
          if (isInt(v)) { v = toBig(v); if (v <= 0n) throw domain(); const s = v.toString(); return s.length > 300 ? Math.log(Number('0.' + s.slice(0, 17))) + s.length * Math.LN10 : Math.log(Number(v)); }
          const r = real(v);
          if (r <= 0) throw domain();
          return Math.log(r);
        };
        if (args.length === 1) return ln(x);
        const b = ln(args[1]);
        if (b === 0) throw err('ZeroDivisionError', 'float division by zero');
        return ln(x) / b;
      },
      pow(args) { nargs('pow', args, 2, 2); const a = real(args[0]), b = real(args[1]); if (a < 0 && !Number.isInteger(b)) throw domain(); if (a === 0 && b < 0) throw domain(); return Math.pow(a, b); },
      atan2(args) { nargs('atan2', args, 2, 2); return Math.atan2(real(args[0]), real(args[1])); },
      hypot(args) { return Math.hypot(...args.map((a) => real(a))); },
      dist(args) { nargs('dist', args, 2, 2); const p = this.toArray(args[0]).map((a) => real(a)), q = this.toArray(args[1]).map((a) => real(a)); if (p.length !== q.length) throw err('ValueError', 'both points must have the same number of dimensions'); return Math.hypot(...p.map((x, i) => x - q[i])); },
      copysign(args) { nargs('copysign', args, 2, 2); const a = Math.abs(real(args[0])), b = real(args[1]); return b < 0 || Object.is(b, -0) ? -a : a; },
      fmod(args) { nargs('fmod', args, 2, 2); const a = real(args[0]), b = real(args[1]); if (b === 0) throw domain(); return a % b; },
      modf(args) { nargs('modf', args, 1, 1); const x = real(args[0]); const ip = Math.trunc(x); return tuple([x - ip, ip]); },
      isfinite(args) { return Number.isFinite(real(args[0])); },
      isinf(args) { const x = real(args[0]); return x === Infinity || x === -Infinity; },
      isnan(args) { return Number.isNaN(real(args[0])); },
      isclose(args, kw) {
        const a = real(args[0]), b = real(args[1]);
        const rel = real(kwGet(kw, 'rel_tol', 1e-9)), abs = real(kwGet(kw, 'abs_tol', 0));
        if (a === b) return true;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        const diff = Math.abs(b - a);
        return diff <= Math.abs(rel * b) || diff <= Math.abs(rel * a) || diff <= abs;
      },
      factorial(args) {
        nargs('factorial', args, 1, 1);
        if (typeof args[0] === 'number') throw err('TypeError', "'float' object cannot be interpreted as an integer");
        const n = asInt(args[0]);
        if (n < 0n) throw err('ValueError', 'factorial() not defined for negative values');
        if (n > 3000n) throw err('OverflowError', 'that number is too big to work out here');
        let r = 1n;
        for (let i = 2n; i <= n; i++) r *= i;
        this.tick(Number(n));
        return r;
      },
      gcd(args) { return ints(args).reduce(gcd, 0n); },
      lcm(args) { return ints(args).reduce((a, b) => (a === 0n || b === 0n ? 0n : ((a * b < 0n ? -a * b : a * b) / gcd(a, b))), 1n); },
      isqrt(args) {
        nargs('isqrt', args, 1, 1);
        const n = asInt(args[0]);
        if (n < 0n) throw err('ValueError', 'isqrt() argument must be nonnegative');
        if (n < 2n) return n;
        let x = BigInt(Math.floor(Math.sqrt(Number(n))));
        while (x * x > n) x--;
        while ((x + 1n) * (x + 1n) <= n) x++;
        return x;
      },
      comb(args) {
        nargs('comb', args, 2, 2);
        const [n, k] = ints(args);
        if (n < 0n || k < 0n) throw err('ValueError', 'n must be a non-negative integer');
        if (k > n) return 0n;
        let r = 1n;
        const kk = k < n - k ? k : n - k;
        for (let i = 1n; i <= kk; i++) r = r * (n - kk + i) / i;
        return r;
      },
      perm(args) {
        nargs('perm', args, 1, 2);
        const n = asInt(args[0]);
        const k = args.length > 1 && args[1] !== null ? asInt(args[1]) : n;
        if (n < 0n || k < 0n) throw err('ValueError', 'n must be a non-negative integer');
        if (k > n) return 0n;
        let r = 1n;
        for (let i = n - k + 1n; i <= n; i++) r *= i;
        return bigCheck(r);
      },
      prod(args, kw) {
        nargs('prod', args, 1, 1);
        let r = kwGet(kw, 'start', 1n);
        for (const x of this.toArray(args[0], true)) r = this.binop('*', r, x);
        return r;
      },
      fsum(args) { return sumPy(this, this.toArray(args[0]).map((x) => real(x)), 0); }
    });
  };
  function gammaFn(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
    if (Number.isInteger(x) && x <= 171) { let r = 1; for (let i = 2; i < x; i++) r *= i; return r; }
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
  }
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  MODULES.random = (py) => {
    const r = () => py.rng();
    const below = (n) => BigInt(Math.floor(r() * Number(n)));
    return modFns(new Map(), {
      random(args) { nargs('random', args, 0, 0); return r(); },
      seed(args) { py.rng.seed(args.length && args[0] !== null ? hkeyStr(args[0]) : 'none'); return null; },
      randint(args) {
        nargs('randint', args, 2, 2);
        if (typeof args[0] === 'number' || typeof args[1] === 'number') throw err('TypeError', "'float' object cannot be interpreted as an integer");
        const a = asInt(args[0]), b = asInt(args[1]);
        if (b < a) throw err('ValueError', `empty range in randrange(${a}, ${b + 1n})`);
        return a + below(b - a + 1n);
      },
      randrange(args) {
        nargs('randrange', args, 1, 3);
        const n = args.map((a) => asInt(a));
        const [start, stop, step] = n.length === 1 ? [0n, n[0], 1n] : [n[0], n[1], n.length > 2 ? n[2] : 1n];
        if (step === 0n) throw err('ValueError', 'zero step for randrange()');
        const size = new PyRange(start, stop, step).size;
        if (size <= 0n) throw err('ValueError', `empty range in randrange(${start}, ${stop})`);
        return start + step * below(size);
      },
      choice(args) {
        nargs('choice', args, 1, 1);
        const a = this.toArray(args[0], true);
        if (!a.length) throw err('IndexError', 'Cannot choose from an empty sequence');
        return a[Math.floor(r() * a.length)];
      },
      choices(args, kw) {
        const a = this.toArray(args[0], true);
        const k = Number(asInt(kwGet(kw, 'k', 1n)));
        const w = kwGet(kw, 'weights', args.length > 1 ? args[1] : null);
        if (!a.length) throw err('IndexError', 'Cannot choose from an empty sequence');
        const ws = w === null ? null : this.toArray(w).map((x) => real(x));
        const total = ws ? ws.reduce((s, x) => s + x, 0) : 0;
        const out = [];
        for (let i = 0; i < k; i++) {
          if (!ws) { out.push(a[Math.floor(r() * a.length)]); continue; }
          let x = r() * total, j = 0;
          while (j < ws.length - 1 && x >= ws[j]) { x -= ws[j]; j++; }
          out.push(a[j]);
        }
        return out;
      },
      shuffle(args) {
        nargs('shuffle', args, 1, 1);
        const a = args[0];
        if (!Array.isArray(a)) throw err('TypeError', `'${typeName(a)}' object does not support item assignment`);
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return null;
      },
      uniform(args) { nargs('uniform', args, 2, 2); const a = real(args[0]), b = real(args[1]); return a + (b - a) * r(); },
      sample(args, kw) {
        const pop = this.toArray(args[0]);
        const k = Number(asInt(kwGet(kw, 'k', args[1])));
        if (k < 0 || k > pop.length) throw err('ValueError', 'Sample larger than population or is negative');
        for (let i = pop.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pop[i], pop[j]] = [pop[j], pop[i]]; }
        return pop.slice(0, k);
      },
      gauss(args) { const mu = real(args[0] === undefined ? 0 : args[0]), sigma = real(args[1] === undefined ? 1 : args[1]); return mu + sigma * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
    });
  };
  MODULES.string = () => {
    const lower = 'abcdefghijklmnopqrstuvwxyz', upper = lower.toUpperCase();
    const d = new Map([['ascii_lowercase', lower], ['ascii_uppercase', upper], ['ascii_letters', lower + upper], ['digits', '0123456789'],
      ['hexdigits', '0123456789abcdefABCDEF'], ['octdigits', '01234567'], ['punctuation', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'], ['whitespace', ' \t\n\r\x0b\x0c']]);
    d.set('printable', d.get('digits') + d.get('ascii_letters') + d.get('punctuation') + d.get('whitespace'));
    return modFns(d, { capwords(args) { return this.str(args[0]).split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '); } });
  };
  MODULES.time = (py) => modFns(new Map(), {
    sleep(args) { nargs('sleep', args, 1, 1); const s = real(args[0]); if (s < 0) throw err('ValueError', 'sleep length must be non-negative'); py.clock += s; py.tick(10); return null; },
    time() { py.clock += 0.001; return 1767225600 + py.clock; },
    perf_counter() { py.clock += 0.001; return py.clock; },
    monotonic() { py.clock += 0.001; return py.clock; }
  });

  /* ---------------- the turtle ---------------- */

  class TurtleWorld {
    constructor() { this.ops = []; this.turtles = []; this.bg = null; this.mode = 1; this.screen = null; this.main = null; }
    op(o) { if (this.ops.length >= LIMITS.turtle) throw new Halt('memory', 'turtle'); this.ops.push(o); }
  }
  class PyTurtle {
    constructor(world) {
      this.w = world; this.x = 0; this.y = 0; this.h = 0; this.down = true; this.pen = 'black'; this.fillc = 'black'; this.size = 1;
      this.fillPts = null; this.fillAt = 0; this.shown = true; this.speed = 3; this.id = world.turtles.length;
      world.turtles.push(this);
    }
    moveTo(nx, ny) {
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw err('TurtleGraphicsError', 'the turtle cannot go to infinity');
      if (this.down) this.w.op({ o: 'line', t: this.id, x1: this.x, y1: this.y, x2: nx, y2: ny, c: this.pen, w: this.size, h: this.h, sp: this.speed });
      else this.w.op({ o: 'move', t: this.id, x: nx, y: ny, h: this.h, sp: this.speed });
      this.x = nx; this.y = ny;
      if (this.fillPts) this.fillPts.push([nx, ny]);
    }
    forward(d) { const a = this.h * Math.PI / 180; this.moveTo(this.x + d * Math.cos(a), this.y + d * Math.sin(a)); }
    turn(a) { this.h = ((this.h + a) % 360 + 360) % 360; }
  }
  class PyScreen { constructor(w) { this.w = w; } }
  function colorArg(py, t, args) {
    if (args.length === 1 && typeof args[0] === 'string') {
      const s = args[0].trim();
      if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(s) || /^[a-zA-Z]{3,24}$/.test(s)) return s.toLowerCase();
      throw err('TurtleGraphicsError', `bad color string: ${s}`);
    }
    const rgb = args.length === 1 ? py.toArray(args[0]) : args;
    if (rgb.length !== 3 || !rgb.every(isNum)) throw err('TurtleGraphicsError', `bad color arguments: ${py.repr(tuple(args))}`);
    const max = t.w.mode === 255 ? 255 : 1;
    const v = rgb.map((x) => Number(x));
    if (v.some((x) => x < 0 || x > max)) throw err('TurtleGraphicsError', `bad color sequence: ${py.repr(tuple(rgb))}`);
    return `rgb(${v.map((x) => Math.round(x * 255 / max)).join(',')})`;
  }
  const point = (py, args) => {
    if (args.length === 1) { const p = py.toArray(args[0]); return [real(p[0]), real(p[1])]; }
    return [real(args[0]), real(args[1])];
  };
  const SPEEDS = { fastest: 0, fast: 10, normal: 6, slow: 3, slowest: 1 };
  const TURTLE_M = Object.create(null);
  const tm = (names, fn) => names.split(' ').forEach((n) => { TURTLE_M[n] = fn; });
  tm('forward fd', function (args, kw, t) { nargs('forward', args, 1, 1); t.forward(real(args[0])); return null; });
  tm('backward back bk', function (args, kw, t) { nargs('back', args, 1, 1); t.forward(-real(args[0])); return null; });
  tm('left lt', function (args, kw, t) { nargs('left', args, 1, 1); t.turn(real(args[0])); return null; });
  tm('right rt', function (args, kw, t) { nargs('right', args, 1, 1); t.turn(-real(args[0])); return null; });
  tm('goto setpos setposition', function (args, kw, t) { const [x, y] = point(this, args); t.moveTo(x, y); return null; });
  tm('teleport', function (args, kw, t) { const [x, y] = point(this, args); const d = t.down; t.down = false; t.moveTo(x, y); t.down = d; return null; });
  tm('setx', function (args, kw, t) { t.moveTo(real(args[0]), t.y); return null; });
  tm('sety', function (args, kw, t) { t.moveTo(t.x, real(args[0])); return null; });
  tm('setheading seth', function (args, kw, t) { t.h = ((real(args[0]) % 360) + 360) % 360; return null; });
  tm('home', function (args, kw, t) { t.moveTo(0, 0); t.h = 0; return null; });
  tm('circle', function (args, kw, t) {
    nargs('circle', args, 1, 3);
    const r = real(args[0]);
    const extent = args.length > 1 && args[1] !== null ? real(args[1]) : kw && kw.has('extent') ? real(kw.get('extent')) : 360;
    let steps = args.length > 2 && args[2] !== null ? Number(asInt(args[2])) : kw && kw.has('steps') ? Number(asInt(kw.get('steps'))) : null;
    const frac = Math.abs(extent) / 360;
    if (steps === null) steps = 1 + Math.floor(Math.min(11 + Math.abs(r) / 6, 59) * frac);
    steps = Math.max(1, Math.min(steps, 720));
    let w = extent / steps, w2 = 0.5 * w, l = 2 * r * Math.sin(w * Math.PI / 360);
    if (r < 0) { l = -l; w = -w; w2 = -w2; }
    t.turn(w2);
    for (let i = 0; i < steps; i++) { t.forward(l); t.turn(w); }
    t.turn(-w2);
    return null;
  });
  tm('dot', function (args, kw, t) {
    const size = args.length && args[0] !== null && isNum(args[0]) ? real(args[0]) : Math.max(t.size + 4, t.size * 2);
    const rest = args.length && isNum(args[0]) ? args.slice(1) : args.slice(args.length && args[0] === null ? 1 : 0);
    const c = rest.length ? colorArg(this, t, rest) : t.pen;
    t.w.op({ o: 'dot', t: t.id, x: t.x, y: t.y, r: size / 2, c, sp: t.speed });
    return null;
  });
  tm('write', function (args, kw, t) {
    const text = this.str(args[0]);
    const align = this.str(kwGet(kw, 'align', args.length > 2 ? args[2] : 'left'));
    const font = kwGet(kw, 'font', args.length > 3 ? args[3] : null);
    let size = 12;
    if (font instanceof PyTuple && font.v.length > 1 && isNum(font.v[1])) size = Math.max(6, Math.min(72, Number(font.v[1])));
    t.w.op({ o: 'text', t: t.id, x: t.x, y: t.y, s: text.slice(0, 200), c: t.pen, align: ['left', 'center', 'right'].includes(align) ? align : 'left', size, sp: t.speed });
    return null;
  });
  tm('penup pu up', function (args, kw, t) { t.down = false; return null; });
  tm('pendown pd down', function (args, kw, t) { t.down = true; return null; });
  tm('isdown', function (args, kw, t) { return t.down; });
  tm('pensize width', function (args, kw, t) { if (!args.length) return BigInt(Math.round(t.size)); t.size = Math.max(0.5, Math.min(60, real(args[0]))); return null; });
  tm('pencolor', function (args, kw, t) { if (!args.length) return t.pen; t.pen = colorArg(this, t, args); return null; });
  tm('fillcolor', function (args, kw, t) { if (!args.length) return t.fillc; t.fillc = colorArg(this, t, args); return null; });
  tm('color', function (args, kw, t) {
    if (!args.length) return tuple([t.pen, t.fillc]);
    if (args.length === 2) { t.pen = colorArg(this, t, [args[0]]); t.fillc = colorArg(this, t, [args[1]]); return null; }
    t.pen = t.fillc = colorArg(this, t, args);
    return null;
  });
  tm('begin_fill', function (args, kw, t) { t.fillPts = [[t.x, t.y]]; t.fillAt = t.w.ops.length; return null; });
  tm('end_fill', function (args, kw, t) {
    if (t.fillPts && t.fillPts.length > 2) t.w.op({ o: 'fill', t: t.id, pts: t.fillPts, c: t.fillc, at: t.fillAt, sp: t.speed });
    t.fillPts = null;
    return null;
  });
  tm('filling', function (args, kw, t) { return Boolean(t.fillPts); });
  tm('speed', function (args, kw, t) {
    if (!args.length) return BigInt(t.speed);
    const s = args[0];
    let v = typeof s === 'string' ? SPEEDS[s] : Math.round(real(s));
    if (v === undefined) v = 3;
    t.speed = v > 10 || v < 0.5 ? 0 : v;
    return null;
  });
  tm('hideturtle ht', function (args, kw, t) { t.shown = false; t.w.op({ o: 'show', t: t.id, on: false }); return null; });
  tm('showturtle st', function (args, kw, t) { t.shown = true; t.w.op({ o: 'show', t: t.id, on: true }); return null; });
  tm('isvisible', function (args, kw, t) { return t.shown; });
  tm('position pos', function (args, kw, t) { return tuple([t.x, t.y]); });
  tm('xcor', function (args, kw, t) { return t.x; });
  tm('ycor', function (args, kw, t) { return t.y; });
  tm('heading', function (args, kw, t) { return (Math.round(t.h * 1e10) / 1e10) % 360; }); // rounded, as Python's turtle does
  tm('distance', function (args, kw, t) { const [x, y] = args.length === 1 && args[0] instanceof PyTurtle ? [args[0].x, args[0].y] : point(this, args); return Math.hypot(x - t.x, y - t.y); });
  tm('towards', function (args, kw, t) { const [x, y] = point(this, args); return ((Math.atan2(y - t.y, x - t.x) * 180 / Math.PI) + 360) % 360; });
  tm('shape shapesize turtlesize tilt settiltangle resizemode clear reset clearstamps undo onclick onrelease ondrag', function () { return null; });
  tm('stamp', function () { return 0n; });
  tm('getscreen', function (args, kw, t) { return screenOf(t.w); });
  const screenOf = (w) => (w.screen = w.screen || new PyScreen(w));
  const SCREEN_M = Object.create(null);
  const sm = (names, fn) => names.split(' ').forEach((n) => { SCREEN_M[n] = fn; });
  sm('bgcolor', function (args, kw, s) { if (!args.length) return s.w.bg || 'white'; s.w.bg = colorArg(this, { w: s.w }, args); s.w.op({ o: 'bg', c: s.w.bg }); return null; });
  sm('colormode', function (args, kw, s) { if (!args.length) return s.w.mode === 255 ? 255n : 1.0; const m = Number(real(args[0])); if (m !== 1 && m !== 255) throw err('TurtleGraphicsError', `bad color mode: ${m}`); s.w.mode = m; return null; });
  sm('setup screensize title tracer update delay listen onkey onkeypress onkeyrelease onclick onscreenclick ontimer mainloop done exitonclick bye clear reset register_shape addshape mode setworldcoordinates', function () { return null; });
  sm('window_width window_height', function () { return 400n; });
  sm('turtles', function (args, kw, s) { return s.w.turtles.slice(); });
  MODULES.turtle = (py) => {
    if (!py.world) py.world = new TurtleWorld();
    const w = py.world;
    const main = () => (w.main = w.main || new PyTurtle(w));
    const d = new Map();
    Object.keys(TURTLE_M).forEach((k) => d.set(k, B(k, function (args, kw) { return TURTLE_M[k].call(this, args, kw, main()); })));
    Object.keys(SCREEN_M).forEach((k) => { if (!d.has(k)) d.set(k, B(k, function (args, kw) { return SCREEN_M[k].call(this, args, kw, screenOf(w)); })); });
    const T2 = new PyClass('Turtle', [OBJECT], new Map(), { builtin: true, module: 'turtle', native: () => new PyTurtle(w) });
    d.set('Turtle', T2); d.set('Pen', T2); d.set('RawTurtle', T2);
    d.set('Screen', B('Screen', () => screenOf(w)));
    d.set('TurtleGraphicsError', EXC.TurtleGraphicsError);
    return d;
  };

  /* ---------------- running a Python program ---------------- */

  // JSON (a test's arguments) as Python values
  function fromJSON(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER && !Object.is(v, -0) ? BigInt(v) : v;
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.map(fromJSON);
    if (typeof v === 'object') { const d = new PyDict(); Object.keys(v).forEach((k) => dset(d, k, fromJSON(v[k]))); return d; }
    return null;
  }

  function pyError(py, e) {
    if (e instanceof Halt) return { kind: e.kind, type: '', message: e.message, line: py.line };
    if (e instanceof Raise) {
      const ex = e.exc;
      const type = ex.cls.name;
      let message = '';
      try { message = py.str(ex); } catch (e2) { message = ''; }
      let kind = 'error';
      if (ex.eof) kind = 'eof';
      else if (type === 'RecursionError') kind = 'depth';
      else if (type === 'NotImplementedError' && /not available here/.test(message)) kind = 'unsupported';
      return { kind, type, message, line: e.line };
    }
    if (e instanceof RangeError) return { kind: 'depth', type: 'RecursionError', message: 'maximum recursion depth exceeded', line: py.line };
    if (e instanceof PySyntax) return { kind: 'syntax', type: e.type, message: e.msg, line: e.line };
    return { kind: 'error', type: 'InternalError', message: String((e && e.message) || e).slice(0, 200), line: py.line, internal: true };
  }

  function runPython(code, o, result) {
    const py = new Py(o);
    const prev = CUR;
    CUR = py;
    try {
      let tree;
      try { tree = pyParse(code); } catch (e) {
        if (e instanceof PySyntax) { result.error = { kind: 'syntax', type: e.type, message: e.msg, line: e.line }; return py; }
        if (e instanceof RangeError) { result.error = { kind: 'syntax', type: 'SyntaxError', message: 'too many nested brackets', line: 1 }; return py; }
        throw e;
      }
      try {
        py.block(tree, py.gscope);
        if (o.call) {
          const fn = py.globals.get(o.call.name);
          result.found = fn !== undefined && (fn instanceof PyFunction || fn instanceof PyBuiltin || fn instanceof PyClass || fn instanceof PyBound);
          if (result.found) {
            py.line = 0;
            const v = py.call(fn, (o.call.args || []).map(fromJSON), null);
            result.returned = true;
            result.value = v;
            result.shown = py.repr(v);
          }
        }
      } catch (e) {
        if (e instanceof Raise && e.exc.cls === EXC.SystemExit) { /* exit(): the program stops, quietly */ } else result.error = pyError(py, e);
      }
      if (py.world) {
        result.turtle = {
          ops: py.world.ops,
          bg: py.world.bg,
          turtles: py.world.turtles.map((t) => ({ x: t.x, y: t.y, h: t.h, shown: t.shown, pen: t.pen }))
        };
      }
      return py;
    } finally { CUR = prev; }
  }

  /* =====================================================================
     JavaScript (a subset): the lexer
     ===================================================================== */

  class JsSyntax { constructor(msg, line) { this.msg = msg; this.line = line; this.type = 'SyntaxError'; } }

  const JS_KW = new Set(['var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'new', 'delete',
    'typeof', 'instanceof', 'in', 'of', 'this', 'null', 'true', 'false', 'switch', 'case', 'default', 'throw', 'try', 'catch', 'finally',
    'class', 'void', 'async', 'await', 'yield', 'import', 'export', 'extends', 'super', 'with', 'debugger']);
  const JS_OPS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.',
    '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>', '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*',
    '/', '%', '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#'];
  const JS_NAME = /[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$\u200c\u200d]*/uy;
  // after these, a "/" would start a regular expression
  const REGEX_BEFORE = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '&&', '||', '??', '==', '===', '!=', '!==', '+', '-', '*', '%', '<', '>', '=>', 'return', 'typeof', 'case', 'of', 'in']);

  function jsUnescape(s, line) {
    return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (m, e) => {
      switch (e[0]) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case '0': return '\0';
        case '\n': case '\r': return '';
        case 'x': return String.fromCharCode(parseInt(e.slice(1), 16));
        case 'u': {
          const cp = parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16);
          if (cp > 0x10ffff) throw new JsSyntax('Undefined Unicode code-point', line);
          return String.fromCodePoint(cp);
        }
        default: return e;
      }
    });
  }

  function jsLex(src, start, line0, inTemplate) {
    const toks = [];
    let i = start || 0, line = line0 || 1, nl = true, depth = 0;
    const n = src.length;
    const push = (t, v, extra) => { toks.push(Object.assign({ t, v, line, nl }, extra)); nl = false; };
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; nl = true; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) throw new JsSyntax('Invalid or unexpected token: a comment is never closed (*/)', line);
        for (let j = i; j < end; j++) if (src[j] === '\n') { line++; nl = true; }
        i = end + 2;
        continue;
      }
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        const rest = src.slice(i, i + 400);
        let m = /^0[xX][0-9a-fA-F_]+|^0[oO][0-7_]+|^0[bB][01_]+/.exec(rest);
        let v;
        if (m) v = Number(m[0].replace(/_/g, ''));
        else { m = /^(?:\d[\d_]*)?(?:\.[\d_]*)?(?:[eE][+-]?\d+)?/.exec(rest); v = Number(m[0].replace(/_/g, '')); }
        i += m[0].length;
        if (src[i] === 'n') throw new JsSyntax('BigInt numbers (10n) are not available here', line);
        if (src[i] && /[\p{L}_$]/u.test(src[i])) throw new JsSyntax('Invalid or unexpected token', line);
        push('num', v);
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, raw = '';
        for (;;) {
          if (j >= n || src[j] === '\n') throw new JsSyntax('Invalid or unexpected token: this string is never closed', line);
          if (src[j] === '\\') { raw += src[j] + (src[j + 1] || ''); if (src[j + 1] === '\n') line++; j += 2; continue; }
          if (src[j] === c) break;
          raw += src[j++];
        }
        i = j + 1;
        push('str', jsUnescape(raw, line));
        continue;
      }
      if (c === '`') {
        const parts = [];
        const startLine = line;
        let j = i + 1, raw = '';
        for (;;) {
          if (j >= n) throw new JsSyntax('Unterminated template literal', startLine);
          const d = src[j];
          if (d === '\\') { raw += d + (src[j + 1] || ''); if (src[j + 1] === '\n') line++; j += 2; continue; }
          if (d === '`') { parts.push(jsUnescape(raw, line)); j++; break; }
          if (d === '$' && src[j + 1] === '{') {
            parts.push(jsUnescape(raw, line));
            raw = '';
            const sub = jsLex(src, j + 2, line, true);
            parts.push({ toks: sub.toks, line });
            line = sub.line;
            j = sub.end + 1;
            continue;
          }
          if (d === '\n') line++;
          raw += d;
          j++;
        }
        i = j;
        toks.push({ t: 'tmpl', v: parts, line: startLine, nl });
        nl = false;
        continue;
      }
      if (/[\p{L}\p{Nl}_$]/u.test(c) || (c >= '\uD800' && c <= '\uDBFF')) {
        JS_NAME.lastIndex = i;
        const m = JS_NAME.exec(src);
        if (m) {
          i += m[0].length;
          if (JS_KW.has(m[0])) push('kw', m[0]); else push('name', m[0]);
          continue;
        }
      }
      let op = null;
      for (const o of JS_OPS) if (src.startsWith(o, i)) { op = o; break; }
      if (op) {
        if (op === '?.' && /[0-9]/.test(src[i + 2] || '')) op = '?';
        if (op === '/' || op === '/=') {
          const prev = toks[toks.length - 1];
          if (!prev || REGEX_BEFORE.has(prev.v) && (prev.t === 'op' || prev.t === 'kw')) throw new JsSyntax('Regular expressions (/.../) are not available here: use string methods like includes() and split()', line);
        }
        if (inTemplate) {
          if (op === '{') depth++;
          else if (op === '}') { if (depth === 0) return { toks: endToks(toks, line), end: i, line }; depth--; }
        }
        push('op', op);
        i += op.length;
        continue;
      }
      if (/[\u201c\u201d\u2018\u2019]/.test(c)) throw new JsSyntax(`Invalid or unexpected token: '${c}' is a curly quote; use straight quotes, ' or "`, line);
      throw new JsSyntax(`Invalid or unexpected token '${String.fromCodePoint(src.codePointAt(i))}'`, line);
    }
    if (inTemplate) throw new JsSyntax('Unterminated template literal', line);
    return { toks: endToks(toks, line), end: i, line };
  }
  const endToks = (toks, line) => { toks.push({ t: 'eof', v: '', line, nl: true }); return toks; };

  /* =====================================================================
     JavaScript: the parser
     ===================================================================== */

  const JS_ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
  const JS_BIN = [
    ['??'], ['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!=', '===', '!=='], ['<', '>', '<=', '>=', 'instanceof', 'in'], ['<<', '>>', '>>>'], ['+', '-'], ['*', '/', '%']
  ].map((ops) => new Set(ops));

  class JsParser {
    constructor(toks) { this.t = toks; this.p = 0; this.fns = 0; this.loops = 0; this.noIn = false; }
    get tok() { return this.t[this.p]; }
    peek(k) { return this.t[Math.min(this.p + (k || 1), this.t.length - 1)]; }
    at(v) { const t = this.t[this.p]; return (t.t === 'op' || t.t === 'kw') && t.v === v; }
    eat(v) { if (this.at(v)) { this.p++; return true; } return false; }
    expect(v) { if (!this.eat(v)) this.unexpected(v); }
    unexpected(want) {
      const t = this.tok;
      if (t.t === 'eof') throw new JsSyntax(want ? `Unexpected end of input: '${want}' is missing` : 'Unexpected end of input', t.line);
      const shown = t.t === 'name' ? `identifier '${t.v}'` : t.t === 'num' ? 'number' : t.t === 'str' ? 'string' : `token '${t.v}'`;
      throw new JsSyntax(`Unexpected ${shown}` + (want ? ` (expected '${want}')` : ''), t.line);
    }
    semi() {
      if (this.eat(';')) return;
      const t = this.tok;
      if (t.nl || t.t === 'eof' || (t.t === 'op' && t.v === '}')) return;
      this.unexpected();
    }
    ident() {
      const t = this.tok;
      if (t.t === 'name' || (t.t === 'kw' && (t.v === 'of' || t.v === 'async'))) { this.p++; return t.v; }
      this.unexpected();
    }

    program() {
      const body = [];
      while (this.tok.t !== 'eof') body.push(this.statement());
      return body;
    }
    block() {
      const line = this.tok.line;
      this.expect('{');
      const body = [];
      while (!this.at('}')) { if (this.tok.t === 'eof') this.unexpected('}'); body.push(this.statement()); }
      this.p++;
      return { k: 'Block', body, line };
    }
    statement() {
      const t = this.tok, line = t.line;
      if (t.t === 'kw') {
        switch (t.v) {
          case 'var': case 'let': case 'const': { const d = this.varDecl(); this.semi(); return d; }
          case 'function': return this.funcDecl();
          case 'if': {
            this.p++; this.expect('(');
            const test = this.expr();
            this.expect(')');
            const cons = this.statement();
            const alt = this.eat('else') ? this.statement() : null;
            return { k: 'If', test, cons, alt, line };
          }
          case 'for': return this.forStmt();
          case 'while': {
            this.p++; this.expect('(');
            const test = this.expr();
            this.expect(')');
            this.loops++;
            const body = this.statement();
            this.loops--;
            return { k: 'While', test, body, line };
          }
          case 'do': {
            this.p++;
            this.loops++;
            const body = this.statement();
            this.loops--;
            this.expect('while'); this.expect('(');
            const test = this.expr();
            this.expect(')');
            this.eat(';');
            return { k: 'DoWhile', test, body, line };
          }
          case 'break': this.p++; if (!this.loops) throw new JsSyntax('Illegal break statement', line); if (this.tok.t === 'name' && !this.tok.nl) throw new JsSyntax('labels are not available here', line); this.semi(); return { k: 'Break', line };
          case 'continue': this.p++; if (!this.loops) throw new JsSyntax('Illegal continue statement: no surrounding loop', line); if (this.tok.t === 'name' && !this.tok.nl) throw new JsSyntax('labels are not available here', line); this.semi(); return { k: 'Continue', line };
          case 'return': {
            if (!this.fns) throw new JsSyntax('Illegal return statement', line);
            this.p++;
            let value = null;
            if (!this.at(';') && !this.at('}') && !this.tok.nl && this.tok.t !== 'eof') value = this.expr();
            this.semi();
            return { k: 'Return', value, line };
          }
          case 'throw': {
            this.p++;
            if (this.tok.nl) throw new JsSyntax('Illegal newline after throw', line);
            const value = this.expr();
            this.semi();
            return { k: 'Throw', value, line };
          }
          case 'try': {
            this.p++;
            const block = this.block();
            let param = null, handler = null, final = null;
            if (this.eat('catch')) {
              if (this.eat('(')) { param = this.pattern(); this.expect(')'); }
              handler = this.block();
            }
            if (this.eat('finally')) final = this.block();
            if (!handler && !final) throw new JsSyntax('Missing catch or finally after try', line);
            return { k: 'Try', block, param, handler, final, line };
          }
          case 'switch': {
            this.p++; this.expect('(');
            const disc = this.expr();
            this.expect(')'); this.expect('{');
            const cases = [];
            this.loops++;
            while (!this.eat('}')) {
              let test = null;
              if (this.eat('default')) test = null;
              else { this.expect('case'); test = this.expr(); }
              this.expect(':');
              const body = [];
              while (!this.at('case') && !this.at('default') && !this.at('}')) { if (this.tok.t === 'eof') this.unexpected('}'); body.push(this.statement()); }
              cases.push({ test, body });
            }
            this.loops--;
            return { k: 'Switch', disc, cases, line };
          }
          case 'class': throw new JsSyntax('classes are not available in this JavaScript: use objects and functions', line);
          case 'async': case 'await': throw new JsSyntax("'async' and 'await' are not available here", line);
          case 'import': case 'export': throw new JsSyntax('modules (import and export) are not available here', line);
          case 'with': throw new JsSyntax("'with' is not available here", line);
          case 'debugger': this.p++; this.semi(); return { k: 'Empty', line };
        }
      }
      if (t.t === 'op' && t.v === '{') return this.block();
      if (t.t === 'op' && t.v === ';') { this.p++; return { k: 'Empty', line }; }
      if (t.t === 'name' && this.peek().t === 'op' && this.peek().v === ':') throw new JsSyntax('labels are not available here', line);
      const x = this.expr();
      this.semi();
      return { k: 'Expr', x, line };
    }
    varDecl() {
      const line = this.tok.line, kind = this.tok.v;
      this.p++;
      const decls = [];
      do {
        const id = this.pattern();
        let init = null;
        if (this.eat('=')) init = this.assign();
        else if (kind === 'const' && !(this.at('of') || this.at('in'))) throw new JsSyntax('Missing initializer in const declaration', line);
        else if (id.k !== 'Id' && !(this.at('of') || this.at('in'))) throw new JsSyntax('Missing initializer in destructuring declaration', line);
        decls.push({ id, init });
      } while (this.eat(','));
      return { k: 'Var', kind, decls, line };
    }
    funcDecl() {
      const line = this.tok.line;
      this.p++;
      if (this.at('*')) throw new JsSyntax('generator functions are not available here', line);
      const name = this.ident();
      const f = this.funcRest(name, line, false);
      return { k: 'FuncDecl', name, fn: f, line };
    }
    funcRest(name, line, arrow) {
      this.expect('(');
      const params = this.params();
      const fns = this.fns, loops = this.loops;
      this.fns = 1; this.loops = 0;
      const body = this.block().body;
      this.fns = fns; this.loops = loops;
      return { k: 'Func', name, params, body, expr: null, arrow, line, vars: hoistVars(body, params) };
    }
    params() {
      const ps = [];
      while (!this.at(')')) {
        if (this.eat('...')) { ps.push({ rest: true, target: this.pattern() }); break; }
        const target = this.pattern();
        const def = this.eat('=') ? this.assign() : null;
        ps.push({ target, def });
        if (!this.eat(',')) break;
      }
      this.expect(')');
      return ps;
    }
    pattern() {
      const t = this.tok, line = t.line;
      if (this.at('[')) {
        this.p++;
        const elts = [];
        let rest = null;
        while (!this.at(']')) {
          if (this.at(',')) { this.p++; elts.push(null); continue; }
          if (this.eat('...')) { rest = this.pattern(); break; }
          const target = this.pattern();
          elts.push(this.eat('=') ? { k: 'Default', target, def: this.assign(), line } : target);
          if (!this.eat(',')) break;
        }
        this.expect(']');
        return { k: 'ArrPat', elts, rest, line };
      }
      if (this.at('{')) {
        this.p++;
        const props = [];
        let rest = null;
        while (!this.at('}')) {
          if (this.eat('...')) { rest = this.pattern(); break; }
          const kt = this.tok;
          let key;
          if (kt.t === 'name' || kt.t === 'kw') key = kt.v; else if (kt.t === 'str') key = kt.v; else if (kt.t === 'num') key = String(kt.v); else this.unexpected();
          this.p++;
          let target = { k: 'Id', name: key, line: kt.line };
          if (this.eat(':')) target = this.pattern();
          if (this.eat('=')) target = { k: 'Default', target, def: this.assign(), line };
          props.push({ key, target });
          if (!this.eat(',')) break;
        }
        this.expect('}');
        return { k: 'ObjPat', props, rest, line };
      }
      return { k: 'Id', name: this.ident(), line };
    }
    forStmt() {
      const line = this.tok.line;
      this.p++;
      if (this.at('await')) throw new JsSyntax("'for await' is not available here", line);
      this.expect('(');
      let init = null;
      if (this.at('var') || this.at('let') || this.at('const')) {
        const kind = this.tok.v, l2 = this.tok.line;
        if (this.peek(2).t === 'kw' && (this.peek(2).v === 'of' || this.peek(2).v === 'in') || ((this.peek().v === '[' || this.peek().v === '{') && this.lookOfIn())) {
          this.p++;
          const target = this.pattern();
          return this.forInOf({ kind, target, line: l2 }, line);
        }
        this.noIn = true;
        init = this.varDecl();
        this.noIn = false;
      } else if (!this.at(';')) {
        this.noIn = true;
        const x = this.expr();
        this.noIn = false;
        if (this.at('of') || this.at('in')) return this.forInOf({ kind: null, target: toPattern(x), line }, line);
        init = { k: 'Expr', x, line };
      }
      this.expect(';');
      const test = this.at(';') ? null : this.expr();
      this.expect(';');
      const update = this.at(')') ? null : this.expr();
      this.expect(')');
      this.loops++;
      const body = this.statement();
      this.loops--;
      return { k: 'For', init, test, update, body, line };
    }
    lookOfIn() {
      let d = 0;
      for (let j = this.p + 1; j < this.t.length; j++) {
        const t = this.t[j];
        if (t.t === 'op' && (t.v === '[' || t.v === '{' || t.v === '(')) d++;
        else if (t.t === 'op' && (t.v === ']' || t.v === '}' || t.v === ')')) { d--; if (d === 0) { const nx = this.t[j + 1]; return nx.t === 'kw' && (nx.v === 'of' || nx.v === 'in'); } }
      }
      return false;
    }
    forInOf(left, line) {
      const of = this.tok.v === 'of';
      this.p++;
      const right = of ? this.assign() : this.expr();
      this.expect(')');
      this.loops++;
      const body = this.statement();
      this.loops--;
      return { k: of ? 'ForOf' : 'ForIn', left, right, body, line };
    }

    expr() {
      const line = this.tok.line;
      const x = this.assign();
      if (!this.at(',')) return x;
      const list = [x];
      while (this.eat(',')) list.push(this.assign());
      return { k: 'Seq', list, line };
    }
    isArrow() {
      const t = this.tok;
      if ((t.t === 'name') && this.peek().t === 'op' && this.peek().v === '=>') return true;
      if (!(t.t === 'op' && t.v === '(')) return false;
      let d = 0;
      for (let j = this.p; j < this.t.length; j++) {
        const u = this.t[j];
        if (u.t === 'op' && (u.v === '(' || u.v === '[' || u.v === '{')) d++;
        else if (u.t === 'op' && (u.v === ')' || u.v === ']' || u.v === '}')) { d--; if (d === 0) { const nx = this.t[j + 1]; return nx.t === 'op' && nx.v === '=>' && !nx.nl; } }
        else if (u.t === 'eof') return false;
      }
      return false;
    }
    arrow() {
      const line = this.tok.line;
      let params;
      if (this.tok.t === 'name') { params = [{ target: { k: 'Id', name: this.tok.v, line } }]; this.p++; } else { this.p++; params = this.params(); }
      this.expect('=>');
      const fns = this.fns, loops = this.loops;
      this.fns = 1; this.loops = 0;
      let f;
      if (this.at('{')) { const body = this.block().body; f = { k: 'Func', name: '', params, body, expr: null, arrow: true, line, vars: hoistVars(body, params) }; } else {
        const e = this.assign();
        const body = [{ k: 'Return', value: e, line }];
        f = { k: 'Func', name: '', params, body, expr: e, arrow: true, line, vars: hoistVars(body, params) };
      }
      this.fns = fns; this.loops = loops;
      return f;
    }
    assign() {
      if (this.at('async')) throw new JsSyntax("'async' functions are not available here", this.tok.line);
      if (this.isArrow()) return this.arrow();
      const line = this.tok.line;
      const left = this.cond();
      const t = this.tok;
      if (t.t === 'op' && JS_ASSIGN.has(t.v)) {
        this.p++;
        const target = t.v === '=' ? toPattern(left) : left;
        if (t.v !== '=' && left.k !== 'Id' && left.k !== 'Member') throw new JsSyntax('Invalid left-hand side in assignment', line);
        return { k: 'Assign', op: t.v, target, value: this.assign(), line };
      }
      return left;
    }
    cond() {
      const line = this.tok.line;
      const test = this.bin(0);
      if (!this.eat('?')) return test;
      const noIn = this.noIn;
      this.noIn = false;
      const cons = this.assign();
      this.noIn = noIn;
      this.expect(':');
      return { k: 'Cond', test, cons, alt: this.assign(), line };
    }
    bin(level) {
      if (level >= JS_BIN.length) return this.expo();
      const line = this.tok.line;
      let x = this.bin(level + 1);
      for (;;) {
        const t = this.tok;
        if (!((t.t === 'op' || t.t === 'kw') && JS_BIN[level].has(t.v))) return x;
        if (t.v === 'in' && this.noIn) return x;
        this.p++;
        const y = this.bin(level + 1);
        x = (t.v === '&&' || t.v === '||' || t.v === '??') ? { k: 'Logic', op: t.v, l: x, r: y, line } : { k: 'Bin', op: t.v, l: x, r: y, line };
      }
    }
    expo() {
      const line = this.tok.line;
      const x = this.unary();
      if (this.eat('**')) return { k: 'Bin', op: '**', l: x, r: this.expo(), line };
      return x;
    }
    unary() {
      const t = this.tok, line = t.line;
      if ((t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~')) || (t.t === 'kw' && (t.v === 'typeof' || t.v === 'void' || t.v === 'delete'))) {
        this.p++;
        return { k: 'Unary', op: t.v, x: this.unary(), line };
      }
      if (t.t === 'op' && (t.v === '++' || t.v === '--')) {
        this.p++;
        const x = this.unary();
        if (x.k !== 'Id' && x.k !== 'Member') throw new JsSyntax('Invalid left-hand side expression in prefix operation', line);
        return { k: 'Update', op: t.v, prefix: true, x, line };
      }
      if (t.t === 'kw' && t.v === 'await') throw new JsSyntax("'await' is not available here", line);
      const x = this.postfix();
      return x;
    }
    postfix() {
      const x = this.call();
      const t = this.tok;
      if (t.t === 'op' && (t.v === '++' || t.v === '--') && !t.nl) {
        if (x.k !== 'Id' && x.k !== 'Member') throw new JsSyntax('Invalid left-hand side expression in postfix operation', t.line);
        this.p++;
        return { k: 'Update', op: t.v, prefix: false, x, line: t.line };
      }
      return x;
    }
    call() {
      let x;
      const line = this.tok.line;
      if (this.at('new')) {
        this.p++;
        const callee = this.member(this.primary());
        const args = this.at('(') ? (this.p++, this.args()) : [];
        x = { k: 'New', callee, args, line };
      } else x = this.primary();
      return this.member(x, true);
    }
    member(x, calls) {
      for (;;) {
        const t = this.tok;
        if (t.t !== 'op') return x;
        if (t.v === '.') {
          this.p++;
          const nt = this.tok;
          if (nt.t !== 'name' && nt.t !== 'kw') this.unexpected();
          this.p++;
          x = { k: 'Member', obj: x, prop: nt.v, computed: false, line: t.line };
        } else if (t.v === '?.') {
          this.p++;
          if (this.at('(')) { this.p++; x = { k: 'Call', callee: x, args: this.args(), opt: true, line: t.line }; continue; }
          if (this.at('[')) { this.p++; const prop = this.expr(); this.expect(']'); x = { k: 'Member', obj: x, prop, computed: true, opt: true, line: t.line }; continue; }
          const nt = this.tok;
          if (nt.t !== 'name' && nt.t !== 'kw') this.unexpected();
          this.p++;
          x = { k: 'Member', obj: x, prop: nt.v, computed: false, opt: true, line: t.line };
        } else if (t.v === '[') {
          this.p++;
          const prop = this.expr();
          this.expect(']');
          x = { k: 'Member', obj: x, prop, computed: true, line: t.line };
        } else if (t.v === '(' && calls) {
          this.p++;
          x = { k: 'Call', callee: x, args: this.args(), line: t.line };
        } else if (t.t === 'op' && t.v === '`') return x;
        else return x;
        if (this.tok.t === 'tmpl' && !this.tok.nl) throw new JsSyntax('tagged templates are not available here', this.tok.line);
      }
    }
    args() {
      const args = [];
      while (!this.at(')')) {
        if (this.eat('...')) args.push({ k: 'Spread', x: this.assign(), line: this.tok.line }); else args.push(this.assign());
        if (!this.eat(',')) break;
      }
      this.expect(')');
      return args;
    }
    primary() {
      const t = this.tok, line = t.line;
      switch (t.t) {
        case 'num': this.p++; return { k: 'Lit', v: t.v, line };
        case 'str': this.p++; return { k: 'Lit', v: t.v, line };
        case 'tmpl': {
          this.p++;
          const parts = t.v.map((p) => {
            if (typeof p === 'string') return p;
            const sub = new JsParser(p.toks);
            sub.fns = this.fns;
            if (sub.tok.t === 'eof') throw new JsSyntax('an empty ${} in a template literal', p.line);
            const x = sub.expr();
            if (sub.tok.t !== 'eof') sub.unexpected();
            return x;
          });
          return { k: 'Tmpl', parts, line };
        }
        case 'name': this.p++; return { k: 'Id', name: t.v, line };
        case 'kw':
          switch (t.v) {
            case 'true': this.p++; return { k: 'Lit', v: true, line };
            case 'false': this.p++; return { k: 'Lit', v: false, line };
            case 'null': this.p++; return { k: 'Lit', v: null, line };
            case 'this': this.p++; return { k: 'This', line };
            case 'function': {
              this.p++;
              if (this.at('*')) throw new JsSyntax('generator functions are not available here', line);
              const name = this.tok.t === 'name' ? this.ident() : '';
              return this.funcRest(name, line, false);
            }
            case 'of': this.p++; return { k: 'Id', name: 'of', line };
            case 'class': throw new JsSyntax('classes are not available in this JavaScript: use objects and functions', line);
            case 'super': throw new JsSyntax("'super' is not available here", line);
          }
          break;
        case 'op':
          if (t.v === '(') {
            this.p++;
            const noIn = this.noIn;
            this.noIn = false;
            const x = this.expr();
            this.noIn = noIn;
            this.expect(')');
            return x;
          }
          if (t.v === '[') {
            this.p++;
            const elts = [];
            while (!this.at(']')) {
              if (this.at(',')) { this.p++; elts.push({ k: 'Lit', v: undefined, line }); continue; }
              if (this.eat('...')) elts.push({ k: 'Spread', x: this.assign(), line }); else elts.push(this.assign());
              if (!this.eat(',')) break;
            }
            this.expect(']');
            return { k: 'Arr', elts, line };
          }
          if (t.v === '{') return this.object();
          if (t.v === '#') throw new JsSyntax('private fields (#) are not available here', line);
      }
      this.unexpected();
    }
    object() {
      const line = this.tok.line;
      this.p++;
      const props = [];
      while (!this.at('}')) {
        if (this.eat('...')) { props.push({ spread: this.assign() }); if (!this.eat(',')) break; continue; }
        const kt = this.tok;
        let key, computed = null;
        if ((kt.t === 'name' || kt.t === 'kw') && (kt.v === 'get' || kt.v === 'set') && (this.peek().t === 'name' || this.peek().t === 'str') && this.peek(2).v === '(') throw new JsSyntax('getters and setters are not available here', kt.line);
        if (kt.t === 'name' || kt.t === 'kw') { key = kt.v; this.p++; } else if (kt.t === 'str') { key = kt.v; this.p++; } else if (kt.t === 'num') { key = numKey(kt.v); this.p++; } else if (this.at('[')) { this.p++; computed = this.assign(); this.expect(']'); } else this.unexpected();
        if (this.at('(')) {
          const f = this.funcRest(key || '', kt.line, false);
          props.push({ key, computed, value: f });
        } else if (this.eat(':')) props.push({ key, computed, value: this.assign() });
        else if (kt.t === 'name' && !computed) {
          if (this.at('=')) { this.p++; props.push({ key, value: { k: 'Default', target: { k: 'Id', name: key, line: kt.line }, def: this.assign(), line } }); } else props.push({ key, value: { k: 'Id', name: key, line: kt.line } });
        } else this.unexpected(':');
        if (!this.eat(',')) break;
      }
      this.expect('}');
      return { k: 'Obj', props, line };
    }
  }
  const numKey = (n) => String(n);
  // an expression on the left of "=" ([a, b] = [b, a]) as a pattern
  function toPattern(x) {
    switch (x.k) {
      case 'Id': case 'Member': return x;
      case 'Arr': {
        const elts = [];
        let rest = null;
        x.elts.forEach((e, i) => {
          if (e.k === 'Spread') { if (i !== x.elts.length - 1) throw new JsSyntax('Rest element must be last element', x.line); rest = toPattern(e.x); } else if (e.k === 'Lit' && e.v === undefined) elts.push(null);
          else if (e.k === 'Assign' && e.op === '=') elts.push({ k: 'Default', target: toPattern(e.target), def: e.value, line: e.line });
          else elts.push(toPattern(e));
        });
        return { k: 'ArrPat', elts, rest, line: x.line };
      }
      case 'Obj': {
        const props = [];
        let rest = null;
        for (const p of x.props) {
          if (p.spread) { rest = toPattern(p.spread); continue; }
          if (p.computed) throw new JsSyntax('Invalid destructuring assignment target', x.line);
          const v = p.value;
          props.push({ key: p.key, target: v.k === 'Default' ? v : v.k === 'Assign' && v.op === '=' ? { k: 'Default', target: toPattern(v.target), def: v.value, line: v.line } : toPattern(v) });
        }
        return { k: 'ObjPat', props, rest, line: x.line };
      }
      case 'Default': return x;
      case 'ArrPat': case 'ObjPat': return x;
    }
    throw new JsSyntax('Invalid left-hand side in assignment', x.line);
  }
  // the names a function declares with var (and its function declarations), found before it runs
  function hoistVars(body, params) {
    const vars = new Set();
    const walk = (s) => {
      if (!s) return;
      switch (s.k) {
        case 'Var': if (s.kind === 'var') s.decls.forEach((d) => patNames(d.id, vars)); break;
        case 'If': walk(s.cons); walk(s.alt); break;
        case 'For': walk(s.init); walk(s.body); break;
        case 'ForOf': case 'ForIn': if (s.left.kind === 'var') patNames(s.left.target, vars); walk(s.body); break;
        case 'While': case 'DoWhile': walk(s.body); break;
        case 'Block': s.body.forEach(walk); break;
        case 'Try': walk(s.block); walk(s.handler); walk(s.final); break;
        case 'Switch': s.cases.forEach((c) => c.body.forEach(walk)); break;
      }
    };
    body.forEach(walk);
    return vars;
  }
  function patNames(p, set) {
    if (!p) return set;
    switch (p.k) {
      case 'Id': set.add(p.name); break;
      case 'Default': patNames(p.target, set); break;
      case 'ArrPat': p.elts.forEach((e) => patNames(e, set)); patNames(p.rest, set); break;
      case 'ObjPat': p.props.forEach((q) => patNames(q.target, set)); patNames(p.rest, set); break;
    }
    return set;
  }
  function jsParse(src) {
    const { toks } = jsLex(String(src).replace(/\r\n?/g, '\n'));
    return new JsParser(toks).program();
  }

  /* =====================================================================
     JavaScript: values and the interpreter
       primitives are JavaScript's own; arrays are arrays; objects are
       objects with no prototype (nothing of the host is reachable)
     ===================================================================== */

  class JsFunc { constructor(node, scope, thisVal) { this.node = node; this.scope = scope; this.thisVal = thisVal; this.name = node.name || ''; this.props = null; } }
  class JsNative { constructor(name, fn, props) { this.name = name; this.fn = fn; this.props = props || null; this.ctor = null; } }
  class JsMap { constructor() { this.m = new Map(); } }
  class JsSet { constructor() { this.s = new Set(); } }
  class JsThrow { constructor(value, line) { this.value = value; this.line = line; } }
  const ERR_KIND = Symbol('error');
  const obj = () => Object.create(null);
  const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === null;
  const isFn = (v) => v instanceof JsFunc || v instanceof JsNative;
  const isIndex = (k) => (typeof k === 'number' && Number.isInteger(k) && k >= 0) || (typeof k === 'string' && /^(?:0|[1-9]\d*)$/.test(k));

  let JCUR = null;
  const ERR_TYPES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError'];
  function jsErrObj(type, msg) {
    const e = obj();
    Object.defineProperty(e, ERR_KIND, { value: type, enumerable: false });
    e.name = type;
    e.message = msg == null ? '' : String(msg);
    return e;
  }
  const jerr = (type, msg) => new JsThrow(jsErrObj(type, msg), JCUR ? JCUR.line : 0);

  function jsTypeof(v) {
    if (v === null) return 'object';
    if (isFn(v)) return 'function';
    return typeof v;
  }
  // what an expression is called in "x is not a function"
  function jsDesc(e) {
    if (!e) return 'expression';
    if (e.k === 'Id') return e.name;
    if (e.k === 'Member') return e.computed ? jsDesc(e.obj) + '[...]' : jsDesc(e.obj) + '.' + e.prop;
    if (e.k === 'Call') return jsDesc(e.callee) + '(...)';
    if (e.k === 'This') return 'this';
    return '(intermediate value)';
  }

  class Js {
    constructor(opts) {
      this.maxSteps = opts.steps; this.steps = 0;
      this.maxDepth = opts.depth; this.depth = 0;
      this.out = opts.out; this.stdin = opts.stdin; this.inPos = 0; this.asked = false;
      this.line = 0;
      this.rng = makeRng(opts.seed);
      this.global = { vars: new Map(), parent: null, fn: true, thisVal: undefined };
      this.inspecting = new Set();
      jsGlobals(this);
    }
    tick(n) { if ((this.steps += n) > this.maxSteps) throw new Halt('timeout'); }

    /* scopes: { vars: Map(name -> { v, c: const?, i: initialised? }), parent, fn: a function's own scope } */
    lookup(name, s) {
      for (let sc = s; sc; sc = sc.parent) { const b = sc.vars.get(name); if (b) return b; }
      return null;
    }
    get(name, s, line) {
      const b = this.lookup(name, s);
      if (!b) {
        if (name === 'undefined') return undefined;
        const near = nearest(name, this.names(s));
        throw jerr('ReferenceError', `${name} is not defined` + (near ? `. Did you mean '${near}'?` : ''));
      }
      if (!b.i) throw jerr('ReferenceError', `Cannot access '${name}' before initialization`);
      return b.v;
    }
    names(s) { const out = []; for (let sc = s; sc; sc = sc.parent) for (const k of sc.vars.keys()) out.push(k); return out; }
    set(name, v, s) {
      const b = this.lookup(name, s);
      if (!b) { this.global.vars.set(name, { v, c: false, i: true }); return; }
      if (!b.i) throw jerr('ReferenceError', `Cannot access '${name}' before initialization`);
      if (b.c) throw jerr('TypeError', 'Assignment to constant variable.');
      b.v = v;
    }
    declare(s, name, kind, v, init) {
      const had = s.vars.get(name);
      if (had && (kind !== 'var' || had.c || had.lex)) {
        if (kind === 'var' && !had.lex && !had.c) { if (init) had.v = v; return; }
        throw jerr('SyntaxError', `Identifier '${name}' has already been declared`);
      }
      if (had && kind === 'var') { if (init) had.v = v; return; }
      s.vars.set(name, { v, c: kind === 'const', i: init, lex: kind === 'let' || kind === 'const' });
    }
    // a block's own declarations: let and const (not yet initialised), and function declarations (ready)
    hoistBlock(body, s) {
      for (const st of body) {
        if (st.k === 'Var' && st.kind !== 'var') { this.line = st.line; for (const d of st.decls) for (const n of patNames(d.id, new Set())) this.declare(s, n, st.kind, undefined, false); }
      }
      for (const st of body) {
        if (st.k === 'FuncDecl') {
          this.line = st.line;
          const b = s.vars.get(st.name);
          const f = new JsFunc(st.fn, s, undefined);
          if (b && b.lex) throw jerr('SyntaxError', `Identifier '${st.name}' has already been declared`);
          s.vars.set(st.name, { v: f, c: false, i: true });
        }
      }
    }
    needsScope(body) { return body.some((st) => (st.k === 'Var' && st.kind !== 'var') || st.k === 'FuncDecl'); }

    /* statements */
    block(body, s) {
      for (let i = 0; i < body.length; i++) {
        const r = this.exec(body[i], s);
        if (r) return r;
      }
      return 0;
    }
    exec(st, s) {
      if (++this.steps > this.maxSteps) throw new Halt('timeout');
      this.line = st.line;
      switch (st.k) {
        case 'Expr': this.ev(st.x, s); return 0;
        case 'Var':
          for (const d of st.decls) {
            const v = d.init ? this.ev(d.init, s) : undefined;
            if (d.init && d.init.k === 'Func' && !d.init.name && d.id.k === 'Id') this.nameFn(v, d.id.name);
            this.bindPattern(d.id, v, s, st.kind);
          }
          return 0;
        case 'FuncDecl': return 0;
        case 'Return': s.fnScope().ret = st.value ? this.ev(st.value, s) : undefined; return RET;
        case 'If':
          if (this.truthy(this.ev(st.test, s))) return this.exec(st.cons, s);
          return st.alt ? this.exec(st.alt, s) : 0;
        case 'Block': {
          if (!st.scoped) st.scoped = this.needsScope(st.body) ? 1 : 2;
          if (st.scoped === 2) return this.block(st.body, s);
          const bs = scope(s);
          this.hoistBlock(st.body, bs);
          return this.block(st.body, bs);
        }
        case 'While':
          for (;;) {
            this.line = st.line;
            if (!this.truthy(this.ev(st.test, s))) return 0;
            const r = this.exec(st.body, s);
            if (r === BRK) return 0;
            if (r === RET) return r;
            if (++this.steps > this.maxSteps) throw new Halt('timeout');
          }
        case 'DoWhile':
          for (;;) {
            const r = this.exec(st.body, s);
            if (r === BRK) return 0;
            if (r === RET) return r;
            if (++this.steps > this.maxSteps) throw new Halt('timeout');
            this.line = st.line;
            if (!this.truthy(this.ev(st.test, s))) return 0;
          }
        case 'For': return this.forLoop(st, s);
        case 'ForOf': case 'ForIn': {
          const right = this.ev(st.right, s);
          const nx = st.k === 'ForOf' ? this.iter(right, st.right) : this.keysIter(right);
          const kind = st.left.kind;
          for (;;) {
            const v = nx();
            if (v === DONE) return 0;
            let ls = s;
            if (kind === 'let' || kind === 'const') { ls = scope(s); this.bindPattern(st.left.target, v, ls, kind); } else if (kind === 'var') this.bindPattern(st.left.target, v, s, 'var');
            else this.assignPattern(st.left.target, v, s);
            const r = this.exec(st.body, ls);
            if (r === BRK) return 0;
            if (r === RET) return r;
            if (++this.steps > this.maxSteps) throw new Halt('timeout');
          }
        }
        case 'Break': return BRK;
        case 'Continue': return CONT;
        case 'Empty': return 0;
        case 'Throw': throw new JsThrow(this.ev(st.value, s), st.line);
        case 'Try': return this.tryStmt(st, s);
        case 'Switch': {
          const d = this.ev(st.disc, s);
          const bs = scope(s);
          const all = st.cases.flatMap((c) => c.body);
          this.hoistBlock(all, bs);
          let i = st.cases.findIndex((c) => c.test && this.ev(c.test, bs) === d);
          if (i < 0) i = st.cases.findIndex((c) => !c.test);
          if (i < 0) return 0;
          for (; i < st.cases.length; i++) {
            const r = this.block(st.cases[i].body, bs);
            if (r === BRK) return 0;
            if (r) return r;
          }
          return 0;
        }
      }
      throw jerr('SyntaxError', 'this statement is not available here');
    }
    forLoop(st, s) {
      let ls = s;
      let perIter = null;
      if (st.init) {
        if (st.init.k === 'Var' && st.init.kind !== 'var') {
          ls = scope(s);
          perIter = [...st.init.decls.reduce((set, d) => patNames(d.id, set), new Set())];
          this.exec(st.init, ls);
        } else this.exec(st.init, s);
      }
      for (;;) {
        this.line = st.line;
        if (st.test && !this.truthy(this.ev(st.test, ls))) return 0;
        const r = this.exec(st.body, ls);
        if (r === BRK) return 0;
        if (r === RET) return r;
        if (perIter) {
          // each turn of "for (let i...)" has its own i, so functions made in the loop keep theirs
          const next = scope(s);
          for (const n of perIter) { const b = ls.vars.get(n); next.vars.set(n, { v: b.v, c: b.c, i: true, lex: true }); }
          ls = next;
        }
        if (st.update) this.ev(st.update, ls);
        if (++this.steps > this.maxSteps) throw new Halt('timeout');
      }
    }
    tryStmt(st, s) {
      let r = 0, pending = null;
      try {
        try { r = this.exec(st.block, s); } catch (e) {
          if (!(e instanceof JsThrow) || !st.handler) throw e;
          const cs = scope(s);
          if (st.param) this.bindPattern(st.param, e.value, cs, 'let');
          this.hoistBlock(st.handler.body, cs);
          r = this.block(st.handler.body, cs);
        }
      } catch (e) {
        if (!(e instanceof JsThrow) || !st.final) throw e;
        pending = e;
      }
      if (st.final) { const r2 = this.exec(st.final, s); if (r2) return r2; }
      if (pending) throw pending;
      return r;
    }

    /* patterns */
    bindPattern(p, v, s, kind) {
      switch (p.k) {
        case 'Id':
          if (kind === 'var') {
            let fs = s;
            while (!fs.fn) fs = fs.parent;
            const b = fs.vars.get(p.name);
            if (b) { b.v = v; b.i = true; } else fs.vars.set(p.name, { v, c: false, i: true });
            return;
          }
          {
            const b = s.vars.get(p.name);
            if (b && !b.i) { b.v = v; b.i = true; return; }
            this.declare(s, p.name, kind, v, true);
          }
          return;
        case 'Default': this.bindPattern(p.target, v === undefined ? this.ev(p.def, s) : v, s, kind); return;
        case 'ArrPat': {
          if (v === null || v === undefined) throw jerr('TypeError', `${v} is not iterable`);
          const items = this.toArray(v);
          p.elts.forEach((e, i) => { if (e) this.bindPattern(e, items[i], s, kind); });
          if (p.rest) this.bindPattern(p.rest, items.slice(p.elts.length), s, kind);
          return;
        }
        case 'ObjPat': {
          if (v === null || v === undefined) throw jerr('TypeError', `Cannot destructure '${v}' as it is ${v}.`);
          const used = new Set();
          for (const q of p.props) { used.add(q.key); this.bindPattern(q.target, this.getProp(v, q.key), s, kind); }
          if (p.rest) { const o = obj(); if (isPlain(v)) for (const k of Object.keys(v)) if (!used.has(k)) o[k] = v[k]; this.bindPattern(p.rest, o, s, kind); }
          return;
        }
      }
    }
    assignPattern(p, v, s) {
      switch (p.k) {
        case 'Id': this.set(p.name, v, s); return;
        case 'Member': this.setProp(this.ev(p.obj, s), p.computed ? this.ev(p.prop, s) : p.prop, v); return;
        case 'Default': this.assignPattern(p.target, v === undefined ? this.ev(p.def, s) : v, s); return;
        case 'ArrPat': {
          const items = this.toArray(v);
          p.elts.forEach((e, i) => { if (e) this.assignPattern(e, items[i], s); });
          if (p.rest) this.assignPattern(p.rest, items.slice(p.elts.length), s);
          return;
        }
        case 'ObjPat': {
          if (v === null || v === undefined) throw jerr('TypeError', `Cannot destructure '${v}' as it is ${v}.`);
          for (const q of p.props) this.assignPattern(q.target, this.getProp(v, q.key), s);
          return;
        }
      }
      throw jerr('SyntaxError', 'Invalid left-hand side in assignment');
    }

    /* expressions */
    ev(e, s) {
      switch (e.k) {
        case 'Lit': return e.v;
        case 'Id': return this.get(e.name, s, e.line);
        case 'Bin': return this.binop(e.op, this.ev(e.l, s), this.ev(e.r, s));
        case 'Logic': {
          const l = this.ev(e.l, s);
          if (e.op === '&&') return this.truthy(l) ? this.ev(e.r, s) : l;
          if (e.op === '||') return this.truthy(l) ? l : this.ev(e.r, s);
          return l === null || l === undefined ? this.ev(e.r, s) : l;
        }
        case 'Member': {
          const o = this.ev(e.obj, s);
          if (e.opt && (o === null || o === undefined)) return undefined;
          return this.getProp(o, e.computed ? this.ev(e.prop, s) : e.prop, e);
        }
        case 'Call': return this.evCall(e, s);
        case 'Assign': return this.evAssign(e, s);
        case 'Update': {
          const old = this.toNum(this.ev(e.x, s));
          const nv = e.op === '++' ? old + 1 : old - 1;
          this.assignTo(e.x, nv, s);
          return e.prefix ? nv : old;
        }
        case 'Unary': {
          if (e.op === 'typeof') {
            if (e.x.k === 'Id' && !this.lookup(e.x.name, s)) return 'undefined';
            return jsTypeof(this.ev(e.x, s));
          }
          if (e.op === 'delete') {
            if (e.x.k !== 'Member') return true;
            const o = this.ev(e.x.obj, s);
            const k = e.x.computed ? this.ev(e.x.prop, s) : e.x.prop;
            if (isPlain(o)) delete o[this.key(k)];
            else if (Array.isArray(o) && isIndex(k)) { if (Number(k) < o.length) o[Number(k)] = undefined; } else if (o instanceof JsMap || o instanceof JsSet) { /* nothing */ }
            return true;
          }
          const v = this.ev(e.x, s);
          switch (e.op) {
            case '!': return !this.truthy(v);
            case '-': return -this.toNum(v);
            case '+': return this.toNum(v);
            case '~': return ~this.toNum(v);
            case 'void': return undefined;
          }
          break;
        }
        case 'Cond': return this.truthy(this.ev(e.test, s)) ? this.ev(e.cons, s) : this.ev(e.alt, s);
        case 'Seq': { let v; for (const x of e.list) v = this.ev(x, s); return v; }
        case 'Tmpl': {
          let out = '';
          for (const p of e.parts) out += typeof p === 'string' ? p : this.toStr(this.ev(p, s));
          if (out.length > LIMITS.str) throw new Halt('memory');
          return out;
        }
        case 'Arr': {
          const out = [];
          for (const x of e.elts) {
            if (x.k === 'Spread') for (const y of this.toArray(this.ev(x.x, s), x.x)) out.push(y); else out.push(this.ev(x, s));
          }
          if (out.length > LIMITS.list) throw new Halt('memory');
          return out;
        }
        case 'Obj': {
          const o = obj();
          for (const p of e.props) {
            if (p.spread) {
              const src = this.ev(p.spread, s);
              if (isPlain(src)) Object.keys(src).forEach((k) => { o[k] = src[k]; });
              else if (Array.isArray(src)) src.forEach((x, i) => { o[i] = x; });
              else if (typeof src === 'string') Array.from(src).forEach((x, i) => { o[i] = x; });
              continue;
            }
            const k = p.computed ? this.key(this.ev(p.computed, s)) : p.key;
            let v;
            if (p.value.k === 'Default') v = this.ev(p.value.target, s);
            else v = this.ev(p.value, s);
            if (p.value.k === 'Func' && !p.value.name) this.nameFn(v, k);
            o[k] = v;
          }
          return o;
        }
        case 'Func': return new JsFunc(e, s, e.arrow ? this.thisOf(s) : undefined);
        case 'This': return this.thisOf(s);
        case 'New': return this.evNew(e, s);
        case 'Spread': throw jerr('SyntaxError', 'Unexpected token ...');
        case 'Default': return this.ev(e.target, s);
      }
      throw jerr('SyntaxError', 'this is not available here');
    }
    nameFn(f, name) { if (f instanceof JsFunc && !f.name) f.name = String(name); }
    thisOf(s) { for (let sc = s; sc; sc = sc.parent) if (sc.fn) return sc.thisVal; return undefined; }
    key(k) { return typeof k === 'string' ? k : typeof k === 'number' ? String(k) : this.toStr(k); }
    evAssign(e, s) {
      if (e.op === '=') {
        const v = this.ev(e.value, s);
        if (e.target.k === 'Id' && e.value.k === 'Func' && !e.value.name) this.nameFn(v, e.target.name);
        this.assignPattern(e.target, v, s);
        return v;
      }
      const t = e.target;
      let o, k, cur;
      if (t.k === 'Id') cur = this.get(t.name, s);
      else { o = this.ev(t.obj, s); k = t.computed ? this.ev(t.prop, s) : t.prop; cur = this.getProp(o, k, t); }
      let v;
      if (e.op === '&&=') { if (!this.truthy(cur)) return cur; v = this.ev(e.value, s); } else if (e.op === '||=') { if (this.truthy(cur)) return cur; v = this.ev(e.value, s); } else if (e.op === '??=') { if (cur !== null && cur !== undefined) return cur; v = this.ev(e.value, s); } else v = this.binop(e.op.slice(0, -1), cur, this.ev(e.value, s));
      if (t.k === 'Id') this.set(t.name, v, s); else this.setProp(o, k, v);
      return v;
    }
    assignTo(t, v, s) {
      if (t.k === 'Id') this.set(t.name, v, s);
      else this.setProp(this.ev(t.obj, s), t.computed ? this.ev(t.prop, s) : t.prop, v);
    }
    evArgs(list, s) {
      const out = [];
      for (const a of list) {
        if (a.k === 'Spread') for (const y of this.toArray(this.ev(a.x, s), a.x)) out.push(y); else out.push(this.ev(a, s));
      }
      return out;
    }
    evCall(e, s) {
      const c = e.callee;
      let fn, self;
      if (c.k === 'Member') {
        self = this.ev(c.obj, s);
        if (c.opt && (self === null || self === undefined)) return undefined;
        fn = this.getProp(self, c.computed ? this.ev(c.prop, s) : c.prop, c);
      } else { fn = this.ev(c, s); self = undefined; }
      if (e.opt && (fn === null || fn === undefined)) return undefined;
      if (!isFn(fn)) throw jerr('TypeError', `${jsDesc(c)} is not a function`);
      const args = this.evArgs(e.args, s);
      const line = this.line;
      const r = this.call(fn, self, args);
      this.line = line;
      return r;
    }
    evNew(e, s) {
      const f = this.ev(e.callee, s);
      const args = this.evArgs(e.args, s);
      if (f instanceof JsNative && f.ctor) return f.ctor.call(this, args);
      if (f instanceof JsFunc && !f.node.arrow) {
        const o = obj();
        const r = this.call(f, o, args);
        return r !== null && typeof r === 'object' ? r : o;
      }
      throw jerr('TypeError', `${jsDesc(e.callee)} is not a constructor`);
    }
    call(fn, self, args) {
      if (fn instanceof JsNative) return fn.fn.call(this, self, args);
      if (!(fn instanceof JsFunc)) throw jerr('TypeError', `${this.inspect(fn, 0, true)} is not a function`);
      if (++this.depth > this.maxDepth) { this.depth--; throw jerr('RangeError', 'Maximum call stack size exceeded'); }
      if (++this.steps > this.maxSteps) { this.depth--; throw new Halt('timeout'); }
      try {
        const node = fn.node;
        const fs = { vars: new Map(), parent: fn.scope, fn: true, thisVal: node.arrow ? fn.thisVal : self, ret: undefined, fnScope: null };
        fs.fnScope = () => fs;
        if (node.name && !node.arrow && node.k === 'Func' && !fn.scope.vars.has(node.name)) fs.vars.set(node.name, { v: fn, c: false, i: true });
        for (const n of node.vars) fs.vars.set(n, { v: undefined, c: false, i: true });
        const ps = node.params;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          if (p.rest) { this.bindPattern(p.target, args.slice(i), fs, 'let'); break; }
          let v = args[i];
          if (v === undefined && p.def) v = this.ev(p.def, fs);
          if (p.target.k === 'Id') { const b = fs.vars.get(p.target.name); if (b) { b.v = v; b.lex = false; } else fs.vars.set(p.target.name, { v, c: false, i: true }); } else this.bindPattern(p.target, v, fs, 'let');
        }
        this.hoistBlock(node.body, fs);
        if (node.expr && node.body.length === 1) return this.ev(node.expr, fs);
        return this.block(node.body, fs) === RET ? fs.ret : undefined;
      } finally { this.depth--; }
    }

    /* properties */
    getProp(o, k, e) {
      if (o === null || o === undefined) throw jerr('TypeError', `Cannot read properties of ${o} (reading '${this.key(k)}')`);
      switch (typeof o) {
        case 'string':
          if (k === 'length') return o.length;
          if (isIndex(k)) return o[Number(k)];
          return STRING_PROTO[k] || undefined;
        case 'number': return NUMBER_PROTO[k] || undefined;
        case 'boolean': return k === 'toString' || k === 'valueOf' ? NUMBER_PROTO[k] : undefined;
      }
      if (Array.isArray(o)) {
        if (k === 'length') return o.length;
        if (isIndex(k)) return o[Number(k)];
        if (typeof k === 'number') return undefined;
        return ARRAY_PROTO[k] || undefined;
      }
      if (isPlain(o)) {
        const key = this.key(k);
        if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
        return OBJECT_PROTO[key] || undefined;
      }
      if (o instanceof JsFunc || o instanceof JsNative) {
        if (o.props && Object.prototype.hasOwnProperty.call(o.props, k)) return o.props[k];
        if (k === 'name') return o.name;
        if (k === 'length') return o instanceof JsFunc ? o.node.params.filter((p) => !p.rest && !p.def).length : 0;
        return FUNCTION_PROTO[k] || undefined;
      }
      if (o instanceof JsMap) { if (k === 'size') return o.m.size; return MAP_PROTO[k] || undefined; }
      if (o instanceof JsSet) { if (k === 'size') return o.s.size; return SET_PROTO[k] || undefined; }
      return undefined;
    }
    setProp(o, k, v) {
      if (o === null || o === undefined) throw jerr('TypeError', `Cannot set properties of ${o} (setting '${this.key(k)}')`);
      if (Array.isArray(o)) {
        if (isIndex(k)) {
          const i = Number(k);
          if (i > LIMITS.list) throw new Halt('memory');
          while (o.length < i) o.push(undefined);
          o[i] = v;
          return;
        }
        if (k === 'length') {
          const n = this.toNum(v);
          if (!Number.isInteger(n) || n < 0) throw jerr('RangeError', 'Invalid array length');
          if (n > LIMITS.list) throw new Halt('memory');
          while (o.length < n) o.push(undefined);
          o.length = n;
          return;
        }
        throw jerr('TypeError', `an array has no property '${this.key(k)}' to set here: use an object for named values`);
      }
      if (isPlain(o)) {
        if (Object.isFrozen(o)) return;
        o[this.key(k)] = v;
        return;
      }
      if (o instanceof JsFunc || o instanceof JsNative) { (o.props = o.props || obj())[this.key(k)] = v; return; }
      // strings, numbers, booleans: nothing happens, as in JavaScript
    }

    /* iteration */
    iter(v, e) {
      if (Array.isArray(v)) { let i = 0; return () => (i < v.length ? v[i++] : DONE); }
      if (typeof v === 'string') { const a = Array.from(v); let i = 0; return () => (i < a.length ? a[i++] : DONE); }
      if (v instanceof JsMap) { const it = v.m.entries(); return () => { const r = it.next(); return r.done ? DONE : [r.value[0], r.value[1]]; }; }
      if (v instanceof JsSet) { const it = v.s.values(); return () => { const r = it.next(); return r.done ? DONE : r.value; }; }
      throw jerr('TypeError', `${e ? jsDesc(e) : this.inspect(v, 0, true)} is not iterable`);
    }
    keysIter(v) {
      if (v === null || v === undefined) return () => DONE;
      const keys = Array.isArray(v) || typeof v === 'string' ? Object.keys(Array.from({ length: v.length })) : isPlain(v) ? Object.keys(v) : [];
      let i = 0;
      return () => (i < keys.length ? keys[i++] : DONE);
    }
    toArray(v, e) {
      if (Array.isArray(v)) return v.slice();
      const nx = this.iter(v, e), out = [];
      for (;;) { const x = nx(); if (x === DONE) return out; out.push(x); if ((out.length & 1023) === 0) this.tick(1024); }
    }

    /* conversions, as JavaScript does them */
    truthy(v) {
      if (typeof v === 'boolean') return v;
      if (v === null || v === undefined) return false;
      if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
      if (typeof v === 'string') return v.length > 0;
      return true;
    }
    prim(v) {
      if (v === null || typeof v !== 'object' && !isFn(v)) return v;
      if (Array.isArray(v)) {
        if (this.inspecting.has(v)) return '';
        this.inspecting.add(v);
        try { return v.map((x) => (x === null || x === undefined ? '' : this.toStr(x))).join(','); } finally { this.inspecting.delete(v); }
      }
      if (isFn(v)) return `function ${v.name}() { [code] }`;
      if (isPlain(v) && v[ERR_KIND]) return `${v.name}: ${v.message}`;
      if (isPlain(v) && typeof v.toString === 'object') return '[object Object]';
      if (isPlain(v) && isFn(v.toString)) return this.toStr(this.call(v.toString, v, []));
      if (v instanceof JsMap) return '[object Map]';
      if (v instanceof JsSet) return '[object Set]';
      return '[object Object]';
    }
    toStr(v) {
      if (typeof v === 'string') return v;
      const p = this.prim(v);
      return typeof p === 'string' ? p : String(p);
    }
    toNum(v) {
      if (typeof v === 'number') return v;
      const p = this.prim(v);
      return typeof p === 'string' ? Number(p) : Number(p);
    }
    binop(op, a, b) {
      switch (op) {
        case '+': {
          if (typeof a === 'number' && typeof b === 'number') return a + b;
          const x = this.prim(a), y = this.prim(b);
          if (typeof x === 'string' || typeof y === 'string') {
            const r = String(x) + String(y);
            if (r.length > LIMITS.str) throw new Halt('memory');
            return r;
          }
          return Number(x) + Number(y);
        }
        case '-': return this.toNum(a) - this.toNum(b);
        case '*': return this.toNum(a) * this.toNum(b);
        case '/': return this.toNum(a) / this.toNum(b);
        case '%': return this.toNum(a) % this.toNum(b);
        case '**': return Math.pow(this.toNum(a), this.toNum(b));
        case '==': return this.looseEq(a, b);
        case '!=': return !this.looseEq(a, b);
        case '===': return a === b;
        case '!==': return a !== b;
        case '<': case '>': case '<=': case '>=': {
          const x = this.prim(a), y = this.prim(b);
          if (typeof x === 'string' && typeof y === 'string') return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
          const p = Number(x), q = Number(y);
          return op === '<' ? p < q : op === '>' ? p > q : op === '<=' ? p <= q : p >= q;
        }
        case '&': return this.toNum(a) & this.toNum(b);
        case '|': return this.toNum(a) | this.toNum(b);
        case '^': return this.toNum(a) ^ this.toNum(b);
        case '<<': return this.toNum(a) << this.toNum(b);
        case '>>': return this.toNum(a) >> this.toNum(b);
        case '>>>': return this.toNum(a) >>> this.toNum(b);
        case 'in': {
          const k = this.key(a);
          if (isPlain(b)) return Object.prototype.hasOwnProperty.call(b, k);
          if (Array.isArray(b)) return k === 'length' || (isIndex(k) && Number(k) < b.length);
          if (b instanceof JsMap || b instanceof JsSet) return false;
          throw jerr('TypeError', `Cannot use 'in' operator to search for '${k}' in ${this.toStr(b)}`);
        }
        case 'instanceof': {
          if (!isFn(b)) throw jerr('TypeError', "Right-hand side of 'instanceof' is not callable");
          if (b === this.ctors.Array) return Array.isArray(a);
          if (b === this.ctors.Object) return a !== null && (typeof a === 'object' || isFn(a));
          if (b === this.ctors.Function) return isFn(a);
          if (b === this.ctors.Map) return a instanceof JsMap;
          if (b === this.ctors.Set) return a instanceof JsSet;
          if (b === this.ctors.String || b === this.ctors.Number || b === this.ctors.Boolean) return false;
          if (b.errType) return isPlain(a) && Boolean(a[ERR_KIND]) && (b.errType === 'Error' || a[ERR_KIND] === b.errType);
          if (b instanceof JsFunc) return isPlain(a) && a.constructor === b;
          return false;
        }
      }
      throw jerr('SyntaxError', `Unexpected token '${op}'`);
    }
    looseEq(a, b) {
      if (a === b) return true;
      if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
      if (a === null || a === undefined || b === null || b === undefined) return false;
      const oa = typeof a === 'object' || isFn(a), ob = typeof b === 'object' || isFn(b);
      if (oa && ob) return false;
      const x = oa ? this.prim(a) : a, y = ob ? this.prim(b) : b;
      if (typeof x === typeof y) return x === y;
      return Number(x) === Number(y);
    }

    /* console.log, as Node writes values */
    inspect(v, depth, top) {
      switch (typeof v) {
        case 'string': return top ? v : quoteJs(v);
        case 'number': return Object.is(v, -0) ? '-0' : String(v);
        case 'boolean': case 'undefined': return String(v);
      }
      if (v === null) return 'null';
      if (isFn(v)) return v.name ? `[Function: ${v.name}]` : '[Function (anonymous)]';
      if (this.inspecting.has(v)) return '[Circular *1]';
      if (Array.isArray(v)) {
        if (depth > 2) return '[Array]';
        if (!v.length) return '[]';
        this.inspecting.add(v);
        try {
          const items = v.slice(0, 100).map((x) => this.inspect(x, depth + 1, false));
          if (v.length > 100) items.push(`... ${v.length - 100} more item${v.length - 100 === 1 ? '' : 's'}`);
          return '[ ' + items.join(', ') + ' ]';
        } finally { this.inspecting.delete(v); }
      }
      if (v instanceof JsMap) {
        if (!v.m.size) return 'Map(0) {}';
        return `Map(${v.m.size}) { ` + [...v.m].map(([k, x]) => this.inspect(k, depth + 1, false) + ' => ' + this.inspect(x, depth + 1, false)).join(', ') + ' }';
      }
      if (v instanceof JsSet) {
        if (!v.s.size) return 'Set(0) {}';
        return `Set(${v.s.size}) { ` + [...v.s].map((x) => this.inspect(x, depth + 1, false)).join(', ') + ' }';
      }
      if (isPlain(v)) {
        if (v[ERR_KIND]) return top ? `${v.name}: ${v.message}` : `[${v.name}: ${v.message}]`;
        const keys = Object.keys(v);
        if (depth > 2) return '[Object]';
        if (!keys.length) return '{}';
        this.inspecting.add(v);
        try { return '{ ' + keys.map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : quoteJs(k)) + ': ' + this.inspect(v[k], depth + 1, false)).join(', ') + ' }'; } finally { this.inspecting.delete(v); }
      }
      return String(v);
    }
    print(s) { this.out.write(s, 'out'); }
    input(msg) {
      this.asked = true;
      if (msg) this.out.write(msg + ' ', 'prompt');
      if (this.inPos >= this.stdin.length) {
        const t = jerr('Error', 'the program asked for more input than it was given');
        Object.defineProperty(t.value, 'eof', { value: true, enumerable: false });
        throw t;
      }
      const line = this.stdin[this.inPos++];
      this.out.write(line + '\n', 'echo');
      return line;
    }
  }
  const scope = (parent) => ({ vars: new Map(), parent, fn: false, fnScope() { let s = parent; while (!s.fn) s = s.parent; return s; } });
  function quoteJs(s) {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    return q + s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(new RegExp(q, 'g'), '\\' + q) + q;
  }

  /* ---------------- JavaScript: the built-ins ---------------- */

  const N = (name, fn) => new JsNative(name, fn);
  const cb = (js, f, what) => { if (!isFn(f)) throw jerr('TypeError', `${js.inspect(f, 0, true)} is not a function`); return f; };
  const toInt = (js, v, d) => { if (v === undefined) return d; const n = Math.trunc(js.toNum(v)); return Number.isNaN(n) ? 0 : n; };
  const relIndex = (js, v, len, d) => { let n = toInt(js, v, d); if (n < 0) n = Math.max(0, len + n); return Math.min(n, len); };
  const strThis = (js, s, name) => { if (typeof s !== 'string') { if (s === null || s === undefined) throw jerr('TypeError', `String.prototype.${name} called on null or undefined`); return js.toStr(s); } return s; };
  const arrThis = (js, a, name) => { if (!Array.isArray(a)) throw jerr('TypeError', `Array.prototype.${name} called on a value that is not an array`); return a; };
  const sp = (name, fn) => N(name, function (self, args) { return fn.call(this, strThis(this, self, name), args); });
  const ap = (name, fn) => N(name, function (self, args) { return fn.call(this, arrThis(this, self, name), args); });
  const noRegex = (name) => N(name, () => { throw jerr('TypeError', `${name}() with a regular expression is not available here`); });

  const STRING_PROTO = Object.assign(obj(), {
    charAt: sp('charAt', function (s, a) { const i = toInt(this, a[0], 0); return s.charAt(i); }),
    charCodeAt: sp('charCodeAt', function (s, a) { return s.charCodeAt(toInt(this, a[0], 0)); }),
    codePointAt: sp('codePointAt', function (s, a) { return s.codePointAt(toInt(this, a[0], 0)); }),
    at: sp('at', function (s, a) { let i = toInt(this, a[0], 0); if (i < 0) i += s.length; return s[i]; }),
    indexOf: sp('indexOf', function (s, a) { return s.indexOf(this.toStr(a[0]), toInt(this, a[1], 0)); }),
    lastIndexOf: sp('lastIndexOf', function (s, a) { return a.length > 1 ? s.lastIndexOf(this.toStr(a[0]), toInt(this, a[1], Infinity)) : s.lastIndexOf(this.toStr(a[0])); }),
    includes: sp('includes', function (s, a) { return s.includes(this.toStr(a[0]), toInt(this, a[1], 0)); }),
    startsWith: sp('startsWith', function (s, a) { return s.startsWith(this.toStr(a[0]), toInt(this, a[1], 0)); }),
    endsWith: sp('endsWith', function (s, a) { return a.length > 1 ? s.endsWith(this.toStr(a[0]), toInt(this, a[1], s.length)) : s.endsWith(this.toStr(a[0])); }),
    slice: sp('slice', function (s, a) { return s.slice(toInt(this, a[0], 0), a[1] === undefined ? undefined : toInt(this, a[1], 0)); }),
    substring: sp('substring', function (s, a) { return s.substring(toInt(this, a[0], 0), a[1] === undefined ? undefined : toInt(this, a[1], 0)); }),
    substr: sp('substr', function (s, a) { return s.substr(toInt(this, a[0], 0), a[1] === undefined ? undefined : toInt(this, a[1], 0)); }),
    toUpperCase: sp('toUpperCase', (s) => s.toUpperCase()),
    toLowerCase: sp('toLowerCase', (s) => s.toLowerCase()),
    toLocaleUpperCase: sp('toLocaleUpperCase', (s) => s.toUpperCase()),
    toLocaleLowerCase: sp('toLocaleLowerCase', (s) => s.toLowerCase()),
    trim: sp('trim', (s) => s.trim()),
    trimStart: sp('trimStart', (s) => s.trimStart()),
    trimEnd: sp('trimEnd', (s) => s.trimEnd()),
    padStart: sp('padStart', function (s, a) { const n = toInt(this, a[0], 0); if (n > LIMITS.str) throw new Halt('memory'); return s.padStart(n, a[1] === undefined ? ' ' : this.toStr(a[1])); }),
    padEnd: sp('padEnd', function (s, a) { const n = toInt(this, a[0], 0); if (n > LIMITS.str) throw new Halt('memory'); return s.padEnd(n, a[1] === undefined ? ' ' : this.toStr(a[1])); }),
    repeat: sp('repeat', function (s, a) {
      const n = toInt(this, a[0], 0);
      if (n < 0 || n === Infinity) throw jerr('RangeError', `Invalid count value: ${n}`);
      if (s.length * n > LIMITS.str) throw new Halt('memory');
      return s.repeat(n);
    }),
    split: sp('split', function (s, a) {
      if (a[0] === undefined) return [s];
      const lim = a[1] === undefined ? undefined : toInt(this, a[1], 0);
      return s.split(this.toStr(a[0]), lim);
    }),
    replace: sp('replace', function (s, a) {
      const pat = this.toStr(a[0]);
      const i = s.indexOf(pat);
      if (i < 0) return s;
      const rep = isFn(a[1]) ? this.toStr(this.call(a[1], undefined, [pat, i, s])) : this.toStr(a[1]).replace(/\$\$/g, '$').replace(/\$&/g, pat);
      return s.slice(0, i) + rep + s.slice(i + pat.length);
    }),
    replaceAll: sp('replaceAll', function (s, a) {
      const pat = this.toStr(a[0]);
      if (isFn(a[1])) { const parts = s.split(pat); return parts.reduce((acc, p, i) => acc + (i ? this.toStr(this.call(a[1], undefined, [pat])) : '') + p, ''); }
      const r = s.split(pat).join(this.toStr(a[1]));
      if (r.length > LIMITS.str) throw new Halt('memory');
      return r;
    }),
    concat: sp('concat', function (s, a) { return s + a.map((x) => this.toStr(x)).join(''); }),
    localeCompare: sp('localeCompare', function (s, a) { const t = this.toStr(a[0]); return s < t ? -1 : s > t ? 1 : 0; }),
    normalize: sp('normalize', (s) => s.normalize()),
    toString: sp('toString', (s) => s),
    valueOf: sp('valueOf', (s) => s),
    match: noRegex('match'), matchAll: noRegex('matchAll'), search: noRegex('search')
  });
  const NUMBER_PROTO = Object.assign(obj(), {
    toFixed: N('toFixed', function (n, a) { const d = toInt(this, a[0], 0); if (d < 0 || d > 100) throw jerr('RangeError', 'toFixed() digits argument must be between 0 and 100'); return Number(n).toFixed(d); }),
    toString: N('toString', function (n, a) { const r = toInt(this, a[0], 10); if (r < 2 || r > 36) throw jerr('RangeError', 'toString() radix must be between 2 and 36'); return typeof n === 'boolean' ? String(n) : Number(n).toString(r); }),
    toPrecision: N('toPrecision', function (n, a) { if (a[0] === undefined) return String(n); const p = toInt(this, a[0], 1); if (p < 1 || p > 100) throw jerr('RangeError', 'toPrecision() argument must be between 1 and 100'); return Number(n).toPrecision(p); }),
    toExponential: N('toExponential', function (n, a) { return a[0] === undefined ? Number(n).toExponential() : Number(n).toExponential(toInt(this, a[0], 0)); }),
    toLocaleString: N('toLocaleString', (n) => Number(n).toLocaleString('en-US')),
    valueOf: N('valueOf', (n) => n)
  });
  const sortCmp = (js, f) => (f === undefined ? (x, y) => {
    if (x === undefined) return y === undefined ? 0 : 1;
    if (y === undefined) return -1;
    const p = js.toStr(x), q = js.toStr(y);
    return p < q ? -1 : p > q ? 1 : 0;
  } : (x, y) => {
    if (x === undefined) return y === undefined ? 0 : 1;
    if (y === undefined) return -1;
    const r = js.toNum(js.call(cb(js, f), undefined, [x, y]));
    return Number.isNaN(r) ? 0 : r;
  });
  const each = (js, a, f, fn) => { cb(js, f); js.tick(a.length); for (let i = 0; i < a.length; i++) { const r = fn(js.call(f, undefined, [a[i], i, a]), i); if (r !== undefined) return r; } return undefined; };
  function flat(js, a, d) { const out = []; for (const x of a) { if (Array.isArray(x) && d > 0) for (const y of flat(js, x, d - 1)) out.push(y); else out.push(x); } return out; }
  const ARRAY_PROTO = Object.assign(obj(), {
    push: ap('push', (a, args) => { for (const x of args) a.push(x); if (a.length > LIMITS.list) throw new Halt('memory'); return a.length; }),
    pop: ap('pop', (a) => a.pop()),
    shift: ap('shift', (a) => a.shift()),
    unshift: ap('unshift', (a, args) => { a.unshift(...args); return a.length; }),
    slice: ap('slice', function (a, args) { return a.slice(toInt(this, args[0], 0), args[1] === undefined ? undefined : toInt(this, args[1], 0)); }),
    splice: ap('splice', function (a, args) {
      const start = relIndex(this, args[0], a.length, 0);
      const count = args.length < 2 ? a.length - start : Math.max(0, toInt(this, args[1], 0));
      return a.splice(start, count, ...args.slice(2));
    }),
    concat: ap('concat', function (a, args) {
      const out = a.slice();
      for (const x of args) { if (Array.isArray(x)) for (const y of x) out.push(y); else out.push(x); }
      if (out.length > LIMITS.list) throw new Halt('memory');
      return out;
    }),
    join: ap('join', function (a, args) { const sep = args[0] === undefined ? ',' : this.toStr(args[0]); return a.map((x) => (x === null || x === undefined ? '' : this.toStr(x))).join(sep); }),
    reverse: ap('reverse', (a) => a.reverse()),
    toReversed: ap('toReversed', (a) => a.slice().reverse()),
    sort: ap('sort', function (a, args) { this.tick(Math.ceil(a.length * Math.log2(a.length + 1))); return a.sort(sortCmp(this, args[0])); }),
    toSorted: ap('toSorted', function (a, args) { this.tick(Math.ceil(a.length * Math.log2(a.length + 1))); return a.slice().sort(sortCmp(this, args[0])); }),
    indexOf: ap('indexOf', function (a, args) { return a.indexOf(args[0], toInt(this, args[1], 0)); }),
    lastIndexOf: ap('lastIndexOf', (a, args) => a.lastIndexOf(args[0])),
    includes: ap('includes', (a, args) => a.includes(args[0])),
    find: ap('find', function (a, args) { const i = each(this, a, args[0], (r, k) => (this.truthy(r) ? k : undefined)); return i === undefined ? undefined : a[i]; }),
    findIndex: ap('findIndex', function (a, args) { const i = each(this, a, args[0], (r, k) => (this.truthy(r) ? k : undefined)); return i === undefined ? -1 : i; }),
    findLast: ap('findLast', function (a, args) { cb(this, args[0]); for (let i = a.length - 1; i >= 0; i--) if (this.truthy(this.call(args[0], undefined, [a[i], i, a]))) return a[i]; return undefined; }),
    findLastIndex: ap('findLastIndex', function (a, args) { cb(this, args[0]); for (let i = a.length - 1; i >= 0; i--) if (this.truthy(this.call(args[0], undefined, [a[i], i, a]))) return i; return -1; }),
    filter: ap('filter', function (a, args) { const out = []; each(this, a, args[0], (r, k) => { if (this.truthy(r)) out.push(a[k]); }); return out; }),
    map: ap('map', function (a, args) { const out = []; each(this, a, args[0], (r) => { out.push(r); }); return out; }),
    forEach: ap('forEach', function (a, args) { each(this, a, args[0], () => undefined); return undefined; }),
    some: ap('some', function (a, args) { return each(this, a, args[0], (r) => (this.truthy(r) ? true : undefined)) === true; }),
    every: ap('every', function (a, args) { return each(this, a, args[0], (r) => (this.truthy(r) ? undefined : false)) !== false; }),
    reduce: ap('reduce', function (a, args) {
      const f = cb(this, args[0]);
      let i = 0, acc;
      if (args.length > 1) acc = args[1]; else { if (!a.length) throw jerr('TypeError', 'Reduce of empty array with no initial value'); acc = a[0]; i = 1; }
      this.tick(a.length);
      for (; i < a.length; i++) acc = this.call(f, undefined, [acc, a[i], i, a]);
      return acc;
    }),
    reduceRight: ap('reduceRight', function (a, args) {
      const f = cb(this, args[0]);
      let i = a.length - 1, acc;
      if (args.length > 1) acc = args[1]; else { if (!a.length) throw jerr('TypeError', 'Reduce of empty array with no initial value'); acc = a[i]; i--; }
      for (; i >= 0; i--) acc = this.call(f, undefined, [acc, a[i], i, a]);
      return acc;
    }),
    flat: ap('flat', function (a, args) { return flat(this, a, args[0] === undefined ? 1 : toInt(this, args[0], 1)); }),
    flatMap: ap('flatMap', function (a, args) { const m = []; each(this, a, args[0], (r) => { m.push(r); }); return flat(this, m, 1); }),
    fill: ap('fill', function (a, args) { const s = relIndex(this, args[1], a.length, 0), e = relIndex(this, args[2], a.length, a.length); for (let i = s; i < e; i++) a[i] = args[0]; return a; }),
    at: ap('at', function (a, args) { let i = toInt(this, args[0], 0); if (i < 0) i += a.length; return a[i]; }),
    keys: ap('keys', (a) => a.map((_, i) => i)),
    values: ap('values', (a) => a.slice()),
    entries: ap('entries', (a) => a.map((x, i) => [i, x])),
    toString: ap('toString', function (a) { return this.toStr(a); })
  });
  const OBJECT_PROTO = Object.assign(obj(), {
    hasOwnProperty: N('hasOwnProperty', function (o, a) { return isPlain(o) && Object.prototype.hasOwnProperty.call(o, this.key(a[0])); }),
    toString: N('toString', function (o) { return isPlain(o) && o[ERR_KIND] ? `${o.name}: ${o.message}` : '[object Object]'; })
  });
  const FUNCTION_PROTO = Object.assign(obj(), {
    call: N('call', function (f, a) { return this.call(f, a[0], a.slice(1)); }),
    apply: N('apply', function (f, a) { return this.call(f, a[0], a[1] === undefined || a[1] === null ? [] : this.toArray(a[1])); }),
    bind: N('bind', function (f, a) { const self = a[0], pre = a.slice(1); return new JsNative('bound ' + (f.name || ''), function (t, args) { return this.call(f, self, pre.concat(args)); }); })
  });
  const MAP_PROTO = Object.assign(obj(), {
    get: N('get', (m, a) => m.m.get(a[0])),
    set: N('set', (m, a) => { m.m.set(a[0], a[1]); if (m.m.size > LIMITS.list) throw new Halt('memory'); return m; }),
    has: N('has', (m, a) => m.m.has(a[0])),
    delete: N('delete', (m, a) => m.m.delete(a[0])),
    clear: N('clear', (m) => { m.m.clear(); }),
    keys: N('keys', (m) => [...m.m.keys()]),
    values: N('values', (m) => [...m.m.values()]),
    entries: N('entries', (m) => [...m.m.entries()].map(([k, v]) => [k, v])),
    forEach: N('forEach', function (m, a) { cb(this, a[0]); for (const [k, v] of m.m) this.call(a[0], undefined, [v, k, m]); })
  });
  const SET_PROTO = Object.assign(obj(), {
    add: N('add', (s, a) => { s.s.add(a[0]); if (s.s.size > LIMITS.list) throw new Halt('memory'); return s; }),
    has: N('has', (s, a) => s.s.has(a[0])),
    delete: N('delete', (s, a) => s.s.delete(a[0])),
    clear: N('clear', (s) => { s.s.clear(); }),
    values: N('values', (s) => [...s.s]),
    keys: N('keys', (s) => [...s.s]),
    entries: N('entries', (s) => [...s.s].map((x) => [x, x])),
    forEach: N('forEach', function (s, a) { cb(this, a[0]); for (const x of s.s) this.call(a[0], undefined, [x, x, s]); })
  });

  // JSON text from a value, and values (with no prototypes) from JSON text
  function fromHost(v) {
    if (Array.isArray(v)) return v.map(fromHost);
    if (v && typeof v === 'object') { const o = obj(); Object.keys(v).forEach((k) => { o[k] = fromHost(v[k]); }); return o; }
    return v;
  }
  function toHost(js, v, seen) {
    if (v === null || typeof v !== 'object') return isFn(v) ? undefined : v;
    if (seen.has(v)) throw jerr('TypeError', 'Converting circular structure to JSON');
    seen.add(v);
    try {
      if (Array.isArray(v)) return v.map((x) => { const y = toHost(js, x, seen); return y === undefined ? null : y; });
      if (v instanceof JsMap || v instanceof JsSet) return {};
      const o = {};
      Object.keys(v).forEach((k) => { const y = toHost(js, v[k], seen); if (y !== undefined) Object.defineProperty(o, k, { value: y, enumerable: true, writable: true, configurable: true }); });
      return o;
    } finally { seen.delete(v); }
  }

  function jsGlobals(js) {
    const g = js.global.vars;
    const put = (name, v) => g.set(name, { v, c: false, i: true });
    const ns = (props) => Object.assign(obj(), props);
    const log = N('log', function (self, a) { this.print(a.map((x, i) => this.inspect(x, 0, typeof x === 'string')).join(' ') + '\n'); });
    put('console', ns({ log, info: log, warn: log, error: log, debug: log, table: log }));
    const r = () => js.rng();
    const m1 = (name, fn) => N(name, function (self, a) { return fn(this.toNum(a[0])); });
    put('Math', ns({
      PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2,
      abs: m1('abs', Math.abs), floor: m1('floor', Math.floor), ceil: m1('ceil', Math.ceil), round: m1('round', Math.round), trunc: m1('trunc', Math.trunc),
      sign: m1('sign', Math.sign), sqrt: m1('sqrt', Math.sqrt), cbrt: m1('cbrt', Math.cbrt), sin: m1('sin', Math.sin), cos: m1('cos', Math.cos),
      tan: m1('tan', Math.tan), asin: m1('asin', Math.asin), acos: m1('acos', Math.acos), atan: m1('atan', Math.atan), log: m1('log', Math.log),
      log2: m1('log2', Math.log2), log10: m1('log10', Math.log10), exp: m1('exp', Math.exp), fround: m1('fround', Math.fround),
      sinh: m1('sinh', Math.sinh), cosh: m1('cosh', Math.cosh), tanh: m1('tanh', Math.tanh),
      pow: N('pow', function (s, a) { return Math.pow(this.toNum(a[0]), this.toNum(a[1])); }),
      atan2: N('atan2', function (s, a) { return Math.atan2(this.toNum(a[0]), this.toNum(a[1])); }),
      min: N('min', function (s, a) { return Math.min(...a.map((x) => this.toNum(x))); }),
      max: N('max', function (s, a) { return Math.max(...a.map((x) => this.toNum(x))); }),
      hypot: N('hypot', function (s, a) { return Math.hypot(...a.map((x) => this.toNum(x))); }),
      random: N('random', () => r())
    }));
    const ctor = (name, fn, ctorFn, props) => { const f = new JsNative(name, fn, props ? ns(props) : null); f.ctor = ctorFn || null; return f; };
    const parseIntJ = N('parseInt', function (s, a) { const r2 = a[1] === undefined ? undefined : toInt(this, a[1], 10); return parseInt(this.toStr(a[0]), r2); });
    const parseFloatJ = N('parseFloat', function (s, a) { return parseFloat(this.toStr(a[0])); });
    const numberC = ctor('Number', function (s, a) { return a.length ? this.toNum(a[0]) : 0; }, null, {
      isInteger: N('isInteger', (s, a) => Number.isInteger(a[0])), isFinite: N('isFinite', (s, a) => Number.isFinite(a[0])),
      isNaN: N('isNaN', (s, a) => Number.isNaN(a[0])), isSafeInteger: N('isSafeInteger', (s, a) => Number.isSafeInteger(a[0])),
      parseInt: parseIntJ, parseFloat: parseFloatJ, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER, MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      EPSILON: Number.EPSILON, MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN
    });
    numberC.ctor = function (a) { return a.length ? this.toNum(a[0]) : 0; };
    const stringC = ctor('String', function (s, a) { return a.length ? (typeof a[0] === 'string' ? a[0] : this.inspectStr(a[0])) : ''; }, function (a) { return a.length ? this.toStr(a[0]) : ''; }, {
      fromCharCode: N('fromCharCode', function (s, a) { return String.fromCharCode(...a.map((x) => this.toNum(x))); }),
      fromCodePoint: N('fromCodePoint', function (s, a) { return String.fromCodePoint(...a.map((x) => this.toNum(x))); })
    });
    const boolC = ctor('Boolean', function (s, a) { return this.truthy(a[0]); });
    const arrayC = ctor('Array', function (s, a) { return newArray(this, a); }, function (a) { return newArray(this, a); }, {
      isArray: N('isArray', (s, a) => Array.isArray(a[0])),
      of: N('of', (s, a) => a.slice()),
      from: N('from', function (s, a) {
        const src = a[0];
        let items;
        if (isPlain(src) && 'length' in src) { const n = toInt(this, src.length, 0); if (n > LIMITS.list) throw new Halt('memory'); items = Array.from({ length: n }, (_, i) => src[i]); } else if (src === null || src === undefined) throw jerr('TypeError', `${src} is not iterable`);
        else items = this.toArray(src);
        if (a[1] !== undefined) { const f = cb(this, a[1]); this.tick(items.length); return items.map((x, i) => this.call(f, undefined, [x, i])); }
        return items;
      })
    });
    const objectC = ctor('Object', function (s, a) { return a[0] !== null && typeof a[0] === 'object' ? a[0] : obj(); }, function () { return obj(); }, {
      keys: N('keys', function (s, a) { const o = a[0]; if (o === null || o === undefined) throw jerr('TypeError', 'Cannot convert undefined or null to object'); return isPlain(o) ? Object.keys(o) : Array.isArray(o) || typeof o === 'string' ? Object.keys(Array.from({ length: o.length })) : []; }),
      values: N('values', function (s, a) { const o = a[0]; return isPlain(o) ? Object.keys(o).map((k) => o[k]) : Array.isArray(o) ? o.slice() : typeof o === 'string' ? Array.from(o) : []; }),
      entries: N('entries', function (s, a) { const o = a[0]; return isPlain(o) ? Object.keys(o).map((k) => [k, o[k]]) : Array.isArray(o) ? o.map((x, i) => [String(i), x]) : []; }),
      assign: N('assign', function (s, a) { const t = a[0]; for (const src of a.slice(1)) if (isPlain(src)) Object.keys(src).forEach((k) => { this.setProp(t, k, src[k]); }); return t; }),
      fromEntries: N('fromEntries', function (s, a) { const o = obj(); for (const e of this.toArray(a[0])) { const p = this.toArray(e); o[this.key(p[0])] = p[1]; } return o; }),
      freeze: N('freeze', (s, a) => { if (isPlain(a[0]) || Array.isArray(a[0])) Object.freeze(a[0]); return a[0]; }),
      create: N('create', () => obj())
    });
    js.ctors = { Array: arrayC, Object: objectC, Function: N('Function', () => { throw jerr('EvalError', 'Function() is not available here'); }), String: stringC, Number: numberC, Boolean: boolC };
    put('Number', numberC); put('String', stringC); put('Boolean', boolC); put('Array', arrayC); put('Object', objectC);
    put('Function', js.ctors.Function);
    const mapC = ctor('Map', () => { throw jerr('TypeError', "Constructor Map requires 'new'"); }, function (a) {
      const m = new JsMap();
      if (a[0] !== undefined && a[0] !== null) for (const e of this.toArray(a[0])) { const p = this.toArray(e); m.m.set(p[0], p[1]); }
      return m;
    });
    const setC = ctor('Set', () => { throw jerr('TypeError', "Constructor Set requires 'new'"); }, function (a) {
      const s = new JsSet();
      if (a[0] !== undefined && a[0] !== null) for (const x of this.toArray(a[0])) s.s.add(x);
      return s;
    });
    js.ctors.Map = mapC; js.ctors.Set = setC;
    put('Map', mapC); put('Set', setC);
    ERR_TYPES.forEach((t) => {
      const make = function (a) { return jsErrObj(t, a[0] === undefined ? '' : this.toStr(a[0])); };
      const f = ctor(t, function (s, a) { return make.call(this, a); }, make);
      f.errType = t;
      put(t, f);
    });
    put('JSON', ns({
      stringify: N('stringify', function (s, a) {
        const indent = typeof a[2] === 'number' ? Math.min(10, a[2]) : typeof a[2] === 'string' ? a[2].slice(0, 10) : undefined;
        const host = toHost(this, a[0], new Set());
        return host === undefined ? undefined : JSON.stringify(host, null, indent);
      }),
      parse: N('parse', function (s, a) {
        try { return fromHost(JSON.parse(this.toStr(a[0]))); } catch (e) { throw jerr('SyntaxError', 'Unexpected token in JSON: ' + String(e.message).slice(0, 80)); }
      })
    }));
    put('parseInt', parseIntJ); put('parseFloat', parseFloatJ);
    put('isNaN', N('isNaN', function (s, a) { return Number.isNaN(this.toNum(a[0])); }));
    put('isFinite', N('isFinite', function (s, a) { return Number.isFinite(this.toNum(a[0])); }));
    put('Infinity', Infinity); put('NaN', NaN); put('undefined', undefined);
    put('prompt', N('prompt', function (s, a) { return this.input(a[0] === undefined ? '' : this.toStr(a[0])); }));
    put('alert', N('alert', function (s, a) { this.print(this.toStr(a[0] === undefined ? '' : a[0]) + '\n'); }));
    put('globalThis', obj());
    const nope = (name, why) => put(name, N(name, () => { throw jerr('ReferenceError', `${name} is not available here${why ? ': ' + why : ''}`); }));
    nope('setTimeout', 'programs run straight through'); nope('setInterval', 'programs run straight through'); nope('fetch', 'programs cannot use the network');
    nope('require', 'there are no modules here'); nope('eval'); nope('Date', 'there is no clock here');
    g.get('Date').v.ctor = () => { throw jerr('ReferenceError', 'Date is not available here: there is no clock here'); };
  }
  function newArray(js, a) {
    if (a.length === 1 && typeof a[0] === 'number') {
      const n = a[0];
      if (!Number.isInteger(n) || n < 0) throw jerr('RangeError', 'Invalid array length');
      if (n > LIMITS.list) throw new Halt('memory');
      return new Array(n).fill(undefined);
    }
    return a.slice();
  }
  Js.prototype.inspectStr = function (v) { return this.toStr(v); };

  function jsError(js, e) {
    if (e instanceof Halt) return { kind: e.kind, type: '', message: e.message, line: js.line };
    if (e instanceof JsThrow) {
      const v = e.value;
      if (isPlain(v) && v[ERR_KIND]) {
        const kind = v.eof ? 'eof' : (v.name === 'RangeError' && v.message === 'Maximum call stack size exceeded') ? 'depth' : 'error';
        return { kind, type: String(v.name), message: String(v.message), line: e.line };
      }
      return { kind: 'error', type: 'Uncaught', message: js.inspect(v, 0, false), line: e.line };
    }
    if (e instanceof RangeError) return { kind: 'depth', type: 'RangeError', message: 'Maximum call stack size exceeded', line: js.line };
    if (e instanceof JsSyntax) return { kind: 'syntax', type: 'SyntaxError', message: e.msg, line: e.line };
    return { kind: 'error', type: 'InternalError', message: String((e && e.message) || e).slice(0, 200), line: js.line, internal: true };
  }
  // a test's arguments, as this JavaScript's values
  const fromJSONjs = (v) => fromHost(v === undefined ? null : v);

  function runJS(code, o, result) {
    const js = new Js(o);
    const prev = JCUR;
    JCUR = js;
    try {
      let tree;
      try { tree = jsParse(code); } catch (e) {
        if (e instanceof JsSyntax) { result.error = { kind: 'syntax', type: 'SyntaxError', message: e.msg, line: e.line }; return js; }
        if (e instanceof RangeError) { result.error = { kind: 'syntax', type: 'SyntaxError', message: 'too many nested brackets', line: 1 }; return js; }
        throw e;
      }
      const s = js.global;
      s.fnScope = () => s;
      try {
        for (const n of hoistVars(tree, [])) if (!s.vars.has(n)) s.vars.set(n, { v: undefined, c: false, i: true });
        js.hoistBlock(tree, s);
        js.block(tree, s);
        if (o.call) {
          const b = s.vars.get(o.call.name);
          result.found = Boolean(b && b.i && isFn(b.v));
          if (result.found) {
            js.line = 0;
            const v = js.call(b.v, undefined, (o.call.args || []).map(fromJSONjs));
            result.returned = true;
            result.value = v;
            result.shown = js.inspect(v, 0, false);
          }
        }
      } catch (e) { result.error = jsError(js, e); }
      return js;
    } finally { JCUR = prev; }
  }
  // jerr with extra fields (the input ran out)

  /* =====================================================================
     Running programs, and checking them against tests
     ===================================================================== */

  const LANGS = ['python', 'javascript'];
  const langOf = (l) => {
    const s = String(l || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (s === 'python' || s === 'py' || s === 'python3' || s === 'py3') return 'python';
    if (s === 'javascript' || s === 'js' || s === 'node' || s === 'nodejs' || s === 'ecmascript') return 'javascript';
    return null;
  };
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

  // the line shown for an error: "Line 3: NameError: name 'totl' is not defined"
  function errorText(e) {
    if (!e) return '';
    switch (e.kind) {
      case 'timeout': return 'Your program ran for too long. Is there a loop that never ends?';
      case 'output': return 'Your program printed too much, so it was stopped. Is there a loop that never ends?';
      case 'memory': return e.message === 'turtle' ? 'The turtle drew too much, so the program was stopped.' : 'Your program made something too big to keep (a very long list or string), so it was stopped.';
    }
    const head = e.line ? `Line ${e.line}: ` : '';
    return head + e.type + (e.message ? ': ' + e.message : '');
  }

  function run(lang, code, opts) {
    opts = opts || {};
    const l = langOf(lang) || 'python';
    const out = new Out(num(opts.output, LIMITS.output), typeof opts.onOut === 'function' ? opts.onOut : null);
    const o = {
      steps: num(opts.steps, LIMITS.steps), depth: num(opts.depth, LIMITS.depth),
      seed: opts.seed == null ? 42 : opts.seed, out, stdin: lines(opts.stdin), call: opts.call || null
    };
    const result = { lang: l, out: out.chunks, stdout: '', error: null, turtle: null, steps: 0, inputs: 0, asked: false };
    const it = l === 'javascript' ? runJS(String(code || ''), o, result) : runPython(String(code || ''), o, result);
    result.stdout = out.stdout();
    result.steps = it.steps;
    result.inputs = it.inPos;
    result.asked = it.asked;
    if (result.error) result.error.text = errorText(result.error);
    return result;
  }

  // a syntax error in the code, or null
  function parse(lang, code) {
    const l = langOf(lang) || 'python';
    try {
      if (l === 'javascript') jsParse(String(code || '')); else pyParse(String(code || ''));
      return null;
    } catch (e) {
      if (e instanceof PySyntax || e instanceof JsSyntax) {
        const err0 = { kind: 'syntax', type: e.type, message: e.msg, line: e.line };
        err0.text = errorText(err0);
        return err0;
      }
      if (e instanceof RangeError) return { kind: 'syntax', type: 'SyntaxError', message: 'too many nested brackets', line: 1, text: 'SyntaxError: too many nested brackets' };
      throw e;
    }
  }

  // what a program uses, from its text (comments and strings are not counted)
  function uses(lang, code) {
    const l = langOf(lang) || 'python';
    const src = String(code || '');
    const bare = l === 'python'
      ? src.replace(/#[^\n]*/g, '').replace(/("""|''')[\s\S]*?\1|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
      : src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
    return {
      input: l === 'python' ? /\binput\s*\(/.test(bare) : /\bprompt\s*\(/.test(bare),
      turtle: l === 'python' && /^\s*(?:import\s+turtle\b|from\s+turtle\s+import\b)/m.test(bare),
      random: l === 'python' ? /^\s*(?:import\s+random\b|from\s+random\s+import\b)/m.test(bare) : /\bMath\.random\s*\(/.test(bare),
      blanks: /_{3,}/.test(bare)
    };
  }

  /* what a program printed, compared line by line: spaces at the ends of lines and blank lines at the end don't
     count, and numbers written differently (7 and 7.0, 0.30000000000000004 and 0.3) are the same */
  function outLines(s) {
    const ls = String(s == null ? '' : s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t\u00a0]+$/, ''));
    while (ls.length && ls[ls.length - 1] === '') ls.pop();
    return ls;
  }
  const NUM_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  function sameLine(a, b, tol) {
    if (a === b) return true;
    const pa = a.split(/(\s+)/), pb = b.split(/(\s+)/);
    if (pa.length !== pb.length) return false;
    for (let i = 0; i < pa.length; i++) {
      const x = pa[i], y = pb[i];
      if (x === y) continue;
      if (i % 2 === 1) return false;
      if (!NUM_TOKEN.test(x) || !NUM_TOKEN.test(y)) return false;
      const p = Number(x), q = Number(y);
      if (!(Math.abs(p - q) <= tol * Math.max(1, Math.abs(q)))) return false;
    }
    return true;
  }
  function sameOutput(got, want, tol) {
    const t = typeof tol === 'number' && tol >= 0 ? tol : 1e-6;
    const g = outLines(got), w = outLines(want);
    if (g.length !== w.length) return false;
    for (let i = 0; i < g.length; i++) if (!sameLine(g[i], w[i], t)) return false;
    return true;
  }
  // where two outputs first differ: { line (0-based), got, want } (got/want null when a line is missing)
  function outputDiff(got, want, tol) {
    const t = typeof tol === 'number' && tol >= 0 ? tol : 1e-6;
    const g = outLines(got), w = outLines(want);
    const n = Math.max(g.length, w.length);
    for (let i = 0; i < n; i++) {
      if (i >= g.length || i >= w.length || !sameLine(g[i], w[i], t)) return { line: i, got: i < g.length ? g[i] : null, want: i < w.length ? w[i] : null, gotLines: g.length, wantLines: w.length };
    }
    return null;
  }

  // a returned value against the JSON a test expects
  function closeNum(x, w, tol) { return Math.abs(x - w) <= tol * Math.max(1, Math.abs(w)); }
  function pyMatch(v, w, tol) {
    if (w === null || w === undefined) return v === null;
    if (typeof w === 'boolean') return v === w;
    if (typeof w === 'number') {
      if (typeof v === 'bigint') return Number.isInteger(w) ? v === BigInt(w) : closeNum(Number(v), w, tol);
      return typeof v === 'number' && closeNum(v, w, tol);
    }
    if (typeof w === 'string') return v === w;
    if (Array.isArray(w)) {
      if (v instanceof PySet) {
        if (v.m.size !== w.length) return false;
        const left = [...v.m.values()];
        return w.every((x) => { const i = left.findIndex((y) => pyMatch(y, x, tol)); if (i < 0) return false; left.splice(i, 1); return true; });
      }
      const a = Array.isArray(v) ? v : v instanceof PyTuple ? v.v : null;
      return Boolean(a) && a.length === w.length && a.every((x, i) => pyMatch(x, w[i], tol));
    }
    if (typeof w === 'object') {
      if (!(v instanceof PyDict) || v.m.size !== Object.keys(w).length) return false;
      for (const [k, x] of v.m.values()) {
        const key = typeof k === 'string' ? k : typeof k === 'boolean' ? (k ? 'True' : 'False') : k === null ? 'None' : typeof k === 'number' ? floatRepr(k) : typeof k === 'bigint' ? String(k) : null;
        if (key === null || !Object.prototype.hasOwnProperty.call(w, key) || !pyMatch(x, w[key], tol)) return false;
      }
      return true;
    }
    return false;
  }
  function jsMatch(v, w, tol) {
    if (w === null || w === undefined) return v === null || v === undefined;
    if (typeof w === 'number') return typeof v === 'number' && (Number.isNaN(w) ? Number.isNaN(v) : closeNum(v, w, tol));
    if (typeof w === 'boolean' || typeof w === 'string') return v === w;
    if (Array.isArray(w)) {
      if (v instanceof JsSet) { const left = [...v.s]; return left.length === w.length && w.every((x) => { const i = left.findIndex((y) => jsMatch(y, x, tol)); if (i < 0) return false; left.splice(i, 1); return true; }); }
      return Array.isArray(v) && v.length === w.length && v.every((x, i) => jsMatch(x, w[i], tol));
    }
    if (typeof w === 'object') {
      if (v instanceof JsMap) { if (v.m.size !== Object.keys(w).length) return false; for (const [k, x] of v.m) if (!Object.prototype.hasOwnProperty.call(w, String(k)) || !jsMatch(x, w[String(k)], tol)) return false; return true; }
      if (!isPlain(v)) return false;
      const ks = Object.keys(v);
      return ks.length === Object.keys(w).length && ks.every((k) => Object.prototype.hasOwnProperty.call(w, k) && jsMatch(v[k], w[k], tol));
    }
    return false;
  }
  // a JSON value written as the language writes it: True and None in Python, 'text' in quotes
  function shown(lang, v) {
    if (langOf(lang) === 'javascript') {
      const js = new Js({ steps: 1e5, depth: 50, out: new Out(1e4), stdin: [], seed: 1 });
      return js.inspect(fromJSONjs(v), 0, false);
    }
    const py = new Py({ steps: 1e5, depth: 50, out: new Out(1e4), stdin: [], seed: 1 });
    const prev = CUR;
    CUR = py;
    try { return py.repr(fromJSON(v)); } finally { CUR = prev; }
  }
  // a call as the language writes it: area(3, 4)
  const callText = (lang, name, args) => `${name}(${(args || []).map((a) => shown(lang, a)).join(', ')})`;

  /* runTests(lang, goal, code, opts): every test of a task's goal, run on the code
       opts: { steps (each test), total (all the tests), stop (stop at the first that fails) }
       -> { passed, total, syntax: null | error, results: [{ i, pass, why, got, want, error, stdout, call }] }
       why: '' | 'error' | 'missing' (no such function) | 'value' | 'output' | 'blank' */
  function runTests(lang, goal, code, opts) {
    opts = opts || {};
    const l = langOf(lang) || 'python';
    const tests = (goal && Array.isArray(goal.tests)) ? goal.tests : [];
    const per = num(opts.steps, 1e6), total = num(opts.total, 3e6);
    const tol = goal && typeof goal.tolerance === 'number' && goal.tolerance >= 0 ? goal.tolerance : 1e-6;
    const out = { passed: 0, total: tests.length, syntax: null, results: [] };
    const syn = parse(l, code);
    if (syn) { out.syntax = syn; return out; }
    let used = 0;
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const steps = Math.max(1000, Math.min(per, total - used));
      const fn = goal.type === 'function';
      const r = run(l, code, { steps, depth: opts.depth, stdin: t.stdin || '', output: 20000, call: fn ? { name: goal.name, args: t.args || [] } : null });
      used += r.steps;
      const res = { i, pass: false, why: '', got: '', want: '', error: r.error, stdout: r.stdout, asked: r.asked, inputs: r.inputs };
      if (fn) {
        res.call = callText(l, goal.name, t.args);
        res.want = shown(l, t.returns);
        if (r.error) res.why = 'error';
        else if (!r.found) res.why = 'missing';
        else {
          res.got = r.shown;
          res.pass = l === 'javascript' ? jsMatch(r.value, t.returns, tol) : pyMatch(r.value, t.returns, tol);
          if (!res.pass) res.why = 'value';
        }
      } else {
        res.want = String(t.stdout == null ? '' : t.stdout);
        res.got = r.stdout;
        if (r.error) res.why = 'error';
        else { res.pass = sameOutput(r.stdout, res.want, tol); if (!res.pass) { res.why = 'output'; res.diff = outputDiff(r.stdout, res.want, tol); } }
      }
      if (res.pass) out.passed++;
      out.results.push(res);
      if (opts.stop && !res.pass) break;
      if (used >= total && i < tests.length - 1) {
        for (let j = i + 1; j < tests.length; j++) out.results.push({ i: j, pass: false, why: 'error', error: { kind: 'timeout', type: '', message: '', line: 0, text: errorText({ kind: 'timeout' }) } });
        break;
      }
    }
    return out;
  }

  // a stub for a function task's starter code, from the solution: "def area(w, h):" and a line to write in
  function stub(lang, solution, name) {
    const l = langOf(lang) || 'python';
    const src = String(solution || '');
    if (l === 'python') {
      const m = new RegExp('^def\\s+' + name.replace(/[^\w]/g, '') + '\\s*\\(([^)]*)\\)\\s*(?:->[^:]*)?:', 'm').exec(src);
      if (!m) return null;
      return `def ${name}(${m[1].trim()}):\n    # Write your code here\n    pass\n`;
    }
    const m = new RegExp('function\\s+' + name.replace(/[^\w$]/g, '') + '\\s*\\(([^)]*)\\)').exec(src) ||
      new RegExp('(?:const|let|var)\\s+' + name.replace(/[^\w$]/g, '') + '\\s*=\\s*(?:function\\s*)?\\(([^)]*)\\)').exec(src);
    if (!m) return null;
    return `function ${name}(${m[1].trim()}) {\n  // Write your code here\n}\n`;
  }

  return {
    LIMITS, LANGS, langOf, run, parse, uses, runTests, sameOutput, outputDiff, outLines, shown, callText, stub, errorText,
    // for the editor's highlighter
    PY_KW, JS_KW
  };
});
