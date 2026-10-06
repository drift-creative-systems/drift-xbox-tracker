/**
 * Pull titles from Xbox, merge them into the library, then check a
 * handful of TrueAchievements walkthroughs (rechecked every 30 days).
 */

import * as api from './api.js';
import * as store from './store.js';
import { findMatch, nameKey, taSlug, taWalkthroughUrl, taAchievementsUrl } from './match.js';

const TA_RECHECK_DAYS = 30;
const TA_DELAY_MS = 1500;
const STALE_MINUTES = 60;

let running = false;

export function isRunning() {
	return running;
}

export function isStale() {
	const last = store.getLastSync();
	return !last || Date.now() - new Date(last).getTime() > STALE_MINUTES * 60 * 1000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ onStatus?: (msg: string) => void, onMerged?: () => void }} opts
 *   onStatus — progress text for the UI; onMerged — fires once Xbox data is saved,
 *   before the (slower) TrueAchievements checks start.
 * @returns {Promise<{ added: number, updated: number, checked: number }>}
 */
export async function run({ onStatus = () => {}, onMerged = () => {} } = {}) {
	if (running) {
		throw new Error('A sync is already running.');
	}
	running = true;

	try {
		onStatus('Fetching games from Xbox…');
		let titles;
		try {
			titles = await api.titles();
		} catch (err) {
			store.setLastError(err.message);
			throw err;
		}

		const { skipApps, taBatch } = store.getSettings();
		const games = store.getGames();
		const now = new Date().toISOString();
		let added = 0;
		let updated = 0;

		for (const t of titles) {
			if (!t.name) {
				continue;
			}
			// Apps (Netflix, YouTube etc.) have no achievements.
			if (skipApps && 0 === t.gsTotal && 0 === t.achTotal) {
				continue;
			}

			const fields = {
				titleId: t.titleId || null,
				image: t.image,
				platform: t.platform,
				gsCurrent: t.gsCurrent,
				gsTotal: t.gsTotal,
				achCurrent: t.achCurrent,
				achTotal: t.achTotal,
				progress: t.progress,
				lastPlayed: t.lastPlayed,
				updated: now,
			};
			if (t.progress >= 100) {
				fields.completed = true;
			}

			const match = findMatch(games, t);
			if (match) {
				// Keep the name from your imported list if you had one; it's often tidier.
				if ('xbox' === match.source) {
					fields.name = t.name;
				}
				Object.assign(match, fields);
				updated++;
			} else {
				games.push(store.makeGame({ ...fields, name: t.name, nameKey: nameKey(t.name), source: 'xbox' }));
				added++;
			}
		}

		store.saveGames(games);

		try {
			store.saveProfile(await api.profile());
		} catch {
			// Profile is cosmetic — keep the old one rather than fail the sync.
		}

		store.setLastSync(now);
		store.setLastError(null);
		onMerged();

		const checked = await checkWalkthroughs(Math.max(0, Math.min(50, taBatch | 0)), onStatus);
		return { added, updated, checked };
	} finally {
		running = false;
	}
}

/**
 * Games due a TA check: not manual, not hidden, never checked or older than 30 days.
 * Never-checked first, then most recently played.
 */
function dueForCheck(games, limit) {
	const cutoff = Date.now() - TA_RECHECK_DAYS * 24 * 60 * 60 * 1000;
	return games
		.filter((g) => !g.taManual && !g.hidden && (!g.taChecked || new Date(g.taChecked).getTime() < cutoff))
		.sort((a, b) => {
			if (!a.taChecked !== !b.taChecked) {
				return a.taChecked ? 1 : -1;
			}
			return (b.lastPlayed || '').localeCompare(a.lastPlayed || '');
		})
		.slice(0, limit);
}

async function checkWalkthroughs(limit, onStatus) {
	if (!limit) {
		return 0;
	}

	const due = dueForCheck(store.getGames(), limit);
	let checked = 0;

	for (const g of due) {
		onStatus(`Checking TrueAchievements ${checked + 1} of ${due.length}…`);
		try {
			const patch = await checkOne(g);
			// Re-read so edits made mid-sync aren't overwritten — and skip if it went manual.
			const fresh = store.getGame(g.id);
			if (fresh && !fresh.taManual) {
				store.updateGame(g.id, patch);
			}
			checked++;
		} catch {
			// One failed check shouldn't stop the batch.
		}
		if (checked < due.length) {
			await sleep(TA_DELAY_MS);
		}
	}
	return checked;
}

/**
 * Builds the TA fields for one game from the Worker's check.
 */
export async function checkOne(game) {
	const result = await api.taCheck(taSlug(game.name));
	let taUrl = null;
	if (true === result) {
		taUrl = taWalkthroughUrl(game.name);
	} else if (false === result) {
		taUrl = taAchievementsUrl(game.name);
	}
	return { taUrl, taWalkthrough: result, taManual: false, taChecked: new Date().toISOString() };
}
