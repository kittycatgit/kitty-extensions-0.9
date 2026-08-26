/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  BasicRateLimiter,
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
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import { compact, HiperDexApi, ReaderForbiddenError } from "./api";
import { HiperDexSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  GENRE_CACHE_TTL,
  GENRE_STATE_KEY,
  GENRES,
  GENRES_SECTION_ID,
  LATEST_SECTION_ID,
  CHAPTER_COUNT_KEY,
  CHAPTER_COUNT_MAX,
  CHAPTER_COUNT_TTL_MS,
  MAX_RATING,
  LATEST_PAGE_SIZE,
  PAGE_SIZE,
  SORTING_OPTIONS,
  TRENDING_PAGE_SIZE,
  TRENDING_SECTIONS,
  type ApiChapter,
  type ApiGenre,
  type ApiLatestItem,
  type ApiPage,
  type ApiSeries,
  type ApiTrendingItem,
  type HiperDexSearchMetadata,
} from "./models";
import { HiperDexInterceptor } from "./network";
import { contentRatingOf, parseChapterPages, parseChapters, parseMangaDetails } from "./parsers";
import type pbconfigType from "./pbconfig";

const DOMAIN = "https://hiperdex.tv";

/**
 * Stand-in for a series with no artwork.
 *
 * An empty address is rejected outright, and because a row's items are
 * converted together one blank cover takes the whole row down with it. This is
 * a real address that holds no image, so the app falls through to its own
 * placeholder instead of being handed nothing.
 */
const FALLBACK_COVER = `${DOMAIN}/_no-cover.png`;

/**
 * The reader route rejects any call that does not carry this header. Its name
 * and value are assembled at runtime by the site's bundle rather than appearing
 * as literals, so they cannot be read out of the script; this pair is what the
 * current deployment sends. If the site rotates it, {@link discoverReaderToken}
 * recovers the new pair from a webview and caches it.
 */
const DEFAULT_READER_HEADER = "x-cfg-auth";
const DEFAULT_READER_TOKEN = "yceqt7qgu004";
const READER_TOKEN_STATE_KEY = "hiperdex.readerToken";

type ReaderToken = { name: string; value: string };

/**
 * Captures whichever `x-…-auth` header the app attaches to its own reader call.
 *
 * The injected source is wrapped in a function body, so it returns directly,
 * and the returned promise is awaited before the result comes back.
 */
const TOKEN_DISCOVERY_SCRIPT = `
  return new Promise(function (resolve) {
    var settled = false;
    function finish(value) {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    }

    function inspect(headers) {
      for (var key in headers) {
        if (/^x-[a-z-]*auth$/i.test(key) && headers[key]) {
          finish({ name: key.toLowerCase(), value: String(headers[key]) });
        }
      }
    }

    var original = window.fetch;
    window.fetch = function () {
      try {
        var headers = {};
        var input = arguments[0];
        var init = arguments[1];

        if (input && input.headers && input.headers.forEach) {
          input.headers.forEach(function (value, key) { headers[key] = value; });
        }
        if (init && init.headers) {
          if (init.headers.forEach) {
            init.headers.forEach(function (value, key) { headers[key] = value; });
          } else {
            Object.keys(init.headers).forEach(function (key) { headers[key] = init.headers[key]; });
          }
        }
        inspect(headers);
      } catch (error) {
        /* keep the original call intact whatever happens here */
      }

      return original.apply(this, arguments);
    };

    // The app fetches pages on its own once the reader route mounts. Re-entering
    // the route forces that call in case the hook landed after the first one.
    setTimeout(function () {
      try {
        history.pushState({}, "", window.location.pathname);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch (error) {
        /* navigation is a nudge, not a requirement */
      }
    }, 1500);

    setTimeout(function () { finish(null); }, 20000);
  });
`;

class HiperDexExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new HiperDexInterceptor("main", DOMAIN);

  private readonly api = new HiperDexApi(DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private readerToken(): ReaderToken {
    const stored = Application.getState(READER_TOKEN_STATE_KEY) as ReaderToken | undefined;

    if (stored && typeof stored.name === "string" && typeof stored.value === "string") {
      return stored;
    }

    return { name: DEFAULT_READER_HEADER, value: DEFAULT_READER_TOKEN };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.api.query<ApiSeries>("series.bySlugWithGenres", { slug: mangaId });

    if (!series) {
      throw new Error(`No title found for ${mangaId}`);
    }

    // The chapter list is a separate call, but the count belongs on the detail
    // page, so it is fetched here rather than left blank.
    let chapterCount: number | undefined;
    try {
      const chapters = await this.api.query<ApiChapter[]>("series.chapters", {
        seriesId: series.id,
      });
      chapterCount = Array.isArray(chapters) ? chapters.length : undefined;
    } catch {
      chapterCount = undefined;
    }

    return parseMangaDetails(series, DOMAIN, chapterCount);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = await this.api.query<ApiSeries>("series.bySlugWithGenres", {
      slug: sourceManga.mangaId,
    });

    const rows = await this.api.query<ApiChapter[]>("series.chapters", { seriesId: series.id });

    return parseChapters(Array.isArray(rows) ? rows : [], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const chapterNumber = Number(chapter.chapterId);

    // The reader is keyed by number and id together, and the id is only in the
    // chapter list, so it is resolved here rather than packed into chapterId.
    const series = await this.api.query<ApiSeries>("series.bySlugWithGenres", { slug: mangaId });
    const rows = await this.api.query<ApiChapter[]>("series.chapters", { seriesId: series.id });
    const row = (Array.isArray(rows) ? rows : []).find((entry) => entry.number === chapterNumber);

    if (!row) {
      throw new Error(`Chapter ${chapter.chapterId} is no longer listed for ${mangaId}`);
    }

    const input = { seriesSlug: mangaId, chapterNumber, chapterId: row.id };
    let pages: ApiPage[];

    try {
      pages = await this.readerPages(input);
    } catch (error: unknown) {
      if (!(error instanceof ReaderForbiddenError)) {
        throw error;
      }

      // The stored pair is stale, so recover the current one and try once more.
      const discovered = await this.discoverReaderToken(mangaId, chapterNumber);

      if (!discovered) {
        throw new Error(
          "The site refused the page request. Its reader token has changed and could not be read automatically.",
        );
      }

      Application.setState(discovered, READER_TOKEN_STATE_KEY);
      pages = await this.readerPages(input, discovered);
    }

    const urls = parseChapterPages(Array.isArray(pages) ? pages : []);

    if (urls.length === 0) {
      throw new Error(`Unable to read any pages for chapter ${chapter.chapterId}`);
    }

    return { id: chapter.chapterId, mangaId, pages: urls };
  }

  private async readerPages(input: unknown, token?: ReaderToken): Promise<ApiPage[]> {
    const { name, value } = token ?? this.readerToken();
    return await this.api.query<ApiPage[]>("reader.chapterPages", input, { [name]: value });
  }

  /**
   * Loads the chapter in a webview and reads the auth header the app sends.
   *
   * Best effort: any failure returns undefined so the caller can report the
   * refusal plainly rather than surfacing a webview error.
   */
  private async discoverReaderToken(
    mangaId: string,
    chapterNumber: number,
  ): Promise<ReaderToken | undefined> {
    try {
      const url = `${DOMAIN}/manga/${mangaId}/${chapterNumber}`;
      const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });

      const { result } = await Application.executeInWebView({
        source: {
          html: Application.arrayBufferToUTF8String(buffer),
          baseUrl: url,
          loadCSS: false,
          loadImages: false,
        },
        inject: TOKEN_DISCOVERY_SCRIPT,
        storage: { cookies: this.webViewCookies() },
      });

      const token = result as ReaderToken | null;

      if (token && typeof token.name === "string" && typeof token.value === "string") {
        return { name: token.name, value: token.value };
      }
    } catch {
      /* fall through to the caller's plain error */
    }

    return undefined;
  }

  /**
   * The catalogue's genre list, fetched once a day and cached.
   *
   * The site publishes its genres through the API, so they are read from there
   * rather than frozen into the build; the bundled list is only a fallback for
   * when that request fails, so the filter is never left empty.
   */
  private async genreTags(): Promise<Tag[]> {
    const cached = Application.getState(GENRE_STATE_KEY) as
      | { at?: number; genres?: Tag[] }
      | undefined;

    if (
      cached?.genres &&
      cached.genres.length > 0 &&
      typeof cached.at === "number" &&
      Date.now() - cached.at < GENRE_CACHE_TTL
    ) {
      return cached.genres;
    }

    try {
      const rows = await this.api.query<ApiGenre[]>("search.genres", null);

      const genres = (Array.isArray(rows) ? rows : [])
        .filter((row) => row?.slug && row?.name)
        .map((row) => ({ id: row.slug, title: row.name }))
        .sort((a, b) => a.title.localeCompare(b.title));

      if (genres.length > 0) {
        Application.setState({ at: Date.now(), genres }, GENRE_STATE_KEY);
        return genres;
      }
    } catch {
      /* fall back to the bundled list below */
    }

    return cached?.genres && cached.genres.length > 0 ? cached.genres : GENRES;
  }

  /**
   * Turns genre slugs into the names the search filter matches on.
   *
   * Filter values are compared against the genre's display name, not its slug:
   * a single-word genre works either way, but "age-gap" matches nothing where
   * "Age Gap" matches. Slugs are still what the form and tag ids carry, since
   * an id may not contain spaces.
   */
  private async genreNames(slugs: string[]): Promise<string[]> {
    const tags = await this.genreTags();
    const bySlug = new Map(tags.map((tag) => [tag.id, tag.title]));

    return slugs.map((slug) => bySlug.get(slug) ?? slug.replace(/-/g, " "));
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<HiperDexSearchForm> {
    return new HiperDexSearchForm(
      query.metadata as HiperDexSearchMetadata | undefined,
      await this.genreTags(),
    );
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as HiperDexSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const filters = (paging ??
      (query.metadata as HiperDexSearchMetadata | undefined) ??
      {}) as HiperDexSearchMetadata;
    const offset = paging?.offset ?? 0;
    const sort = paging?.sort ?? sortingOption?.id ?? DEFAULT_SORT;

    const genreSlugs = filters.genres && filters.genres.length > 0 ? filters.genres : undefined;

    const response = await this.api.query<{ hits?: ApiSeries[]; totalHits?: number }>(
      "search.query",
      {
        q: (query.title ?? "").trim(),
        sort,
        // An unset filter has to be absent: the API rejects an explicit null.
        filters: compact({
          genres: genreSlugs ? await this.genreNames(genreSlugs) : undefined,
          type: filters.type,
          status: filters.status,
          contentRating: filters.contentRating,
          year: filters.year,
        }),
        limit: PAGE_SIZE,
        offset,
        maxRating: MAX_RATING,
      },
    );

    const hits = response?.hits ?? [];
    const total = response?.totalHits ?? 0;
    const nextOffset = offset + hits.length;

    const counts = await this.chapterCounts(hits);

    return {
      items: hits.map((hit) => this.searchItem(hit, counts.get(hit.id))),
      metadata:
        hits.length > 0 && nextOffset < total
          ? compact({
              offset: nextOffset,
              sort,
              genres: genreSlugs,
              type: filters.type,
              status: filters.status,
              contentRating: filters.contentRating,
              year: filters.year,
            })
          : { completed: true },
    };
  }

  /**
   * Chapter counts for a page of search hits, in one request.
   *
   * Search itself reports nothing about chapters, so each series has to be
   * asked about; batching turns thirty questions into one round trip, and what
   * comes back is kept for a while, since a series' length rarely changes and
   * the same titles reappear on every scroll and every repeat search. A series
   * that cannot be counted simply goes without - the result still shows.
   */
  private async chapterCounts(hits: ApiSeries[]): Promise<Map<number, number>> {
    const store =
      (Application.getState(CHAPTER_COUNT_KEY) as
        | Record<string, { n: number; at: number }>
        | undefined) ?? {};
    const counts = new Map<number, number>();
    const fresh = Date.now() - CHAPTER_COUNT_TTL_MS;
    const missing: ApiSeries[] = [];

    for (const hit of hits) {
      const held = store[String(hit.id)];

      if (held && held.at >= fresh) {
        counts.set(hit.id, held.n);
      } else {
        missing.push(hit);
      }
    }

    if (missing.length === 0) {
      return counts;
    }

    const answers = await this.api.queryEach<ApiChapter[]>(
      "series.chapters",
      missing.map((hit) => ({ seriesId: hit.id })),
    );

    let learned = false;

    answers.forEach((rows, index) => {
      const hit = missing[index];

      if (!hit || !Array.isArray(rows)) {
        return;
      }

      counts.set(hit.id, rows.length);
      store[String(hit.id)] = { n: rows.length, at: Date.now() };
      learned = true;
    });

    if (learned) {
      // Keep only the newest entries, so this cannot grow without end.
      const trimmed = Object.entries(store)
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, CHAPTER_COUNT_MAX);
      Application.setState(Object.fromEntries(trimmed), CHAPTER_COUNT_KEY);
    }

    return counts;
  }

  private searchItem(hit: ApiSeries, chapters?: number): SearchResultItem {
    const bits: string[] = [];
    if (hit.type) {
      bits.push(hit.type.charAt(0).toUpperCase() + hit.type.slice(1));
    }
    if (chapters !== undefined && chapters > 0) {
      bits.push(`${chapters} chapter${chapters === 1 ? "" : "s"}`);
    }
    if (typeof hit.score === "number") {
      bits.push(`${hit.score.toFixed(1)}/5`);
    }

    return {
      mangaId: hit.slug,
      title: hit.title?.trim() || hit.slug,
      imageUrl: hit.coverUrl || FALLBACK_COVER,
      contentRating: contentRatingOf(hit.contentRating),
      ...(bits.length > 0 ? { subtitle: bits.join(" • ") } : {}),
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: TRENDING_SECTIONS[0]!.id,
        title: TRENDING_SECTIONS[0]!.title,
        type: DiscoverSectionType.featured,
      },
      { id: LATEST_SECTION_ID, title: "Recent Updates", type: DiscoverSectionType.chapterUpdates },
      {
        id: TRENDING_SECTIONS[1]!.id,
        title: TRENDING_SECTIONS[1]!.title,
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: TRENDING_SECTIONS[2]!.id,
        title: TRENDING_SECTIONS[2]!.title,
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as HiperDexSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    if (section.id === GENRES_SECTION_ID) {
      const genres = await this.genreTags();

      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genres: [genre.id] } },
        })),
        metadata: { completed: true },
      };
    }

    const page = paging?.page ?? 1;

    if (section.id === LATEST_SECTION_ID) {
      return await this.latestUpdates(page);
    }

    // Resolve the rail by its own id: falling through to a default would render
    // the same titles under three different headings.
    const trending = TRENDING_SECTIONS.find((entry) => entry.id === section.id);

    if (!trending) {
      return { items: [] };
    }

    const rows = await this.api.query<ApiTrendingItem[]>("recommendations.trending", {
      limit: TRENDING_PAGE_SIZE,
      page,
      maxRating: MAX_RATING,
      period: trending.period,
    });

    // Only the first rail is the hero banner; the rest share one carousel so the
    // trending rails read as a set rather than three different-looking blocks.
    const items = (Array.isArray(rows) ? rows : []).map((row) =>
      section.id === TRENDING_SECTIONS[0]!.id
        ? {
            type: "featuredCarouselItem" as const,
            mangaId: row.slug,
            imageUrl: row.coverUrl || FALLBACK_COVER,
            title: row.title?.trim() || row.slug,
            contentRating: contentRatingOf(row.contentRating),
            ...(row.synopsis?.trim() ? { summary: row.synopsis.trim() } : {}),
            ...(row.latestChapter ? { supertitle: `Chapter ${row.latestChapter.number}` } : {}),
          }
        : {
            type: "simpleCarouselItem" as const,
            mangaId: row.slug,
            imageUrl: row.coverUrl || FALLBACK_COVER,
            title: row.title?.trim() || row.slug,
            contentRating: contentRatingOf(row.contentRating),
            ...(row.latestChapter ? { subtitle: `Chapter ${row.latestChapter.number}` } : {}),
          },
    );

    return {
      items,
      metadata: items.length > 0 ? { page: page + 1 } : { completed: true },
    };
  }

  private async latestUpdates(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    const rows = await this.api.query<ApiLatestItem[]>("recommendations.latestChapters", {
      limit: LATEST_PAGE_SIZE,
      page,
      maxRating: MAX_RATING,
      seriesType: "all",
    });

    const items: DiscoverSectionItem[] = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const newest = (row.chapters ?? [])[0];

      if (!newest) {
        continue;
      }

      const published = newest.createdAt ? new Date(newest.createdAt) : undefined;

      items.push({
        type: "chapterUpdatesCarouselItem",
        mangaId: row.seriesSlug,
        chapterId: String(newest.number),
        imageUrl: row.seriesCoverUrl || FALLBACK_COVER,
        title: row.seriesTitle?.trim() || row.seriesSlug,
        subtitle: `Chapter ${newest.number}`,
        ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return {
      items,
      metadata: items.length > 0 ? { page: page + 1 } : { completed: true },
    };
  }

  /** Cookies the webview should start from: the session plus anything stored. */
  private webViewCookies(): Cookie[] {
    const host = DOMAIN.replace(/^https?:\/\//, "");
    const seen = new Set<string>();
    const cookies: Cookie[] = [];

    for (const cookie of this.cookieStorage.cookiesForUrl(DOMAIN)) {
      seen.add(cookie.name);
      cookies.push(cookie);
    }

    for (const [name, value] of Object.entries(this.interceptor.sessionCookies)) {
      if (!seen.has(name)) {
        cookies.push({ name, value, domain: host, path: "/" });
      }
    }

    return cookies;
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }

      this.cookieStorage.setCookie(cookie);
      // Kept alongside the store so the clearance survives however its
      // lifetime happens to parse.
      this.interceptor.setCookie(cookie.name, cookie.value);
    }
  }
}

export const HiperDex = new HiperDexExtension();
