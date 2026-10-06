/**
 * Drift: Xbox Tracker — app controller.
 * Renders the hero + library, wires filters/sort/search, the inline
 * editor, the settings dialog, and sync scheduling.
 */

import * as store from './store.js';
import * as sync from './sync.js';
import * as api from './api.js';
import { importCsv } from './importer.js';
import { taSearchUrl, withGamerId, safeUrl } from './match.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_SYNC_CHECK_MS = 15 * 60 * 1000;

const state = { filter: 'all', q: '', sort: 'played', openId: null };

const el = {
	hero: $('[data-hero]'),
	list: $('[data-list]'),
	count: $('[data-count]'),
	empty: $('[data-empty]'),
	search: $('[data-search]'),
	sort: $('[data-sort]'),
	syncBtn: $('[data-action="sync"]'),
	syncLabel: $('[data-sync-label]'),
	settings: $('[data-settings]'),
	settingsForm: $('[data-settings-form]'),
	toasts: $('[data-toasts]'),
};

/* ---------- Helpers ---------- */

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const nf = new Intl.NumberFormat('en-GB');
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const playedTs = (g) => (g.lastPlayed ? new Date(g.lastPlayed).getTime() || 0 : 0);
const remaining = (g) => Math.max(0, g.gsTotal - g.gsCurrent);
const isRecent = (g) => playedTs(g) > Date.now() - 30 * DAY_MS;
const byName = (a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' });

/**
 * Escapes notes, then turns bare http(s) URLs into links.
 */
function linkify(text) {
	return esc(text).replace(/https?:\/\/[^\s<]+/g, (m) => {
		const trail = (m.match(/[.,!?)]+$/) || [''])[0];
		const url = m.slice(0, m.length - trail.length);
		return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
	});
}

/**
 * Xbox image URLs accept w/h params — ask for a small square.
 */
function coverUrl(image) {
	const url = safeUrl(image);
	if (!url) {
		return '';
	}
	try {
		const u = new URL(url);
		u.searchParams.set('w', '160');
		u.searchParams.set('h', '160');
		return u.toString();
	} catch {
		return url;
	}
}

function toast(message, type = 'info') {
	const t = document.createElement('div');
	t.className = `toast toast--${type}`;
	t.setAttribute('role', 'error' === type ? 'alert' : 'status');
	t.textContent = message;
	el.toasts.append(t);
	setTimeout(() => t.classList.add('is-leaving'), 4500);
	setTimeout(() => t.remove(), 5000);
}

function download(filename, text, type) {
	const blob = new Blob([text], { type });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function readFile(file) {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result));
		r.onerror = () => reject(new Error('Could not read that file.'));
		r.readAsText(file);
	});
}

const isConfigured = () => {
	const s = store.getSettings();
	return Boolean(s.workerUrl && s.accessToken);
};

/* ---------- Filters & sorting ---------- */

const FILTERS = {
	all: (g) => !g.hidden,
	recent: (g) => !g.hidden && isRecent(g),
	progress: (g) => !g.hidden && g.progress > 0 && !g.completed,
	todo: (g) => !g.hidden && 0 === g.progress && !g.completed,
	done: (g) => !g.hidden && g.completed,
	walkthrough: (g) => !g.hidden && true === g.taWalkthrough,
	list: (g) => !g.hidden && g.onList,
	hidden: (g) => g.hidden,
};

const SORTS = {
	played: (a, b) => playedTs(b) - playedTs(a) || byName(a, b),
	name: byName,
	progress: (a, b) => b.progress - a.progress || byName(a, b),
	remaining: (a, b) => remaining(b) - remaining(a) || byName(a, b),
};

/* ---------- Rendering ---------- */

