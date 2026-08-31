/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://onisaga.com";

// The app's own user agent omits the `Version/` and `Safari/` tokens a real
// Safari sends, and clients missing them are throttled far harder.
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// A series page ships its first hundred chapters and hides the rest behind a
// Livewire button, so no amount of `?page=` reaches them. This bounds the loop.
export const MAX_CHAPTER_LOADS = 30;

// Must be a real URL: an empty cover is rejected as invalid and takes the whole
// rail down with it. This one holds no image, so the app draws its placeholder.
export const FALLBACK_COVER = `${DOMAIN}/_no-cover.png`;

export type OniSagaSearchMetadata = {
  page?: number;
  genres?: string[];
  completed?: boolean;
};

// The `pages` array this returns is always empty; only the length and the
// `importing` flag are usable. Every page address still costs its own call.
export function pagesInfoUrl(chapterId: string): string {
  return `${DOMAIN}/api/chapter/${chapterId}/pages`;
}

export function readerUrl(mangaId: string, chapterId: string): string {
  return `${DOMAIN}/read/${mangaId}/${chapterId}`;
}

// The page API refuses to answer without this.
export const READER_TOKEN_HEADER = "X-Reader-Token";

// The site throttles the app's HTTP client far harder than a browser: page
// calls closer than ~1.7s apart earn a 429, the same calls from a WebView pass.
export const WEBVIEW_PAGE_CAP = 140;
// The limiter minds how much is taken over a stretch, not how fast one chapter
// arrives, so mint briskly and let the gap below answer for volume.
export const WEBVIEW_START_CONCURRENCY = 4;
export const WEBVIEW_MAX_CONCURRENCY = 5;
export const WEBVIEW_BUDGET_MS = 26_000;

// Signed page addresses live ~10 minutes from minting, and entries are stamped
// with when resolution started, so keep this comfortably short of that.
export const CHAPTER_CACHE_TTL_MS = 8 * 60_000;

export const CHAPTER_CACHE_MAX_ENTRIES = 8;

export const CHAPTER_CACHE_INDEX_KEY = "onisaga.chapter.index";

export function chapterCacheKey(chapterId: string): string {
  return `onisaga.chapter.${chapterId}`;
}

// Wait between minting one page and the next. The burst limiter is invisible
// and differs per connection - refusals arrive with nearly all of the published
// 300-a-window allowance unspent - so the gap tunes itself against refusals.
export const MINT_GAP_KEY = "onisaga.gap";
export const GAP_START_MS = 0;
export const GAP_MIN_MS = 0;
export const GAP_STEP_UP_MS = 350;
export const GAP_STEP_DOWN_MS = 150;
export const GAP_MAX_MS = 2_000;

// A retry-after longer than this is not worth making the reader wait through.
export const MAX_WAIT_OUT_MS = 20_000;

// Minting happens in a WebView because the site holds a browser to a far more
// generous limit. The chapter length and reader token are passed in already
// fetched, so the script only mints and cannot fail on loading the reader page.
export function buildChapterMintInject(
  chapterId: string,
  readerUrl: string,
  token: string,
  total: number,
  cap: number,
  startConcurrency: number,
  maxConcurrency: number,
  budgetMs: number,
  gapMs: number,
): string {
  return `
return new Promise(function (resolve) {
  var CID = ${JSON.stringify(chapterId)};
  var READER = ${JSON.stringify(readerUrl)};
  var MAX_C = ${maxConcurrency};
  var BUDGET = ${budgetMs};
  var GAP = ${gapMs};
  var MAX_WAIT = ${MAX_WAIT_OUT_MS};
  var HEADER = ${JSON.stringify(READER_TOKEN_HEADER)};
  var LIMIT = Math.min(${total}, ${cap});
  var MAX_ATTEMPTS = 6;
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
  var waited = 0;
  var cf = false;
  var refreshing = null;
  var finished = false;
  var resumePending = false;

  // Whatever happens to the requests in flight, this answers. A fetch that
  // never settles would otherwise leave the reader on a blank screen with the
  // extension waiting on a promise that can no longer be resolved by anything.
  setTimeout(function () { finish(); }, BUDGET + 3000);

  function finish() {
    if (finished) { return; }
    finished = true;
    resolve(JSON.stringify({ urls: urls, total: ${total}, token: token, got: got, r429: r429, r403: r403, refreshes: refreshes, conc: conc, cf: cf, odd: odd, waited: waited, ms: Date.now() - started }));
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
        // A challenge arrives as a 403 carrying cf-mitigated. Test that first,
        // or it is mistaken for a rate refusal and the reader is never offered
        // the verification that would actually let them through.
        if (r.status === 403 && r.headers.get("cf-mitigated")) {
          cf = true;
          queue.length = 0;
          return null;
        }
        if (r.status === 429 || r.headers.get("cf-mitigated")) {
          r429 += 1;
          cleanStreak = 0;
          conc = 1;
          var ra = parseInt(r.headers.get("retry-after") || "0", 10) * 1000;
          if (ra > waited) { waited = ra; }
          var wait = ra > 0 ? ra : 1200;
          // Sit out a short penalty and carry on; a long one is not something
          // to keep a reader waiting through, so stop and let them be told.
          if (wait > MAX_WAIT || Date.now() + wait - started > BUDGET) {
            queue.length = 0;
            return null;
          }
          pauseUntil = Date.now() + wait;
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
          if (cleanStreak % 6 === 0 && conc < MAX_C && Date.now() >= pauseUntil) {
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
        // Whatever gap this connection has settled on, keep to it.
        if (GAP > 0) { setTimeout(tick, GAP); } else { tick(); }
      });
  }

  tick();
});
`;
}

// The wait is capped so a retry cannot outlive the app's own request timeout.
export const PAGE_RETRY_ATTEMPTS = 3;
export const MAX_RETRY_WAIT_MS = 8000;

// Discover asks for every rail at once, and three requests in a breath is
// enough to earn a challenge, which is what leaves a carousel empty.
export const HTML_GAP_MS = 700;

export const INFLIGHT_TTL_MS = 15_000;
export const INFLIGHT_POLL_MS = 150;
export const INFLIGHT_POLLS = 100;

// `/browse` is deliberately absent: it renders its filter form as some thirteen
// thousand checkboxes, making the page ~14 MB where these are a few hundred KB.
export const HOME_SECTIONS: { id: string; title: string; path: string; paginates: boolean }[] = [
  // `/home` ignores its page parameter and answers with the same rows every
  // time; the other two paginate properly.
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
