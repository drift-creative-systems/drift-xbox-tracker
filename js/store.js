/**
 * Library persistence. The library is stored on the Worker (Cloudflare KV)
 * and held in memory while the app is open. Writes change memory straight
 * away and are saved to the Worker shortly after: debounced, one request at
 * a time, and never before a successful load(), so an empty in-memory
 * library can't overwrite the real one.
 *
 * The only localStorage this module touches is the pre-login library
 * (LEGACY_KEYS), read once for migration and then cleared.
 */

import * as api from './api.js';
import { isDataImage } from './match.js';

const SAVE_DELAY_MS = 800;

// Where the library lived before login was added.
const LEGACY_KEYS = ['dxt_games', 'dxt_settings', 'dxt_profile', 'dxt_avatar', 'dxt_last_sync', 'dxt_last_error'];

const DEFAULT_SETTINGS = {
	taGamerId: '',
	taBatch: 10,
	skipApps: true,
};

export const BACKUP_VERSION = 1;

let doc = emptyDoc();
let rev = 0;
let loaded = false;
let dirty = false;
let saving = null;
let timer = null;
let handlers = { onSaveError() {}, onConflict() {} };

function emptyDoc() {
	return { settings: { ...DEFAULT_SETTINGS }, profile: null, avatar: null, lastSync: null, lastError: null, games: [] };
}

const clone = (v) => (null === v || undefined === v ? null : structuredClone(v));
const isoOrNull = (v) => ('string' === typeof v && v ? v : null);

function cleanSettings(s) {
	const src = s && 'object' === typeof s ? s : {};
	const batch = parseInt(src.taBatch, 10);
	return {
		taGamerId: String(src.taGamerId ?? '').replace(/[^0-9]/g, ''),
		taBatch: Number.isFinite(batch) ? Math.max(0, Math.min(50, batch)) : DEFAULT_SETTINGS.taBatch,
		skipApps: 'boolean' === typeof src.skipApps ? src.skipApps : DEFAULT_SETTINGS.skipApps,
	};
}

/**
 * Cleans a library document from the Worker, a backup or the legacy store.
 */
function normalise(data) {
	const d = data && 'object' === typeof data ? data : {};
	return {
		settings: cleanSettings(d.settings),
		profile: d.profile && 'object' === typeof d.profile ? d.profile : null,
		avatar: isDataImage(d.avatar) ? d.avatar : null,
		lastSync: isoOrNull(d.lastSync),
		lastError: 'string' === typeof d.lastError && d.lastError ? d.lastError : null,
		games: Array.isArray(d.games) ? d.games.filter((g) => g && g.name).map(makeGame) : [],
	};
}

/* ---------- Loading & saving ---------- */

/**
 * @param {{ onSaveError?: (err: Error) => void, onConflict?: () => void }} h
 */
export function setHandlers(h) {
	handlers = { ...handlers, ...h };
}

export const isLoaded = () => loaded;
export const isEmpty = () => 0 === doc.games.length;
export const hasUnsavedChanges = () => dirty || Boolean(saving);

/**
 * Replaces memory with the library on the Worker. Unsaved changes are dropped.
 */
export async function load() {
	const r = await api.loadData();
	clearTimeout(timer);
	doc = normalise(r.data);
	rev = r.rev;
	dirty = false;
	loaded = true;
}

/**
 * Forgets the library (on log out).
 */
export function reset() {
	clearTimeout(timer);
	doc = emptyDoc();
	rev = 0;
	dirty = false;
	loaded = false;
}

function changed() {
	if (!loaded) {
		throw new Error('Your library has not loaded yet. Reload and try again.');
	}
	dirty = true;
	clearTimeout(timer);
	timer = setTimeout(() => {
		flush().catch(() => {
			// Reported through handlers.
		});
	}, SAVE_DELAY_MS);
}

/**
 * Saves now. Waits for any save already in flight, then sends the latest copy.
 * A failed save stays dirty and is retried on the next change or flush.
 */
export async function flush() {
	clearTimeout(timer);
	while (saving) {
		await saving.catch(() => {});
	}
	if (!loaded || !dirty) {
		return;
	}

	dirty = false;
	saving = api.saveData(rev, doc);
	try {
		rev = (await saving).rev;
	} catch (err) {
		if (err.conflict) {
			handlers.onConflict();
		} else {
			dirty = true;
			handlers.onSaveError(err);
		}
		throw err;
	} finally {
		saving = null;
	}

	// Changes made while the request was in flight.
	if (dirty) {
		changed();
	}
}

/* ---------- Games ---------- */

