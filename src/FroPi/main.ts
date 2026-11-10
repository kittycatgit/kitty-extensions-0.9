/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { FroPiSearchForm } from "./forms";
import {
  LIMIT,
  SORTS,
  type ApiChapter,
  type ApiList,
  type ApiSeries,
  type FroPiFilters,
  type FroPiMetadata,
} from "./models";
import { FroPiInterceptor } from "./network";
import pbconfig from "./pbconfig";

const DOMAIN = "https://fropi.net";
const API = `${DOMAIN}/api/v1`;

const RAILS = [
  { id: "updated", title: "Latest Updates", sort: "updated" },
  { id: "popularity", title: "Popular", sort: "popularity" },
  { id: "latest", title: "New Series", sort: "latest" },
  { id: "rating", title: "Top Rated", sort: "rating" },
] as const;

class FroPiExtension implements ExtensionImpl<typeof pbconfig> {
  domain = DOMAIN;

  name = pbconfig.name;

  contentRating: ContentRating = pbconfig.contentRating;

  language = "en";

  private readonly interceptor = new FroPiInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  private query(params: Record<string, string>): string {
    const pairs = Object.entries(params)
      .filter(([, value]) => value.length > 0)
      // Spaces as `+`: a percent-encoded space makes iOS re-encode the url.
      .map(([key, value]) => `${key}=${encodeURIComponent(value).replaceAll("%20", "+")}`);

    return pairs.length ? `?${pairs.join("&")}` : "";
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${API}${path}`;
    const [response, buffer] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: { accept: "application/json" },
    });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  private async series(params: Record<string, string>): Promise<ApiList<ApiSeries>> {
    return this.getJson<ApiList<ApiSeries>>(
      `/series${this.query({ limit: LIMIT.toString(), ...params })}`,
    );
  }

  private toItem(series: ApiSeries) {
    return {
      mangaId: series.slug,
      imageUrl: series.cover?.url ?? "",
      title: Application.decodeHTMLEntities(series.title),
      subtitle: series.type ? series.type.toUpperCase() : "",
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return RAILS.map((rail, index) => ({
      id: rail.id,
      title: rail.title,
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: FroPiMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const response = await this.series({
      sort: rail.sort,
      ...(metadata?.cursor ? { cursor: metadata.cursor } : {}),
    });

    const items: DiscoverSectionItem[] = response.items.map((series) =>
      section.type === DiscoverSectionType.featured
        ? { ...this.toItem(series), type: "featuredCarouselItem" as const }
        : { ...this.toItem(series), type: "simpleCarouselItem" as const },
    );

    return {
      items,
      ...(response.nextCursor ? { metadata: { cursor: response.nextCursor } } : {}),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  async getAdvancedSearchForm(query: SearchQuery<FroPiFilters>) {
    // Genres are only published on the series records, so the list is taken
    // from one catalogue page rather than a genres endpoint, which does not
    // exist here.
    const response = await this.series({ sort: "popularity" });
    const genres = [...new Set(response.items.flatMap((series) => series.genres ?? []))].sort();

    return new FroPiSearchForm(query.metadata, genres);
  }

  async getSearchResults(
    query: SearchQuery<FroPiFilters>,
    metadata: FroPiMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: FroPiFilters = { ...query.metadata, ...metadata };

    const response = await this.series({
      q: (query.title ?? "").trim(),
      // Singular and case-sensitive: `genres=` or a lowercased value is
      // accepted and then ignored.
      genre: filters.genre ?? "",
      status: filters.status ?? "",
      type: filters.type ?? "",
      sort: sortingOption?.id ?? filters.sort ?? "",
      ...(metadata?.cursor ? { cursor: metadata.cursor } : {}),
    });

    return {
      items: response.items.map((series) => this.toItem(series)),
      ...(response.nextCursor ? { metadata: { ...filters, cursor: response.nextCursor } } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.getJson<ApiSeries>(`/series/${encodeURIComponent(mangaId)}`);

    const additionalInfo: Record<string, string> = {
      ...(series.type ? { Type: series.type.toUpperCase() } : {}),
      ...(series.year ? { Released: series.year.toString() } : {}),
      ...(series.chapterCount ? { Chapters: series.chapterCount.toString() } : {}),
      ...(series.ageRating ? { "Age rating": series.ageRating.replaceAll("_", " ") } : {}),
    };

    const tags = [...(series.genres ?? []), ...(series.tags ?? [])].map((tag) => ({
      id: tag,
      title: tag,
    }));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(series.title),
        secondaryTitles: (series.altTitles ?? []).map((title) =>
          Application.decodeHTMLEntities(title),
        ),
        thumbnailUrl: series.cover?.url ?? "",
        synopsis: Application.decodeHTMLEntities(
          (series.description ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
        contentRating: this.contentRating,
        shareUrl: `${DOMAIN}/series/${mangaId}`,
        ...(series.status ? { status: series.status.toUpperCase() } : {}),
        ...(series.authors?.length ? { author: series.authors.join(", ") } : {}),
        ...(series.artists?.length ? { artist: series.artists.join(", ") } : {}),
        // The API rates out of ten.
        ...(series.rating ? { rating: series.rating / 2 } : {}),
        ...(tags.length ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    let cursor: string | undefined;

    // Fifty at a time, so the whole list needs the cursor walked to the end.
    do {
      const response = await this.getJson<ApiList<ApiChapter>>(
        `/series/${encodeURIComponent(sourceManga.mangaId)}/chapters${this.query({
          limit: LIMIT.toString(),
          ...(cursor ? { cursor } : {}),
        })}`,
      );

      for (const chapter of response.items) {
        const published = chapter.publishedAt ? new Date(chapter.publishedAt) : undefined;

        chapters.push({
          // The reader is addressed by chapter number, not by the record id.
          chapterId: chapter.number.toString(),
          sourceManga,
          langCode: this.language,
          chapNum: chapter.number,
          ...(chapter.title ? { title: chapter.title } : {}),
          ...(chapter.season ? { volume: chapter.season } : {}),
          ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
          ...(chapter.access && chapter.access !== "public"
            ? { additionalInfo: { Access: chapter.access } }
            : {}),
        });
      }

      cursor = response.nextCursor ?? undefined;
    } while (cursor);

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters.sort((left, right) => right.chapNum - left.chapNum);
  }

  // Page urls are only published in the reader page's flight payload; there is
  // no pages endpoint on the API.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${DOMAIN}/series/${chapter.sourceManga.mangaId}/chapter-${chapter.chapterId}`;
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    const html = Application.arrayBufferToUTF8String(buffer);
    let payload = "";

    for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
      try {
        payload += JSON.parse(match[1]!) as string;
      } catch {
        // A chunk that will not parse carries nothing this needs.
      }
    }

    const pages: { index: number; url: string }[] = [];

    for (const match of payload.matchAll(/\{"index":(\d+),"url":"([^"]+)"/g)) {
      pages.push({ index: Number(match[1]), url: match[2]! });
    }

    if (pages.length === 0) {
      throw new Error(
        `Chapter ${chapter.chapterId} serves no pages: it may be locked on ${this.name}.`,
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: pages.sort((left, right) => left.index - right.index).map((page) => page.url),
    };
  }
}

export const FroPi = new FroPiExtension();
