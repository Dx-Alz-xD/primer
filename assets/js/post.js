/* =====================================================================
   post.html?id=<n>: one community post (body, photos, sources) and its
   threaded comments. Anyone can read; replying, editing, deleting and
   voting need an account. post.html?id=<n>#c-<comment id> jumps to a
   comment.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer, C = P.community;
  const $ = P.$, $$ = P.$$, esc = P.esc;
  C.mountNav();
  const user = C.user();
  const root = $('#post-root');
  const status = $('#post-status');
  const smooth = () => (P.motion.reduce ? 'auto' : 'smooth');

  const id = P.params.get('id');
  let post = null;
  let comments = [];
  let sort = 'top';
  const collapsed = new Set();

  C.onVote = (kind, itemId, my, score) => {
    const item = kind === 'post' ? post : comments.find((c) => c.id === itemId);
    if (item) { item.myVote = my; item.score = score; }
  };

  if (!/^\d{1,15}$/.test(id || '')) notFound();
  else load().then(() => {
    const m = /^#c-(\d+)$/.exec(location.hash);
    if (m) focusComment(Number(m[1]));
    else if (location.hash === '#comments') $('#comments').scrollIntoView({ block: 'start' });
  });

  async function load() {
    try {
      const d = await P.get('/api/community/posts/' + id);
      post = d.post;
      comments = d.comments;
      status.textContent = '';
      render();
    } catch (err) {
      if (err.status === 404) notFound();
      else {
        status.textContent = '';
        root.innerHTML = `<div class="notfound card card--solid"><h1>This post didn’t load</h1><p>${esc(err.message)}</p>
          <p class="notfound__act"><button class="btn" type="button" data-act="retry">Try again</button></p></div>`;
      }
    }
  }

  function notFound() {
    status.textContent = '';
    document.title = 'Post not found | Primer Community';
    root.innerHTML = `<div class="notfound card card--solid"><h1>This post isn’t here</h1>
      <p>It may have been deleted, or the link is wrong.</p>
      <p class="notfound__act"><a class="btn" href="community.html">Back to the community</a></p></div>`;
  }

  /* ---------- the post ---------- */
  function postHTML(p) {
    const meta = [];
    if (p.tag) meta.push(`<a class="tagchip tagchip--ink" href="community.html?tag=${encodeURIComponent(p.tag)}" aria-label="More posts about ${esc(p.tag)}">${esc(p.tag)}</a>`);
    meta.push(p.author ? `<span>Posted by <strong>${esc(p.author.name)}</strong></span>` : '<span>Posted by <span class="is-gone">[deleted]</span></span>');
    meta.push(C.time(p.createdAt));
    if (p.editedAt) meta.push(`<span>edited ${C.time(p.editedAt)}</span>`);

    const body = p.deleted
      ? '<p class="is-gone">The author deleted this post. The discussion is kept below.</p>'
      : C.prose(p.body);

    const pics = p.images.map((im, i) => {
      const src = C.photoSrc(im);
      if (!src) return '';
      const alt = im.alt || `Photo ${i + 1} of ${p.images.length}`;
      return `<a class="gallery__item" href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(alt)}" loading="lazy" decoding="async"><span class="sr-only"> (opens full size in a new tab)</span></a>`;
    }).join('');
    const gallery = pics ? `<div class="gallery gallery--${p.images.length}">${pics}</div>` : '';

    const items = p.sources.map((s) => {
      const href = C.safeHref(s.url);
      if (!href) return '';
      const host = C.host(href);
      return `<li>${C.link(href, s.label || s.url)}${s.label ? `<span class="sources__host">${esc(host)}</span>` : ''}</li>`;
    }).join('');
    const sources = items ? `<section class="sources" aria-labelledby="sources-title"><h2 id="sources-title">Sources</h2><ol>${items}</ol></section>` : '';

    const own = p.mine
      ? `<a class="textlink" href="community.html?edit=${Number(p.id)}">Edit post</a><button class="textlink" type="button" data-act="delete-post">Delete post</button>`
      : '';

    return `<article class="notice" aria-labelledby="post-title">
        ${C.voteHTML('post', p)}
        <div class="notice__main">
          <p class="notice__meta">${meta.join('<span aria-hidden="true">·</span>')}</p>
          <h1 id="post-title"${p.deleted ? ' class="is-gone"' : ''}>${p.deleted ? '[deleted]' : esc(p.title)}</h1>
          <div class="prose notice__body">${body}</div>
          ${gallery}
          ${sources}
          <div class="notice__foot"><button class="textlink" type="button" data-act="copy">Copy link</button>${own}</div>
        </div>
      </article>`;
  }

  /* ---------- the thread ---------- */
  function threadShell() {
    let form;
    if (post.deleted) form = '<p class="thread__note">This post was deleted, so it’s closed to new comments.</p>';
    else if (!user) form = `<div class="thread__signin card card--solid"><p>Anyone can read the discussion. Sign in to comment and vote.</p><a class="btn btn--small" href="${esc(C.signInHref())}">Sign in to comment</a></div>`;
    else {
      form = `<form class="reply reply--top card card--solid" data-form="new" novalidate>
          <label class="label" for="reply-new">Add a comment</label>
          <textarea class="textarea" id="reply-new" maxlength="5000" rows="4" placeholder="What do you think? Another source is welcome too." aria-describedby="reply-new-help reply-new-err"></textarea>
          <p class="field__error" id="reply-new-err" data-err></p>
          <div class="reply__foot"><button class="btn btn--small" type="submit">Comment</button>
          <p class="help" id="reply-new-help">Plain text. Links work, and maths goes between <code>\\(</code> and <code>\\)</code>.</p></div>
        </form>`;
    }
    return `<section class="thread" id="comments" aria-labelledby="comments-title">
        <div class="thread__head">
          <h2 id="comments-title"></h2>
          <div class="sorts" role="group" aria-label="Sort comments">
            <button class="chip" type="button" data-csort="top" aria-pressed="true">Top</button>
            <button class="chip" type="button" data-csort="new" aria-pressed="false">New</button>
          </div>
        </div>
        ${form}
        <ol class="cmts" id="cmts"></ol>
        <p class="thread__empty" id="cmts-empty" hidden>No comments yet. Start the conversation.</p>
      </section>`;
  }

  function tree() {
    const kids = new Map();
    comments.forEach((c) => {
      const k = c.parentId || 0;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(c);
    });
    const order = sort === 'new'
      ? (a, b) => b.createdAt - a.createdAt
      : (a, b) => (b.score - a.score) || (a.createdAt - b.createdAt);
    kids.forEach((list) => list.sort(order));
    return kids;
  }

  function countUnder(cid, kids) {
    return (kids.get(cid) || []).reduce((n, c) => n + 1 + countUnder(c.id, kids), 0);
  }

  function commentHTML(c, depth, kids) {
    const replies = kids.get(c.id) || [];
    const hidden = collapsed.has(c.id);
    const name = c.author ? c.author.name : '';
    const who = c.deleted
      ? '<span class="cmt__who is-gone">[deleted]</span>'
      : `<span class="cmt__who">${esc(name)}</span>${c.op ? '<span class="cmt__op" title="Wrote the post">Author</span>' : ''}`;
    const acts = [];
    if (!c.deleted && user && !post.deleted) acts.push('<button class="cmt__act" type="button" data-act="reply">Reply</button>');
    if (c.mine) {
      acts.push('<button class="cmt__act" type="button" data-act="edit">Edit</button>');
      acts.push('<button class="cmt__act" type="button" data-act="delete">Delete</button>');
    }
    if (replies.length) {
      const n = countUnder(c.id, kids);
      acts.push(`<button class="cmt__act" type="button" data-act="toggle" aria-expanded="${!hidden}" aria-controls="r-${c.id}">${hidden ? `Show ${C.plural(n, 'reply', 'replies')}` : 'Hide replies'}</button>`);
    }
    return `<li class="cmt${depth >= 5 ? ' cmt--flat' : ''}" id="c-${c.id}" data-id="${c.id}">
        <article class="cmt__box" tabindex="-1" aria-label="${c.deleted ? 'Deleted comment' : `Comment by ${esc(name)}`}">
          <p class="cmt__head">${who}<span aria-hidden="true">·</span>${C.time(c.createdAt)}${c.editedAt ? '<span class="cmt__edited">edited</span>' : ''}</p>
          <div class="prose cmt__body">${c.deleted ? '<p class="is-gone">[deleted]</p>' : C.prose(c.body)}</div>
          <div class="cmt__bar">${C.voteHTML('comment', c, { row: true })}${acts.join('')}</div>
          <div class="cmt__slot"></div>
        </article>
        ${replies.length ? `<ol class="cmt__replies" id="r-${c.id}"${hidden ? ' hidden' : ''}>${replies.map((r) => commentHTML(r, depth + 1, kids)).join('')}</ol>` : ''}
      </li>`;
  }

  function renderThread() {
    const kids = tree();
    const list = $('#cmts');
    list.innerHTML = (kids.get(0) || []).map((c) => commentHTML(c, 0, kids)).join('');
    $$('.cmt__body', list).forEach(C.math);
    $('#comments-title').textContent = post.comments ? C.plural(post.comments, 'comment') : 'Comments';
    $('#cmts-empty').hidden = comments.length > 0;
    $$('[data-csort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.csort === sort)));
  }

  function render() {
    document.title = `${post.deleted ? '[deleted]' : post.title} | Primer Community`;
    root.innerHTML = postHTML(post) + threadShell();
    C.math($('.notice__body'));
    renderThread();
  }

  function focusComment(cid) {
    const box = $(`#c-${cid} > .cmt__box`);
    if (!box) return;
    // open any collapsed thread it sits in
    let el = box.closest('.cmt__replies');
    while (el) {
      if (el.hidden) {
        el.hidden = false;
        const owner = el.closest('.cmt');
        collapsed.delete(Number(owner.dataset.id));
        const t = $(':scope > .cmt__box [data-act="toggle"]', owner);
        if (t) { t.setAttribute('aria-expanded', 'true'); t.textContent = 'Hide replies'; }
      }
      el = el.parentElement.closest('.cmt__replies');
    }
    box.focus({ preventScroll: true });
    box.scrollIntoView({ block: 'center', behavior: smooth() });
    box.classList.remove('is-flash');
    void box.offsetWidth;
    box.classList.add('is-flash');
  }

  /* ---------- reply and edit forms, in place ---------- */
  const byId = (cid) => comments.find((c) => c.id === cid);

  function openForm(li, mode) {
    const c = byId(Number(li.dataset.id));
    if (!c) return;
    const slot = $(':scope > .cmt__box > .cmt__slot', li);
    const open = slot.querySelector('form');
    if (open && open.dataset.form === mode) { open.querySelector('textarea').focus(); return; }
    closeForm(slot);
    const fid = `f-${mode}-${c.id}`;
    slot.innerHTML = `<form class="reply reply--inline" data-form="${mode}" data-id="${c.id}" novalidate>
        <label class="sr-only" for="${fid}">${mode === 'reply' ? `Reply to ${esc(c.author.name)}` : 'Edit your comment'}</label>
        <textarea class="textarea" id="${fid}" maxlength="5000" rows="3" placeholder="${mode === 'reply' ? `Reply to ${esc(c.author.name)}` : ''}" aria-describedby="${fid}-err"></textarea>
        <p class="field__error" id="${fid}-err" data-err></p>
        <div class="reply__foot"><button class="btn btn--small" type="submit">${mode === 'reply' ? 'Reply' : 'Save'}</button>
        <button class="textlink" type="button" data-act="cancel">Cancel</button></div>
      </form>`;
    const ta = slot.querySelector('textarea');
    if (mode === 'edit') {
      ta.value = c.body;
      $(':scope > .cmt__box > .cmt__body', li).hidden = true;
    }
    ta.focus();
  }

  function closeForm(slot) {
    const li = slot.closest('.cmt');
    slot.innerHTML = '';
    const body = $(':scope > .cmt__box > .cmt__body', li);
    if (body) body.hidden = false;
  }

  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const ta = form.querySelector('textarea');
    const err = form.querySelector('[data-err]');
    const words = ta.value.trim();
    err.textContent = '';
    ta.removeAttribute('aria-invalid');
    if (!words) {
      err.textContent = form.dataset.form === 'edit' ? 'A comment can’t be empty. Delete it instead.' : 'Write something first.';
      ta.setAttribute('aria-invalid', 'true');
      ta.focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (form.dataset.form === 'edit') {
        const d = await P.patch('/api/community/comments/' + form.dataset.id, { body: words });
        comments = comments.map((c) => (c.id === d.comment.id ? d.comment : c));
        renderThread();
        focusComment(d.comment.id);
        C.announce('Your comment is saved.');
      } else {
        const parentId = form.dataset.form === 'reply' ? Number(form.dataset.id) : null;
        const d = await P.post(`/api/community/posts/${post.id}/comments`, { body: words, parentId });
        comments.push(d.comment);
        post.comments += 1;
        if (parentId) collapsed.delete(parentId);
        else ta.value = '';
        btn.disabled = false;
        renderThread();
        focusComment(d.comment.id);
        C.announce('Your comment is posted.');
      }
    } catch (ex) {
      btn.disabled = false;
      err.textContent = ex.message;
      ta.focus();
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const form = e.target.closest('form.reply--inline');
    if (!form) return;
    const li = form.closest('.cmt');
    closeForm(form.parentElement);
    const btn = $(`:scope > .cmt__box [data-act="${form.dataset.form}"]`, li);
    if (btn) btn.focus();
  });

  root.addEventListener('click', async (e) => {
    const sortBtn = e.target.closest('[data-csort]');
    if (sortBtn) { sort = sortBtn.dataset.csort; renderThread(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const li = btn.closest('.cmt');

    if (act === 'retry') { status.textContent = 'Loading the post…'; load(); return; }
    if (act === 'copy') {
      const link = `${location.origin}/post.html?id=${post.id}`;
      try { await navigator.clipboard.writeText(link); P.toast('Link copied.'); } catch (ex) { P.toast('Couldn’t copy the link. It’s in the address bar.', 'error'); }
      return;
    }
    if (act === 'delete-post') {
      const msg = post.comments || comments.length
        ? 'Delete your post? Its title, text, sources and photos will be removed. The comments stay, under “[deleted]”.'
        : 'Delete your post? This can’t be undone.';
      if (!window.confirm(msg)) return;
      btn.disabled = true;
      try {
        await P.del('/api/community/posts/' + post.id);
        C.flash('Your post was deleted.');
        location.href = 'community.html';
      } catch (ex) {
        btn.disabled = false;
        P.toast(ex.message, 'error');
      }
      return;
    }
    if (!li) return;
    if (act === 'reply' || act === 'edit') { openForm(li, act); return; }
    if (act === 'cancel') {
      const form = btn.closest('form');
      closeForm(form.parentElement);
      const back = $(`:scope > .cmt__box [data-act="${form.dataset.form}"]`, li);
      if (back) back.focus();
      return;
    }
    if (act === 'toggle') {
      const cid = Number(li.dataset.id);
      const list = $(`#r-${cid}`);
      const show = list.hidden;
      list.hidden = !show;
      if (show) collapsed.delete(cid); else collapsed.add(cid);
      btn.setAttribute('aria-expanded', String(show));
      btn.textContent = show ? 'Hide replies' : `Show ${C.plural(countUnder(cid, tree()), 'reply', 'replies')}`;
      return;
    }
    if (act === 'delete') {
      if (!window.confirm('Delete your comment? This can’t be undone.')) return;
      btn.disabled = true;
      try {
        await P.del('/api/community/comments/' + li.dataset.id);
        await load();
        C.announce('Your comment is deleted.');
        const heading = $('#comments-title');
        if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
      } catch (ex) {
        btn.disabled = false;
        P.toast(ex.message, 'error');
      }
    }
  });
})();
