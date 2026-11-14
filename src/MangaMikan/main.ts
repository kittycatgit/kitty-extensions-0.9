/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  CookieStorageInterceptor,
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
} from "@paperback/types";

import { MangaMikanSearchForm } from "./forms";
import {
  DOMAIN,
  SECTIONS,
  type MikanCard,
  type MikanFilters,
  type MikanSearchMetadata,
  type MikanSpotlight,
} from "./models";
import { MangaMikanInterceptor } from "./network";
import {
  parseChapters,
  parseFilters,
  parseListing,
  parsePages,
  parseSeries,
  parseSpotlight,
} from "./parsers";
import type pbConfig from "./pbconfig";

const SPOTLIGHT_TTL_MS = 5 * 60 * 1000;
const FILTERS_TTL_MS = 24 * 60 * 60 * 1000;

const RAIL_SIZE = 24;
const SEARCH_SIZE = 48;

// /ongoing and /completed shuffle on every load, so every rail reads /manga.
const RAILS: Record<string, { sort: string; status?: string }> = {
  [SECTIONS.latest]: { sort: "updated" },
  [SECTIONS.mostRead]: { sort: "popular" },
  [SECTIONS.newest]: { sort: "added" },
  [SECTIONS.ongoing]: { sort: "added", status: "ongoing" },
  [SECTIONS.completed]: { sort: "added", status: "completed" },
};

type ListingOptions = { q?: string; sort?: string; genre?: string; status?: string };

