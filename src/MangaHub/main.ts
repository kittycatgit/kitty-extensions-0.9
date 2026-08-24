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

import { gqlString, MangaHubApi } from "./api";
import { MangaHubSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  GENRE_CACHE_TTL,
  GENRE_STATE_KEY,
  GENRES,
  GENRES_SECTION_ID,
  LATEST_PAGE_SIZE,
  LATEST_SECTION_ID,
  PAGE_SIZE,
  POPULAR_UPDATES_SECTION_ID,
  SORTED_SECTIONS,
  SORTING_OPTIONS,
  SOURCE,
  type ApiChapterFull,
  type ApiGenre,
  type ApiManga,
  type ApiSearch,
  type MangaHubSearchMetadata,
} from "./models";
import { MangaHubInterceptor } from "./network";
import {
  contentRatingOf,
  coverUrl,
  parseChapterPages,
  parseChapters,
  parseMangaDetails,
} from "./parsers";
import type pbconfigType from "./pbconfig";

/** Fields shared by every listing query. */
const LIST_FIELDS =
  "id,rank,title,slug,status,image,latestChapter,genres,author,isSafe,isLicensed,updatedDate";

class MangaHubExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new MangaHubInterceptor("main");

  private readonly api = new MangaHubApi(() => this.interceptor.accessToken);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const data = await this.api.query<{ manga?: ApiManga }>(
      `{manga(x:${SOURCE},slug:${gqlString(mangaId)}){id,rank,title,alternativeTitle,slug,mainSlug,status,image,latestChapter,genres,author,artist,isWebtoon,isYaoi,isPorn,isSoftPorn,isSafe,isLicensed,description,createdDate,updatedDate,chapters{id,number,title,slug,date}}}`,
    );

    if (!data.manga) {
      throw new Error(`No title found for ${mangaId}`);
    }

    return parseMangaDetails(data.manga);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const data = await this.api.query<{ manga?: ApiManga }>(
      `{manga(x:${SOURCE},slug:${gqlString(sourceManga.mangaId)}){id,chapters{id,number,title,slug,date}}}`,
    );

    return parseChapters(data.manga?.chapters ?? [], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const number = Number(chapter.chapterId);

    const data = await this.api.query<{ chapter?: ApiChapterFull }>(
      `{chapter(x:${SOURCE},slug:${gqlString(mangaId)},number:${number}){id,mangaID,number,title,slug,date,pages,s}}`,
    );

    if (!data.chapter) {
      throw new Error(`Chapter ${chapter.chapterId} is no longer listed for ${mangaId}`);
    }

    const pages = parseChapterPages(data.chapter);

    if (pages.length === 0) {
      throw new Error(`Unable to read any pages for chapter ${chapter.chapterId}`);
    }

    return { id: chapter.chapterId, mangaId, pages };
  }

  /**
   * The catalogue's genre list, fetched once a day and cached.
   *
   * The API publishes its genres, so they are read from there rather than
   * frozen into the build; the bundled list is only a fallback for when that
   * request fails, so the filter is never left empty.
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
      const data = await this.api.query<{ genres?: ApiGenre[] }>(`{genres{id,slug,title}}`);

      const genres = (data.genres ?? [])
        .filter((genre) => genre?.slug && genre?.title)
        .map((genre) => ({ id: genre.slug, title: genre.title }))
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

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<MangaHubSearchForm> {
    return new MangaHubSearchForm(
      query.metadata as MangaHubSearchMetadata | undefined,
      await this.genreTags(),
    );
  }

  /** Builds the arguments shared by every `search` call. */
  private searchArgs(
    title: string,
    sort: string,
    filters: MangaHubSearchMetadata,
    offset: number,
    limit: number,
  ): string {
    // A genre argument is a comma-joined list of slugs, or "all" for no filter.
    // An unknown slug makes the resolver throw, so only offered slugs are sent.
    const genre = filters.genres && filters.genres.length > 0 ? filters.genres.join(",") : "all";

    return [
      `x:${SOURCE}`,
      `q:${gqlString(title)}`,
      `genre:${gqlString(genre)}`,
      `mod:${sort}`,
      ...(filters.hideNSFW ? ["hideNSFW:true"] : []),
      ...(filters.hideYaoi ? ["hideYaoi:true"] : []),
      ...(filters.hideLicensed ? ["hideLicensed:true"] : []),
      `limit:${limit}`,
      `offset:${offset}`,
      "count:true",
    ].join(",");
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as MangaHubSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const filters = (paging ??
      (query.metadata as MangaHubSearchMetadata | undefined) ??
      {}) as MangaHubSearchMetadata;
    const offset = paging?.offset ?? 0;
    const sort = paging?.sort ?? sortingOption?.id ?? DEFAULT_SORT;

    const data = await this.api.query<{ search?: ApiSearch }>(
      `{search(${this.searchArgs((query.title ?? "").trim(), sort, filters, offset, PAGE_SIZE)}){rows{${LIST_FIELDS}},count}}`,
    );

    const rows = data.search?.rows ?? [];
    const total = data.search?.count ?? 0;
    const nextOffset = offset + rows.length;

    return {
      items: rows.map((row) => this.searchItem(row)),
      metadata:
        rows.length > 0 && nextOffset < total
          ? {
              offset: nextOffset,
              sort,
              ...(filters.genres && filters.genres.length > 0 ? { genres: filters.genres } : {}),
              ...(filters.hideNSFW ? { hideNSFW: true } : {}),
              ...(filters.hideYaoi ? { hideYaoi: true } : {}),
              ...(filters.hideLicensed ? { hideLicensed: true } : {}),
            }
          : { completed: true },
    };
  }

  private searchItem(row: ApiManga): SearchResultItem {
    return {
      mangaId: row.slug,
      title: row.title?.trim() || row.slug,
      imageUrl: coverUrl(row.image),
      contentRating: contentRatingOf(row),
      ...(typeof row.latestChapter === "number"
        ? { subtitle: `Chapter ${row.latestChapter}` }
        : {}),
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: POPULAR_UPDATES_SECTION_ID,
        title: "Popular Updates",
        type: DiscoverSectionType.featured,
      },
      { id: LATEST_SECTION_ID, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      // Every sorted rail shares one carousel so they read as a set.
      ...SORTED_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as MangaHubSearchMetadata | undefined;

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

    if (section.id === POPULAR_UPDATES_SECTION_ID) {
      // This query takes no paging arguments and answers with a fixed set.
      const data = await this.api.query<{ latestPopular?: ApiManga[] }>(
        `{latestPopular(x:${SOURCE}){id,title,slug,image,latestChapter,isSafe,isLicensed}}`,
      );

      return {
        items: (data.latestPopular ?? []).map((row) => ({
          type: "featuredCarouselItem" as const,
          mangaId: row.slug,
          imageUrl: coverUrl(row.image),
          title: row.title?.trim() || row.slug,
          contentRating: contentRatingOf(row),
          ...(typeof row.latestChapter === "number"
            ? { supertitle: `Chapter ${row.latestChapter}` }
            : {}),
        })),
        metadata: { completed: true },
      };
    }

    const offset = paging?.offset ?? 0;

    if (section.id === LATEST_SECTION_ID) {
      return await this.latestUpdates(offset);
    }

    // Resolve the rail by its own id: falling through to a default would show
    // the same titles under several different headings.
    const sorted = SORTED_SECTIONS.find((entry) => entry.id === section.id);

    if (!sorted) {
      return { items: [] };
    }

    const data = await this.api.query<{ search?: ApiSearch }>(
      `{search(x:${SOURCE},q:"",genre:"all",mod:${sorted.mod},limit:${PAGE_SIZE},offset:${offset},count:true){rows{${LIST_FIELDS}},count}}`,
    );

    const rows = data.search?.rows ?? [];
    const total = data.search?.count ?? 0;
    const nextOffset = offset + rows.length;

    return {
      items: rows.map((row) => ({
        type: "simpleCarouselItem" as const,
        mangaId: row.slug,
        imageUrl: coverUrl(row.image),
        title: row.title?.trim() || row.slug,
        contentRating: contentRatingOf(row),
        ...(typeof row.latestChapter === "number"
          ? { subtitle: `Chapter ${row.latestChapter}` }
          : {}),
      })),
      metadata:
        rows.length > 0 && nextOffset < total ? { offset: nextOffset } : { completed: true },
    };
  }

  private async latestUpdates(offset: number): Promise<PagedResults<DiscoverSectionItem>> {
    const data = await this.api.query<{ latest?: ApiManga[] }>(
      `{latest(x:${SOURCE},limit:${LATEST_PAGE_SIZE},offset:${offset}){id,title,slug,image,latestChapter,isSafe,isLicensed,updatedDate,chapters{id,number,title,date}}}`,
    );

    const rows = data.latest ?? [];
    const items: DiscoverSectionItem[] = [];

    for (const row of rows) {
      // The feed carries the chapters released for each title; the newest of
      // them is what the rail links to.
      const newest = [...(row.chapters ?? [])].sort((a, b) => b.number - a.number)[0];
      const number = newest?.number ?? row.latestChapter;

      if (typeof number !== "number") {
        continue;
      }

      const published = newest?.date ? new Date(newest.date) : undefined;

      items.push({
        type: "chapterUpdatesCarouselItem",
        mangaId: row.slug,
        chapterId: String(number),
        imageUrl: coverUrl(row.image),
        title: row.title?.trim() || row.slug,
        subtitle: `Chapter ${number}`,
        contentRating: contentRatingOf(row),
        ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return {
      items,
      metadata: items.length > 0 ? { offset: offset + rows.length } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }

      this.cookieStorage.setCookie(cookie);
      // Kept alongside the store so clearance survives however its lifetime
      // happens to parse.
      this.interceptor.setCookie(cookie.name, cookie.value);
    }
  }
}

export const MangaHub = new MangaHubExtension();
