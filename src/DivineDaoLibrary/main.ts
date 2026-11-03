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
import * as cheerio from "cheerio";

import { toXhtmlDocument } from "../novel/xhtml";
import { DivineDaoLibrarySearchForm } from "./forms";
import {
  DOMAIN,
  PAGE_SIZE,
  RAILS,
  SORTS,
  type Rail,
  type SearchMetadata,
  type Story,
  type StoryCard,
  type Term,
} from "./models";
import { DivineDaoLibraryInterceptor } from "./network";
import {
  hasNoResults,
  parseChapterBody,
  parseChapterCards,
  parseGenres,
  parseStory,
  parseStoryCards,
  parseUpdateCards,
} from "./parsers";
import pbconfig from "./pbconfig";

const GENRES_TTL_MS = 24 * 60 * 60 * 1000;
const REST_PAGE = 100;

let genreCache: { at: number; genres: Term[] } | undefined;

const ADULT_GENRES = new Set(["adult", "smut", "ecchi", "hentai", "mature"]);

function ratingOf(rating: string | undefined, genres: string[]): ContentRating {
  const label = (rating ?? "").toLowerCase();
  if (label === "adult") {
    return ContentRating.ADULT;
  }
  if (label === "mature" || genres.some((genre) => ADULT_GENRES.has(genre.toLowerCase()))) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
}

function cardSubtitle(card: StoryCard): string | undefined {
  const bits: string[] = [];
  if (card.status) bits.push(card.status);
  if (card.chapters) bits.push(`${card.chapters} chapters`);
  if (!card.chapters && card.words) bits.push(`${card.words} words`);
  return bits.length > 0 ? bits.join(" • ") : undefined;
}

class DivineDaoLibraryExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new DivineDaoLibraryInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async document(url: string): Promise<cheerio.CheerioAPI> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  private async story(mangaId: string): Promise<Story> {
    return parseStory(await this.document(`${DOMAIN}/story/${mangaId}/`), mangaId);
  }

  private async genres(): Promise<Term[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    const genres: Term[] = [];

    for (let page = 1; ; page += 1) {
      const [, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/wp-json/wp/v2/fcn_genre?per_page=${REST_PAGE}&_fields=id,name,slug,count&page=${page}`,
        method: "GET",
      });
      const rows = parseGenres(Application.arrayBufferToUTF8String(buffer));
      genres.push(...rows);

      if (rows.length < REST_PAGE) {
        break;
      }
    }

    if (genres.length === 0) {
      throw new Error("The site returned no genres.");
    }

    genreCache = { at: Date.now(), genres };
    return genres;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const story = await this.story(mangaId);
    const tagGroups: TagSection[] = [];

    if (story.genres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: story.genres.map((genre) => ({ id: genre.slug, title: genre.name })),
      });
    }
    if (story.tags.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: story.tags.map((tag) => ({ id: tag.slug, title: tag.name })),
      });
    }

    const additionalInfo: Record<string, string> = {};
    if (story.translator) additionalInfo["Translator"] = story.translator;
    if (story.chapterCount) additionalInfo["Chapters"] = String(story.chapterCount);
    if (story.words) additionalInfo["Words"] = story.words;
    if (story.rating) additionalInfo["Age rating"] = story.rating;
    if (story.published) additionalInfo["Published"] = story.published;
    if (story.nextChapter) additionalInfo["Next chapter"] = story.nextChapter;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: story.title,
        secondaryTitles: story.altTitles,
        thumbnailUrl: story.cover,
        synopsis: story.synopsis,
        contentRating: ratingOf(
          story.rating,
          story.genres.map((genre) => genre.slug),
        ),
        contentType: "novel",
        shareUrl: `${DOMAIN}/story/${mangaId}/`,
        ...(story.status ? { status: story.status } : {}),
        ...(story.originalAuthor ? { author: story.originalAuthor } : {}),
        ...(tagGroups.length > 0 ? { tagGroups } : {}),
        additionalInfo,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const story = await this.story(sourceManga.mangaId);
    const entries = story.chapters;

    if (entries.length === 0) {
      throw new Error(`No chapters are listed for ${sourceManga.mangaId}`);
    }

    // Titles carry the number ("Chapter 1412, …"). Book/volume stories restart
    // numbering per volume, so those fall back to list position.
    const numbers = entries.map((entry) => {
      const match = /Chapter\s+(\d+(?:\.\d+)?)/i.exec(entry.title);
      return match ? Number(match[1]) : Number.NaN;
    });
    const sequential =
      numbers.some((value) => Number.isNaN(value)) || new Set(numbers).size !== numbers.length;

    return entries
      .map((entry, index): Chapter => {
        const chapNum = sequential ? index + 1 : numbers[index]!;
        const volume = /^Volume\s+(\d+)\b/i.exec(entry.group ?? "")?.[1];
        const title = sequential
          ? entry.title
          : entry.title.replace(/^Chapter\s+\d+(?:\.\d+)?[\s,:.–-]*/i, "").trim();

        return {
          chapterId: entry.slug,
          sourceManga,
          langCode: "en",
          chapNum,
          sortingIndex: index,
          ...(title && title !== entry.title ? { title } : sequential ? { title } : {}),
          ...(volume ? { volume: Number(volume) } : {}),
          ...(entry.date ? { publishDate: entry.date } : {}),
        };
      })
      .reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const $ = await this.document(`${DOMAIN}/story/${mangaId}/${chapter.chapterId}/`);
    const body = parseChapterBody($);

    return {
      id: chapter.chapterId,
      mangaId,
      type: "html",
      html: toXhtmlDocument(body.html, body.title || undefined),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS;
  }

  async getAdvancedSearchForm(
    query: SearchQuery<SearchMetadata>,
  ): Promise<DivineDaoLibrarySearchForm> {
    return new DivineDaoLibrarySearchForm(query.metadata, this.genres());
  }

  private searchUrl(query: SearchQuery<SearchMetadata>, page: number, sort?: string): string {
    const filters = query.metadata ?? {};
    const included: string[] = [];
    const excluded: string[] = [];

    for (const [id, state] of Object.entries(filters.genres ?? {})) {
      (state === "included" ? included : excluded).push(id);
    }

    const parts = [
      `s=${encodeURIComponent((query.title ?? "").trim())}`,
      "post_type=fcn_story",
      `sentence=${filters.sentence ? 1 : 0}`,
      `orderby=${sort ?? "modified"}`,
      "order=desc",
    ];
    if (filters.rating) parts.push(`age_rating=${encodeURIComponent(filters.rating)}`);
    if (filters.status) parts.push(`story_status=${encodeURIComponent(filters.status)}`);
    if (included.length > 0) parts.push(`genres=${included.join(",")}`);
    if (excluded.length > 0) parts.push(`ex_genres=${excluded.join(",")}`);

    const prefix = page > 1 ? `${DOMAIN}/page/${page}/` : `${DOMAIN}/`;
    return `${prefix}?${parts.join("&")}`;
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: SearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const $ = await this.document(this.searchUrl(query, page, sortingOption?.id));
    const cards = hasNoResults($) ? [] : parseStoryCards($, "ul#search-result-list");

    return {
      items: cards.map((card) => ({
        mangaId: card.slug,
        title: card.title,
        imageUrl: card.cover,
        contentRating: ratingOf(card.rating, card.genres),
        ...(cardSubtitle(card) ? { subtitle: cardSubtitle(card) } : {}),
      })),
      metadata:
        cards.length < PAGE_SIZE ? { completed: true } : { ...query.metadata, page: page + 1 },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return RAILS.map((rail) => ({
      id: rail.id,
      title: rail.title,
      type:
        rail.kind === "home"
          ? DiscoverSectionType.featured
          : rail.kind === "chapters"
            ? DiscoverSectionType.chapterUpdates
            : rail.kind === "genres"
              ? DiscoverSectionType.genres
              : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: SearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;

    switch (rail.kind) {
      case "home":
        return await this.homeItems();
      case "chapters":
        return await this.chapterItems(page);
      case "genres":
        return await this.genreItems();
      default:
        return await this.storyItems(rail, page);
    }
  }

  private async homeItems(): Promise<PagedResults<DiscoverSectionItem>> {
    const cards = parseUpdateCards(await this.document(`${DOMAIN}/`));

    return {
      items: cards.map((card) => ({
        type: "featuredCarouselItem" as const,
        mangaId: card.slug,
        imageUrl: card.cover,
        title: card.title,
        ...(card.latestChapter ? { supertitle: card.latestChapter } : {}),
        ...(card.blurb ? { summary: card.blurb } : {}),
      })),
      metadata: { completed: true },
    };
  }

  private async chapterItems(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    const cards = parseChapterCards(await this.document(`${DOMAIN}/latest-chapters/page/${page}/`));

    return {
      items: cards.map((card) => ({
        type: "chapterUpdatesCarouselItem" as const,
        mangaId: card.storySlug,
        chapterId: card.chapterSlug,
        imageUrl: card.cover,
        title: card.storyTitle ?? card.storySlug,
        subtitle: card.title,
      })),
      metadata: cards.length < PAGE_SIZE ? { completed: true } : { page: page + 1 },
    };
  }

  private async genreItems(): Promise<PagedResults<DiscoverSectionItem>> {
    const genres = await this.genres();

    return {
      items: genres.map((genre) => ({
        type: "genresCarouselItem" as const,
        name: genre.name,
        searchQuery: { title: "", metadata: { genres: { [genre.id]: "included" } } },
      })),
      metadata: { completed: true },
    };
  }

  private async storyItems(
    rail: Extract<Rail, { kind: "collection" | "stories" }>,
    page: number,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // Collections page with ?pg=, the stories archive with /page/N/.
    const url =
      rail.kind === "collection"
        ? `${DOMAIN}/collection/${rail.slug}/?pg=${page}`
        : page > 1
          ? `${DOMAIN}/stories/page/${page}/?orderby=${rail.orderby}&order=desc`
          : `${DOMAIN}/stories/?orderby=${rail.orderby}&order=desc`;
    const list = rail.kind === "collection" ? "ul#featured-list" : "ul#list-of-stories";
    const $ = await this.document(url);
    const cards = hasNoResults($) ? [] : parseStoryCards($, list);

    return {
      items: cards.map((card) => ({
        type: "simpleCarouselItem" as const,
        mangaId: card.slug,
        imageUrl: card.cover,
        title: card.title,
        contentRating: ratingOf(card.rating, card.genres),
        ...(cardSubtitle(card) ? { subtitle: cardSubtitle(card) } : {}),
      })),
      metadata: cards.length < PAGE_SIZE ? { completed: true } : { page: page + 1 },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const DivineDaoLibrary = new DivineDaoLibraryExtension();