export function newId() {
	if (globalThis.crypto?.randomUUID) {
		return crypto.randomUUID();
	}
	return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns a copy — callers can mutate it and pass it to saveGames().
 */
export function getGames() {
	return clone(doc.games);
}

export function saveGames(games) {
	doc.games = clone(Array.isArray(games) ? games : []);
	changed();
}

export function getGame(id) {
	return clone(doc.games.find((g) => g.id === id) || null);
}

export function updateGame(id, patch) {
	const i = doc.games.findIndex((g) => g.id === id);
	if (-1 === i) {
		return null;
	}
	doc.games[i] = { ...doc.games[i], ...clone(patch), updated: new Date().toISOString() };
	changed();
	return clone(doc.games[i]);
}

/**
 * Shape of a game record. Unknown fields are dropped so restores stay clean.
 */
export function makeGame(data) {
	return {
		id: data.id || newId(),
		titleId: data.titleId || null,
		name: String(data.name || ''),
		nameKey: String(data.nameKey || ''),
		image: data.image || '',
		platform: data.platform || '',
		gsCurrent: data.gsCurrent | 0,
		gsTotal: data.gsTotal | 0,
		achCurrent: data.achCurrent | 0,
		achTotal: data.achTotal | 0,
		progress: Math.max(0, Math.min(100, data.progress | 0)),
		lastPlayed: data.lastPlayed || null,
		taUrl: data.taUrl || null,
		taWalkthrough: 'boolean' === typeof data.taWalkthrough ? data.taWalkthrough : null,
		taChecked: data.taChecked || null,
		taManual: Boolean(data.taManual),
		completed: Boolean(data.completed),
		onList: Boolean(data.onList),
		hidden: Boolean(data.hidden),
		notes: String(data.notes || ''),
		source: 'list' === data.source ? 'list' : 'xbox',
		updated: data.updated || new Date().toISOString(),
	};
}

/* ---------- Settings, profile, sync status ---------- */

/**
 * Sets a top-level value, skipping the save when nothing changed.
 */
function setValue(key, value) {
	if (doc[key] === value) {
		return;
	}
	doc[key] = value;
	changed();
}

export function getSettings() {
	return { ...doc.settings };
}

export function saveSettings(settings) {
	doc.settings = cleanSettings({ ...doc.settings, ...settings });
	changed();
}

export function getProfile() {
	return clone(doc.profile);
}

export function saveProfile(profile) {
	doc.profile = profile && 'object' === typeof profile ? clone(profile) : null;
	changed();
}

/**
 * Uploaded avatar (a resized data URL). Kept apart from the profile so a
 * sync never replaces it.
 */
export function getAvatar() {
	return doc.avatar;
}

export function saveAvatar(dataUrl) {
	setValue('avatar', isDataImage(dataUrl) ? dataUrl : null);
}

export function getLastSync() {
	return doc.lastSync;
}

export function setLastSync(iso) {
	setValue('lastSync', isoOrNull(iso));
}

export function getLastError() {
	return doc.lastError;
}

export function setLastError(message) {
	setValue('lastError', message || null);
}

/* ---------- Backup / wipe ---------- */

export function exportBackup() {
	return {
		app: 'drift-xbox-tracker',
		version: BACKUP_VERSION,
		exported: new Date().toISOString(),
		settings: getSettings(),
		profile: getProfile(),
		avatar: getAvatar(),
		lastSync: getLastSync(),
		games: getGames(),
	};
}

/**
 * Replaces the library with a backup. Old backups may carry workerUrl or
 * accessToken in settings; cleanSettings() drops them.
 */
export function restoreBackup(data) {
	if (!data || 'drift-xbox-tracker' !== data.app || !Array.isArray(data.games)) {
		throw new Error('That file is not a Drift: Xbox Tracker backup.');
	}

	const next = normalise({
		...data,
		settings: { ...doc.settings, ...(data.settings && 'object' === typeof data.settings ? data.settings : {}) },
		// Older backups have no avatar key — leave the current one alone.
		avatar: 'avatar' in data ? data.avatar : doc.avatar,
		lastError: null,
	});
	doc = next;
	changed();
	return next.games.length;
}

/**
 * Empties the library on the Worker.
 */
export async function wipeAll() {
	doc = emptyDoc();
	changed();
	await flush();
}

/* ---------- Pre-login migration ---------- */

function readLegacy(key) {
	try {
		return JSON.parse(localStorage.getItem(key) || 'null');
	} catch {
		return null;
	}
}

/**
 * The library this browser held before login existed, shaped as a backup,
 * or null if there isn't one.
 */
export function readLegacyBackup() {
	const games = readLegacy('dxt_games');
	if (!Array.isArray(games) || !games.length) {
		return null;
	}
	return {
		app: 'drift-xbox-tracker',
		version: BACKUP_VERSION,
		settings: readLegacy('dxt_settings'),
		profile: readLegacy('dxt_profile'),
		avatar: readLegacy('dxt_avatar'),
		lastSync: readLegacy('dxt_last_sync'),
		games,
	};
}

export function clearLegacy() {
	LEGACY_KEYS.forEach((k) => {
		try {
			localStorage.removeItem(k);
		} catch {
			// Nothing to clear.
		}
	});
}
