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
 * Tuning for the WebView chapter resolver.
 *
 * The site rate-limits the app's own HTTP client far more harshly than a real
 * browser: from the app, page calls closer than ~1.7s apart earn a 429; from a
 * browser the same calls sail through, which points at the network fingerprint,
 * not the headers. A WebView *is* a browser - WebKit, the engine Safari runs
 * on - so the whole chapter open happens inside one: the reader page, the page
 * count, and every page address, at browser pace. Concurrency starts at the
 * level a phone has been seen to hold without dropping and probes one step
 * higher, easing off on its own if the connection objects.
 */
export const WEBVIEW_PAGE_CAP = 140;
export const WEBVIEW_START_CONCURRENCY = 4;
export const WEBVIEW_MAX_CONCURRENCY = 5;
export const WEBVIEW_BUDGET_MS = 26_000;

/** A resolved chapter is kept briefly so re-opening it costs nothing. The
 * signed addresses live ~10 minutes from MINTING - the cache stamps entries
 * with when resolution started, and this window leaves a cache hit at the very
 * edge still holding several minutes of signature life for the read. */
export const CHAPTER_CACHE_TTL_MS = 4 * 60_000;

/** How many resolved chapters are kept at once. Each entry is a page-URL list
 * a few tens of KB large, so the cache trims itself to the newest few rather
 * than accreting an entry for every chapter ever opened. */
export const CHAPTER_CACHE_MAX_ENTRIES = 8;

export const CHAPTER_CACHE_INDEX_KEY = "onisaga.chapter.index";

export function chapterCacheKey(chapterId: string): string {
  return `onisaga.chapter.${chapterId}`;
}

/**
 * How long after a chapter opens before the NEXT one is resolved behind the
 * read. Late enough that the two chapters' bursts do not land on the site
 * together, early enough that even a quick read of a short chapter finds the
 * next one waiting - and the addresses are still fresh when the reader arrives.
 */
export const PREFETCH_DELAY_MS = 30_000;

/** Ordered chapter lists kept per series so the prefetcher knows what "next"
 * means; trimmed to the few series being read, like the chapter cache. */
export const CHAPTER_LIST_INDEX_KEY = "onisaga.chapters.index";
export const CHAPTER_LIST_MAX_ENTRIES = 3;

export function chapterListKey(mangaId: string): string {
  return `onisaga.chapters.${mangaId}`;
}

/** Budget awareness for the prefetcher. The site refuses after roughly 200
 * mints in a couple of minutes, so a prefetch checks how many addresses have
 * been minted lately and stands down if adding a chapter's worth would crowd
 * that ceiling - the reader's own opens always come first. */
export const MINT_WINDOW_MS = 100_000;
export const MINT_BUDGET = 90;
export const MINTS_KEY = "onisaga.mints";

/** When a resolve meets a 429 the site is actively objecting; no prefetch runs
 * for a while afterwards so the reader's next open is not made to share the
 * penalty. */
export const OBJECTING_COOLDOWN_MS = 120_000;
export const OBJECTING_UNTIL_KEY = "onisaga.objecting";

/**
 * Builds the script the WebView runs: the entire chapter open, in the browser.
 *
 * It fetches the reader page itself (so the throttled app client makes no call
 * at all), reads the token and the page count from it - falling back to the
 * pages API, which also owns the honest "still importing" answer - and then
 * resolves every page address with an adaptive worker pool. The token rides the
 * x-reader-token-next header each reply carries, so it never runs dry
 * mid-chapter; re-fetching the reader page remains only as a fallback, capped
 * so it cannot spin. Refused or dropped pages retry at the FRONT of the queue,
 * keeping the finished region contiguous, and repeated connection drops ease
 * the concurrency back down a step. It returns a Promise - Paperback awaits
 * it - resolving with a JSON summary: the ordered URLs, the total, the token it
 * ended on, and the counters the caller logs. Early outcomes (a Cloudflare
 * page, a chapter still being prepared or imported) come back as flags so the
 * caller can say the right thing instead of guessing.
 */
