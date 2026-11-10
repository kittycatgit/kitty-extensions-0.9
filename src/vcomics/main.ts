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

import { toXhtmlDocument } from "../novel/xhtml";
import type { basePbConfig } from "./config";
import { VComicsSearchForm } from "./forms";
import {
  PER_PAGE,
  normaliseUrl,
  type ChapterResponse,
  type ChaptersResponse,
  type Genre,
  type PostResponse,
  type QueryPost,
  type QueryResponse,
  type VComicsFilters,
  type VComicsMetadata,
} from "./models";

const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

const RAILS = [
  { id: "latest", title: "Latest Updates", orderBy: "lastChapterAddedAt" },
  { id: "new", title: "New Series", orderBy: "createdAt" },
  { id: "popular", title: "Most Viewed", orderBy: "views" },
  { id: "rated", title: "Top Rated", orderBy: "averageRating" },
] as const;

// The Astro front end of these sites is hydrated entirely from a public JSON
// API on `api.<host>`, so nothing here parses markup.
export abstract class VComicsGeneric implements ExtensionImpl<typeof basePbConfig> {
  abstract domain: string;

  abstract name: string;

  abstract contentRating: ContentRating;

  language = "en";

  private genreCache?: { at: number; genres: Genre[] };

  get api(): string {
    return this.domain.replace("https://", "https://api.");
  }

  async initialise(): Promise<void> {
    // No cookies, tokens or headers are needed by the API.
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${this.api}${path}`;
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  private async query(page: number, extra: Record<string, string> = {}): Promise<QueryResponse> {
    const params = new Map<string, string>([
      ["page", page.toString()],
      ["perPage", PER_PAGE.toString()],
      ["view", "archive"],
      ["orderDirection", "desc"],
      ...Object.entries(extra),
    ]);

    const search = [...params]
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");

    return this.getJson<QueryResponse>(`/api/query?${search}`);
  }

  private async genres(): Promise<Genre[]> {
    if (this.genreCache && Date.now() - this.genreCache.at < GENRES_TTL_MS) {
      return this.genreCache.genres;
    }

    const genres = await this.getJson<Genre[]>("/api/genres");
    this.genreCache = { at: Date.now(), genres };

    return genres;
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
    metadata: VComicsMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const response = await this.query(page, { orderBy: rail.orderBy });

    const items: DiscoverSectionItem[] = response.posts.map((post) =>
      section.type === DiscoverSectionType.featured
        ? { ...this.itemBase(post), type: "featuredCarouselItem" as const }
        : {
            ...this.itemBase(post),
            subtitle: post.seriesType,
            type: "simpleCarouselItem" as const,
          },
    );

    return {
      items,
      ...(page * PER_PAGE < response.totalCount ? { metadata: { page: page + 1 } } : {}),
    };
  }

  private itemBase(post: QueryPost) {
    return {
      mangaId: post.id.toString(),
      imageUrl: normaliseUrl(post.featuredImage),
      title: Application.decodeHTMLEntities(post.postTitle),
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<VComicsFilters>) {
    return new VComicsSearchForm(query.metadata, await this.genres());
  }

  async getSearchResults(
    query: SearchQuery<VComicsFilters>,
    metadata: VComicsMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: VComicsFilters = { ...query.metadata, ...metadata };
    const page = metadata?.page ?? 1;

    const response = await this.query(page, {
      orderBy: "lastChapterAddedAt",
      searchTerm: (query.title ?? "").trim(),
      // Several ids are accepted, but only comma-joined: repeating the key or
      // adding brackets makes the API drop the filter without an error.
      genreIds: (filters.genreIds ?? []).join(","),
      seriesType: filters.seriesType ?? "",
      seriesStatus: filters.seriesStatus ?? "",
    });

    const items: SearchResultItem[] = response.posts.map((post) => ({
      ...this.itemBase(post),
      subtitle: post.seriesType,
    }));

    return {
      items,
      ...(page * PER_PAGE < response.totalCount
        ? { metadata: { ...filters, page: page + 1 } }
        : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const response = await this.getJson<PostResponse>(`/api/post?postId=${mangaId}`);
    const post = response.post;

    const secondaryTitles = (post.alternativeTitles ?? "")
      .split(/[,;|]/)
      .map((title) => title.trim())
      .filter((title) => title.length > 0);

    const additionalInfo: Record<string, string> = {
      Type: post.seriesType,
      Chapters: (response.totalChapterCount ?? post._count?.chapters ?? 0).toString(),
      ...(post.totalViews ? { Views: post.totalViews.toLocaleString() } : {}),
    };

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(post.postTitle),
        secondaryTitles,
        thumbnailUrl: normaliseUrl(post.featuredImage),
        synopsis: Application.decodeHTMLEntities(
          (post.postContent ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
        contentRating: this.contentRating,
        contentType: post.isNovel ? "novel" : "comic",
        status: post.seriesStatus,
        shareUrl: `${this.domain}/series/${post.slug}`,
        ...(post.author ? { author: post.author } : {}),
        ...(post.artist ? { artist: post.artist } : {}),
        ...(post.averageRating ? { rating: post.averageRating / 2 } : {}),
        ...(post.genres?.length
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: post.genres.map((genre) => ({
                    id: genre.id.toString(),
                    title: genre.name.trim(),
                  })),
                },
              ],
            }
          : {}),
        additionalInfo,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const response = await this.getJson<ChaptersResponse>(
      `/api/chapters?postId=${sourceManga.mangaId}`,
    );

    const chapters: Chapter[] = response.post.chapters.map((chapter) => {
      const published = new Date(chapter.createdAt);

      return {
        chapterId: chapter.id.toString(),
        sourceManga,
        langCode: this.language,
        chapNum: chapter.number,
        ...(chapter.title ? { title: chapter.title } : {}),
        ...(isNaN(published.getTime()) ? {} : { publishDate: published }),
        ...(chapter.price > 0 ? { additionalInfo: { Price: chapter.price.toString() } } : {}),
      };
    });

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters.sort((left, right) => right.chapNum - left.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const response = await this.getJson<ChapterResponse>(
      `/api/chapter?chapterId=${chapter.chapterId}`,
    );
    const payload = response.chapter;

    if (payload.isAccessible === false || payload.isLocked === true) {
      throw new Error(
        `Chapter ${chapter.chapNum.toString()} is locked on ${this.name} and has to be unlocked there.`,
      );
    }

    if (payload.content && payload.images.length === 0) {
      return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        type: "html",
        html: toXhtmlDocument(payload.content, chapter.title),
      };
    }

    const pages = payload.images.map((image) => normaliseUrl(image.url));

    if (pages.length === 0) {
      throw new Error(`Chapter ${chapter.chapNum.toString()} serves no pages`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}
