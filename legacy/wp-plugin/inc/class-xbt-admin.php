<?php
defined( 'ABSPATH' ) || exit;

class XBT_Admin {

	public static function init() {
		add_action( 'admin_menu', [ __CLASS__, 'menu' ] );
		add_action( 'admin_init', [ __CLASS__, 'register' ] );
		add_action( 'admin_post_xbt_sync', [ __CLASS__, 'handle_sync' ] );
		add_action( 'admin_post_xbt_import', [ __CLASS__, 'handle_import' ] );
	}

	public static function menu() {
		add_options_page( 'Xbox Tracker', 'Xbox Tracker', 'manage_options', 'xbt', [ __CLASS__, 'page' ] );
	}

	public static function register() {
		register_setting( 'xbt', 'xbt_settings', [
			'sanitize_callback' => function ( $in ) {
				return [
					'api_key'     => sanitize_text_field( $in['api_key'] ?? '' ),
					'ta_gamer_id' => preg_replace( '/[^0-9]/', '', $in['ta_gamer_id'] ?? '' ),
					'ta_batch'    => max( 0, min( 50, (int) ( $in['ta_batch'] ?? 10 ) ) ),
					'skip_apps'   => empty( $in['skip_apps'] ) ? '0' : '1',
					'visibility'  => in_array( $in['visibility'] ?? '', [ 'public', 'private' ], true ) ? $in['visibility'] : 'private',
				];
			},
		] );
	}

	public static function page() {
		global $wpdb;
		$count  = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . XBT_DB::table() );
		$last   = get_option( 'xbt_last_sync' );
		$error  = get_option( 'xbt_last_error' );
		$notice = isset( $_GET['xbt_msg'] ) ? sanitize_text_field( wp_unslash( $_GET['xbt_msg'] ) ) : '';
		?>
		<div class="wrap">
			<h1>Xbox Tracker</h1>

			<?php if ( $notice ) : ?>
				<div class="notice notice-info is-dismissible"><p><?php echo esc_html( $notice ); ?></p></div>
			<?php endif; ?>
			<?php if ( $error ) : ?>
				<div class="notice notice-error"><p>Last sync failed: <?php echo esc_html( $error ); ?></p></div>
			<?php endif; ?>

			<p>
				<?php echo esc_html( $count ); ?> games stored.
				<?php echo $last ? 'Last synced ' . esc_html( mysql2date( 'd/m/Y H:i', $last ) ) . '.' : 'Not synced yet.'; ?>
				Syncs hourly. Display with <code>[xbox_tracker]</code>.
			</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'xbt' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="xbt_key">OpenXBL API key</label></th>
						<td>
							<input id="xbt_key" type="password" class="regular-text" name="xbt_settings[api_key]" value="<?php echo esc_attr( xbt_opt( 'api_key' ) ); ?>" autocomplete="off">
							<p class="description">Sign in with your Xbox account at xbl.io and copy your personal API key.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="xbt_gid">TrueAchievements gamer ID</label></th>
						<td>
							<input id="xbt_gid" type="text" class="small-text" name="xbt_settings[ta_gamer_id]" value="<?php echo esc_attr( xbt_opt( 'ta_gamer_id' ) ); ?>">
							<p class="description">Optional. Adds <code>?gamerid=</code> to achievement links so TA shows your progress.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="xbt_batch">Walkthrough checks per sync</label></th>
						<td>
							<input id="xbt_batch" type="number" min="0" max="50" class="small-text" name="xbt_settings[ta_batch]" value="<?php echo esc_attr( xbt_opt( 'ta_batch', 10 ) ); ?>">
							<p class="description">Games are checked against TrueAchievements a few at a time and rechecked every 30 days.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Options</th>
						<td>
							<label><input type="checkbox" name="xbt_settings[skip_apps]" value="1" <?php checked( xbt_opt( 'skip_apps', '1' ), '1' ); ?>> Ignore apps and titles with no achievements</label><br>
							<label><input type="radio" name="xbt_settings[visibility]" value="private" <?php checked( xbt_opt( 'visibility', 'private' ), 'private' ); ?>> Only show the tracker to logged-in admins</label><br>
							<label><input type="radio" name="xbt_settings[visibility]" value="public" <?php checked( xbt_opt( 'visibility', 'private' ), 'public' ); ?>> Show the tracker publicly (editing stays admin-only)</label>
						</td>
					</tr>
				</table>
				<?php submit_button( 'Save settings' ); ?>
			</form>

			<hr>

			<h2>Sync now</h2>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="xbt_sync">
				<?php wp_nonce_field( 'xbt_sync' ); ?>
				<p><?php submit_button( 'Sync from Xbox', 'secondary', 'submit', false ); ?></p>
			</form>

			<h2>Import your existing list</h2>
			<p>In Google Sheets choose File → Download → Comma-separated values, then upload it here. Columns: Done, Game, %, Walkthrough, TA URL, Notes. Your TA links and notes are kept and never overwritten by automatic checks.</p>
			<form method="post" enctype="multipart/form-data" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="xbt_import">
				<?php wp_nonce_field( 'xbt_import' ); ?>
				<input type="file" name="xbt_csv" accept=".csv,text/csv" required>
				<?php submit_button( 'Import CSV', 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}

	public static function handle_sync() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Not allowed.' );
		}
		check_admin_referer( 'xbt_sync' );

		$r   = XBT_Sync::run();
		$msg = is_wp_error( $r )
			? $r->get_error_message()
			: sprintf( 'Synced: %d new, %d updated, %d walkthroughs checked.', $r['new'], $r['upd'], $r['ta'] );

		self::back( $msg );
	}

	public static function handle_import() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Not allowed.' );
		}
		check_admin_referer( 'xbt_import' );

		if ( empty( $_FILES['xbt_csv']['tmp_name'] ) || UPLOAD_ERR_OK !== $_FILES['xbt_csv']['error'] ) {
			self::back( 'Choose a CSV file to import.' );
		}

		$r   = XBT_Import::from_csv( $_FILES['xbt_csv']['tmp_name'] );
		$msg = is_wp_error( $r )
			? $r->get_error_message()
			: sprintf( 'Imported: %d added, %d merged with Xbox games, %d skipped.', $r['added'], $r['merged'], $r['skipped'] );

		self::back( $msg );
	}

	private static function back( $msg ) {
		wp_safe_redirect( add_query_arg( 'xbt_msg', rawurlencode( $msg ), admin_url( 'options-general.php?page=xbt' ) ) );
		exit;
	}
}
