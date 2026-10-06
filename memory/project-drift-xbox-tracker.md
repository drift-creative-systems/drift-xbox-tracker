---
name: project-drift-xbox-tracker
description: Architecture, decisions, constraints and current state of Drift: Xbox Tracker
metadata:
  type: project
---

Drift: Xbox Tracker is a static ES-module SPA plus a Cloudflare Worker proxy. It replaces the Bonsai Xbox Tracker WordPress plugin v1.0.0 (kept in `legacy/wp-plugin/`). It's Ben's personal Xbox library tracker and the replacement for the "Games to Play / Complete" Google Sheet.

**Why:** On 2026-10-06 Ben chose to rebuild it as a Drift ecosystem app rather than keep it as a WP plugin. He picked "Static SPA + tiny proxy" over a pure SPA, because the browser can't call OpenXBL safely or scrape TrueAchievements (CORS), and over a rebranded WP plugin.

**How to apply:** Keep the app no-build, no-framework and no-jQuery, matching the other Drift Suite apps such as CardioTrack. Anything that needs a server goes in `worker/`, not the client.

## Decisions (2026-10-06)

- Name: **Drift: Xbox Tracker** (Ben chose it over "Drift: Achievements" despite the Xbox trademark note; the README carries a non-affiliation line)
- Accent: electric violet `#7B61FF`, from the Drift primary gradient. `#6A4FF5` is used behind white text for AA
- Hourly WP-Cron replaced by auto-sync on open, on focus and every 15 minutes when the data is more than 60 minutes old
- Public/private visibility setting dropped. The app is personal and always editable
- Added JSON backup/restore (originally because `localStorage` was the only store)
- Login added 2026-10-06: Ben wanted data off the browser. Chose single-user password login (not multi-user, not Cloudflare Access), Cloudflare KV storage (not D1), and no local cache. The browser keeps only the session token
- TA gamer ID: 658010 (from the original plugin README)

## Constraints

- Matching order must stay title ID → nameKey → TA slug (only for rows with no title ID)
- `taManual` links are never overwritten by automatic checks
- The Worker returns `walkthrough: null` on 403/429/503 so Cloudflare challenges aren't stored as "no walkthrough"
- Secrets (`OPENXBL_KEY`, `LOGIN_PASSWORD`, `SESSION_SECRET`) only via `wrangler secret put`. `ACCESS_TOKEN` was removed when login was added
- Never save before a successful `store.load()`. Saves are rev-checked (409 on conflict)
- Local `wrangler dev` KV failed with "internal error" inside Claude's sandbox on 2026-10-06. Worker logic was verified with a Node harness instead

## Current State (2026-10-06)

- v1.0.0 released to https://github.com/drift-creative-systems/drift-xbox-tracker (public). The 2.0.0 numbering was dropped in favour of v1.0.0, with the WP plugin treated as a predecessor rather than a version. A Node smoke test of the modules and Worker passed, and it was rendered in headless Edge at desktop and 390px
- Not yet tested against the live OpenXBL API or live TrueAchievements
- App hosted at https://xbox.driftcreativesystems.co.uk/. Worker on <account>.workers.dev (Ben was deploying it on 2026-10-06)
- Login/KV change (2026-10-06, uncommitted at time of writing): `js/config.js` PRODUCTION_WORKER_URL and the KV id in `wrangler.toml` are placeholders until Ben fills them in
