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
  INFLIGHT_POLL_MS,
  INFLIGHT_POLLS,
  INFLIGHT_TTL_MS,
  MAX_SLOT_LOOKAHEAD_MS,
  PAGE_REQUEST_GAP_MS,
  READER_TOKEN_HEADER,
  pageApiUrl,
  parsePageMarker,
  readerUrl,
  SIGNED_URL_TTL_MS,
  TOKEN_TTL_MS,
} from "./models";

/**
 * All state lives in `Application.setState`, not in instance fields.
 *
 * Paperback runs each request through the native bridge, and an interceptor's
 * in-memory fields - a promise queue, a Map cache - do not survive from one
 * request to the next. An earlier build kept them in memory, and on device the
 * cache never deduplicated and the pacing never applied: every page resolved
 * twice and the burst tripped the site's rate limit. The state manager is the
 * one store that persists across requests, which is why the app's own cookie
 * interceptor uses it too.
 */
const NEXT_SLOT_KEY = "onisaga.nextSlot";
const BLOCKED_UNTIL_KEY = "onisaga.blockedUntil";
const pageKey = (chapterId: string, index: number): string => `onisaga.page.${chapterId}.${index}`;
const tokenKey = (chapterId: string): string => `onisaga.token.${chapterId}`;
const ownerKey = (chapterId: string): string => `onisaga.owner.${chapterId}`;
const inflightKey = (chapterId: string, index: number): string =>
  `onisaga.inflight.${chapterId}.${index}`;

type CachedUrl = { url: string; at: number };
type CachedToken = { token: string; at: number };

export class OniSagaInterceptor extends PaperbackInterceptor {
  noteChapterOwner(chapterId: string, mangaId: string): void {
    Application.setState(mangaId, ownerKey(chapterId));
  }

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${DOMAIN}/`,
      "accept-language": "en-US,en;q=0.9",
    };

    const marker = parsePageMarker(request.url);

    if (!marker) {
      return request;
    }

    const url = await this.resolvePage(marker.chapterId, marker.index);

    request.url = url;
    request.headers = {
      ...request.headers,
      accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      referer: `${DOMAIN}/`,
    };

    return request;
  }

  /** Returns a page's signed URL, cached and paced across every request. */
  private async resolvePage(chapterId: string, index: number): Promise<string> {
    const key = pageKey(chapterId, index);

    const cached = Application.getState(key) as CachedUrl | undefined;
    if (cached && Date.now() - cached.at < SIGNED_URL_TTL_MS) {
      return cached.url;
    }

    // The app prefetches each page and asks for it more than once. If another
    // request is already resolving this exact page, wait for its result rather
    // than claiming a second paced slot - otherwise duplicates halve the rate.
    const flag = inflightKey(chapterId, index);
    const held = Application.getState(flag) as number | undefined;
    if (held && Date.now() - held < INFLIGHT_TTL_MS) {
      for (let attempt = 0; attempt < INFLIGHT_POLLS; attempt += 1) {
        await Application.sleep(INFLIGHT_POLL_MS / 1000);
        const ready = Application.getState(key) as CachedUrl | undefined;
        if (ready && Date.now() - ready.at < SIGNED_URL_TTL_MS) {
          return ready.url;
        }
        if (!Application.getState(flag)) {
          break; // the other attempt finished or failed; resolve it ourselves
        }
      }
    }

    Application.setState(Date.now(), flag);
    try {
      // Reserve a paced slot. Reading the shared cursor and writing the next
      // one back happens synchronously before any await, so on a single-
      // threaded event loop each concurrent request claims a distinct,
      // increasing slot - serialised pacing without a lock.
      await this.waitForSlot();

      const fresh = Application.getState(key) as CachedUrl | undefined;
      if (fresh && Date.now() - fresh.at < SIGNED_URL_TTL_MS) {
        return fresh.url;
      }

      const url = await this.mintPage(chapterId, index);
      Application.setState({ url, at: Date.now() } satisfies CachedUrl, key);

      return url;
    } finally {
      Application.setState(undefined, flag);
    }
  }

  /** Claims the next paced slot and waits for it. */
  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const blockedUntil = (Application.getState(BLOCKED_UNTIL_KEY) as number | undefined) ?? 0;
    const nextSlot = (Application.getState(NEXT_SLOT_KEY) as number | undefined) ?? 0;

    // Clamp the cursor: a burst that ended mid-way in a previous session could
    // otherwise leave a reservation minutes in the future and stall this one.
    const cursor = nextSlot > now + MAX_SLOT_LOOKAHEAD_MS ? now : nextSlot;
    const slot = Math.max(now, cursor, blockedUntil);
    Application.setState(slot + PAGE_REQUEST_GAP_MS, NEXT_SLOT_KEY);

    const wait = slot - now;
    if (wait > 0) {
      await Application.sleep(wait / 1000);
    }
  }

  /** Performs one page resolution, refreshing the token once on a refusal. */
  private async mintPage(chapterId: string, index: number): Promise<string> {
    let result = await this.requestPage(chapterId, index, await this.tokenFor(chapterId));

    if (result.status === 403) {
      // The token expired with the reader page that issued it.
      Application.setState(undefined, tokenKey(chapterId));
      await this.waitForSlot();
      result = await this.requestPage(chapterId, index, await this.tokenFor(chapterId));
    }

    if (result.url) {
      return result.url;
    }

    throw new Error(`Unable to resolve page ${index + 1} of chapter ${chapterId}`);
  }

  private async requestPage(
    chapterId: string,
    index: number,
    token: string,
  ): Promise<{ status: number; url?: string }> {
    const [response, buffer] = await Application.scheduleRequest({
      url: pageApiUrl(chapterId, index),
      method: "GET",
      headers: { accept: "application/json", [READER_TOKEN_HEADER]: token, referer: `${DOMAIN}/` },
    });

    if (response.status === 429) {
      this.block(response);
      throw new Error("Rate limited while resolving a page; it will retry shortly.");
    }

    if (response.status !== 200) {
      return { status: response.status };
    }

    try {
      const body = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as { url?: string };
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

  /** Records how long the site has asked to be left alone for. */
  private block(response: Response): void {
    const header = response.headers?.["retry-after"] ?? response.headers?.["Retry-After"];
    const seconds = header ? Number(header) : Number.NaN;
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;

    const current = (Application.getState(BLOCKED_UNTIL_KEY) as number | undefined) ?? 0;
    Application.setState(Math.max(current, Date.now() + wait), BLOCKED_UNTIL_KEY);
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /just a moment|challenge-platform|cf-chl/i.test(Application.arrayBufferToUTF8String(data)))
    ) {
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: { referer: `${DOMAIN}/`, "user-agent": await Application.getDefaultUserAgent() },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    if (response.status === 429) {
      this.block(response);
      throw new Error(
        "The site is rate limiting this device. Reading will resume automatically in a moment.",
      );
    }

    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }
}

/** Pulls the reader token out of a reader page. */
async function readTokenFrom(url: string): Promise<string> {
  const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  const html = Application.arrayBufferToUTF8String(buffer);
  const token = html.match(/readerToken['"]?\s*:\s*['"]([^'"]{8,})['"]/)?.[1];

  if (!token) {
    throw new Error("The reader page did not carry a token; the site may have changed.");
  }

  return token;
}
