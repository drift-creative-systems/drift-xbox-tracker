/**
 * Client for the Cloudflare Worker proxy (worker/src/index.js).
 */

import { getSettings } from './store.js';

const TIMEOUT_MS = 30000;

async function request(path) {
	const { workerUrl, accessToken } = getSettings();
	if (!workerUrl || !accessToken) {
		throw new Error('Add your Worker URL and access token in Settings.');
	}

	const base = workerUrl.replace(/\/+$/, '');
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

	let res;
	try {
		res = await fetch(base + path, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: ctrl.signal,
		});
	} catch (err) {
		throw new Error('AbortError' === err.name ? 'The Worker took too long to respond.' : 'Could not reach the Worker. Check the URL and ALLOWED_ORIGINS.');
	} finally {
		clearTimeout(timer);
	}

	let body = null;
	try {
		body = await res.json();
	} catch {
		// Fall through to the status check.
	}

	if (!res.ok || !body) {
		throw new Error(body?.error || `Worker returned HTTP ${res.status}.`);
	}
	return body;
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
