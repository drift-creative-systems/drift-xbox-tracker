/**
 * Drift: Xbox Tracker — API proxy (Cloudflare Worker)
 *
 * Keeps the OpenXBL key off the client and does the TrueAchievements
 * walkthrough checks a browser can't (CORS). Every request needs the
 * shared ACCESS_TOKEN and must come from an origin in ALLOWED_ORIGINS.
 *
 * Routes (all GET):
 *   /api/health          — token check, no upstream calls
 *   /api/titles          — every title on the account with achievement progress
 *   /api/profile         — gamertag, gamerscore, avatar
 *   /api/ta?slug=<slug>  — { walkthrough: true | false | null }
 *
 * Secrets: OPENXBL_KEY, ACCESS_TOKEN.  Vars: ALLOWED_ORIGINS (comma separated).
 */

const XBL_BASE = 'https://xbl.io/api/v2/';
const TA_BASE = 'https://www.trueachievements.com';
const SLUG_PATTERN = /^[A-Za-z0-9-]{1,200}$/;

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
		if ('GET' !== request.method) {
			return json({ error: 'Method not allowed.' }, 405, cors);
		}
		if (!cors['Access-Control-Allow-Origin']) {
			return json({ error: 'Origin not allowed.' }, 403, cors);
		}
		if (!(await authorised(request, env))) {
			return json({ error: 'Access token missing or incorrect.' }, 401, cors);
		}

		const url = new URL(request.url);

		try {
			switch (url.pathname) {
				case '/api/health':
					return json({ ok: true, hasKey: Boolean(env.OPENXBL_KEY) }, 200, cors);
				case '/api/titles':
					return json({ titles: await titles(env) }, 200, cors);
				case '/api/profile':
					return json(await profile(env), 200, cors);
				case '/api/ta': {
					const slug = url.searchParams.get('slug') || '';
					if (!SLUG_PATTERN.test(slug)) {
						return json({ error: 'Invalid slug.' }, 400, cors);
					}
					return json({ walkthrough: await checkWalkthrough(slug) }, 200, cors);
				}
				default:
					return json({ error: 'Not found.' }, 404, cors);
			}
		} catch (err) {
			return json({ error: err instanceof UpstreamError ? err.message : 'Upstream request failed.' }, 502, cors);
		}
	},
};

class UpstreamError extends Error {}

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
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};

	if (origin && (allowed.includes('*') || allowed.includes(origin))) {
		headers['Access-Control-Allow-Origin'] = origin;
	}
	return headers;
}

/**
 * Constant-time Bearer token comparison.
 */
async function authorised(request, env) {
	const expected = env.ACCESS_TOKEN || '';
	const header = request.headers.get('Authorization') || '';
	const given = header.startsWith('Bearer ') ? header.slice(7) : '';

	if (!expected || !given) {
		return false;
	}

	const enc = new TextEncoder();
	const a = enc.encode(given);
	const b = enc.encode(expected);
	if (a.byteLength !== b.byteLength) {
		return false;
	}
	return crypto.subtle.timingSafeEqual(a, b);
}

function json(body, status, headers) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
	});
}

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
