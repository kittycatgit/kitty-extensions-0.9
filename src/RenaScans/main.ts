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
  type SourceManga,
} from "@paperback/types";

import { RenaSearchForm } from "./forms";
import {
  BATCH,
  type ApiChapterDetail,
  type ApiDetail,
  type ApiListItem,
  type RenaFilters,
  type RenaMetadata,
} from "./models";
import pbconfig from "./pbconfig";

const DOMAIN = "https://renascans.net";
const API = `${DOMAIN}/api/v1`;

const RAILS = [
  { id: "all", title: "All Series", params: {} as Record<string, string> },
  { id: "ongoing", title: "Ongoing", params: { status: "Ongoing" } },
  { id: "completed", title: "Completed", params: { status: "Completed" } },
] as const;

// A Next.js front end over a plain REST API, so nothing here reads markup.
// Page urls are signed and expire within the hour, which is why they are never
// cached between calls.
class RenaScansExtension implements ExtensionImpl<typeof pbconfig> {
  domain = DOMAIN;

  name = pbconfig.name;

  contentRating: ContentRating = pbconfig.contentRating;

  language = "en";

  async initialise(): Promise<void> {
    // No cookies or tokens are involved.
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${API}${path}`;
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  private query(params: Record<string, string>): string {
    const pairs = Object.entries(params)
      .filter(([, value]) => value.length > 0)
      // Spaces as `+`: a percent-encoded space makes iOS re-encode the url.
      .map(([key, value]) => `${key}=${encodeURIComponent(value).replaceAll("%20", "+")}`);

    return pairs.length ? `?${pairs.join("&")}` : "";
  }

  private toItem(item: ApiListItem) {
    return {
      mangaId: item.slug,
      imageUrl: item.cover,
      title: Application.decodeHTMLEntities(item.title),
      subtitle: item.type ?? "",
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
    metadata: RenaMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const offset = metadata?.offset ?? 0;
    const list = await this.getJson<ApiListItem[]>(
      `/manga${this.query({ ...rail.params, ...(offset ? { offset: offset.toString() } : {}) })}`,
    );

    const items: DiscoverSectionItem[] = list.map((item) =>
      section.type === DiscoverSectionType.featured
        ? { ...this.toItem(item), type: "featuredCarouselItem" as const }
        : { ...this.toItem(item), type: "simpleCarouselItem" as const },
    );

    return {
      items,
      ...(list.length === BATCH ? { metadata: { offset: offset + BATCH } } : {}),
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<RenaFilters>) {
    const genres = await this.getJson<{ title: string }[]>("/genres");

    return new RenaSearchForm(
      query.metadata,
      genres.map((genre) => genre.title),
    );
  }

  async getSearchResults(
    query: SearchQuery<RenaFilters>,
    metadata: RenaMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: RenaFilters = { ...query.metadata, ...metadata };
    const offset = metadata?.offset ?? 0;

    const list = await this.getJson<ApiListItem[]>(
      `/manga${this.query({
        q: (query.title ?? "").trim(),
        genre: filters.genre ?? "",
        status: filters.status ?? "",
        type: filters.type ?? "",
        ...(offset ? { offset: offset.toString() } : {}),
      })}`,
    );

    return {
      items: list.map((item) => this.toItem(item)),
      ...(list.length === BATCH ? { metadata: { ...filters, offset: offset + BATCH } } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const detail = await this.getJson<ApiDetail>(`/manga/${encodeURIComponent(mangaId)}`);

    const secondaryTitles = (detail.alt_titles ?? "")
      .split("/")
      .map((title) => title.trim())
      .filter((title) => title.length > 0);

    const additionalInfo: Record<string, string> = {
      ...(detail.type ? { Type: detail.type } : {}),
      ...(detail.studio ? { Studio: detail.studio } : {}),
      ...(detail.release_year ? { Released: String(detail.release_year) } : {}),
      ...(detail.chapter_count ? { Chapters: detail.chapter_count.toString() } : {}),
    };

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(detail.title),
        secondaryTitles,
        thumbnailUrl: detail.cover,
        synopsis: Application.decodeHTMLEntities(
          (detail.description ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
        contentRating: this.contentRating,
        shareUrl: `${DOMAIN}/manga/${mangaId}`,
        ...(detail.status ? { status: detail.status } : {}),
        ...(detail.author ? { author: detail.author } : {}),
        ...(detail.artist ? { artist: detail.artist } : {}),
        ...(detail.rate ? { rating: detail.rate / 2 } : {}),
        ...(detail.genres?.length
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: detail.genres.map((genre) => ({ id: genre, title: genre })),
                },
              ],
            }
          : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const detail = await this.getJson<ApiDetail>(
      `/manga/${encodeURIComponent(sourceManga.mangaId)}`,
    );

    const chapters: Chapter[] = (detail.chapters ?? []).map((chapter) => {
      const published = chapter.created_at ? new Date(chapter.created_at) : undefined;

      return {
        chapterId: chapter.id.toString(),
        sourceManga,
        langCode: this.language,
        chapNum: chapter.chapter_number,
        ...(chapter.title ? { title: chapter.title } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
        ...(chapter.coins
          ? { additionalInfo: { Price: `${chapter.coins.toString()} coins` } }
          : {}),
      };
    });

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters.sort((left, right) => right.chapNum - left.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const detail = await this.getJson<ApiChapterDetail>(`/chapters/${chapter.chapterId}`);

    if (detail.is_locked === true) {
      throw new Error(
        `Chapter ${chapter.chapNum.toString()} is locked on ${this.name} and has to be unlocked there.`,
      );
    }

    const pages = (detail.content ?? []).map((path) => `${DOMAIN}/uploads/${path}`);

    if (pages.length === 0) {
      throw new Error(`Chapter ${chapter.chapNum.toString()} serves no pages`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}

export const RenaScans = new RenaScansExtension();
