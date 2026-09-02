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
  browseUrl,
  chapterUrl,
  ORDERS,
  ROWS,
  searchUrl,
  SEEN_LIMIT,
  seriesUrl,
  type SilentQuillMetadata,
} from "./models";
import { SilentQuillInterceptor } from "./network";
import { parseChapters, parseGenres, parsePages, parseResults, parseSeries } from "./parsers";
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
    return cheerio.load(await this.getText(url));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.document(seriesUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = parseChapters(
      await this.document(seriesUrl(sourceManga.mangaId)),
      sourceManga,
    );

    if (chapters.length === 0) {
      throw new Error(`No chapters were listed for ${sourceManga.mangaId}.`);
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages = parsePages(await this.getText(chapterUrl(chapter.chapterId)));

    if (pages.length === 0) {
      throw new Error(`No pages were listed for ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return ORDERS.map((order) => ({ id: order.id, label: order.label }));
  }

  private filterQuery(metadata: SilentQuillMetadata | undefined): string {
    const parts = (metadata?.genres ?? []).map(
      (genre) => `&genre%5B%5D=${encodeURIComponent(genre)}`,
    );

    if (metadata?.status) {
      parts.push(`&status=${encodeURIComponent(metadata.status)}`);
    }

    if (metadata?.type) {
      parts.push(`&type=${encodeURIComponent(metadata.type)}`);
    }

    return parts.join("");
  }

  async getSearchResults(
    query: SearchQuery<SilentQuillMetadata>,
    metadata: SilentQuillMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();
    const filters = { ...(query.metadata as SilentQuillMetadata | undefined), ...metadata };
    const filterQuery = this.filterQuery(filters);

    // Filters are ignored on a title search, so when both are set the filters
    // pick the listing and the title matches against what comes back.
    const url = filterQuery
      ? browseUrl(page, sortingOption?.id ?? "update", filterQuery)
      : title
        ? searchUrl(title, page)
        : browseUrl(page, sortingOption?.id ?? "update");

    const found = parseResults(await this.document(url));
    const matching =
      filterQuery && title
        ? found.filter((item) => item.title.toLowerCase().includes(title.toLowerCase()))
        : found;

    return this.paged(found, matching, page, { ...metadata, ...filters });
  }

  private async genres(): Promise<Tag[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    try {
      const genres = parseGenres(await this.document(browseUrl(1, "update")));

      if (genres.length > 0) {
        genreCache = { at: Date.now(), genres };
      }

      return genres;
    } catch {
      return genreCache?.genres ?? [];
    }
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
    return ROWS.map((row, index) => ({
      id: row.id,
      title: row.title,
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: SilentQuillMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const order = ROWS.find((row) => row.id === section.id)?.order;

    if (!order) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const found = parseResults(await this.document(browseUrl(page, order)));
    const results = this.paged(found, found, page, metadata);

    return {
      items: results.items.map((item) => ({
        type:
          section.id === ROWS[0]!.id
            ? ("featuredCarouselItem" as const)
            : ("simpleCarouselItem" as const),
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      })) as DiscoverSectionItem[],
      metadata: results.metadata,
    };
  }

  // Past the last page the site serves the last one again rather than 404ing,
  // so an all-seen page ends the row. `found` decides whether the source is
  // exhausted, `matching` is what the caller asked for.
  private paged(
    found: SearchResultItem[],
    matching: SearchResultItem[],
    page: number,
    metadata: SilentQuillMetadata | undefined,
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

export const SilentQuill = new SilentQuillExtension();
