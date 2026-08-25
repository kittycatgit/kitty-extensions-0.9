/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://onisaga.com";

/**
 * The user agent every request presents.
 *
 * The app's own default omits the `Version/` and `Safari/` tokens a real
 * Safari always sends, which is the signature rate limiters use to tell a
 * native client from a browser - and the device is throttled far harder than a
 * browser doing the very same thing. This is a complete, ordinary Safari
 * string so the site treats the extension the way it treats the site's own
 * reader.
 */
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * Stand-in for a card the site renders without artwork.
 *
 * An empty string is rejected as an invalid URL and, because covers are
 * converted as an array, one blank cover fails the whole rail. This is a real
 * URL that holds no image, so the app falls through to its own placeholder
 * rather than being handed substitute artwork.
 */
export const FALLBACK_COVER = `${DOMAIN}/_no-cover.png`;

/** Paging and filter state carried between pages of results. */
export type OniSagaSearchMetadata = {
  page?: number;
  genres?: string[];
  completed?: boolean;
};

/**
 * Placeholder page URLs.
 *
 * A chapter's real page URLs are signed and expire ten minutes after they are
 * minted, and each one costs its own API call. Resolving a 157 page chapter up
 * front would therefore both trip the rate limiter and hand the reader links
 * that expire before it reaches them. Instead the chapter reports these
 * markers, and the interceptor swaps each one for a freshly signed URL at the
 * moment the reader actually asks for that page.
 */
export const PAGE_MARKER = "/_pbpage/";

export function pageMarkerUrl(chapterId: string, index: number): string {
  return `${DOMAIN}${PAGE_MARKER}${chapterId}/${index}`;
}

export function parsePageMarker(url: string): { chapterId: string; index: number } | undefined {
  const match = url.match(/\/_pbpage\/([^/]+)\/(\d+)/);
  return match ? { chapterId: match[1]!, index: Number(match[2]) } : undefined;
}

/**
 * Reports a chapter's length and whether the site has finished preparing it.
 *
 * Its `pages` array is always empty - there is no way to fetch every page's
 * address at once, and an address cannot be guessed either, since an unsigned
 * one is refused. So a page still costs a call. What this does give is an
 * authoritative length and an `importing` flag, which is what a chapter the
 * site is still working on reports.
 */
export function pagesInfoUrl(chapterId: string): string {
  return `${DOMAIN}/api/chapter/${chapterId}/pages`;
}

/** The reader API the site itself calls, one page at a time. */
export function pageApiUrl(chapterId: string, index: number): string {
  return `${DOMAIN}/api/chapter/${chapterId}/page/${index}`;
}

export function readerUrl(mangaId: string, chapterId: string): string {
  return `${DOMAIN}/read/${mangaId}/${chapterId}`;
}

/** Header the page API refuses to answer without. */
export const READER_TOKEN_HEADER = "X-Reader-Token";

/**
 * Minimum gap between page-resolution calls.
 *
 * The advertised allowance is 300, but there is a stricter burst limit behind
 * it: going too fast earns a 429 whose penalty lasts far longer than the time
 * saved. This is the pace the site's own reader keeps.
 */
/**
 * Pacing for page resolution, discovered at runtime rather than fixed.
 *
 * The site throttles the app far more sharply than a browser: a no-gap burst
 * of a dozen calls from a browser is answered cleanly, while the app earned
 * refusals at a gap of a second and a half. The rate that applies to this
 * device therefore cannot be measured from anywhere else, so the gap is
 * treated as unknown - it starts cautious, widens whenever the site refuses,
 * and settles back down while it does not.
 *
 * Only the resolution calls are throttled: the images themselves are served
 * without a rate-limit header and answer a back-to-back burst cleanly, so a
 * page costs one metered request, not two.
 */
export const PAGE_REQUEST_GAP_MS = 2000;

/**
 * Floor for the tuned gap.
 *
 * Low enough that a long chapter stays readable - a hundred pages at the floor
 * is a couple of minutes rather than the better part of ten - while still
 * leaving a gap between calls.
 */
export const MIN_PAGE_GAP_MS = 1600;

