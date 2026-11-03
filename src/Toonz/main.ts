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

import { ToonzSearchForm } from "./forms";
import {
  ARCHIVE_RAILS,
  DEFAULT_SORT,
  SEGMENT_RAILS,
  SEGMENTS,
  SORTING_OPTIONS,
  type ToonzApiChapter,
  type ToonzCard,
  type ToonzRef,
  type ToonzSearchMetadata,
  type ToonzSegmentRails,
  type ToonzSeries,
} from "./models";
import { ToonzInterceptor } from "./network";
import {
  parseChapterImages,
  parseGenres,
  parseListing,
  parseSegment,
  parseSeries,
} from "./parsers";
import type pbconfigType from "./pbconfig";
import { GENRE_FALLBACK } from "./vocab";

const DOMAIN = "https://toonz.to";
const DAY = 24 * 60 * 60 * 1000;
const ADULT_GENRES = new Set(["adult", "hentai", "smut", "erotica", "mature", "ecchi"]);

// Listings tell us whether a title lives under /manhwa or /manga; remembering
// that avoids a redirect hop on the challenged series page.
const typedPaths = new Map<string, string>();
let genreCache: { at: number; genres: ToonzRef[] } | undefined;

class ToonzExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new ToonzInterceptor("main", DOMAIN);

  private segmentCache = new Map<string, { at: number; rails: ToonzSegmentRails }>();

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getSegment(segment: string): Promise<ToonzSegmentRails> {
    const cached = this.segmentCache.get(segment);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      return cached.rails;
    }
    const rails = parseSegment(await this.getText(`${DOMAIN}/${segment}`));
    this.segmentCache.set(segment, { at: Date.now(), rails });
    return rails;
  }

  private async getGenres(): Promise<ToonzRef[]> {
    if (genreCache && Date.now() - genreCache.at < DAY) {
      return genreCache.genres;
    }
    try {
      const genres = parseGenres(await this.getText(`${DOMAIN}/api/genres`));
      if (genres.length === 0) throw new Error("empty genre list");
      genreCache = { at: Date.now(), genres };
      return genres;
    } catch {
      return GENRE_FALLBACK;
    }
  }

  private remember(card: ToonzCard): void {
    if (card.path.startsWith("/manhwa/") || card.path.startsWith("/manga/")) {
      typedPaths.set(card.slug, card.path);
    }
  }

  private subtitleOf(card: ToonzCard): string {
    return [card.latestChapter, card.updated].filter(Boolean).join(" · ");
  }

  private ratingOf(card: ToonzCard): ContentRating {
    return card.nsfw ? ContentRating.ADULT : ContentRating.MATURE;
  }

  private toSearchResult(card: ToonzCard): SearchResultItem {
    this.remember(card);
    const subtitle = this.subtitleOf(card);
    return {
      mangaId: card.slug,
      title: card.title,
      imageUrl: card.cover,
      contentRating: this.ratingOf(card),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  private seriesUrl(mangaId: string): string {
    return `${DOMAIN}${typedPaths.get(mangaId) ?? `/comic/${mangaId}`}`;
  }

  private async getSeries(mangaId: string): Promise<ToonzSeries> {
    const series = parseSeries(await this.getText(this.seriesUrl(mangaId)), mangaId);
    if (series.path.startsWith("/manhwa/") || series.path.startsWith("/manga/")) {
      typedPaths.set(mangaId, series.path);
    }
    return series;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.getSeries(mangaId);

    const tagGroups: TagSection[] = [];
    if (series.genres.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: series.genres.map((g) => ({ id: g.slug, title: g.name })),
      });
    }
    for (const group of series.themes) {
      const id = `theme-${group.group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      tagGroups.push({
        id,
        title: group.group,
        tags: group.tags.map((tag) => ({
          id: `${id}:${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          title: tag,
        })),
      });
    }

    const additionalInfo: Record<string, string> = {};
    for (const key of ["Type", "Origin", "Released", "Chapters", "Updated", "Character"]) {
      if (series.details[key]) additionalInfo[key] = series.details[key];
    }
    if (series.ratingCount) additionalInfo["Ratings"] = series.ratingCount.toLocaleString("en-US");

    const status = series.details["Status"];
    const adultGenre = series.genres.some((g) => ADULT_GENRES.has(g.slug));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: series.altTitles,
        thumbnailUrl: series.cover,
        synopsis: series.synopsis,
        contentRating: series.nsfw || adultGenre ? ContentRating.ADULT : ContentRating.MATURE,
        shareUrl: `${DOMAIN}${series.path}`,
        ...(status ? { status } : {}),
        ...(series.authors.length ? { author: series.authors.join(", ") } : {}),
        ...(series.banner ? { bannerUrl: series.banner } : {}),
        ...(series.ratingAvg ? { rating: series.ratingAvg / 5 } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = await this.getSeries(sourceManga.mangaId);
    const body = await this.getText(`${DOMAIN}/api/comics/${series.comicId}/chapters`);
    const rows = (JSON.parse(body) as { chapters?: ToonzApiChapter[] }).chapters ?? [];
    if (rows.length === 0) {
      throw new Error(`No chapters were returned for ${sourceManga.mangaId}.`);
    }

    const chapters: Chapter[] = [];
    for (const row of rows) {
      const chapterId = row.slug.replace(/^chapter-/, "");
      if (!chapterId) continue;
      const chapNum = Number(row.chapterNumber);
      const title = row.title?.trim();
      const published = row.date ? new Date(row.date) : undefined;
      chapters.push({
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum: isNaN(chapNum) ? 0 : chapNum,
        ...(title && !/^chapter\s*[\d.]*$/i.test(title) ? { title } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const base = typedPaths.get(mangaId) ?? `/comic/${mangaId}`;
    const html = await this.getText(`${DOMAIN}${base}/chapter/${chapter.chapterId}`);
    return { id: chapter.chapterId, mangaId, pages: parseChapterImages(html) };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<ToonzSearchForm> {
    return new ToonzSearchForm(query.metadata as ToonzSearchMetadata | undefined, this.getGenres());
  }

  // `/comics` is the one archive route that takes every filter and is not
  // behind the challenge, so title search goes through it too.
  private archiveUrl(filters: ToonzSearchMetadata, page: number, sort: string, title = ""): string {
    const params: [string, string][] = [];
    if (title) params.push(["search", title]);
    params.push(["sort", sort]);
    if (page > 1) params.push(["page", String(page)]);
    if (filters.status) params.push(["status", filters.status]);
    if (filters.types?.length) params.push(["types", filters.types.join(",")]);
    if (filters.rating) params.push(["rating", filters.rating]);
    const included = Object.entries(filters.genres ?? {})
      .filter(([, state]) => state === "included")
      .map(([slug]) => slug);
    const excluded = Object.entries(filters.genres ?? {})
      .filter(([, state]) => state === "excluded")
      .map(([slug]) => slug);
    if (included.length) params.push(["genres", included.join(",")]);
    if (excluded.length) params.push(["excludeGenres", excluded.join(",")]);
    // The runtime has no URLSearchParams.
    const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return `${DOMAIN}/comics?${query}`;
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as ToonzSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = { ...(query.metadata as ToonzSearchMetadata | undefined), ...paging };
    const page = paging?.page ?? 1;
    const title = (query.title ?? "").trim();
    const sort = sortingOption?.id ?? (title ? "popular" : DEFAULT_SORT);

    const listing = parseListing(await this.getText(this.archiveUrl(filters, page, sort, title)));
    const next: ToonzSearchMetadata = listing.hasNext
      ? { ...filters, page: page + 1 }
      : { completed: true };
    return { items: listing.cards.map((card) => this.toSearchResult(card)), metadata: next };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const sections: DiscoverSection[] = [];
    for (const segment of SEGMENTS) {
      for (const rail of SEGMENT_RAILS) {
        const id = `${segment.id}-${rail.key}`;
        sections.push({
          id,
          title: `${segment.title}: ${rail.title}`,
          type:
            id === "manhwa-featured"
              ? DiscoverSectionType.featured
              : DiscoverSectionType.simpleCarousel,
        });
      }
    }
    for (const rail of ARCHIVE_RAILS) {
      sections.push({ id: rail.id, title: rail.title, type: DiscoverSectionType.simpleCarousel });
    }
    sections.push({ id: "genres", title: "Genres", type: DiscoverSectionType.genres });
    return sections;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const genres = await this.getGenres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.name,
          searchQuery: {
            title: "",
            metadata: { genres: { [genre.slug]: "included" } } satisfies ToonzSearchMetadata,
          },
        })),
      };
    }

    const paging = metadata as ToonzSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }
    const page = paging?.page ?? 1;

    const archive = ARCHIVE_RAILS.find((rail) => rail.id === section.id);
    if (archive) {
      const listing = parseListing(await this.getText(this.archiveUrl({}, page, archive.sort)));
      return {
        items: listing.cards.map((card) => this.toCarouselItem(card)),
        metadata: listing.hasNext ? { page: page + 1 } : { completed: true },
      };
    }

    const [segment, key] = section.id.split("-") as [string, keyof ToonzSegmentRails];
    const rails = await this.getSegment(segment);
    const cards = rails[key];
    if (!cards) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    return {
      items: cards.map((card) => {
        if (section.id === "manhwa-featured") {
          this.remember(card);
          const featured = card as ToonzSegmentRails["featured"][number];
          return {
            type: "featuredCarouselItem" as const,
            mangaId: card.slug,
            imageUrl: card.cover,
            title: card.title,
            contentRating: this.ratingOf(card),
            ...(featured.summary ? { summary: featured.summary } : {}),
            ...(featured.rating ? { supertitle: `★ ${featured.rating}` } : {}),
          };
        }
        return this.toCarouselItem(card);
      }),
      metadata: { completed: true },
    };
  }

  private toCarouselItem(card: ToonzCard): DiscoverSectionItem {
    this.remember(card);
    const subtitle = this.subtitleOf(card);
    return {
      type: "simpleCarouselItem" as const,
      mangaId: card.slug,
      imageUrl: card.cover,
      title: card.title,
      contentRating: this.ratingOf(card),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const Toonz = new ToonzExtension();
