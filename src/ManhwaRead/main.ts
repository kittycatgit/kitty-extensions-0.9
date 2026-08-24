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

import { ManhwaReadSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  HOME_SECTIONS,
  SORTING_OPTIONS,
  type ManhwaReadSearchMetadata,
} from "./models";
import { ManhwaReadInterceptor } from "./network";
import {
  hasNextPage,
  parseChapterPages,
  parseChapters,
  parseListing,
  parseMangaDetails,
} from "./parsers";
import type pbconfigType from "./pbconfig";

const DOMAIN = "https://manhwaread.com";

class ManhwaReadExtension implements ExtensionImpl<typeof pbconfigType> {
  // Every path is behind a Cloudflare challenge, so keep the rate modest.
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new ManhwaReadInterceptor("main", DOMAIN);

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

  /** Browsing, searching and every home rail share one endpoint. */
  private browseUrl(page: number, query: string, sort: string): string {
    const path = page > 1 ? `/page/${page}/` : "/";
    const params = [
      `s=${encodeURIComponent(query)}`,
      `sortby=${encodeURIComponent(sort)}`,
      "order=desc",
    ];
    return `${DOMAIN}${path}?${params.join("&")}`;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { $ } = await this.fetch(`${DOMAIN}/manhwa/${mangaId}/`);
    return parseMangaDetails($, mangaId, DOMAIN);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { $ } = await this.fetch(`${DOMAIN}/manhwa/${sourceManga.mangaId}/`);
    return parseChapters($, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { html } = await this.fetch(
      `${DOMAIN}/manhwa/${chapter.sourceManga.mangaId}/${chapter.chapterId}/`,
    );
    const pages = parseChapterPages(html);

    if (pages.length === 0) {
      throw new Error(`Unable to read any pages for chapter ${chapter.chapterId}`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<ManhwaReadSearchForm> {
    return new ManhwaReadSearchForm(query.metadata as ManhwaReadSearchMetadata | undefined);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as ManhwaReadSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const sort =
      paging?.sort ??
      (query.metadata as ManhwaReadSearchMetadata | undefined)?.sort ??
      sortingOption?.id ??
      DEFAULT_SORT;

    const { $ } = await this.fetch(this.browseUrl(page, (query.title ?? "").trim(), sort));
    const items = parseListing($, DOMAIN);

    // Only continue while the paginator actually offers another page.
    const next: ManhwaReadSearchMetadata =
      items.length > 0 && hasNextPage($) ? { page: page + 1, sort } : { completed: true };

    return { items, metadata: next };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return HOME_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      type:
        section.id === "weekly_top"
          ? DiscoverSectionType.featured
          : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as ManhwaReadSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const sort = HOME_SECTIONS.find((entry) => entry.id === section.id)?.sort ?? DEFAULT_SORT;
    const { $ } = await this.fetch(this.browseUrl(page, "", sort));
    const rows = parseListing($, DOMAIN);
    const featured = section.id === "weekly_top";

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
              ...(row.subtitle ? { subtitle: row.subtitle } : {}),
            },
      ),
      metadata: rows.length > 0 && hasNextPage($) ? { page: page + 1, sort } : { completed: true },
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

export const ManhwaRead = new ManhwaReadExtension();
