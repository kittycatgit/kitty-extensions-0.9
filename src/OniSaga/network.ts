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
  PAGE_REQUEST_GAP_MS,
  READER_TOKEN_HEADER,
  pageApiUrl,
  parsePageMarker,
  readerUrl,
  SIGNED_URL_TTL_MS,
  TOKEN_TTL_MS,
} from "./models";

type ChapterToken = { token: string; mangaId: string; at: number };

export class OniSagaInterceptor extends PaperbackInterceptor {
  /** Reader tokens are issued per chapter, so they are cached per chapter. */
  private readonly tokens = new Map<string, ChapterToken>();

  /**
   * Resolved page URLs, keyed by "chapterId:index".
   *
   * The app prefetches each page and asks for it more than once, so without
   * this every page was resolved twice - the device logs showed exactly that,
   * doubling the request rate until the site returned a 429. An in-flight
   * promise is cached too, so simultaneous requests for the same page share a
   * single resolution rather than racing into two API calls.
   */
  private readonly resolved = new Map<string, { url: string; at: number } | Promise<string>>();

  /** Serialises page resolution; the site refuses to be asked in parallel. */
  private queue: Promise<unknown> = Promise.resolve();

  private lastPageRequest = 0;

  /** Set while a 429 penalty is being served. */
  private blockedUntil = 0;

  /** Remembers which series a chapter belongs to, for minting its token. */
  private readonly chapterOwners = new Map<string, string>();

  noteChapterOwner(chapterId: string, mangaId: string): void {
    this.chapterOwners.set(chapterId, mangaId);
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

    // A placeholder: mint the real, signed URL now that the reader wants it.
    const resolved = await this.enqueue(() => this.resolvePage(marker.chapterId, marker.index));

    request.url = resolved;
    request.headers = {
      ...request.headers,
      accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      referer: `${DOMAIN}/`,
    };

    return request;
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
      // One resolution URL for every challenge, so concurrent failures collapse
      // into a single prompt rather than one per request.
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
      this.servePenalty(response);
      throw new Error(
        "The site is rate limiting this device. Reading will resume automatically in a minute.",
      );
    }

    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }

  /** Records how long the site has asked to be left alone for. */
  private servePenalty(response: Response): void {
    const header = response.headers?.["retry-after"] ?? response.headers?.["Retry-After"];
    const seconds = header ? Number(header) : Number.NaN;
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;

    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + wait);
  }

  /** Runs work one at a time, so page resolution is never done in parallel. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    // Keep the chain alive even when a link rejects.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  private async pace(): Promise<void> {
    const now = Date.now();

    if (this.blockedUntil > now) {
      await Application.sleep((this.blockedUntil - now) / 1000);
    }

    const since = Date.now() - this.lastPageRequest;
    if (since < PAGE_REQUEST_GAP_MS) {
      await Application.sleep((PAGE_REQUEST_GAP_MS - since) / 1000);
    }
  }

  /** Asks the site for one page's signed URL, refreshing the token if refused. */
  private resolvePage(chapterId: string, index: number): Promise<string> {
    const key = `${chapterId}:${index}`;
    const cached = this.resolved.get(key);

    if (cached) {
      // A settled entry within its lifetime, or a resolution already running.
      if (cached instanceof Promise) {
        return cached;
      }

      if (Date.now() - cached.at < SIGNED_URL_TTL_MS) {
        return Promise.resolve(cached.url);
      }
    }

    const pending = this.mintPage(chapterId, index).then(
      (url) => {
        this.resolved.set(key, { url, at: Date.now() });
        return url;
      },
      (error: unknown) => {
        // A failed attempt must not be cached, or the page can never recover.
        this.resolved.delete(key);
        throw error;
      },
    );

    this.resolved.set(key, pending);
    return pending;
  }

  /** Performs one page resolution, paced, refreshing the token on a refusal. */
  private async mintPage(chapterId: string, index: number): Promise<string> {
    await this.pace();

    let token = await this.tokenFor(chapterId);
    let result = await this.requestPage(chapterId, index, token);

    if (result.status === 403) {
      // Tokens expire with the reader page that issued them.
      this.tokens.delete(chapterId);
      await this.pace();
      token = await this.tokenFor(chapterId);
      result = await this.requestPage(chapterId, index, token);
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
    // Measured from the real call, not from pace(): fetching a token between
    // the two would otherwise let the gap between page requests shrink.
    this.lastPageRequest = Date.now();

    const [response, buffer] = await Application.scheduleRequest({
      url: pageApiUrl(chapterId, index),
      method: "GET",
      headers: {
        accept: "application/json",
        [READER_TOKEN_HEADER]: token,
        referer: `${DOMAIN}/`,
      },
    });

    if (response.status === 429) {
      this.servePenalty(response);
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

  /** Reads a chapter's reader page for the token it embeds. */
  private async tokenFor(chapterId: string): Promise<string> {
    const cached = this.tokens.get(chapterId);

    if (cached && Date.now() - cached.at < TOKEN_TTL_MS) {
      return cached.token;
    }

    const mangaId = this.chapterOwners.get(chapterId);

    if (!mangaId) {
      throw new Error(`No reader page is known for chapter ${chapterId}`);
    }

    const token = await readTokenFrom(readerUrl(mangaId, chapterId));
    this.tokens.set(chapterId, { token, mangaId, at: Date.now() });

    return token;
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
