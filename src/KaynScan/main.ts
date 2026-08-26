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
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { KaynScanSearchForm } from "./forms";
import {
  API,
  CHAPTER_BATCH,
  DEFAULT_SORT,
  GENRES_SECTION_ID,
  GENRE_STATE_KEY,
  GENRE_TTL_MS,
  HOME_SECTIONS,
  PAGE_SIZE,
  POPULAR_ORDER,
  POPULAR_SECTION_ID,
  SORTS,
  chapterPageUrl,
  type ApiChapter,
  type ApiGenre,
  type ApiListing,
  type ApiSeries,
  type KaynSearchMetadata,
} from "./models";
import { KaynScanInterceptor } from "./network";
import { parsePages, seriesSubtitle, toChapters, toSearchResult, toSourceManga } from "./parsers";
import type pbconfigType from "./pbconfig";

class KaynScanExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new KaynScanInterceptor("main");

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async json<T>(url: string): Promise<T> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  private async html(url: string): Promise<cheerio.CheerioAPI> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  /**
   * Asks the listing endpoint for a page of titles.
   *
   * The same endpoint answers browsing, searching and every filter, so one
   * place builds the query for all of them.
   */
  private listingUrl(page: number, filters: KaynSearchMetadata, title?: string): string {
    const parts = [`perPage=${PAGE_SIZE}`, `page=${page}`];

    if (title?.trim()) {
      parts.push(`searchTerm=${encodeURIComponent(title.trim())}`);
    }

    // Any value at all selects the site's other ordering, so only the popular
    // one is sent; its default already leads with what was updated last.
    if (filters.sort && filters.sort !== DEFAULT_SORT) {
      parts.push(`orderBy=${encodeURIComponent(POPULAR_ORDER)}`);
    }

    if (filters.status) {
      parts.push(`seriesStatus=${encodeURIComponent(filters.status)}`);
    }

    if (filters.type) {
      parts.push(`seriesType=${encodeURIComponent(filters.type)}`);
    }

    if (filters.genreIds?.length) {
      parts.push(`genreIds=${filters.genreIds[0]}`);
    }

    return `${API}/query?${parts.join("&")}`;
  }

  private async listing(
    page: number,
    filters: KaynSearchMetadata,
    title?: string,
  ): Promise<{ posts: ApiSeries[]; total: number }> {
    const data = await this.json<ApiListing>(this.listingUrl(page, filters, title));
    return { posts: data.posts ?? [], total: data.totalCount ?? 0 };
  }

  /** The site's own genre list, kept briefly so a filter form opens at once. */
  private async genres(): Promise<ApiGenre[]> {
    const held = Application.getState(GENRE_STATE_KEY) as
      | { genres: ApiGenre[]; at: number }
      | undefined;

    if (held && Date.now() - held.at < GENRE_TTL_MS) {
      return held.genres;
    }

    try {
      const fetched = await this.json<ApiGenre[]>(`${API}/genres`);
      const genres = (Array.isArray(fetched) ? fetched : [])
        .filter((genre) => genre?.id !== undefined && (genre.name ?? "").trim().length > 0)
        .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));

      Application.setState({ genres, at: Date.now() }, GENRE_STATE_KEY);
      return genres;
    } catch {
      // A filter form without its genres is still worth opening.
      return held?.genres ?? [];
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const data = await this.json<{ post?: ApiSeries }>(
      `${API}/post?postSlug=${encodeURIComponent(mangaId)}`,
    );
    const post = data.post;

    if (!post) {
      throw new Error(`${mangaId} could not be found on the site.`);
    }

    return toSourceManga(cheerio.load("<div></div>"), post, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const details = await this.json<{ post?: ApiSeries }>(
      `${API}/post?postSlug=${encodeURIComponent(sourceManga.mangaId)}`,
    );
    const postId = details.post?.id;

    if (postId === undefined) {
      throw new Error(`${sourceManga.mangaId} could not be found on the site.`);
    }

    // The endpoint answers a window at a time, so it is asked until it stops
    // handing anything back - a long series is thousands of chapters.
    const rows: ApiChapter[] = [];

    for (let skip = 0; ; skip += CHAPTER_BATCH) {
      const batch = await this.json<{ post?: { chapters?: ApiChapter[] } }>(
        `${API}/chapters?postId=${encodeURIComponent(String(postId))}&take=${CHAPTER_BATCH}&skip=${skip}`,
      );
      const chapters = batch.post?.chapters ?? [];

      rows.push(...chapters);

      if (chapters.length < CHAPTER_BATCH) {
        break;
      }
    }

    return toChapters(rows, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.html(chapterPageUrl(chapter.sourceManga.mangaId, chapter.chapterId));
    const pages = parsePages($);

    if (pages.length === 0) {
      throw new Error(
        `Chapter ${chapter.chapterId} has no pages to show. It may be locked, or the site may still be preparing it.`,
      );
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSearchTags() {
    const genres = await this.genres();

    return [
      {
        id: "genres",
        title: "Genres",
        tags: genres.map((genre) => ({ id: String(genre.id), title: (genre.name ?? "").trim() })),
      },
    ];
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<KaynScanSearchForm> {
    return new KaynScanSearchForm(
      query.metadata as KaynSearchMetadata | undefined,
      await this.genres(),
    );
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS;
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as KaynSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const filters: KaynSearchMetadata = {
      ...(query.metadata as KaynSearchMetadata | undefined),
      ...paging,
      ...(sortingOption?.id ? { sort: sortingOption.id } : {}),
    };

    const page = paging?.page ?? 1;
    const { posts, total } = await this.listing(page, filters, query.title);
    const items = posts
      .map((post) => toSearchResult(post))
      .filter((item): item is SearchResultItem => item !== undefined);

    return {
      items,
      metadata:
        items.length > 0 && page * PAGE_SIZE < total
          ? ({ ...filters, page: page + 1 } satisfies KaynSearchMetadata)
          : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return HOME_SECTIONS.map((entry) => ({
      id: entry.id,
      title: entry.title,
      type:
        entry.id === GENRES_SECTION_ID
          ? DiscoverSectionType.genres
          : DiscoverSectionType.simpleCarousel,
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

    if (section.id === GENRES_SECTION_ID) {
      const genres = await this.genres();

      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: (genre.name ?? "").trim(),
          searchQuery: { title: "", metadata: { genreIds: [genre.id] } as Metadata },
        })),
        metadata: { completed: true },
      };
    }

    // The two rows differ by the order they ask for, so each keeps its own -
    // sharing one would put the same titles under both headings.
    const sort = section.id === POPULAR_SECTION_ID ? POPULAR_ORDER : DEFAULT_SORT;
    const page = paging?.page ?? 1;
    const { posts, total } = await this.listing(page, { sort });

    const items = posts.flatMap((post) => {
      const result = toSearchResult(post);

      if (!result) {
        return [];
      }

      const subtitle = seriesSubtitle(post);

      return [
        {
          type: "simpleCarouselItem" as const,
          mangaId: result.mangaId,
          title: result.title,
          imageUrl: result.imageUrl,
          ...(subtitle ? { subtitle } : {}),
        },
      ];
    });

    return {
      items,
      metadata:
        items.length > 0 && page * PAGE_SIZE < total
          ? ({ sort, page: page + 1 } satisfies KaynSearchMetadata)
          : { completed: true },
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

export const KaynScan = new KaynScanExtension();
