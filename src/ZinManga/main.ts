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

import { ZinSearchForm } from "./forms";
import {
  chapterUrl,
  chaptersApiUrl,
  DOMAIN,
  ROWS,
  SEEN_LIMIT,
  seriesUrl,
  SORTS,
  type ZinChapterPage,
  type ZinSearchMetadata,
} from "./models";
import { ZinMangaInterceptor } from "./network";
import { parseGenres, parsePages, parseResults, parseSeries } from "./parsers";
import pbconfig from "./pbconfig";

/** How long the genre list is reused before it is read from the site again. */
const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

/** The genre list as last read, held for the life of the extension. */
let genreCache: { at: number; genres: Tag[] } | undefined;

class ZinMangaExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new ZinMangaInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The cookies the bypass collected are kept by the app's own cookie store
    // and sent with later requests; there is nothing for this source to hold.
  }

  /** One page of markup, parsed. */
  private async document(url: string): Promise<cheerio.CheerioAPI> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.document(seriesUrl(mangaId)), mangaId);
  }

  /**
   * A series' chapters, newest first.
   *
   * Read from the endpoint the site's own reader calls rather than from the
   * series page, which ships a spinner where the list should be. Every way the
   * theme normally lists chapters answers 404 here. `per_page=-1` is the site's
   * own "all of them": the longest series arrives in one reply of 1703 chapters
   * rather than eighteen pages of a hundred.
   */
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const [, buffer] = await Application.scheduleRequest({
      url: chaptersApiUrl(sourceManga.mangaId),
      method: "GET",
    });

    const payload = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as ZinChapterPage;
    const rows = payload?.data?.chapters ?? [];
    const total = payload?.data?.total ?? rows.length;

    if (rows.length < total) {
      throw new Error(
        `Only ${rows.length} of ${total} chapters were returned, open the series again in a moment.`,
      );
    }

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const chapterId = (row.chapter_slug ?? "").trim();

      // Without its own path segment a chapter cannot be opened, and the site
      // lists a few twice under one slug - four of the 1703 on its longest
      // series - which would show as duplicate rows with split read state.
      if (!chapterId || seen.has(chapterId)) {
        continue;
      }

      seen.add(chapterId);

      const chapNum = Number(row.chapter_num ?? 0);
      const number = Number.isFinite(chapNum) ? chapNum : 0;
      const name = (row.chapter_name ?? "").trim();
      const published = row.updated_at ? new Date(row.updated_at) : undefined;

      // Nearly every chapter is named for its own number, which the app already
      // shows; keeping that would print the number twice.
      const restates = new RegExp(
        `^(chapter|chap|ch|episode|ep|part|pt)?[\\s._#-]*${number}$`,
        "i",
      ).test(name);

      chapters.push({
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum: number,
        sortingIndex: number,
        ...(name && !restates ? { title: name } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
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

  /**
   * The search the site's own form performs.
   *
   * Written without a trailing slash before the query: `/page/2/?s=` is
   * answered with a redirect onto plain http, which iOS refuses to follow.
   */
  private searchUrl(query: SearchQuery<ZinSearchMetadata>, page: number, sort?: string): string {
    const parts = [`s=${encodeURIComponent((query.title ?? "").trim())}`, "post_type=wp-manga"];
    const genres = (query.metadata as ZinSearchMetadata | undefined)?.genres ?? [];

    genres.forEach((genre, index) => {
      parts.push(`genre%5B${index}%5D=${encodeURIComponent(genre)}`);
    });

    if (genres.length > 0) {
      parts.push("op=1");
    }

    if (sort && sort !== "relevance") {
      parts.push(`m_orderby=${sort}`);
    }

    return `${DOMAIN}/page/${page}?${parts.join("&")}`;
  }

  async getSearchResults(
    query: SearchQuery<ZinSearchMetadata>,
    metadata: ZinSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const $ = await this.document(this.searchUrl(query, page, sortingOption?.id));

    return this.paged(parseResults($), page, metadata);
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.label }));
  }

  /** The genres the site filters by, read from its own search page. */
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

  async getAdvancedSearchForm(query: SearchQuery<ZinSearchMetadata>): Promise<ZinSearchForm> {
    return new ZinSearchForm(query.metadata as ZinSearchMetadata | undefined, await this.genres());
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return ROWS.map((row, index) => ({
      id: row.id,
      title: row.title,
      // The first row is the page's banner; the rest are its peers and are
      // drawn alike, so rows showing the same kind of thing look alike.
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: ZinSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const ordering = ROWS.find((row) => row.id === section.id)?.ordering;

    if (!ordering) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const $ = await this.document(`${DOMAIN}/manga/page/${page}?m_orderby=${ordering}`);
    const results = this.paged(parseResults($), page, metadata);

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

  /**
   * One page of a listing, and what to ask for next.
   *
   * The listing has no end: past the last real page the site clamps and serves
   * that page again rather than answering 404, so a row scrolled to its end
   * would repeat its last twelve covers forever. A page whose titles have all
   * been seen already ends the row.
   *
   * Titles already shown are also dropped: "recently updated" is ordered by a
   * moment that keeps moving, so a series updated between one page being read
   * and the next arrives a second time.
   */
  private paged(
    results: SearchResultItem[],
    page: number,
    metadata: ZinSearchMetadata | undefined,
  ): PagedResults<SearchResultItem> {
    const seen = new Set(metadata?.seen ?? []);
    const fresh = results.filter((item) => !seen.has(item.mangaId));

    if (results.length === 0 || fresh.length === 0) {
      return { items: [], metadata: { completed: true } };
    }

    for (const item of results) {
      seen.add(item.mangaId);
    }

    return {
      items: fresh,
      metadata: {
        ...metadata,
        page: page + 1,
        seen: [...seen].slice(-SEEN_LIMIT),
      },
    };
  }
}

export const ZinManga = new ZinMangaExtension();
