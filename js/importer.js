/**
 * One-off import of the existing Google Sheet (File → Download → CSV).
 * Expected columns: Done, Game, %, Walkthrough, TA URL, Notes.
 * Everything imported is flagged "on my list", so your backlog of
 * unstarted games survives alongside what Xbox reports.
 */

import * as store from './store.js';
import { nameKey, safeUrl } from './match.js';

/**
 * RFC 4180-ish parser: quoted fields, escaped quotes, newlines inside quotes.
 */
export function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = '';
	let quoted = false;
	const src = String(text).replace(/^﻿/, '');

	for (let i = 0; i < src.length; i++) {
		const c = src[i];

		if (quoted) {
			if ('"' === c) {
				if ('"' === src[i + 1]) {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += c;
			}
			continue;
		}

		if ('"' === c) {
			quoted = true;
		} else if (',' === c) {
			row.push(field);
			field = '';
		} else if ('\n' === c || '\r' === c) {
			if ('\r' === c && '\n' === src[i + 1]) {
				i++;
			}
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += c;
		}
	}

	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

const isTrue = (v) => 'TRUE' === String(v || '').trim().toUpperCase();

/**
 * @returns {{ added: number, merged: number, skipped: number }}
 */
export function importCsv(text) {
	const rows = parseCsv(text);
	const games = store.getGames();
	const now = new Date().toISOString();
	let added = 0;
	let merged = 0;
	let skipped = 0;

	rows.forEach((cols, i) => {
		const name = String(cols[1] || '').trim();
		if (!name || (0 === i && 'game' === name.toLowerCase())) {
			return;
		}

		const key = nameKey(name);
		if (!key) {
			skipped++;
			return;
		}

		const taUrl = safeUrl(cols[4]);
		const notes = String(cols[5] || '').trim();
		const patch = { onList: true, completed: isTrue(cols[0]), updated: now };

		if (taUrl) {
			patch.taUrl = taUrl;
			patch.taWalkthrough = isTrue(cols[3]) || taUrl.includes('/walkthrough');
			patch.taManual = true;
			patch.taChecked = now;
		}
		if (notes) {
			patch.notes = notes;
		}

		const existing = games.find((g) => g.nameKey === key);
		if (existing) {
			Object.assign(existing, patch);
			merged++;
		} else {
			const pct = parseInt(String(cols[2] || '0').replace(/[^0-9]/g, ''), 10) || 0;
			games.push(store.makeGame({ ...patch, name, nameKey: key, progress: Math.min(100, pct), source: 'list' }));
			added++;
		}
	});

	store.saveGames(games);
	return { added, merged, skipped };
}
