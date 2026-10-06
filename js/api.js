/**
 * Client for the Cloudflare Worker (worker/src/index.js).
 * A 401 on an authenticated call clears the session and fires
 * `dxt:logged-out` on window so the app can show the login screen.
 */

import { WORKER_URL } from './config.js';
import * as auth from './auth.js';

const TIMEOUT_MS = 30000;

function loggedOut() {
	auth.clearSession();
	window.dispatchEvent(new CustomEvent('dxt:logged-out'));
}

async function request(path, { method = 'GET', body, authed = true } = {}) {
	if (!WORKER_URL || WORKER_URL.includes('YOUR-SUBDOMAIN')) {
		throw new Error('Set your Worker URL in js/config.js.');
	}

	const headers = {};
	if (authed) {
		const token = auth.getToken();
		if (!token) {
			loggedOut();
			throw new Error('Log in to continue.');
		}
		headers.Authorization = `Bearer ${token}`;
	}
	if (undefined !== body) {
		headers['Content-Type'] = 'application/json';
	}

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

	let res;
	try {
		res = await fetch(WORKER_URL + path, {
			method,
			headers,
			body: undefined === body ? undefined : JSON.stringify(body),
			signal: ctrl.signal,
		});
	} catch (err) {
		throw new Error('AbortError' === err.name ? 'The Worker took too long to respond.' : 'Could not reach the Worker. Check js/config.js and ALLOWED_ORIGINS.');
	} finally {
		clearTimeout(timer);
	}

	let data = null;
	try {
		data = await res.json();
	} catch {
		// Fall through to the status check.
	}

	if (401 === res.status && authed) {
		loggedOut();
	}
	if (409 === res.status) {
		const err = new Error(data?.error || 'Your library was changed on another device.');
		err.conflict = true;
		throw err;
	}
	if (!res.ok || !data) {
		throw new Error(data?.error || `Worker returned HTTP ${res.status}.`);
	}
	return data;
}

/**
 * @returns {Promise<{ token: string, expires: string }>}
 */
export function login(password, remember) {
	return request('/api/login', { method: 'POST', body: { password, remember: Boolean(remember) }, authed: false });
}

export function health() {
	return request('/api/health');
}

export async function titles() {
	const body = await request('/api/titles');
	return Array.isArray(body.titles) ? body.titles : [];
}

export function profile() {
	return request('/api/profile');
}

/**
 * @returns {Promise<boolean|null>} true walkthrough, false no walkthrough, null unknown
 */
export async function taCheck(slug) {
	const body = await request(`/api/ta?slug=${encodeURIComponent(slug)}`);
	return 'boolean' === typeof body.walkthrough ? body.walkthrough : null;
}

/**
 * @returns {Promise<{ rev: number, data: object|null }>}
 */
export async function loadData() {
	const body = await request('/api/data');
	return { rev: body.rev | 0, data: body.data && 'object' === typeof body.data ? body.data : null };
}

/**
 * Throws an error with `conflict: true` if another device saved since `rev`.
 *
 * @returns {Promise<{ rev: number }>}
 */
export async function saveData(rev, data) {
	const body = await request('/api/data', { method: 'PUT', body: { rev, data } });
	return { rev: body.rev | 0 };
}
