/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import {
  DEFAULT_RETRY_AFTER_MS,
  DOMAIN,
  GAP_DECAY_AFTER,
  GAP_DECAY_MS,
  GAP_INCREASE_MS,
  GAP_KEY,
  HTML_GAP_MS,
  KNOWN_BAD_KEY,
  KNOWN_BAD_MARGIN_MS,
  LAST_REFUSAL_KEY,
  MAX_PAGE_GAP_MS,
  COOLDOWN_MAX_STEPS,
  COOLDOWN_STEP_MS,
  MIN_PAGE_GAP_MS,
  REPROBE_AFTER,
  PAGE_REQUEST_GAP_MS,
  READER_TOKEN_HEADER,
  REFUSAL_EPISODE_MS,
  STREAK_KEY,
  USER_AGENT,
  CHUNK_SIZE,
  MINT_CEILING,
  MINTS_KEY,
  MINT_WINDOW_MS,
  WEBVIEW_CHUNK_BUDGET_MS,
  WEBVIEW_MAX_CONCURRENCY,
  WEBVIEW_START_CONCURRENCY,
  buildPageListResolverInject,
  chapterTotalKey,
  pageApiUrl,
  pagesInfoUrl,
  parsePageMarker,
  readerUrl,
  SIGNED_URL_TTL_MS,
  TOKEN_TTL_MS,
} from "./models";

/**
 * A cross-request lock, module-level so it is shared by every request.
 *
 * This is the one primitive proven to serialise on Paperback's native bridge:
 * the shipped BasicRateLimiter uses exactly this (an identical lock lives in
 * `@paperback/types` but is not re-exported, so it is reproduced here). Holding
 * it for the whole of a page resolution turns the reader's parallel prefetch
 * into strictly one-at-a-time, paced calls — which is the only way to stay
 * under the rate limit, since tripping it escalates to a Cloudflare lockout.
 */
const lockPromises: Record<string, Promise<void> | undefined> = {};
const lockResolvers: Record<string, (() => void) | undefined> = {};

async function lock(uid: string): Promise<void> {
  if (lockPromises[uid]) {
    await lockPromises[uid];
    await lock(uid);
    return;
  }

  lockPromises[uid] = new Promise<void>((resolve) => {
    lockResolvers[uid] = () => {
      delete lockPromises[uid];
      resolve();
    };
  });
}

function unlock(uid: string): void {
  const resolver = lockResolvers[uid];
  if (resolver) {
    delete lockResolvers[uid];
    resolver();
  }
}

const PAGE_LOCK = "onisaga.pageResolve";
const HTML_LOCK = "onisaga.htmlFetch";

/**
 * Set while a page resolution is in progress, so the requests it makes of its
 * own - the reader page for a token, the resolution call - are not made to
 * queue behind the browsing pacer as well, which would deadlock them.
 */
let resolving = false;

/**
 * How long to stand down after the site escalates to a Cloudflare challenge on
 * the page API. That only happens once the rate limit is already tripped, and
 * it clears on its own after a while; hammering it keeps it shut.
 */
const CF_COOLDOWN_MS = 90_000;

const LAST_AT_KEY = "onisaga.lastAt";
const REPROBE_KEY = "onisaga.reprobe";
const BLOCKED_UNTIL_KEY = "onisaga.blockedUntil";
const pageKey = (chapterId: string, index: number): string => `onisaga.page.${chapterId}.${index}`;
const tokenKey = (chapterId: string): string => `onisaga.token.${chapterId}`;
const ownerKey = (chapterId: string): string => `onisaga.owner.${chapterId}`;

type CachedUrl = { url: string; at: number };
type CachedToken = { token: string; at: number };

const isPageApi = (url: string): boolean => /\/api\/chapter\/\d+\/page\/\d+/.test(url);

export class OniSagaInterceptor extends PaperbackInterceptor {
  // Reads the same persisted cookie jar the extension writes, so the WebView
  // that resolves a chunk carries the app's Cloudflare clearance.
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  noteChapterOwner(chapterId: string, mangaId: string): void {
    Application.setState(mangaId, ownerKey(chapterId));
  }

  /** Remembers a chapter's length so the chunk resolver never asks the site
   * for a page past the end. */
  noteChapterTotal(chapterId: string, total: number): void {
    Application.setState(total, chapterTotalKey(chapterId));
  }

