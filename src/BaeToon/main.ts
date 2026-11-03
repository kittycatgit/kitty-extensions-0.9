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
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

import { BaeToonSearchForm } from "./forms";
import {
  DOMAIN,
  genreId,
  PAGE_SIZE,
  PLACEHOLDER_COVER,
  SECTION,
  SORTED_SECTIONS,
  SORTS,
  withCommas,
  type BaeChapterPage,
  type BaeEnvelope,
  type BaeGenre,
  type BaeHome,
  type BaeHotItem,
  type BaeItem,
  type BaeSearchMetadata,
  type BaeTitle,
} from "./models";
import { BaeToonInterceptor } from "./network";
import type pbconfigType from "./pbconfig";

const HOME_TTL_MS = 5 * 60 * 1000;
const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

// Five discover rails read the same home payload, so one fetch serves them all.
let homeCache: { at: number; home: BaeHome } | undefined;
let genreCache: { at: number; genres: BaeGenre[] } | undefined;

class BaeToonExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new BaeToonInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }

  private async json<T>(path: string): Promise<BaeEnvelope<T>> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}${path}`,
      method: "GET",
    });
    const envelope = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as BaeEnvelope<T>;

    if (envelope.status !== "success" || envelope.data === undefined) {
      throw new Error(`The site answered ${path} with status ${envelope.status ?? "unknown"}.`);
    }

    return envelope;
  }

  private async home(): Promise<BaeHome> {
    if (homeCache && Date.now() - homeCache.at < HOME_TTL_MS) {
      return homeCache.home;
    }

    const home = (await this.json<BaeHome>("/api/home")).data!;
    homeCache = { at: Date.now(), home };

    return home;
  }

  private async genres(): Promise<BaeGenre[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    const genres = (await this.json<BaeGenre[]>("/api/index/genres")).data!.filter(
      (genre) => genre.name,
    );

    if (genres.length === 0) {
      throw new Error("The site returned no genres.");
    }

    genreCache = { at: Date.now(), genres };

    return genres;
  }

  private async genreName(id: string): Promise<string> {
    const match = (await this.genres()).find((genre) => genreId(genre.name) === id);

    if (!match) {
      throw new Error(`Unknown genre ${id}.`);
    }

    return match.name;
  }

  private async search(
    sort: string,
    page: number,
    text?: string,
    tag?: string,
  ): Promise<PagedResults<SearchResultItem>> {
    const params = [`sort=${sort}`, `page=${page}`, `limit=${PAGE_SIZE}`];
    if (text) params.push(`text=${encodeURIComponent(text)}`);
    if (tag) params.push(`tag=${encodeURIComponent(tag)}`);

    const envelope = await this.json<BaeItem[]>(`/api/titles/search?${params.join("&")}`);
    const items = envelope.data!;
    const totalPages = envelope.pagination?.totalPages ?? page;

    return {
      items: items.map((item) => this.resultItem(item)),
      metadata: items.length > 0 && page < totalPages ? { page: page + 1 } : { completed: true },
    };
  }

  private cover(item: { cover?: string; coverNormal?: string; fallback?: string }): string {
    return item.coverNormal || item.cover || item.fallback || PLACEHOLDER_COVER;
  }

  private subtitle(item: BaeItem | BaeHotItem): string {
    const bits: string[] = [];
    const chapter = item.latestChapter?.trim();

    if (chapter && !/no chapter/i.test(chapter)) {
      bits.push(chapter);
    } else if ("status" in item && item.status) {
      bits.push(item.status);
    }

    if (item.viewsFormatted) {
      bits.push(`${item.viewsFormatted} views`);
    }

    return bits.join(" • ");
  }

  private resultItem(item: BaeItem): SearchResultItem {
    const subtitle = this.subtitle(item);

    return {
      mangaId: item.id,
      title: item.title?.trim() || item.slug,
      imageUrl: this.cover(item),
      contentRating: ContentRating.MATURE,
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const title = (await this.json<BaeTitle>(`/api/titles/${encodeURIComponent(mangaId)}`)).data!;

    const tagGroups: TagSection[] = [];
    const genres = (title.tags ?? []).filter(Boolean);
    const keywords = (title.keywords ?? []).filter(Boolean);

    if (genres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genres.map((name) => ({ id: genreId(name), title: name })),
      });
    }

    if (keywords.length > 0) {
      tagGroups.push({
        id: "keywords",
        title: "Keywords",
        tags: keywords.map((name) => ({ id: `kw-${genreId(name)}`, title: name })),
      });
    }

    const additionalInfo: Record<string, string> = {};
    if (title.type) additionalInfo["Type"] = title.type;
    if (title.released) additionalInfo["Released"] = title.released;
    if (typeof title.views === "number") additionalInfo["Views"] = withCommas(title.views);
    if (typeof title.subscriptions === "number") {
      additionalInfo["Subscribers"] = withCommas(title.subscriptions);
    }
    if (title.chapters) additionalInfo["Chapters"] = String(title.chapters.length);
    if (title.officialTranslation) additionalInfo["Official translation"] = "Yes";
    if (title.animeAdaptation) additionalInfo["Anime adaptation"] = "Yes";

    const rating = typeof title.rating === "number" ? title.rating / 5 : undefined;

    return {
      mangaId: title.id,
      mangaInfo: {
        primaryTitle: title.title?.trim() || title.slug,
        secondaryTitles: (title.alternativeNames ?? []).map((name) => name.trim()).filter(Boolean),
        thumbnailUrl: this.cover(title),
        synopsis: (title.description ?? "").trim(),
        contentRating: title.adultContent ? ContentRating.ADULT : ContentRating.MATURE,
        ...(title.status ? { status: title.status } : {}),
        ...(title.author?.trim() ? { author: title.author.trim() } : {}),
        ...(title.artist?.trim() ? { artist: title.artist.trim() } : {}),
        ...(rating !== undefined ? { rating: Math.max(0, Math.min(1, rating)) } : {}),
        contentType: "comic",
        tagGroups,
        additionalInfo,
        shareUrl: `${DOMAIN}/title-detail/${title.slug}-${title.id}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const title = (
      await this.json<BaeTitle>(`/api/titles/${encodeURIComponent(sourceManga.mangaId)}`)
    ).data!;
    const chapters: Chapter[] = [];

    // Each number lists its alternate uploads with a page count; the site's
    // own primary can be a 7-page strip next to a 65-page one, so take the
    // fullest upload (ties keep the site's order).
    for (const row of title.chapters ?? []) {
      const chapNum = Number.parseFloat(row.number);
      const candidates = row.sources?.length ? row.sources : [row];
      const chosen = candidates.reduce((best, source) =>
        (source.pagesCount ?? 0) > (best.pagesCount ?? 0) ? source : best,
      );

      if (!chosen.id || Number.isNaN(chapNum)) {
        continue;
      }

      const name = (row.title ?? "").trim();
      const restates = new RegExp(
        `^(chapter|ch\\.?|c\\.?|episode|ep\\.?)?\\s*${chapNum}$`,
        "i",
      ).test(name);
      const published = chosen.datetime ? new Date(chosen.datetime) : undefined;

      chapters.push({
        chapterId: chosen.id,
        sourceManga,
        langCode: "en",
        chapNum,
        sortingIndex: chapNum,
        ...(name && !restates ? { title: name } : {}),
        ...(chosen.sourceName ? { version: chosen.sourceName } : {}),
        ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const page = (
      await this.json<BaeChapterPage>(`/api/chapters/${encodeURIComponent(chapter.chapterId)}`)
    ).data!;
    const pages = (page.pages ?? []).filter((url) => /^https?:\/\//.test(url));

    if (pages.length === 0) {
      throw new Error(`No pages were listed for chapter ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS;
  }

  async getAdvancedSearchForm(query: SearchQuery<BaeSearchMetadata>): Promise<BaeToonSearchForm> {
    return new BaeToonSearchForm(query.metadata as BaeSearchMetadata | undefined, this.genres());
  }

  async getSearchResults(
    query: SearchQuery<BaeSearchMetadata>,
    metadata: BaeSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const filters = query.metadata as BaeSearchMetadata | undefined;
    const page = metadata?.page ?? 1;
    const text = (query.title ?? "").trim();
    const tag = filters?.genre ? await this.genreName(filters.genre) : undefined;
    const sort = sortingOption?.id ?? (text ? "most-view" : SORTS[0]!.id);

    return await this.search(sort, page, text || undefined, tag);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION.spotlight, title: "Spotlight", type: DiscoverSectionType.featured },
      { id: SECTION.hotToday, title: "Today's Top 10", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION.latest, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION.hotWeekly, title: "Hot This Week", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION.hotMonthly, title: "Hot This Month", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION.hotAllTime, title: "Hot All Time", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION.popularGenres, title: "Popular Genres", type: DiscoverSectionType.genres },
      {
        id: SECTION.recentAdded,
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTION.mostViewed, title: "Most Viewed", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION.topRated, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION.genres, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: BaeSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;

    if (section.id === SECTION.genres || section.id === SECTION.popularGenres) {
      const genres =
        section.id === SECTION.genres
          ? await this.genres()
          : ((await this.home()).popularGenres ?? []).filter((genre) => genre.name);

      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.name,
          searchQuery: { title: "", metadata: { genre: genreId(genre.name) } },
        })),
        metadata: { completed: true },
      };
    }

    if (section.id === SECTION.latest) {
      return await this.latestUpdates(page);
    }

    const sort = SORTED_SECTIONS[section.id];

    if (sort) {
      const results = await this.search(sort, page);

      return {
        items: results.items.map((item) => ({
          type: "simpleCarouselItem" as const,
          mangaId: item.mangaId,
          imageUrl: item.imageUrl,
          title: item.title,
          contentRating: ContentRating.MATURE,
          ...(item.subtitle ? { subtitle: item.subtitle } : {}),
        })),
        metadata: results.metadata,
      };
    }

    const home = await this.home();

    if (section.id === SECTION.spotlight) {
      return {
        items: (home.spotlight ?? []).map((item) => ({
          type: "featuredCarouselItem" as const,
          mangaId: item.id,
          imageUrl: this.cover(item),
          title: item.title?.trim() || item.slug,
          contentRating: ContentRating.MATURE,
          ...(item.latestChapter && !/no chapter/i.test(item.latestChapter)
            ? { supertitle: item.latestChapter }
            : {}),
          ...(item.synopsis?.trim() ? { summary: item.synopsis.trim() } : {}),
        })),
        metadata: { completed: true },
      };
    }

    const rows: (BaeItem | BaeHotItem)[] =
      section.id === SECTION.hotToday
        ? (home.hotToday ?? [])
        : section.id === SECTION.hotWeekly
          ? (home.sidebarHot?.weekly ?? [])
          : section.id === SECTION.hotMonthly
            ? (home.sidebarHot?.monthly ?? [])
            : section.id === SECTION.hotAllTime
              ? (home.sidebarHot?.allTime ?? [])
              : [];

    if (rows.length === 0) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    return {
      items: rows.map((item) => {
        const subtitle = this.subtitle(item);

        return {
          type: "simpleCarouselItem" as const,
          mangaId: item.id,
          imageUrl: this.cover(item),
          title: item.title?.trim() || item.id,
          contentRating: ContentRating.MATURE,
          ...(subtitle ? { subtitle } : {}),
        };
      }),
      metadata: { completed: true },
    };
  }

  private async latestUpdates(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    const envelope = await this.json<BaeItem[]>(
      `/api/titles/search?sort=lastest-updates&page=${page}&limit=${PAGE_SIZE}`,
    );
    const rows = envelope.data!;
    const totalPages = envelope.pagination?.totalPages ?? page;
    const items: DiscoverSectionItem[] = [];

    for (const row of rows) {
      const chapterId = /\/chapter-detail\/([0-9a-f]{24})/i.exec(row.latestChapterUrl ?? "")?.[1];

      // Titles with no uploaded chapter yet have nothing to open.
      if (!chapterId) {
        continue;
      }

      const published = row.updatedAt ? new Date(row.updatedAt) : undefined;

      items.push({
        type: "chapterUpdatesCarouselItem",
        mangaId: row.id,
        chapterId,
        imageUrl: this.cover(row),
        title: row.title?.trim() || row.slug,
        contentRating: ContentRating.MATURE,
        ...(row.latestChapter ? { subtitle: row.latestChapter } : {}),
        ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return {
      items,
      metadata: rows.length > 0 && page < totalPages ? { page: page + 1 } : { completed: true },
    };
  }
}

export const BaeToon = new BaeToonExtension();
