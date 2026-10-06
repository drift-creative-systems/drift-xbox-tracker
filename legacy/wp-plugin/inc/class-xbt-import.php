<?php
defined( 'ABSPATH' ) || exit;

/**
 * One-off import of the existing Google Sheet (File → Download → CSV).
 * Expected columns: Done, Game, %, Walkthrough, TA URL, Notes.
 * Everything imported is flagged "on my list", so your backlog of
 * unstarted games survives alongside what Xbox reports.
 */
class XBT_Import {

	public static function from_csv( $path ) {
		$fh = fopen( $path, 'r' );
		if ( ! $fh ) {
			return new WP_Error( 'xbt_csv', 'Could not read the uploaded file.' );
		}

		$added   = 0;
		$merged  = 0;
		$skipped = 0;
		$line    = 0;

		while ( false !== ( $cols = fgetcsv( $fh ) ) ) {
			$line++;
			$name = trim( $cols[1] ?? '' );

			if ( '' === $name || ( 1 === $line && 'game' === strtolower( $name ) ) ) {
				continue;
			}

			$done   = 'TRUE' === strtoupper( trim( $cols[0] ?? '' ) );
			$ta_url = esc_url_raw( trim( $cols[4] ?? '' ) );
			$notes  = sanitize_textarea_field( $cols[5] ?? '' );
			$has_wt = 'TRUE' === strtoupper( trim( $cols[3] ?? '' ) );
			$key    = XBT_DB::key( $name );
			$row    = XBT_DB::get_by_key( $key );

			$data = [
				'on_list'   => 1,
				'completed' => $done ? 1 : 0,
			];

			if ( $ta_url ) {
				$data['ta_url']         = $ta_url;
				$data['ta_walkthrough'] = ( $has_wt || false !== strpos( $ta_url, '/walkthrough' ) ) ? 1 : 0;
				$data['ta_manual']      = 1;
				$data['ta_checked']     = current_time( 'mysql', true );
			}
			if ( $notes ) {
				$data['notes'] = $notes;
			}

			if ( $row ) {
				XBT_DB::update( $row->id, $data );
				$merged++;
			} else {
				$pct = (int) preg_replace( '/[^0-9]/', '', $cols[2] ?? '0' );
				XBT_DB::insert( array_merge( $data, [
					'name'     => sanitize_text_field( $name ),
					'name_key' => $key,
					'progress' => min( 100, $pct ),
					'source'   => 'list',
				] ) ) ? $added++ : $skipped++;
			}
		}

		fclose( $fh );
		return compact( 'added', 'merged', 'skipped' );
	}
}
