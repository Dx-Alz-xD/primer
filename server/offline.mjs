// =====================================================================
// Primer as an installable app that keeps working with no connection.
//
//   GET /sw.js                  the service worker (assets/js/sw.js). It is
//                               served from the root so its scope is the
//                               whole site, not just /assets/js/.
//   GET /manifest.webmanifest   the web app manifest (name, colours, icons)
//
// Everything else happens in the browser: assets/js/sw.js keeps pages,
// files and downloaded courses on the device and holds saves made
// offline until the connection is back; assets/js/offline.js is the
// page side (registering it, "Download for offline", the offline banner).
// =====================================================================
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './db.mjs';
import { send } from './http.mjs';

const SW_FILE = path.join(ROOT, 'assets', 'js', 'sw.js');
let swCache = null;
// Other features add their own service worker code after sw.js (study.mjs: notifications and the
// background check for reminders): paths under assets/js/, each wrapped so its names stay its own.
export const swParts = [];

// What the service worker itself may fetch: this site, KaTeX and the fonts the pages use.
// It loads its course-file helpers from this site (importScripts).
const SW_CSP = "default-src 'none'; script-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com";

const MANIFEST = JSON.stringify({
  id: '/app.html',
  name: 'Primer',
  short_name: 'Primer',
  description: 'Type a topic, get a whole course. Download a course to keep learning with no internet.',
  start_url: '/app.html',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#120b06',
  theme_color: '#120b06',
  lang: 'en',
  dir: 'ltr',
  categories: ['education', 'books'],
  icons: [
    { src: '/assets/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/assets/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/assets/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
}, null, 2);

async function serviceWorker({ req, res }) {
  let js = process.env.NODE_ENV === 'production' ? swCache : null;
  if (!js) {
    try {
      js = [await readFile(SW_FILE, 'utf8'), ...await Promise.all(swParts.map((f) => readFile(path.join(ROOT, 'assets', 'js', f), 'utf8')))].join('\n');
    } catch { return send(res, 404, 'Not found'); }
    swCache = js;
  }
  send(res, 200, req.method === 'HEAD' ? undefined : js, 'text/javascript; charset=utf-8', {
    'Service-Worker-Allowed': '/',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': SW_CSP,
    'Referrer-Policy': 'same-origin'
  });
}

async function manifest({ req, res }) {
  send(res, 200, req.method === 'HEAD' ? undefined : MANIFEST, 'application/manifest+json; charset=utf-8', {
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'same-origin'
  });
}

export const routes = [
  ['GET', /^\/sw\.js$/, serviceWorker, 'raw'],
  ['GET', /^\/manifest\.webmanifest$/, manifest, 'raw']
];
