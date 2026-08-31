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
  MAX_CHAPTER_LOADS,
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

// Lightest page that still carries the header search component.
const SNAPSHOT_PAGE = "/top-manga";

const BROWSE_PATH = "/top-manga";

const CHAPTER_ORDER_INDEX_KEY = "onisaga.order.index";
const CHAPTER_ORDER_MAX = 3;

function chapterOrderKey(mangaId: string): string {
  return `onisaga.order.${mangaId}`;
}

let readyingAhead = false;

// Two overlapping WebView pools double the mint rate against the site's burst
// limit, and a WebView cannot be stopped once it starts. Never run a second one.
let poolTail: Promise<unknown> = Promise.resolve();

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
    // The interceptor is the only throttle; it honours a 429's Retry-After
    // itself. A window limiter on top of it stalls the reader for a full minute.
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

  // Each answer carries the whole list so far plus a fresh snapshot, which the
  // next press must be made with.
  private async pressLoadMore(
    snapshot: string,
    token: string,
    referer: string,
  ): Promise<{ html: string; snapshot: string } | undefined> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/livewire/update`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Livewire": "true",
        ...(token ? { "X-CSRF-TOKEN": token } : {}),
        referer,
      },
      body: JSON.stringify({
        _token: token,
        components: [
          {
            snapshot,
            updates: {},
            calls: [{ path: "", method: "loadMoreChapters", params: [] }],
          },
        ],
      }),
    });

    try {
      const payload = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
        components?: { snapshot?: string; effects?: { html?: string } }[];
      };
      const component = payload.components?.[0];
      const html = component?.effects?.html ?? "";

      return html ? { html, snapshot: component?.snapshot ?? snapshot } : undefined;
    } catch {
      return undefined;
    }
  }

  // The page ships only the first hundred chapters; the rest sit behind a
  // Livewire "load more" button.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const path = `/manga/${sourceManga.mangaId}`;
    const $ = await this.fetch(path);
    const collected: Chapter[] = [];
    const seen = new Set<string>();

    const take = (page: cheerio.CheerioAPI): number => {
      let added = 0;

      for (const chapter of parseChapters(page, sourceManga)) {
        if (seen.has(chapter.chapterId)) {
          continue;
        }

        seen.add(chapter.chapterId);
        collected.push(chapter);
        added += 1;
      }

      return added;
    };

    take($);

    const token = $('meta[name="csrf-token"]').attr("content") ?? "";
    let snapshot = "";

    for (const element of $("[wire\\:snapshot]").toArray()) {
      const node = $(element);

      if (node.find('button[wire\\:click="loadMoreChapters"]').length > 0) {
        snapshot = node.attr("wire:snapshot") ?? "";
        break;
      }
    }

    for (let press = 0; snapshot && press < MAX_CHAPTER_LOADS; press++) {
      const step = await this.pressLoadMore(snapshot, token, `${DOMAIN}${path}`);

      if (!step) {
        break;
      }

      snapshot = step.snapshot;

      if (take(cheerio.load(step.html)) === 0) {
        break;
      }
    }

    const sorted = collected.sort((left, right) => right.chapNum - left.chapNum);
    const chapters = sorted.map((chapter, index) => ({
      ...chapter,
      sortingIndex: sorted.length - index,
    }));

    this.rememberOrder(sourceManga.mangaId, chapters);

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const chapterId = chapter.chapterId;

    const cached = Application.getState(chapterCacheKey(chapterId)) as
      | { urls: string[]; at: number }
      | undefined;

    if (cached && Date.now() - cached.at < CHAPTER_CACHE_TTL_MS) {
      console.log(`[OniSaga] chapter ${chapterId} served from cache (${cached.urls.length} pages)`);

      this.readyNextChapter(mangaId, chapterId);

      return { id: chapterId, mangaId, pages: cached.urls };
    }

    if (cached) {
      Application.setState(undefined, chapterCacheKey(chapterId));
    }

    const pages = await this.resolveChapter(mangaId, chapterId, chapter.additionalInfo?.pages);

    // Paperback wants every page address before it opens a chapter and the site
    // mints them one at a time, so the boundary wait can only be moved, not cut.
    this.readyNextChapter(mangaId, chapterId);

    return { id: chapterId, mangaId, pages };
  }

  private async resolveChapter(
    mangaId: string,
    chapterId: string,
    declaredPages?: string,
  ): Promise<string[]> {
    const url = readerUrl(mangaId, chapterId);
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);

    // A chapter the site has not finished preparing serves a waiting screen
    // instead of a reader, with no token on it.
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

    this.adjustGap((outcome.r429 ?? 0) > 0 || outcome.cf === true);

    const pages: string[] = [];

    for (let index = 0; index < total; index += 1) {
      const resolved = outcome.urls?.[index];

      // All pages or none. Resolving the stragglers another way is slow enough
      // to turn a ten-second open into minutes, so fail loudly instead.
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

    // Stamped from when minting began: the URL signatures expire ten minutes
    // from then, not from now.
    this.cacheChapter(chapterId, pages, Date.now() - (outcome.ms ?? 0));

    return pages;
  }

  // Skipped while the gap is wide: the site has just pushed back, and the next
  // chapter is not worth spending a refusal on.
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

    void this.resolveChapter(mangaId, next.id)
      .then((pages) => {
        console.log(`[OniSaga] chapter ${next.id} made ready ahead (${pages.length} pages)`);
      })
      .catch(() => {
        // Best effort; it just opens the ordinary way when reached.
      })
      .then(() => {
        readyingAhead = false;
      });
  }

  // The site throttles the app client to about one page every two seconds but
  // holds a WebView only to a browser's rate limit.
  private async mintViaWebView(
    url: string,
    chapterId: string,
    token: string,
    total: number,
  ): Promise<WebViewChapterOutcome | null> {
    const gap = this.currentGap();

    // Running out of budget means the chapter does not open at all, so allow
    // for every page at the current gap.
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
        // A challenge on the page API is throttling, not something the reader
        // can clear, and there is one per page - so back off instead of prompting.
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

  private currentGap(): number {
    const stored = Application.getState(MINT_GAP_KEY) as number | undefined;
    return Math.min(Math.max(stored ?? GAP_START_MS, GAP_MIN_MS), GAP_MAX_MS);
  }

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

    if (!title) {
      const page = paging?.page ?? 1;
      const $browse = await this.fetch(page > 1 ? `${BROWSE_PATH}?page=${page}` : BROWSE_PATH);
      const rows = parseListing($browse);

      return {
        items: rows,
        metadata: rows.length > 0 ? { page: page + 1 } : { completed: true },
      };
    }

    // The catalogue's filter page weighs about 14 MB. The header's search
    // component answers the same query in a few dozen kilobytes.
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

    // The quick search answers with one set of matches, not pages of them.
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
