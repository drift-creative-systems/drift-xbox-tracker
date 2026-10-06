/**
 * localStorage persistence. Everything lives under the `dxt_` prefix.
 * All reads/writes are wrapped — storage can be missing, full or blocked.
 */

import { isDataImage } from './match.js';

const KEYS = {
	games: 'dxt_games',
	settings: 'dxt_settings',
	profile: 'dxt_profile',
	avatar: 'dxt_avatar',
	lastSync: 'dxt_last_sync',
	lastError: 'dxt_last_error',
};

const DEFAULT_SETTINGS = {
	workerUrl: '',
	accessToken: '',
	taGamerId: '',
	taBatch: 10,
	skipApps: true,
};

export const BACKUP_VERSION = 1;

function read(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		return null === raw ? fallback : JSON.parse(raw);
	} catch {
		return fallback;
	}
}

function write(key, value) {
	try {
		if (null === value || undefined === value) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, JSON.stringify(value));
		}
	} catch {
		throw new Error('Could not save to browser storage. It may be full or blocked.');
	}
}

export function newId() {
	if (globalThis.crypto?.randomUUID) {
		return crypto.randomUUID();
	}
	return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- Games ---------- */

export function getGames() {
	const games = read(KEYS.games, []);
	return Array.isArray(games) ? games : [];
}

export function saveGames(games) {
	write(KEYS.games, games);
}

export function getGame(id) {
	return getGames().find((g) => g.id === id) || null;
}

export function updateGame(id, patch) {
	const games = getGames();
	const i = games.findIndex((g) => g.id === id);
	if (-1 === i) {
		return null;
	}
	games[i] = { ...games[i], ...patch, updated: new Date().toISOString() };
	saveGames(games);
	return games[i];
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

export function getSettings() {
	return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(settings) {
	write(KEYS.settings, { ...getSettings(), ...settings });
}

export function getProfile() {
	return read(KEYS.profile, null);
}

export function saveProfile(profile) {
	write(KEYS.profile, profile);
}

/**
 * Uploaded avatar (a resized data URL). Kept apart from the profile so a
 * sync never replaces it.
 */
export function getAvatar() {
	const avatar = read(KEYS.avatar, null);
	return isDataImage(avatar) ? avatar : null;
}

export function saveAvatar(dataUrl) {
	write(KEYS.avatar, isDataImage(dataUrl) ? dataUrl : null);
}

export function getLastSync() {
	return read(KEYS.lastSync, null);
}

export function setLastSync(iso) {
	write(KEYS.lastSync, iso);
}

export function getLastError() {
	return read(KEYS.lastError, null);
}

export function setLastError(message) {
	write(KEYS.lastError, message || null);
}

/* ---------- Backup / wipe ---------- */

/**
 * Backup excludes the access token so the file is safe to keep anywhere.
 */
export function exportBackup() {
	const { accessToken, ...settings } = getSettings();
	return {
		app: 'drift-xbox-tracker',
		version: BACKUP_VERSION,
		exported: new Date().toISOString(),
		settings,
		profile: getProfile(),
		avatar: getAvatar(),
		lastSync: getLastSync(),
		games: getGames(),
	};
}

export function restoreBackup(data) {
	if (!data || 'drift-xbox-tracker' !== data.app || !Array.isArray(data.games)) {
		throw new Error('That file is not a Drift: Xbox Tracker backup.');
	}

	const games = data.games.filter((g) => g && g.name).map(makeGame);
	saveGames(games);
	if (data.settings && 'object' === typeof data.settings) {
		const { accessToken, ...settings } = data.settings;
		saveSettings(settings);
	}
	saveProfile(data.profile || null);
	// Older backups have no avatar key — leave the current one alone.
	if ('avatar' in data) {
		saveAvatar(data.avatar);
	}
	setLastSync(data.lastSync || null);
	return games.length;
}

export function wipeAll() {
	Object.values(KEYS).forEach((k) => {
		try {
			localStorage.removeItem(k);
		} catch {
			// Nothing to clear.
		}
	});
}
