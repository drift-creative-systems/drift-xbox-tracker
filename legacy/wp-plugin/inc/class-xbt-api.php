<?php
defined( 'ABSPATH' ) || exit;

/**
 * OpenXBL (xbl.io) client. Free personal key covers this comfortably:
 * one call per sync returns every title with achievement totals.
 */
class XBT_API {

	const BASE = 'https://xbl.io/api/v2/';

	public static function request( $endpoint ) {
		$key = xbt_opt( 'api_key' );
		if ( ! $key ) {
			return new WP_Error( 'xbt_no_key', 'Add your OpenXBL API key in Settings → Xbox Tracker.' );
		}

		$res = wp_remote_get( self::BASE . ltrim( $endpoint, '/' ), [
			'timeout' => 30,
			'headers' => [
				'X-Authorization' => $key,
				'Accept'          => 'application/json',
				'Accept-Language' => 'en-GB',
			],
		] );

		if ( is_wp_error( $res ) ) {
			return $res;
		}

		$code = wp_remote_retrieve_response_code( $res );
		$body = json_decode( wp_remote_retrieve_body( $res ), true );

		if ( 200 !== $code || ! is_array( $body ) ) {
			return new WP_Error( 'xbt_api', sprintf( 'OpenXBL returned HTTP %d on %s.', $code, $endpoint ) );
		}

		return $body;
	}

	/**
	 * Every title on the account with achievement progress.
	 * Returns a flat, predictable array regardless of API shape quirks.
	 */
	public static function titles() {
		$body = self::request( 'achievements' );
		if ( is_wp_error( $body ) ) {
			return $body;
		}

		$titles = $body['titles'] ?? ( $body['content']['titles'] ?? [] );
		$out    = [];

		foreach ( $titles as $t ) {
			$ach = $t['achievement'] ?? [];
			$out[] = [
				'title_id'    => (string) ( $t['titleId'] ?? '' ),
				'name'        => (string) ( $t['name'] ?? '' ),
				'image'       => (string) ( $t['displayImage'] ?? '' ),
				'platform'    => implode( ', ', array_map( [ __CLASS__, 'device_label' ], (array) ( $t['devices'] ?? [] ) ) ),
				'gs_current'  => (int) ( $ach['currentGamerscore'] ?? 0 ),
				'gs_total'    => (int) ( $ach['totalGamerscore'] ?? 0 ),
				'ach_current' => (int) ( $ach['currentAchievements'] ?? 0 ),
				'ach_total'   => (int) ( $ach['totalAchievements'] ?? 0 ),
				'progress'    => (int) ( $ach['progressPercentage'] ?? 0 ),
				'last_played' => ! empty( $t['titleHistory']['lastTimePlayed'] )
					? gmdate( 'Y-m-d H:i:s', strtotime( $t['titleHistory']['lastTimePlayed'] ) )
					: null,
			];
		}

		return $out;
	}

	/**
	 * Profile summary for the header (gamertag, total gamerscore, avatar).
	 */
	public static function profile() {
		$body = self::request( 'account' );
		if ( is_wp_error( $body ) ) {
			return $body;
		}

		$settings = $body['profileUsers'][0]['settings'] ?? [];
		$map      = [];
		foreach ( $settings as $s ) {
			$map[ $s['id'] ] = $s['value'];
		}

		return [
			'gamertag'  => $map['Gamertag'] ?? '',
			'gamerscore'=> (int) ( $map['Gamerscore'] ?? 0 ),
			'avatar'    => $map['GameDisplayPicRaw'] ?? '',
		];
	}

	private static function device_label( $d ) {
		$map = [
			'XboxSeries' => 'Series X|S',
			'XboxOne'    => 'Xbox One',
			'Xbox360'    => 'Xbox 360',
			'PC'         => 'PC',
			'Win32'      => 'PC',
		];
		return $map[ $d ] ?? $d;
	}
}
