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
} from "@paperback/types";
import * as cheerio from "cheerio";

import { Manga18SearchForm } from "./forms";
import { DEFAULT_SORT, GENRES, SORTING_OPTIONS, type Manga18SearchMetadata } from "./models";
import { Manga18Interceptor } from "./network";
import {
  hasNextPage,
  parseChapterPages,
  parseChapters,
  parseMangaDetails,
  parseSearchResults,
} from "./parsers";
import pbconfig from "./pbconfig";

const DOMAIN = "https://manga18.club";

class Manga18ClubExtension implements ExtensionImpl<typeof pbconfig> {
  // The site is fronted by Cloudflare and throttles bursts, so keep requests
  // modest. Images come from a separate CDN and are exempt.
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new Manga18Interceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async fetch(url: string): Promise<{ $: cheerio.CheerioAPI; html: string }> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);
    return { $: cheerio.load(html), html };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { $ } = await this.fetch(`${DOMAIN}/manhwa/${mangaId}`);
    return parseMangaDetails($, mangaId, DOMAIN);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { $ } = await this.fetch(`${DOMAIN}/manhwa/${sourceManga.mangaId}`);
    return parseChapters($, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { $, html } = await this.fetch(
      `${DOMAIN}/manhwa/${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
    );

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: parseChapterPages($, html),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<Manga18SearchForm> {
    return new Manga18SearchForm(query.metadata as Manga18SearchMetadata | undefined);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as Manga18SearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const sort = sortingOption?.id ?? DEFAULT_SORT;
    const title = (query.title ?? "").trim();
    const genre = (query.metadata as Manga18SearchMetadata | undefined)?.genre;

    let url: string;
    if (title) {
      // Title search is its own endpoint and cannot be combined with a genre.
      url = `${DOMAIN}/list-manga${page > 1 ? `/${page}` : ""}?search=${encodeURIComponent(title)}`;
    } else if (genre) {
      url = `${DOMAIN}/manga-list/${genre}${page > 1 ? `/${page}` : ""}?order_by=${sort}`;
    } else {
      url = `${DOMAIN}/list-manga${page > 1 ? `/${page}` : ""}?order_by=${sort}`;
    }

    const { $ } = await this.fetch(url);
    const items = parseSearchResults($);
    const more = items.length > 0 && hasNextPage($, page);

    return {
      items,
      metadata: more
        ? ({ ...paging, page: page + 1, genre } satisfies Manga18SearchMetadata)
        : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "lastest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: "views", title: "Most Viewed", type: DiscoverSectionType.simpleCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      return {
        items: GENRES.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genre: genre.id } satisfies Manga18SearchMetadata },
        })),
      };
    }

    const paging = metadata as Manga18SearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const { $ } = await this.fetch(
      `${DOMAIN}/list-manga${page > 1 ? `/${page}` : ""}?order_by=${section.id}`,
    );
    const items = parseSearchResults($);

    return {
      items: items.map((item) => ({
        type: "simpleCarouselItem" as const,
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      })),
      metadata: items.length > 0 && hasNextPage($, page) ? { page: page + 1 } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const Manga18Club = new Manga18ClubExtension();
