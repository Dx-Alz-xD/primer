/* =====================================================================
   community.html: the board's feed (Hot, New, Top; topic filter; title
   search) and the composer for writing or editing a post.
     community.html?tag=Calculus&sort=new&q=notes   a filtered feed
     community.html?compose=1                       opens the composer
     community.html?edit=<post id>                  edits your post
     community.html?share=<course id>               shares a course outline
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer, C = P.community;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  C.mountNav();
  const user = C.user();
  const smooth = () => (P.motion.reduce ? 'auto' : 'smooth');

  /* ------------------------------------------------------------------
     Feed
  ------------------------------------------------------------------ */
  const SORTS = ['hot', 'new', 'top'];
  const SPANS = ['day', 'week', 'month', 'year', 'all'];
  const state = {
    sort: SORTS.includes(P.params.get('sort')) ? P.params.get('sort') : 'hot',
    t: SPANS.includes(P.params.get('t')) ? P.params.get('t') : 'all',
    tag: P.clean(P.params.get('tag') || '', 40),
    q: P.clean(P.params.get('q') || '', 100),
    next: 0,
    seq: 0
  };

  const feed = $('#feed'), status = $('#feed-status'), more = $('#more'), empty = $('#feed-empty'), filter = $('#filter');
  const searchInput = $('#search-q'), span = $('#span'), spanPick = $('#span-pick');

  function syncUrl() {
    const sp = new URLSearchParams();
    if (state.sort !== 'hot') sp.set('sort', state.sort);
    if (state.sort === 'top' && state.t !== 'all') sp.set('t', state.t);
    if (state.tag) sp.set('tag', state.tag);
    if (state.q) sp.set('q', state.q);
    const s = sp.toString();
    history.replaceState(null, '', 'community.html' + (s ? '?' + s : '') + location.hash);
  }

  function syncControls() {
    $$('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort)));
    spanPick.hidden = state.sort !== 'top';
    span.value = state.t;
    searchInput.value = state.q;
    $$('#topics [data-tag]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tag.toLowerCase() === state.tag.toLowerCase())));
    const bits = [];
    if (state.tag) bits.push(`Posts about <strong>${esc(state.tag)}</strong>. <button class="textlink" type="button" data-clear="tag">Show every topic</button>`);
    if (state.q) bits.push(`Titles matching “${esc(state.q)}”. <button class="textlink" type="button" data-clear="q">Clear the search</button>`);
    filter.innerHTML = bits.join(' ');
    filter.hidden = !bits.length;
  }

  function cardHTML(p) {
    const href = 'post.html?id=' + Number(p.id);
    const title = p.deleted ? '<span class="is-gone">[deleted]</span>' : esc(p.title);
    const tag = p.tag ? `<button class="tagchip" type="button" data-tag="${esc(p.tag)}" aria-label="Show posts about ${esc(p.tag)}">${esc(p.tag)}</button>` : '';
    const by = p.author ? `<span class="pcard__by">${esc(p.author.name)}</span>` : '<span class="pcard__by is-gone">[deleted]</span>';
    const domains = (p.domains || []).length
      ? `<ul class="pcard__domains" aria-label="Sources from">${p.domains.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
    const foot = [`<a href="${href}#comments">${C.plural(p.comments, 'comment')}</a>`];
    if (p.sourceCount) foot.push(esc(C.plural(p.sourceCount, 'source')));
    if (p.imageCount) foot.push(esc(C.plural(p.imageCount, 'photo')));
    const src = C.photoSrc(p.image);
    const thumb = src ? `<a class="pcard__thumb" href="${href}" tabindex="-1" aria-hidden="true"><img src="${src}" alt="" loading="lazy" decoding="async"></a>` : '';
    return `<li class="pcard card card--solid${src ? ' has-thumb' : ''}">
        ${C.voteHTML('post', p)}
        <div class="pcard__main">
          <p class="pcard__meta">${tag}${by}<span aria-hidden="true">·</span>${C.time(p.createdAt)}${p.editedAt ? '<span class="pcard__edited">edited</span>' : ''}</p>
          <h3 class="pcard__title"><a href="${href}">${title}</a></h3>
          ${p.excerpt ? `<p class="pcard__excerpt">${esc(p.excerpt)}</p>` : ''}
          ${domains}
          <p class="pcard__foot">${foot.join('<span aria-hidden="true"> · </span>')}</p>
        </div>
        ${thumb}
      </li>`;
  }

  function emptyHTML() {
    const write = user ? '<button class="btn" type="button" data-compose>Write a post</button>' : `<a class="btn" href="${esc(C.signInHref('community.html?compose=1'))}">Sign in to post</a>`;
    if (state.q) return `<h3>No titles match “${esc(state.q)}”</h3><p>Try fewer words, or another spelling.</p><button class="btn btn--ghost" type="button" data-clear="q">Clear the search</button>`;
    if (state.tag) return `<h3>Nothing about ${esc(state.tag)} yet</h3><p>Share a source you trust and start the first thread on it.</p>${write}`;
    if (state.sort === 'top' && state.t !== 'all') return '<h3>No posts in that time</h3><p>Pick a longer stretch of time to see more.</p>';
    return `<h3>The board is empty</h3><p>Share a source you trust and start the first thread.</p>${write}`;
  }

  async function load(reset) {
    const seq = ++state.seq;
    if (reset) state.next = 0;
    more.disabled = true;
    status.textContent = reset ? 'Loading posts…' : 'Loading more posts…';
    const sp = new URLSearchParams({ sort: state.sort, offset: String(state.next), limit: '20' });
    if (state.sort === 'top' && state.t !== 'all') sp.set('t', state.t);
    if (state.tag) sp.set('tag', state.tag);
    if (state.q) sp.set('q', state.q);
    try {
      const d = await P.get('/api/community/posts?' + sp);
      if (seq !== state.seq) return;
      if (reset) feed.innerHTML = '';
      const from = feed.children.length;
      feed.insertAdjacentHTML('beforeend', d.posts.map(cardHTML).join(''));
      Array.from(feed.children).slice(from).forEach((li) => C.math(li.querySelector('.pcard__excerpt')));
      state.next = d.next;
      more.hidden = !d.more;
      const count = feed.children.length;
      empty.hidden = count > 0;
      if (!count) empty.innerHTML = emptyHTML();
      status.textContent = count ? `Showing ${C.plural(count, 'post')}.` : '';
      if (!reset && d.posts.length) {
        const first = feed.children[from].querySelector('.pcard__title a');
        if (first) first.focus({ preventScroll: true });
      }
    } catch (err) {
      if (seq !== state.seq) return;
      status.textContent = 'The posts didn’t load. ' + err.message;
      if (reset) { feed.innerHTML = ''; empty.hidden = false; empty.innerHTML = '<h3>The posts didn’t load</h3><p>Check your connection and try again.</p><button class="btn" type="button" data-retry>Try again</button>'; }
    } finally {
      if (seq === state.seq) more.disabled = false;
    }
  }

  function refresh() { syncControls(); syncUrl(); load(true); }

  $$('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    if (state.sort === b.dataset.sort) return;
    state.sort = b.dataset.sort;
    refresh();
  }));
  span.addEventListener('change', () => { state.t = SPANS.includes(span.value) ? span.value : 'all'; refresh(); });

  let searchTimer = 0;
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    state.q = P.clean(searchInput.value, 100);
    refresh();
  });
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = P.clean(searchInput.value, 100);
      if (q === state.q) return;
      state.q = q;
      refresh();
    }, 350);
  });

  more.addEventListener('click', () => load(false));

  document.addEventListener('click', (e) => {
    const tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) {
      const t = tagBtn.dataset.tag;
      state.tag = state.tag.toLowerCase() === t.toLowerCase() && tagBtn.closest('#topics') ? '' : t;
      refresh();
      if (!tagBtn.closest('#topics')) $('.board-grid').scrollIntoView({ block: 'start', behavior: smooth() });
      return;
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      state[clear.dataset.clear] = '';
      refresh();
      if (clear.dataset.clear === 'q') searchInput.focus();
      else $('[data-sort][aria-pressed="true"]').focus(); // the button that was clicked is gone now
      return;
    }
    if (e.target.closest('[data-retry]')) load(true);
    if (e.target.closest('[data-compose]')) openComposer();
  });

  async function loadTopics() {
    try {
      const d = await P.get('/api/community/tags');
      if (!d.tags.length) return;
      $('#topics').innerHTML = d.tags.map((t) => `<button class="chip" type="button" data-tag="${esc(t.tag)}" aria-pressed="false">${esc(t.tag)} <span class="chip__n" aria-label="${esc(C.plural(t.count, 'post'))}">${t.count}</span></button>`).join('');
      $('#topic-list').innerHTML = d.tags.map((t) => `<option value="${esc(t.tag)}"></option>`).join('');
      syncControls();
    } catch (e) { /* the feed still works without the topic list */ }
  }

  syncControls();
  load(true);
  loadTopics();

  /* ------------------------------------------------------------------
     Composer
  ------------------------------------------------------------------ */
  const MAX_SOURCES = 10, MAX_PHOTOS = 4, MAX_BYTES = 4 * 1024 * 1024, MAX_EDGE = 1600;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const form = $('#composer');
  const f = {
    heading: $('#composer-title'), title: $('#c-title'), titleErr: $('#c-title-err'), tag: $('#c-tag'), body: $('#c-body'),
    sources: $('#c-sources'), addSource: $('#c-add-source'), photos: $('#c-photos'), file: $('#c-file'), fileLabel: $('#c-file-label'),
    status: $('#c-status'), submit: $('#c-submit'), cancel: $('#c-cancel'), open: $('#compose-open')
  };
  let editing = null; // the post id while editing
  let photos = []; // { key, name, alt, src, fresh, uploading }
  let keySeq = 0;
  let busy = false;

  const signInToPost = $('#compose-signin');
  if (signInToPost) signInToPost.href = C.signInHref(location.search ? C.here() : 'community.html?compose=1');

  const say = (msg, isError) => {
    f.status.textContent = msg || '';
    f.status.classList.toggle('is-error', Boolean(isError));
  };

  /* ---------- sources ---------- */
  function addSourceRow(s = {}) {
    if (f.sources.children.length >= MAX_SOURCES) return null;
    const k = ++keySeq;
    const li = document.createElement('li');
    li.className = 'src';
    li.innerHTML = `<div class="src__fields">
        <label class="sr-only" for="src-url-${k}" data-src-n>Link</label>
        <input class="input" id="src-url-${k}" type="url" inputmode="url" maxlength="2000" placeholder="https://" autocomplete="off" spellcheck="false" data-src-url aria-describedby="src-err-${k}">
        <label class="sr-only" for="src-label-${k}" data-src-n>Label</label>
        <input class="input" id="src-label-${k}" type="text" maxlength="120" placeholder="What is it? (optional)" autocomplete="off" data-src-label>
      </div>
      <button class="textlink src__remove" type="button" data-src-remove>Remove</button>
      <p class="field__error" id="src-err-${k}" data-src-err></p>`;
    li.querySelector('[data-src-url]').value = s.url || '';
    li.querySelector('[data-src-label]').value = s.label || '';
    f.sources.appendChild(li);
    renumberSources();
    return li;
  }
  function renumberSources() {
    const rows = Array.from(f.sources.children);
    rows.forEach((li, i) => {
      const [a, b] = li.querySelectorAll('[data-src-n]');
      a.textContent = `Source ${i + 1} link`;
      b.textContent = `Source ${i + 1} label`;
      li.querySelector('[data-src-remove]').innerHTML = `Remove<span class="sr-only"> source ${i + 1}</span>`;
    });
    f.addSource.hidden = rows.length >= MAX_SOURCES;
  }
  f.addSource.addEventListener('click', () => {
    const li = addSourceRow();
    if (li) li.querySelector('[data-src-url]').focus();
  });
  f.sources.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-src-remove]');
    if (!btn) return;
    const li = btn.closest('.src');
    const next = li.nextElementSibling || li.previousElementSibling;
    li.remove();
    if (!f.sources.children.length) addSourceRow();
    renumberSources();
    ((next && next.isConnected ? next : f.sources.firstElementChild).querySelector('[data-src-url]')).focus();
  });
  // "example.com/page" becomes "https://example.com/page" when the field is left.
  f.sources.addEventListener('focusout', (e) => {
    const input = e.target.closest('[data-src-url]');
    if (!input) return;
    const v = input.value.trim();
    if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(v)) input.value = 'https://' + v;
  });
  f.sources.addEventListener('input', (e) => {
    const li = e.target.closest('.src');
    if (!li) return;
    li.querySelector('[data-src-err]').textContent = '';
    li.querySelector('[data-src-url]').removeAttribute('aria-invalid');
  });

  /* ---------- photos ---------- */
  function renderPhotos() {
    f.photos.innerHTML = photos.map((p, i) => `<li class="shot${p.uploading ? ' is-busy' : ''}" data-key="${p.key}">
        <img src="${esc(p.src)}" alt="">
        <span class="shot__busy" ${p.uploading ? '' : 'hidden'}>Uploading…</span>
        <label class="sr-only" for="alt-${p.key}">Describe photo ${i + 1}</label>
        <input class="input shot__alt" id="alt-${p.key}" type="text" maxlength="200" placeholder="Describe it (optional)" autocomplete="off" data-alt>
        <button class="textlink" type="button" data-photo-remove>Remove<span class="sr-only"> photo ${i + 1}</span></button>
      </li>`).join('');
    photos.forEach((p) => { const el = f.photos.querySelector(`[data-key="${p.key}"] [data-alt]`); if (el) el.value = p.alt || ''; });
    syncPhotoPicker();
  }
  function syncPhotoPicker() {
    const full = photos.length >= MAX_PHOTOS;
    f.file.disabled = full;
    f.fileLabel.setAttribute('aria-disabled', String(full));
    f.fileLabel.textContent = full ? 'Four photos added' : photos.length ? 'Add more photos' : 'Add photos';
  }
  const photoItem = (key) => photos.find((p) => p.key === key);

  // Re-draws the photo on a canvas: no bigger than 1600px on its longest side, and without
  // the metadata (location, camera) a phone puts in. GIFs stay as they are to keep animation.
  async function prepare(file) {
    if (file.type === 'image/gif') return file;
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error(`“${file.name}” couldn’t be opened as a photo.`); }
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const out = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    if (out === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise((r) => canvas.toBlob(r, out, 0.86));
    if (!blob || !TYPES.includes(blob.type)) throw new Error(`“${file.name}” couldn’t be prepared for upload.`);
    return blob;
  }

  async function upload(blob) {
    let res;
    try {
      res = await fetch('/api/community/images', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
    } catch (e) {
      throw new Error('Can’t reach the Primer server. Check your connection and try again.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || `The photo couldn’t be uploaded (${res.status}).`);
    return data.image;
  }

  f.file.addEventListener('change', async () => {
    const files = Array.from(f.file.files || []);
    f.file.value = '';
    let added = 0;
    for (const file of files) {
      if (photos.length >= MAX_PHOTOS) { say(`You can add up to ${MAX_PHOTOS} photos.`, true); break; }
      if (!TYPES.includes(file.type)) { say(`“${file.name}” isn’t a JPEG, PNG, WebP or GIF.`, true); continue; }
      const item = { key: ++keySeq, name: null, alt: '', src: URL.createObjectURL(file), fresh: true, uploading: true };
      photos.push(item);
      renderPhotos();
      say(`Uploading ${file.name}…`);
      try {
        const blob = await prepare(file);
        if (blob.size > MAX_BYTES) throw new Error(`“${file.name}” is over 4 MB. Choose a smaller photo.`);
        const img = await upload(blob);
        if (!photoItem(item.key)) { P.del('/api/community/images/' + encodeURIComponent(img.name)).catch(() => {}); continue; }
        item.name = img.name;
        item.uploading = false;
        const li = f.photos.querySelector(`[data-key="${item.key}"]`);
        if (li) { li.classList.remove('is-busy'); li.querySelector('.shot__busy').hidden = true; }
        added++;
      } catch (err) {
        photos = photos.filter((p) => p !== item);
        URL.revokeObjectURL(item.src);
        renderPhotos();
        say(err.message, true);
        continue;
      }
    }
    if (added && !f.status.classList.contains('is-error')) say(added === 1 ? 'Photo added.' : `${added} photos added.`);
  });

  f.photos.addEventListener('input', (e) => {
    const input = e.target.closest('[data-alt]');
    if (!input) return;
    const p = photoItem(Number(input.closest('.shot').dataset.key));
    if (p) p.alt = input.value;
  });
  f.photos.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-photo-remove]');
    if (!btn) return;
    const key = Number(btn.closest('.shot').dataset.key);
    const p = photoItem(key);
    if (!p) return;
    photos = photos.filter((x) => x !== p);
    if (p.fresh && p.name) P.del('/api/community/images/' + encodeURIComponent(p.name)).catch(() => {});
    if (p.src.startsWith('blob:')) URL.revokeObjectURL(p.src);
    renderPhotos();
    say('Photo removed.');
    const next = f.photos.querySelector('[data-photo-remove]');
    (next || f.fileLabel).focus();
  });

  /* ---------- open, fill, reset ---------- */
  function resetComposer() {
    editing = null;
    form.reset();
    f.heading.textContent = 'Write a post';
    f.submit.textContent = 'Post';
    f.titleErr.textContent = '';
    f.title.removeAttribute('aria-invalid');
    f.sources.innerHTML = '';
    addSourceRow();
    photos.forEach((p) => { if (p.src.startsWith('blob:')) URL.revokeObjectURL(p.src); });
    photos = [];
    renderPhotos();
    say('');
  }

  function openComposer() {
    if (!user) { location.href = C.signInHref('community.html?compose=1'); return; }
    form.hidden = false;
    f.open.setAttribute('aria-expanded', 'true');
    f.open.hidden = true;
    form.scrollIntoView({ block: 'start', behavior: smooth() });
    f.title.focus({ preventScroll: true });
  }

  function closeComposer() {
    photos.forEach((p) => { if (p.fresh && p.name) P.del('/api/community/images/' + encodeURIComponent(p.name)).catch(() => {}); });
    resetComposer();
    form.hidden = true;
    f.open.hidden = !user;
    f.open.setAttribute('aria-expanded', 'false');
    if (location.search.match(/[?&](compose|share|edit)=/)) syncUrl();
    f.open.focus();
  }

  function fill(p) {
    f.title.value = p.title || '';
    f.tag.value = p.tag || '';
    f.body.value = p.body || '';
    f.sources.innerHTML = '';
    (p.sources || []).forEach((s) => addSourceRow(s));
    if (!f.sources.children.length) addSourceRow();
    photos = (p.images || []).map((im) => ({ key: ++keySeq, name: im.name, alt: im.alt || '', src: C.photoSrc(im), fresh: false, uploading: false }))
      .filter((x) => x.src);
    renderPhotos();
  }

  const hasWork = () => Boolean(f.title.value.trim() || f.body.value.trim() || photos.length
    || Array.from(f.sources.querySelectorAll('[data-src-url]')).some((i) => i.value.trim()));

  f.open.addEventListener('click', openComposer);
  f.cancel.addEventListener('click', () => {
    if (editing) {
      photos.forEach((p) => { if (p.fresh && p.name) P.del('/api/community/images/' + encodeURIComponent(p.name)).catch(() => {}); });
      location.href = 'post.html?id=' + editing;
      return;
    }
    if (hasWork() && !window.confirm('Throw away this post? What you wrote won’t be kept.')) return;
    closeComposer();
  });

  async function startEdit(id) {
    openComposer();
    f.heading.textContent = 'Edit your post';
    f.submit.textContent = 'Save changes';
    f.submit.disabled = true;
    say('Loading your post…');
    try {
      const d = await P.get('/api/community/posts/' + encodeURIComponent(id));
      if (!d.post.mine) { say('You can only edit your own posts.', true); return; }
      editing = d.post.id;
      fill(d.post);
      f.submit.disabled = false;
      say('');
      f.title.focus();
    } catch (err) {
      say('That post couldn’t be loaded. ' + err.message, true);
    }
  }

  // A course outline from app.html: title, range and the lessons, ready to share.
  async function startShare(courseId) {
    openComposer();
    say('Filling in your course…');
    try {
      const d = await P.get('/api/courses/' + encodeURIComponent(courseId));
      const c = d.course;
      const range = `${c.from ? P.cap(c.from) : 'The very beginning'} to ${c.to || 'the end of the subject'}`;
      let n = 0;
      const units = (c.units || []).map((u, i) => `Unit ${P.roman(i + 1)}: ${u.title}\n` + u.lessons.map((l) => `${++n}. ${l.title}`).join('\n')).join('\n\n');
      const lines = [`I built a course on Primer and wanted to share the outline.`, `Range: ${range}.` + (c.instructions ? `\nTeaching: “${c.instructions}”` : ''), units];
      let tag = P.clean(c.topic, 40);
      if ((c.topic || '').length > 40) tag = tag.replace(/\s+\S*$/, '');
      fill({ title: P.clean(`Course outline: ${c.title}`, 160), tag, body: lines.join('\n\n') });
      say('Your course outline is filled in. Add a note or a source, then post it.');
      f.title.focus();
    } catch (err) {
      say('That course couldn’t be loaded. ' + err.message, true);
    }
  }

  /* ---------- submit ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    f.titleErr.textContent = '';
    f.title.removeAttribute('aria-invalid');
    const title = P.clean(f.title.value, 160);
    if (!title) {
      f.titleErr.textContent = 'Give your post a title.';
      f.title.setAttribute('aria-invalid', 'true');
      f.title.focus();
      P.shake(f.title);
      return;
    }
    if (photos.some((p) => p.uploading)) { say('Wait for the photos to finish uploading.', true); return; }
    let firstBad = null;
    const sources = Array.from(f.sources.children).map((li) => {
      const urlEl = li.querySelector('[data-src-url]');
      const url = urlEl.value.trim(), label = P.clean(li.querySelector('[data-src-label]').value, 120);
      const err = li.querySelector('[data-src-err]');
      let msg = '';
      if (!url && label) msg = 'Add the link, or remove this source.';
      else if (url && !C.safeHref(url)) msg = 'Use a full web link that starts with https://';
      err.textContent = msg;
      if (msg) { urlEl.setAttribute('aria-invalid', 'true'); firstBad = firstBad || urlEl; }
      return { url, label };
    });
    if (firstBad) { say('One of the sources needs fixing.', true); firstBad.focus(); return; }
    const payload = {
      title,
      tag: P.clean(f.tag.value, 40),
      body: f.body.value,
      sources,
      images: photos.map((p) => ({ name: p.name, alt: P.clean(p.alt, 200) }))
    };
    busy = true;
    f.submit.disabled = true;
    say(editing ? 'Saving your changes…' : 'Posting…');
    try {
      const d = editing
        ? await P.patch('/api/community/posts/' + editing, payload)
        : await P.post('/api/community/posts', payload);
      photos.forEach((p) => { p.fresh = false; });
      if (!editing) C.flash('Your post is up.');
      else C.flash('Your changes are saved.');
      location.href = 'post.html?id=' + d.post.id;
    } catch (err) {
      busy = false;
      f.submit.disabled = false;
      say(err.message, true);
    }
  });

  resetComposer();
  if (user) {
    const editId = P.params.get('edit');
    const shareId = P.params.get('share');
    if (editId && /^\d{1,15}$/.test(editId)) startEdit(editId);
    else if (shareId) startShare(shareId);
    else if (P.params.get('compose')) openComposer();
  }
})();
