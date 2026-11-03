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
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import { LGBToonSearchForm } from "./forms";
import {
  API_SECTIONS,
  DOMAIN,
  GENRES_SECTION_ID,
  HOME_SECTIONS,
  PAGE_SIZE,
  SORTING_OPTIONS,
  type ApiTitle,
  type ApiTitlesPage,
  type HomeData,
  type HomeItem,
  type LGBToonSearchMetadata,
} from "./models";
import { LGBToonInterceptor } from "./network";
import {
  apiSubtitle,
  FALLBACK_COVER,
  homeSubtitle,
  mangaIdFromHref,
  parseGenreIndex,
  parseHome,
  parsePages,
  parseSeries,
  ratingOf,
  toChapters,
  toSourceManga,
} from "./parsers";
import type pbconfigType from "./pbconfig";

const GENRES_TTL_MS = 24 * 60 * 60 * 1000;
const HOME_TTL_MS = 5 * 60 * 1000;

// The home rails come from one ~100 KB page, so it is parsed once for all five.
let homeCache: { at: number; data: HomeData } | undefined;
let genreCache: { at: number; genres: Tag[] } | undefined;

class LGBToonExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new LGBToonInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getTitles(query: string): Promise<{ items: ApiTitle[]; last: boolean }> {
    const payload = JSON.parse(
      await this.getText(`${DOMAIN}/api/titles?${query}`),
    ) as ApiTitlesPage;
    const items = payload.data?.items ?? [];
    const page = payload.data?.page ?? 1;
    const totalPages = payload.data?.totalPages ?? page;
    return { items, last: items.length === 0 || page >= totalPages };
  }

  private async getHome(): Promise<HomeData> {
    if (homeCache && Date.now() - homeCache.at < HOME_TTL_MS) {
      return homeCache.data;
    }
    const data = parseHome(await this.getText(`${DOMAIN}/`));
    homeCache = { at: Date.now(), data };
    return data;
  }

  private async getGenres(): Promise<Tag[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }
    const genres = parseGenreIndex(await this.getText(`${DOMAIN}/genres`));
    if (genres.length === 0) {
      throw new Error("The genre index listed no genres");
    }
    genreCache = { at: Date.now(), genres };
    return genres;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { series, synopsis } = parseSeries(await this.getText(`${DOMAIN}/title/${mangaId}`));
    return toSourceManga(mangaId, series, synopsis);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { series } = parseSeries(await this.getText(`${DOMAIN}/title/${sourceManga.mangaId}`));
    return toChapters(series, sourceManga);
  }

  // Chapter-id URLs are broken on the site; the number route is the one that works.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const pages = parsePages(
      await this.getText(`${DOMAIN}/title/${mangaId}/chapter/${chapter.chapterId}`),
    );

    if (pages.length === 0) {
      throw new Error(`No pages were listed for chapter ${chapter.chapterId}`);
    }

    return { id: chapter.chapterId, mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(
    query: SearchQuery<LGBToonSearchMetadata>,
  ): Promise<LGBToonSearchForm> {
    return new LGBToonSearchForm(
      query.metadata as LGBToonSearchMetadata | undefined,
      this.getGenres(),
    );
  }

  private searchQuery(
    query: SearchQuery<LGBToonSearchMetadata>,
    filters: LGBToonSearchMetadata,
    page: number,
    sort: string | undefined,
  ): string {
    const params = [`page=${page}`, `limit=${PAGE_SIZE}`];
    const title = (query.title ?? "").trim();
    if (title) params.push(`keyword=${encodeURIComponent(title)}`);

    const included = Object.entries(filters.genres ?? {})
      .filter(([, state]) => state === "included")
      .map(([slug]) => encodeURIComponent(slug));
    const excluded = Object.entries(filters.genres ?? {})
      .filter(([, state]) => state === "excluded")
      .map(([slug]) => encodeURIComponent(slug));
    if (included.length) params.push(`tag=${included.join(",")}`);
    if (excluded.length) params.push(`genres_ex=${excluded.join(",")}`);

    if (filters.types?.length)
      params.push(`type=${filters.types.map(encodeURIComponent).join(",")}`);
    if (filters.demographic) params.push(`demographics=${encodeURIComponent(filters.demographic)}`);
    if (filters.status) params.push(`status=${encodeURIComponent(filters.status)}`);
    if (sort) params.push(`sort=${encodeURIComponent(sort)}`);

    return params.join("&");
  }

  async getSearchResults(
    query: SearchQuery<LGBToonSearchMetadata>,
    metadata: LGBToonSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const filters = (query.metadata as LGBToonSearchMetadata | undefined) ?? {};
    const page = metadata?.page ?? 1;
    const { items, last } = await this.getTitles(
      this.searchQuery(query, filters, page, sortingOption?.id),
    );

    return {
      items: items.map((item) => this.resultOf(item)),
      metadata: last ? { completed: true } : { page: page + 1 },
    };
  }

  private resultOf(item: ApiTitle): SearchResultItem {
    const subtitle = apiSubtitle(item);
    return {
      mangaId: mangaIdFromHref(item.href),
      title: item.title.trim(),
      imageUrl: item.cover || item.imgUrl || FALLBACK_COVER,
      contentRating: ratingOf(item.is18plus),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_SECTIONS.map((section, index) => ({
        id: section.id,
        title: section.title,
        type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
      })),
      ...API_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: LGBToonSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    if (section.id === GENRES_SECTION_ID) {
      const genres = await this.getGenres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: {
            title: "",
            metadata: { genres: { [genre.id]: "included" } } satisfies LGBToonSearchMetadata,
          },
        })),
        metadata: { completed: true },
      };
    }

    const home = HOME_SECTIONS.find((entry) => entry.id === section.id);
    if (home) {
      const items = home.pick(await this.getHome()) ?? [];
      return {
        items: items.map((item) =>
          section.id === HOME_SECTIONS[0].id ? this.featuredOf(item) : this.carouselOf(item),
        ),
        metadata: { completed: true },
      };
    }

    const api = API_SECTIONS.find((entry) => entry.id === section.id);
    if (!api) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const { items, last } = await this.getTitles(`page=${page}&limit=${PAGE_SIZE}&${api.query}`);

    return {
      items: items.map((item) => {
        const result = this.resultOf(item);
        return {
          type: "simpleCarouselItem" as const,
          mangaId: result.mangaId,
          title: result.title,
          imageUrl: result.imageUrl,
          contentRating: result.contentRating,
          ...(result.subtitle ? { subtitle: result.subtitle } : {}),
        };
      }),
      metadata: last ? { completed: true } : { page: page + 1 },
    };
  }

  private featuredOf(item: HomeItem): DiscoverSectionItem {
    const supertitle = homeSubtitle(item);
    return {
      type: "featuredCarouselItem",
      mangaId: mangaIdFromHref(item.href),
      title: item.title.trim(),
      imageUrl: item.cover || item.imgUrl || FALLBACK_COVER,
      contentRating: ratingOf(item.is18plus),
      ...(supertitle ? { supertitle } : {}),
    };
  }

  private carouselOf(item: HomeItem): DiscoverSectionItem {
    const subtitle = homeSubtitle(item);
    return {
      type: "simpleCarouselItem",
      mangaId: mangaIdFromHref(item.href),
      title: item.title.trim(),
      imageUrl: item.cover || item.imgUrl || FALLBACK_COVER,
      contentRating: ratingOf(item.is18plus),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const LGBToon = new LGBToonExtension();
