/* =====================================================================
   Community board: the pieces the feed (community.html) and a post's
   page (post.html) share. The nav, plain text to HTML with links and
   maths, times, votes and photo addresses. Everything a person wrote
   goes through P.esc; links must be http or https.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const $$ = P.$$, esc = P.esc;
  const C = (P.community = {});

  C.user = () => P.auth.current();
  C.here = () => location.pathname.replace(/^\//, '') + location.search;
  C.signInHref = (next) => 'auth.html?next=' + encodeURIComponent(next || C.here()) + '#signin';
  C.plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

  /* ---------- nav: guest and member bits, sign-in links that come back here ---------- */
  C.mountNav = () => {
    const u = C.user();
    $$('[data-when="guest"]').forEach((el) => { el.hidden = !!u; });
    $$('[data-when="user"]').forEach((el) => { el.hidden = !u; });
    $$('[data-signin-link]').forEach((a) => { a.href = C.signInHref(a.dataset.signinLink || undefined); });
    $$('[data-home]').forEach((a) => { a.href = u ? 'app.html' : 'index.html'; });
    if (u) P.mountUserNav();
  };

  /* ---------- a polite live region for small confirmations ---------- */
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
  C.announce = (msg) => {
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 60);
  };

  // A message that survives one page change (e.g. "Your post was deleted.").
  const FLASH = 'primer.community.flash';
  C.flash = (msg) => P.session.set(FLASH, msg);
  const flashed = P.session.get(FLASH);
  if (flashed) { P.session.remove(FLASH); setTimeout(() => P.toast(flashed), 250); }

  /* ---------- maths (KaTeX auto-render, loaded from the CDN) ---------- */
  const MATH = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'a'],
    throwOnError: false,
    strict: 'ignore'
  };
  const waiting = new Set();
  C.math = (el) => {
    if (!el) return;
    if (window.renderMathInElement) {
      try { window.renderMathInElement(el, MATH); } catch (e) { console.warn('[Primer] maths', e); }
    } else {
      waiting.add(el);
    }
  };
  window.addEventListener('load', () => {
    if (window.renderMathInElement) waiting.forEach((el) => { if (el.isConnected) C.math(el); });
    waiting.clear();
  });

  /* ---------- links ---------- */
  C.safeHref = (u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
    } catch (e) { return null; }
  };
  C.host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  C.link = (href, label) => `<a href="${esc(href)}" rel="noopener nofollow ugc" target="_blank">${esc(label)}<span class="sr-only"> (opens in a new tab)</span></a>`;

  const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  const TRAILING = /[.,;:!?*_\]}>]$/;
  function linkify(s) {
    let out = '';
    let last = 0;
    for (const m of s.matchAll(URL_RE)) {
      let url = m[0];
      // Punctuation at the end belongs to the sentence, and so does a ")" that wasn't opened in the link.
      for (;;) {
        if (TRAILING.test(url)) { url = url.slice(0, -1); continue; }
        if (url.endsWith(')') && url.split('(').length < url.split(')').length) { url = url.slice(0, -1); continue; }
        break;
      }
      const href = C.safeHref(url);
      if (!href) continue;
      out += esc(s.slice(last, m.index)) + C.link(href, url);
      last = m.index + url.length;
    }
    return out + esc(s.slice(last));
  }

  // Plain text to paragraphs: a blank line starts a new one, single line breaks are kept by CSS.
  C.prose = (s) => String(s || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${linkify(p)}</p>`).join('');

  /* ---------- time ---------- */
  C.ago = (t) => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${C.plural(Math.floor(s / 3600), 'hour')} ago`;
    const d = Math.floor(s / 86400);
    if (d < 7) return `${C.plural(d, 'day')} ago`;
    const date = new Date(t);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };
  C.time = (t) => {
    const d = new Date(t);
    return `<time datetime="${d.toISOString()}" title="${esc(d.toLocaleString())}">${esc(C.ago(t))}</time>`;
  };

  /* ---------- photos ---------- */
  const PHOTO = /^[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/;
  C.photoSrc = (im) => (im && PHOTO.test(im.name) ? '/uploads/' + im.name : '');

  /* ---------- votes ---------- */
  const UP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5 19.5 13.5h-4.4v6h-6.2v-6H4.5z"/></svg>';
  const DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 19.5 4.5 10.5h4.4v-6h6.2v6h4.4z"/></svg>';

  C.voteHTML = (kind, item, opts = {}) => {
    const cls = 'vote' + (opts.row ? ' vote--row' : '');
    const what = kind === 'post' ? 'post' : 'comment';
    const score = `<span class="sr-only">Score </span><span class="vote__score" data-score>${Number(item.score) || 0}</span>`;
    if (item.deleted) return `<div class="${cls} is-off">${score}</div>`;
    if (!C.user()) {
      const href = esc(C.signInHref());
      return `<div class="${cls}" role="group" aria-label="Votes on this ${what}">
        <a class="vote__btn vote__btn--up" href="${href}" aria-label="Sign in to vote up">${UP}</a>${score}
        <a class="vote__btn vote__btn--down" href="${href}" aria-label="Sign in to vote down">${DOWN}</a></div>`;
    }
    const my = Number(item.myVote) || 0;
    return `<div class="${cls}" role="group" aria-label="Vote on this ${what}" data-vote="${kind}" data-id="${Number(item.id)}" data-my="${my}">
      <button class="vote__btn vote__btn--up" type="button" data-v="1" aria-pressed="${my === 1}" aria-label="Vote up">${UP}</button>${score}
      <button class="vote__btn vote__btn--down" type="button" data-v="-1" aria-pressed="${my === -1}" aria-label="Vote down">${DOWN}</button></div>`;
  };

  // Pages can listen to keep their own copy of the data in step: (kind, id, myVote, score).
  C.onVote = null;
  const setVote = (box, my, score) => {
    box.dataset.my = String(my);
    box.querySelector('[data-v="1"]').setAttribute('aria-pressed', String(my === 1));
    box.querySelector('[data-v="-1"]').setAttribute('aria-pressed', String(my === -1));
    box.querySelector('[data-score]').textContent = score;
  };
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.vote button[data-v]');
    if (!btn) return;
    const box = btn.closest('.vote');
    if (box.classList.contains('is-busy')) return;
    const before = Number(box.dataset.my) || 0;
    const scoreBefore = Number(box.querySelector('[data-score]').textContent) || 0;
    const v = Number(btn.dataset.v);
    const next = before === v ? 0 : v;
    setVote(box, next, scoreBefore - before + next); // show it straight away, settle it when the server answers
    box.classList.add('is-busy');
    try {
      const d = await P.post(`/api/community/${box.dataset.vote}s/${box.dataset.id}/vote`, { value: next });
      setVote(box, d.myVote, d.score);
      C.announce(`Score ${d.score}. ` + (d.myVote === 1 ? 'You voted it up.' : d.myVote === -1 ? 'You voted it down.' : 'Your vote is cleared.'));
      if (C.onVote) C.onVote(box.dataset.vote, Number(box.dataset.id), d.myVote, d.score);
    } catch (err) {
      setVote(box, before, scoreBefore);
      P.toast(err.message, 'error');
    } finally {
      box.classList.remove('is-busy');
    }
  });
})();
