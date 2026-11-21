/* =====================================================================
   Photos in lessons: freely licensed images from Wikimedia Commons that
   the server found and keeps on this site (server/photos.mjs).

   P.photos.clean(block, sanitize) -> a safe photo block, or null
     Used by P.cleanLesson: only a same-origin /media/<hash>.<ext> image
     gets through, credit links must go to Wikimedia, Creative Commons
     and the like, and the caption is cleaned like any AI-written HTML.
   P.photos.html(block, { attr }) -> a framed photo with its caption and
     credit ("Photo: Author · CC BY-SA 4.0 · Wikimedia Commons"), shared
     by the lesson player, the book reader and the EPUB.
   On app.html, a course's cover photo (course.cover) is added to its
   page's header and to its card in the library, with its credit.

   An image that can't load (offline and not downloaded) hides its whole
   frame rather than leaving a broken picture on the page.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  if (!P) return;
  const esc = P.esc;
  const t = (s) => (P.t ? P.t(s) : s);

  const SRC = /^\/media\/[a-f0-9]{32}\.(?:jpg|png|webp|gif)$/;
  const LINK = /^https:\/\/(?:commons\.wikimedia\.org|[a-z-]+\.wikipedia\.org|creativecommons\.org|www\.gnu\.org|artlibre\.org)\/[^\s"<>]*$/;
  const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const link = (v) => { const s = text(v, 500); return LINK.test(s) ? s : ''; };
  const size = (v) => { const n = Math.round(Number(v)); return n >= 16 && n <= 6000 ? n : 0; };

  function clean(b, sanitize) {
    if (!b || typeof b.src !== 'string' || !SRC.test(b.src)) return null; // still being looked up, or not ours
    const c = b.credit && typeof b.credit === 'object' ? b.credit : {};
    const w = size(b.width), h = size(b.height);
    return {
      t: 'photo', src: b.src, width: w && h ? w : 0, height: w && h ? h : 0,
      caption: b.caption ? sanitize(String(b.caption)) : '',
      alt: text(b.alt, 200),
      credit: { author: text(c.author, 120), license: text(c.license, 40), licenseUrl: link(c.licenseUrl), source: link(c.source) }
    };
  }

  const out = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;

  function credit(c) {
    const parts = [];
    if (c.author) parts.push(`<span class="photo__author">${esc(c.author)}</span>`);
    if (c.license) parts.push(c.licenseUrl ? out(c.licenseUrl, esc(c.license)) : esc(c.license));
    parts.push(c.source ? out(c.source, 'Wikimedia Commons') : 'Wikimedia Commons');
    return `<small class="photo__credit">${esc(t('Photo'))}: ${parts.join(' · ')}</small>`;
  }

  function html(b, opts) {
    const o = opts || {};
    const dims = b.width && b.height ? ` width="${b.width}" height="${b.height}"` : '';
    // the frame is never wider than the photo at its tallest allowed height, so tall photos aren't letterboxed
    const ratio = b.width && b.height ? ` style="--photo-ar:${(b.width / b.height).toFixed(4)}"` : '';
    return `<figure class="photo"${o.attr || ''}>` +
      `<div class="photo__frame"${ratio}><img class="photo__img" src="${esc(b.src)}" alt="${esc(b.alt || '')}"${dims} loading="lazy" decoding="async"></div>` +
      `<figcaption class="photo__cap">${b.caption ? `<span class="photo__text">${b.caption}</span>` : ''}${credit(b.credit || {})}</figcaption>` +
      '</figure>';
  }

  /* ---------- course covers (app.html): the topic's photo on the course page and the library cards ---------- */
  const coverOf = (course) => (course && course.cover ? clean(Object.assign({}, course.cover, { caption: '' }), (s) => s) : null);

  function coverHTML(cv, kind) {
    const dims = cv.width && cv.height ? ` width="${cv.width}" height="${cv.height}"` : '';
    const img = `<img class="photo__img ccover__img" src="${esc(cv.src)}" alt="${esc(cv.alt || '')}"${dims} loading="lazy" decoding="async">`;
    if (kind === 'card') {
      // the whole card is a link, so the card shows the credit as text; the course page links it
      const c = cv.credit;
      const line = [c.author, c.license].filter(Boolean).join(' · ');
      return `<figure class="photo ccover ccover--card">${img}<figcaption class="ccover__credit" title="${esc(`${t('Photo')}: ${line ? line + ' · ' : ''}Wikimedia Commons`)}">${esc(line || 'Wikimedia Commons')}</figcaption></figure>`;
    }
    return `<figure class="photo ccover ccover--head">${img}<figcaption class="ccover__credit">${credit(cv.credit)}</figcaption></figure>`;
  }

  function decorate() {
    if (!P.courses) return;
    const head = document.querySelector('#view-course .course-head');
    if (head && !head.querySelector('.ccover')) {
      const cv = coverOf(P.courses.get(P.params.get('course')));
      if (cv) head.insertAdjacentHTML('afterbegin', coverHTML(cv, 'head'));
    }
    document.querySelectorAll('#shelves .ccard[data-course]').forEach((card) => {
      if (card.querySelector('.ccover')) return;
      const cv = coverOf(P.courses.get(card.dataset.course));
      if (cv) card.insertAdjacentHTML('afterbegin', coverHTML(cv, 'card'));
    });
  }
  function watchCovers() {
    const roots = ['view-course', 'shelves'].map((id) => document.getElementById(id)).filter(Boolean);
    if (!roots.length) return;
    decorate();
    const mo = new MutationObserver(decorate);
    roots.forEach((r) => mo.observe(r, { childList: true, subtree: true }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchCovers);
  else watchCovers();

  // A photo that can't load (offline and not downloaded, say) takes its frame with it.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img && img.classList && img.classList.contains('photo__img')) {
      const fig = img.closest('.photo');
      if (fig) fig.classList.add('is-missing');
    }
  }, true);
  // Printing (Save as PDF) needs every photo, not only the ones scrolled to.
  addEventListener('beforeprint', () => {
    P.$$('img.photo__img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
  });

  P.photos = { clean, html, credit };
})();
