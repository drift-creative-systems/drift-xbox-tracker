/**
 * Drift: Xbox Tracker — API proxy and library store (Cloudflare Worker)
 *
 * Keeps the OpenXBL key off the client, does the TrueAchievements
 * walkthrough checks a browser can't (CORS), and stores the library in
 * Cloudflare KV so nothing lives in the browser. Every request must come
 * from an origin in ALLOWED_ORIGINS. Everything except /api/login needs a
 * session token from /api/login.
 *
 * Routes:
 *   POST /api/login          — { password, remember } → { token, expires }
 *   GET  /api/health         — session check, no upstream calls
 *   GET  /api/titles         — every title on the account with achievement progress
 *   GET  /api/profile        — gamertag, gamerscore, avatar
 *   GET  /api/ta?slug=<slug> — { walkthrough: true | false | null }
 *   GET  /api/data           — { rev, saved, data } (data is null before the first save)
 *   PUT  /api/data           — { rev, data } → { rev, saved }; 409 if rev is out of date
 *
 * Secrets: OPENXBL_KEY, LOGIN_PASSWORD, SESSION_SECRET.
 * Vars: ALLOWED_ORIGINS (comma separated).  KV binding: DXT_DATA.
 */

const XBL_BASE = 'https://xbl.io/api/v2/';
const TA_BASE = 'https://www.trueachievements.com';
const SLUG_PATTERN = /^[A-Za-z0-9-]{1,200}$/;

const DATA_KEY = 'library';
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const MAX_LOGIN_BYTES = 4096;
const MAX_LOGIN_FAILS = 10;
const LOGIN_LOCK_SECONDS = 15 * 60;
const SESSION_MS = 12 * 60 * 60 * 1000;
const SESSION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

const DEVICE_LABELS = {
	XboxSeries: 'Series X|S',
	XboxOne: 'Xbox One',
	Xbox360: 'Xbox 360',
	PC: 'PC',
	Win32: 'PC',
};

export default {
	async fetch(request, env) {
		const cors = corsHeaders(request, env);

		if ('OPTIONS' === request.method) {
			return new Response(null, { status: 204, headers: cors });
		}
		if (!cors['Access-Control-Allow-Origin']) {
			return json({ error: 'Origin not allowed.' }, 403, cors);
		}

		const url = new URL(request.url);
		const route = `${request.method} ${url.pathname}`;

		try {
			if ('POST /api/login' === route) {
				return await login(request, env, cors);
			}
			if (!(await sessionValid(request, env))) {
				return json({ error: 'Your session has expired. Log in again.' }, 401, cors);
			}

			switch (route) {
				case 'GET /api/health':
					return json({ ok: true, hasKey: Boolean(env.OPENXBL_KEY), hasStore: Boolean(env.DXT_DATA) }, 200, cors);
				case 'GET /api/titles':
					return json({ titles: await titles(env) }, 200, cors);
				case 'GET /api/profile':
					return json(await profile(env), 200, cors);
				case 'GET /api/ta': {
					const slug = url.searchParams.get('slug') || '';
					if (!SLUG_PATTERN.test(slug)) {
						return json({ error: 'Invalid slug.' }, 400, cors);
					}
					return json({ walkthrough: await checkWalkthrough(slug) }, 200, cors);
				}
				case 'GET /api/data':
					return json(await loadData(env), 200, cors);
				case 'PUT /api/data':
					return await saveData(request, env, cors);
				default:
					return json({ error: 'Not found.' }, 404, cors);
			}
		} catch (err) {
			if (err instanceof HttpError) {
				return json({ error: err.message }, err.status, cors);
			}
			return json({ error: err instanceof UpstreamError ? err.message : 'Upstream request failed.' }, 502, cors);
		}
	},
};

class UpstreamError extends Error {}

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/**
 * Reflects the request origin only when it's on the allow list ("*" allows any).
 */
function corsHeaders(request, env) {
	const origin = request.headers.get('Origin') || '';
	const allowed = String(env.ALLOWED_ORIGINS || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	const headers = {
		'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization, Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};

	if (origin && (allowed.includes('*') || allowed.includes(origin))) {
		headers['Access-Control-Allow-Origin'] = origin;
	}
	return headers;
}

function json(body, status, headers) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
	});
}

