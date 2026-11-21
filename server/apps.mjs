// =====================================================================
// "Practise with": apps and websites where a lesson's skill is best
// practised (drawing in Krita, graphs in GeoGebra or Desmos, code in an
// editor, scores in MuseScore, models in Blender, circuits in Tinkercad,
// vocabulary in Anki...).
//
// The AI proposes up to three from the lesson, with what each one is and
// two or three steps for practising this lesson in it. Only real,
// well-known apps survive:
//   - an app in the catalogue below is known: its official address,
//     price, licence and platforms come from the catalogue, not the AI;
//   - any other must have an English Wikipedia article about software
//     whose external links include the address the AI gave (so the
//     address is its official site); its licence and platforms are read
//     from the article's categories;
//   - either way its official address must answer (a bot wall's 403
//     counts: the site is there), fetched from a public https host.
// Free and open-source apps, and ones that run on Android or in a web
// browser, go first. When no app genuinely helps, nothing is shown.
//
// Each app's icon is fetched by the server (its apple-touch-icon or
// favicon, else its logo on Wikimedia Commons), checked by its first
// bytes, kept as data/media/<hash>.png and served from this site like
// lesson photos, so there is no CSP change and it works offline.
// =====================================================================
import { wikimedia } from './photos.mjs';
import { askJSON, cached } from './ai.mjs';
import { safeFetch, httpsURL, keepImage, readCache, writeCache, once, hash, oneLine, words, covers, mediaExists } from './refnet.mjs';
import { RetryLater } from './sources.mjs';

