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
 * Tuning for the WebView page resolver.
 *
 * The site rate-limits the app's own HTTP client far more harshly than a real
 * browser: from the app, page calls closer than ~1.7s apart earn a 429; from a
 * browser the same calls at 250ms sail through, which points at the network
 * fingerprint, not the headers. A WebView *is* a browser - WebKit, the engine
 * Safari runs on - so resolving pages inside one lets them go at browser pace.
 * This resolves a front batch up front so the reader opens with pages already
 * in hand; the rest stay lazy markers the interceptor resolves as it reaches
 * them. Kept modest so the reader still opens quickly if the batch is slow.
 */
export const WEBVIEW_PAGE_CAP = 120;
export const WEBVIEW_START_CONCURRENCY = 2;
export const WEBVIEW_MAX_CONCURRENCY = 4;
export const WEBVIEW_BUDGET_MS = 18_000;

/**
 * Builds the script the WebView runs: an adaptive worker pool that resolves the
 * chapter's page addresses through the same API the site's own reader calls.
 *
 * The WebView is not held to the app client's harsh limit, so it need not crawl
 * one page at a time - it runs a few fetches at once. It starts cautious, widens
 * the concurrency while every reply is clean, and on a 429 drops straight back
 * to one at a time and waits out the stated penalty.
 *
 * The reader token is the catch: it expires after ~35 mints (the API answers
 * `403 Invalid or expired reader token`), which is why a long chapter used to
 * load fast then crawl once the first token ran dry. So a 403 mints a fresh
 * token - one refresh shared across the workers - from the reader page and the
 * refused page is retried. Refused, expired-out, or dropped pages are requeued a
 * few times; a 429 penalty long enough to be a real cooldown abandons the rest
 * to the lazy path that is built to sit those out. It returns a Promise -
 * Paperback awaits it - with a JSON summary (ordered URLs, how many landed, the
 * refusals and token refreshes, the concurrency it settled on) the caller parses
 * and logs.
 */