/**
 * Reads a JSON body, refusing anything over maxBytes.
 */
async function readJson(request, maxBytes) {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > maxBytes) {
		throw new HttpError(413, 'That request is too large.');
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new HttpError(400, 'Request body must be JSON.');
	}
}

function requireStore(env) {
	if (!env.DXT_DATA) {
		throw new UpstreamError('The DXT_DATA KV namespace is not bound to the Worker.');
	}
	return env.DXT_DATA;
}

/* ---------- Login & sessions ---------- */

/**
 * Constant-time string comparison. Both sides are hashed first so the
 * lengths always match and the password length isn't leaked.
 */
async function safeEqual(given, expected) {
	const enc = new TextEncoder();
	const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
	return crypto.subtle.timingSafeEqual(a, b);
}

function base64url(bytes) {
	let bin = '';
	for (const byte of bytes) {
		bin += String.fromCharCode(byte);
	}
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, text) {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

/**
 * Session token: base64url({ exp }).HMAC. Stateless, so rotating
 * SESSION_SECRET logs every device out.
 */
async function signSession(exp, env) {
	const payload = base64url(new TextEncoder().encode(JSON.stringify({ exp })));
	return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function sessionValid(request, env) {
	if (!env.SESSION_SECRET) {
		return false;
	}

	const header = request.headers.get('Authorization') || '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : '';
	const parts = token.split('.');
	if (2 !== parts.length || !parts[0] || !parts[1]) {
		return false;
	}

	if (!(await safeEqual(parts[1], await hmac(env.SESSION_SECRET, parts[0])))) {
		return false;
	}

	try {
		const { exp } = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
		return Number.isFinite(exp) && exp > Date.now();
	} catch {
		return false;
	}
}

/**
 * Checks the password and issues a session token. Failed attempts are
 * counted per IP in KV; after MAX_LOGIN_FAILS the IP waits LOGIN_LOCK_SECONDS.
 */
async function login(request, env, cors) {
	if (!env.LOGIN_PASSWORD || !env.SESSION_SECRET) {
		return json({ error: 'Login is not set up on the Worker. Set LOGIN_PASSWORD and SESSION_SECRET.' }, 500, cors);
	}

	const kv = requireStore(env);
	const failKey = `login-fails:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
	const fails = parseInt(await kv.get(failKey), 10) || 0;
	if (fails >= MAX_LOGIN_FAILS) {
		return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429, cors);
	}

	const body = await readJson(request, MAX_LOGIN_BYTES);
	const password = 'string' === typeof body?.password ? body.password : '';

	if (!password || !(await safeEqual(password, env.LOGIN_PASSWORD))) {
		await kv.put(failKey, String(fails + 1), { expirationTtl: LOGIN_LOCK_SECONDS });
		return json({ error: 'Incorrect password.' }, 401, cors);
	}

	if (fails) {
		await kv.delete(failKey);
	}

	const exp = Date.now() + (true === body.remember ? SESSION_REMEMBER_MS : SESSION_MS);
	return json({ token: await signSession(exp, env), expires: new Date(exp).toISOString() }, 200, cors);
}

/* ---------- Library storage ---------- */

async function loadData(env) {
	const stored = await requireStore(env).get(DATA_KEY, 'json');
	return {
		rev: stored?.rev | 0,
		saved: stored?.saved || null,
		data: stored?.data ?? null,
	};
}

/**
 * Saves the whole library. The client sends the rev it loaded; if another
 * device has saved since, the write is refused with 409 rather than
 * overwriting newer data.
 */
async function saveData(request, env, cors) {
	const kv = requireStore(env);
	const body = await readJson(request, MAX_DATA_BYTES);

	if (!body || !Number.isInteger(body.rev) || !body.data || 'object' !== typeof body.data || Array.isArray(body.data) || !Array.isArray(body.data.games)) {
		throw new HttpError(400, 'Invalid library data.');
	}

	const current = await kv.get(DATA_KEY, 'json');
	const rev = current?.rev | 0;
	if (body.rev !== rev) {
		return json({ error: 'Your library was changed on another device.', rev }, 409, cors);
	}

	const next = { rev: rev + 1, saved: new Date().toISOString(), data: body.data };
	await kv.put(DATA_KEY, JSON.stringify(next));
	return json({ rev: next.rev, saved: next.saved }, 200, cors);
}

/* ---------- OpenXBL ---------- */

async function xbl(endpoint, env) {
	if (!env.OPENXBL_KEY) {
		throw new UpstreamError('OPENXBL_KEY is not set on the Worker.');
	}

	const res = await fetch(XBL_BASE + endpoint, {
		headers: {
			'X-Authorization': env.OPENXBL_KEY,
			Accept: 'application/json',
			'Accept-Language': 'en-GB',
		},
	});

	let body = null;
	try {
		body = await res.json();
	} catch {
		// Non-JSON body — handled below.
	}

	if (200 !== res.status || !body || 'object' !== typeof body) {
		throw new UpstreamError(`OpenXBL returned HTTP ${res.status} on ${endpoint}.`);
	}
	return body;
}

/**
 * Flattens OpenXBL's achievements payload into a predictable shape.
 */
async function titles(env) {
	const body = await xbl('achievements', env);
	const list = body.titles || body.content?.titles || [];

	return list.map((t) => {
		const ach = t.achievement || {};
		const played = t.titleHistory?.lastTimePlayed;
		const parsed = played ? new Date(played) : null;

		return {
			titleId: String(t.titleId ?? ''),
			name: String(t.name ?? ''),
			image: httpsImage(t.displayImage),
			platform: (Array.isArray(t.devices) ? t.devices : []).map((d) => DEVICE_LABELS[d] || d).join(', '),
			gsCurrent: toInt(ach.currentGamerscore),
			gsTotal: toInt(ach.totalGamerscore),
			achCurrent: toInt(ach.currentAchievements),
			achTotal: toInt(ach.totalAchievements),
			progress: Math.min(100, toInt(ach.progressPercentage)),
			lastPlayed: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
		};
	});
}

async function profile(env) {
	const body = await xbl('account', env);
	const settings = body.profileUsers?.[0]?.settings || [];
	const map = {};
	for (const s of settings) {
		map[s.id] = s.value;
	}

	return {
		gamertag: map.Gamertag || '',
		gamerscore: toInt(map.Gamerscore),
		avatar: httpsImage(map.GameDisplayPicRaw),
	};
}

/* ---------- TrueAchievements ---------- */

/**
 * TA has no public API, so check whether /walkthrough resolves to a real walkthrough.
 *   true  — walkthrough confirmed
 *   false — game found, no walkthrough
 *   null  — couldn't tell (404, odd slug, Cloudflare challenge, rate limit)
 */
async function checkWalkthrough(slug) {
	let res;
	try {
		res = await fetch(`${TA_BASE}/game/${slug}/walkthrough`, {
			redirect: 'follow',
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DriftXboxTracker/1.0)' },
		});
	} catch {
		return null;
	}

	// Challenge / rate limit — don't record a false negative.
	if ([403, 429, 503].includes(res.status) || 200 !== res.status) {
		return null;
	}

	const body = (await res.text()).toLowerCase();

	if (body.includes('game not found')) {
		return null;
	}

	// Walkthrough pages contain a page list; games without one show a "no walkthrough" notice.
	const saysNone = body.includes('no walkthrough') || body.includes('does not have a walkthrough');
	const hasPages = body.includes('walkthrough-page') || body.includes('walkthrough page') || body.includes('/walkthrough/page');

	return !saysNone && hasPages;
}

function toInt(v) {
	const n = parseInt(v, 10);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * OpenXBL returns some Microsoft image URLs as http://. The hosts serve
 * https too, so upgrade them here and avoid mixed-content warnings.
 */
function httpsImage(v) {
	return String(v ?? '').replace(/^http:\/\//i, 'https://');
}
