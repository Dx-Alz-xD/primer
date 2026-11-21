/* =====================================================================
   EPUB export: packs a course's written lessons into an EPUB 3 file,
   built entirely in the browser.

     mimetype                 first, stored, no extra field
     META-INF/container.xml   points at the package document
     OEBPS/content.opf        metadata, manifest, spine
     OEBPS/nav.xhtml          the table of contents
     OEBPS/title.xhtml        the title page
     OEBPS/chapter-001.xhtml  one per written lesson, with its exercises
     OEBPS/answers.xhtml      the answer key
     OEBPS/images/<hash>.jpg  the lessons' photos (from this site's /media/)
     OEBPS/style.css

   Every XHTML file is built as a real XML document and written with
   XMLSerializer, so it is well-formed. Maths becomes MathML through
   KaTeX (output: 'mathml'); figures stay inline SVG. Photos are copied
   into the book with their captions and credits; one that can't be
   fetched is left out.

   P.epub.download(courseIdOrBook, button) is all a page needs: on first
   use it loads KaTeX, the ZIP writer and the book renderer itself.
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const NS = {
    xhtml: 'http://www.w3.org/1999/xhtml',
    ops: 'http://www.idpf.org/2007/ops',
    xmlns: 'http://www.w3.org/2000/xmlns/',
    xml: 'http://www.w3.org/XML/1998/namespace',
    mathml: 'http://www.w3.org/1998/Math/MathML',
    svg: 'http://www.w3.org/2000/svg'
  };
  const KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
  const XHTML_TYPE = 'application/xhtml+xml';
  const pad = (n) => String(n).padStart(3, '0');
  const chapterFile = (n) => `chapter-${pad(n)}.xhtml`;

  // XML 1.0 can't hold these characters at all, even escaped.
  const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
  const scrub = (s) => { const t = String(s == null ? '' : s).replace(BAD_XML, ''); return t.toWellFormed ? t.toWellFormed() : t; };
  const x = (s) => P.esc(scrub(s));

  /* ---------- loading what the export needs ---------- */
  function loadScript(src, crossOrigin) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      if (crossOrigin) s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error('Part of the exporter didn’t load. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  let readying = null;
  function ready() {
    if (!readying) {
      readying = Promise.all([
        P.zip ? null : loadScript('assets/js/zip.js'),
        P.book ? null : loadScript('assets/js/book-content.js'),
        P.photos ? null : loadScript('assets/js/photos.js'),
        P.refs ? null : loadScript('assets/js/refs.js'), // each chapter's sources
        // Without KaTeX the maths is kept as TeX source rather than failing the whole export.
        window.katex ? null : loadScript(KATEX_JS, true).catch(() => console.warn('[Primer] KaTeX didn’t load, so the EPUB keeps maths as TeX.'))
      ]).catch((err) => { readying = null; throw err; });
    }
    return readying;
  }
  // Start loading when the pointer or focus reaches a [data-epub] button, so the download
  // still happens within the click's user activation.
  ['pointerover', 'focusin'].forEach((type) => document.addEventListener(type, (e) => {
    if (e.target.closest && e.target.closest('[data-epub]')) ready().catch(() => {});
  }, { passive: true }));

  /* ---------- maths: TeX between \( \), \[ \] or $$ $$ becomes MathML ---------- */
  // The same delimiters, and the same way of finding them, as KaTeX's auto-render in the reader.
  const DELIMS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false }
  ];
  const LEFT = /\$\$|\\\[|\\\(/;

  function findEnd(delim, text, i) {
    let depth = 0;
    while (i < text.length) {
      if (depth <= 0 && text.startsWith(delim, i)) return i;
      const c = text[i];
      if (c === '\\') i++;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    return -1;
  }

  function splitMath(text) {
    const out = [];
    let rest = text;
    for (;;) {
      const at = rest.search(LEFT);
      if (at < 0) break;
      if (at > 0) { out.push({ text: rest.slice(0, at) }); rest = rest.slice(at); }
      const d = DELIMS.find((dl) => rest.startsWith(dl.left));
      const end = findEnd(d.right, rest, d.left.length);
      if (end < 0) break;
      out.push({ tex: rest.slice(d.left.length, end), display: d.display });
      rest = rest.slice(end + d.right.length);
    }
    if (rest) out.push({ text: rest });
    return out;
  }

  function mathNodes(doc, tex, display) {
    const tpl = doc.createElement('template');
    let html = '';
    if (window.katex) {
      try { html = window.katex.renderToString(tex, { output: 'mathml', displayMode: display, throwOnError: false }); } catch (e) { html = ''; }
    }
    if (html) tpl.innerHTML = html;
    else {
      const code = doc.createElement('code');
      code.className = 'tex';
      code.textContent = display ? `$$${tex}$$` : `\\(${tex}\\)`;
      tpl.content.appendChild(code);
    }
    return tpl.content;
  }

  const NO_MATH = new Set(['code', 'pre', 'script', 'style', 'textarea', 'math', 'svg']);
  function mathify(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!LEFT.test(n.nodeValue)) continue;
      let skip = false;
      for (let p = n.parentNode; p && p !== root; p = p.parentNode) if (NO_MATH.has(p.localName)) { skip = true; break; }
      if (!skip) hits.push(n);
    }
    hits.forEach((n) => {
      const parts = splitMath(n.nodeValue);
      if (!parts.some((p) => p.tex != null)) return;
      const frag = doc.createDocumentFragment();
      parts.forEach((p) => frag.appendChild(p.tex != null ? mathNodes(doc, p.tex, p.display) : doc.createTextNode(p.text)));
      n.replaceWith(frag);
    });
  }

  /* ---------- XHTML documents ---------- */
  const el = (doc, name, text) => { const e = doc.createElementNS(NS.xhtml, name); if (text != null) e.textContent = text; return e; };
  const setType = (node, type) => { if (node) node.setAttributeNS(NS.ops, 'epub:type', type); };

  function newDoc(title, lang) {
    const impl = document.implementation;
    const doc = impl.createDocument(NS.xhtml, 'html', impl.createDocumentType('html', '', ''));
    const html = doc.documentElement;
    html.setAttributeNS(NS.xmlns, 'xmlns:epub', NS.ops);
    html.setAttribute('lang', lang);
    html.setAttributeNS(NS.xml, 'xml:lang', lang);
    const head = el(doc, 'head');
    const meta = el(doc, 'meta');
    meta.setAttribute('charset', 'utf-8');
    const css = el(doc, 'link');
    css.setAttribute('rel', 'stylesheet');
    css.setAttribute('type', 'text/css');
    css.setAttribute('href', 'style.css');
    head.append(meta, el(doc, 'title', scrub(title)), css);
    const body = el(doc, 'body');
    html.append(head, body);
    return { doc, body };
  }

  // HTML from the shared renderer -> nodes in an XHTML document, with the maths turned into MathML.
  function appendHTML(doc, parent, html) {
    const src = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
    mathify(src.body);
    Array.from(src.body.childNodes).forEach((n) => parent.appendChild(doc.importNode(n, true)));
    parent.querySelectorAll('*').forEach((n) => {
      n.removeAttribute('data-a'); // the reader's bookmarks
      // The serializer writes the namespace declarations itself; copies from the HTML parser would clash.
      Array.from(n.attributes).forEach((a) => { if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) n.removeAttributeNode(a); });
    });
  }

  const serialize = (doc) => '<?xml version="1.0" encoding="UTF-8"?>\n' + scrub(new XMLSerializer().serializeToString(doc)) + '\n';
  const props = (doc) => [
    doc.getElementsByTagNameNS(NS.mathml, 'math').length ? 'mathml' : '',
    doc.getElementsByTagNameNS(NS.svg, 'svg').length ? 'svg' : ''
  ].filter(Boolean).join(' ');

  const LINKS = {
    chapter: (n) => chapterFile(n),
    exercise: (n, k) => `${chapterFile(n)}#ex-${n}-${k}`,
    answer: (n, k) => `answers.xhtml#ans-${n}-${k}`,
    answers: () => 'answers.xhtml',
    lesson: () => 'nav.xhtml'
  };

  function titleDoc(book) {
    const { doc, body } = newDoc(book.title, book.lang);
    setType(body, 'frontmatter');
    appendHTML(doc, body, P.book.html.cover(book));
    setType(body.firstElementChild, 'titlepage');
    return doc;
  }

  function chapterDoc(book, ch) {
    const { doc, body } = newDoc(`Lesson ${ch.n}: ${ch.title}`, book.lang);
    setType(body, 'bodymatter');
    appendHTML(doc, body, P.book.html.chapter(book, ch, LINKS));
    setType(body.firstElementChild, 'chapter');
    return doc;
  }

  // The photos the chapters show, copied into the book (OEBPS/images/), with each <img> pointed at
  // its copy. A photo that can't be fetched leaves the book along with its caption and credit.
  const PHOTO_SRC = /^\/media\/([a-f0-9]{32}\.(jpg|png|webp|gif))$/;
  const IMAGE_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  async function embedPhotos(docs) {
    const uses = new Map(); // src -> [img]
    docs.forEach((doc) => Array.from(doc.getElementsByTagNameNS(NS.xhtml, 'img')).forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!PHOTO_SRC.test(src)) { (img.closest('figure') || img).remove(); return; }
      if (!uses.has(src)) uses.set(src, []);
      uses.get(src).push(img);
    }));
    const files = [];
    await Promise.all(Array.from(uses, async ([src, imgs]) => {
      const [, name, ext] = PHOTO_SRC.exec(src);
      let data = null;
      try {
        const res = await fetch(src, { credentials: 'same-origin' });
        if (res.ok) data = new Uint8Array(await res.arrayBuffer());
      } catch (e) { data = null; }
      if (!data || !data.length) { imgs.forEach((img) => (img.closest('figure') || img).remove()); return; }
      imgs.forEach((img) => {
        img.setAttribute('src', 'images/' + name);
        img.removeAttribute('loading');
        img.removeAttribute('decoding');
        if (img.parentNode && img.parentNode.removeAttribute) img.parentNode.removeAttribute('style');
      });
      files.push({ id: 'img-' + name.slice(0, 16), href: 'images/' + name, type: IMAGE_TYPES[ext], data });
    }));
    // links open in the reading app's own way
    docs.forEach((doc) => Array.from(doc.getElementsByTagNameNS(NS.xhtml, 'a')).forEach((a) => a.removeAttribute('target')));
    return files.sort((a, b) => a.href.localeCompare(b.href));
  }

  function answersDoc(book) {
    const { doc, body } = newDoc('Answers', book.lang);
    setType(body, 'backmatter');
    appendHTML(doc, body, P.book.html.answers(book, LINKS));
    return doc;
  }

  function navDoc(book) {
    const { doc, body } = newDoc('Contents', book.lang);
    const nav = el(doc, 'nav');
    setType(nav, 'toc');
    nav.setAttribute('id', 'toc');
    nav.append(el(doc, 'h1', 'Contents'));
    const link = (href, text) => { const li = el(doc, 'li'); const a = el(doc, 'a', scrub(text)); a.setAttribute('href', href); li.append(a); return li; };
    const list = el(doc, 'ol');
    list.append(link('title.xhtml', 'Title page'));
    let unit = null, sub = null;
    book.chapters.forEach((ch) => {
      if (!unit || unit.index !== ch.unitIndex) {
        const li = el(doc, 'li');
        sub = el(doc, 'ol');
        li.append(el(doc, 'span', scrub(`Unit ${P.roman(ch.unitIndex)}: ${ch.unit}`)), sub);
        list.append(li);
        unit = { index: ch.unitIndex };
      }
      sub.append(link(chapterFile(ch.n), `${ch.n}. ${ch.title}`));
    });
    if (book.hasExercises) list.append(link('answers.xhtml', 'Answers'));
    nav.append(list);
    // A toc nav may hold only its heading and one list, so the note sits after it.
    const note = book.chapters.length < book.total
      ? el(doc, 'p', `${P.book.countLine(book)}. The other lessons will be in a new copy once they are written.`)
      : null;

    const marks = el(doc, 'nav');
    setType(marks, 'landmarks');
    marks.setAttribute('hidden', 'hidden');
    marks.append(el(doc, 'h2', 'Landmarks'));
    const ml = el(doc, 'ol');
    const mark = (href, type, text) => { const li = link(href, text); setType(li.firstChild, type); ml.append(li); };
    mark('title.xhtml', 'titlepage', 'Title page');
    mark('nav.xhtml#toc', 'toc', 'Contents');
    mark(chapterFile(book.chapters[0].n), 'bodymatter', 'Start reading');
    marks.append(ml);
    body.append(nav);
    if (note) body.append(note);
    body.append(marks);
    return doc;
  }

  // The same course always gets the same identifier, so a reading app sees a new download as the same book.
  function uuidFor(id) {
    const h = [0, 1, 2, 3].map((i) => P.hashStr(`primer-book:${i}:${id}`).toString(16).padStart(8, '0')).join('');
    const variant = ((parseInt(h[16], 16) & 3) | 8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  function opf(book, items, spine) {
    const now = new Date();
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${x(book.lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${uuidFor(book.id)}</dc:identifier>
    <dc:title>${x(book.title)}</dc:title>
    <dc:language>${x(book.lang)}</dc:language>
    <dc:creator>Primer</dc:creator>
    <dc:publisher>Primer</dc:publisher>
${book.topic ? `    <dc:subject>${x(book.topic)}</dc:subject>\n` : ''}    <dc:description>${x(`${book.range}. ${P.book.countLine(book)}.`)}</dc:description>
    <dc:date>${now.toISOString().slice(0, 10)}</dc:date>
    <meta property="dcterms:modified">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
${items.map((i) => `    <item id="${i.id}" href="${i.href}" media-type="${i.type}"${i.props ? ` properties="${i.props}"` : ''}/>`).join('\n')}
  </manifest>
  <spine>
${spine.map((id) => `    <itemref idref="${id}"/>`).join('\n')}
  </spine>
</package>
`;
  }

  const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

  // Kept simple: reading apps apply their own fonts, sizes and night modes on top.
  const STYLE = `@charset "UTF-8";
body { margin: 0 4%; font-family: "Cormorant Garamond", Georgia, "Times New Roman", serif; line-height: 1.5; }
h1, h2, h3, h4 { font-family: "IM Fell English", Georgia, "Times New Roman", serif; font-weight: normal; line-height: 1.15; page-break-after: avoid; break-after: avoid; }
p { margin: 0 0 0.8em; }
a { color: #8a6128; }
ul, ol { margin: 0 0 0.9em; padding-left: 1.4em; }
li { margin: 0.25em 0; }
.bk-rule { width: 6em; margin: 1.2em auto; border-top: 3px double #8a6128; }
.bk-cover { text-align: center; padding-top: 18%; }
.bk-cover__topic { font-style: italic; }
.bk-cover__title { font-size: 2.2em; margin: 0.4em 0; }
.bk-cover__count, .bk-cover__date { font-style: italic; }
.bk-cover__foot { margin-top: 3em; }
.bk-cover__by { font-family: "IM Fell English", Georgia, serif; }
.bk-chapter__head { text-align: center; margin: 1.5em 0 1.6em; }
.bk-chapter__kicker { font-variant: small-caps; letter-spacing: 0.1em; margin: 0; }
.bk-chapter__title { font-size: 1.8em; margin: 0.2em 0 0.3em; }
.bk-chapter__unit { font-style: italic; margin: 0; }
.bk-sec { font-size: 1.3em; margin: 1.5em 0 0.5em; }
.bk-h { font-size: 1.1em; margin: 1.1em 0 0.4em; }
.math-display { margin: 0.8em 0 1em; text-align: center; overflow-x: auto; }
math[display="block"] { display: block; margin: 0.4em auto; }
.fig { margin: 1.2em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
.fig svg { max-width: 100%; height: auto; }
figcaption { font-style: italic; font-size: 0.92em; margin-top: 0.5em; }
.photo { margin: 1.3em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
.photo__frame { display: inline-block; max-width: 100%; padding: 0.3em; border: 1px solid #a88b5c; }
.photo img { display: block; max-width: 100%; max-height: 80vh; width: auto; height: auto; margin: 0 auto; }
.photo__cap { margin-top: 0.4em; }
.photo__text { display: block; font-style: italic; }
.photo__credit { display: block; font-style: normal; font-size: 0.78em; margin-top: 0.2em; }
.callout { margin: 1em 0; padding: 0.6em 0.9em; border-left: 3px solid #8a6128; background: rgba(138, 97, 40, 0.08); }
.callout--mnemonic { border-left-color: #9a3324; }
.callout--eli5 { border-left-color: #3d6a2c; }
.callout__title { font-family: "IM Fell English", Georgia, serif; margin-bottom: 0.3em; }
.bk-ex { margin-top: 2em; padding-top: 0.8em; border-top: 1px solid #c9b48a; }
.bk-ex__title, .bk-answers__title { font-size: 1.4em; }
.bk-answers__title { text-align: center; }
.bk-ex__list, .bk-ans { list-style: none; padding: 0; }
.bk-ex__item, .bk-ans__item { margin: 0 0 1em; }
.bk-ex__n { font-family: "IM Fell English", Georgia, serif; color: #8a6128; margin-right: 0.5em; }
.bk-ex__prompt { display: inline; }
.bk-ex__prompt p { display: inline; }
.bk-ex__choices { list-style: none; padding-left: 1.6em; margin: 0.4em 0; }
.bk-ex__letter { font-style: italic; }
.bk-ex__note, .bk-ex__more, .bk-ans__also { font-style: italic; font-size: 0.92em; }
.bk-ex__more { margin: 0.2em 0 0; }
.bk-ans__main { display: inline; }
.bk-ans__explain { margin-top: 0.3em; }
.bk-ans-ch__title { font-size: 1.1em; margin: 1.4em 0 0.5em; }
code.tex { font-family: monospace; font-size: 0.9em; }
nav ol { list-style: none; padding-left: 1em; }
.srctags { font-size: 0.55em; vertical-align: super; line-height: 1; margin-left: 0.3em; }
.srctag { text-decoration: none; padding: 0 0.15em; }
.bk-src { margin-top: 2em; padding-top: 0.8em; border-top: 1px solid #c9b48a; }
.srcs__title { font-size: 1.3em; }
.srcs__note { font-style: italic; font-size: 0.92em; }
.srcs__list { list-style: none; padding: 0; }
.src { margin: 0 0 0.5em; }
.src__n { font-family: "IM Fell English", Georgia, serif; color: #8a6128; margin-right: 0.5em; }
.src__site, .src__by, .src__doi { font-size: 0.95em; }
`;

  function fileName(title) {
    const slug = String(title || '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return (slug || 'primer-book') + '.epub';
  }

  async function build(book) {
    await ready();
    if (!book.chapters.length) throw new Error('Write at least one lesson first.');
    const files = [];
    const items = [{ id: 'css', href: 'style.css', type: 'text/css' }];
    const spine = [];
    const add = (id, href, doc, extra) => {
      files.push({ name: 'OEBPS/' + href, data: serialize(doc) });
      items.push({ id, href, type: XHTML_TYPE, props: [extra, props(doc)].filter(Boolean).join(' ') });
      spine.push(id);
    };
    add('title', 'title.xhtml', titleDoc(book));
    add('nav', 'nav.xhtml', navDoc(book), 'nav');
    const chapters = book.chapters.map((ch) => ({ ch, doc: chapterDoc(book, ch) }));
    const photos = await embedPhotos(chapters.map((c) => c.doc));
    chapters.forEach(({ ch, doc }) => add(`ch${pad(ch.n)}`, chapterFile(ch.n), doc));
    if (book.hasExercises) add('answers', 'answers.xhtml', answersDoc(book));
    files.push({ name: 'OEBPS/style.css', data: STYLE });
    photos.forEach((im) => {
      files.push({ name: 'OEBPS/' + im.href, data: im.data });
      items.push({ id: im.id, href: im.href, type: im.type });
    });
    const blob = P.zip([
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: CONTAINER },
      { name: 'OEBPS/content.opf', data: opf(book, items, spine) }
    ].concat(files), { type: 'application/epub+zip' });
    return { blob, name: fileName(book.title) };
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  let busy = false;
  P.epub = {
    build,
    // source: a course id, or a book from P.book.load. button (optional) shows that work is under way.
    async download(source, button) {
      if (busy) return;
      busy = true;
      const label = button && (button.querySelector('.tool__label') || button);
      const before = label && label.textContent;
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
      if (label) label.textContent = 'Making the EPUB…';
      try {
        await ready();
        const book = typeof source === 'string' ? await P.book.load(source) : source;
        if (!book.chapters.length) {
          P.toast('There’s nothing to put in the book yet. Open a lesson to have it written, then try again.', 'error');
          return;
        }
        const out = await build(book);
        save(out.blob, out.name);
        P.toast(`Your EPUB is ready: ${out.name}`);
      } catch (err) {
        console.error('[Primer] EPUB', err);
        P.toast('The EPUB couldn’t be made. ' + err.message, 'error');
      } finally {
        busy = false;
        if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
        if (label) label.textContent = before;
      }
    }
  };
})();