export const MAX_PAGE_GAP_MS = 6000;
export const GAP_INCREASE_MS = 750;
export const GAP_DECAY_MS = 150;
/** Consecutive successes before easing the gap back down. */
export const GAP_DECAY_AFTER = 6;

/**
 * A refused page is retried rather than abandoned.
 *
 * A single refusal used to fail that page for good, which is why a chapter
 * would load unevenly - most pages fine, the odd one permanently blank. The
 * wait is capped so a retry cannot outlive the app's own request timeout.
 */
export const PAGE_RETRY_ATTEMPTS = 3;
export const MAX_RETRY_WAIT_MS = 8000;

/**
 * Gap between ordinary page fetches (rails, listings, detail pages).
 *
 * The discover screen asks for its rails at once, and three requests in a
 * breath is enough to earn a challenge, which is what leaves a carousel empty.
 * They are spaced lightly - enough to look like browsing, not so much that
 * moving around the app drags.
 */
export const HTML_GAP_MS = 700;

/**
 * The tightest gap the site has refused.
 *
 * Without this the gap eases back down into the same wall it just hit, is
 * refused, backs off, and eases down again - a sawtooth that spends a retry
 * and a cooldown on every lap. Remembering where the wall is lets the pace
 * settle just clear of it instead of rediscovering it.
 */
export const KNOWN_BAD_KEY = "onisaga.knownBad";
export const LAST_REFUSAL_KEY = "onisaga.lastRefusal";

/**
 * A refusal this soon after the previous one is treated as the same episode.
 *
 * The site keeps refusing for a moment after it first does, so those follow-on
 * refusals say nothing about whether the current pace is too fast. Counting
 * them was teaching the pace a wall far slower than the real one - it settled
 * at twice the necessary gap - so only the first refusal of an episode is
 * taken as evidence.
 */
export const REFUSAL_EPISODE_MS = 12_000;

/** How far clear of a known refusal the pace is allowed to settle. */
export const KNOWN_BAD_MARGIN_MS = 500;

export const GAP_KEY = "onisaga.gap";
export const STREAK_KEY = "onisaga.streak";

/**
 * The furthest ahead the paced-slot cursor is trusted.
 *
 * The cursor lives in persistent state, so a reading session that ends mid
 * burst can leave it well in the future. Beyond this it is treated as stale
 * and reset to now, so the next session is never made to wait minutes.
 */
export const MAX_SLOT_LOOKAHEAD_MS = 30_000;

/** A duplicate request waits this long for the original resolution to appear. */
export const INFLIGHT_TTL_MS = 15_000;
export const INFLIGHT_POLL_MS = 150;
export const INFLIGHT_POLLS = 100;

/** How long a 429 is respected for when the reply carries no Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

/** Reader tokens belong to a single chapter and are cached only briefly. */
export const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * How long a resolved page URL is reused.
 *
 * The signed URLs expire ten minutes after they are minted, so they are held a
 * little under that: long enough to serve the app's repeat requests for the
 * same page, short enough that a reused link is never already dead.
 */
export const SIGNED_URL_TTL_MS = 8 * 60 * 1000;

/**
 * Listing routes used for the home rails.
 *
 * `/browse` is deliberately absent: it renders its filter form as some
 * thirteen thousand checkboxes, which makes the page around 14 MB, where these
 * routes are a few hundred kilobytes for more titles.
 */
export const HOME_SECTIONS: { id: string; title: string; path: string; paginates: boolean }[] = [
  // `/home` ignores its page parameter and answers with the same rows every
  // time, so it is reported as a single page rather than scrolling duplicates
  // forever. The other two advance properly.
  { id: "home", title: "Latest Updates", path: "/home", paginates: false },
  { id: "trending", title: "Trending", path: "/trending", paginates: true },
  { id: "top", title: "Top Manga", path: "/top-manga", paginates: true },
];

export const GENRES_SECTION_ID = "genres";

export const SORTING_OPTIONS: SortingOption[] = [];

export const GENRE_CACHE_TTL = 24 * 60 * 60 * 1000;
export const GENRE_STATE_KEY = "onisaga.genres";

export const STATUS_LABELS: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "Hiatus",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  dropped: "Cancelled",
};
