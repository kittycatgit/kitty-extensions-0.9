/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
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
  GAP_MAX_MS,
  GAP_MIN_MS,
  GAP_START_MS,
  GAP_STEP_DOWN_MS,
  GAP_STEP_UP_MS,
  MINT_GAP_KEY,
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

/**
 * Ordered chapter lists, so the chapter after this one can be made ready while
 * this one is being read. Only the few series in use are held.
 */
const CHAPTER_ORDER_INDEX_KEY = "onisaga.order.index";
const CHAPTER_ORDER_MAX = 3;

function chapterOrderKey(mangaId: string): string {
  return `onisaga.order.${mangaId}`;
}

/** Set while a chapter is being made ready in the background, so a second one
 * is never started on top of it. */
let readyingAhead = false;

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
  waited?: number;
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

  /** Chapters in reading order, kept so the next one can be made ready while
   * the current one is being read. Only the few series in use are held. */
  private rememberOrder(mangaId: string, chapters: Chapter[]): void {
    const order = chapters
      .map((c) => ({ id: c.chapterId, num: c.chapNum }))
      .sort((a, b) => a.num - b.num);

    if (order.length === 0) {
      return;
    }

    Application.setState(order, chapterOrderKey(mangaId));

    const index = (
      (Application.getState(CHAPTER_ORDER_INDEX_KEY) as string[] | undefined) ?? []
    ).filter((id) => id !== mangaId);
    index.push(mangaId);

    while (index.length > CHAPTER_ORDER_MAX) {
      const oldest = index.shift();

      if (oldest !== undefined) {
        Application.setState(undefined, chapterOrderKey(oldest));
      }
    }

    Application.setState(index, CHAPTER_ORDER_INDEX_KEY);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetch(`/manga/${sourceManga.mangaId}`);
    const chapters = parseChapters($, sourceManga);

    this.rememberOrder(sourceManga.mangaId, chapters);

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

      // Keep the chain going: this one cost nothing, so the one after it can be
      // got ready now rather than being waited for at the next boundary.
      this.readyNextChapter(mangaId, chapterId);

      return { id: chapterId, mangaId, pages: cached.urls };
    }

    if (cached) {
      Application.setState(undefined, chapterCacheKey(chapterId));
    }

    const pages = await this.resolveChapter(mangaId, chapterId, chapter.additionalInfo?.pages);

    // With this chapter in hand, get the next one ready while it is being read.
    // Paperback asks for every address before it will open a chapter, and the
    // site hands them over one at a time, so the wait at a chapter boundary
    // cannot be made short - it can only be moved somewhere the reader is not
    // sitting watching it.
    this.readyNextChapter(mangaId, chapterId);

    return { id: chapterId, mangaId, pages };
  }

  /**
   * Every page address for a chapter: its own page for the token and length,
   * then one pass in the WebView to mint them. Throws with something the reader
   * can act on if the site will not hand them all over.
   */
  private async resolveChapter(
    mangaId: string,
    chapterId: string,
    declaredPages?: string,
  ): Promise<string[]> {
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
        declaredPages ??
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

    // The site's answer sets the pace for next time: refused, and the gap
    // widens a step; clean, and it narrows. Nothing here is a guess about what
    // the limit is - only which way to lean after what just happened.
    this.adjustGap((outcome.r429 ?? 0) > 0 || outcome.cf === true);

    const pages: string[] = [];

    for (let index = 0; index < total; index += 1) {
      const resolved = outcome.urls?.[index];

      // Every page comes from the one place, or the chapter is not opened. A
      // half-resolved chapter used to be papered over with a second, far slower
      // way of fetching the rest, and that quiet hand-off is what turned a
      // ten-second open into minutes without ever saying so.
      if (!resolved) {
        const asked = Math.round((outcome.waited ?? 0) / 1000);
        throw new Error(
          asked > 0
            ? `The site is asking for about ${asked} seconds before it will hand over more pages. Open this chapter again then.`
            : `Only ${outcome.got} of ${total} pages of chapter ${chapterId} could be loaded. Open it again in a moment.`,
        );
      }

      pages.push(resolved);
    }

    // Stamped from when minting began, since that is when the addresses'
    // ten-minute signatures started to tick.
    this.cacheChapter(chapterId, pages, Date.now() - (outcome.ms ?? 0));

    return pages;
  }

  /**
   * Mints the chapter after this one while this one is being read.
   *
   * Deliberately not awaited: the reader has what it asked for and should not
   * wait on this. It runs through the same single gate as an open, so the two
   * never mint at once - and if the reader gets there first, they simply wait
   * out the pass already in flight and then find it done. Left alone if the
   * site has just pushed back, since the next chapter is not worth spending a
   * refusal on.
   */
  private readyNextChapter(mangaId: string, chapterId: string): void {
    if (readyingAhead || this.currentGap() > 0) {
      return;
    }

    const order = Application.getState(chapterOrderKey(mangaId)) as
      | { id: string; num: number }[]
      | undefined;

    if (!order?.length) {
      return;
    }

    const here = order.findIndex((c) => c.id === chapterId);
    const next = here >= 0 ? order[here + 1] : undefined;

    if (!next) {
      return;
    }

    const held = Application.getState(chapterCacheKey(next.id)) as
      | { urls: string[]; at: number }
      | undefined;

    if (held && Date.now() - held.at < CHAPTER_CACHE_TTL_MS) {
      return;
    }

    readyingAhead = true;

    // Floating on purpose - the read carries on while this happens behind it.
    void this.resolveChapter(mangaId, next.id)
      .then((pages) => {
        console.log(`[OniSaga] chapter ${next.id} made ready ahead (${pages.length} pages)`);
      })
      .catch(() => {
        // Best effort: it simply opens the ordinary way when reached.
      })
      .then(() => {
        readyingAhead = false;
      });
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
    const gap = this.currentGap();

    // Room to finish at whatever pace this connection has settled on, so a
    // chapter is not cut short simply for being long or the gap being wide.
    // Room to finish at the site's own cadence, however long the chapter is -
    // being cut short means the chapter does not open at all.
    const budgetMs = Math.min(90_000, Math.max(WEBVIEW_BUDGET_MS, total * (gap + 700) + 8_000));

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
          budgetMs,
          gap,
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
        // A challenge on the page API is the site throttling, not something the
        // reader can clear: there is one of these per page, and putting a
        // verification in front of each would bury them. It is treated as a
        // refusal, and the pace backs off. A genuine site-wide challenge still
        // reaches them through the chapter page, which the app fetches itself
        // on every open and which does raise the prompt, once.
        console.log(`[OniSaga] page API challenged while minting chapter ${chapterId}`);
      }

      return parsed;
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }

      console.log(`[OniSaga] webview could not mint chapter ${chapterId} (${String(error)})`);
      return null;
    }
  }

  /** How many page addresses have been minted in the recent window, pruned as
   * it reads, so the prefetcher can keep clear of the site's burst ceiling. */
  /** The gap this connection has settled on between mints. */
  private currentGap(): number {
    const stored = Application.getState(MINT_GAP_KEY) as number | undefined;
    return Math.min(Math.max(stored ?? GAP_START_MS, GAP_MIN_MS), GAP_MAX_MS);
  }

  /** Widens the gap a step after a refusal, narrows it after a clean chapter. */
  private adjustGap(refused: boolean): void {
    const from = this.currentGap();
    const to = refused
      ? Math.min(from + GAP_STEP_UP_MS, GAP_MAX_MS)
      : Math.max(from - GAP_STEP_DOWN_MS, GAP_MIN_MS);

    if (to !== from) {
      Application.setState(to, MINT_GAP_KEY);
      console.log(`[OniSaga] ${refused ? "refused" : "clean"}: gap ${from}ms -> ${to}ms`);
    }
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
