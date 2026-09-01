/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { CoffeeSearchForm } from "./forms";
import {
  browseUrl,
  chapterUrl,
  chaptersUrl,
  DOMAIN,
  FEATURED_ROW,
  genreUrl,
  ROWS,
  searchUrl,
  SEEN_LIMIT,
  seriesUrl,
  SORTS,
  type CoffeeSearchMetadata,
} from "./models";
import { CoffeeMangaInterceptor } from "./network";
import {
  parseChapters,
  parseFeatured,
  parseGenres,
  parsePages,
  parseResults,
  parseSeries,
} from "./parsers";
import pbconfig from "./pbconfig";

const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

let genreCache: { at: number; genres: Tag[] } | undefined;

class CoffeeMangaExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new CoffeeMangaInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app's own cookie store keeps the bypass cookies; nothing to hold here.
  }

  private async document(url: string): Promise<cheerio.CheerioAPI> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.document(seriesUrl(mangaId)), mangaId);
  }

  // The series page's own chapter JSON is served stale and truncated; this
  // POST route is uncached and complete.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const [, buffer] = await Application.scheduleRequest({
      url: chaptersUrl(sourceManga.mangaId),
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const chapters = parseChapters($, sourceManga);

    if (chapters.length === 0) {
      throw new Error(`No chapters were listed for ${sourceManga.mangaId}.`);
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.document(chapterUrl(chapter.sourceManga.mangaId, chapter.chapterId));
    const pages = parsePages($);

    if (pages.length === 0) {
      throw new Error(`No pages were listed for ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.label }));
  }

  async getSearchResults(
    query: SearchQuery<CoffeeSearchMetadata>,
    metadata: CoffeeSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();
    const genre = (query.metadata as CoffeeSearchMetadata | undefined)?.genre ?? metadata?.genre;

    // A genre page cannot be searched by title, so when both are given the
    // genre picks the listing and the title filters what comes back.
    const url = genre
      ? genreUrl(genre, page, sortingOption?.id)
      : title
        ? searchUrl(title, page)
        : browseUrl(page, sortingOption?.id ?? "views");

    const found = parseResults(await this.document(url));
    const matching =
      genre && title
        ? found.filter((item) => item.title.toLowerCase().includes(title.toLowerCase()))
        : found;

    return this.paged(found, matching, page, { ...metadata, ...(genre ? { genre } : {}) });
  }

  private async genres(): Promise<Tag[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    try {
      const genres = parseGenres(await this.document(`${DOMAIN}/?s=&post_type=wp-manga`));

      if (genres.length > 0) {
        genreCache = { at: Date.now(), genres };
      }

      return genres;
    } catch {
      return genreCache?.genres ?? [];
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<CoffeeSearchMetadata>): Promise<CoffeeSearchForm> {
    return new CoffeeSearchForm(
      query.metadata as CoffeeSearchMetadata | undefined,
      await this.genres(),
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: FEATURED_ROW.id, title: FEATURED_ROW.title, type: DiscoverSectionType.featured },
      ...ROWS.map((row) => ({
        id: row.id,
        title: row.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: CoffeeSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    // The hero is a fixed set of slides on the home page rather than a listing.
    if (section.id === FEATURED_ROW.id) {
      return { items: parseFeatured(await this.document(`${DOMAIN}/`)) };
    }

    const ordering = ROWS.find((row) => row.id === section.id)?.ordering;

    if (!ordering) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const found = parseResults(await this.document(browseUrl(page, ordering)));
    const results = this.paged(found, found, page, metadata);

    return {
      items: results.items.map((item) => ({
        type: "simpleCarouselItem" as const,
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      })),
      metadata: results.metadata,
    };
  }

  // Past the last page the site repeats it rather than 404ing, so an all-seen
  // page ends the row. `found` decides that, `matching` is what the caller gets.
  private paged(
    found: SearchResultItem[],
    matching: SearchResultItem[],
    page: number,
    metadata: CoffeeSearchMetadata | undefined,
  ): PagedResults<SearchResultItem> {
    const seen = new Set(metadata?.seen ?? []);
    const fresh = found.filter((item) => !seen.has(item.mangaId));

    if (found.length === 0 || fresh.length === 0) {
      return { items: [], metadata: { completed: true } };
    }

    for (const item of found) {
      seen.add(item.mangaId);
    }

    const freshIds = new Set(fresh.map((item) => item.mangaId));

    return {
      items: matching.filter((item) => freshIds.has(item.mangaId)),
      metadata: {
        ...metadata,
        page: page + 1,
        seen: [...seen].slice(-SEEN_LIMIT),
      },
    };
  }
}

export const CoffeeManga = new CoffeeMangaExtension();
