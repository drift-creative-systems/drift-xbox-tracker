/**
 * Name normalisation, TrueAchievements URL building, and title matching.
 */

const TA_BASE = 'https://www.trueachievements.com';
const PLATFORM_SUFFIX = /\((xbox series x\|s|xbox one|xbox 360|windows|pc)\)/gi;

function stripAccents(s) {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * "Assassin's Creed® Odyssey" and "Assassins Creed Odyssey" resolve to the same key.
 */
export function nameKey(name) {
	let n = String(name || '').replace(/[™®©’'`]/g, '');
	n = stripAccents(n).toLowerCase();
	n = n.replace(PLATFORM_SUFFIX, ' ');
	n = n.replace(/[^a-z0-9]+/g, ' ');
	return n.replace(/\s+/g, ' ').trim().slice(0, 190);
}

/**
 * TA's URL slug for a game name — matches their pattern for most titles.
 */
export function taSlug(name) {
	let n = String(name || '').replace(/[™®©’'`.,!?]/g, '');
	n = n.replace(/&/g, 'and');
	n = n.replace(PLATFORM_SUFFIX, ' ');
	n = stripAccents(n).replace(/[^A-Za-z0-9]+/g, '-');
	return n.replace(/^-+|-+$/g, '');
}

export function taSearchUrl(name) {
	return `${TA_BASE}/searchresults.aspx?search=${encodeURIComponent(name)}`;
}

export function taWalkthroughUrl(name) {
	return `${TA_BASE}/game/${taSlug(name)}/walkthrough`;
}

export function taAchievementsUrl(name) {
	return `${TA_BASE}/game/${taSlug(name)}/achievements`;
}

/**
 * Adds ?gamerid= to TA achievement links so TA shows your own progress.
 */
export function withGamerId(url, gamerId) {
	if (!gamerId || !url) {
		return url;
	}
	try {
		const u = new URL(url);
		if (u.hostname.endsWith('trueachievements.com') && u.pathname.endsWith('/achievements') && !u.searchParams.has('gamerid')) {
			u.searchParams.set('gamerid', gamerId);
			return u.toString();
		}
	} catch {
		// Not a valid URL — return as-is.
	}
	return url;
}

/**
 * Only http(s) URLs are ever stored or rendered as links.
 */
export function safeUrl(url) {
	try {
		const u = new URL(String(url || '').trim());
		return 'https:' === u.protocol || 'http:' === u.protocol ? u.toString() : '';
	} catch {
		return '';
	}
}

/**
 * safeUrl for images: http is upgraded to https so older synced data
 * doesn't trigger mixed-content warnings.
 */
export function httpsImage(url) {
	return safeUrl(url).replace(/^http:\/\//i, 'https://');
}

// Raster base64 only — no SVG (can carry script) and no other data types.
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Image src guard that also allows the uploaded avatar's data URL.
 */
export function safeImageSrc(src) {
	const s = String(src || '');
	return DATA_IMAGE.test(s) ? s : httpsImage(s);
}

export function isDataImage(src) {
	return DATA_IMAGE.test(String(src || ''));
}

/**
 * Find the stored game for an Xbox title: title ID, then normalised name,
 * then the slug inside a saved TA URL (catches "Bladerunner" vs
 * "Blade Runner: Enhanced Edition"). Mirrors the original plugin's order.
 */
export function findMatch(games, title) {
	if (title.titleId) {
		const byId = games.find((g) => g.titleId === title.titleId);
		if (byId) {
			return byId;
		}
	}

	const key = nameKey(title.name);
	const byKey = games.find((g) => g.nameKey === key);
	if (byKey) {
		return byKey;
	}

	const slug = taSlug(title.name).toLowerCase();
	if (!slug) {
		return null;
	}
	const needle = `/game/${slug}/`;
	return games.find((g) => !g.titleId && g.taUrl && g.taUrl.toLowerCase().includes(needle)) || null;
}