function renderHero() {
	const profile = store.getProfile() || {};
	const games = store.getGames().filter((g) => !g.hidden);
	const last = store.getLastSync();
	const error = store.getLastError();

	const completed = games.filter((g) => g.completed).length;
	const started = games.filter((g) => g.progress > 0);
	const avg = started.length ? Math.round(started.reduce((n, g) => n + g.progress, 0) / started.length) : 0;
	const gamerscore = profile.gamerscore || games.reduce((n, g) => n + g.gsCurrent, 0);
	const avatar = safeUrl(profile.avatar);

	el.hero.innerHTML = `
		<div class="hero__id">
			${avatar ? `<img class="hero__avatar" src="${esc(avatar)}" alt="" width="64" height="64">` : '<span class="hero__avatar hero__avatar--empty" aria-hidden="true"></span>'}
			<div>
				<h1 class="hero__gamertag">${esc(profile.gamertag || 'My games')}</h1>
				<p class="hero__synced" data-sync-status>${last ? `Updated ${esc(dateTimeFmt.format(new Date(last)))}` : 'Not synced yet'}</p>
				${error ? `<p class="hero__error">Last sync failed: ${esc(error)}</p>` : ''}
			</div>
		</div>
		<p class="hero__score">
			<span class="hero__score-num">${esc(nf.format(gamerscore))}</span>
			<span class="hero__score-label">Gamerscore</span>
		</p>
		<dl class="hero__stats">
			<div><dt>Games</dt><dd>${esc(games.length)}</dd></div>
			<div><dt>Completed</dt><dd>${esc(completed)}</dd></div>
			<div><dt>Average progress</dt><dd>${esc(avg)}%</dd></div>
		</dl>`;
}

function taLink(g) {
	const { taGamerId } = store.getSettings();
	if (true === g.taWalkthrough && g.taUrl) {
		return { label: 'Walkthrough', mod: 'walkthrough', href: g.taUrl };
	}
	if (false === g.taWalkthrough && g.taUrl) {
		return { label: 'Achievement guide', mod: 'guide', href: withGamerId(g.taUrl, taGamerId) };
	}
	return { label: 'Find on TrueAchievements', mod: 'search', href: taSearchUrl(g.name) };
}

function editorHtml(g) {
	const id = esc(g.id);
	return `
		<form class="editor" id="editor-${id}" data-editor novalidate>
			<label class="field">
				<span class="field__label">TrueAchievements link</span>
				<input type="url" name="taUrl" value="${esc(g.taManual ? g.taUrl : '')}" placeholder="Leave blank to detect automatically" inputmode="url">
			</label>
			<label class="field">
				<span class="field__label">Notes</span>
				<textarea name="notes" rows="2">${esc(g.notes)}</textarea>
			</label>
			<fieldset class="editor__checks">
				<legend class="visually-hidden">Status</legend>
				<label class="check"><input type="checkbox" name="completed" ${g.completed ? 'checked' : ''}> Completed</label>
				<label class="check"><input type="checkbox" name="onList" ${g.onList ? 'checked' : ''}> On my list</label>
				<label class="check"><input type="checkbox" name="hidden" ${g.hidden ? 'checked' : ''}> Hide</label>
			</fieldset>
			<div class="editor__actions">
				<button type="submit" class="btn btn--primary btn--sm">Save changes</button>
				<button type="button" class="btn btn--ghost btn--sm" data-action="recheck">Check TrueAchievements again</button>
				<span class="editor__status" data-status aria-live="polite"></span>
			</div>
		</form>`;
}

