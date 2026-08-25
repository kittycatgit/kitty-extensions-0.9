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
  buildChapterResolverInject,
  chapterCacheKey,
  pageMarkerUrl,
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

    // The reader token is minted per chapter from its own reader page, so the
    // interceptor needs to know which series each chapter belongs to.
    for (const chapter of chapters) {
      this.interceptor.noteChapterOwner(chapter.chapterId, sourceManga.mangaId);
    }

    return chapters;
  }

  /**
   * Reports the pages without resolving any of them.
   *
   * Each real page URL costs its own rate limited call and expires ten minutes
   * later, so resolving a long chapter here would both trip the limiter and
   * hand back links that die before they are read. The markers returned here
   * are swapped for freshly signed URLs by the interceptor, one at a time, as
   * the reader reaches each page.
   */
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const chapterId = chapter.chapterId;
    this.interceptor.noteChapterOwner(chapterId, mangaId);

    // A chapter resolved minutes ago is served straight from state - flipping
    // back to it, or re-opening after a mistap, costs nothing. The addresses
    // outlive the cache window comfortably, so nothing stale is handed out.
    const cached = Application.getState(chapterCacheKey(chapterId)) as
      | { urls: string[]; at: number }
      | undefined;

    if (cached) {
      if (Date.now() - cached.at < CHAPTER_CACHE_TTL_MS) {
        console.log(
          `[OniSaga] chapter ${chapterId} served from cache (${cached.urls.length} pages)`,
        );
        return { id: chapterId, mangaId, pages: cached.urls };
      }

      // Expired - clear it now rather than leave a dead blob in state.
      Application.setState(undefined, chapterCacheKey(chapterId));
    }

    // The whole open happens inside a WebView - reader page, page count, and
    // every page address - because the site holds a WebView to the browser's
    // generous limit while the app's own client is throttled to a crawl. The
    // throttled client is not consulted at all unless the WebView cannot run.
    const outcome = await this.resolveViaWebView(mangaId, chapterId);

    if (outcome?.preparing || outcome?.importing) {
      throw new Error(
        `The site is still ${outcome.importing ? "importing" : "preparing"} chapter ${chapterId}. Give it a minute and open it again.`,
      );
    }

    if (outcome?.nopages) {
      throw new Error(
        `Chapter ${chapterId} reports no pages. It may have been removed, or the site may still be working on it.`,
      );
    }

    if (outcome?.urls && outcome.total && outcome.total > 0) {
      const total = outcome.total;
      const odd = Object.keys(outcome.odd ?? {}).length
        ? `, odd=${JSON.stringify(outcome.odd)}`
        : "";
      console.log(
        `[OniSaga] webview resolved ${outcome.got}/${Math.min(total, WEBVIEW_PAGE_CAP)} of ${total} pages in ${outcome.ms}ms, r429=${outcome.r429}, r403=${outcome.r403}, refreshes=${outcome.refreshes}, concurrency settled at ${outcome.conc}${odd}`,
      );

      // The token the pool ended on is still fresh - hand it to the lazy path
      // so any page the pool did not land resolves without minting its own.
      if (outcome.token) {
        this.interceptor.noteToken(chapterId, outcome.token);
      }

      const pages: string[] = [];
      let complete = true;

      for (let index = 0; index < total; index += 1) {
        const resolved = outcome.urls[index];

        if (!resolved) {
          complete = false;
        }

        pages.push(resolved ?? pageMarkerUrl(chapterId, index));
      }

      // Only a fully resolved chapter is worth keeping: a partial one should
      // try again next open rather than pin its markers for the cache window.
      // The stamp is when resolution STARTED, since that is when the addresses
      // were minted and their ten-minute signatures began to tick.
      if (complete) {
        this.cacheChapter(chapterId, pages, Date.now() - outcome.ms);
      }

      return { id: chapterId, mangaId, pages };
    }

    // A Cloudflare page, or no WebView at all: the app-client path still knows
    // the way, and a challenge surfaces the app's own bypass rather than a
    // guess about what went wrong.
    return this.chapterDetailsViaApp(chapter, mangaId);
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

  /**
   * The chapter open done entirely with the app's own HTTP client - the road
   * taken when the WebView is unavailable or came back challenged. Slower by
   * nature (the client is what the site throttles), so every page is handed
   * out as a lazy marker for the interceptor to resolve one at a time.
   */
  private async chapterDetailsViaApp(chapter: Chapter, mangaId: string): Promise<ChapterDetails> {
    const url = readerUrl(mangaId, chapter.chapterId);
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);

    // Readiness first: a chapter the site has not finished preparing answers
    // with a waiting screen rather than a reader, and saying so is far more
    // use than complaining that its length cannot be read.
    const token = html.match(/readerToken['"]?\s*:\s*['"]([^'"]{8,})['"]/)?.[1];
    const preparing = /loading pages|hang tight|being processed|preparing/i.test(html);

    if (!token || preparing) {
      throw new Error(
        `The site is still preparing chapter ${chapter.chapterId}. Give it a minute and open it again.`,
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
      // The reader page did not say, so ask the site directly. It also reports
      // whether the chapter is still being imported, which is the honest
      // reason an otherwise fine chapter has no pages to show yet.
      const info = await this.interceptor.chapterInfo(chapter.chapterId, token);

      if (info?.importing) {
        throw new Error(
          `The site is still importing chapter ${chapter.chapterId}. Give it a minute and open it again.`,
        );
      }

      total = info?.total ?? 0;
    }

    if (total <= 0) {
      throw new Error(
        `Chapter ${chapter.chapterId} reports no pages. It may have been removed, or the site may still be working on it.`,
      );
    }

    // Hand over the token from the page just fetched, so resolving the first
    // page does not fetch the very same page again, and count this request so
    // the first resolution waits its turn rather than arriving on its heels.
    this.interceptor.noteToken(chapter.chapterId, token);
    this.interceptor.noteMeteredRequest();

    console.log(`[OniSaga] webview unavailable; ${total} pages will resolve lazily`);

    const pages: string[] = [];
    for (let index = 0; index < total; index += 1) {
      pages.push(pageMarkerUrl(chapter.chapterId, index));
    }

    return { id: chapter.chapterId, mangaId, pages };
  }

  /**
   * Runs the whole chapter open inside a WebView, which the site treats as the
   * browser it is - the fast rate limit - rather than like the app's client.
   * Returns the inject's summary, or null if the WebView is unavailable or
   * errors, so the caller can fall back to the app-client path.
   */
  private async resolveViaWebView(
    mangaId: string,
    chapterId: string,
  ): Promise<WebViewChapterOutcome | null> {
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
        inject: buildChapterResolverInject(
          chapterId,
          url,
          WEBVIEW_PAGE_CAP,
          WEBVIEW_START_CONCURRENCY,
          WEBVIEW_MAX_CONCURRENCY,
          WEBVIEW_BUDGET_MS,
        ),
        storage: { cookies: this.cookieStorage.cookiesForUrl(url) },
      });

      // Keep any fresh clearance the WebView earned along the way.
      for (const cookie of outcome.storage.cookies) {
        if (!cookie.expires || cookie.expires.getTime() > Date.now()) {
          this.cookieStorage.setCookie(cookie);
        }
      }

      return JSON.parse(String(outcome.result)) as WebViewChapterOutcome;
    } catch {
      // Older app builds answer executeInWebView with "Not Implemented", and
      // any WebView failure should simply hand back to the app-client path.
      return null;
    }
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
