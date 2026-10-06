/* global jQuery, XBT */
jQuery(function ($) {
	var $root = $('[data-xbt]');
	if (!$root.length) return;

	var $list = $root.find('[data-xbt-list]');
	var $count = $root.find('[data-xbt-count]');
	var state = { filter: 'all', q: '', sort: 'played' };

	var tests = {
		all: function (d) { return !d.hidden; },
		recent: function (d) { return !d.hidden && d.recent; },
		progress: function (d) { return !d.hidden && d.progress > 0 && !d.done; },
		todo: function (d) { return !d.hidden && d.progress === 0 && !d.done; },
		done: function (d) { return !d.hidden && d.done; },
		walkthrough: function (d) { return !d.hidden && d.walkthrough; },
		list: function (d) { return !d.hidden && d.list; },
		hidden: function (d) { return d.hidden; }
	};

	function data($el) {
		return {
			name: String($el.data('name')),
			played: +$el.data('played') || 0,
			progress: +$el.data('progress') || 0,
			remaining: +$el.data('remaining') || 0,
			recent: +$el.data('recent') === 1,
			done: +$el.data('done') === 1,
			walkthrough: +$el.data('walkthrough') === 1,
			list: +$el.data('list') === 1,
			hidden: +$el.data('hidden') === 1
		};
	}

	function apply() {
		var shown = 0;
		$list.children('.xbt-game').each(function () {
			var $el = $(this), d = data($el);
			var ok = tests[state.filter](d) && (!state.q || d.name.indexOf(state.q) !== -1);
			this.hidden = !ok;
			if (ok) shown++;
		});
		$count.text(shown);
	}

	function sort() {
		var items = $list.children('.xbt-game').get();
		items.sort(function (a, b) {
			var da = data($(a)), db = data($(b));
			switch (state.sort) {
				case 'name': return da.name.localeCompare(db.name);
				case 'progress': return db.progress - da.progress || da.name.localeCompare(db.name);
				case 'remaining': return db.remaining - da.remaining || da.name.localeCompare(db.name);
				default: return db.played - da.played || da.name.localeCompare(db.name);
			}
		});
		$list.append(items);
	}

	$root.on('click', '[data-filter]', function () {
		$root.find('[data-filter]').removeClass('is-active').attr('aria-pressed', 'false');
		$(this).addClass('is-active').attr('aria-pressed', 'true');
		state.filter = $(this).data('filter');
		apply();
	});

	var t;
	$root.on('input', '[data-xbt-search]', function () {
		var v = this.value;
		clearTimeout(t);
		t = setTimeout(function () { state.q = v.trim().toLowerCase(); apply(); }, 120);
	});

	$root.on('change', '[data-xbt-sort]', function () {
		state.sort = this.value;
		sort();
	});

	apply();

	if (!XBT.canEdit) return;

	$root.on('click', '.xbt-edit-toggle', function () {
		var $btn = $(this), $ed = $btn.closest('.xbt-game').find('.xbt-editor');
		var open = $ed.prop('hidden');
		$ed.prop('hidden', !open);
		$btn.attr('aria-expanded', open ? 'true' : 'false').text(open ? 'Close' : 'Edit');
	});

	function send(action, $game, extra) {
		var $status = $game.find('.xbt-status');
		$status.text(action === 'xbt_recheck' ? 'Checking TrueAchievements…' : 'Saving…');
		$game.find('button').prop('disabled', true);

		return $.post(XBT.ajax, $.extend({ action: action, nonce: XBT.nonce, id: $game.data('id') }, extra || {}))
			.done(function (r) {
				if (!r || !r.success) {
					$status.text((r && r.data) || 'Could not save. Reload and try again.');
					$game.find('button').prop('disabled', false);
					return;
				}
				var $new = $(r.data.html);
				$game.replaceWith($new);
				$new.find('.xbt-editor').prop('hidden', false);
				$new.find('.xbt-edit-toggle').attr('aria-expanded', 'true').text('Close');
				$new.find('.xbt-status').text(action === 'xbt_recheck' ? 'Checked' : 'Saved');
				apply();
			})
			.fail(function () {
				$status.text('Could not reach the server. Try again.');
				$game.find('button').prop('disabled', false);
			});
	}

	$root.on('click', '.xbt-save', function () {
		var $game = $(this).closest('.xbt-game'), $ed = $game.find('.xbt-editor');
		send('xbt_save', $game, {
			ta_url: $ed.find('[name="ta_url"]').val(),
			notes: $ed.find('[name="notes"]').val(),
			completed: $ed.find('[name="completed"]').is(':checked') ? 1 : 0,
			on_list: $ed.find('[name="on_list"]').is(':checked') ? 1 : 0,
			hidden: $ed.find('[name="hidden"]').is(':checked') ? 1 : 0
		});
	});

	$root.on('click', '.xbt-recheck', function () {
		send('xbt_recheck', $(this).closest('.xbt-game'));
	});
});
