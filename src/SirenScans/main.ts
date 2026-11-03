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
  type Tag,
} from "@paperback/types";

import { toXhtmlDocument } from "../novel/xhtml";
import { SirenScansSearchForm } from "./forms";
import {
  DOMAIN,
  PAGE_SIZE,
  SECTIONS,
  SORTING_OPTIONS,
  type SirenCard,
  type SirenHome,
  type SirenSearchMetadata,
  type SirenUpdate,
} from "./models";
import { SirenScansInterceptor } from "./network";
import {
  chapterNumberOf,
  isLockedChapterPage,
  parseChapterPages,
  parseChapterProse,
  parseChapterRows,
  parseFragmentCards,
  parseGenres,
  parseGridFragment,
  parseHome,
  parseRecentUpdates,
  parseSeries,
} from "./parsers";
import type pbconfigType from "./pbconfig";

// An empty imageUrl fails the whole row, so point at a URL that serves no
// image and let the app draw its own placeholder.
const FALLBACK_COVER = `${DOMAIN}/_no-cover.png`;

const HOME_TTL_MS = 5 * 60 * 1000;
const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

const ADULT_TAGS = new Set(["adult", "smut", "hentai", "ecchi", "18+", "r18", "erotica"]);

type Genre = { slug: string; name: string };

type AjaxListing = { html?: string; has_more?: boolean };

type ChaptersResponse = { success?: boolean; rows_html?: string; chapter_count?: number };

// The home page carries six rails at once; keep it out of setState.
let homeCache: { at: number; home: SirenHome } | undefined;

let genreCache: { at: number; genres: Genre[] } | undefined;

class SirenScansExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new SirenScansInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getJson<T>(url: string): Promise<T> {
    const [, buffer] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest" },
    });

    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  private async home(): Promise<SirenHome> {
    if (homeCache && Date.now() - homeCache.at < HOME_TTL_MS) {
      return homeCache.home;
    }

    const home = parseHome(await this.getText(`${DOMAIN}/`));
    homeCache = { at: Date.now(), home };

    return home;
  }

  private async genres(): Promise<Genre[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    const genres = parseGenres(await this.getText(`${DOMAIN}/?browse=1`));

    if (genres.length === 0) {
      throw new Error("The browse page no longer lists any genres.");
    }

    genreCache = { at: Date.now(), genres };

    return genres;
  }

  private async genreTags(): Promise<Tag[]> {
    return (await this.genres()).map((genre) => ({
      id: genre.slug,
      title: genre.name.charAt(0).toUpperCase() + genre.name.slice(1),
    }));
  }

  // Tag ids are slugified; the site wants the raw tag text back.
  private async tagNames(ids: string[]): Promise<string[]> {
    const genres = await this.genres();
    const byId = new Map(genres.map((genre) => [genre.slug, genre.name]));

    return ids.map((id) => byId.get(id) ?? id.replace(/-/g, " "));
  }

  private async listing(
    page: number,
    options: { q?: string; sort?: string; type?: string; status?: string; tags?: string[] },
  ): Promise<{ cards: SirenCard[]; hasMore: boolean }> {
    const params = [`_ajax=search`, `offset=${(page - 1) * PAGE_SIZE}`];

    if (options.q) {
      params.push(`q=${encodeURIComponent(options.q)}`);
    }
    if (options.sort && options.sort !== "default") {
      params.push(`sort=${encodeURIComponent(options.sort)}`);
    }
    if (options.type) {
      params.push(`type=${encodeURIComponent(options.type)}`);
    }
    if (options.status) {
      params.push(`status=${encodeURIComponent(options.status)}`);
    }
    for (const tag of options.tags ?? []) {
      params.push(`tag%5B%5D=${encodeURIComponent(tag)}`);
    }

    const payload = await this.getJson<AjaxListing>(`${DOMAIN}/?${params.join("&")}`);

    return {
      cards: parseGridFragment(payload.html ?? ""),
      hasMore: payload.has_more === true,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = parseSeries(await this.getText(`${DOMAIN}/${mangaId}`));
    const isNovel = (series.type ?? "").toLowerCase() === "novel";
    const additionalInfo: Record<string, string> = {};

    if (series.type) {
      additionalInfo.Type = series.type;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: series.altTitles,
        thumbnailUrl: series.cover || FALLBACK_COVER,
        ...(series.author ? { author: series.author } : {}),
        ...(series.artist ? { artist: series.artist } : {}),
        synopsis: series.synopsis,
        contentRating: contentRatingOf(series.genres.map((genre) => genre.name)),
        status: statusOf(series.status),
        contentType: isNovel ? "novel" : "comic",
        tagGroups: [
          {
            id: "genres",
            title: "Genres",
            tags: series.genres.map((genre) => ({ id: genre.slug, title: genre.name })),
          },
        ],
        shareUrl: `${DOMAIN}/${mangaId}`,
        additionalInfo,
      },
    };
  }

  // The series page ships a skeleton; the rows come from the JSON call the
  // page itself makes, which needs the uid printed on that skeleton.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const series = parseSeries(await this.getText(`${DOMAIN}/${mangaId}`));
    const payload = await this.getJson<ChaptersResponse>(
      `${DOMAIN}/?_chapters_html=1&series_uid=${encodeURIComponent(series.uid)}&series_slug=${encodeURIComponent(mangaId)}`,
    );

    if (payload.success === false) {
      throw new Error(`The site refused the chapter list for ${mangaId}.`);
    }

    const rows = parseChapterRows(payload.rows_html ?? "", mangaId);
    const total = rows.length;

    return rows.map((row, position) => {
      const number = chapterNumberOf(row.label, row.id);
      // Labels mostly restate the number the app already prints.
      const restates = new RegExp(`^(chapter|ch\\.?|episode|ep\\.?)\\s*${number}$`, "i").test(
        row.label,
      );

      return {
        chapterId: row.id,
        sourceManga,
        langCode: "en",
        chapNum: number,
        sortingIndex: total - position,
        ...(restates ? {} : { title: row.label }),
        ...(row.locked ? { version: row.coins ? `Locked • ${row.coins} coins` : "Locked" } : {}),
        ...(row.date ? { publishDate: row.date } : {}),
      };
    });
  }

  // A NOVEL-type series can still ship an image chapter (its chapter 0 often
  // is one), so the page decides: strip images, else prose, else locked.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const html = await this.getText(`${DOMAIN}/${mangaId}-${chapter.chapterId}`);
    const pages = parseChapterPages(html);

    if (pages.length > 0) {
      return { id: chapter.chapterId, mangaId, pages };
    }

    const prose = parseChapterProse(html);

    if (prose) {
      return {
        id: chapter.chapterId,
        mangaId,
        type: "html",
        html: toXhtmlDocument(prose, chapter.title),
      };
    }

    throw lockedOrEmpty(html, chapter.chapterId);
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(
    query: SearchQuery<SirenSearchMetadata>,
  ): Promise<SirenScansSearchForm> {
    return new SirenScansSearchForm(query.metadata, await this.genreTags());
  }

  async getSearchResults(
    query: SearchQuery<SirenSearchMetadata>,
    metadata: SirenSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const filters = metadata ?? query.metadata ?? {};
    const page = metadata?.page ?? 1;
    const tagIds = filters.tags ?? [];

    const { cards, hasMore } = await this.listing(page, {
      q: (query.title ?? "").trim(),
      sort: sortingOption?.id,
      type: filters.type,
      status: filters.status,
      tags: tagIds.length > 0 ? await this.tagNames(tagIds) : [],
    });

    return {
      items: cards.map((card) => searchItem(card)),
      metadata: hasMore
        ? {
            page: page + 1,
            ...(tagIds.length > 0 ? { tags: tagIds } : {}),
            ...(filters.type ? { type: filters.type } : {}),
            ...(filters.status ? { status: filters.status } : {}),
          }
        : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.featured, title: "Featured Series", type: DiscoverSectionType.featured },
      { id: SECTIONS.novels, title: "Novels", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.trending, title: "Trending Today", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.trendingWeek,
        title: "Trending This Week",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.trendingMonth,
        title: "Trending This Month",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.trendingAll,
        title: "Trending All Time",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.mostReviewed,
        title: "Most Reviewed This Week",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.mostReviewedAll,
        title: "Most Reviewed All Time",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.recentlyUpdated,
        title: "Recently Updated",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: SECTIONS.editorsChoice,
        title: "Editor's Choice",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.newlyAdded,
        title: "Newly Added Series",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.popular, title: "Popular", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.topRated, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.completed, title: "Completed", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.genres, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: SirenSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const single = (cards: SirenCard[]): PagedResults<DiscoverSectionItem> => ({
      items: cards.map((card) => carouselItem(card)),
      metadata: { completed: true },
    });

    switch (section.id) {
      case SECTIONS.featured:
        return {
          items: (await this.home()).featured.map((card) => featuredItem(card)),
          metadata: { completed: true },
        };
      case SECTIONS.novels:
        return single((await this.home()).novels);
      case SECTIONS.trending:
        return single((await this.home()).trending);
      case SECTIONS.mostReviewed:
        return single((await this.home()).mostReviewed);
      case SECTIONS.editorsChoice:
        return single((await this.home()).editorsChoice);
      case SECTIONS.trendingWeek:
        return single(await this.fragment("_trending", "weekly"));
      case SECTIONS.trendingMonth:
        return single(await this.fragment("_trending", "monthly"));
      case SECTIONS.trendingAll:
        return single(await this.fragment("_trending", "all"));
      case SECTIONS.mostReviewedAll:
        return single(await this.fragment("_most_reviewed", "all"));
      case SECTIONS.recentlyUpdated:
        return await this.recentlyUpdated(page);
      case SECTIONS.newlyAdded:
        return await this.newlyAdded(page);
      case SECTIONS.popular:
        return await this.sortedRail(page, { sort: "popular" });
      case SECTIONS.topRated:
        return await this.sortedRail(page, { sort: "rating" });
      case SECTIONS.completed:
        return await this.sortedRail(page, { status: "completed" });
      case SECTIONS.genres:
        return {
          items: (await this.genreTags()).map((genre) => ({
            type: "genresCarouselItem" as const,
            name: genre.title,
            searchQuery: { title: "", metadata: { tags: [genre.id] } },
          })),
          metadata: { completed: true },
        };
      default:
        throw new Error(`Invalid sectionId provided: ${section.id}`);
    }
  }

  // The range buttons swap a card fragment into the home rail.
  private async fragment(kind: string, range: string): Promise<SirenCard[]> {
    return parseFragmentCards(await this.getText(`${DOMAIN}/?${kind}=1&range=${range}`));
  }

  private async recentlyUpdated(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    const { items, hasNext } = parseRecentUpdates(
      await this.getText(`${DOMAIN}/?_ajax=recent-chapters&page=${page}`),
    );

    return {
      items: items.map((item) => updateItem(item)),
      metadata: items.length > 0 && hasNext ? { page: page + 1 } : { completed: true },
    };
  }

  // Page 1 is printed on the home page; later pages come from the same
  // endpoint the page's infinite scroll calls.
  private async newlyAdded(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    if (page === 1) {
      const cards = (await this.home()).newlyAdded;
      return {
        items: cards.map((card) => carouselItem(card)),
        metadata: cards.length >= PAGE_SIZE ? { page: 2 } : { completed: true },
      };
    }

    const payload = await this.getJson<AjaxListing>(
      `${DOMAIN}/?_ajax=home&offset=${(page - 1) * PAGE_SIZE}`,
    );
    const cards = parseGridFragment(payload.html ?? "");

    return {
      items: cards.map((card) => carouselItem(card)),
      metadata:
        cards.length > 0 && payload.has_more === true ? { page: page + 1 } : { completed: true },
    };
  }

  private async sortedRail(
    page: number,
    options: { sort?: string; status?: string },
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const { cards, hasMore } = await this.listing(page, options);

    return {
      items: cards.map((card) => carouselItem(card)),
      metadata: cards.length > 0 && hasMore ? { page: page + 1 } : { completed: true },
    };
  }
}

