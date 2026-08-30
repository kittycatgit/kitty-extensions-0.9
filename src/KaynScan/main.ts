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
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { KaynSearchForm } from "./forms";
import {
  API,
  assetUrl,
  chapterUrl,
  DEFAULT_SORT,
  HOME_SECTIONS,
  listingUrl,
  ROW_LIMIT,
  seriesUrl,
  SORTS,
  type KaynGenre,
  type KaynListing,
  type KaynSearchMetadata,
  type KaynSeries,
} from "./models";
import { KaynInterceptor } from "./network";
import { parseBook, parseChapters, parsePages } from "./parsers";
import pbconfig from "./pbconfig";

/**
 * Which chapters have to be paid for.
 *
 * Learned while listing a series and read when one is opened, so a locked
 * chapter can be refused by name instead of looking like an empty one.
 */
const lockedChapters = new Set<string>();

const lockKey = (slug: string, number: string): string => `${slug}#${number}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The day a paid chapter stops being paid, as the reader's own clock sees it.
 *
 * The site states this as an instant in UTC and shows it in local time, so a
 * chapter that frees just after midnight reads as the next day - which is what
 * the site itself displays, and what a reader waiting for it expects.
 */
function freeOn(iso: string | null | undefined): string {
  const when = new Date(iso ?? "");

  if (!iso || Number.isNaN(when.getTime())) {
    return "";
  }

  return `${when.getDate()} ${MONTHS[when.getMonth()] ?? ""}`;
}

/**
 * How a paid chapter is marked.
 *
 * The app already prints "Ch. 21 - " before this, and the row it prints into is
 * narrow, so the number is not repeated and the price is left out: what a reader
 * scanning the list wants to know is that it is shut and when it opens. A lock
 * reads at a glance where the word would not fit.
 */
function lockedTitle(row: { becomesFreeAt?: string | null }): string {
  const free = freeOn(row.becomesFreeAt);

  return free ? `\u{1F512} ${free}` : "\u{1F512}";
}

class KaynScanExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new KaynInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app keeps the cookies its bypass collected; nothing to store here.
  }

  private async json<T>(url: string): Promise<T> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  private async text(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    return Application.arrayBufferToUTF8String(buffer);
  }

  /** A series as the app lists it. */
  private toResult(series: KaynSeries): SearchResultItem {
    const slug = (series.urlSlug ?? series.slug ?? "").trim();
    const chapters = series._count?.chapters ?? 0;
    const bits = [series.type, chapters > 0 ? `${chapters} chapters` : ""].filter(Boolean);

    return {
      mangaId: slug,
      title: (series.title ?? "").trim() || slug,
      imageUrl: assetUrl(series.coverImage),
      ...(bits.length > 0 ? { subtitle: bits.join(" · ") } : {}),
    };
  }

  private async page(
    url: string,
    metadata: KaynSearchMetadata | undefined,
  ): Promise<{ items: SearchResultItem[]; metadata: KaynSearchMetadata }> {
    const page = metadata?.page ?? 1;
    const listing = await this.json<KaynListing>(url);
    const rows = listing.data ?? [];
    const more = listing.meta?.hasMore === true;

    return {
      items: rows.map((series) => this.toResult(series)),
      metadata: more ? { page: page + 1 } : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return HOME_SECTIONS.map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as KaynSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const entry = HOME_SECTIONS.find((row) => row.id === section.id);

    if (!entry) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = paging?.page ?? 1;
    const result = await this.page(
      listingUrl({
        page,
        limit: ROW_LIMIT,
        sort: entry.sort,
        ...("type" in entry ? { type: entry.type } : {}),
        ...("status" in entry ? { status: entry.status } : {}),
      }),
      paging,
    );

    return {
      items: result.items.map((item) => ({
        type: "simpleCarouselItem" as const,
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      })) as DiscoverSectionItem[],
      metadata: result.metadata,
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS;
  }

  async getAdvancedSearchForm(): Promise<KaynSearchForm> {
    const genres = await this.json<{ genres?: KaynGenre[] }>(`${API}/genres`);

    return new KaynSearchForm(genres.genres ?? []);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata?: Metadata,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as KaynSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const filters = (query.metadata ?? {}) as {
      genre?: string;
      type?: string;
      status?: string;
    };

    return this.page(
      listingUrl({
        page: paging?.page ?? 1,
        limit: ROW_LIMIT,
        q: query.title ?? "",
        sort: sortingOption?.id ?? DEFAULT_SORT,
        ...(filters.genre ? { genre: filters.genre } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      }),
      paging,
    );
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const book = parseBook(await this.text(seriesUrl(mangaId)));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: (book.title ?? "").trim() || mangaId,
        secondaryTitles: [],
        thumbnailUrl: assetUrl(book.image),
        synopsis: (book.description ?? "").replace(/<[^>]+>/g, "").trim(),
        contentRating: pbconfig.contentRating,
        status: "Unknown",
        shareUrl: seriesUrl(mangaId),
        ...(book.author ? { author: book.author } : {}),
        ...(book.rating === undefined || Number.isNaN(book.rating) ? {} : { rating: book.rating }),
        ...(book.genres.length > 0
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: book.genres.map((genre) => ({ id: genre.toLowerCase(), title: genre })),
                },
              ],
            }
          : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const rows = parseChapters(await this.text(seriesUrl(sourceManga.mangaId)));
    const chapters: Chapter[] = [];

    for (const row of rows) {
      const number = String(row.number ?? "").trim();

      if (!number) {
        continue;
      }

      if (row.isLocked) {
        lockedChapters.add(lockKey(sourceManga.mangaId, number));
      } else {
        lockedChapters.delete(lockKey(sourceManga.mangaId, number));
      }

      chapters.push({
        chapterId: number,
        sourceManga,
        langCode: "en",
        chapNum: Number(number),
        // A paid chapter is listed rather than hidden, so a reader can see that
        // it exists, and says what it costs rather than opening to nothing. The
        // site also shows a date these unlock on; that is worked out in its own
        // page script and appears nowhere in the data this can read, so it is
        // not invented here.
        ...(row.isLocked ? { title: lockedTitle(row) } : {}),
      });
    }

    const sorted = chapters.sort((left, right) => right.chapNum - left.chapNum);

    return sorted.map((chapter, index) => ({
      ...chapter,
      sortingIndex: sorted.length - index,
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const slug = chapter.sourceManga.mangaId;

    if (lockedChapters.has(lockKey(slug, chapter.chapterId))) {
      throw new Error(
        "This chapter is locked. The site sells it for coins, so it can only be read there, signed in to an account that has paid for it.",
      );
    }

    const pages = parsePages(await this.text(chapterUrl(slug, chapter.chapterId))).map((path) =>
      assetUrl(path),
    );

    if (pages.length === 0) {
      throw new Error(
        "No pages were found for this chapter. If the site shows it as locked, it has to be paid for there.",
      );
    }

    return { id: chapter.chapterId, mangaId: slug, pages };
  }
}

export const KaynScan = new KaynScanExtension();