const P = (s) => s.split(' ');
// platforms: android ios windows mac linux web
const CATALOG = [
  // drawing, painting, design
  { name: 'Krita', url: 'https://krita.org/', wiki: 'Krita', free: true, oss: true, platforms: P('android windows mac linux'), what: 'A free, open-source painting program for drawing, illustration and comics.' },
  { name: 'GIMP', url: 'https://www.gimp.org/', wiki: 'GIMP', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source image editor for photos and digital painting.' },
  { name: 'Inkscape', url: 'https://inkscape.org/', wiki: 'Inkscape', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source editor for vector drawings, logos and diagrams.' },
  { name: 'MediBang Paint', url: 'https://medibangpaint.com/', wiki: 'MediBang Paint', free: true, oss: false, platforms: P('android ios windows mac'), what: 'A free drawing and comic app that runs on phones, tablets and computers.' },
  { name: 'ibis Paint X', alias: ['ibis paint', 'ibispaint'], url: 'https://ibispaint.com/', wiki: 'IbisPaint', free: true, oss: false, platforms: P('android ios windows'), what: 'A free drawing app for phones and tablets, with brushes, layers and rulers.' },
  { name: 'Tux Paint', url: 'https://tuxpaint.org/', wiki: 'Tux Paint', free: true, oss: true, platforms: P('android windows mac linux'), what: 'A free, open-source drawing program made for children.' },
  { name: 'Photopea', url: 'https://www.photopea.com/', wiki: 'Photopea', free: true, oss: false, platforms: P('web'), what: 'A free photo and image editor that works in any web browser.' },
  { name: 'Penpot', url: 'https://penpot.app/', wiki: 'Penpot', free: true, oss: true, platforms: P('web'), what: 'A free, open-source design and prototyping tool that runs in the browser.' },
  { name: 'Figma', url: 'https://www.figma.com/', wiki: 'Figma', free: true, oss: false, platforms: P('web windows mac'), what: 'A design tool for screens and prototypes, with a free plan, in the browser.' },
  { name: 'Canva', url: 'https://www.canva.com/', wiki: 'Canva', free: true, oss: false, platforms: P('web android ios windows mac'), what: 'A design app for posters, slides and graphics, with a free plan.' },
  // maths
  { name: 'GeoGebra', url: 'https://www.geogebra.org/', wiki: 'GeoGebra', free: true, oss: false, platforms: P('web android ios windows mac linux'), what: 'Free maths apps for geometry, graphing, algebra and 3D, on the web and phones.' },
  { name: 'Desmos', alias: ['desmos graphing calculator', 'desmos calculator'], url: 'https://www.desmos.com/', wiki: 'Desmos', free: true, oss: false, platforms: P('web android ios'), what: 'A free graphing calculator for plotting functions and exploring them.' },
  { name: 'Khan Academy', url: 'https://www.khanacademy.org/', wiki: 'Khan Academy', free: true, oss: false, platforms: P('web android ios'), what: 'Free practice exercises and lessons in maths, science and more.' },
  // coding
  { name: 'Scratch', url: 'https://scratch.mit.edu/', wiki: 'Scratch (programming language)', free: true, oss: true, platforms: P('web windows mac android'), what: 'A free, block-based way to make programs, games and animations.' },
  { name: 'Snap!', alias: ['snap', 'build your own blocks'], url: 'https://snap.berkeley.edu/', wiki: 'Snap! (programming language)', free: true, oss: true, platforms: P('web'), what: 'A free, open-source block-based programming language in the browser.' },
  { name: 'Visual Studio Code', alias: ['vs code', 'vscode', 'code'], url: 'https://code.visualstudio.com/', wiki: 'Visual Studio Code', free: true, oss: true, platforms: P('windows mac linux web'), what: 'A free code editor for almost every programming language.' },
  { name: 'Thonny', url: 'https://thonny.org/', wiki: 'Thonny', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source Python editor made for beginners.' },
  { name: 'Python', alias: ['python idle', 'idle'], url: 'https://www.python.org/', wiki: 'Python (programming language)', free: true, oss: true, platforms: P('windows mac linux'), what: 'The Python language itself, with IDLE, its simple editor.' },
  { name: 'Replit', alias: ['repl.it', 'repl it'], url: 'https://replit.com/', wiki: 'Replit', free: true, oss: false, platforms: P('web android ios'), what: 'Write and run code in the browser or on a phone, with a free plan.' },
  { name: 'Google Colab', alias: ['colab', 'colaboratory', 'google colaboratory'], url: 'https://colab.research.google.com/', wiki: 'Project Jupyter', free: true, oss: false, platforms: P('web'), what: 'Free Python notebooks that run in the browser.' },
  { name: 'Jupyter', alias: ['jupyterlab', 'jupyter notebook', 'project jupyter'], url: 'https://jupyter.org/', wiki: 'Project Jupyter', free: true, oss: true, platforms: P('web windows mac linux'), what: 'Free, open-source notebooks for code, data and notes together.' },
  { name: 'Sololearn', url: 'https://www.sololearn.com/', wiki: 'Sololearn', free: true, oss: false, platforms: P('web android ios'), what: 'Short coding lessons and exercises that work well on a phone.' },
  { name: 'Overleaf', url: 'https://www.overleaf.com/', wiki: 'Overleaf', free: true, oss: true, platforms: P('web'), what: 'Write LaTeX documents in the browser, with a free plan.' },
  // electronics, physics, engineering
  { name: 'Arduino IDE', alias: ['arduino'], url: 'https://www.arduino.cc/', wiki: 'Arduino', free: true, oss: true, platforms: P('windows mac linux web'), what: 'The free, open-source editor for programming Arduino boards.' },
  { name: 'Tinkercad', alias: ['tinkercad circuits'], url: 'https://www.tinkercad.com/', wiki: 'Tinkercad', free: true, oss: false, platforms: P('web'), what: 'Free browser tools for 3D design and simulated electronic circuits.' },
  { name: 'Wokwi', url: 'https://wokwi.com/', wiki: 'Wokwi', free: true, oss: false, platforms: P('web'), what: 'A free online simulator for Arduino, ESP32 and Raspberry Pi Pico projects.' },
  { name: 'Falstad Circuit Simulator', alias: ['falstad', 'circuitjs', 'circuit simulator'], url: 'https://www.falstad.com/circuit/', wiki: 'Paul Falstad', free: true, oss: true, platforms: P('web'), what: 'A free circuit simulator in the browser that animates current and voltage.' },
  { name: 'PhET Simulations', alias: ['phet', 'phet interactive simulations'], url: 'https://phet.colorado.edu/', wiki: 'PhET Interactive Simulations', free: true, oss: true, platforms: P('web'), what: 'Free interactive science and maths simulations from the University of Colorado.' },
  { name: 'phyphox', url: 'https://phyphox.org/', wiki: 'Phyphox', free: true, oss: true, platforms: P('android ios'), what: 'A free app that turns a phone’s sensors into physics experiments.' },
  { name: 'Algodoo', url: 'https://www.algodoo.com/', wiki: 'Algodoo', free: true, oss: false, platforms: P('windows mac'), what: 'A free 2D physics sandbox for building and testing simple machines.' },
  { name: 'KiCad', url: 'https://www.kicad.org/', wiki: 'KiCad', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source program for drawing circuits and designing circuit boards.' },
  { name: 'Blender', url: 'https://www.blender.org/', wiki: 'Blender (software)', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source 3D program for modelling, animation and rendering.' },
  { name: 'FreeCAD', url: 'https://www.freecad.org/', wiki: 'FreeCAD', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source 3D CAD program for designing real objects.' },
  // music and sound
  { name: 'MuseScore', alias: ['musescore studio'], url: 'https://musescore.org/', wiki: 'MuseScore', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source program for writing, playing and printing sheet music.' },
  { name: 'Audacity', url: 'https://www.audacityteam.org/', wiki: 'Audacity (audio editor)', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source audio recorder and editor.' },
  { name: 'LMMS', url: 'https://lmms.io/', wiki: 'LMMS', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source program for making music with beats, synths and samples.' },
  { name: 'BandLab', url: 'https://www.bandlab.com/', wiki: 'BandLab', free: true, oss: false, platforms: P('web android ios'), what: 'A free music studio that runs in the browser and on phones.' },
  // languages and memory
  { name: 'Anki', alias: ['ankidroid', 'ankiweb'], url: 'https://apps.ankiweb.net/', wiki: 'Anki (software)', free: true, oss: true, platforms: P('windows mac linux android web'), what: 'Free, open-source flashcards that show each card just before you would forget it.' },
  { name: 'Duolingo', url: 'https://www.duolingo.com/', wiki: 'Duolingo', free: true, oss: false, platforms: P('web android ios'), what: 'Short daily language exercises, free with ads.' },
  // science and the world
  { name: 'Stellarium', url: 'https://stellarium.org/', wiki: 'Stellarium (software)', free: true, oss: true, platforms: P('windows mac linux web'), what: 'A free, open-source planetarium that shows the real night sky.' },
  { name: 'iNaturalist', url: 'https://www.inaturalist.org/', wiki: 'iNaturalist', free: true, oss: true, platforms: P('web android ios'), what: 'Photograph plants and animals and get help identifying them.' },
  { name: 'Merlin Bird ID', alias: ['merlin'], url: 'https://merlin.allaboutbirds.org/', wiki: 'Merlin Bird ID', free: true, oss: false, platforms: P('android ios'), what: 'A free app from the Cornell Lab that identifies birds by photo or song.' },
  { name: 'Google Earth', url: 'https://earth.google.com/', wiki: 'Google Earth', free: true, oss: false, platforms: P('web android ios'), what: 'A free 3D globe for exploring places, terrain and maps.' },
  { name: 'QGIS', url: 'https://qgis.org/', wiki: 'QGIS', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source program for making and analysing maps.' },
  { name: 'Avogadro', url: 'https://www.avogadro.cc/', wiki: 'Avogadro (software)', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source molecule editor and viewer.' },
  // office, money, typing, games of skill
  { name: 'LibreOffice', alias: ['libreoffice calc', 'libreoffice writer'], url: 'https://www.libreoffice.org/', wiki: 'LibreOffice', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source office suite with a word processor and spreadsheets.' },
  { name: 'Google Sheets', url: 'https://www.google.com/sheets/about/', wiki: 'Google Sheets', free: true, oss: false, platforms: P('web android ios'), what: 'Free spreadsheets in the browser and on phones, with a Google account.' },
  { name: 'GnuCash', url: 'https://www.gnucash.org/', wiki: 'GnuCash', free: true, oss: true, platforms: P('windows mac linux'), what: 'Free, open-source accounting software for personal and small-business books.' },
  { name: 'Monkeytype', url: 'https://monkeytype.com/', wiki: 'Monkeytype', free: true, oss: true, platforms: P('web'), what: 'A free, open-source typing test for practising touch typing.' },
  { name: 'Lichess', url: 'https://lichess.org/', wiki: 'Lichess', free: true, oss: true, platforms: P('web android ios'), what: 'Free, open-source chess: play, solve puzzles and study openings.' },
  { name: 'Kdenlive', url: 'https://kdenlive.org/', wiki: 'Kdenlive', free: true, oss: true, platforms: P('windows mac linux'), what: 'A free, open-source video editor.' },
  { name: 'OBS Studio', alias: ['obs'], url: 'https://obsproject.com/', wiki: 'OBS Studio', free: true, oss: true, platforms: P('windows mac linux'), what: 'Free, open-source software for recording and streaming video.' }
];

const key = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '');
const bareHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
const PLATFORMS = ['android', 'web', 'ios', 'windows', 'mac', 'linux'];

// By its name (or another name it goes by), or by its own site when the names overlap ("MuseScore 4").
function fromCatalog(name, url) {
  const k = key(name);
  const byName = CATALOG.find((c) => key(c.name) === k || (c.alias || []).some((a) => key(a) === k));
  if (byName || !url || !k) return byName || null;
  const host = bareHost(url.hostname);
  return CATALOG.find((c) => {
    const ck = key(c.name);
    return host === bareHost(new URL(c.url).hostname) && (k.includes(ck) || ck.includes(k));
  }) || null;
}

/* ---------------- an app that isn't in the catalogue: Wikipedia must know it ---------------- */

const EN_API = 'https://en.wikipedia.org/w/api.php';
const SOFTWARE = /\b(?:software|applications?|apps?|programs?|editors?|websites?|web services?|online services?|platforms?|web hosting|ides?|integrated development environments?|programming tools|simulators?|video games?|android \(operating system\)|ios)\b/i;

async function wm(fn) {
  try { return await fn(); } catch (err) {
    if (err instanceof wikimedia.Unreachable) throw new RetryLater(err.message);
    throw err;
  }
}

function factsFromCategories(cats) {
  const c = cats.join(' | ');
  const oss = /free and open-source software|open-source software|free software\b|software using the .*licen[cs]e|gpl|mit license|apache license|bsd license/i.test(c);
  const free = oss || /\bfreeware\b/i.test(c);
  const platforms = [];
  if (/android \(operating system\) software|android software/i.test(c)) platforms.push('android');
  if (/\bios software\b/i.test(c)) platforms.push('ios');
  if (/windows software/i.test(c)) platforms.push('windows');
  if (/macos software|mac os x software/i.test(c)) platforms.push('mac');
  if (/linux software/i.test(c)) platforms.push('linux');
  if (/web applications|web software|online services|browser-based|javascript software/i.test(c)) platforms.push('web');
  return { oss, free, platforms };
}

// -> { title, official: true, oss, free, platforms } | null (cached for good: an app's article rarely changes)
async function wikiKnows(name, url) {
  const ck = { v: 1, name: key(name), host: bareHost(url.hostname) };
  const hit = await readCache('appwiki', ck);
  if (hit) return hit.page || null;
  const s = await wm(() => wikimedia.api(EN_API, { action: 'query', list: 'search', srsearch: `${name} software`, srlimit: '5', srnamespace: '0', srprop: '' }));
  // an article named after the app ("Krita", "SketchBook (software)" for "Autodesk SketchBook"); its links decide the rest
  const nk = key(name);
  const titles = ((s.query && s.query.search) || []).map((x) => x.title)
    .filter((t) => {
      const bare = t.replace(/\s*\([^)]*\)\s*$/, '');
      return key(bare) === nk || (covers(words(bare), words(name)) >= 0.99 && covers(words(name), words(bare)) >= 0.5);
    })
    .slice(0, 2);
  let page = null;
  for (const title of titles) {
    const d = await wm(() => wikimedia.api(EN_API, {
      action: 'query', titles: title, redirects: '1', prop: 'extlinks|categories|pageprops', ellimit: 'max', cllimit: 'max', clshow: '!hidden', ppprop: 'disambiguation'
    }));
    const p = ((d.query && d.query.pages) || [])[0];
    if (!p || p.missing || (p.pageprops && 'disambiguation' in p.pageprops)) continue;
    const cats = (p.categories || []).map((c) => String(c.title || '').replace(/^Category:/, ''));
    if (!cats.some((c) => SOFTWARE.test(c))) continue; // an article, but not about software
    const host = bareHost(url.hostname);
    const official = (p.extlinks || []).some((l) => {
      try { const h = bareHost(new URL(l.url || l['*'] || '', 'https://x').hostname); return h === host || h.endsWith('.' + host) || host.endsWith('.' + h); } catch { return false; }
    });
    if (!official) continue;
    page = { title: p.title, ...factsFromCategories(cats) };
    break;
  }
  await writeCache('appwiki', ck, { page });
  return page;
}

/* ---------------- does the site answer, and what is its icon? ---------------- */

const ICON_BYTES = 400_000;

function iconLinks(html, base) {
  const out = [];
  for (const m of String(html || '').slice(0, 300_000).matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
    if (!/\bicon\b/i.test(rel)) continue;
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag) || /\bhref\s*=\s*([^\s>]+)/i.exec(tag) || [])[1];
    if (!href) continue;
    const sizes = (/\bsizes\s*=\s*["']?(\d+)x(\d+)/i.exec(tag) || [])[1];
    const apple = /apple-touch-icon/i.test(rel);
    if (/^data:image\/png;base64,/i.test(href)) { out.push({ data: href, size: Number(sizes) || 32, apple }); continue; }
    if (/\.svg(?:[?#]|$)/i.test(href) || /image\/svg/i.test(tag) || /mask-icon/i.test(rel)) continue; // no SVG: it can carry scripts
    try { out.push({ url: new URL(href.replace(/&amp;/g, '&'), base).href, size: Number(sizes) || (apple ? 180 : 32), apple }); } catch { /* not an address */ }
  }
  return out.sort((a, b) => Number(b.apple) - Number(a.apple) || b.size - a.size);
}

// The PNG icons a web app manifest lists, largest first (up to 512 px).
async function manifestIcons(html, base) {
  const tag = (String(html || '').slice(0, 300_000).match(/<link\b[^>]*\brel\s*=\s*["']?manifest[^>]*>/i) || [''])[0];
  const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag) || /\bhref\s*=\s*([^\s>]+)/i.exec(tag) || [])[1];
  if (!href) return [];
  let url;
  try { url = new URL(href.replace(/&amp;/g, '&'), base).href; } catch { return []; }
  try {
    const r = await safeFetch(url, { ms: 5000, maxBytes: 120_000, headers: { Accept: 'application/manifest+json,application/json' } });
    if (r.status !== 200 || !r.body || r.cut) return [];
    const m = JSON.parse(r.body.toString('utf8'));
    return (Array.isArray(m.icons) ? m.icons : []).map((i) => ({
      src: typeof i.src === 'string' ? i.src : '', size: Number(String(i.sizes || '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0).sort((a, b) => b - a)[0]) || 0,
      png: /png/i.test(String(i.type || '')) || /\.png(?:[?#]|$)/i.test(String(i.src || ''))
    })).filter((i) => i.src && i.png && i.size >= 64 && i.size <= 512).sort((a, b) => b.size - a.size).slice(0, 2)
      .map((i) => { try { return new URL(i.src, url).href; } catch { return ''; } }).filter(Boolean);
  } catch { return []; }
}

async function fetchIcon(url) {
  try {
    const r = await safeFetch(url, { ms: 6000, maxBytes: ICON_BYTES, headers: { Accept: 'image/png,image/x-icon,image/*;q=0.8' } });
    if (r.status !== 200 || !r.body || r.cut) return null;
    return await keepImage(r.body, url);
  } catch { return null; }
}

// The app's logo on Wikimedia Commons: the lead image of its article, when the file is a logo or an icon
// (its name says so, or it is a drawing named after the app), never a screenshot.
async function commonsLogo(title, name) {
  if (!title) return null;
  const d = await wm(() => wikimedia.api(EN_API, { action: 'query', titles: title, redirects: '1', prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: '128', pilicense: 'free' }));
  const p = ((d.query && d.query.pages) || [])[0];
  const thumb = p && p.thumbnail && p.thumbnail.source;
  const file = String((p && p.pageimage) || '');
  const logo = /logo|icon|emblem|symbol/i.test(file) || (/\.svg$/i.test(file) && key(file).includes(key(name)));
  if (!thumb || !logo || /screen.?shot|interface|window|demo|example|photo/i.test(file) || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(thumb)) return null;
  const res = await wm(() => wikimedia.file(thumb));
  if (!res.ok) { res.body?.cancel().catch(() => {}); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length <= ICON_BYTES ? keepImage(buf, thumb) : null;
}

// -> { ok, icon: { src, w, h } | null }
async function siteAndIcon(app) {
  const ck = { v: 1, url: app.url };
  const hit = await readCache('appsite', ck, 30 * 864e5);
  if (hit && (!hit.icon || await mediaExists(hit.icon.src))) return hit;
  let page;
  try {
    page = await safeFetch(app.url, { ms: 9000, maxBytes: 700_000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrimerCourseApp/1.0; educational course builder)', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
  } catch {
    return { ok: false, icon: null, status: 0 }; // unreachable now: not remembered
  }
  // a bot wall (Cloudflare and the like) answers 403 or 429 for a site that is there
  const ok = (page.status >= 200 && page.status < 300) || page.status === 401 || page.status === 403 || page.status === 429;
  let icon = null;
  if (ok) {
    const base = page.url || app.url;
    const html = page.status === 200 && page.body && /html/i.test(page.headers.get('content-type') || '') ? page.body.toString('utf8') : '';
    const links = iconLinks(html, base);
    const origin = new URL(base).origin;
    const tries = [
      ...links.filter((l) => l.url && l.size >= 64).map((l) => l.url),
      ...await manifestIcons(html, base),
      origin + '/apple-touch-icon.png',
      ...links.filter((l) => l.url && l.size < 64).map((l) => l.url),
      origin + '/favicon.ico'
    ].filter((u, i, a) => a.indexOf(u) === i).slice(0, 6);
    let best = null;
    for (const u of tries) {
      const got = await fetchIcon(u);
      if (got && (!best || got.w > best.w)) best = got;
      if (best && best.w >= 64) break;
    }
    if (!best || best.w < 48) {
      const logo = await commonsLogo(app.wiki, app.name).catch((err) => { if (err.retryLater) return null; throw err; });
      if (logo && (!best || logo.w > best.w)) best = logo;
    }
    if (!best) {
      const data = links.find((l) => l.data);
      if (data) best = await keepImage(Buffer.from(data.data.replace(/^data:image\/png;base64,/i, ''), 'base64'), 'data:' + hash(data.data)).catch(() => null);
    }
    icon = best;
  }
  const out = { ok, status: page.status, icon };
  await writeCache('appsite', ck, out).catch(() => {});
  return out;
}

/* ---------------- the AI's candidates ---------------- */

const APPS_SYSTEM = `You suggest apps and websites where a learner can practise, hands-on, what one lesson of an online course teaches.
Return ONLY a JSON object (no prose, no code fences) shaped like this:
{"apps": [{"name": "Krita", "url": "https://krita.org/", "what": "...", "free": true, "platforms": ["android", "windows"], "steps": ["...", "...", "..."]}]}
Rules:
- Suggest an app only when doing this lesson's skill in it genuinely helps: drawing or painting, geometry and graphing, writing and running code, music notation or recording, 3D modelling, electronics and circuits, flashcards for vocabulary, the night sky, maps, chess, touch typing, spreadsheets, and the like. A lesson that is mostly reading, history, ideas, facts or discussion gets {"apps": []}, and so does a hands-on skill done with real tools and materials (cooking, carpentry, sewing, sport) when no app genuinely trains it. Never suggest a general tool (a web browser, a search engine, a notes app, a video site, a chatbot, an encyclopedia), and suggest a spreadsheet, word processor or calculator only for a lesson about using one.
- At most 3, best first. Only real, well-known apps that exist today, each with the address of its official website's home page (https). Never guess an address; leave out an app whose address you are not sure of.
- Prefer free and open-source apps, and ones that work on an Android phone or in a web browser: many learners only have a phone.
- platforms: any of "android", "ios", "windows", "mac", "linux", "web".
- what: one sentence saying what the app is, at most 20 words.
- steps: 2 or 3 short, concrete steps for practising THIS lesson in it (what to open, what to make or try), each at most 25 words.
- Write "what" and "steps" in the lesson's language; keep the app's name as it is.`;

const plain = (html) => oneLine(String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), 2000);

function candidatesUser(meta, me, n, lesson, langName) {
  return [
    `Course: "${oneLine(meta.title || meta.topic, 120)}", on ${oneLine(meta.topic, 120)}.`,
    `Lesson ${n}: "${oneLine(me.title, 140)}"${me.desc ? ` — ${oneLine(me.desc, 300)}` : ''}`,
    `The lesson is written in ${langName}.`,
    '',
    'The lesson\'s parts:',
    ...lesson.sections.map((s, i) => `Part ${i + 1}: ${oneLine(s.title, 90)}${(s.recap || []).length ? ` — ${s.recap.slice(0, 3).map((r) => oneLine(plain(r), 140)).join('; ')}` : ''}`)
  ].join('\n');
}

async function candidates(meta, me, n, lesson, langName) {
  const parts = lesson.sections.map((s) => [oneLine(s.title, 90), ...(s.recap || []).slice(0, 3).map((r) => oneLine(plain(r), 140))]);
  const ck = { v: 2, lang: meta.lang || 'en', title: oneLine(me.title, 140).toLowerCase(), topic: oneLine(meta.topic, 120).toLowerCase(), parts: hash(JSON.stringify(parts)).slice(0, 16) };
  const out = await cached('apps-pick', ck, async () => {
    const { value, model } = await askJSON({
      system: APPS_SYSTEM,
      user: candidatesUser(meta, me, n, lesson, langName),
      maxTokens: 1500, timeoutMs: 45_000, deadlineMs: 90_000,
      label: `apps for lesson ${n} "${oneLine(me.title, 60)}"`,
      validate: (raw) => {
        if (!raw || !Array.isArray(raw.apps)) throw new Error('no "apps" in the reply');
        return raw.apps.slice(0, 4).map((a) => ({
          name: oneLine(a && a.name, 40),
          url: oneLine(a && a.url, 300),
          what: oneLine(a && a.what, 220),
          free: a && a.free === true,
          platforms: (Array.isArray(a && a.platforms) ? a.platforms : []).map((p) => String(p).toLowerCase()).filter((p) => PLATFORMS.includes(p)),
          steps: (Array.isArray(a && a.steps) ? a.steps : []).map((s) => oneLine(s, 240)).filter(Boolean).slice(0, 3)
        })).filter((a) => a.name && a.url && a.steps.length >= 2);
      }
    });
    return { apps: value, model };
  });
  return out.apps || [];
}

/* ---------------- the whole check ---------------- */

const order = (a) => (a.free ? 4 : 0) + (a.oss ? 2 : 0) + (a.platforms.includes('android') || a.platforms.includes('web') ? 3 : 0);

// -> { status: 'found' | 'none', list: [{ name, url, host, icon, what, free, oss, platforms, steps, known }] }
// Throws RetryLater when Wikimedia asked Primer to wait or the AI couldn't answer (nothing is kept then).
export function findApps({ meta, me, n, lesson, langName }) {
  const k = `apps|${meta.lang || 'en'}|${me.title}|${hash(JSON.stringify(lesson.sections.map((s) => s.title)))}`;
  return once(k, async () => {
    let cands;
    try { cands = await candidates(meta, me, n, lesson, langName); } catch (err) { throw new RetryLater(`the AI couldn’t suggest apps (${oneLine(err.message, 100)})`); }
    const list = [];
    for (const c of cands) {
      if (list.length >= 3) break;
      const url = httpsURL(c.url);
      if (!url) continue;
      const known = fromCatalog(c.name, url);
      let app;
      if (known) {
        app = { name: known.name, url: known.url, wiki: known.wiki, free: known.free, oss: known.oss, platforms: known.platforms.slice(), known: true };
      } else {
        const page = await wikiKnows(c.name, url);
        if (!page) { console.log(`[apps] "${c.name}" (${url.hostname}) left out: no Wikipedia article about software links to that site`); continue; }
        app = {
          name: c.name, url: url.origin + (url.pathname === '/' ? '/' : url.pathname), wiki: page.title, free: page.free, oss: page.oss,
          platforms: page.platforms.length ? page.platforms : c.platforms, known: false
        };
      }
      if (list.some((a) => a.url === app.url || key(a.name) === key(app.name))) continue;
      const site = await siteAndIcon(app);
      if (!site.ok) { console.log(`[apps] "${app.name}" left out: ${app.url} didn’t answer (${site.status || 'no connection'})`); continue; }
      list.push({
        name: app.name, url: app.url, host: bareHost(new URL(app.url).hostname), icon: site.icon ? site.icon.src : null,
        what: c.what, free: app.free, oss: app.oss, platforms: PLATFORMS.filter((p) => app.platforms.includes(p)), steps: c.steps, known: app.known
      });
    }
    list.sort((a, b) => order(b) - order(a));
    return { status: list.length ? 'found' : 'none', list, at: Date.now() };
  });
}

export { CATALOG };
