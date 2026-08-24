/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  BasicRateLimiter,
  ContentRating,
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
  type TagSection,
} from "@paperback/types";

import { ToonTopSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  HOME_SECTIONS,
  RANKED_SECTIONS,
  SORTING_OPTIONS,
  type ToonTopItem,
  type ToonTopPagination,
  type ToonTopRef,
  type ToonTopSearchMetadata,
  type ToonTopStats,
} from "./models";
import { ToonTopInterceptor } from "./network";
import type pbconfigType from "./pbconfig";

const DOMAIN = "https://toontop.io";

class ToonTopExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 8,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new ToonTopInterceptor("main", DOMAIN);

  /** Next.js embeds a build id in its data routes; it changes on every deploy. */
  private buildId?: string;

  private genreCache?: ToonTopRef[];

  /** Pooled rows used for the locally ranked rails. */
  private pool?: { at: number; items: ToonTopItem[] };

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getBuildId(force = false): Promise<string> {
    if (this.buildId && !force) {
      return this.buildId;
    }

    const html = await this.getText(`${DOMAIN}/home`);
    const buildId = /"buildId":"([^"]+)"/.exec(html)?.[1];
    if (!buildId) {
      throw new Error("Unable to resolve the site build id");
    }

    this.buildId = buildId;
    return buildId;
  }

  /**
   * Fetch a page's data payload. A stale build id yields a 404, so resolve it
   * again once before giving up.
   */
  private async getPageProps<T>(path: string, query = ""): Promise<T> {
    for (const force of [false, true]) {
      const buildId = await this.getBuildId(force);
      try {
        const body = await this.getText(`${DOMAIN}/_next/data/${buildId}/${path}${query}`);
        return (JSON.parse(body) as { pageProps: T }).pageProps;
      } catch (error) {
        if (force) {
          throw error;
        }
      }
    }

    throw new Error(`Unable to load ${path}`);
  }

  /**
   * Build a pool to rank over.
   *
   * The `latest` listing is the source that matters: its rows carry real
   * day/week view counters, whereas the precomputed home rails report zero for
   * both. Home rails are folded in afterwards only to widen coverage.
   */
  private async getRankingPool(): Promise<ToonTopItem[]> {
    const cached = this.pool;
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      return cached.items;
    }

    const items: ToonTopItem[] = [];
    const seen = new Set<string>();
    const absorb = (rows: ToonTopItem[] | undefined): void => {
      for (const row of rows ?? []) {
        if (row?.slug && !seen.has(row.slug)) {
          seen.add(row.slug);
          items.push(row);
        }
      }
    };

    for (const page of [1, 2, 3, 4, 5, 6]) {
      try {
        const listing = await this.getPageProps<{ items?: ToonTopItem[] }>(
          "latest.json",
          `?page=${page}`,
        );
        absorb(listing.items);
      } catch {
        // A missing page just means a smaller pool; the rails still work.
      }
    }

    try {
      const home = await this.getPageProps<Record<string, unknown>>("home.json");
      for (const section of HOME_SECTIONS) {
        absorb(home[section.prop] as ToonTopItem[] | undefined);
      }
    } catch {
      // Optional widening only.
    }

    this.pool = { at: Date.now(), items };
    return items;
  }

  private toSearchResult(item: ToonTopItem): SearchResultItem {
    const subtitle = [item.displayChapters, item.displayUpdated].filter(Boolean).join(" · ");

    return {
      mangaId: item.slug,
      title: item.name,
      imageUrl: item.cover ?? "",
      contentRating: item.isAdult ? ContentRating.ADULT : ContentRating.MATURE,
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const props = await this.getPageProps<{ initialManga: ToonTopItem }>(`${mangaId}.json`);
    const manga = props.initialManga;

    const tagGroups: TagSection[] = [];
    const asTags = (refs: ToonTopRef[] | undefined): Tag[] =>
      (refs ?? []).map((ref) => ({ id: ref.slug, title: ref.name }));
    if (manga.genres?.length) {
      tagGroups.push({ id: "genres", title: "Genres", tags: asTags(manga.genres) });
    }
    if (manga.tags?.length) {
      tagGroups.push({ id: "tags", title: "Tags", tags: asTags(manga.tags) });
    }

    const additionalInfo: Record<string, string> = {};
    if (manga.displayChapters) additionalInfo["Chapters"] = manga.displayChapters;
    if (manga.displayViews) additionalInfo["Views"] = manga.displayViews;
    if (manga.displayUpdated) additionalInfo["Updated"] = manga.displayUpdated;
    if (manga.isRaw) additionalInfo["Raw"] = "Yes";
    if (manga.isMtl) additionalInfo["Machine translated"] = "Yes";

    const secondaryTitles = (manga.altNames ?? []).filter((name): name is string => !!name);
    if (manga.altName && !secondaryTitles.includes(manga.altName)) {
      secondaryTitles.push(manga.altName);
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.name,
        secondaryTitles,
        thumbnailUrl: manga.cover ?? "",
        synopsis: manga.summary ?? "",
        contentRating: manga.isAdult ? ContentRating.ADULT : ContentRating.MATURE,
        shareUrl: `${DOMAIN}/${mangaId}`,
        ...(manga.status ? { status: manga.status } : {}),
        ...(manga.authors?.[0] ? { author: manga.authors.map((a) => a.name).join(", ") } : {}),
        ...(manga.artists?.[0] ? { artist: manga.artists.map((a) => a.name).join(", ") } : {}),
        ...(manga.rating ? { rating: manga.rating } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const props = await this.getPageProps<{ initialManga: ToonTopItem }>(
      `${sourceManga.mangaId}.json`,
    );

    const chapters: Chapter[] = [];
    for (const entry of props.initialManga.chapters ?? []) {
      const chapterId = entry.slug || entry.url.split("/").filter(Boolean).pop();
      if (!chapterId) {
        continue;
      }

      const published = entry.updatedAt ? new Date(entry.updatedAt) : undefined;
      chapters.push({
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum: chapterNumber(entry),
        ...(entry.name ? { title: entry.name } : {}),
        ...(entry.group ? { version: entry.group } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const props = await this.getPageProps<{ initialChapter: { images?: string[] } }>(
      `${chapter.sourceManga.mangaId}/${chapter.chapterId}.json`,
    );

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: (props.initialChapter.images ?? []).filter((page) => !!page),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async getGenres(): Promise<ToonTopRef[]> {
    if (this.genreCache) {
      return this.genreCache;
    }

    const props = await this.getPageProps<{ genres?: ToonTopRef[] }>("latest.json");
    this.genreCache = props.genres ?? [];
    return this.genreCache;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<ToonTopSearchForm> {
    return new ToonTopSearchForm(
      query.metadata as ToonTopSearchMetadata | undefined,
      this.getGenres(),
    );
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as ToonTopSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const sort = sortingOption?.id ?? DEFAULT_SORT;
    const title = (query.title ?? "").trim();
    const genre = paging?.genre ?? (query.metadata as ToonTopSearchMetadata | undefined)?.genre;

    let items: ToonTopItem[];
    let pagination: ToonTopPagination | undefined;

    if (title) {
      // Title search has its own page and cannot be combined with a genre.
      const props = await this.getPageProps<{
        ssrItems?: ToonTopItem[];
        ssrPagination?: ToonTopPagination;
      }>("search.json", `?q=${encodeURIComponent(title)}&page=${page}`);
      items = props.ssrItems ?? [];
      pagination = props.ssrPagination;
    } else {
      const path = genre ? `genres/${genre}.json` : "latest.json";
      const props = await this.getPageProps<{
        items?: ToonTopItem[];
        pagination?: ToonTopPagination;
      }>(path, `?sort=${sort}&page=${page}`);
      items = props.items ?? [];
      pagination = props.pagination;
    }

    const next: ToonTopSearchMetadata = hasMore(pagination, page)
      ? { page: page + 1 }
      : { completed: true };
    if (genre && next.page) {
      next.genre = genre;
    }

    return { items: items.map((item) => this.toSearchResult(item)), metadata: next };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type:
          section.id === "hero" ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
      })),
      ...RANKED_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const genres = await this.getGenres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.name,
          searchQuery: {
            title: "",
            metadata: { genre: genre.slug } satisfies ToonTopSearchMetadata,
          },
        })),
      };
    }

    const paging = metadata as ToonTopSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const home = HOME_SECTIONS.find((entry) => entry.id === section.id);
    const ranked = RANKED_SECTIONS.find((entry) => entry.id === section.id);

    let items: ToonTopItem[];
    let pagination: ToonTopPagination | undefined;

    if (ranked) {
      const pool = await this.getRankingPool();
      items = [...pool]
        .filter((item) => scoreOf(item, ranked.by) > 0)
        .sort((a, b) => {
          const delta = scoreOf(b, ranked.by) - scoreOf(a, ranked.by);
          // Ratings tie constantly, so fall back to overall views.
          return delta !== 0 ? delta : (b.stats?.views ?? 0) - (a.stats?.views ?? 0);
        })
        .slice(0, 40);
    } else if (home) {
      // Every home rail is delivered in one payload, so it does not paginate.
      const props = await this.getPageProps<Record<string, ToonTopItem[]>>("home.json");
      items = props[home.prop] ?? [];
    } else {
      const props = await this.getPageProps<{
        items?: ToonTopItem[];
        pagination?: ToonTopPagination;
      }>("latest.json", `?page=${page}`);
      items = props.items ?? [];
      pagination = props.pagination;
    }

    const isFeatured = section.id === "hero";
    return {
      items: items.map((item) => {
        const base = {
          mangaId: item.slug,
          imageUrl: item.cover ?? "",
          title: item.name,
          ...(item.isAdult ? { contentRating: ContentRating.ADULT } : {}),
        };

        if (isFeatured) {
          return {
            type: "featuredCarouselItem" as const,
            ...base,
            ...(item.summary ? { summary: item.summary } : {}),
          };
        }

        const subtitle = [item.displayChapters, item.displayUpdated].filter(Boolean).join(" · ");
        return {
          type: "simpleCarouselItem" as const,
          ...base,
          ...(subtitle ? { subtitle } : {}),
        };
      }),
      metadata:
        home || ranked
          ? { completed: true }
          : hasMore(pagination, page)
            ? { page: page + 1 }
            : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

/** `number` is usually present; fall back to the leading digits of the name. */
function chapterNumber(entry: { number?: number; name: string }): number {
  if (typeof entry.number === "number" && !isNaN(entry.number)) {
    return entry.number;
  }

  const parsed = Number(/([\d.]+)/.exec(entry.name)?.[1]);
  return isNaN(parsed) ? 0 : parsed;
}

/** Rank value for a pooled row, tolerating the fields the site omits. */
function scoreOf(item: ToonTopItem, by: keyof ToonTopStats | "rating"): number {
  if (by === "rating") {
    return item.rating ?? 0;
  }

  return item.stats?.[by] ?? 0;
}

function hasMore(pagination: ToonTopPagination | undefined, page: number): boolean {
  if (!pagination) {
    return false;
  }

  if (typeof pagination.has_next === "boolean") {
    return pagination.has_next;
  }

  return (pagination.total_pages ?? page) > page;
}

export const ToonTop = new ToonTopExtension();
