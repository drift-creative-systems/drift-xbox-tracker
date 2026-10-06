/**
 * The login session. This is the only thing the app keeps in the browser:
 * sessionStorage by default (gone when the tab closes), localStorage when
 * "Keep me logged in" is ticked. If storage is blocked it lives in memory.
 */

const KEY = 'dxt_session';
const STORAGES = ['sessionStorage', 'localStorage'];

let memory = null;

const isValid = (s) => Boolean(s && 'string' === typeof s.token && s.token && Date.parse(s.expires) > Date.now());

export function getToken() {
	if (isValid(memory)) {
		return memory.token;
	}
	for (const name of STORAGES) {
		try {
			const s = JSON.parse(window[name].getItem(KEY) || 'null');
			if (isValid(s)) {
				return s.token;
			}
		} catch {
			// Storage blocked or value corrupt — try the next one.
		}
	}
	return '';
}

export const isLoggedIn = () => Boolean(getToken());

/**
 * @param {{ token: string, expires: string }} session From /api/login.
 * @param {boolean} remember Keep the session after the browser closes.
 */
export function saveSession({ token, expires }, remember) {
	clearSession();
	const session = { token: String(token || ''), expires: String(expires || '') };
	try {
		window[remember ? 'localStorage' : 'sessionStorage'].setItem(KEY, JSON.stringify(session));
	} catch {
		memory = session;
	}
}

export function clearSession() {
	memory = null;
	for (const name of STORAGES) {
		try {
			window[name].removeItem(KEY);
		} catch {
			// Nothing to clear.
		}
	}
}
