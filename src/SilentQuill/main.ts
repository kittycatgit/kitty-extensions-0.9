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

import { SilentQuillSearchForm } from "./forms";
import {
  chapterUrl,
  homeUrl,
  ROWS,
  searchUrl,
  SEEN_LIMIT,
  seriesUrl,
  type Row,
  type SilentQuillMetadata,
} from "./models";
import { SilentQuillInterceptor } from "./network";
import {
  flight,
  hydrate,
  parseChapters,
  parseFeatured,
  parseGenreCloud,
  parseGenres,
  parseLatest,
  parsePages,
  parseSearch,
  parseSeries,
  parseTop,
  type Card,
} from "./parsers";
import pbconfig from "./pbconfig";

const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

let genreCache: { at: number; genres: Tag[] } | undefined;

class SilentQuillExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new SilentQuillInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app's own cookie store keeps the bypass cookies; nothing to hold here.
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    return Application.arrayBufferToUTF8String(buffer);
  }

  private async document(url: string): Promise<cheerio.CheerioAPI> {
    return hydrate(cheerio.load(await this.getText(url)));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.document(seriesUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = parseChapters(
      flight(await this.getText(seriesUrl(sourceManga.mangaId))),
      sourceManga,
    );

    if (chapters.length === 0) {
      throw new Error(`No chapters were listed for ${sourceManga.mangaId}.`);
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages = parsePages(flight(await this.getText(chapterUrl(chapter.chapterId))));

    if (pages.length === 0) {
      throw new Error(`No pages were listed for ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  // The listing only orders by latest update.
  async getSortingOptions(): Promise<SortingOption[]> {
    return [{ id: "update", label: "Latest Update" }];
  }

  async getSearchResults(
    query: SearchQuery<SilentQuillMetadata>,
    metadata: SilentQuillMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const filters = { ...(query.metadata as SilentQuillMetadata | undefined), ...metadata };
    const url = searchUrl({
      q: (query.title ?? "").trim(),
      genre: filters.genre ?? "",
      status: filters.status ?? "",
      page: page > 1 ? String(page) : "",
    });

    return this.paged(parseSearch(await this.document(url)), page, filters);
  }

  private async genres(): Promise<Tag[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    const genres = parseGenres(await this.document(searchUrl({})));

    if (genres.length > 0) {
      genreCache = { at: Date.now(), genres };
    }

    return genres;
  }

  async getAdvancedSearchForm(
    query: SearchQuery<SilentQuillMetadata>,
  ): Promise<SilentQuillSearchForm> {
    return new SilentQuillSearchForm(
      query.metadata as SilentQuillMetadata | undefined,
      await this.genres(),
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return ROWS.map((row) => ({ id: row.id, title: row.title, type: row.type }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: SilentQuillMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const row = ROWS.find((entry) => entry.id === section.id);

    if (!row) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;

    switch (row.source) {
      case "genres": {
        const genres = parseGenreCloud(await this.document(homeUrl(1)));

        return {
          items: genres.map((genre) => ({
            type: "genresCarouselItem" as const,
            name: genre.title,
            searchQuery: { title: "", filters: [], metadata: { genre: genre.id } },
          })),
          metadata: { completed: true },
        };
      }
      case "featured": {
        const cards = parseFeatured(flight(await this.getText(homeUrl(1))));

        return { items: cards.map((card) => this.item(row, card)), metadata: { completed: true } };
      }
      case "top": {
        const cards = parseTop(await this.document(homeUrl(1)));

        return { items: cards.map((card) => this.item(row, card)), metadata: { completed: true } };
      }
      case "latest": {
        const results = this.paged(parseLatest(await this.document(homeUrl(page))), page, metadata);

        return {
          items: results.items.map((card) => this.item(row, card)),
          metadata: results.metadata,
        };
      }
      default: {
        const url = searchUrl({ ...row.query, page: page > 1 ? String(page) : "" });
        const results = this.paged(parseSearch(await this.document(url)), page, metadata);

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
          ...(card.subtitle ? { summary: card.subtitle } : {}),
        };
      case DiscoverSectionType.prominentCarousel:
        return {
          type: "prominentCarouselItem",
          ...base,
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
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

  // Past the last page the site serves an empty listing; the seen set also
  // drops a series that straddles two pages.
  private paged(
    found: Card[],
    page: number,
    metadata: SilentQuillMetadata | undefined,
  ): PagedResults<Card> {
    const seen = new Set(metadata?.seen ?? []);
    const fresh = found.filter((item) => !seen.has(item.mangaId));

    if (fresh.length === 0) {
      return { items: [], metadata: { completed: true } };
    }

    for (const item of fresh) {
      seen.add(item.mangaId);
    }

    return {
      items: fresh,
      metadata: { ...metadata, page: page + 1, seen: [...seen].slice(-SEEN_LIMIT) },
    };
  }
}

export const SilentQuill = new SilentQuillExtension();
