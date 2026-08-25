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

/** Budget awareness for the prefetcher. The site refuses after roughly 200
 * mints in a couple of minutes, so a prefetch checks how many addresses have
 * been minted lately and stands down if adding a chapter's worth would crowd
 * that ceiling - the reader's own opens always come first. */
export const MINT_WINDOW_MS = 120_000;
export const MINTS_KEY = "onisaga.mints";

/** Roughly how many addresses the site will mint for one reader inside the
 * window before it starts refusing (with a long penalty). A chapter open
 * bursts freely up to whatever of this is left, then paces itself down to a
 * sustainable one-at-a-time crawl so a heavy reader glides under the ceiling
 * instead of slamming into it and stalling for minutes. Kept conservatively
 * below where a device log first saw refusals (~150). */
export const MINT_CEILING = 130;

/** When a resolve meets a 429 the site is actively objecting; no prefetch runs
 * for a while afterwards so the reader's next open is not made to share the
 * penalty. */
export const OBJECTING_COOLDOWN_MS = 120_000;
export const OBJECTING_UNTIL_KEY = "onisaga.objecting";

/**
 * Builds the script the WebView runs to mint a chapter's page addresses.
 *
 * The WebView exists for one reason: the site holds it to a browser's generous
 * rate limit while it throttles the app's own client to a crawl. So it is given
 * everything it needs up front - the chapter's length and a reader token the
 * app has already read from the chapter's page - and does nothing but mint. It
 * does not load the reader page itself: that fetch is the app's job, where it
 * demonstrably succeeds, and doing it in here was a second way for a chapter to
 * fail with nothing useful to say about why.
 *
 * The token rides the x-reader-token-next header each reply carries, so it
 * rarely runs dry; re-reading the chapter page for a fresh one is kept only as
 * a fallback for a 403, capped so it cannot spin. Refused or dropped pages
 * retry at the front so the finished run stays contiguous. Once the window's
 * burst budget is spent it keeps a real breath between calls - the rate the
 * site sustains - and only for a short tail, leaving the rest to load as the
 * reader reaches them rather than holding the chapter shut.
 */
export function buildChapterMintInject(
  chapterId: string,
  readerUrl: string,
  token: string,
  total: number,
  cap: number,
  startConcurrency: number,
  maxConcurrency: number,
  budgetMs: number,
  burstBudget: number,
): string {
  return `
return new Promise(function (resolve) {
  var CID = ${JSON.stringify(chapterId)};
  var READER = ${JSON.stringify(readerUrl)};
  var MAX_C = ${maxConcurrency};
  var BUDGET = ${budgetMs};
  var BURST_BUDGET = ${burstBudget};
  var HEADER = ${JSON.stringify(READER_TOKEN_HEADER)};
  var LIMIT = Math.min(${total}, ${cap});
  var LONG_PENALTY = 10000;
  var MAX_ATTEMPTS = 6;
  var PAST_BUDGET_GAP = 900;
  var PACED_TAIL_MS = 7000;
  var MAX_REFRESHES = Math.ceil(LIMIT / 25) + 3;
  var started = Date.now();
  var token = ${JSON.stringify(token)};
  var urls = new Array(LIMIT).fill(null);
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
  var pacedSince = 0;
  var cf = false;
  var refreshing = null;
  var finished = false;
  var resumePending = false;

  function finish() {
    if (finished) { return; }
    finished = true;
    resolve(JSON.stringify({ urls: urls, total: ${total}, token: token, got: got, r429: r429, r403: r403, refreshes: refreshes, conc: conc, cf: cf, odd: odd, ms: Date.now() - started }));
  }

  function requeue(idx) {
    attempts[idx] = (attempts[idx] || 0) + 1;
    // Retry at the FRONT so a page refused for an expired token or dropped
    // under load resolves as soon as the token refreshes, and the finished run
    // stays contiguous rather than leaving a hole in the middle.
    if (attempts[idx] <= MAX_ATTEMPTS) { queue.unshift(idx); }
  }

  function refreshToken() {
    if (refreshing) { return refreshing; }
    if (refreshes >= MAX_REFRESHES) { return Promise.resolve(); }
    refreshes += 1;
    refreshing = fetch(READER, { headers: { accept: "text/html" }, cache: "no-store" })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        // A challenge where a fresh token should be is not something a retry
        // fixes - note it so the caller can say so plainly.
        if (/just a moment|cf-browser-verification|challenge-platform/i.test(html)) { cf = true; refreshing = null; return; }
        var mm = html.match(/readerToken['"]?\\s*:\\s*['"]([^'"]{8,})['"]/);
        if (mm) { token = mm[1]; }
        refreshing = null;
      })
      .catch(function () { refreshing = null; });
    return refreshing;
  }

  function tick() {
    if (finished) { return; }
    if (Date.now() - started > BUDGET) { finish(); return; }
    if (queue.length === 0 && running === 0) { finish(); return; }
    // Once the window's burst budget is spent, hold to one request at a time,
    // and only for a short tail - long enough to carry the reader past the
    // opening pages, not so long that the chapter takes a minute to open.
    var ceilNow = got < BURST_BUDGET ? MAX_C : 1;
    if (conc > ceilNow) { conc = ceilNow; }
    if (got >= BURST_BUDGET) {
      if (pacedSince === 0) { pacedSince = Date.now(); }
      if (Date.now() - pacedSince > PACED_TAIL_MS && running === 0) { finish(); return; }
    }
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
          r403 += 1;
          requeue(idx);
          if (token === sent) { return refreshToken(); }
          return null;
        }
        if (r.status !== 200) {
          // A 500 or a gateway hiccup is a transient, not a verdict - the same
          // page minted fine moments later on device. Retry it like a drop, and
          // count it so the log shows what the site actually said.
          odd[r.status] = (odd[r.status] || 0) + 1;
          requeue(idx);
          return null;
        }
        dropStreak = 0;
        // The token rolls forward: each reply carries the next one to use.
        var next = r.headers.get("x-reader-token-next");
        if (next) { token = next; }
        return r.json().then(function (j) {
          if (!(j && j.url)) {
            odd.nourl = (odd.nourl || 0) + 1;
            requeue(idx);
            return;
          }
          urls[idx] = j.url;
          got += 1;
          cleanStreak += 1;
          if (cleanStreak % 6 === 0 && conc < MAX_C && got < BURST_BUDGET && Date.now() >= pauseUntil) {
            conc += 1;
          }
        });
      })
      .catch(function () {
        // A dropped connection under load is not a refusal - retry it, and if
        // drops keep coming, ease the concurrency back down a step.
        dropStreak += 1;
        if (dropStreak >= 3) { conc = Math.max(1, conc - 1); dropStreak = 0; }
        requeue(idx);
      })
      .then(function () {
        running -= 1;
        // Past the budget, put a real breath between calls: one at a time at
        // browser speed is still quicker than the site sustains.
        if (got >= BURST_BUDGET) { setTimeout(tick, PAST_BUDGET_GAP); } else { tick(); }
      });
  }

  tick();
});
`;
}

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

/** A duplicate request waits this long for the original resolution to appear. */
export const INFLIGHT_TTL_MS = 15_000;
export const INFLIGHT_POLL_MS = 150;
export const INFLIGHT_POLLS = 100;

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
