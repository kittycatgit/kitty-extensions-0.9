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
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

import { toXhtmlDocument } from "../novel/xhtml";
import { DivaScansSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  HOME_SECTIONS,
  SORTING_OPTIONS,
  type DivaChapter,
  type DivaListing,
  type DivaMetadata,
  type DivaRef,
  type DivaSearch,
  type DivaSeries,
  type DivaVocab,
} from "./models";
import { DivaScansInterceptor } from "./network";
import { parseChapterPage, stripHtml } from "./parsers";
import type pbconfigType from "./pbconfig";
import { FALLBACK_GENRES, FALLBACK_TAGS } from "./vocab";

const DOMAIN = "https://divascans.org";
const API = `${DOMAIN}/api/ai`;
const PAGE_SIZE = 50;
const PLACEHOLDER_COVER = `${DOMAIN}/icon-192.png`;
const VOCAB_TTL = 24 * 60 * 60 * 1000;

// Module scope survives across bridge calls; the vocab is small but is reused
// by the form and the genres rail.
let vocabCache: { at: number; vocab: DivaVocab } | undefined;

class DivaScansExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new DivaScansInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getJson<T>(url: string): Promise<T> {
    return JSON.parse(await this.getText(url)) as T;
  }

  private async getVocab(): Promise<DivaVocab> {
    if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL) {
      return vocabCache.vocab;
    }

    try {
      const [genres, tags] = await Promise.all([
        this.getJson<{ genres?: (DivaRef & { series_count?: number })[] }>(`${API}/genres`),
        this.getJson<{ tags?: (DivaRef & { series_count?: number })[] }>(`${API}/tags?limit=200`),
      ]);
      const used = (rows: (DivaRef & { series_count?: number })[] | undefined): DivaRef[] =>
        (rows ?? [])
          .filter((row) => (row.series_count ?? 0) > 0 && row.slug && row.name)
          .map((row) => ({ name: row.name, slug: row.slug }));
      const vocab = { genres: used(genres.genres), tags: used(tags.tags) };
      if (vocab.genres.length === 0) {
        throw new Error("The genre list came back empty");
      }
      vocabCache = { at: Date.now(), vocab };
      return vocab;
    } catch {
      return { genres: FALLBACK_GENRES, tags: FALLBACK_TAGS };
    }
  }

  private cover(series: DivaSeries): string {
    return series.cover_image || PLACEHOLDER_COVER;
  }

  private rating(series: DivaSeries): ContentRating {
    return series.is_nsfw ? ContentRating.ADULT : ContentRating.MATURE;
  }

  private subtitle(series: DivaSeries): string | undefined {
    const latest = series.latest_chapter?.number;
    if (typeof latest === "number") {
      return `Chapter ${latest}`;
    }
    if (series.chapter_count) {
      return `${series.chapter_count} chapters`;
    }
    const date = series.last_chapter_at ?? series.updated_at;
    return date ? date.slice(0, 10) : undefined;
  }

  private toSearchResult(series: DivaSeries): SearchResultItem {
    const subtitle = this.subtitle(series);
    return {
      mangaId: series.slug,
      title: series.title,
      imageUrl: this.cover(series),
      contentRating: this.rating(series),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  private async listSeries(
    query: string,
    page: number,
  ): Promise<{ items: DivaSeries[]; hasMore: boolean }> {
    const listing = await this.getJson<DivaListing>(
      `${API}/series?${query}&page=${page}&limit=${PAGE_SIZE}`,
    );
    const items = listing.data ?? [];
    const pagination = listing.pagination;
    const hasMore =
      typeof pagination?.has_more === "boolean"
        ? pagination.has_more
        : (pagination?.total_pages ?? page) > page;
    return { items, hasMore: hasMore && items.length > 0 };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.getJson<DivaSeries>(
      `${API}/series/${encodeURIComponent(mangaId)}?chapters=none`,
    );
    return this.toSourceManga(mangaId, series);
  }

  private toSourceManga(mangaId: string, series: DivaSeries): SourceManga {
    const tagGroups: TagSection[] = [];
    const asTags = (names: string[] | undefined, slugs: string[] | undefined) =>
      (slugs ?? []).map((slug, index) => ({ id: slug, title: names?.[index] ?? slug }));
    if (series.genre_slugs?.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: asTags(series.genres, series.genre_slugs),
      });
    }
    if (series.tag_slugs?.length) {
      tagGroups.push({ id: "tags", title: "Tags", tags: asTags(series.tags, series.tag_slugs) });
    }

    const secondaryTitles: string[] = [];
    for (const alt of [series.original_title, ...(series.alternative_titles ?? [])]) {
      if (alt && alt !== series.title && !secondaryTitles.includes(alt)) {
        secondaryTitles.push(alt);
      }
    }

    const additionalInfo: Record<string, string> = {};
    if (series.type) additionalInfo["Type"] = titleCase(series.type);
    if (series.origin) additionalInfo["Origin"] = titleCase(series.origin);
    if (series.chapter_count) additionalInfo["Chapters"] = String(series.chapter_count);
    if (series.free_chapter_count)
      additionalInfo["Free chapters"] = String(series.free_chapter_count);
    if (series.paid_chapter_count)
      additionalInfo["Paid chapters"] = String(series.paid_chapter_count);
    if (series.early_access_chapter_count) {
      additionalInfo["Early access chapters"] = String(series.early_access_chapter_count);
    }
    if (typeof series.latest_chapter?.number === "number") {
      additionalInfo["Latest chapter"] = String(series.latest_chapter.number);
    }
    if (series.views) additionalInfo["Views"] = series.views.toLocaleString("en-US");
    if (series.bookmarks) additionalInfo["Bookmarks"] = series.bookmarks.toLocaleString("en-US");
    if (series.rating_count) additionalInfo["Ratings"] = String(series.rating_count);
    if (series.team?.name) additionalInfo["Team"] = series.team.name;
    if (series.created_at) additionalInfo["Added"] = series.created_at.slice(0, 10);

    const author = cleanPerson(series.author);
    const artist = cleanPerson(series.artist);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles,
        thumbnailUrl: this.cover(series),
        synopsis: stripHtml(series.description),
        contentRating: this.rating(series),
        contentType: isNovel(series) ? "novel" : "comic",
        shareUrl:
          series.url ?? `${DOMAIN}/series/${isNovel(series) ? "novel" : "comic"}/${mangaId}`,
        ...(series.status ? { status: titleCase(series.status) } : {}),
        ...(author ? { author } : {}),
        ...(artist ? { artist } : {}),
        ...(series.rating ? { rating: series.rating / 10 } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = await this.getJson<DivaSeries>(
      `${API}/series/${encodeURIComponent(sourceManga.mangaId)}`,
    );
    const rows = series.chapters ?? [];
    if (rows.length === 0 && (series.chapter_count ?? 0) > 0) {
      throw new Error(`No chapters were returned for ${sourceManga.mangaId}.`);
    }

    const chapters: Chapter[] = [];
    for (const row of rows) {
      const chapNum = Number(row.number);
      if (isNaN(chapNum)) continue;
      const locked = row.is_free === false || row.is_premium === true;
      const published = row.published_at ? new Date(row.published_at) : undefined;
      const title = row.title?.trim();
      chapters.push({
        chapterId: String(row.number),
        sourceManga,
        langCode: "en",
        chapNum,
        ...(title && title !== `Chapter ${row.number}` ? { title } : {}),
        ...(locked ? { version: "Paid" } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const novel = chapter.sourceManga.mangaInfo.contentType === "novel";
    // The page only renders content under the site's own URL slug, which can
    // differ from the API slug; shareUrl carries the canonical series URL.
    const seriesUrl = chapter.sourceManga.mangaInfo.shareUrl?.startsWith(`${DOMAIN}/series/`)
      ? chapter.sourceManga.mangaInfo.shareUrl
      : `${DOMAIN}/series/${novel ? "novel" : "comic"}/${encodeURIComponent(mangaId)}`;
    const url = `${seriesUrl}/chapter/${chapter.chapterId}`;
    const page = parseChapterPage(await this.getText(url));

    if (page.locked) {
      throw new Error(
        `Chapter ${chapter.chapterId} is a paid chapter (${page.coinPrice} coins). Unlock it on divascans.org with an account first.`,
      );
    }
    if (page.protectedContent) {
      throw new Error(
        `Chapter ${chapter.chapterId} uses the site's protected reader and cannot be read here.`,
      );
    }

    if (novel) {
      if (!page.proseHtml.trim()) {
        throw new Error(`No text was found for chapter ${chapter.chapterId}.`);
      }
      return {
        id: chapter.chapterId,
        mangaId,
        type: "html",
        html: toXhtmlDocument(page.proseHtml, chapter.title ?? `Chapter ${chapter.chapterId}`),
      };
    }

    if (page.images.length === 0) {
      throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
    }
    return { id: chapter.chapterId, mangaId, pages: page.images };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<DivaScansSearchForm> {
    return new DivaScansSearchForm(query.metadata as DivaMetadata | undefined, this.getVocab());
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as DivaMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = { ...(query.metadata as DivaMetadata | undefined), ...paging };
    const page = paging?.page ?? 1;
    const title = (query.title ?? "").trim();

    if (title) {
      // Search has no paging and caps at 20; it only knows type and nsfw.
      const params = [`q=${encodeURIComponent(title)}`, "limit=20"];
      if (filters.type) params.push(`type=${filters.type}`);
      if (filters.nsfw) params.push(`nsfw=${filters.nsfw}`);
      const result = await this.getJson<DivaSearch>(`${API}/search?${params.join("&")}`);
      return {
        items: (result.results ?? []).map((series) => this.toSearchResult(series)),
        metadata: { completed: true },
      };
    }

    const params = [`sort=${sortingOption?.id ?? DEFAULT_SORT}`];
    for (const key of [
      "type",
      "status",
      "origin",
      "nsfw",
      "genre",
      "exgenre",
      "tag",
      "extag",
    ] as const) {
      const value = filters[key];
      if (value) params.push(`${key}=${encodeURIComponent(value)}`);
    }

    const { items, hasMore } = await this.listSeries(params.join("&"), page);
    const next: DivaMetadata = hasMore ? { ...filters, page: page + 1 } : { completed: true };
    delete next.completed;
    if (!hasMore) next.completed = true;

    return { items: items.map((series) => this.toSearchResult(series)), metadata: next };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type:
          section.id === "hero" ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
      })),
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const vocab = await this.getVocab();
      return {
        items: vocab.genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.name,
          searchQuery: { title: "", metadata: { genre: genre.slug } satisfies DivaMetadata },
        })),
      };
    }

    const paging = metadata as DivaMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const home = HOME_SECTIONS.find((entry) => entry.id === section.id);
    if (!home) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const { items, hasMore } = await this.listSeries(home.query, page);
    const isFeatured = section.id === "hero";

    return {
      items: items.map((series) => {
        const base = {
          mangaId: series.slug,
          imageUrl: this.cover(series),
          title: series.title,
          contentRating: this.rating(series),
        };
        if (isFeatured) {
          const summary = stripHtml(series.description);
          return {
            type: "featuredCarouselItem" as const,
            ...base,
            ...(summary ? { summary } : {}),
          };
        }
        const subtitle = this.subtitle(series);
        return {
          type: "simpleCarouselItem" as const,
          ...base,
          ...(subtitle ? { subtitle } : {}),
        };
      }),
      metadata: hasMore ? { page: page + 1 } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

function isNovel(series: DivaSeries): boolean {
  if (series.url) {
    return series.url.includes("/series/novel/");
  }
  return (series.type ?? "").toUpperCase().includes("NOVEL");
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function cleanPerson(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed && trimmed.toLowerCase() !== "unknown" ? trimmed : undefined;
}

export const DivaScans = new DivaScansExtension();
export type { DivaChapter };
