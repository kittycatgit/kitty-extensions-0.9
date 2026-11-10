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

import { toXhtmlDocument } from "../novel/xhtml";
import { NuviaSearchForm } from "./forms";
import {
  SORTS,
  packId,
  unpackId,
  type ApiEnvelope,
  type ApiGenre,
  type ApiPage,
  type ApiSeries,
  type Kind,
  type NuviaFilters,
  type NuviaMetadata,
} from "./models";
import pbconfig from "./pbconfig";

const DOMAIN = "https://nuviatoon.org";
const API = `${DOMAIN}/api`;

const RAILS = [
  { id: "latest", title: "Latest Updates", kind: "comic" as Kind, sort: "latest" },
  { id: "popular", title: "Popular Comics", kind: "comic" as Kind, sort: "popular" },
  { id: "rating", title: "Top Rated Comics", kind: "comic" as Kind, sort: "rating" },
  { id: "novels", title: "Latest Novels", kind: "novel" as Kind, sort: "latest" },
];

// One REST API serves the comic and the novel halves of the site under
// /api/comics and /api/novels, with chapter bodies at
// /api/<kind>-chapters/<id>/content.
class NuviaToonExtension implements ExtensionImpl<typeof pbconfig> {
  domain = DOMAIN;

  name = pbconfig.name;

  contentRating: ContentRating = pbconfig.contentRating;

  language = "en";

  async initialise(): Promise<void> {
    // No cookies or tokens are involved.
  }

  private query(params: Record<string, string>): string {
    const pairs = Object.entries(params)
      .filter(([, value]) => value.length > 0)
      // Spaces as `+`: a percent-encoded space makes iOS re-encode the url.
      .map(([key, value]) => `${key}=${encodeURIComponent(value).replaceAll("%20", "+")}`);

    return pairs.length ? `?${pairs.join("&")}` : "";
  }

  private async getJson<T>(path: string): Promise<ApiEnvelope<T>> {
    const url = `${API}${path}`;
    const [response, buffer] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: { accept: "application/json" },
    });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as ApiEnvelope<T>;
  }

  private async list(
    kind: Kind,
    params: Record<string, string>,
  ): Promise<ApiEnvelope<ApiSeries[]>> {
    return this.getJson<ApiSeries[]>(`/${kind}s${this.query(params)}`);
  }

  private toItem(series: ApiSeries) {
    return {
      mangaId: packId(series.kind, series.slug),
      imageUrl: series.coverUrl ?? series.coverThumbUrl ?? "",
      title: Application.decodeHTMLEntities(series.title),
      subtitle: series.type ?? "",
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
    metadata: NuviaMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const response = await this.list(rail.kind, { sort: rail.sort, page: page.toString() });

    const items: DiscoverSectionItem[] = response.data.map((series) =>
      section.type === DiscoverSectionType.featured
        ? { ...this.toItem(series), type: "featuredCarouselItem" as const }
        : { ...this.toItem(series), type: "simpleCarouselItem" as const },
    );

    return {
      items,
      ...(response.meta && page < response.meta.totalPages ? { metadata: { page: page + 1 } } : {}),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  async getAdvancedSearchForm(query: SearchQuery<NuviaFilters>) {
    const genres = await this.getJson<ApiGenre[]>("/genres");

    return new NuviaSearchForm(query.metadata, genres.data);
  }

  async getSearchResults(
    query: SearchQuery<NuviaFilters>,
    metadata: NuviaMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: NuviaFilters = { ...query.metadata, ...metadata };
    const page = metadata?.page ?? 1;

    const params = {
      // `search=` is accepted and ignored; `q=` is the one that filters.
      q: (query.title ?? "").trim(),
      genre: filters.genre ?? "",
      status: filters.status ?? "",
      sort: sortingOption?.id ?? filters.sort ?? "",
      page: page.toString(),
    };

    const kind = filters.kind ?? "comic";
    const response = await this.list(kind, params);

    return {
      items: response.data.map((series) => this.toItem(series)),
      ...(response.meta && page < response.meta.totalPages
        ? { metadata: { ...filters, page: page + 1 } }
        : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { kind, slug } = unpackId(mangaId);
    const series = (await this.getJson<ApiSeries>(`/${kind}s/${encodeURIComponent(slug)}`)).data;

    const additionalInfo: Record<string, string> = {
      ...(series.type ? { Type: series.type } : {}),
      ...(series.releaseYear ? { Released: series.releaseYear.toString() } : {}),
      ...(series.chapterCount ? { Chapters: series.chapterCount.toString() } : {}),
      ...(series.viewCount ? { Views: series.viewCount.toLocaleString() } : {}),
    };

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(series.title),
        secondaryTitles: (series.altTitles ?? []).map((title) =>
          Application.decodeHTMLEntities(title),
        ),
        thumbnailUrl: series.coverUrl ?? series.coverThumbUrl ?? "",
        synopsis: Application.decodeHTMLEntities(
          (series.description ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
        contentRating: this.contentRating,
        contentType: kind === "novel" ? "novel" : "comic",
        shareUrl: `${DOMAIN}/${kind}s/${slug}`,
        ...(series.seriesStatus ? { status: series.seriesStatus } : {}),
        ...(series.author ? { author: series.author } : {}),
        ...(series.artist ? { artist: series.artist } : {}),
        ...(series.ratingAvg ? { rating: series.ratingAvg / 2 } : {}),
        ...(series.genres?.length
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: series.genres.map((genre) => ({ id: genre.slug, title: genre.name })),
                },
              ],
            }
          : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { kind, slug } = unpackId(sourceManga.mangaId);
    const series = (await this.getJson<ApiSeries>(`/${kind}s/${encodeURIComponent(slug)}`)).data;

    const chapters: Chapter[] = (series.chapters ?? []).map((chapter) => {
      const published = chapter.publishedAt ? new Date(chapter.publishedAt) : undefined;

      return {
        chapterId: chapter.id,
        sourceManga,
        langCode: this.language,
        chapNum: chapter.number,
        ...(chapter.title ? { title: chapter.title } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
        ...(chapter.priceCoins
          ? { additionalInfo: { Price: `${chapter.priceCoins.toString()} coins` } }
          : {}),
      };
    });

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters.sort((left, right) => right.chapNum - left.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { kind } = unpackId(chapter.sourceManga.mangaId);
    const content = (
      await this.getJson<{ kind: Kind; pages?: ApiPage[]; html?: string }>(
        `/${kind}-chapters/${chapter.chapterId}/content`,
      )
    ).data;

    if (content.kind === "novel" || content.html) {
      if (!content.html) {
        throw new Error(`Chapter ${chapter.chapNum.toString()} serves no text`);
      }

      return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        type: "html",
        html: toXhtmlDocument(content.html, chapter.title),
      };
    }

    const pages = (content.pages ?? [])
      .sort((left, right) => left.index - right.index)
      .map((page) => page.url);

    if (pages.length === 0) {
      throw new Error(
        `Chapter ${chapter.chapNum.toString()} serves no pages: it may be coin-locked on ${this.name}.`,
      );
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}

export const NuviaToon = new NuviaToonExtension();
