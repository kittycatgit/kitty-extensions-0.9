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
import { FoxaholicSearchForm } from "./forms";
import {
  DOMAIN,
  GENRES_SECTION_ID,
  HOME_RAILS,
  LISTING_RAILS,
  SORTING_OPTIONS,
  type FoxaholicMetadata,
  type FoxCard,
  type FoxChapterRow,
  type Option,
} from "./models";
import { FoxaholicInterceptor } from "./network";
import {
  parseChapterList,
  parseChapterText,
  parseDate,
  parseGenres,
  parseHome,
  parseListing,
  parseNovel,
} from "./parsers";
import type pbconfigType from "./pbconfig";

const GENRE_TTL = 24 * 60 * 60 * 1000;
const HOME_TTL = 5 * 60 * 1000;

// The home page is ~140 KB, so neither cache belongs in setState.
let genreCache: { at: number; genres: Option[] } | undefined;
let homeCache: { at: number; sections: ReturnType<typeof parseHome> } | undefined;

function subtitleOf(card: FoxCard): string | undefined {
  const bits: string[] = [];
  if (card.latest) bits.push(card.premium ? `${card.latest} (locked)` : card.latest);
  if (card.status) bits.push(card.status);
  else if (card.latestDate) bits.push(card.latestDate);
  else if (card.genres[0]) bits.push(card.genres[0]);
  return bits.length ? bits.join(" • ") : undefined;
}