  /**
   * Stores a token already read from a reader page.
   *
   * Opening a chapter fetches that page anyway, so handing the token over here
   * saves fetching the very same page a second time for it - two identical
   * requests in a breath, right before the first page is asked for, which is
   * what got the opening pages refused.
   */
  noteToken(chapterId: string, token: string): void {
    Application.setState({ token, at: Date.now() } satisfies CachedToken, tokenKey(chapterId));
  }

  /**
   * Asks the site how long a chapter is and whether it is ready.
   *
   * Used only when the reader page does not say, so an ordinary chapter costs
   * nothing extra and an awkward one still opens.
   */
  async chapterInfo(
    chapterId: string,
    token: string,
  ): Promise<{ total: number; importing: boolean } | undefined> {
    try {
      const [response, buffer] = await Application.scheduleRequest({
        url: pagesInfoUrl(chapterId),
        method: "GET",
        headers: {
          accept: "application/json",
          [READER_TOKEN_HEADER]: token,
          referer: `${DOMAIN}/`,
          "user-agent": USER_AGENT,
        },
      });

      if (response.status !== 200) {
        return undefined;
      }

      const body = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
        total_pages?: number;
        importing?: boolean;
      };

      return { total: Number(body.total_pages ?? 0), importing: body.importing === true };
    } catch {
      return undefined;
    }
  }

  /** Records a metered request made elsewhere, so pacing accounts for it. */
  noteMeteredRequest(): void {
    Application.setState(Date.now(), LAST_AT_KEY);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": USER_AGENT,
      referer: `${DOMAIN}/`,
      "accept-language": "en-US,en;q=0.9",
    };

    const marker = parsePageMarker(request.url);

    if (!marker) {
      await this.paceBrowsing(request.url);
      return request;
    }

    request.url = await this.resolvePage(marker.chapterId, marker.index);
    request.headers = {
      ...request.headers,
      accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      referer: `${DOMAIN}/`,
    };

    return request;
  }

  /**
   * Returns a page's signed URL. Every resolution runs alone under the lock, so
   * duplicates collapse to a cache hit and calls are strictly paced.
   */
  private async resolvePage(chapterId: string, index: number): Promise<string> {
    const key = pageKey(chapterId, index);

    // Fast path: a cached URL needs no lock.
    const cached = Application.getState(key) as CachedUrl | undefined;
    if (cached && Date.now() - cached.at < SIGNED_URL_TTL_MS) {
      return cached.url;
    }

    // A refused page keeps trying until it loads - a blank page in the middle
    // stops the reader. The waiting is done without the lock, so a page serving
    // its penalty never blocks pages the reader has already loaded, nor the
    // resolution of others.
    for (let step = 0; step < COOLDOWN_MAX_STEPS; step += 1) {
      await this.waitOutCooldown();

      await lock(PAGE_LOCK);
      resolving = true;
      let refused = false;
      try {
        const again = Application.getState(key) as CachedUrl | undefined;
        if (again && Date.now() - again.at < SIGNED_URL_TTL_MS) {
          return again.url;
        }

        // Skip the paced call if it tripped while we queued; go wait it out.
        if (this.cooldownRemaining() > 0) {
          refused = true;
        } else {
          // Resolve the whole neighbourhood of this page in one WebView pass,
          // at browser pace, and cache it. The reader's prefetch of the next
          // page usually falls inside this chunk, so the following chunk is
          // already resolving before the reader arrives - the wait is hidden.
          const url = await this.resolveChunk(chapterId, index);

          if (url) {
            return url;
          }

          // A refusal or an empty result: loop to wait out any cooldown.
          refused = true;
        }
      } finally {
        resolving = false;
        unlock(PAGE_LOCK);
      }

      if (!refused) {
        break;
      }
    }

    throw new Error(
      `Page ${index + 1} could not be loaded after waiting out the site's rate limit.`,
    );
  }

  /**
   * Resolves the chunk of pages beginning at `index` inside one WebView pass -
   * the site treats a WebView as the browser it is, so a chunk mints at browser
   * speed instead of the app client's throttled crawl - caches every address it
   * gets, and returns the one the reader asked for. Falls back to a single
   * app-client mint only when the WebView is unavailable, so an app build
   * without it still turns a page.
   */
  private async resolveChunk(chapterId: string, index: number): Promise<string | undefined> {
    const mangaId = Application.getState(ownerKey(chapterId)) as string | undefined;

    if (!mangaId) {
      return this.mintSingle(chapterId, index);
    }

    // Mint the neighbourhood of the requested page, but only the pages not
    // already cached - so a chunk never re-mints a neighbour a previous chunk
    // resolved, and a retry after a failure costs just the page that failed.
    const total = Application.getState(chapterTotalKey(chapterId)) as number | undefined;
    const end = total && total > index ? Math.min(index + CHUNK_SIZE, total) : index + CHUNK_SIZE;
    const todo: number[] = [];

    for (let i = index; i < end; i += 1) {
      if (!this.cachedUrl(chapterId, i)) {
        todo.push(i);
      }
    }

    if (todo.length === 0) {
      return this.cachedUrl(chapterId, index);
    }

    const seed = await this.tokenFor(chapterId);
    const burstBudget = Math.max(0, MINT_CEILING - this.recentMints());
    const outcome = await this.resolveChunkViaWebView(mangaId, chapterId, todo, seed, burstBudget);

    if (!outcome) {
      // No WebView here - fall back to a single paced app-client mint.
      return this.mintSingle(chapterId, index);
    }

    // A challenge where a fresh token should be needs the proper bypass, not a
    // silent retry - hand it up the way a challenge on any other page is.
    if (outcome.cf) {
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: { referer: `${DOMAIN}/`, "user-agent": USER_AGENT },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    if (outcome.got > 0) {
      this.recordMints(outcome.got);
    }

    if (outcome.token) {
      this.noteToken(chapterId, outcome.token);
    }

    const now = Date.now();
    for (const key of Object.keys(outcome.pages)) {
      Application.setState(
        { url: outcome.pages[key]!, at: now } satisfies CachedUrl,
        pageKey(chapterId, Number(key)),
      );
    }

    const mine = outcome.pages[index];

    if (mine) {
      // The reader has their page. Even if the site objected to others in the
      // chunk, it recovered, so do not slow the pages still to come.
      return mine;
    }

    // The requested page did not resolve. Set the shared cooldown so the retry
    // waits instead of spinning - the real Retry-After if the site refused,
    // otherwise a short breath for a transient error - then report the refusal.
    this.widenGap("rate limited");
    this.block(outcome.r429 > 0 ? Math.max(outcome.ra, DEFAULT_RETRY_AFTER_MS) : 3_000);
    return undefined;
  }

  /** A page's cached address if it is still within its signed lifetime. */
  private cachedUrl(chapterId: string, index: number): string | undefined {
    const cached = Application.getState(pageKey(chapterId, index)) as CachedUrl | undefined;
    return cached && Date.now() - cached.at < SIGNED_URL_TTL_MS ? cached.url : undefined;
  }

  /**
   * Runs the range resolver inside a WebView. Returns its summary, or null when
   * the WebView is unavailable (older app builds answer "Not Implemented"), so
   * the caller can fall back to the app-client path.
   */
  private async resolveChunkViaWebView(
    mangaId: string,
    chapterId: string,
    indices: number[],
    seed: string,
    burstBudget: number,
  ): Promise<{
    pages: Record<string, string>;
    token?: string;
    got: number;
    r429: number;
    ra: number;
    cf: boolean;
  } | null> {
    const url = readerUrl(mangaId, chapterId);

    try {
      const outcome = await Application.executeInWebView({
        source: {
          html: "<html><head></head><body></body></html>",
          baseUrl: url,
          loadCSS: false,
          loadImages: false,
          userAgent: USER_AGENT,
        },
        inject: buildPageListResolverInject(
          chapterId,
          url,
          indices,
          seed,
          WEBVIEW_START_CONCURRENCY,
          WEBVIEW_MAX_CONCURRENCY,
          WEBVIEW_CHUNK_BUDGET_MS,
          burstBudget,
        ),
        storage: { cookies: this.cookieStorage.cookiesForUrl(url) },
      });

      for (const cookie of outcome.storage.cookies) {
        if (!cookie.expires || cookie.expires.getTime() > Date.now()) {
          this.cookieStorage.setCookie(cookie);
        }
      }

      const parsed = JSON.parse(String(outcome.result)) as {
        pages?: Record<string, string>;
        token?: string;
        got?: number;
        r429?: number;
        ra?: number;
        cf?: boolean;
      };

      return {
        pages: parsed.pages ?? {},
        token: parsed.token,
        got: parsed.got ?? 0,
        r429: parsed.r429 ?? 0,
        ra: parsed.ra ?? 0,
        cf: parsed.cf === true,
      };
    } catch {
      return null;
    }
  }

  /** The app-client single-page mint, used only when a WebView is unavailable. */
  private async mintSingle(chapterId: string, index: number): Promise<string | undefined> {
    await this.pace();
    const result = await this.mintPage(chapterId, index);

    if (result.url) {
      Application.setState(
        { url: result.url, at: Date.now() } satisfies CachedUrl,
        pageKey(chapterId, index),
      );
      return result.url;
    }

    return undefined;
  }

  /** Page mints recorded within the recent window, so the chunk resolver keeps
   * clear of the site's burst ceiling the same way an open does. */
  private recentMints(): number {
    const marks =
      (Application.getState(MINTS_KEY) as { at: number; n: number }[] | undefined) ?? [];
    const cutoff = Date.now() - MINT_WINDOW_MS;
    return marks.filter((m) => m.at >= cutoff).reduce((sum, m) => sum + m.n, 0);
  }

  /** Records a burst of mints against the recent window. */
  private recordMints(n: number): void {
    if (n <= 0) {
      return;
    }

    const cutoff = Date.now() - MINT_WINDOW_MS;
    const marks = (
      (Application.getState(MINTS_KEY) as { at: number; n: number }[] | undefined) ?? []
    ).filter((m) => m.at >= cutoff);
    marks.push({ at: Date.now(), n });
    Application.setState(marks, MINTS_KEY);
  }

  /** Waits out an active penalty, one bounded step, without holding the lock. */
  private async waitOutCooldown(): Promise<void> {
    const remaining = this.cooldownRemaining();
    if (remaining > 0) {
      await Application.sleep(Math.min(remaining, COOLDOWN_STEP_MS) / 1000);
    }
  }

  /** How long the shared cooldown still has to run. */
  private cooldownRemaining(): number {
    const until = (Application.getState(BLOCKED_UNTIL_KEY) as number | undefined) ?? 0;
    return Math.max(until - Date.now(), 0);
  }

  /** Holds the minimum gap between real calls. The cooldown is handled before
   * the lock, off it, so nothing is waited out here. */
  private async pace(): Promise<void> {
    const gap = this.currentGap();
    const lastAt = (Application.getState(LAST_AT_KEY) as number | undefined) ?? 0;
    const since = Date.now() - lastAt;
    if (since >= 0 && since < gap) {
      await Application.sleep((gap - since) / 1000);
    }

    Application.setState(Date.now(), LAST_AT_KEY);
  }

  /**
   * Spaces ordinary page fetches so a screenful of rails is not asked for all
   * at once. Images are left alone: they are not metered, and the resolution
   * calls have their own, stricter pacing.
   */
  private async paceBrowsing(url: string): Promise<void> {
    if (resolving || isPageApi(url) || !url.startsWith(DOMAIN) || /\/_img\//.test(url)) {
      return;
    }

    await lock(HTML_LOCK);
    try {
      // One clock for every metered request: the site counts them together,
      // so a resolution must not fire straight after a page fetch either.
      const lastAt = (Application.getState(LAST_AT_KEY) as number | undefined) ?? 0;
      const since = Date.now() - lastAt;

      if (since >= 0 && since < HTML_GAP_MS) {
        await Application.sleep((HTML_GAP_MS - since) / 1000);
      }

      Application.setState(Date.now(), LAST_AT_KEY);
    } finally {
      unlock(HTML_LOCK);
    }
  }

  /** The tightest pace worth trying: clear of any gap the site has refused. */
  private safeFloor(): number {
    const bad = Application.getState(KNOWN_BAD_KEY) as number | undefined;

    if (typeof bad !== "number" || !Number.isFinite(bad)) {
      return MIN_PAGE_GAP_MS;
    }

    return Math.min(Math.max(bad + KNOWN_BAD_MARGIN_MS, MIN_PAGE_GAP_MS), MAX_PAGE_GAP_MS);
  }

  /** The gap in force, which rises after a refusal and eases back on success. */
  private currentGap(): number {
    const stored = Application.getState(GAP_KEY) as number | undefined;

    if (typeof stored !== "number" || !Number.isFinite(stored)) {
      return PAGE_REQUEST_GAP_MS;
    }

    return Math.min(Math.max(stored, this.safeFloor()), MAX_PAGE_GAP_MS);
  }

  /**
   * Widens the gap after a refusal.
   *
   * The burst window the site enforces is not published, so rather than guess
   * it the extension backs off a step each time it is refused and settles at
   * whatever pace the site actually tolerates.
   */
  private widenGap(reason: string): void {
    const from = this.currentGap();
    const now = Date.now();
    const lastRefusal = (Application.getState(LAST_REFUSAL_KEY) as number | undefined) ?? 0;
    const followOn = now - lastRefusal < REFUSAL_EPISODE_MS;

    Application.setState(now, LAST_REFUSAL_KEY);
    Application.setState(0, REPROBE_KEY);

    // Only the first refusal of an episode says anything about the pace: the
    // ones that follow are the site still refusing, and treating them as
    // evidence taught a wall far slower than the real one.
    if (!followOn) {
      const bad = (Application.getState(KNOWN_BAD_KEY) as number | undefined) ?? 0;
      if (from > bad) {
        Application.setState(from, KNOWN_BAD_KEY);
      }
    }

    if (followOn) {
      // Already backed off for this episode; wait it out rather than widening
      // again on every refusal it produces.
      return;
    }

    const next = Math.min(from + GAP_INCREASE_MS, MAX_PAGE_GAP_MS);
    Application.setState(next, GAP_KEY);
    Application.setState(0, STREAK_KEY);
    // Printed so a device log shows where the pace actually settles: the rate
    // that applies to a device cannot be measured from anywhere else.
    console.log(`[OniSaga] ${reason}: gap ${from}ms -> ${next}ms`);
  }

  /** Eases the gap back down once a run of requests has gone through cleanly. */
  private noteSuccess(): void {
    // Ease down steadily on a clean run; a gentle descent settles just above
    // the limit without provoking it.
    const streak = ((Application.getState(STREAK_KEY) as number | undefined) ?? 0) + 1;

    if (streak < GAP_DECAY_AFTER) {
      Application.setState(streak, STREAK_KEY);
      return;
    }

    Application.setState(0, STREAK_KEY);
    const from = this.currentGap();
    const floor = this.safeFloor();

    if (from > floor) {
      const eased = Math.max(from - GAP_DECAY_MS, floor);
      Application.setState(eased, GAP_KEY);
      console.log(`[OniSaga] clean run: gap ${from}ms -> ${eased}ms`);
      return;
    }

    // Already settled at the floor. On a sustained clean run, relax the
    // remembered wall a step so the pace can probe a little faster - what once
    // tripped the limit may be fine now, or may never have been the true wall.
    const clean = ((Application.getState(REPROBE_KEY) as number | undefined) ?? 0) + 1;

    if (clean < REPROBE_AFTER) {
      Application.setState(clean, REPROBE_KEY);
      return;
    }

    Application.setState(0, REPROBE_KEY);
    const bad = Application.getState(KNOWN_BAD_KEY) as number | undefined;

    if (typeof bad === "number" && bad - GAP_DECAY_MS >= MIN_PAGE_GAP_MS) {
      Application.setState(bad - GAP_DECAY_MS, KNOWN_BAD_KEY);
      const eased = Math.max(from - GAP_DECAY_MS, this.safeFloor());
      Application.setState(eased, GAP_KEY);
      console.log(`[OniSaga] probing faster: gap ${from}ms -> ${eased}ms`);
    } else if (from - GAP_DECAY_MS >= MIN_PAGE_GAP_MS) {
      const eased = from - GAP_DECAY_MS;
      Application.setState(eased, GAP_KEY);
      console.log(`[OniSaga] probing faster: gap ${from}ms -> ${eased}ms`);
    }
  }

  /** Performs one page resolution, refreshing the token once on a plain 403. */
  /**
   * One attempt at resolving a page, refreshing an expired token once.
   *
   * Returns the URL on success, or `refused: true` when the site rate-limited
   * it, so the caller can wait out the penalty off the lock and try again.
   */
  private async mintPage(
    chapterId: string,
    index: number,
  ): Promise<{ url?: string; refused: boolean }> {
    let result = await this.requestPage(chapterId, index, await this.tokenFor(chapterId));

    if (result.status === 403 && !result.cloudflare) {
      // A plain 403 means the token expired; fetch a fresh one and go again.
      Application.setState(undefined, tokenKey(chapterId));
      await this.pace();
      result = await this.requestPage(chapterId, index, await this.tokenFor(chapterId));
    }

    if (result.url) {
      return { url: result.url, refused: false };
    }

    return { refused: result.status === 429 || result.cloudflare === true };
  }

  private async requestPage(
    chapterId: string,
    index: number,
    token: string,
  ): Promise<{ status: number; url?: string; cloudflare?: boolean }> {
    const [response, buffer] = await Application.scheduleRequest({
      url: pageApiUrl(chapterId, index),
      method: "GET",
      headers: {
        accept: "application/json",
        [READER_TOKEN_HEADER]: token,
        referer: `${DOMAIN}/`,
        "user-agent": USER_AGENT,
      },
    });

    // The rate limit escalates to a Cloudflare challenge on the API itself.
    // Treat it as a hard back-off rather than a challenge the reader can solve.
    if (response.headers?.["cf-mitigated"] === "challenge") {
      this.widenGap("cloudflare");
      this.block(CF_COOLDOWN_MS);
      return { status: response.status, cloudflare: true };
    }

    if (response.status === 429) {
      this.widenGap("rate limited");
      this.block(this.retryAfterMs(response));
      return { status: 429 };
    }

    if (response.status !== 200) {
      return { status: response.status };
    }

    try {
      const body = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as { url?: string };

      if (body.url) {
        this.noteSuccess();
      }

      return { status: 200, ...(body.url ? { url: body.url } : {}) };
    } catch {
      return { status: response.status };
    }
  }

  /** Reads a chapter's reader page for the token it embeds, and caches it. */
  private async tokenFor(chapterId: string): Promise<string> {
    const cached = Application.getState(tokenKey(chapterId)) as CachedToken | undefined;
    if (cached && Date.now() - cached.at < TOKEN_TTL_MS) {
      return cached.token;
    }

    const mangaId = Application.getState(ownerKey(chapterId)) as string | undefined;
    if (!mangaId) {
      throw new Error(`No reader page is known for chapter ${chapterId}`);
    }

    const token = await readTokenFrom(readerUrl(mangaId, chapterId));
    Application.setState({ token, at: Date.now() } satisfies CachedToken, tokenKey(chapterId));

    return token;
  }

  private retryAfterMs(response: Response): number {
    const header = response.headers?.["retry-after"] ?? response.headers?.["Retry-After"];
    const seconds = header ? Number(header) : Number.NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
  }

  /** Extends the shared cooldown the pacer waits out. */
  private block(ms: number): void {
    const current = (Application.getState(BLOCKED_UNTIL_KEY) as number | undefined) ?? 0;
    Application.setState(Math.max(current, Date.now() + ms), BLOCKED_UNTIL_KEY);
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    // A challenge on the page API is a throttle, already handled in requestPage
    // with a cooldown; do not raise the bypass UI for it. Only a challenge on a
    // normal page (browse, reader) warrants the bypass prompt.
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /just a moment|challenge-platform|cf-chl/i.test(Application.arrayBufferToUTF8String(data)));

    if (challenged && !isPageApi(request.url)) {
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: { referer: `${DOMAIN}/`, "user-agent": USER_AGENT },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    // Page-API statuses (429, Cloudflare 403, token 403) are interpreted by
    // requestPage from the returned status, so pass them through untouched.
    if (isPageApi(request.url)) {
      return data;
    }

    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }
}

/** Pulls the reader token out of a reader page. */
async function readTokenFrom(url: string): Promise<string> {
  const [, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { "user-agent": USER_AGENT, referer: `${DOMAIN}/` },
  });
  const html = Application.arrayBufferToUTF8String(buffer);
  const token = html.match(/readerToken['"]?\s*:\s*['"]([^'"]{8,})['"]/)?.[1];

  if (!token) {
    throw new Error("The reader page did not carry a token; the site may have changed.");
  }

  return token;
}
