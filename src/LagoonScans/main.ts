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
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { LagoonScansSearchForm } from "./forms";
import {
  chapterUrl,
  DOMAIN,
  GENRES_SECTION_ID,
  LATEST_SECTION_ID,
  LISTING_SECTIONS,
  POPULAR_SECTION_ID,
  RECOMMENDATION_PREFIX,
  seriesUrl,
  SORTING_OPTIONS,
  type LagoonCard,
  type LagoonGenre,
  type LagoonHome,
  type LagoonSearchMetadata,
} from "./models";
import { LagoonScansInterceptor } from "./network";
import {
  hasNextPage,
  parseChapterPages,
  parseChapters,
  parseGenres,
  parseHome,
  parseLatestPage,
  parseListingCards,
  parseSeries,
} from "./parsers";
import type pbconfigType from "./pbconfig";

const HOME_TTL_MS = 10 * 60 * 1000;
const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

let homeCache: { at: number; home: LagoonHome } | undefined;
let genreCache: { at: number; genres: LagoonGenre[] } | undefined;

type ListingFilters = {
  title?: string;
  genres?: string[];
  status?: string;
  type?: string;
  order?: string;
};

function listingUrl(page: number, filters: ListingFilters): string {
  const params: string[] = [];

  if (page > 1) {
    params.push(`page=${page}`);
  }
  if (filters.title) {
    params.push(`title=${encodeURIComponent(filters.title)}`);
  }
  for (const genre of filters.genres ?? []) {
    params.push(`genre%5B%5D=${encodeURIComponent(genre)}`);
  }
  if (filters.status) {
    params.push(`status=${encodeURIComponent(filters.status)}`);
  }
  if (filters.type) {
    params.push(`type=${encodeURIComponent(filters.type)}`);
  }
  if (filters.order) {
    params.push(`order=${encodeURIComponent(filters.order)}`);
  }

  return `${DOMAIN}/manga/${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

function subtitleOf(card: LagoonCard): string | undefined {
  const bits = [card.latestChapter, card.type].filter((bit): bit is string => !!bit);
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

function toSearchItem(card: LagoonCard): SearchResultItem {
  const subtitle = subtitleOf(card);

  return {
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.cover,
    ...(subtitle ? { subtitle } : {}),
  };
}

function toCarouselItem(card: LagoonCard): DiscoverSectionItem {
  const subtitle = subtitleOf(card);

  return {
    type: "simpleCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.cover,
    ...(subtitle ? { subtitle } : {}),
  };
}

class LagoonScansExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new LagoonScansInterceptor("main", DOMAIN);

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

  private async home(): Promise<LagoonHome> {
    if (homeCache && Date.now() - homeCache.at < HOME_TTL_MS) {
      return homeCache.home;
    }

    const home = parseHome(await this.getText(`${DOMAIN}/`));
    homeCache = { at: Date.now(), home };

    return home;
  }

  // Genre term ids come from the filter form on the listing page.
  private async genres(): Promise<LagoonGenre[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    const genres = parseGenres(await this.getText(listingUrl(1, {})));

    if (genres.length === 0) {
      throw new Error("The genre list could not be read from the site.");
    }

    genreCache = { at: Date.now(), genres };

    return genres;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.getText(seriesUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await this.getText(seriesUrl(sourceManga.mangaId)), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages = parseChapterPages(await this.getText(chapterUrl(chapter.chapterId)));

    if (pages.length === 0) {
      throw new Error(`No pages were listed for ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(
    query: SearchQuery<LagoonSearchMetadata>,
  ): Promise<LagoonScansSearchForm> {
    return new LagoonScansSearchForm(
      query.metadata as LagoonSearchMetadata | undefined,
      await this.genres(),
    );
  }

  private async listing(
    page: number,
    filters: ListingFilters,
    metadata: LagoonSearchMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const html = await this.getText(listingUrl(page, filters));
    const items = parseListingCards(html).map(toSearchItem);

    return {
      items,
      metadata:
        items.length > 0 && hasNextPage(html)
          ? { ...metadata, page: page + 1 }
          : { completed: true },
    };
  }

  async getSearchResults(
    query: SearchQuery<LagoonSearchMetadata>,
    metadata: LagoonSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const filters = (query.metadata as LagoonSearchMetadata | undefined) ?? {};
    const page = metadata?.page ?? 1;

    return await this.listing(
      page,
      {
        title: (query.title ?? "").trim(),
        genres: filters.genres,
        status: filters.status,
        type: filters.type,
        order: sortingOption?.id,
      },
      metadata,
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const home = await this.home();

    return [
      { id: POPULAR_SECTION_ID, title: "Popular Today", type: DiscoverSectionType.featured },
      { id: LATEST_SECTION_ID, title: "Latest Update", type: DiscoverSectionType.chapterUpdates },
      ...home.recommendations.map((tab) => ({
        id: `${RECOMMENDATION_PREFIX}${tab.termId}`,
        title: `Recommended: ${tab.name}`,
        type: DiscoverSectionType.simpleCarousel,
      })),
      ...LISTING_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: LagoonSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;

    if (section.id === GENRES_SECTION_ID) {
      return {
        items: (await this.genres()).map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.name,
          searchQuery: { title: "", metadata: { genres: [genre.id] } },
        })),
        metadata: { completed: true },
      };
    }

    if (section.id === POPULAR_SECTION_ID) {
      return {
        items: (await this.home()).popular.map((card) => ({
          type: "featuredCarouselItem" as const,
          mangaId: card.slug,
          title: card.title,
          imageUrl: card.cover,
          ...(card.latestChapter ? { supertitle: card.latestChapter } : {}),
        })),
        metadata: { completed: true },
      };
    }

    if (section.id === LATEST_SECTION_ID) {
      return await this.latestUpdates(page);
    }

    if (section.id.startsWith(RECOMMENDATION_PREFIX)) {
      const termId = section.id.slice(RECOMMENDATION_PREFIX.length);
      const tab = (await this.home()).recommendations.find((entry) => entry.termId === termId);

      if (!tab) {
        throw new Error(`The site no longer shows the ${section.title} tab.`);
      }

      return { items: tab.cards.map(toCarouselItem), metadata: { completed: true } };
    }

    const listing = LISTING_SECTIONS.find((entry) => entry.id === section.id);

    if (!listing) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const results = await this.listing(
      page,
      { order: listing.order, type: listing.type },
      metadata,
    );

    return {
      items: results.items.map((item) => ({
        type: "simpleCarouselItem" as const,
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      })),
      metadata: results.metadata,
    };
  }

  // Page 1 is the home page itself; later pages live under /page/N/.
  private async latestUpdates(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await this.getText(page === 1 ? `${DOMAIN}/` : `${DOMAIN}/page/${page}/`);
    const rows = page === 1 ? parseHome(html).latest : parseLatestPage(html);
    const items: DiscoverSectionItem[] = [];

    for (const row of rows) {
      if (!row.latestChapterSlug) {
        continue;
      }

      const bits = [row.latestChapter, row.latestChapterAge].filter((bit): bit is string => !!bit);

      items.push({
        type: "chapterUpdatesCarouselItem",
        mangaId: row.slug,
        chapterId: row.latestChapterSlug,
        title: row.title,
        imageUrl: row.cover,
        ...(bits.length > 0 ? { subtitle: bits.join(" · ") } : {}),
      });
    }

    return {
      items,
      metadata: items.length > 0 && hasNextPage(html) ? { page: page + 1 } : { completed: true },
    };
  }
}

export const LagoonScans = new LagoonScansExtension();