function rowHtml(g) {
	const ta = taLink(g);
	const open = state.openId === g.id;
	const cover = coverUrl(g.image);
	const played = playedTs(g);
	const classes = ['game', g.completed ? 'is-done' : '', g.hidden ? 'is-hidden' : '', open ? 'is-open' : ''].filter(Boolean).join(' ');

	return `
		<li class="${classes}" data-id="${esc(g.id)}">
			<div class="game__cover">
				${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async" width="80" height="80">` : `<span aria-hidden="true">${esc(g.name.charAt(0).toUpperCase())}</span>`}
			</div>
			<div class="game__main">
				<h3 class="game__name">${esc(g.name)}${g.completed ? ' <span class="badge">Completed</span>' : ''}</h3>
				<p class="game__meta">
					${g.platform ? `<span>${esc(g.platform)}</span>` : ''}
					<span>${played ? `Last played ${esc(dateFmt.format(new Date(played)))}` : 'Not played yet'}</span>
					${g.onList ? '<span class="tag">On my list</span>' : ''}
				</p>
				${g.notes ? `<p class="game__notes">${linkify(g.notes)}</p>` : ''}
			</div>
			<div class="game__progress">
				<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(g.progress)}" aria-label="${esc(g.name)} completion">
					<span data-w="${esc(g.progress)}"></span>
				</div>
				<p class="game__figures">
					<strong>${esc(g.progress)}%</strong>
					${g.gsTotal ? `<span>${esc(nf.format(g.gsCurrent))} / ${esc(nf.format(g.gsTotal))} G</span><span>${esc(g.achCurrent)} of ${esc(g.achTotal)} achievements</span>` : ''}
				</p>
			</div>
			<div class="game__actions">
				<a class="ta ta--${ta.mod}" href="${esc(ta.href)}" target="_blank" rel="noopener noreferrer">${esc(ta.label)}<span class="visually-hidden"> for ${esc(g.name)} (opens in a new tab)</span></a>
				<button type="button" class="link-btn" data-action="edit" aria-expanded="${open}" aria-controls="editor-${esc(g.id)}">${open ? 'Close' : 'Edit'}</button>
			</div>
			${open ? editorHtml(g) : ''}
		</li>`;
}

function emptyHtml(totalGames) {
	if (!totalGames && !isConfigured()) {
		return `
			<h2>Connect your Xbox account</h2>
			<p>Add your Worker URL and access token in Settings to pull your games, or import your Google Sheet to start from your existing list.</p>
			<button type="button" class="btn btn--primary" data-action="settings">Open settings</button>`;
	}
	if (!totalGames) {
		return '<h2>No games yet</h2><p>Run a sync to pull every game on your Xbox account.</p>';
	}
	return '<p>No games match that search or filter.</p>';
}

/**
 * Captures unsaved editor input so a re-render (e.g. sync finishing) doesn't wipe it.
 */
function snapshotEditor() {
	const form = state.openId ? $(`[data-id="${CSS.escape(state.openId)}"] [data-editor]`, el.list) : null;
	if (!form) {
		return null;
	}
	return $$('input, textarea', form).map((f) => [f.name, 'checkbox' === f.type ? f.checked : f.value]);
}

function restoreEditor(snapshot) {
	const form = snapshot && state.openId ? $(`[data-id="${CSS.escape(state.openId)}"] [data-editor]`, el.list) : null;
	if (!form) {
		return;
	}
	snapshot.forEach(([name, value]) => {
		const f = form.elements.namedItem(name);
		if (f) {
			f['checkbox' === f.type ? 'checked' : 'value'] = value;
		}
	});
}

function renderList() {
	const snapshot = snapshotEditor();
	const games = store.getGames();
	const visible = games
		.filter(FILTERS[state.filter] || FILTERS.all)
		.filter((g) => !state.q || g.name.toLowerCase().includes(state.q))
		.sort(SORTS[state.sort] || SORTS.played);

	el.list.innerHTML = visible.map(rowHtml).join('');
	// Widths set from JS rather than inline style attributes.
	$$('.bar > span', el.list).forEach((s) => {
		s.style.width = `${Number(s.dataset.w) || 0}%`;
	});
	restoreEditor(snapshot);

	el.count.textContent = visible.length;
	el.empty.hidden = visible.length > 0;
	if (!visible.length) {
		el.empty.innerHTML = emptyHtml(games.length);
	}
}

function renderAll() {
	renderHero();
	renderList();
}

/* ---------- Sync ---------- */

function setSyncing(on, label) {
	el.syncBtn.disabled = on;
	el.syncBtn.setAttribute('aria-busy', String(on));
	el.syncBtn.classList.toggle('is-busy', on);
	el.syncLabel.textContent = on ? 'Syncing…' : 'Sync now';
	const status = $('[data-sync-status]', el.hero);
	if (status && label) {
		status.textContent = label;
	}
}

async function doSync({ quiet = false } = {}) {
	if (sync.isRunning()) {
		return;
	}
	setSyncing(true, 'Starting sync…');
	try {
		const r = await sync.run({
			onStatus: (msg) => setSyncing(true, msg),
			onMerged: () => {
				renderAll();
				setSyncing(true, 'Checking TrueAchievements…');
			},
		});
		renderAll();
		if (!quiet || r.added) {
			toast(`Synced: ${r.added} new, ${r.updated} updated, ${r.checked} walkthroughs checked.`, 'success');
		}
	} catch (err) {
		renderAll();
		toast(err.message, 'error');
	} finally {
		setSyncing(false);
	}
}

function maybeAutoSync() {
	if (isConfigured() && sync.isStale() && 'visible' === document.visibilityState) {
		doSync({ quiet: true });
	}
}

/* ---------- Inline editor ---------- */

function setEditorStatus(id, text) {
	const s = $(`[data-id="${CSS.escape(id)}"] [data-status]`, el.list);
	if (s) {
		s.textContent = text;
	} else {
		toast(text, 'success');
	}
}

function saveEditor(form, id) {
	const game = store.getGame(id);
	if (!game) {
		toast('Game not found. Reload and try again.', 'error');
		return;
	}

	const raw = String(form.elements.taUrl.value || '').trim();
	const ta = safeUrl(raw);
	if (raw && !ta) {
		$('[data-status]', form).textContent = 'Enter a full link starting https://';
		form.elements.taUrl.focus();
		return;
	}

	const patch = {
		notes: form.elements.notes.value.trim(),
		completed: form.elements.completed.checked,
		onList: form.elements.onList.checked,
		hidden: form.elements.hidden.checked,
	};

	if (ta) {
		patch.taUrl = ta;
		patch.taManual = true;
		patch.taWalkthrough = ta.includes('/walkthrough');
	} else if (game.taManual) {
		// Cleared a manual link: hand it back to auto-detection.
		Object.assign(patch, { taUrl: null, taManual: false, taChecked: null, taWalkthrough: null });
	}

	try {
		store.updateGame(id, patch);
	} catch (err) {
		toast(err.message, 'error');
		return;
	}

	renderAll();
	setEditorStatus(id, 'Saved');
}

async function recheck(form, id) {
	const game = store.getGame(id);
	if (!game) {
		return;
	}
	const status = $('[data-status]', form);
	const buttons = $$('button', form);
	status.textContent = 'Checking TrueAchievements…';
	buttons.forEach((b) => (b.disabled = true));

	try {
		store.updateGame(id, await sync.checkOne(game));
		renderAll();
		setEditorStatus(id, 'Checked');
	} catch (err) {
		status.textContent = err.message;
		buttons.forEach((b) => (b.disabled = false));
	}
}

/* ---------- Settings dialog ---------- */

function openSettings() {
	const s = store.getSettings();
	const f = el.settingsForm.elements;
	f.workerUrl.value = s.workerUrl;
	f.accessToken.value = s.accessToken;
	f.taGamerId.value = s.taGamerId;
	f.taBatch.value = s.taBatch;
	f.skipApps.checked = Boolean(s.skipApps);
	el.settings.showModal();
}

function readSettingsForm() {
	const f = el.settingsForm.elements;
	const workerUrl = String(f.workerUrl.value || '').trim().replace(/\/+$/, '');
	if (workerUrl && !safeUrl(workerUrl)) {
		throw new Error('Worker URL must be a full link, e.g. https://drift-xbox-tracker-proxy.you.workers.dev');
	}
	return {
		workerUrl,
		accessToken: String(f.accessToken.value || '').trim(),
		taGamerId: String(f.taGamerId.value || '').replace(/[^0-9]/g, ''),
		taBatch: Math.max(0, Math.min(50, parseInt(f.taBatch.value, 10) || 0)),
		skipApps: f.skipApps.checked,
	};
}

function saveSettingsForm() {
	try {
		store.saveSettings(readSettingsForm());
		return true;
	} catch (err) {
		toast(err.message, 'error');
		return false;
	}
}

async function testConnection() {
	if (!saveSettingsForm()) {
		return;
	}
	try {
		const r = await api.health();
		toast(r.hasKey ? 'Connected. The Worker has your OpenXBL key.' : 'Connected, but OPENXBL_KEY is not set on the Worker.', r.hasKey ? 'success' : 'error');
	} catch (err) {
		toast(err.message, 'error');
	}
}

async function handleCsv(input) {
	const file = input.files?.[0];
	input.value = '';
	if (!file) {
		return;
	}
	try {
		const r = importCsv(await readFile(file));
		renderAll();
		toast(`Imported: ${r.added} added, ${r.merged} merged with Xbox games, ${r.skipped} skipped.`, 'success');
	} catch (err) {
		toast(err.message, 'error');
	}
}

async function handleRestore(input) {
	const file = input.files?.[0];
	input.value = '';
	if (!file) {
		return;
	}
	try {
		const data = JSON.parse(await readFile(file));
		// eslint-disable-next-line no-alert
		if (!window.confirm('Replace every game in this browser with the backup? Your access token is kept.')) {
			return;
		}
		const n = store.restoreBackup(data);
		renderAll();
		toast(`Restored ${n} games.`, 'success');
	} catch (err) {
		toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error');
	}
}

function handleExport() {
	const stamp = new Date().toISOString().slice(0, 10);
	download(`drift-xbox-tracker-backup-${stamp}.json`, JSON.stringify(store.exportBackup(), null, 2), 'application/json');
}

function handleWipe() {
	// eslint-disable-next-line no-alert
	if (!window.confirm('Delete every game, note and setting stored in this browser? This cannot be undone.')) {
		return;
	}
	store.wipeAll();
	state.openId = null;
	el.settings.close();
	renderAll();
	toast('All local data deleted.', 'info');
}

/* ---------- Events ---------- */

function bind() {
	document.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-action]');
		if (!btn) {
			return;
		}
		const action = btn.dataset.action;
		const row = btn.closest('[data-id]');

		switch (action) {
			case 'sync':
				doSync();
				break;
			case 'settings':
				openSettings();
				break;
			case 'close-settings':
				el.settings.close();
				break;
			case 'test':
				testConnection();
				break;
			case 'export':
				handleExport();
				break;
			case 'wipe':
				handleWipe();
				break;
			case 'edit':
				if (row) {
					state.openId = state.openId === row.dataset.id ? null : row.dataset.id;
					renderList();
					if (state.openId) {
						$(`[data-id="${CSS.escape(state.openId)}"] [data-editor] input`, el.list)?.focus();
					}
				}
				break;
			case 'recheck':
				if (row) {
					recheck(btn.closest('form'), row.dataset.id);
				}
				break;
		}
	});

	el.list.addEventListener('submit', (e) => {
		const form = e.target.closest('[data-editor]');
		if (form) {
			e.preventDefault();
			saveEditor(form, form.closest('[data-id]').dataset.id);
		}
	});

	$$('[data-filter]').forEach((b) => {
		b.addEventListener('click', () => {
			$$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
			state.filter = b.dataset.filter;
			renderList();
		});
	});

	let timer;
	el.search.addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			state.q = el.search.value.trim().toLowerCase();
			renderList();
		}, 120);
	});

	el.sort.addEventListener('change', () => {
		state.sort = el.sort.value;
		renderList();
	});

	el.settingsForm.addEventListener('submit', (e) => {
		e.preventDefault();
		if (saveSettingsForm()) {
			el.settings.close();
			renderAll();
			toast('Settings saved.', 'success');
			maybeAutoSync();
		}
	});

	$('[data-import-csv]').addEventListener('change', (e) => handleCsv(e.target));
	$('[data-restore]').addEventListener('change', (e) => handleRestore(e.target));

	document.addEventListener('visibilitychange', maybeAutoSync);
}

/* ---------- Boot ---------- */

bind();
renderAll();
maybeAutoSync();
setInterval(maybeAutoSync, AUTO_SYNC_CHECK_MS);
