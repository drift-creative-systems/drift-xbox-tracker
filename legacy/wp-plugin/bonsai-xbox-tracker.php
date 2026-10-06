<?php
/**
 * Plugin Name: Bonsai Xbox Tracker
 * Description: Pulls your Xbox games and achievement progress from OpenXBL, matches TrueAchievements walkthroughs, and displays it all with [xbox_tracker].
 * Version:     1.0.0
 * Author:      Bonsai Digital Collective
 * Text Domain: bonsai-xbt
 */

defined( 'ABSPATH' ) || exit;

define( 'XBT_VERSION', '1.0.0' );
define( 'XBT_PATH', plugin_dir_path( __FILE__ ) );
define( 'XBT_URL', plugin_dir_url( __FILE__ ) );
define( 'XBT_CRON_HOOK', 'xbt_cron_sync' );

require_once XBT_PATH . 'inc/class-xbt-db.php';
require_once XBT_PATH . 'inc/class-xbt-api.php';
require_once XBT_PATH . 'inc/class-xbt-ta.php';
require_once XBT_PATH . 'inc/class-xbt-sync.php';
require_once XBT_PATH . 'inc/class-xbt-import.php';
require_once XBT_PATH . 'inc/class-xbt-admin.php';
require_once XBT_PATH . 'inc/class-xbt-frontend.php';

register_activation_hook( __FILE__, function () {
	XBT_DB::install();
	if ( ! wp_next_scheduled( XBT_CRON_HOOK ) ) {
		wp_schedule_event( time() + 300, 'hourly', XBT_CRON_HOOK );
	}
} );

register_deactivation_hook( __FILE__, function () {
	wp_clear_scheduled_hook( XBT_CRON_HOOK );
} );

add_action( XBT_CRON_HOOK, [ 'XBT_Sync', 'run' ] );
add_action( 'plugins_loaded', [ 'XBT_DB', 'maybe_upgrade' ] );

XBT_Admin::init();
XBT_Frontend::init();

/**
 * Settings helper.
 */
function xbt_opt( $key, $default = '' ) {
	$opts = get_option( 'xbt_settings', [] );
	return isset( $opts[ $key ] ) && '' !== $opts[ $key ] ? $opts[ $key ] : $default;
}
