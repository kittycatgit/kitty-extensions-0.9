/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
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
  MAX_RETRY_WAIT_MS,
  MIN_PAGE_GAP_MS,
  MAX_SLOT_LOOKAHEAD_MS,
  PAGE_REQUEST_GAP_MS,
  PAGE_RETRY_ATTEMPTS,
  READER_TOKEN_HEADER,
  REFUSAL_EPISODE_MS,
  STREAK_KEY,
  USER_AGENT,
  pageApiUrl,
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
const BLOCKED_UNTIL_KEY = "onisaga.blockedUntil";
const pageKey = (chapterId: string, index: number): string => `onisaga.page.${chapterId}.${index}`;
const tokenKey = (chapterId: string): string => `onisaga.token.${chapterId}`;
const ownerKey = (chapterId: string): string => `onisaga.owner.${chapterId}`;

type CachedUrl = { url: string; at: number };
type CachedToken = { token: string; at: number };

const isPageApi = (url: string): boolean => /\/api\/chapter\/\d+\/page\/\d+/.test(url);

export class OniSagaInterceptor extends PaperbackInterceptor {
  noteChapterOwner(chapterId: string, mangaId: string): void {
    Application.setState(mangaId, ownerKey(chapterId));
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

    await lock(PAGE_LOCK);
    resolving = true;
    try {
      // Another resolution may have produced this exact page while we queued.
      const again = Application.getState(key) as CachedUrl | undefined;
      if (again && Date.now() - again.at < SIGNED_URL_TTL_MS) {
        return again.url;
      }

      await this.pace();

      const url = await this.mintPage(chapterId, index);
      Application.setState({ url, at: Date.now() } satisfies CachedUrl, key);

      return url;
    } finally {
      resolving = false;
      unlock(PAGE_LOCK);
    }
  }

  /** Waits out any cooldown and holds the minimum gap between real calls. */
  private async pace(): Promise<void> {
    const now = Date.now();

    const blockedUntil = (Application.getState(BLOCKED_UNTIL_KEY) as number | undefined) ?? 0;
    if (blockedUntil > now && blockedUntil < now + MAX_SLOT_LOOKAHEAD_MS + CF_COOLDOWN_MS) {
      await Application.sleep((blockedUntil - now) / 1000);
    }

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
    const streak = ((Application.getState(STREAK_KEY) as number | undefined) ?? 0) + 1;

    if (streak < GAP_DECAY_AFTER) {
      Application.setState(streak, STREAK_KEY);
      return;
    }

    Application.setState(0, STREAK_KEY);
    const from = this.currentGap();
    const eased = Math.max(from - GAP_DECAY_MS, this.safeFloor());

    if (eased !== from) {
      Application.setState(eased, GAP_KEY);
      console.log(`[OniSaga] clean run: gap ${from}ms -> ${eased}ms`);
    }
  }

  /** Performs one page resolution, refreshing the token once on a plain 403. */
  private async mintPage(chapterId: string, index: number): Promise<string> {
    let lastStatus = 0;

    for (let attempt = 0; attempt < PAGE_RETRY_ATTEMPTS; attempt += 1) {
      const result = await this.requestPage(chapterId, index, await this.tokenFor(chapterId));

      if (result.url) {
        return result.url;
      }

      lastStatus = result.status;

      if (result.status === 403 && !result.cloudflare) {
        // A plain 403 means the token expired with the reader page that issued
        // it; fetch a fresh one and go again straight away.
        Application.setState(undefined, tokenKey(chapterId));
        await this.pace();
        continue;
      }

      // Refused for pace: wait the shorter of what the site asked for and a
      // cap, then try again. Giving up here is what used to leave a page
      // permanently blank while its neighbours loaded.
      if (result.status === 429 || result.cloudflare) {
        const until = (Application.getState(BLOCKED_UNTIL_KEY) as number | undefined) ?? 0;
        const wait = Math.min(Math.max(until - Date.now(), 0), MAX_RETRY_WAIT_MS);

        if (attempt + 1 < PAGE_RETRY_ATTEMPTS) {
          await Application.sleep(wait / 1000);
          continue;
        }
      }

      break;
    }

    throw new Error(
      `Unable to resolve page ${index + 1} of chapter ${chapterId} (last status ${lastStatus})`,
    );
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
