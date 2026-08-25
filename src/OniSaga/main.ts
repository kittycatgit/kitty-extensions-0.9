/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CookieStorageInterceptor,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  CHAPTER_CACHE_INDEX_KEY,
  CHAPTER_CACHE_MAX_ENTRIES,
  CHAPTER_CACHE_TTL_MS,
  DOMAIN,
  HOME_SECTIONS,
  USER_AGENT,
  WEBVIEW_BUDGET_MS,
  WEBVIEW_MAX_CONCURRENCY,
  WEBVIEW_PAGE_CAP,
  WEBVIEW_START_CONCURRENCY,
  MINTS_KEY,
  MINT_CEILING,
  MINT_WINDOW_MS,
  OBJECTING_COOLDOWN_MS,
  OBJECTING_UNTIL_KEY,
  buildChapterMintInject,
  chapterCacheKey,
  readerUrl,
  type OniSagaSearchMetadata,
} from "./models";
import { OniSagaInterceptor } from "./network";
import { parseChapters, parseListing, parseMangaDetails } from "./parsers";
import type pbconfigType from "./pbconfig";

/** Lightest page that still carries the header search component. */
const SNAPSHOT_PAGE = "/top-manga";

/** Browsing with no query: the lightest route that paginates. */
const BROWSE_PATH = "/top-manga";

// Only ONE WebView pool may run at a time. Two overlapping pools double the
// mint rate against the site's burst limit, so every resolution queues through
// this single tail - the native WebView cannot be stopped once it starts, so
// not-starting-a-second is the only real guard. Module scope persists across
// the native bridge the way `setState` does.
let poolTail: Promise<unknown> = Promise.resolve();

/** Runs `work` with at most one pool alive across the whole extension: it waits
 * for whatever pool is ahead of it, then holds the tail until it is done. A
 * queued opener re-checks the cache once it is its turn, since the pool ahead
 * may have been resolving the very chapter it wants. */
async function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  const ahead = poolTail;
  let release!: () => void;
  poolTail = new Promise<void>((r) => {
    release = r;
  });

  try {
    await ahead.catch(() => undefined);
    return await work();
  } finally {
    release();
  }
}

/** What the WebView chapter resolver reports back: either the resolved chapter
 * or a flag naming the early outcome it met instead. */
type WebViewChapterOutcome = {
  urls?: (string | null)[];
  total?: number;
  token?: string;
  got?: number;
  r429?: number;
  r403?: number;
  refreshes?: number;
  conc?: number;
  odd?: Record<string, number>;
  ms: number;
  cf?: boolean;
  preparing?: boolean;
  importing?: boolean;
  nopages?: boolean;
  failed?: boolean;
};

class OniSagaExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new OniSagaInterceptor("main");

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    // The page interceptor is the only throttle: it paces page resolution and
    // honours a 429's Retry-After itself. A window-based limiter on top of it
    // only stalled the reader for a full minute at a time.
    this.interceptor.registerInterceptor();
  }

  private async fetch(path: string): Promise<cheerio.CheerioAPI> {
    const url = path.startsWith("http") ? path : `${DOMAIN}${path}`;
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetch(`/manga/${mangaId}`);
    return parseMangaDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetch(`/manga/${sourceManga.mangaId}`);
    const chapters = parseChapters($, sourceManga);

    return chapters;
  }

  /**
   * Resolves every page of a chapter when it opens.
   *
   * The chapter's own page is read with the app's client - the request the site
   * answers most reliably, and it yields the reader token and the chapter's
   * length together. Minting the addresses then happens inside a WebView, which
   * the site holds to a browser's rate limit while it throttles the app client
   * to roughly one page every two seconds. Whatever the WebView does not land
   * is handed back as a marker for the reader's own path to resolve as it is
   * reached, so a chapter always opens even when the WebView cannot run.
   */
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const chapterId = chapter.chapterId;

    // A chapter resolved minutes ago is served straight from state - flipping
    // back to it, or re-opening after a mistap, costs nothing.
    const cached = Application.getState(chapterCacheKey(chapterId)) as
      | { urls: string[]; at: number }
      | undefined;

    if (cached && Date.now() - cached.at < CHAPTER_CACHE_TTL_MS) {
      console.log(`[OniSaga] chapter ${chapterId} served from cache (${cached.urls.length} pages)`);
      return { id: chapterId, mangaId, pages: cached.urls };
    }

    if (cached) {
      Application.setState(undefined, chapterCacheKey(chapterId));
    }

    const url = readerUrl(mangaId, chapterId);
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);

    // Readiness first: a chapter the site has not finished preparing answers
    // with a waiting screen rather than a reader, and saying so is far more use
    // than complaining that its length cannot be read.
    const token = html.match(/readerToken['"]?\s*:\s*['"]([^'"]{8,})['"]/)?.[1];
    const preparing = /loading pages|hang tight|being processed|preparing/i.test(html);

    if (!token || preparing) {
      throw new Error(
        `The site is still preparing chapter ${chapterId}. Give it a minute and open it again.`,
      );
    }

    const declared = Number(
      html.match(/['"]?(?:pageCount|totalPages|pages_count)['"]?\s*:\s*(\d+)/)?.[1] ??
        html.match(/(\d+)\s*pages\b/i)?.[1] ??
        html.match(/data-pages=['"](\d+)['"]/)?.[1] ??
        chapter.additionalInfo?.pages ??
        0,
    );

    let total = Number.isFinite(declared) && declared > 0 ? declared : 0;

    if (total <= 0) {
      const info = await this.interceptor.chapterInfo(chapterId, token);

      if (info?.importing) {
        throw new Error(
          `The site is still importing chapter ${chapterId}. Give it a minute and open it again.`,
        );
      }

      total = info?.total ?? 0;
    }

    if (total <= 0) {
      throw new Error(
        `Chapter ${chapterId} reports no pages. It may have been removed, or the site may still be working on it.`,
      );
    }

    const outcome = await runExclusive(() => this.mintViaWebView(url, chapterId, token, total));

    if (!outcome) {
      throw new Error(
        `Chapter ${chapterId} could not be loaded just now. Open it again in a moment.`,
      );
    }

    const odd = Object.keys(outcome.odd ?? {}).length ? `, odd=${JSON.stringify(outcome.odd)}` : "";
    console.log(
      `[OniSaga] minted ${outcome.got}/${total} pages in ${outcome.ms}ms, r429=${outcome.r429}, r403=${outcome.r403}, refreshes=${outcome.refreshes}, concurrency ${outcome.conc}${odd}`,
    );

    this.recordMints(outcome.got ?? 0);

    if ((outcome.r429 ?? 0) > 0) {
      Application.setState(Date.now() + OBJECTING_COOLDOWN_MS, OBJECTING_UNTIL_KEY);
    }

    const pages: string[] = [];

    for (let index = 0; index < total; index += 1) {
      const resolved = outcome.urls?.[index];

      // Every page comes from the one place, or the chapter is not opened. A
      // half-resolved chapter used to be papered over with a second, far slower
      // way of fetching the rest, and that quiet hand-off is what turned a
      // ten-second open into minutes without ever saying so.
      if (!resolved) {
        throw new Error(
          `Only ${outcome.got} of ${total} pages of chapter ${chapterId} could be loaded. Open it again in a moment.`,
        );
      }

      pages.push(resolved);
    }

    // Stamped from when minting began, since that is when the addresses'
    // ten-minute signatures started to tick.
    this.cacheChapter(chapterId, pages, Date.now() - (outcome.ms ?? 0));

    return { id: chapterId, mangaId, pages };
  }

  /**
   * Mints a chapter's addresses inside a WebView. Returns null when the WebView
   * cannot do it - and says in the log exactly why, since a chapter quietly
   * falling back to the slow path is the difference between a few seconds and
   * a few minutes, and guessing at the reason afterwards helps nobody.
   */
  private async mintViaWebView(
    url: string,
    chapterId: string,
    token: string,
    total: number,
  ): Promise<WebViewChapterOutcome | null> {
    const burstBudget = Math.max(0, MINT_CEILING - this.recentMints());

    try {
      const outcome = await Application.executeInWebView({
        source: {
          html: "<html><head></head><body></body></html>",
          baseUrl: url,
          loadCSS: false,
          loadImages: false,
          userAgent: USER_AGENT,
        },
        inject: buildChapterMintInject(
          chapterId,
          url,
          token,
          total,
          WEBVIEW_PAGE_CAP,
          WEBVIEW_START_CONCURRENCY,
          WEBVIEW_MAX_CONCURRENCY,
          WEBVIEW_BUDGET_MS,
          burstBudget,
        ),
        storage: { cookies: this.cookieStorage.cookiesForUrl(url) },
      });

      for (const cookie of outcome.storage.cookies) {
        if (!cookie.expires || cookie.expires.getTime() > Date.now()) {
          this.cookieStorage.setCookie(cookie);
        }
      }

      const parsed = JSON.parse(String(outcome.result)) as WebViewChapterOutcome;

      if (parsed.cf) {
        console.log(
          `[OniSaga] webview met bot verification while minting chapter ${chapterId}; falling back to the slow path`,
        );
      }

      return parsed;
    } catch (error) {
      console.log(
        `[OniSaga] webview could not mint chapter ${chapterId} (${String(error)}); falling back to the slow path`,
      );
      return null;
    }
  }

  /** How many page addresses have been minted in the recent window, pruned as
   * it reads, so the prefetcher can keep clear of the site's burst ceiling. */
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

  /**
   * Keeps a resolved chapter for quick re-opening, and keeps the cache honest:
   * a small index records what is stored, and the oldest entries are cleared
   * once it grows past its cap, so state never accretes an entry for every
   * chapter ever read.
   */
  private cacheChapter(chapterId: string, pages: string[], mintedAt: number): void {
    Application.setState({ urls: pages, at: mintedAt }, chapterCacheKey(chapterId));

    const index = (
      (Application.getState(CHAPTER_CACHE_INDEX_KEY) as string[] | undefined) ?? []
    ).filter((id) => id !== chapterId);
    index.push(chapterId);

    while (index.length > CHAPTER_CACHE_MAX_ENTRIES) {
      const oldest = index.shift();

      if (oldest !== undefined) {
        Application.setState(undefined, chapterCacheKey(oldest));
      }
    }

    Application.setState(index, CHAPTER_CACHE_INDEX_KEY);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as OniSagaSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const title = (query.title ?? "").trim();

    // Opening the source without typing anything should still show titles, so
    // an empty query browses the catalogue instead of returning nothing.
    if (!title) {
      const page = paging?.page ?? 1;
      const $browse = await this.fetch(page > 1 ? `${BROWSE_PATH}?page=${page}` : BROWSE_PATH);
      const rows = parseListing($browse);

      return {
        items: rows,
        metadata: rows.length > 0 ? { page: page + 1 } : { completed: true },
      };
    }

    // The catalogue's own filter page weighs some 14 MB, so the header's
    // search component is used instead: it answers the same query with a
    // fragment of a few dozen kilobytes.
    const $ = await this.fetch(SNAPSHOT_PAGE);
    const token = $('meta[name="csrf-token"]').attr("content") ?? "";
    const snapshot = $("[wire\\:snapshot]")
      .toArray()
      .map((element) => $(element).attr("wire:snapshot") ?? "")
      .find((value) => value.includes("search-component"));

    if (!snapshot) {
      throw new Error("The site's search component could not be found.");
    }

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/livewire/update`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Livewire": "true",
        ...(token ? { "X-CSRF-TOKEN": token } : {}),
        referer: `${DOMAIN}${SNAPSHOT_PAGE}`,
      },
      body: JSON.stringify({
        _token: token,
        components: [{ snapshot, updates: { q: title }, calls: [] }],
      }),
    });

    const payload = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
      components?: { effects?: { html?: string } }[];
    };

    const fragment = payload.components?.[0]?.effects?.html ?? "";
    const items = fragment ? parseListing(cheerio.load(fragment)) : [];

    // The quick search answers with a single set of matches, not pages of them.
    return { items, metadata: { completed: true } };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return HOME_SECTIONS.map((section, index) => ({
      id: section.id,
      title: section.title,
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as OniSagaSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    // Resolve by id so each rail keeps its own route rather than falling
    // through to a shared default.
    const entry = HOME_SECTIONS.find((candidate) => candidate.id === section.id);

    if (!entry) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const $ = await this.fetch(page > 1 ? `${entry.path}?page=${page}` : entry.path);
    const rows = parseListing($);
    const featured = section.id === HOME_SECTIONS[0]!.id;

    return {
      items: rows.map((row) =>
        featured
          ? {
              type: "featuredCarouselItem" as const,
              mangaId: row.mangaId,
              imageUrl: row.imageUrl,
              title: row.title,
            }
          : {
              type: "simpleCarouselItem" as const,
              mangaId: row.mangaId,
              imageUrl: row.imageUrl,
              title: row.title,
            },
      ),
      metadata: entry.paginates && rows.length > 0 ? { page: page + 1 } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const OniSaga = new OniSagaExtension();
