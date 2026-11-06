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
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { decodeId } from "../shared/ids";
import { OniSagaSearchForm } from "./forms";
import {
  CHAPTER_PAGE_LIMIT,
  DEFAULT_SORT,
  DOMAIN,
  GENRES_SECTION_ID,
  GENRE_CACHE_TTL,
  GENRE_STATE_KEY,
  HOME_SECTIONS,
  LANG,
  SORTING_OPTIONS,
  coverUrl,
  type OniSagaMetadata,
  type Option,
} from "./models";
import { OniSagaInterceptor } from "./network";
import {
  parseChapters,
  parseGenres,
  parseListing,
  parseMangaDetails,
  parsePages,
  parseSpotlight,
  parseTrending,
  parseUpdates,
} from "./parsers";
import type pbconfigType from "./pbconfig";

class OniSagaExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new OniSagaInterceptor("main");

  private genreCache?: Option[];

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async fetch(path: string): Promise<cheerio.CheerioAPI> {
    const url = path.startsWith("http") ? path : `${DOMAIN}${path}`;
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetch(`/title/${mangaId}?tab=details&lang=${LANG}`);
    return parseMangaDetails($, mangaId);
  }

  // The English edition, 100 chapters per cursor page, oldest first.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < CHAPTER_PAGE_LIMIT; page++) {
      const query = `?lang=${LANG}&chapters=all${cursor ? `&cc=${encodeURIComponent(cursor)}` : ""}`;
      const $ = await this.fetch(`/title/${sourceManga.mangaId}${query}`);
      const parsed = parseChapters($, sourceManga);

      for (const chapter of parsed.chapters) {
        if (!seen.has(chapter.chapterId)) {
          seen.add(chapter.chapterId);
          chapters.push(chapter);
        }
      }

      if (!parsed.cursor || parsed.cursor === cursor || parsed.chapters.length === 0) {
        break;
      }
      cursor = parsed.cursor;
    }

    if (chapters.length === 0) {
      throw new Error(`No English chapters were listed for ${sourceManga.mangaId}.`);
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  // The reader page embeds every page as a signed media URL that expires in
  // a couple of hours, so nothing here is cached.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/read/${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
      method: "GET",
    });
    const pages = parsePages(Application.arrayBufferToUTF8String(buffer));

    if (pages.length === 0) {
      throw new Error("The reader page listed no images for this chapter.");
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async getGenres(): Promise<Option[]> {
    if (this.genreCache) {
      return this.genreCache;
    }

    const cached = Application.getState(GENRE_STATE_KEY) as
      | { at: number; genres: Option[] }
      | undefined;
    if (cached && Date.now() - cached.at < GENRE_CACHE_TTL && cached.genres.length > 0) {
      this.genreCache = cached.genres;
      return cached.genres;
    }

    const genres = parseGenres(await this.fetch("/browse?medium=comic"));
    if (genres.length === 0) {
      throw new Error("The browse page listed no genres.");
    }

    Application.setState({ at: Date.now(), genres }, GENRE_STATE_KEY);
    this.genreCache = genres;
    return genres;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<OniSagaSearchForm> {
    let genres: Option[] | undefined;
    try {
      genres = await this.getGenres();
    } catch {
      genres = undefined;
    }

    return new OniSagaSearchForm(query.metadata as OniSagaMetadata | undefined, genres);
  }

  // Every filter the catalogue form knows, repeated per value as the form does.
  private browseQuery(title: string, filters: OniSagaMetadata | undefined, sort: string): string {
    const params = ["medium=comic"];
    if (title) {
      params.push(`q=${encodeURIComponent(title)}`);
    }

    const add = (key: string, values: string[] | undefined): void => {
      for (const value of values ?? []) {
        params.push(`${key}=${encodeURIComponent(decodeId(value))}`);
      }
    };
    add("genre", filters?.genres);
    add("theme", filters?.themes);
    add("status", filters?.statuses);
    add("origin", filters?.origins);
    add("demographic", filters?.demographics);
    add("form", filters?.forms);

    if (sort !== DEFAULT_SORT) {
      params.push(`sort=${sort}`);
    }

    return `/browse?${params.join("&")}`;
  }

  private withCursor(path: string, cursor: string | undefined): string {
    return cursor
      ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`
      : path;
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as OniSagaMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = query.metadata as OniSagaMetadata | undefined;
    const path = this.browseQuery(
      (query.title ?? "").trim(),
      filters,
      sortingOption?.id ?? DEFAULT_SORT,
    );
    const listing = parseListing(await this.fetch(this.withCursor(path, paging?.cursor)));

    return {
      items: listing.items,
      metadata: listing.cursor ? { cursor: listing.cursor } : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type:
          section.id === "spotlight"
            ? DiscoverSectionType.featured
            : section.id === "updates"
              ? DiscoverSectionType.chapterUpdates
              : DiscoverSectionType.simpleCarousel,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === GENRES_SECTION_ID) {
      const genres = await this.getGenres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genres: [genre.id] } satisfies OniSagaMetadata },
        })),
      };
    }

    const paging = metadata as OniSagaMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const entry = HOME_SECTIONS.find((candidate) => candidate.id === section.id);
    if (!entry) {
      return { items: [] };
    }

    if (section.id === "spotlight") {
      const slides = parseSpotlight(await this.fetch(entry.path));
      return {
        items: slides.map((slide) => ({
          type: "featuredCarouselItem" as const,
          mangaId: slide.slug,
          imageUrl: coverUrl(slide.slug),
          title: slide.title,
          ...(slide.summary ? { summary: slide.summary } : {}),
        })),
        metadata: { completed: true },
      };
    }

    if (section.id === "trending") {
      return {
        items: parseTrending(await this.fetch(entry.path)).map((item) => ({
          type: "simpleCarouselItem" as const,
          mangaId: item.mangaId,
          imageUrl: item.imageUrl,
          title: item.title,
        })),
        metadata: { completed: true },
      };
    }

    if (section.id === "updates") {
      const feed = parseUpdates(await this.fetch(this.withCursor(entry.path, paging?.cursor)));
      return {
        items: feed.entries.map((item) => ({
          type: "chapterUpdatesCarouselItem" as const,
          mangaId: item.mangaId,
          chapterId: item.chapterId,
          imageUrl: coverUrl(item.mangaId),
          title: item.title,
          subtitle: item.label,
          ...(item.date ? { publishDate: item.date } : {}),
        })),
        metadata: feed.cursor ? { cursor: feed.cursor } : { completed: true },
      };
    }

    const listing = parseListing(await this.fetch(this.withCursor(entry.path, paging?.cursor)));
    return {
      items: listing.items.map((item) => ({
        type: "simpleCarouselItem" as const,
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      })),
      metadata: listing.cursor ? { cursor: listing.cursor } : { completed: true },
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
