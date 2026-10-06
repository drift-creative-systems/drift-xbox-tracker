# Bonsai Xbox Tracker

Replaces the "Games to Play / Complete" sheet. Pulls every game on your Xbox account with gamerscore and achievement progress, matches each one to its TrueAchievements walkthrough, and shows it all on any page with `[xbox_tracker]`.

## Setup

1. Sign in at https://xbl.io with your Xbox account and copy your personal API key (free tier is plenty — one sync uses two calls).
2. Upload and activate the plugin.
3. Settings → Xbox Tracker: paste the key, add TA gamer ID `658010` so achievement links show your progress, save.
4. Export the Google Sheet as CSV (File → Download → CSV) and import it. Do this before the first sync so your hand-picked TA links and notes are in place.
5. Click "Sync from Xbox". After that it runs hourly via WP-Cron.
6. Add `[xbox_tracker]` to a page. Private to admins by default; switch to public in settings if you want to show it off.

## How matching works

Xbox titles are matched to your imported list by title ID, then normalised name ("Assassin's Creed® Odyssey" = "Assassins Creed Odyssey"), then by the slug inside your saved TA URL (catches "Bladerunner" vs "Blade Runner: Enhanced Edition"). Anything unmatched from the sheet stays as a backlog entry flagged "On my list".

## TrueAchievements

TA has no public API. The plugin builds TA's URL slug from the game name and checks `/walkthrough` a few games per sync (rechecked every 30 days). Results:

- **Walkthrough** (pink) — walkthrough page confirmed.
- **Achievement guide** — game found, no walkthrough; links to the achievements page.
- **Find on TrueAchievements** — couldn't confirm (odd slug, or TA's Cloudflare blocked the check); links to a TA search.

Links you set manually (from the import or the inline editor) are never overwritten. Clear the field to hand a game back to auto-detection, or hit "Check TrueAchievements again".

If your host's IP gets challenged by Cloudflare, every check will land in the third state — set the batch size to 0 and rely on manual links plus search fallbacks.

## Files

- `inc/class-xbt-api.php` — OpenXBL client
- `inc/class-xbt-sync.php` — hourly sync
- `inc/class-xbt-ta.php` — TA slug + walkthrough detection
- `inc/class-xbt-import.php` — Google Sheet CSV import
- `inc/class-xbt-admin.php` — settings page
- `inc/class-xbt-frontend.php` — shortcode, inline editing (AJAX)
- `assets/` — CSS (Bonsai palette) and jQuery
