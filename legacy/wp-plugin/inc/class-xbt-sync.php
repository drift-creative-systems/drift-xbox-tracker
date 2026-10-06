<?php
defined( 'ABSPATH' ) || exit;

class XBT_Sync {

	/**
	 * Pull titles from Xbox, upsert, then check a handful of TA walkthroughs.
	 */
	public static function run( $ta_limit = null ) {
		if ( get_transient( 'xbt_sync_lock' ) ) {
			return new WP_Error( 'xbt_locked', 'A sync is already running.' );
		}
		set_transient( 'xbt_sync_lock', 1, 10 * MINUTE_IN_SECONDS );
		@set_time_limit( 300 );

		$titles = XBT_API::titles();
		if ( is_wp_error( $titles ) ) {
			delete_transient( 'xbt_sync_lock' );
			update_option( 'xbt_last_error', $titles->get_error_message() );
			return $titles;
		}

		$new = 0;
		$upd = 0;

		foreach ( $titles as $t ) {
			if ( '' === $t['name'] ) {
				continue;
			}

			// Skip apps (Netflix, YouTube etc.) — they have no achievements.
			if ( 0 === $t['gs_total'] && 0 === $t['ach_total'] && xbt_opt( 'skip_apps', '1' ) ) {
				continue;
			}

			$key = XBT_DB::key( $t['name'] );
			$row = ( $t['title_id'] ? XBT_DB::get_by_title_id( $t['title_id'] ) : null ) ?: XBT_DB::get_by_key( $key )
				?: XBT_DB::get_by_ta_slug( XBT_TA::slug( $t['name'] ) );

			$data = [
				'title_id'    => $t['title_id'],
				'image'       => $t['image'],
				'platform'    => $t['platform'],
				'gs_current'  => $t['gs_current'],
				'gs_total'    => $t['gs_total'],
				'ach_current' => $t['ach_current'],
				'ach_total'   => $t['ach_total'],
				'progress'    => $t['progress'],
				'last_played' => $t['last_played'],
			];

			if ( $t['progress'] >= 100 ) {
				$data['completed'] = 1;
			}

			if ( $row ) {
				// Keep the name from your imported list if you had one; it's often tidier.
				if ( 'xbox' === $row->source ) {
					$data['name'] = $t['name'];
				}
				XBT_DB::update( $row->id, $data );
				$upd++;
			} else {
				$data['name']     = $t['name'];
				$data['name_key'] = $key;
				$data['source']   = 'xbox';
				XBT_DB::insert( $data );
				$new++;
			}
		}

		$profile = XBT_API::profile();
		if ( ! is_wp_error( $profile ) ) {
			update_option( 'xbt_profile', $profile, false );
		}

		$ta = XBT_TA::check_batch( null === $ta_limit ? (int) xbt_opt( 'ta_batch', 10 ) : $ta_limit );

		update_option( 'xbt_last_sync', current_time( 'mysql' ), false );
		delete_option( 'xbt_last_error' );
		delete_transient( 'xbt_sync_lock' );

		return compact( 'new', 'upd', 'ta' );
	}
}
