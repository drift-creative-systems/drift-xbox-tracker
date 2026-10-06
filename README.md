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
- **Private by design.** Your library lives in your browser. The API key lives on your own Cloudflare Worker
- **Backup and restore.** Export your whole library as JSON and restore it on another device

---

## How It Works

```
Browser (static app, localStorage)
   │  Authorization: Bearer <ACCESS_TOKEN>
   ▼
Cloudflare Worker (worker/)  ── holds OPENXBL_KEY
   ├──► xbl.io/api/v2/achievements, /account
   └──► trueachievements.com/game/<slug>/walkthrough
```

The app can't call OpenXBL or TrueAchievements directly. Browsers block those cross-origin requests, and the API key would be exposed. The Worker is a small proxy that only answers your origin and your token.

---

## Setup

### 1. Get an OpenXBL key

Sign in at [xbl.io](https://xbl.io) with your Xbox account and copy your personal API key. The free tier is plenty, because one sync uses two calls.

### 2. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put OPENXBL_KEY      # paste the xbl.io key
npx wrangler secret put ACCESS_TOKEN     # any long random string; you'll paste it into the app
```

Edit `ALLOWED_ORIGINS` in `worker/wrangler.toml` to include the URL you'll host the app on (comma separated), then run:

```bash
npm run deploy
```

Note the `*.workers.dev` URL it prints.

### 3. Host the app

It's all static files. Serve the repo root (minus `worker/` and `legacy/`) from any static host: Cloudflare Pages, Netlify, GitHub Pages or plain hosting.

To run it locally:

```bash
python -m http.server 8080      # or: npx serve .
```

ES modules need a server context. Opening `index.html` as a `file://` URL won't work.

### 4. Connect

1. Open the app, then go to **Settings**.
2. Paste the Worker URL and access token, then click **Save & test connection**.
3. Optional: add your TrueAchievements gamer ID so achievement links show your progress.
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
| Storage | Browser `localStorage` (`dxt_` prefix) |
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
│   ├── store.js            — localStorage persistence, backup/restore
│   ├── match.js            — Name normalisation, TA URLs, title matching
│   ├── api.js              — Worker client
│   ├── sync.js             — Xbox sync + TA walkthrough batch
│   └── importer.js         — CSV parser + Google Sheet import
├── assets/
│   ├── favicon.svg         — Drift submark
│   └── apple-touch-icon.png
├── worker/
│   ├── src/index.js        — Cloudflare Worker proxy
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

- Your library, notes and settings are stored only in this browser's `localStorage`
- The access token is stored in the browser and left out of backup files
- The OpenXBL key never reaches the browser
- The Worker stores nothing. It only relays requests from origins you've allowed
- **Settings → Delete all local data** wipes everything from the browser

Clearing your browser's site data deletes your library, so export a backup first.

---

## Part of Drift

Drift: Xbox Tracker is one product in the Drift ecosystem by [Gak Design](https://gakdesign.co.uk) / [The Bonsai Digital Collective](https://bonsaidigital.co.uk).

Xbox is a trademark of Microsoft. This project is not affiliated with or endorsed by Microsoft, OpenXBL or TrueAchievements.
