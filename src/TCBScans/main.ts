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
  DOMAIN,
  HOME_SECTIONS,
  LATEST_SECTION_ID,
  PAGE_SIZE,
  PROJECTS_PATH,
  SERIES_SECTION_ID,
  chapterUrl,
  seriesUrl,
  type TCBSearchMetadata,
} from "./models";
import { TCBScansInterceptor } from "./network";
import {
  parseChapterList,
  parseLatestReleases,
  parsePages,
  parseSeriesDetails,
  parseSeriesList,
} from "./parsers";
import type pbconfigType from "./pbconfig";

class TCBScansExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new TCBScansInterceptor("main");

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
    const $ = await this.fetch(seriesUrl(mangaId));
    return parseSeriesDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetch(seriesUrl(sourceManga.mangaId));
    return parseChapterList($, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.fetch(chapterUrl(chapter.chapterId));
    const pages = parsePages($);

    if (pages.length === 0) {
      throw new Error(
        `Chapter ${chapter.chapterId} has no pages yet. It may have just been posted - try again shortly.`,
      );
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  /**
   * Every series the group scanlates, in one request.
   *
   * There are a few dozen of them and the site lists them all on one page, so
   * this is fetched once and paged through here rather than asking the site for
   * a slice at a time - it has no way to serve one.
   */
  private async allSeries(): Promise<ReturnType<typeof parseSeriesList>> {
    const $ = await this.fetch(PROJECTS_PATH);
    return parseSeriesList($);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as TCBSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 0;
    const wanted = (query.title ?? "").trim().toLowerCase();

    // The site has no search of its own - no endpoint, no form - so the list of
    // series is matched here. With a few dozen titles that is a single request,
    // and it means a search still works rather than being left out.
    const all = await this.allSeries();
    const matching = wanted
      ? all.filter((series) => series.title.toLowerCase().includes(wanted))
      : all;

    const slice = matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const more = (page + 1) * PAGE_SIZE < matching.length;

    return {
      items: slice.map((series) => ({
        mangaId: series.mangaId,
        title: series.title,
        imageUrl: series.imageUrl,
      })),
      metadata: more ? ({ page: page + 1 } satisfies TCBSearchMetadata) : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return HOME_SECTIONS.map((entry) => ({
      id: entry.id,
      title: entry.title,
      type:
        entry.id === LATEST_SECTION_ID
          ? DiscoverSectionType.chapterUpdates
          : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as TCBSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    if (section.id === LATEST_SECTION_ID) {
      const $ = await this.fetch("/");
      const releases = parseLatestReleases($);

      // A release names its own series but not which series page it belongs to,
      // and the front page does not link one to the other. Matching on the name
      // against the list of series is what ties the two together, so tapping a
      // release opens the series it came from.
      const all = await this.allSeries();
      const byTitle = new Map(all.map((series) => [series.title.toLowerCase(), series.mangaId]));

      return {
        items: releases.flatMap((release) => {
          const mangaId = byTitle.get(release.title.toLowerCase());

          // Without a series to open, a card goes nowhere - leave it out rather
          // than hand back one that cannot be tapped.
          if (!mangaId) {
            return [];
          }

          return [
            {
              type: "chapterUpdatesCarouselItem" as const,
              mangaId,
              chapterId: release.chapterId,
              title: release.title,
              imageUrl: release.imageUrl,
              ...(release.subtitle ? { subtitle: release.subtitle } : {}),
            },
          ];
        }),
        metadata: { completed: true },
      };
    }

    if (section.id === SERIES_SECTION_ID) {
      const page = paging?.page ?? 0;
      const all = await this.allSeries();
      const slice = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const more = (page + 1) * PAGE_SIZE < all.length;

      return {
        items: slice.map((series) => ({
          type: "simpleCarouselItem" as const,
          mangaId: series.mangaId,
          title: series.title,
          imageUrl: series.imageUrl,
        })),
        metadata: more ? ({ page: page + 1 } satisfies TCBSearchMetadata) : { completed: true },
      };
    }

    return { items: [], metadata: { completed: true } };
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

export const TCBScans = new TCBScansExtension();