export function buildChapterResolverInject(
  chapterId: string,
  readerUrl: string,
  cap: number,
  startConcurrency: number,
  maxConcurrency: number,
  budgetMs: number,
): string {
  return `
return new Promise(function (resolve) {
  var CID = ${JSON.stringify(chapterId)};
  var READER = ${JSON.stringify(readerUrl)};
  var CAP = ${cap};
  var MAX_C = ${maxConcurrency};
  var BUDGET = ${budgetMs};
  var HEADER = ${JSON.stringify(READER_TOKEN_HEADER)};
  var LONG_PENALTY = 10000;
  var MAX_ATTEMPTS = 6;
  var started = Date.now();

  function answer(extra) {
    extra.ms = Date.now() - started;
    resolve(JSON.stringify(extra));
  }

  var readerOk = false;

  fetch(READER, { headers: { accept: "text/html" }, cache: "no-store" })
    .then(function (r) { readerOk = r.status === 200; return r.text(); })
    .then(function (html) {
      if (/just a moment|cf-browser-verification|challenge-platform/i.test(html)) {
        answer({ cf: true });
        return;
      }
      // An error page is not a chapter being prepared - hand it back so the
      // app-client path can retry it and surface a challenge the proper way.
      if (!readerOk) { answer({ failed: true }); return; }
      var token = (html.match(/readerToken['"]?\\s*:\\s*['"]([^'"]{8,})['"]/) || [])[1];
      var preparing = /loading pages|hang tight|being processed|preparing/i.test(html);
      if (!token || preparing) { answer({ preparing: true }); return; }
      var m = html.match(/['"]?(?:pageCount|totalPages|pages_count)['"]?\\s*:\\s*(\\d+)/) ||
        html.match(/(\\d+)\\s*pages\\b/i) ||
        html.match(/data-pages=['"](\\d+)['"]/);
      var total = m ? parseInt(m[1], 10) : 0;
      if (total > 0) { pool(token, total); return; }
      var headers = { accept: "application/json" };
      headers[HEADER] = token;
      fetch("/api/chapter/" + CID + "/pages", { headers: headers })
        .then(function (r) { return r.status === 200 ? r.json() : "ERR"; })
        .then(function (j) {
          // Only an honest 200 gets to say the chapter is empty - a refusal or
          // a drop here is a transient, not a removal, so route it to the
          // fallback rather than a permanent-sounding verdict.
          if (j === "ERR") { answer({ failed: true }); return; }
          if (j && j.importing) { answer({ importing: true }); return; }
          var t = j ? parseInt(j.total_pages, 10) || 0 : 0;
          if (t > 0) { pool(token, t); } else { answer({ nopages: true }); }
        })
        .catch(function () { answer({ failed: true }); });
    })
    .catch(function () { answer({ failed: true }); });

  function pool(token, total) {
    // The budget meters page resolution alone - the reader-page discovery that
    // ran before this point must not eat into a long chapter's tail.
    var poolStarted = Date.now();
    var LIMIT = Math.min(total, CAP);
    var MAX_REFRESHES = Math.ceil(LIMIT / 25) + 3;
    var refreshing = null;
    var results = new Array(LIMIT).fill(null);
    var queue = [];
    for (var k = 0; k < LIMIT; k += 1) { queue.push(k); }
    var conc = ${startConcurrency};
    var got = 0;
    var r429 = 0;
    var r403 = 0;
    var odd = {};
    var refreshes = 0;
    var running = 0;
    var cleanStreak = 0;
    var dropStreak = 0;
    var attempts = {};
    var pauseUntil = 0;
    var finished = false;
    var resumePending = false;

    function finish() {
      if (finished) { return; }
      finished = true;
      answer({ urls: results, total: total, token: token, got: got, r429: r429, r403: r403, refreshes: refreshes, conc: conc, odd: odd });
    }

    function requeue(idx) {
      attempts[idx] = (attempts[idx] || 0) + 1;
      // Retry at the FRONT, not the back. A page refused for an expired token
      // or dropped under load should resolve right away - as soon as the token
      // is refreshed - so the finished region stays contiguous. Sent to the
      // back it would land behind the whole chapter and, if the budget runs out
      // first, become a hole in the middle while later pages loaded fine.
      if (attempts[idx] <= MAX_ATTEMPTS) { queue.unshift(idx); }
    }

    function refreshToken() {
      if (refreshing) { return refreshing; }
      // If refreshing has stopped helping (a challenge, or a cap the token
      // cannot dodge), give up rather than burn the budget re-fetching.
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
      if (Date.now() - poolStarted > BUDGET) { finish(); return; }
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
      // Remember which token this request used, so a burst of 403s from
      // workers that all shared one dead token triggers a single refresh.
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
            // The reader token has expired - mint a fresh one and try again,
            // unless somebody already replaced the token this request used.
            r403 += 1;
            requeue(idx);
            if (token === sent) { return refreshToken(); }
            return null;
          }
          if (r.status !== 200) {
            // A 500 or a gateway hiccup is a transient, not a verdict - the
            // same page minted fine moments later on device. Retry it like a
            // drop, bounded, and count it so the log shows what the site said.
            odd[r.status] = (odd[r.status] || 0) + 1;
            requeue(idx);
            return null;
          }
          dropStreak = 0;
          // The token rolls forward: each reply carries the next one to use.
          // Ride it so the token never runs dry mid-chapter, which is what
          // avoids the 403s and the costly reader-page refetches.
          var next = r.headers.get("x-reader-token-next");
          if (next) { token = next; }
          return r.json().then(function (j) {
            if (!(j && j.url)) {
              odd.nourl = (odd.nourl || 0) + 1;
              requeue(idx);
              return;
            }
            results[idx] = j.url;
            got += 1;
            cleanStreak += 1;
            if (cleanStreak % 6 === 0 && conc < MAX_C && Date.now() >= pauseUntil) { conc += 1; }
          });
        })
        .catch(function () {
          // A dropped connection under load is not a refusal - retry it, and
          // if drops keep coming, ease the concurrency back down a step.
          dropStreak += 1;
          if (dropStreak >= 3) { conc = Math.max(1, conc - 1); dropStreak = 0; }
          requeue(idx);
        })
        .then(function () { running -= 1; tick(); });
    }

    tick();
  }
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
