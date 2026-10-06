<?php
defined( 'ABSPATH' ) || exit;

class XBT_DB {

	const DB_VERSION = '1.0';

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'xbt_games';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		dbDelta( "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			title_id varchar(32) DEFAULT NULL,
			name varchar(255) NOT NULL,
			name_key varchar(191) NOT NULL,
			image text,
			platform varchar(64) DEFAULT NULL,
			gs_current int(11) NOT NULL DEFAULT 0,
			gs_total int(11) NOT NULL DEFAULT 0,
			ach_current int(11) NOT NULL DEFAULT 0,
			ach_total int(11) NOT NULL DEFAULT 0,
			progress tinyint(3) unsigned NOT NULL DEFAULT 0,
			last_played datetime DEFAULT NULL,
			ta_url text,
			ta_walkthrough tinyint(1) DEFAULT NULL,
			ta_checked datetime DEFAULT NULL,
			ta_manual tinyint(1) NOT NULL DEFAULT 0,
			completed tinyint(1) NOT NULL DEFAULT 0,
			on_list tinyint(1) NOT NULL DEFAULT 0,
			hidden tinyint(1) NOT NULL DEFAULT 0,
			notes text,
			source varchar(16) NOT NULL DEFAULT 'xbox',
			updated datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY name_key (name_key),
			KEY title_id (title_id),
			KEY last_played (last_played)
		) {$charset};" );

		update_option( 'xbt_db_version', self::DB_VERSION );
	}

	public static function maybe_upgrade() {
		if ( get_option( 'xbt_db_version' ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	/**
	 * Normalise a game name so "Assassin's Creed® Odyssey" and
	 * "Assassins Creed Odyssey" resolve to the same key.
	 */
	public static function key( $name ) {
		$name = html_entity_decode( $name, ENT_QUOTES, 'UTF-8' );
		$name = str_replace( [ '™', '®', '©', '’', "'", '`' ], '', $name );
		$name = remove_accents( $name );
		$name = strtolower( $name );
		$name = preg_replace( '/\((xbox series x\|s|xbox one|xbox 360|windows|pc)\)/', ' ', $name );
		$name = preg_replace( '/[^a-z0-9]+/', ' ', $name );
		return substr( trim( preg_replace( '/\s+/', ' ', $name ) ), 0, 190 );
	}

	public static function get_by_key( $key ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE name_key = %s', $key ) );
	}

	public static function get_by_title_id( $title_id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE title_id = %s', $title_id ) );
	}

	/**
	 * Match an Xbox title to a list row via the TA URL you saved,
	 * which catches "Bladerunner" vs "Blade Runner: Enhanced Edition".
	 */
	public static function get_by_ta_slug( $slug ) {
		global $wpdb;
		if ( '' === $slug ) {
			return null;
		}
		return $wpdb->get_row( $wpdb->prepare(
			'SELECT * FROM ' . self::table() . " WHERE title_id IS NULL AND ta_url LIKE %s LIMIT 1",
			'%/game/' . $wpdb->esc_like( $slug ) . '/%'
		) );
	}

	public static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d', $id ) );
	}

	public static function insert( array $data ) {
		global $wpdb;
		$data['updated'] = current_time( 'mysql' );
		$wpdb->insert( self::table(), $data );
		return (int) $wpdb->insert_id;
	}

	public static function update( $id, array $data ) {
		global $wpdb;
		$data['updated'] = current_time( 'mysql' );
		return $wpdb->update( self::table(), $data, [ 'id' => (int) $id ] );
	}

	public static function all( $include_hidden = false ) {
		global $wpdb;
		$where = $include_hidden ? '' : 'WHERE hidden = 0';
		return $wpdb->get_results( 'SELECT * FROM ' . self::table() . " {$where} ORDER BY last_played IS NULL, last_played DESC, name ASC" );
	}

	public static function needing_ta_check( $limit ) {
		global $wpdb;
		return $wpdb->get_results( $wpdb->prepare(
			'SELECT * FROM ' . self::table() . '
			 WHERE ta_manual = 0 AND hidden = 0
			   AND ( ta_checked IS NULL OR ta_checked < %s )
			 ORDER BY ta_checked IS NOT NULL, last_played IS NULL, last_played DESC
			 LIMIT %d',
			gmdate( 'Y-m-d H:i:s', strtotime( '-30 days' ) ),
			$limit
		) );
	}
}
