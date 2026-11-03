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

import { toXhtmlDocument } from "../novel/xhtml";
import { XNovelApi } from "./api";
import { XNovelSearchForm } from "./forms";
import {
  ADULT_GENRES,
  DOMAIN,
  GENRES,
  GENRES_SECTION_ID,
  genreId,
  genreIdFromRecord,
  genreSlug,
  LISTING_PAGE_SIZE,
  LISTING_SECTIONS,
  PLACEHOLDER_COVER,
  SEARCH_PAGE_SIZE,
  SORTING_OPTIONS,
  type ChapterRow,
  type ListingWhere,
  type NovelRecord,
  type XNovelMetadata,
} from "./models";
import { XNovelInterceptor } from "./network";
import type pbconfigType from "./pbconfig";

const DEFAULT_SORT = SORTING_OPTIONS[0]!.id;

class XNovelExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new XNovelInterceptor("main", DOMAIN);

  private readonly api = new XNovelApi();

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const novel = await this.api.novel(mangaId);
    const genreIds = genreIdsOf(novel);
    const tagGroups: TagSection[] = [];

    if (genreIds.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreIds.map((id) => ({
          id,
          title: GENRES.find((genre) => genreId(genre.slug) === id)?.title ?? id,
        })),
      });
    }

    const latest = novel.chaptersNodes_last?.[0]?.data;
    const additionalInfo: Record<string, string> = {};
    if (latest?.ch_index) additionalInfo["Chapters"] = withCommas(latest.ch_index);
    if (latest?.ch_title) additionalInfo["Latest chapter"] = latest.ch_title;
    if (novel.votes) additionalInfo["Votes"] = withCommas(novel.votes);
    if (novel.follows) additionalInfo["Follows"] = withCommas(novel.follows);
    if (novel.reviews) additionalInfo["Reviews"] = withCommas(novel.reviews);
    const source = [novel.info_meta_Source ?? []].flat().join(", ").trim();
    if (source) additionalInfo["Source"] = source;
    if (novel.date_create) additionalInfo["Added"] = formatDate(novel.date_create);
    if (latest?.date_update ?? novel.date_update) {
      additionalInfo["Updated"] = formatDate((latest?.date_update ?? novel.date_update)!);
    }

    const authors = (novel.info_meta_Author ?? []).map((name) => name.trim()).filter(Boolean);
    const slug = novel.info_slug ? `${mangaId}-${novel.info_slug}` : mangaId;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: titleOf(novel),
        secondaryTitles: (novel.info_meta_AlternativeNames ?? [])
          .map((name) => name.trim())
          .filter(Boolean),
        thumbnailUrl: coverOf(novel),
        synopsis: (novel.info_descText ?? "").trim(),
        contentRating: ratingOf(genreIds),
        contentType: "novel",
        status: statusOf(novel),
        shareUrl: `${DOMAIN}/${slug}`,
        ...(authors.length ? { author: authors.join(", ") } : {}),
        ...(typeof novel.rate === "number" ? { rating: Math.min(novel.rate / 10, 1) } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        additionalInfo,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const [all, newest] = await Promise.all([
      this.api.allChapters(mangaId),
      this.api.newestChapters(mangaId),
    ]);

    const byId = new Map<string, ChapterRow>();
    for (const row of [...all, ...newest]) {
      if (row.ch_id) byId.set(row.ch_id, row);
    }

    if (byId.size === 0) {
      throw new Error(`No chapters were listed for ${mangaId}`);
    }

    return [...byId.values()]
      .sort((a, b) => (b.ch_index ?? 0) - (a.ch_index ?? 0))
      .map((row) => {
        const number = row.ch_index ?? 0;
        const name = (row.ch_title ?? "").trim();
        // Most titles are just "Chapter N", which the app prints already.
        const restates = new RegExp(`^(chapter|ch\\.?)\\s*${number}$`, "i").test(name);
        const published = row.date_create ?? row.date_update;

        return {
          chapterId: row.ch_id!,
          sourceManga,
          langCode: "en",
          chapNum: number,
          sortingIndex: number,
          ...(name && !restates ? { title: name } : {}),
          ...(published ? { publishDate: new Date(published) } : {}),
        };
      });
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const node = await this.api.chapter(chapter.chapterId);
    const paragraphs = node.sourcesNode_list?.[0]?.data?.content ?? [];
    const fragment = paragraphs
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      // Elements that already hold markup are passed through, as the site does.
      .map((text) =>
        /<\/?[a-z][^>]*>/i.test(text) ? text : `<p>${escapeText(text).replace(/\n/g, "<br/>")}</p>`,
      )
      .join("");

    if (!fragment) {
      throw new Error(`Chapter ${chapter.chapterId} has no text`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: toXhtmlDocument(fragment, node.ch_title ?? chapter.title),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<XNovelMetadata>): Promise<XNovelSearchForm> {
    return new XNovelSearchForm(query.metadata as XNovelMetadata | undefined);
  }

  async getSearchResults(
    query: SearchQuery<XNovelMetadata>,
    metadata: XNovelMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const filters = metadata ?? (query.metadata as XNovelMetadata | undefined) ?? {};
    const page = metadata?.page ?? 1;
    const sort = metadata?.sort ?? sortingOption?.id ?? DEFAULT_SORT;
    const genres = filters.genres ?? {};
    const included = Object.keys(genres)
      .filter((id) => genres[id] === "included")
      .map(genreSlug);
    const excluded = Object.keys(genres)
      .filter((id) => genres[id] === "excluded")
      .map(genreSlug);

    const list = await this.api.search((query.title ?? "").trim(), page, sort, included, excluded);
    const items = recordsOf(list).map((novel) => searchItem(novel));

    return {
      items,
      metadata:
        items.length < SEARCH_PAGE_SIZE
          ? { completed: true }
          : { page: page + 1, sort, ...(filters.genres ? { genres: filters.genres } : {}) },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...LISTING_SECTIONS.map((section, index) => ({
        id: section.id,
        title: section.title,
        type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: XNovelMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    if (section.id === GENRES_SECTION_ID) {
      return {
        items: GENRES.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: {
            title: "",
            metadata: { genres: { [genreId(genre.slug)]: "included" } },
          },
        })),
        metadata: { completed: true },
      };
    }

    const listing = LISTING_SECTIONS.find((entry) => entry.id === section.id);

    if (!listing) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const list = await this.api.listing(listing.id as ListingWhere, page);
    const novels = recordsOf(list);
    const hero = section.type === DiscoverSectionType.featured;

    const items = novels.map((novel) => {
      const item = searchItem(novel);
      return hero
        ? {
            type: "featuredCarouselItem" as const,
            mangaId: item.mangaId,
            imageUrl: item.imageUrl,
            title: item.title,
            contentRating: item.contentRating,
            ...(item.subtitle ? { supertitle: item.subtitle } : {}),
            ...(novel.info_descText?.trim() ? { summary: novel.info_descText.trim() } : {}),
          }
        : {
            type: "simpleCarouselItem" as const,
            mangaId: item.mangaId,
            imageUrl: item.imageUrl,
            title: item.title,
            contentRating: item.contentRating,
            ...(item.subtitle ? { subtitle: item.subtitle } : {}),
          };
    });

    return {
      items,
      metadata: items.length < LISTING_PAGE_SIZE ? { completed: true } : { page: page + 1 },
    };
  }
}

function recordsOf(list: { items?: { data?: NovelRecord }[] }): NovelRecord[] {
  return (list.items ?? []).flatMap((row) => (row?.data?.N_id ? [row.data] : []));
}

function searchItem(novel: NovelRecord): SearchResultItem {
  const latest = novel.chaptersNodes_last?.[0]?.data;
  const bits: string[] = [];
  if (latest?.ch_index) bits.push(`Chapter ${latest.ch_index}`);
  const status = statusOf(novel);
  if (status) bits.push(status);

  return {
    mangaId: novel.N_id,
    title: titleOf(novel),
    imageUrl: coverOf(novel),
    contentRating: ratingOf(genreIdsOf(novel)),
    ...(bits.length ? { subtitle: bits.join(" • ") } : {}),
  };
}

function titleOf(novel: NovelRecord): string {
  return (novel.N_title ?? "").trim() || novel.N_id;
}

function coverOf(novel: NovelRecord): string {
  const path = (novel.urlCoverOri ?? "").trim();
  if (!path) return PLACEHOLDER_COVER;
  return path.startsWith("http") ? path : `${DOMAIN}${path}`;
}

function genreIdsOf(novel: NovelRecord): string[] {
  return [...new Set((novel.info_meta_Genre ?? []).map(genreIdFromRecord).filter(Boolean))];
}

function statusOf(novel: NovelRecord): string | undefined {
  const status = (novel.info_meta_Status ?? "").trim().toLowerCase();
  if (status === "completed") return "Completed";
  if (status === "ongoing") return "Ongoing";
  return undefined;
}

function ratingOf(genreIds: string[]): ContentRating {
  return genreIds.some((id) => ADULT_GENRES.has(id)) ? ContentRating.ADULT : ContentRating.MATURE;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function withCommas(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export const XNovel = new XNovelExtension();
