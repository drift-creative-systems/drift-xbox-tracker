<?php
defined( 'ABSPATH' ) || exit;

/**
 * TrueAchievements has no public API, so this:
 *  1. builds TA's URL slug from the game name (matches their pattern for most titles),
 *  2. checks whether /walkthrough resolves to a real walkthrough page,
 *  3. falls back to a TA search link when the slug can't be confirmed.
 * Anything you set manually is never overwritten.
 */
class XBT_TA {

	const BASE = 'https://www.trueachievements.com';

	public static function slug( $name ) {
		$name = html_entity_decode( $name, ENT_QUOTES, 'UTF-8' );
		$name = str_replace( [ '™', '®', '©', '’', "'", '`', '.', ',', '!', '?' ], '', $name );
		$name = str_replace( '&', 'and', $name );
		$name = preg_replace( '/\s*\((xbox series x\|s|xbox one|xbox 360|windows|pc)\)\s*/i', ' ', $name );
		$name = remove_accents( $name );
		$name = preg_replace( '/[^A-Za-z0-9]+/', '-', $name );
		return trim( $name, '-' );
	}

	public static function search_url( $name ) {
		return self::BASE . '/searchresults.aspx?search=' . rawurlencode( $name );
	}

	public static function achievements_url( $name ) {
		$url = self::BASE . '/game/' . self::slug( $name ) . '/achievements';
		$gid = xbt_opt( 'ta_gamer_id' );
		return $gid ? add_query_arg( 'gamerid', $gid, $url ) : $url;
	}

	/**
	 * @return array{url:string, walkthrough:int|null}
	 *   walkthrough: 1 = found, 0 = game found but no walkthrough, null = couldn't tell
	 */
	public static function check( $name ) {
		$slug = self::slug( $name );
		$wt   = self::BASE . '/game/' . $slug . '/walkthrough';

		$res = wp_remote_get( $wt, [
			'timeout'     => 15,
			'redirection' => 3,
			'user-agent'  => 'Mozilla/5.0 (compatible; BonsaiXboxTracker/1.0; +' . home_url() . ')',
		] );

		if ( is_wp_error( $res ) ) {
			return [ 'url' => self::search_url( $name ), 'walkthrough' => null ];
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$body = wp_remote_retrieve_body( $res );

		// Cloudflare challenge / rate limit — don't record a false negative.
		if ( in_array( $code, [ 403, 429, 503 ], true ) ) {
			return [ 'url' => self::search_url( $name ), 'walkthrough' => null ];
		}

		if ( 404 === $code || false !== stripos( $body, 'Game not found' ) ) {
			return [ 'url' => self::search_url( $name ), 'walkthrough' => null ];
		}

		if ( 200 === $code ) {
			// Walkthrough pages contain a page list; games without one show a "no walkthrough" notice.
			$has = ( false === stripos( $body, 'no walkthrough' ) && false === stripos( $body, 'does not have a walkthrough' ) )
				&& ( false !== stripos( $body, 'walkthrough-page' ) || false !== stripos( $body, 'Walkthrough Page' ) || false !== stripos( $body, '/walkthrough/page' ) );

			return $has
				? [ 'url' => $wt, 'walkthrough' => 1 ]
				: [ 'url' => self::achievements_url( $name ), 'walkthrough' => 0 ];
		}

		return [ 'url' => self::search_url( $name ), 'walkthrough' => null ];
	}

	/**
	 * Check a batch of games, politely spaced. Called from sync.
	 */
	public static function check_batch( $limit ) {
		$rows    = XBT_DB::needing_ta_check( $limit );
		$checked = 0;

		foreach ( $rows as $row ) {
			$r = self::check( $row->name );
			XBT_DB::update( $row->id, [
				'ta_url'         => $r['url'],
				'ta_walkthrough' => $r['walkthrough'],
				'ta_checked'     => current_time( 'mysql', true ),
			] );
			$checked++;
			sleep( 2 );
		}

		return $checked;
	}
}
