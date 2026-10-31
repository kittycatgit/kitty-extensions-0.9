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
} from "@paperback/types";
import * as cheerio from "cheerio";

import { ManhwaToonSearchForm } from "./forms";
import {
  chaptersUrl,
  chapterUrl,
  directoryUrl,
  genreUrl,
  homeUrl,
  ROWS,
  searchUrl,
  SEEN_LIMIT,
  seriesUrl,
  SORTS,
  type ManhwaToonMetadata,
  type Row,
} from "./models";
import { ManhwaToonInterceptor } from "./network";
import {
  homeSection,
  parseCards,
  parseChapterRows,
  parseFilters,
  parseHero,
  parsePages,
  parseSeries,
  type Card,
  type Filters,
} from "./parsers";
import pbconfig from "./pbconfig";

const FILTERS_TTL_MS = 24 * 60 * 60 * 1000;

let filtersCache: { at: number; filters: Filters } | undefined;

class ManhwaToonExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new ManhwaToonInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app's own cookie store keeps the bypass cookies; nothing to hold here.
  }

  private async document(url: string, method = "GET"): Promise<cheerio.CheerioAPI> {
    const [response, buffer] = await Application.scheduleRequest({ url, method });

    if (response.status !== 200) {
      throw new Error(`manhwatoon.me answered ${response.status} for ${url}`);
    }

    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  // Listing pages 404 past the last one; that ends the row instead of failing it.
  private async listing(url: string): Promise<Card[]> {
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status === 404) {
      return [];
    }

    if (response.status !== 200) {
      throw new Error(`manhwatoon.me answered ${response.status} for ${url}`);
    }

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    return parseCards($, $.root());
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.document(seriesUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const rows = parseChapterRows(await this.document(chaptersUrl(mangaId), "POST"));

    if (rows.length === 0) {
      throw new Error(`No chapters were listed for ${mangaId}.`);
    }

    // The site lists newest first; keep that order for the sorting index.
    return rows.map((row, index) => ({
      chapterId: row.chapterId,
      sourceManga,
      langCode: "en",
      chapNum: row.number,
      sortingIndex: rows.length - index,
      ...(row.title ? { title: row.title } : {}),
      ...(row.published ? { publishDate: row.published } : {}),
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const pages = parsePages(await this.document(chapterUrl(mangaId, chapter.chapterId)));

    if (pages.length === 0) {
      throw new Error(`No pages were listed for ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  private searchQuery(
    title: string,
    filters: ManhwaToonMetadata,
    sort: string | undefined,
  ): string {
    const params = [`s=${encodeURIComponent(title)}`, "post_type=wp-manga"];
    const add = (key: string, value: string | undefined): void => {
      if (value) {
        params.push(`${key}=${encodeURIComponent(value)}`);
      }
    };

    // Types are genres on this site; op=1 makes every genre required.
    const genres = [...(filters.types ?? []), ...(filters.genres ?? [])];
    genres.forEach((genre, index) => add(`genre[${index}]`, genre));

    if (genres.length > 0) {
      add("op", "1");
    }

    filters.statuses?.forEach((status, index) => add(`status[${index}]`, status));
    add("adult", filters.adult);
    add("author", filters.author);
    add("artist", filters.artist);
    add("release", filters.release);

    if (sort && sort !== SORTS[0]!.id) {
      add("m_orderby", sort);
    }

    return params.join("&");
  }

  async getSearchResults(
    query: SearchQuery<ManhwaToonMetadata>,
    metadata: ManhwaToonMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const filters = { ...(query.metadata as ManhwaToonMetadata | undefined), ...metadata };
    const found = await this.listing(
      searchUrl(page, this.searchQuery((query.title ?? "").trim(), filters, sortingOption?.id)),
    );
    const results = this.paged(found, page, filters);

    return {
      items: results.items.map((card) => ({
        mangaId: card.mangaId,
        imageUrl: card.imageUrl,
        title: card.title,
        ...(card.subtitle ? { subtitle: card.subtitle } : {}),
      })),
      metadata: results.metadata,
    };
  }

  private async filters(): Promise<Filters | undefined> {
    if (filtersCache && Date.now() - filtersCache.at < FILTERS_TTL_MS) {
      return filtersCache.filters;
    }

    try {
      const filters = parseFilters(await this.document(searchUrl(1, "s=&post_type=wp-manga")));

      if (filters.genres.length === 0) {
        throw new Error("The search page listed no genres.");
      }

      filtersCache = { at: Date.now(), filters };

      return filters;
    } catch {
      return filtersCache?.filters;
    }
  }

  async getAdvancedSearchForm(
    query: SearchQuery<ManhwaToonMetadata>,
  ): Promise<ManhwaToonSearchForm> {
    return new ManhwaToonSearchForm(
      query.metadata as ManhwaToonMetadata | undefined,
      await this.filters(),
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return ROWS.map((row) => ({ id: row.id, title: row.title, type: row.type }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: ManhwaToonMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const row = ROWS.find((entry) => entry.id === section.id);

    if (!row) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const source = row.source;

    switch (source.kind) {
      case "genres": {
        const filters = await this.filters();

        if (!filters) {
          throw new Error("The genre list could not be loaded.");
        }

        return {
          items: filters.genres.map((genre) => ({
            type: "genresCarouselItem" as const,
            name: genre.title,
            searchQuery: { title: "", metadata: { genres: [genre.id] } },
          })),
        };
      }
      case "hero": {
        const cards = parseHero(await this.document(homeUrl()));

        return { items: cards.map((card) => this.item(row, card)), metadata: { completed: true } };
      }
      case "home": {
        const $ = await this.document(homeUrl());
        const cards = parseCards($, homeSection($, source.heading));

        return { items: cards.map((card) => this.item(row, card)), metadata: { completed: true } };
      }
      case "updates": {
        const $ = await this.document(homeUrl(page));
        // A card without a chapter link is a new series, not an update.
        const cards = parseCards($, $("div#mt-updates")).filter((card) => card.chapterId);
        const results = this.paged(cards, page, metadata);

        return {
          items: results.items.map((card) => this.item(row, card)),
          metadata: results.metadata,
        };
      }
      case "directory":
      case "genre": {
        const url =
          source.kind === "directory"
            ? directoryUrl(page, source.query)
            : genreUrl(source.slug, page);
        const results = this.paged(await this.listing(url), page, metadata);

        return {
          items: results.items.map((card) => this.item(row, card)),
          metadata: results.metadata,
        };
      }
    }
  }

  private item(row: Row, card: Card): DiscoverSectionItem {
    const base = { mangaId: card.mangaId, imageUrl: card.imageUrl, title: card.title };

    switch (row.type) {
      case DiscoverSectionType.featured:
        return {
          type: "featuredCarouselItem",
          ...base,
          ...(card.subtitle ? { supertitle: card.subtitle } : {}),
        };
      case DiscoverSectionType.prominentCarousel:
        return {
          type: "prominentCarouselItem",
          ...base,
          ...(card.rank ? { subtitle: `#${card.rank}` } : {}),
        };
      case DiscoverSectionType.chapterUpdates:
        return {
          type: "chapterUpdatesCarouselItem",
          ...base,
          chapterId: card.chapterId ?? "",
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        };
      default:
        return {
          type: "simpleCarouselItem",
          ...base,
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        };
    }
  }

  // Dedupe across pages; an all-seen or empty page ends the row.
  private paged(
    found: Card[],
    page: number,
    metadata: ManhwaToonMetadata | undefined,
  ): { items: Card[]; metadata: ManhwaToonMetadata } {
    const seen = new Set(metadata?.seen ?? []);
    const fresh = found.filter((item) => !seen.has(item.mangaId));

    if (fresh.length === 0) {
      return { items: [], metadata: { completed: true } };
    }

    for (const item of found) {
      seen.add(item.mangaId);
    }

    return {
      items: fresh,
      metadata: { ...metadata, page: page + 1, seen: [...seen].slice(-SEEN_LIMIT) },
    };
  }
}

export const ManhwaToon = new ManhwaToonExtension();
