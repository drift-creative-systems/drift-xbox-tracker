# Changelog

All notable changes to Drift: Xbox Tracker are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). This project uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- [worker/src/index.js] Password login (`POST /api/login`) issuing HMAC-signed session tokens: 12 hours by default, 30 days with "Keep me logged in". Failed logins are limited to 10 per IP per 15 minutes
- [worker/src/index.js] [worker/wrangler.toml] Library storage in Cloudflare KV (`DXT_DATA`) via `GET`/`PUT /api/data`, with a revision check that returns 409 instead of overwriting changes made on another device. Bodies over 5 MB get 413
- [index.html] [css/styles.css] [js/app.js] Login screen, "Log out" in Settings → Account, a loading state, a retry if the library fails to load, and a warning before closing the tab with an unsaved change
- [js/auth.js] Session token handling (`dxt_session` in `sessionStorage`, or `localStorage` when remembered)
- [js/config.js] Worker URL config, which uses `localhost:8787` automatically on localhost
- [js/app.js] [js/store.js] One-time migration on first login: a library left in `localStorage` by earlier versions is moved to the account and then cleared from the browser
- [index.html] [js/app.js] Avatar upload in Settings → Profile. The image is centre-cropped and resized in the browser to 256×256 WebP (JPEG fallback), and replaces the Xbox gamerpic in the hero. There's also a Remove button
- [js/store.js] `dxt_avatar` storage key, included in backup export/restore (older backups without it leave the current avatar alone)
- [js/match.js] `safeImageSrc()`, which allows raster base64 data URLs (PNG/JPEG/WebP only, no SVG) alongside https images

### Changed
- [js/store.js] The library is no longer stored in the browser. It loads from the Worker after login, is held in memory, and saves back after 800ms (debounced, one request at a time, never before a successful load)
- [js/api.js] Sends the session token instead of the shared access token. A 401 logs out and returns to the login screen without losing in-memory edits
- [index.html] [js/app.js] Settings "Connection" panel (Worker URL and access token) replaced by an "Account" panel. "Delete all local data" is now "Delete all data" and empties the library on the Worker
- [README.md] Setup covers the KV namespace, the new secrets and `js/config.js`. Also restored the missing "Deploy the Worker" heading and commands

### Removed
- [worker/] `ACCESS_TOKEN` secret, replaced by `LOGIN_PASSWORD` and `SESSION_SECRET`

### Fixed
- [worker/src/index.js] [js/match.js] Microsoft image URLs returned as `http://` by OpenXBL are upgraded to `https://`, which removes the mixed-content warnings for game covers and the gamerpic

## [1.0.0] - 2026-10-06

First release of **Drift: Xbox Tracker**, a standalone Drift ecosystem app replacing the Bonsai Xbox Tracker WordPress plugin.

### Added
- [index.html] Static single-page app shell with sticky top bar, profile hero, library controls and settings `<dialog>`
- [css/styles.css] Drift brand system: dark UI, Poppins/Inter, electric violet `#7B61FF` product accent, `#7B61FF → #1F7BFF` gradient, 8/12/16/24px radius scale, reduced-motion support
- [js/store.js] `localStorage` persistence (`dxt_` prefix) with a normalised game record, settings defaults, and JSON backup export/restore (access token excluded)
- [js/match.js] Name normalisation, TA slug/URL builders, `safeUrl` guard, and three-stage title matching (title ID → name → TA slug)
- [js/api.js] Worker client with Bearer auth, 30s timeout and readable errors
- [js/sync.js] Xbox sync with apps filter, completion auto-flag, profile refresh, and a throttled TA walkthrough batch that never overwrites manual links
- [js/importer.js] RFC 4180-style CSV parser and Google Sheet import (Done, Game, %, Walkthrough, TA URL, Notes)
- [js/app.js] Search, eight filters, four sort orders, inline editor (TA link, notes, completed / on my list / hidden), per-game TA recheck, toasts, and auto-sync on open, on tab focus and every 15 minutes when the data is over an hour old
- [worker/] Cloudflare Worker proxy: `/api/health`, `/api/titles`, `/api/profile`, `/api/ta`, with origin allow-list, constant-time token check and slug validation
- [assets/] Drift submark favicon and Apple touch icon
- [CLAUDE.md] [README.md] [CHANGELOG.md] [memory/] [.gitignore] Project documentation and repo setup

### Changed
- Platform moved from a WordPress plugin (PHP, custom DB table, WP-Cron, `[xbox_tracker]` shortcode, jQuery) to a static ES-module app with a serverless proxy
- OpenXBL key moved from `wp_options` to a Worker secret
- TA gamer ID is now applied to achievement links at render time, so changing it updates existing links
- TA walkthrough checks spaced 1.5s apart in the client (was 2s server-side `sleep`)
- Branding moved from the Bonsai palette (pink `#ee4367`) to Drift

### Removed
- WordPress plugin runtime: shortcode, admin settings page, admin-post handlers, AJAX endpoints, WP-Cron schedule
- Public/private visibility setting. The app is personal, so editing is always on

### Notes
- The original plugin is kept unchanged in `legacy/wp-plugin/` for reference. There's no automatic migration from the WordPress database. Re-import the Google Sheet CSV and run a sync.
- The Worker's `ALLOWED_ORIGINS` includes the live app at `https://xbox.driftcreativesystems.co.uk`.

---

## Predecessor: Bonsai Xbox Tracker 1.0.0 (WordPress plugin)

Not part of this project's version history; listed for context.

- OpenXBL sync of all titles with gamerscore and achievement progress, hourly via WP-Cron
- TrueAchievements walkthrough detection with search fallback
- Google Sheet CSV import
- `[xbox_tracker]` shortcode with filters, sort and admin inline editing

[Unreleased]: https://github.com/drift-creative-systems/drift-xbox-tracker/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/drift-creative-systems/drift-xbox-tracker/releases/tag/v1.0.0
