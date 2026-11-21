# Primer

**Type a topic. Get a whole course.**

Primer turns one topic into a full course. You name the subject, say where to start and stop, and how you like to be taught. Primer plans the lessons in the order to learn them, writes each lesson the first time you open it, and checks that you understood each part before the next one opens.

![A Primer lesson: the course in a sidebar, a parchment page with typeset maths and an “explain like I’m 5” callout](pitch/img/lesson.webp)

## What it does

- **Plans a course from one topic.** Topic, an optional range (“from limits to the chain rule”) and teaching instructions (LaTeX, mnemonics, worked examples, “teach me like I’m 5”). The outline is as long as the range needs.
- **Writes each lesson when you open it**, with typeset maths (KaTeX), worked examples, callouts and diagrams, then keeps it.
- **Checks you as you go.** Every part of a lesson ends with a checkpoint, and the next part isn’t on the page until you answer. A wrong answer brings back that part’s key points; a second miss adds a hint; a third lets you see the answer.
- **Doubts where they happen.** Select a sentence, or circle something on the whiteboard, and ask. The tutor answers using that part of the lesson.
- **A tutor that remembers.** A conversation on every page that knows your courses, your doubts and the questions you got wrong, so it can point out a pattern.
- **A notebook beside every lesson**: lined pages that save as you write, a sketch page, and every note in the course in one place. Drawings on the lesson are saved too.
- **Lessons read aloud** by ElevenLabs, with maths spoken as words, plus sound effects and speaking a doubt instead of typing it.
- **English, Hindi and Russian.** The interface is translated, new courses are written in your language, and a lesson written in another language can be translated with one click (maths, answers and your progress stay put).
- **Folders.** Group courses on shelves, add many topics at once, and get a quiet note when a topic doesn’t seem to fit its folder.
- **A shared topic library.** One general course per subject: a later request for the same or a synonymous topic reuses its lessons, cut to your range, so they open at once.
- **A community board.** Share the sources you learn from, with photos and links; threaded comments and votes. Anyone can read; sign in to take part.
- **Read a course as a book**, save it as a PDF, or download it as an EPUB with real maths.
- **Accounts that keep everything**: courses, progress, notes, doubts and the tutor’s memory follow you to any device.

## Running it

You need [Node.js](https://nodejs.org) **24.7 or newer** (Primer uses Node’s built-in SQLite and argon2id). There is nothing to install: Primer has no npm dependencies.

```bash
git clone https://github.com/Dx-Alz-xD/primer.git
cd primer
cp .env.example .env      # then add your OpenRouter key to .env
npm start
```

Open http://127.0.0.1:5173 and sign up. The invite code is set by `INVITE_CODE` in `.env` (the example uses `PRIMER`; leave it empty to let anyone sign up).

### Settings (`.env`)

| Setting | What it does |
| --- | --- |
| `OPENROUTER_API_KEY` | Your [OpenRouter](https://openrouter.ai) key. Plans courses, writes lessons, runs the tutor. |
| `OPENROUTER_MODELS` | Models to try, in order. A busy or failing model hands over to the next. |
| `INVITE_CODE` | The code sign-up asks for. Empty means open sign-up. |
| `ELEVENLABS_API_KEY` | Turns on narration, sound effects and spoken doubts. |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Optional: another voice or model. |
| `PORT`, `HOST` | Where the server listens (default `127.0.0.1:5173`). |

## How it’s built

- **Front end:** plain HTML, CSS and JavaScript. No framework and no build step. KaTeX for maths, a WebGL2 letter backdrop, canvas whiteboards.
- **Server:** Node.js 24 with `node:http` and **zero npm dependencies**. Each feature is a small module in `server/` that adds its routes.
- **Data:** one SQLite file (`data/primer.db`) through the built-in `node:sqlite`.
- **AI:** OpenRouter’s free models, tried in order. Every reply is repaired (LaTeX and JSON escaping), checked against the lesson format, and cached, so the same lesson is never written twice.
- **Voice:** ElevenLabs text to speech, sound generation and speech to text, cached in `data/audio`.

### Security

- Passwords are hashed with **argon2id** (19 MiB memory, 2 passes, 1 lane: OWASP’s settings) through `node:crypto`, stored as PHC strings.
- Sessions are random 256-bit tokens in `HttpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS). Only their SHA-256 is stored.
- Sign-in, sign-up and the AI endpoints are rate limited. Sign-in gives the same answer for an unknown email and a wrong password, and takes the same time.
- State-changing requests from other sites are refused (Origin check). Every page has a strict Content Security Policy with a per-request nonce.
- AI-written HTML is cleaned against an allow-list every time it is shown.
- The server binds to `127.0.0.1` unless you set `HOST`, and never serves `.env`, server code or the database.

## Project layout

```
index.html, auth.html, app.html, lesson.html   pages
community.html, post.html, book.html            community board, one post, the book reader
assets/js, assets/css                           front end (one file per feature)
assets/i18n                                     interface translations (Hindi, Russian)
server/index.mjs                                HTTP server, pages, security headers
server/auth.mjs                                 accounts and sessions (argon2id)
server/data.mjs                                 courses, lessons, progress, notes, doubts
server/ai.mjs                                   OpenRouter: plan, write, translate, repair, check, cache
server/tutor.mjs                                doubt answers and the tutor
server/voice.mjs                                ElevenLabs narration, sound effects, speech to text
server/folders.mjs, server/library.mjs          folders and the shared topic library
server/community.mjs                            posts, comments, votes, photos
server/ebook.mjs, server/translate.mjs          the book view, lesson translation
server/features.mjs                             the list of feature modules
pitch/index.html                                the pitch deck
```

## Pitch deck

`pitch/index.html` is the pitch, built as a web page with live parts: a working checkpoint and a replay of a real server log. Open it in a browser. Arrow keys move between slides, `N` shows speaker notes, `G` shows all slides and `F` goes full screen.
