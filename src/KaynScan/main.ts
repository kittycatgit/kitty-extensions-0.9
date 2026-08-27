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
  HOME_SECTIONS,
  HOME_TTL_MS,
  COMPLETED_SECTION_ID,
  MOST_POPULAR_SECTION_ID,
  NEW_SECTION_ID,
  NOVELS_SECTION_ID,
  PAGE_SIZE,
  POPULAR_ORDER,
  POPULAR_SECTION_ID,
  POSTS_URL,
  RELEASES_SECTION_ID,
  ROW_CAP,
  ROW_PAGE,
  SORTS,
  chapterApiUrl,
  fromId,
  type ApiChapter,
  type ApiChapterDetail,
  type GenreChoice,
  type ApiListing,
  type ApiPosts,
  type ApiSeries,
  type KaynSearchMetadata,
} from "./models";
import { KaynScanInterceptor } from "./network";
import {
  toHomeRows,
  toChapters,
  toNovelHtml,
  toPages,
  toSearchResult,
  toSourceManga,
  type HomeRows,
} from "./parsers";
import type pbconfigType from "./pbconfig";

/**
 * The derived home rows, kept in memory rather than in stored state.
 *
 * Stored state refuses anything over 128 KB, and eight rows of cards are well
 * past that - which is why every row came back reporting the limit instead of
 * any titles. Module scope lives as long as the extension does, which is all a
 * cache of this kind needs; if it is ever torn down, the catalogue is simply
 * asked for again.
 */
let homeCache: { rows: HomeRows; at: number } | undefined;

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

    // The endpoint takes several ids at once, comma separated, and answers with
    // everything wearing any of them - which is how one genre the site happens
    // to file under three ids is asked about in a single question.
    if (filters.genreIds?.length) {
      const ids = filters.genreIds
        .flatMap((id) => String(id).split("+"))
        .filter((id) => /^\d+$/.test(id));

      if (ids.length) {
        parts.push(`genreIds=${ids.join(",")}`);
      }
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

  /**
   * The whole catalogue, as the site's own front page asks for it.
   *
   * Every row is cut from this one reply, so it is asked for once and kept a
   * short while; fetching per row would pull the same half a megabyte six times
   * over. What is kept is only what the rows need, not the reply itself.
   */
  private async home(): Promise<HomeRows> {
    if (homeCache && Date.now() - homeCache.at < HOME_TTL_MS) {
      return homeCache.rows;
    }

    const payload = await this.json<ApiPosts>(POSTS_URL);
    const rows = toHomeRows(payload, ROW_CAP);

    homeCache = { rows, at: Date.now() };
    return rows;
  }

  /** The genres actually worn by something in the catalogue, so each one leads
   * somewhere. They come from the same reply the rows do. */
  private async genres(): Promise<GenreChoice[]> {
    const rows = await this.home();
    return rows.genres;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const data = await this.json<{ post?: ApiSeries }>(
      `${API}/post?postSlug=${encodeURIComponent(fromId(mangaId))}`,
    );
    const post = data.post;

    if (!post) {
      throw new Error(`${mangaId} could not be found on the site.`);
    }

    return toSourceManga(cheerio.load("<div></div>"), post, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const details = await this.json<{ post?: ApiSeries }>(
      `${API}/post?postSlug=${encodeURIComponent(fromId(sourceManga.mangaId))}`,
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

  /**
   * A chapter, whichever kind it is.
   *
   * One route answers for both: a comic comes back as an ordered list of
   * images, a novel as its text, and the same reply says whether the reader is
   * allowed it at all.
   */
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const data = await this.json<{ chapter?: ApiChapterDetail } & ApiChapterDetail>(
      chapterApiUrl(chapter.chapterId),
    );
    const detail = data.chapter ?? data;

    if (detail.isLocked === true || detail.isAccessible === false) {
      throw new Error(
        "This chapter is still locked on the site - it unlocks on a timer, or with coins.",
      );
    }

    const pages = toPages(detail);

    if (pages.length > 0) {
      return { id: chapter.chapterId, mangaId, pages };
    }

    const html = toNovelHtml(cheerio.load("<div></div>"), detail);

    if (html.length > 0) {
      return { id: chapter.chapterId, mangaId, type: "html", html };
    }

    throw new Error(
      `Chapter ${chapter.chapterId} has nothing to show yet. The site may still be preparing it.`,
    );
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
          : entry.id === RELEASES_SECTION_ID
            ? DiscoverSectionType.chapterUpdates
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

    const rows = await this.home();

    if (section.id === GENRES_SECTION_ID) {
      return {
        items: rows.genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genreIds: genre.ids } as Metadata },
        })),
        metadata: { completed: true },
      };
    }

    // A row hands over a page at a time; the app asks for the next when the
    // reader reaches the end of one.
    const page = paging?.page ?? 0;
    const from = page * ROW_PAGE;

    // Just-posted chapters, each opening the chapter itself rather than only
    // the series it belongs to.
    if (section.id === RELEASES_SECTION_ID) {
      const slice = rows.releases.slice(from, from + ROW_PAGE);

      return {
        items: slice.map((release) => ({
          type: "chapterUpdatesCarouselItem" as const,
          mangaId: release.mangaId,
          chapterId: release.chapterId,
          title: release.title,
          imageUrl: release.imageUrl,
          ...(release.subtitle ? { subtitle: release.subtitle } : {}),
        })),
        metadata:
          from + ROW_PAGE < rows.releases.length
            ? ({ page: page + 1 } satisfies KaynSearchMetadata)
            : { completed: true },
      };
    }

    const row =
      section.id === POPULAR_SECTION_ID
        ? rows.popular
        : section.id === NEW_SECTION_ID
          ? rows.fresh
          : section.id === COMPLETED_SECTION_ID
            ? rows.completed
            : section.id === MOST_POPULAR_SECTION_ID
              ? rows.mostPopular
              : section.id === NOVELS_SECTION_ID
                ? rows.novels
                : rows.latest;

    return {
      items: row.slice(from, from + ROW_PAGE).map((item) => ({
        type: "simpleCarouselItem" as const,
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      })),
      metadata:
        from + ROW_PAGE < row.length
          ? ({ page: page + 1 } satisfies KaynSearchMetadata)
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