function chapterNumberOf(title: string): number {
  const match =
    /(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i.exec(title) ??
    /^\s*(\d+(?:\.\d+)?)/.exec(title);
  return match ? Number(match[1]) : 0;
}

// "Chapter 27 - Rege the sheep" keeps only the part the app does not print itself.
function chapterTitleOf(title: string): string | undefined {
  const rest = title.replace(/^\s*(?:chapter|chap|ch\.?)\s*\d+(?:\.\d+)?\s*[-–:]?\s*/i, "").trim();
  return rest || undefined;
}

class FoxaholicExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new FoxaholicInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async genres(): Promise<Option[]> {
    if (genreCache && Date.now() - genreCache.at < GENRE_TTL) {
      return genreCache.genres;
    }

    const genres = parseGenres(await this.getText(`${DOMAIN}/?s=&post_type=wp-manga`));
    if (genres.length === 0) {
      throw new Error("The search page no longer lists its genre checkboxes");
    }

    genreCache = { at: Date.now(), genres };
    return genres;
  }

  private async home(): Promise<ReturnType<typeof parseHome>> {
    if (homeCache && Date.now() - homeCache.at < HOME_TTL) {
      return homeCache.sections;
    }

    const sections = parseHome(await this.getText(`${DOMAIN}/`));
    homeCache = { at: Date.now(), sections };
    return sections;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const novel = parseNovel(await this.getText(`${DOMAIN}/novel/${mangaId}/`), mangaId);

    const tagGroups: TagSection[] = [];
    if (novel.genres.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: novel.genres.map((genre) => ({ id: genre.slug, title: genre.title })),
      });
    }
    if (novel.tags.length) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: novel.tags.map((tag) => ({ id: `tag-${tag.slug}`, title: tag.title })),
      });
    }

    const additionalInfo: Record<string, string> = {};
    if (novel.type) additionalInfo["Type"] = novel.type;
    if (novel.translation) additionalInfo["Translation"] = novel.translation;
    if (novel.teams.length) additionalInfo["Team"] = novel.teams.join(", ");
    if (novel.rank) additionalInfo["Rank"] = novel.rank;
    if (!novel.deferredChapters) additionalInfo["Chapters"] = String(novel.rows.length);
    const locked = novel.rows.filter((row) => row.coins !== undefined).length;
    if (locked) additionalInfo["Locked chapters"] = String(locked);

    const mature = novel.genres.some((genre) => /^(mature|adult|smut)$/i.test(genre.title));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: novel.title,
        secondaryTitles: novel.altTitles,
        thumbnailUrl: novel.cover,
        synopsis: novel.synopsis,
        contentRating: mature ? ContentRating.ADULT : ContentRating.MATURE,
        contentType: "novel",
        status: /complete/i.test(novel.status ?? "") ? "Completed" : "Ongoing",
        shareUrl: `${DOMAIN}/novel/${mangaId}/`,
        ...(novel.authors.length ? { author: novel.authors.join(", ") } : {}),
        ...(novel.teams.length ? { artist: novel.teams.join(", ") } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        additionalInfo,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const novel = parseNovel(await this.getText(`${DOMAIN}/novel/${mangaId}/`), mangaId);

    // Newer pages render the list inline; older ones leave a holder the theme
    // fills from this endpoint, so the page itself decides which is read.
    let rows: FoxChapterRow[] = novel.rows;
    if (novel.deferredChapters) {
      const [, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/novel/${mangaId}/ajax/chapters/`,
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest" },
      });
      rows = parseChapterList(Application.arrayBufferToUTF8String(buffer));
    }

    const seen = new Set<string>();
    const chapters: Chapter[] = [];

    rows.forEach((row, index) => {
      if (seen.has(row.id)) {
        return;
      }
      seen.add(row.id);

      const published = parseDate(row.date);
      const title = chapterTitleOf(row.title);

      chapters.push({
        chapterId: row.id,
        sourceManga,
        langCode: "en",
        chapNum: chapterNumberOf(row.title),
        sortingIndex: rows.length - index,
        ...(title ? { title } : {}),
        ...(row.coins !== undefined ? { version: "Premium" } : {}),
        ...(published ? { publishDate: published } : {}),
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const locked = /^premium-(\d+)-/.exec(chapter.chapterId);

    if (locked) {
      throw new Error(
        `This chapter costs ${locked[1]} coins on foxaholic.com and needs a logged-in purchase there.`,
      );
    }

    const page = await this.getText(`${DOMAIN}/novel/${mangaId}/${chapter.chapterId}/`);
    const text = parseChapterText(page);

    return {
      id: chapter.chapterId,
      mangaId,
      type: "html",
      html: toXhtmlDocument(text.body, text.title ?? chapter.title),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<FoxaholicSearchForm> {
    return new FoxaholicSearchForm(query.metadata as FoxaholicMetadata | undefined, this.genres());
  }

  private listingUrl(
    title: string,
    filters: FoxaholicMetadata,
    sort: string | undefined,
    page: number,
  ): string {
    const parts = [`s=${encodeURIComponent(title)}`, "post_type=wp-manga"];

    for (const genre of filters.genres ?? []) {
      parts.push(`genre%5B%5D=${encodeURIComponent(genre)}`);
    }
    if (filters.op && filters.genres?.length) parts.push(`op=${filters.op}`);
    for (const status of filters.statuses ?? []) {
      parts.push(`status%5B%5D=${encodeURIComponent(status)}`);
    }
    if (filters.adult) parts.push(`adult=${filters.adult}`);
    if (filters.author) parts.push(`author=${encodeURIComponent(filters.author)}`);
    if (filters.artist) parts.push(`artist=${encodeURIComponent(filters.artist)}`);
    if (filters.release) parts.push(`release=${encodeURIComponent(filters.release)}`);
    if (sort && sort !== "relevance") parts.push(`m_orderby=${sort}`);

    const base = page > 1 ? `${DOMAIN}/page/${page}/` : `${DOMAIN}/`;
    return `${base}?${parts.join("&")}`;
  }

  private async listing(
    url: string,
    page: number,
    carry: FoxaholicMetadata,
  ): Promise<PagedResults<SearchResultItem>> {
    const { items, hasNext } = parseListing(await this.getText(url));

    return {
      items: items.map((card) => ({
        mangaId: card.id,
        title: card.title,
        imageUrl: card.cover,
        contentRating: ContentRating.MATURE,
        ...(subtitleOf(card) ? { subtitle: subtitleOf(card) } : {}),
      })),
      metadata: hasNext && items.length > 0 ? { ...carry, page: page + 1 } : { completed: true },
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as FoxaholicMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = (paging ??
      (query.metadata as FoxaholicMetadata | undefined) ??
      {}) as FoxaholicMetadata;
    const page = paging?.page ?? 1;
    const title = (query.title ?? "").trim();
    // Relevance only means something with a title; an empty query sorts by update.
    const sort = sortingOption?.id ?? (title ? "relevance" : "latest");
    const { page: _page, completed: _completed, ...carry } = filters;

    return await this.listing(this.listingUrl(title, filters, sort, page), page, carry);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_RAILS.map((rail, index) => ({
        id: rail.id,
        title: rail.title,
        type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
      })),
      ...LISTING_RAILS.map((rail) => ({
        id: rail.id,
        title: rail.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as FoxaholicMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    if (section.id === GENRES_SECTION_ID) {
      const genres = await this.genres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genres: [genre.id] } },
        })),
        metadata: { completed: true },
      };
    }

    const home = HOME_RAILS.find((rail) => rail.id === section.id);
    if (home) {
      const cards = (await this.home())[home.key];
      return {
        items: cards.map((card) =>
          home.key === "favorites"
            ? {
                type: "featuredCarouselItem" as const,
                mangaId: card.id,
                imageUrl: card.cover,
                title: card.title,
                contentRating: ContentRating.MATURE,
                ...(card.summary ? { summary: card.summary } : {}),
                ...(card.genres[0] ? { supertitle: card.genres.join(" • ") } : {}),
              }
            : {
                type: "simpleCarouselItem" as const,
                mangaId: card.id,
                imageUrl: card.cover,
                title: card.title,
                contentRating: ContentRating.MATURE,
                ...(subtitleOf(card) ? { subtitle: subtitleOf(card) } : {}),
              },
        ),
        metadata: { completed: true },
      };
    }

    const rail = LISTING_RAILS.find((entry) => entry.id === section.id);
    if (!rail) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = paging?.page ?? 1;
    const filters: FoxaholicMetadata = rail.status ? { statuses: [rail.status] } : {};
    const results = await this.listing(this.listingUrl("", filters, rail.sort, page), page, {});

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

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const Foxaholic = new FoxaholicExtension();