export class MangaMikanExtension implements ExtensionImpl<typeof pbConfig> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  // Kept on the instance: the app only holds interceptors weakly.
  private readonly interceptor = new MangaMikanInterceptor("main");

  private spotlightCache?: { at: number; slides: MikanSpotlight[] };

  private filtersCache?: { at: number; filters: MikanFilters };

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async listing(page: number, size: number, options: ListingOptions) {
    const params = [`per_page=${size}`, `page=${page}`];

    if (options.q) {
      params.push(`q=${encodeURIComponent(options.q).replace(/%20/g, "+")}`);
    }
    if (options.sort) {
      params.push(`sort=${encodeURIComponent(options.sort)}`);
    }
    if (options.genre) {
      params.push(`genre=${encodeURIComponent(options.genre)}`);
    }
    if (options.status) {
      params.push(`status=${encodeURIComponent(options.status)}`);
    }

    return parseListing(await this.getText(`${DOMAIN}/manga?${params.join("&")}`));
  }

  private async spotlight(): Promise<MikanSpotlight[]> {
    if (this.spotlightCache && Date.now() - this.spotlightCache.at < SPOTLIGHT_TTL_MS) {
      return this.spotlightCache.slides;
    }

    const slides = parseSpotlight(await this.getText(`${DOMAIN}/`));
    this.spotlightCache = { at: Date.now(), slides };

    return slides;
  }

  private async filters(): Promise<MikanFilters> {
    if (this.filtersCache && Date.now() - this.filtersCache.at < FILTERS_TTL_MS) {
      return this.filtersCache.filters;
    }

    const filters = parseFilters(await this.getText(`${DOMAIN}/manga?per_page=12`));

    if (filters.sorts.length === 0 || filters.genres.length === 0) {
      throw new Error("The collection page no longer prints its filter form.");
    }

    this.filtersCache = { at: Date.now(), filters };

    return filters;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = parseSeries(await this.getText(`${DOMAIN}/title/${mangaId}`));
    const additionalInfo: Record<string, string> = {};

    if (series.year) {
      additionalInfo.Year = series.year;
    }
    if (series.views) {
      additionalInfo.Views = series.views;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: series.altTitles,
        thumbnailUrl: cover(series.cover),
        ...(series.author ? { author: series.author } : {}),
        synopsis: series.synopsis,
        contentRating: ContentRating.MATURE,
        status: statusOf(series.status),
        tagGroups: [{ id: "genres", title: "Genres", tags: series.genres }],
        shareUrl: `${DOMAIN}/title/${mangaId}`,
        additionalInfo,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const rows = parseChapters(await this.getText(`${DOMAIN}/title/${mangaId}`));

    if (rows.length === 0) {
      throw new Error(`No chapters listed for ${mangaId}.`);
    }

    return rows.map((row, position) => {
      const number = Number(/(\d+(?:\.\d+)?)/.exec(row.name)?.[1] ?? 0);
      const restates = /^chapter\s*[\d.]+$/i.test(row.name);

      return {
        chapterId: row.id,
        sourceManga,
        langCode: "en",
        chapNum: number,
        sortingIndex: rows.length - position,
        ...(restates ? {} : { title: row.name }),
        ...(row.date ? { publishDate: row.date } : {}),
      };
    });
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { pages, expected } = parsePages(
      await this.getText(`${DOMAIN}/read/${chapter.chapterId}`),
    );

    if (pages.length === 0 || pages.length !== expected) {
      throw new Error(`Chapter ${chapter.chapterId} printed ${pages.length} of ${expected} pages.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return (await this.filters()).sorts.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  async getAdvancedSearchForm(
    query: SearchQuery<MikanSearchMetadata>,
  ): Promise<MangaMikanSearchForm> {
    return new MangaMikanSearchForm(query.metadata, await this.filters());
  }

  async getSearchResults(
    query: SearchQuery<MikanSearchMetadata>,
    metadata: MikanSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const filters = metadata ?? query.metadata ?? {};
    const page = metadata?.page ?? 1;
    const { cards, hasNext } = await this.listing(page, SEARCH_SIZE, {
      q: (query.title ?? "").trim(),
      sort: sortingOption?.id,
      genre: filters.genre,
      status: filters.status,
    });

    return {
      items: cards.map((card) => ({
        mangaId: card.slug,
        title: card.title,
        imageUrl: cover(card.cover),
        contentRating: ContentRating.MATURE,
        ...(card.subtitle ? { subtitle: card.subtitle } : {}),
      })),
      metadata:
        cards.length > 0 && hasNext
          ? {
              page: page + 1,
              ...(filters.genre ? { genre: filters.genre } : {}),
              ...(filters.status ? { status: filters.status } : {}),
            }
          : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.featured, title: "Featured Series", type: DiscoverSectionType.featured },
      { id: SECTIONS.latest, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.mostRead, title: "Most Read", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.newest, title: "New on the Shelf", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.ongoing, title: "Ongoing Series", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.completed,
        title: "Complete Stories",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.genres, title: "Browse by Genre", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MikanSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    if (section.id === SECTIONS.featured) {
      return {
        items: (await this.spotlight()).map((slide) => ({
          type: "featuredCarouselItem",
          mangaId: slide.slug,
          title: slide.title,
          imageUrl: cover(slide.cover),
          contentRating: ContentRating.MATURE,
          ...(slide.meta ? { supertitle: slide.meta } : {}),
          ...(slide.summary ? { summary: slide.summary } : {}),
        })),
        metadata: { completed: true },
      };
    }

    if (section.id === SECTIONS.genres) {
      return {
        items: (await this.filters()).genres.map((genre) => ({
          type: "genresCarouselItem",
          name: genre.title,
          searchQuery: { title: "", metadata: { genre: genre.id } },
        })),
        metadata: { completed: true },
      };
    }

    const rail = RAILS[section.id];

    if (!rail) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const { cards, hasNext } = await this.listing(page, RAIL_SIZE, rail);

    return {
      items: cards.map((card) =>
        section.id === SECTIONS.latest ? updateItem(card) : carouselItem(card),
      ),
      metadata: cards.length > 0 && hasNext ? { page: page + 1 } : { completed: true },
    };
  }
}

// An empty imageUrl fails the whole row, so fall back to a URL that serves
// no image and let the app draw its own placeholder.
function cover(url: string): string {
  return url || `${DOMAIN}/_no-cover.png`;
}

function carouselItem(card: MikanCard): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: cover(card.cover),
    contentRating: ContentRating.MATURE,
    ...(card.subtitle ? { subtitle: card.subtitle } : {}),
  };
}

function updateItem(card: MikanCard): DiscoverSectionItem {
  const newest = card.pills[0];

  if (!newest) {
    return carouselItem(card);
  }

  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: card.slug,
    chapterId: newest.id,
    title: card.title,
    imageUrl: cover(card.cover),
    subtitle: newest.label,
    contentRating: ContentRating.MATURE,
    ...(newest.date ? { publishDate: newest.date } : {}),
  };
}

function statusOf(status: string | undefined): string {
  const value = (status ?? "").toLowerCase();

  if (value.includes("ongoing")) {
    return "Ongoing";
  }
  if (value.includes("complete")) {
    return "Completed";
  }
  if (value.includes("hiatus")) {
    return "Hiatus";
  }

  return "Unknown";
}

export const MangaMikan = new MangaMikanExtension();