export function buildPageResolverInject(
  chapterId: string,
  token: string,
  readerUrl: string,
  total: number,
  cap: number,
  startConcurrency: number,
  maxConcurrency: number,
  budgetMs: number,
): string {
  return `
return new Promise(function (resolve) {
  var CID = ${JSON.stringify(chapterId)};
  var READER = ${JSON.stringify(readerUrl)};
  var LIMIT = Math.min(${total}, ${cap});
  var MAX_C = ${maxConcurrency};
  var BUDGET = ${budgetMs};
  var HEADER = ${JSON.stringify(READER_TOKEN_HEADER)};
  var LONG_PENALTY = 10000;
  var MAX_ATTEMPTS = 6;
  var MAX_REFRESHES = Math.ceil(LIMIT / 25) + 3;
  var token = ${JSON.stringify(token)};
  var refreshing = null;
  var results = new Array(LIMIT).fill(null);
  var queue = [];
  for (var k = 0; k < LIMIT; k += 1) { queue.push(k); }
  var conc = ${startConcurrency};
  var got = 0;
  var r429 = 0;
  var r403 = 0;
  var refreshes = 0;
  var running = 0;
  var cleanStreak = 0;
  var attempts = {};
  var pauseUntil = 0;
  var started = Date.now();
  var finished = false;
  var resumePending = false;

  function finish() {
    if (finished) { return; }
    finished = true;
    resolve(JSON.stringify({ urls: results, got: got, r429: r429, r403: r403, refreshes: refreshes, conc: conc, ms: Date.now() - started }));
  }

  function requeue(idx) {
    attempts[idx] = (attempts[idx] || 0) + 1;
    if (attempts[idx] <= MAX_ATTEMPTS) { queue.push(idx); }
  }

  function refreshToken() {
    if (refreshing) { return refreshing; }
    // If refreshing has stopped helping (a challenge, or a cap the token cannot
    // dodge), give up rather than burn the whole budget re-fetching the reader.
    if (refreshes >= MAX_REFRESHES) { return Promise.resolve(); }
    refreshes += 1;
    refreshing = fetch(READER, { headers: { accept: "text/html" }, cache: "no-store" })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var m = html.match(/readerToken['"]?\\s*:\\s*['"]([^'"]{8,})['"]/);
        if (m) { token = m[1]; }
        refreshing = null;
      })
      .catch(function () { refreshing = null; });
    return refreshing;
  }

  function tick() {
    if (finished) { return; }
    if (Date.now() - started > BUDGET) { finish(); return; }
    if (queue.length === 0 && running === 0) { finish(); return; }
    var paused = Date.now() < pauseUntil;
    while (!paused && running < conc && queue.length > 0) {
      run(queue.shift());
    }
    if (paused && running === 0 && !resumePending) {
      resumePending = true;
      setTimeout(function () { resumePending = false; tick(); }, Math.min(Math.max(pauseUntil - Date.now() + 20, 20), 2000));
    }
  }

  function run(idx) {
    running += 1;
    // Remember which token this request used, so a burst of 403s from workers
    // that all shared one dead token triggers a single refresh, not one each.
    var sent = token;
    var headers = { accept: "application/json" };
    headers[HEADER] = sent;
    fetch("/api/chapter/" + CID + "/page/" + idx, { headers: headers })
      .then(function (r) {
        if (r.status === 429 || r.headers.get("cf-mitigated")) {
          r429 += 1;
          cleanStreak = 0;
          conc = 1;
          var ra = parseInt(r.headers.get("retry-after") || "0", 10) * 1000;
          if (ra > LONG_PENALTY) { queue.length = 0; return null; }
          pauseUntil = Date.now() + (ra > 0 ? ra : 1200);
          requeue(idx);
          return null;
        }
        if (r.status === 403) {
          // The reader token has expired - mint a fresh one and try again, but
          // only if nobody has already replaced the token this request used.
          r403 += 1;
          requeue(idx);
          if (token === sent) { return refreshToken(); }
          return null;
        }
        if (r.status !== 200) { return null; }
        return r.json().then(function (j) {
          if (j && j.url) { results[idx] = j.url; got += 1; }
          cleanStreak += 1;
          if (cleanStreak % 6 === 0 && conc < MAX_C && Date.now() >= pauseUntil) { conc += 1; }
        });
      })
      .catch(function () {
        // A dropped connection under load is not a refusal - retry it a few
        // times rather than surrender the page to the slow lazy path.
        requeue(idx);
      })
      .then(function () { running -= 1; tick(); });
  }

  tick();
});
`;
}

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
export const MIN_PAGE_GAP_MS = 800;

export const MAX_PAGE_GAP_MS = 6000;
export const GAP_INCREASE_MS = 750;
export const GAP_DECAY_MS = 150;
/** Consecutive successes before easing the gap back down. */
export const GAP_DECAY_AFTER = 5;

/**
 * After this many clean pages at the settled floor, probe a little faster.
 *
 * Finding the wall once and then holding well above it for the rest of a long
 * chapter wastes time on pages that would have been served quicker. So after a
 * sustained clean run the remembered wall is relaxed a step, letting the pace
 * creep toward what the connection actually allows; a fresh refusal pushes it
 * straight back.
 */
export const REPROBE_AFTER = 6;

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

/**
 * The most a single resolution waits out a rate-limit penalty in one go.
 *
 * A refused page must still load - a blank page in the middle stops the reader
 * dead - so it waits out the penalty and retries rather than failing. But it
 * waits in bounded steps and gives the lock back between them, so it holds the
 * penalty for itself without freezing pages the reader has already loaded, and
 * the wait never outlasts the app's own patience for a single request.
 */
export const COOLDOWN_STEP_MS = 12_000;

/** How many penalty-steps a page will wait through before giving up. */
export const COOLDOWN_MAX_STEPS = 8;

/** How far clear of a known refusal the pace is allowed to settle. */
export const KNOWN_BAD_MARGIN_MS = 300;

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