function subtitleOf(card: SirenCard): string | undefined {
  const bits: string[] = [];

  if (card.type) {
    bits.push(card.type.charAt(0) + card.type.slice(1).toLowerCase());
  }
  if (card.rating) {
    bits.push(`★ ${card.rating}${card.reviews ? ` ${card.reviews}` : ""}`);
  }
  if (bits.length === 0 && card.tags.length > 0) {
    bits.push(card.tags.slice(0, 3).join(" · "));
  }

  return bits.length > 0 ? bits.join(" • ") : undefined;
}

function contentRatingOf(tags: string[]): ContentRating {
  return tags.some((tag) => ADULT_TAGS.has(tag.trim().toLowerCase()))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
}

function statusOf(status: string | undefined): string {
  const value = (status ?? "").toLowerCase();

  if (value.includes("ongoing")) {
    return "Ongoing";
  }
  if (value.includes("complete")) {
    return "Completed";
  }
  if (value.includes("dropped") || value.includes("cancel")) {
    return "Cancelled";
  }
  if (value.includes("paused") || value.includes("hiatus")) {
    return "Hiatus";
  }

  return "Unknown";
}

function searchItem(card: SirenCard): SearchResultItem {
  const subtitle = subtitleOf(card);

  return {
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.cover || FALLBACK_COVER,
    contentRating: contentRatingOf(card.tags),
    ...(subtitle ? { subtitle } : {}),
  };
}

function carouselItem(card: SirenCard): DiscoverSectionItem {
  const subtitle = subtitleOf(card);

  return {
    type: "simpleCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.cover || FALLBACK_COVER,
    contentRating: contentRatingOf(card.tags),
    ...(subtitle ? { subtitle } : {}),
  };
}

function featuredItem(card: SirenCard): DiscoverSectionItem {
  const supertitle = subtitleOf(card);

  return {
    type: "featuredCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.cover || FALLBACK_COVER,
    contentRating: contentRatingOf(card.tags),
    ...(card.synopsis ? { summary: card.synopsis } : {}),
    ...(supertitle ? { supertitle } : {}),
  };
}

function updateItem(item: SirenUpdate): DiscoverSectionItem {
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.slug,
    chapterId: item.chapterId,
    title: item.title,
    imageUrl: item.cover || FALLBACK_COVER,
    subtitle: item.coins ? `${item.chapterName} • ${item.coins}` : item.chapterName,
    ...(item.date ? { publishDate: item.date } : {}),
  };
}

function lockedOrEmpty(html: string, chapterId: string): Error {
  const { locked, coins } = isLockedChapterPage(html);

  if (locked) {
    return new Error(
      `Chapter ${chapterId} is locked on sirenscans.org${coins ? ` and costs ${coins} coins` : ""}; unlock it on the site first.`,
    );
  }

  return new Error(`No pages were found for chapter ${chapterId}.`);
}

export const SirenScans = new SirenScansExtension();
