/* =====================================================================
   A small QR code encoder, written for Primer so the certificate's code
   needs no library: byte mode (UTF-8), error correction level M (about
   15% of the code can be damaged and still read), versions 1 to 10 (up
   to 213 bytes, plenty for a verify link). The mask with the lowest
   penalty score is chosen, as the standard (ISO/IEC 18004) describes.

   P.qr.matrix(text)  -> { size, dark(x, y) }
   P.qr.svg(text, { margin, dark, light, label })  -> an <svg> string
   ===================================================================== */
(function () {
  'use strict';
  const P = (window.Primer = window.Primer || {});

  // Level M, per version: [EC codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each]
  const BLOCKS = [null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const FORMAT_M = 0; // the error correction level's two format bits (L 01, M 00, Q 11, H 10)

  /* ---------- Reed-Solomon over GF(256), polynomial 0x11d ---------- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function generator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }
  function ecc(data, n) {
    const g = generator(n);
    const rem = new Array(n).fill(0);
    for (const d of data) {
      const f = d ^ rem.shift();
      rem.push(0);
      for (let i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], f);
    }
    return rem;
  }

  /* ---------- the data codewords ---------- */
  const capacity = (v) => { const b = BLOCKS[v]; return b[1] * b[2] + b[3] * b[4]; };

  function codewords(bytes) {
    let v = 1;
    for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= capacity(v) * 8) break;
    if (v > 10) throw new Error('Too much text for a QR code');
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); // byte mode
    put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    const cap = capacity(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xec; data.length < capacity(v); pad ^= 0xec ^ 0x11) data.push(pad);

    // split into blocks, add each block's error correction, interleave
    const [ecLen, n1, d1, n2, d2] = BLOCKS[v];
    const blocks = [];
    let at = 0;
    for (let i = 0; i < n1 + n2; i++) {
      const len = i < n1 ? d1 : d2;
      const part = data.slice(at, at + len);
      at += len;
      blocks.push({ data: part, ec: ecc(part, ecLen) });
    }
    const out = [];
    const longest = Math.max(d1, d2);
    for (let i = 0; i < longest; i++) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.ec[i]));
    return { v, words: out };
  }

  /* ---------- the symbol ---------- */
  function build(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const { v, words } = codewords(bytes);
    const size = 17 + 4 * v;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // timing
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const pos = ALIGN[v];
    pos.forEach((ax, i) => pos.forEach((ay, j) => {
      const corner = (i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0);
      if (corner) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const format = (mask) => {
      const data = (FORMAT_M << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true); // the dark module
    };
    format(0); // reserve its place; drawn for real once the mask is chosen
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, dark); set(b, a, dark);
      }
    }

    // the codewords, two columns at a time in a zigzag from the bottom right
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (fn[y][x]) continue;
          mod[y][x] = k < words.length * 8 ? ((words[k >>> 3] >>> (7 - (k & 7))) & 1) === 1 : false;
          k++;
        }
      }
    }

    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    ];
    const apply = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      apply(m); format(m);
      const s = penalty(mod, size);
      if (s < bestScore) { bestScore = s; best = m; }
      apply(m); // undo (XOR)
    }
    apply(best); format(best);
    return { size, version: v, dark: (x, y) => mod[y][x] };
  }

  // The standard's four penalty rules: long runs, 2x2 blocks, finder-like patterns, and dark/light balance.
  function penalty(mod, size) {
    let score = 0, dark = 0;
    const line = (get) => {
      let s = 0;
      for (let i = 0; i < size; i++) {
        let run = 1;
        for (let j = 1; j <= size; j++) {
          if (j < size && get(i, j) === get(i, j - 1)) { run++; continue; }
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
        // 1:1:3:1:1 with four light modules on one side
        for (let j = 0; j + 6 < size; j++) {
          const pat = [1, 0, 1, 1, 1, 0, 1].every((b, t) => get(i, j + t) === (b === 1));
          if (!pat) continue;
          const lightBefore = [1, 2, 3, 4].every((t) => j - t < 0 || !get(i, j - t));
          const lightAfter = [1, 2, 3, 4].every((t) => j + 6 + t >= size || !get(i, j + 6 + t));
          if (lightBefore || lightAfter) s += 40;
        }
      }
      return s;
    };
    score += line((i, j) => mod[i][j]) + line((i, j) => mod[j][i]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) dark++;
    score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
    return score;
  }

  function svg(text, opts = {}) {
    const m = build(text);
    const margin = opts.margin == null ? 4 : opts.margin;
    const n = m.size + margin * 2;
    let d = '';
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        if (!m.dark(x, y)) continue;
        let run = 1;
        while (x + run < m.size && m.dark(x + run, y)) run++;
        d += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
        x += run - 1;
      }
    }
    const label = opts.label ? String(opts.label).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"${label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"'}>` +
      (opts.light ? `<rect width="${n}" height="${n}" fill="${opts.light}"/>` : '') +
      `<path d="${d}" fill="${opts.dark || '#2b1d11'}"/></svg>`;
  }

  P.qr = { matrix: build, svg };
})();
