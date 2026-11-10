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

import { encodeId } from "../shared/ids";
import { ManhwaHSearchForm } from "./forms";
import {
  LIMIT,
  SORTS,
  type ApiChapterDetail,
  type ApiComic,
  type ApiEnvelope,
  type ManhwaHFilters,
  type ManhwaHMetadata,
} from "./models";
import { ManhwaHInterceptor } from "./network";
import pbconfig from "./pbconfig";

const DOMAIN = "https://manhwah.com";
const API = `${DOMAIN}/api`;

const RAILS = [
  { id: "latest", title: "Latest Updates", sort: "latest" },
  { id: "hot", title: "Popular", sort: "hot" },
  { id: "new", title: "New Series", sort: "new" },
  { id: "rating", title: "Top Rated", sort: "rating" },
] as const;

class ManhwaHExtension implements ExtensionImpl<typeof pbconfig> {
  domain = DOMAIN;

  name = pbconfig.name;

  contentRating: ContentRating = pbconfig.contentRating;

  language = "en";

  private readonly interceptor = new ManhwaHInterceptor("main");

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

    const payload = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as ApiEnvelope<T>;

    if (!payload.success) {
      throw new Error(`${url} answered an unsuccessful payload`);
    }

    return payload;
  }

  private toItem(comic: ApiComic) {
    return {
      mangaId: comic.slug,
      imageUrl: comic.cover_image ?? "",
      title: Application.decodeHTMLEntities(comic.title),
      subtitle: comic.type ?? "",
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
    metadata: ManhwaHMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const response = await this.getJson<ApiComic[]>(
      `/comics${this.query({ sort: rail.sort, page: page.toString(), limit: LIMIT.toString() })}`,
    );

    const items: DiscoverSectionItem[] = response.data.map((comic) =>
      section.type === DiscoverSectionType.featured
        ? { ...this.toItem(comic), type: "featuredCarouselItem" as const }
        : { ...this.toItem(comic), type: "simpleCarouselItem" as const },
    );

    return {
      items,
      ...(response.meta && page < response.meta.total_pages
        ? { metadata: { page: page + 1 } }
        : {}),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  async getAdvancedSearchForm(query: SearchQuery<ManhwaHFilters>) {
    // There is no genres endpoint, so the list comes from one page of the
    // catalogue, which carries each title's genres.
    const response = await this.getJson<ApiComic[]>(
      `/comics${this.query({ sort: "hot", limit: "50" })}`,
    );
    const genres = [
      ...new Map(
        response.data
          .flatMap((comic) => comic.genres ?? [])
          .filter((genre) => genre.name)
          .map((genre) => [genre.slug ?? genre.name, genre]),
      ).values(),
    ]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((genre) => ({ id: genre.slug ?? encodeId(genre.name), title: genre.name }));

    return new ManhwaHSearchForm(query.metadata, genres);
  }

  async getSearchResults(
    query: SearchQuery<ManhwaHFilters>,
    metadata: ManhwaHMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: ManhwaHFilters = { ...query.metadata, ...metadata };
    const page = metadata?.page ?? 1;

    const response = await this.getJson<ApiComic[]>(
      `/comics${this.query({
        // `search=` is the parameter that filters; `keyword=`, which the site's
        // own advanced-search url uses, is accepted and ignored.
        search: (query.title ?? "").trim(),
        genre: filters.genre ?? "",
        status: filters.status ?? "",
        sort: sortingOption?.id ?? filters.sort ?? "",
        page: page.toString(),
        limit: LIMIT.toString(),
      })}`,
    );

    return {
      items: response.data.map((comic) => this.toItem(comic)),
      ...(response.meta && page < response.meta.total_pages
        ? { metadata: { ...filters, page: page + 1 } }
        : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const comic = (await this.getJson<ApiComic>(`/comics/${encodeURIComponent(mangaId)}`)).data;

    const secondaryTitles = (comic.alternative_titles ?? "")
      .split("|")
      .map((title) => title.trim())
      .filter((title) => title.length > 0);

    const additionalInfo: Record<string, string> = {
      ...(comic.type ? { Type: comic.type } : {}),
      ...(comic.publisher && comic.publisher !== "Updating" ? { Publisher: comic.publisher } : {}),
      ...(comic.release_year ? { Released: String(comic.release_year) } : {}),
      ...(comic.chapters?.length ? { Chapters: comic.chapters.length.toString() } : {}),
      ...(comic.total_views ? { Views: comic.total_views.toLocaleString() } : {}),
    };

    const rating = Number(comic.rating ?? NaN);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(comic.title),
        secondaryTitles: secondaryTitles.map((title) => Application.decodeHTMLEntities(title)),
        thumbnailUrl: comic.cover_image ?? "",
        synopsis: Application.decodeHTMLEntities(
          (comic.synopsis ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
        contentRating: this.contentRating,
        shareUrl: `${DOMAIN}/title-detail/${mangaId}`,
        ...(comic.status ? { status: comic.status.toUpperCase() } : {}),
        // "Updating" is the site's placeholder for an unknown credit.
        ...(comic.author && comic.author !== "Updating" ? { author: comic.author } : {}),
        ...(comic.artist && comic.artist !== "Updating" ? { artist: comic.artist } : {}),
        ...(isNaN(rating) || rating <= 0 ? {} : { rating: rating / 2 }),
        ...(comic.genres?.length
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: comic.genres
                    .filter((genre) => genre.name)
                    .map((genre) => ({
                      id: genre.slug ?? encodeId(genre.name),
                      title: genre.name,
                    })),
                },
              ],
            }
          : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const comic = (
      await this.getJson<ApiComic>(`/comics/${encodeURIComponent(sourceManga.mangaId)}`)
    ).data;

    const chapters: Chapter[] = (comic.chapters ?? []).map((chapter) => {
      const published = chapter.created_at ? new Date(chapter.created_at) : undefined;

      return {
        chapterId: chapter.id,
        sourceManga,
        langCode: chapter.lang ?? this.language,
        chapNum: chapter.chapter_number,
        ...(chapter.title ? { title: chapter.title } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      };
    });

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters.sort((left, right) => right.chapNum - left.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const detail = (await this.getJson<ApiChapterDetail>(`/chapters/${chapter.chapterId}`)).data;
    const pages = (detail.pages ?? [])
      .sort((left, right) => left.id - right.id)
      .map((page) => page.image_url)
      .filter((url) => url.length > 0);

    if (pages.length === 0) {
      throw new Error(`Chapter ${chapter.chapNum.toString()} serves no pages`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}

export const ManhwaH = new ManhwaHExtension();
