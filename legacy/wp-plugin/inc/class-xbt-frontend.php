<?php
defined( 'ABSPATH' ) || exit;

class XBT_Frontend {

	public static function init() {
		add_shortcode( 'xbox_tracker', [ __CLASS__, 'shortcode' ] );
		add_action( 'wp_enqueue_scripts', [ __CLASS__, 'register_assets' ] );
		add_action( 'wp_ajax_xbt_save', [ __CLASS__, 'ajax_save' ] );
		add_action( 'wp_ajax_xbt_recheck', [ __CLASS__, 'ajax_recheck' ] );
	}

	public static function register_assets() {
		wp_register_style( 'xbt-fonts', 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap', [], null );
		wp_register_style( 'xbt', XBT_URL . 'assets/xbt.css', [ 'xbt-fonts' ], XBT_VERSION );
		wp_register_script( 'xbt', XBT_URL . 'assets/xbt.js', [ 'jquery' ], XBT_VERSION, true );
	}

	public static function can_edit() {
		return current_user_can( 'manage_options' );
	}

	public static function shortcode() {
		if ( 'public' !== xbt_opt( 'visibility', 'private' ) && ! self::can_edit() ) {
			return '';
		}

		wp_enqueue_style( 'xbt' );
		wp_enqueue_script( 'xbt' );
		wp_localize_script( 'xbt', 'XBT', [
			'ajax'    => admin_url( 'admin-ajax.php' ),
			'nonce'   => wp_create_nonce( 'xbt_edit' ),
			'canEdit' => self::can_edit(),
		] );

		$games   = XBT_DB::all( self::can_edit() );
		$profile = get_option( 'xbt_profile', [] );
		$last    = get_option( 'xbt_last_sync' );

		$total     = count( $games );
		$completed = 0;
		$started   = 0;
		$pct_sum   = 0;
		foreach ( $games as $g ) {
			$completed += (int) $g->completed;
			if ( $g->progress > 0 ) {
				$started++;
				$pct_sum += $g->progress;
			}
		}
		$avg = $started ? round( $pct_sum / $started ) : 0;

		ob_start();
		?>
		<div class="xbt" data-xbt>
			<header class="xbt-head">
				<div class="xbt-id">
					<?php if ( ! empty( $profile['avatar'] ) ) : ?>
						<img class="xbt-avatar" src="<?php echo esc_url( $profile['avatar'] ); ?>" alt="" width="56" height="56">
					<?php endif; ?>
					<div>
						<h2 class="xbt-gamertag"><?php echo esc_html( $profile['gamertag'] ?? 'My games' ); ?></h2>
						<?php if ( $last ) : ?>
							<p class="xbt-synced">Updated <?php echo esc_html( mysql2date( 'd/m/Y H:i', $last ) ); ?></p>
						<?php endif; ?>
					</div>
				</div>
				<p class="xbt-score">
					<span class="xbt-score-num"><?php echo esc_html( number_format_i18n( $profile['gamerscore'] ?? 0 ) ); ?></span>
					<span class="xbt-score-label">Gamerscore</span>
				</p>
				<dl class="xbt-stats">
					<div><dt>Games</dt><dd><?php echo esc_html( $total ); ?></dd></div>
					<div><dt>Completed</dt><dd><?php echo esc_html( $completed ); ?></dd></div>
					<div><dt>Average progress</dt><dd><?php echo esc_html( $avg ); ?>%</dd></div>
				</dl>
			</header>

			<div class="xbt-controls">
				<label class="xbt-search">
					<span class="screen-reader-text">Search games</span>
					<input type="search" placeholder="Search games" data-xbt-search>
				</label>
				<div class="xbt-filters" role="group" aria-label="Filter games">
					<button type="button" class="is-active" data-filter="all">All</button>
					<button type="button" data-filter="recent">Played this month</button>
					<button type="button" data-filter="progress">In progress</button>
					<button type="button" data-filter="todo">Not started</button>
					<button type="button" data-filter="done">Completed</button>
					<button type="button" data-filter="walkthrough">Has walkthrough</button>
					<button type="button" data-filter="list">On my list</button>
					<?php if ( self::can_edit() ) : ?>
						<button type="button" data-filter="hidden">Hidden</button>
					<?php endif; ?>
				</div>
				<label class="xbt-sort">
					Sort
					<select data-xbt-sort>
						<option value="played">Last played</option>
						<option value="name">Name</option>
						<option value="progress">Completion</option>
						<option value="remaining">Gamerscore left</option>
					</select>
				</label>
			</div>

			<p class="xbt-count" aria-live="polite"><span data-xbt-count><?php echo esc_html( $total ); ?></span> games</p>

			<ol class="xbt-list" data-xbt-list>
				<?php foreach ( $games as $g ) : ?>
					<?php echo self::row( $g ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php endforeach; ?>
			</ol>

			<?php if ( ! $games ) : ?>
				<p class="xbt-empty">No games yet. Add your OpenXBL key under Settings → Xbox Tracker and run a sync.</p>
			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}

	public static function row( $g ) {
		$played_ts = $g->last_played ? strtotime( $g->last_played . ' UTC' ) : 0;
		$recent    = $played_ts && $played_ts > strtotime( '-30 days' );
		$remaining = max( 0, $g->gs_total - $g->gs_current );

		if ( 1 === (int) $g->ta_walkthrough && $g->ta_url ) {
			$ta_label = 'Walkthrough';
			$ta_class = 'is-walkthrough';
		} elseif ( '0' === (string) $g->ta_walkthrough && $g->ta_url ) {
			$ta_label = 'Achievement guide';
			$ta_class = 'is-guide';
		} else {
			$ta_label = 'Find on TrueAchievements';
			$ta_class = 'is-search';
		}
		$ta_href = $g->ta_url ?: XBT_TA::search_url( $g->name );

		ob_start();
		?>
		<li class="xbt-game<?php echo $g->completed ? ' is-done' : ''; ?><?php echo $g->hidden ? ' is-hidden' : ''; ?>"
			data-id="<?php echo esc_attr( $g->id ); ?>"
			data-name="<?php echo esc_attr( strtolower( $g->name ) ); ?>"
			data-played="<?php echo esc_attr( $played_ts ); ?>"
			data-progress="<?php echo esc_attr( $g->progress ); ?>"
			data-remaining="<?php echo esc_attr( $remaining ); ?>"
			data-recent="<?php echo $recent ? 1 : 0; ?>"
			data-done="<?php echo esc_attr( (int) $g->completed ); ?>"
			data-walkthrough="<?php echo 1 === (int) $g->ta_walkthrough ? 1 : 0; ?>"
			data-list="<?php echo esc_attr( (int) $g->on_list ); ?>"
			data-hidden="<?php echo esc_attr( (int) $g->hidden ); ?>">

			<div class="xbt-cover">
				<?php if ( $g->image ) : ?>
					<img src="<?php echo esc_url( add_query_arg( [ 'w' => 160, 'h' => 160 ], $g->image ) ); ?>" alt="" loading="lazy" width="80" height="80">
				<?php else : ?>
					<span aria-hidden="true"><?php echo esc_html( mb_substr( $g->name, 0, 1 ) ); ?></span>
				<?php endif; ?>
			</div>

			<div class="xbt-main">
				<h3 class="xbt-name"><?php echo esc_html( $g->name ); ?></h3>
				<p class="xbt-meta">
					<?php if ( $g->platform ) : ?><span><?php echo esc_html( $g->platform ); ?></span><?php endif; ?>
					<span><?php echo $played_ts ? 'Last played ' . esc_html( wp_date( 'd/m/Y', $played_ts ) ) : 'Not played yet'; ?></span>
				</p>
				<?php if ( $g->notes ) : ?>
					<p class="xbt-notes" data-xbt-notes-view><?php echo make_clickable( esc_html( $g->notes ) ); ?></p>
				<?php endif; ?>
			</div>

			<div class="xbt-progress">
				<div class="xbt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?php echo esc_attr( $g->progress ); ?>" aria-label="<?php echo esc_attr( $g->name ); ?> completion">
					<span style="width:<?php echo esc_attr( $g->progress ); ?>%"></span>
				</div>
				<p class="xbt-figures">
					<strong><?php echo esc_html( $g->progress ); ?>%</strong>
					<?php if ( $g->gs_total ) : ?>
						<span><?php echo esc_html( number_format_i18n( $g->gs_current ) . ' / ' . number_format_i18n( $g->gs_total ) ); ?> G</span>
						<span><?php echo esc_html( $g->ach_current . ' of ' . $g->ach_total ); ?> achievements</span>
					<?php endif; ?>
				</p>
			</div>

			<div class="xbt-actions">
				<a class="xbt-ta <?php echo esc_attr( $ta_class ); ?>" href="<?php echo esc_url( $ta_href ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $ta_label ); ?></a>
				<?php if ( self::can_edit() ) : ?>
					<button type="button" class="xbt-edit-toggle" aria-expanded="false">Edit</button>
				<?php endif; ?>
			</div>

			<?php if ( self::can_edit() ) : ?>
				<div class="xbt-editor" hidden>
					<label>TrueAchievements link
						<input type="url" name="ta_url" value="<?php echo esc_attr( $g->ta_manual ? $g->ta_url : '' ); ?>" placeholder="Leave blank to detect automatically">
					</label>
					<label>Notes
						<textarea name="notes" rows="2"><?php echo esc_textarea( $g->notes ); ?></textarea>
					</label>
					<div class="xbt-checks">
						<label><input type="checkbox" name="completed" <?php checked( $g->completed, 1 ); ?>> Completed</label>
						<label><input type="checkbox" name="on_list" <?php checked( $g->on_list, 1 ); ?>> On my list</label>
						<label><input type="checkbox" name="hidden" <?php checked( $g->hidden, 1 ); ?>> Hide</label>
					</div>
					<div class="xbt-editor-actions">
						<button type="button" class="xbt-save">Save changes</button>
						<button type="button" class="xbt-recheck">Check TrueAchievements again</button>
						<span class="xbt-status" aria-live="polite"></span>
					</div>
				</div>
			<?php endif; ?>
		</li>
		<?php
		return ob_get_clean();
	}

	public static function ajax_save() {
		check_ajax_referer( 'xbt_edit', 'nonce' );
		if ( ! self::can_edit() ) {
			wp_send_json_error( 'Not allowed.', 403 );
		}

		$id  = (int) ( $_POST['id'] ?? 0 );
		$row = XBT_DB::get( $id );
		if ( ! $row ) {
			wp_send_json_error( 'Game not found.', 404 );
		}

		$ta = esc_url_raw( wp_unslash( $_POST['ta_url'] ?? '' ) );

		$data = [
			'notes'     => sanitize_textarea_field( wp_unslash( $_POST['notes'] ?? '' ) ),
			'completed' => ! empty( $_POST['completed'] ) ? 1 : 0,
			'on_list'   => ! empty( $_POST['on_list'] ) ? 1 : 0,
			'hidden'    => ! empty( $_POST['hidden'] ) ? 1 : 0,
		];

		if ( $ta ) {
			$data['ta_url']         = $ta;
			$data['ta_manual']      = 1;
			$data['ta_walkthrough'] = false !== strpos( $ta, '/walkthrough' ) ? 1 : 0;
		} elseif ( $row->ta_manual ) {
			// Cleared a manual link: hand it back to auto-detection.
			$data['ta_manual']  = 0;
			$data['ta_checked'] = null;
			$data['ta_url']     = null;
		}

		XBT_DB::update( $id, $data );
		wp_send_json_success( [ 'html' => self::row( XBT_DB::get( $id ) ) ] );
	}

	public static function ajax_recheck() {
		check_ajax_referer( 'xbt_edit', 'nonce' );
		if ( ! self::can_edit() ) {
			wp_send_json_error( 'Not allowed.', 403 );
		}

		$id  = (int) ( $_POST['id'] ?? 0 );
		$row = XBT_DB::get( $id );
		if ( ! $row ) {
			wp_send_json_error( 'Game not found.', 404 );
		}

		$r = XBT_TA::check( $row->name );
		XBT_DB::update( $id, [
			'ta_url'         => $r['url'],
			'ta_walkthrough' => $r['walkthrough'],
			'ta_manual'      => 0,
			'ta_checked'     => current_time( 'mysql', true ),
		] );

		wp_send_json_success( [ 'html' => self::row( XBT_DB::get( $id ) ) ] );
	}
}
