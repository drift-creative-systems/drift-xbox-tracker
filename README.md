# Drift: Xbox Tracker

Every game on your Xbox account in one place, with gamerscore, achievement progress, and a link to the right TrueAchievements walkthrough. It replaces the "Games to Play / Complete" spreadsheet.

Part of the **Drift** ecosystem · Creative Systems.

---

## Features

- **Full library sync.** Every title on your Xbox account with gamerscore, achievement count, completion % and last played date, pulled from [OpenXBL](https://xbl.io)
- **TrueAchievements matching.** Each game is checked for a TA walkthrough (rechecked every 30 days) and linked as *Walkthrough*, *Achievement guide* or *Find on TrueAchievements*
- **Your backlog kept.** Import the old Google Sheet. Games you haven't started stay on the list as "On my list", and your hand-picked TA links and notes are never overwritten
- **Smart matching.** Xbox titles match your list by title ID, then by normalised name ("Assassin's Creed® Odyssey" = "Assassins Creed Odyssey"), then by the slug in your saved TA link ("Bladerunner" → "Blade Runner: Enhanced Edition")
- **Filter and sort.** Played this month, in progress, not started, completed, has walkthrough, on my list, hidden. Sort by last played, name, completion or gamerscore left
- **Inline editing.** Set a TA link, add notes, and mark games completed, on your list or hidden
- **Auto-sync.** Syncs when you open the app if the last sync is more than an hour old
- **Log in anywhere.** Password login. Your library is stored on your own Cloudflare Worker (KV), not in the browser, so it's the same on every device
- **Private by design.** The API key and your library live on your own Cloudflare Worker. The browser only keeps your login session
- **Backup and restore.** Export your whole library as JSON and restore it at any time

---

## How It Works

```
Browser (static app, library held in memory)
   │  POST /api/login (password) → session token
   │  Authorization: Bearer <session token>
   ▼
Cloudflare Worker (worker/)  ── holds OPENXBL_KEY, LOGIN_PASSWORD, SESSION_SECRET
   ├──► KV namespace DXT_DATA   (your library: GET/PUT /api/data)
   ├──► xbl.io/api/v2/achievements, /account
   └──► trueachievements.com/game/<slug>/walkthrough
```

The app can't call OpenXBL or TrueAchievements directly. Browsers block those cross-origin requests, and the API key would be exposed. The Worker is a small proxy and store that only answers your origin and a valid login session.

---

## Setup

### 1. Get an OpenXBL key

Sign in at [xbl.io](https://xbl.io) with your Xbox account and copy your personal API key. The free tier is plenty, because one sync uses two calls.

### 2. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login

# Create the KV namespace that stores your library,
# then paste the id it prints into worker/wrangler.toml
npx wrangler kv namespace create DXT_DATA

npx wrangler secret put OPENXBL_KEY      # your OpenXBL key
npx wrangler secret put LOGIN_PASSWORD   # the password you'll log into the app with
npx wrangler secret put SESSION_SECRET   # any long random string; signs login sessions
```

Edit `ALLOWED_ORIGINS` in `worker/wrangler.toml` to include the URL you'll host the app on (comma separated), then run:

```bash
npm run deploy
```

Note the `*.workers.dev` URL it prints and set it as `PRODUCTION_WORKER_URL` in `js/config.js`.

Changing `SESSION_SECRET` logs out every device. Failed logins are limited to 10 per IP every 15 minutes.

### 3. Host the app

It's all static files. Serve the repo root (minus `worker/` and `legacy/`) from any static host: Cloudflare Pages, Netlify, GitHub Pages or plain hosting.

To run it locally:

```bash
python -m http.server 8080      # or: npx serve .
```

ES modules need a server context. Opening `index.html` as a `file://` URL won't work.

On `localhost` the app talks to `http://localhost:8787` (`npm run dev` in `worker/`, with `LOGIN_PASSWORD` and `SESSION_SECRET` in `worker/.dev.vars`).

### 4. Log in and connect

1. Open the app and log in with your `LOGIN_PASSWORD`. Tick **Keep me logged in on this device** to stay logged in for 30 days; otherwise the session ends when you close the tab (or after 12 hours).
2. If this browser has a library from before login was added, the app offers to move it to your account and then removes it from the browser.
3. Optional: in **Settings**, click **Test connection** and add your TrueAchievements gamer ID so achievement links show your progress.
4. **Import your Google Sheet first** (File → Download → Comma-separated values) so your TA links and notes are in place before the first sync.
5. Click **Sync now**.

---

## TrueAchievements

TA has no public API. The Worker builds TA's URL slug from the game name and checks `/walkthrough`, a few games per sync (10 by default), with each game rechecked every 30 days.

| Link | Meaning |
|---|---|
| **Walkthrough** (violet) | Walkthrough page confirmed |
| **Achievement guide** | Game found, no walkthrough; links to the achievements page |
| **Find on TrueAchievements** | Couldn't confirm (odd slug, or TA's Cloudflare blocked the check); links to a TA search |

Links you set yourself, from the import or the editor, are never overwritten. Clear the field to hand a game back to auto-detection, or use **Check TrueAchievements again**.

If TA's Cloudflare challenges the Worker, every check lands in the third state. In that case, set **Walkthrough checks per sync** to 0 and rely on manual links and search fallbacks.

---

## Google Sheet Import

Expected columns, in order: **Done, Game, %, Walkthrough, TA URL, Notes**.

- Every imported game is flagged *On my list*
- Games already in your library are merged by name. Games that aren't are added as backlog entries
- Only `http(s)` TA links are accepted

---

## Tech Stack

| | |
|---|---|
| App | Vanilla JavaScript (ES modules), HTML5, CSS3. No framework, no build step |
| Storage | Cloudflare KV via the Worker. The browser keeps only the login session (`dxt_session`) |
| Proxy | Cloudflare Workers + Wrangler |
| Fonts | Poppins, Inter (Google Fonts) |
| Data | OpenXBL, TrueAchievements |

---

## Project Structure

```
xbox-tracker/
├── index.html              — App shell + settings dialog
├── css/
│   └── styles.css          — Drift brand tokens, layout, components
├── js/
│   ├── app.js              — Rendering, events, editor, settings, auto-sync
│   ├── store.js            — In-memory library, debounced saves to the Worker, backup/restore
│   ├── auth.js             — Login session token
│   ├── config.js           — Worker URL (local and production)
│   ├── match.js            — Name normalisation, TA URLs, title matching
│   ├── api.js              — Worker client
│   ├── sync.js             — Xbox sync + TA walkthrough batch
│   └── importer.js         — CSV parser + Google Sheet import
├── assets/
│   ├── favicon.svg         — Drift submark
│   └── apple-touch-icon.png
├── worker/
│   ├── src/index.js        — Cloudflare Worker: login, library store, proxy
│   ├── wrangler.toml
│   ├── package.json
│   └── .dev.vars.example
├── legacy/wp-plugin/       — Original Bonsai Xbox Tracker WordPress plugin (reference only)
├── memory/                 — Claude Code project memory
├── CLAUDE.md
├── CHANGELOG.md
└── README.md
```

---

## Data & Privacy

- Your library, notes and settings are stored in a KV namespace on your own Cloudflare account, behind your login
- The browser keeps only the login session token: `sessionStorage` by default, `localStorage` if you tick **Keep me logged in**. **Settings → Log out** removes it
- The password, session secret and OpenXBL key are Worker secrets and never reach the browser
- Saves carry a revision number, so a stale tab or second device can't overwrite newer changes; it reloads the latest copy instead
- **Settings → Delete all data** empties the library on the Worker

---

## Part of Drift

Drift: Xbox Tracker is one product in the Drift ecosystem by [Gak Design](https://gakdesign.co.uk) / [The Bonsai Digital Collective](https://bonsaidigital.co.uk).

Xbox is a trademark of Microsoft. This project is not affiliated with or endorsed by Microsoft, OpenXBL or TrueAchievements.
