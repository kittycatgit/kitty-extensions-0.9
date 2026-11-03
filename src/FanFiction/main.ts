/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  BasicRateLimiter,
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
import { FanFictionSearchForm } from "./forms";
import {
  CATEGORIES,
  DOMAIN,
  JUST_IN_SECTIONS,
  SEARCH_LENGTHS,
  SEARCH_RATINGS,
  SEARCH_SORTS,
  SORTING_OPTIONS,
  type Fandom,
  type FanFictionMetadata,
  type StoryCard,
  type StoryMeta,
} from "./models";
import { FanFictionInterceptor } from "./network";
import { hasNextPage, parseCards, parseChapterText, parseFandoms, parseStory } from "./parsers";
import type pbconfigType from "./pbconfig";

const FANDOMS_PER_RAIL = 60;
const FANDOM_CACHE_TTL = 24 * 60 * 60 * 1000;

// Category pages are ~300 KB each, so keep them out of setState.
const fandomCache = new Map<string, { at: number; fandoms: Fandom[] }>();

class FanFictionExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new FanFictionInterceptor("main", DOMAIN);

  private readonly rateLimiter = new BasicRateLimiter("rate", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getFandoms(category: string): Promise<Fandom[]> {
    const cached = fandomCache.get(category);
    if (cached && Date.now() - cached.at < FANDOM_CACHE_TTL) {
      return cached.fandoms;
    }

    const fandoms = parseFandoms(await this.getText(`${DOMAIN}/${category}/`)).slice(
      0,
      FANDOMS_PER_RAIL,
    );
    if (fandoms.length === 0) {
      throw new Error(`No fandoms were found for ${category}.`);
    }

    fandomCache.set(category, { at: Date.now(), fandoms });
    return fandoms;
  }

  private toSearchResult(card: StoryCard): SearchResultItem {
    return {
      mangaId: card.id,
      title: card.title,
      imageUrl: card.cover,
      subtitle: subtitleOf(card.meta),
      contentRating: ratingOf(card.meta),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const story = parseStory(await this.getText(`${DOMAIN}/s/${mangaId}/1/`), mangaId);
    const meta = story.meta;

    const tagGroups: TagSection[] = [];
    const fandom = story.fandom ?? meta.fandom;
    if (fandom) {
      tagGroups.push({
        id: "fandom",
        title: "Fandom",
        tags: [{ id: `fandom-${slugOf(fandom)}`, title: fandom }],
      });
    }
    if (meta.genres.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: meta.genres.map((genre) => ({ id: `genre-${slugOf(genre)}`, title: genre })),
      });
    }
    if (meta.characters.length) {
      tagGroups.push({
        id: "characters",
        title: "Characters",
        tags: meta.characters.map((name) => ({ id: `char-${slugOf(name)}`, title: name })),
      });
    }
    if (meta.rated) {
      tagGroups.push({
        id: "rating",
        title: "Rating",
        tags: [{ id: `rated-${slugOf(meta.rated)}`, title: `Rated ${meta.rated}` }],
      });
    }
    if (meta.language) {
      tagGroups.push({
        id: "language",
        title: "Language",
        tags: [{ id: `lang-${slugOf(meta.language)}`, title: meta.language }],
      });
    }

    const additionalInfo: Record<string, string> = {};
    if (fandom) additionalInfo["Fandom"] = fandom;
    if (story.category) additionalInfo["Category"] = story.category;
    additionalInfo["Chapters"] = String(story.chapters.length);
    if (meta.words !== undefined) additionalInfo["Words"] = withCommas(meta.words);
    if (meta.reviews !== undefined) additionalInfo["Reviews"] = withCommas(meta.reviews);
    if (meta.favs !== undefined) additionalInfo["Favs"] = withCommas(meta.favs);
    if (meta.follows !== undefined) additionalInfo["Follows"] = withCommas(meta.follows);
    if (meta.published) additionalInfo["Published"] = formatDate(meta.published);
    if (meta.updated) additionalInfo["Updated"] = formatDate(meta.updated);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: story.title,
        secondaryTitles: [],
        thumbnailUrl: story.cover,
        synopsis: story.summary,
        contentRating: ratingOf(meta),
        contentType: "novel",
        status: meta.complete ? "Completed" : "Ongoing",
        shareUrl: `${DOMAIN}/s/${mangaId}/1/`,
        ...(story.author ? { author: story.author } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        additionalInfo,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const story = parseStory(
      await this.getText(`${DOMAIN}/s/${sourceManga.mangaId}/1/`),
      sourceManga.mangaId,
    );
    const last = story.chapters.length;

    // The site only dates the story, not its chapters.
    const chapters = story.chapters.map((entry): Chapter => {
      const epoch =
        entry.number === last && story.meta.updated
          ? story.meta.updated
          : entry.number === 1
            ? story.meta.published
            : undefined;

      return {
        chapterId: String(entry.number),
        sourceManga,
        langCode: langCodeOf(story.meta.language),
        chapNum: entry.number,
        title: entry.title,
        ...(epoch ? { publishDate: new Date(epoch * 1000) } : {}),
      };
    });

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const page = parseChapterText(
      await this.getText(`${DOMAIN}/s/${mangaId}/${chapter.chapterId}/`),
    );

    return {
      id: chapter.chapterId,
      mangaId,
      type: "html",
      html: toXhtmlDocument(page.body, page.title ?? chapter.title),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<FanFictionSearchForm> {
    return new FanFictionSearchForm(query.metadata as FanFictionMetadata | undefined);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as FanFictionMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters: FanFictionMetadata = {
      ...(query.metadata as FanFictionMetadata | undefined),
      ...paging,
    };
    const page = filters.page ?? 1;
    const title = (query.title ?? "").trim();

    let html: string;
    if (filters.fandom) {
      html = await this.getText(
        listingUrl(filters.fandom, filters, sortingOption?.id ?? "1", page),
      );
    } else if (title) {
      // Keyword search defaults to relevance until a sort is picked.
      html = await this.getText(searchUrl(title, filters, sortingOption?.id ?? "", page));
    } else {
      html = await this.getText(`${DOMAIN}/j/0/0/${filters.language ?? "0"}/`);
    }

    const cards = parseCards(html);
    const more = cards.length > 0 && hasNextPage(html) && !!(filters.fandom || title);
    const { page: _page, completed: _completed, ...rest } = filters;
    const next: FanFictionMetadata = more ? { ...rest, page: page + 1 } : { completed: true };

    return { items: cards.map((card) => this.toSearchResult(card)), metadata: next };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...JUST_IN_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      ...CATEGORIES.map((category) => ({
        id: `category-${category.id}`,
        title: `${category.title} fandoms`,
        type: DiscoverSectionType.genres,
      })),
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const category = CATEGORIES.find((entry) => `category-${entry.id}` === section.id);
    if (category) {
      const fandoms = await this.getFandoms(category.id);
      return {
        items: fandoms.map((fandom) => ({
          type: "genresCarouselItem" as const,
          name: fandom.count ? `${fandom.name} (${fandom.count})` : fandom.name,
          searchQuery: {
            title: "",
            metadata: { fandom: fandom.path } satisfies FanFictionMetadata,
          },
        })),
        metadata: { completed: true },
      };
    }

    const feed = JUST_IN_SECTIONS.find((entry) => entry.id === section.id);
    if (!feed) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    // The feed is a fixed 100 cards with no pagination.
    const cards = parseCards(await this.getText(`${DOMAIN}/j/0/${feed.sortId}/0/`));
    return {
      items: cards.map((card) => ({
        type: "simpleCarouselItem" as const,
        mangaId: card.id,
        imageUrl: card.cover,
        title: card.title,
        subtitle: subtitleOf(card.meta),
        contentRating: ratingOf(card.meta),
      })),
      metadata: { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

function listingUrl(
  fandom: string,
  filters: FanFictionMetadata,
  sort: string,
  page: number,
): string {
  const params: Record<string, string | undefined> = {
    srt: sort,
    r: filters.rating ?? "10",
    lan: filters.language,
    len: filters.length,
    s: filters.status,
    t: filters.time,
    g1: filters.genre1,
    g2: filters.genre2,
    _g1: filters.excludeGenre,
    p: page > 1 ? String(page) : undefined,
  };
  return `${DOMAIN}/${fandom}/?${encode(params)}`;
}

function searchUrl(
  keywords: string,
  filters: FanFictionMetadata,
  sort: string,
  page: number,
): string {
  const params: Record<string, string | undefined> = {
    ready: "1",
    keywords,
    type: "story",
    sort: SEARCH_SORTS[sort],
    match: filters.match,
    censorid: filters.rating ? (SEARCH_RATINGS[filters.rating] ?? filters.rating) : undefined,
    languageid: filters.language,
    statusid: filters.status,
    words: filters.length ? SEARCH_LENGTHS[filters.length] : undefined,
    genreid1: filters.genre1,
    genreid2: filters.genre2,
    ppage: page > 1 ? String(page) : undefined,
  };
  return `${DOMAIN}/search/?${encode(params)}`;
}

function encode(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => !!entry[1] && entry[1] !== "0")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

function ratingOf(meta: StoryMeta): ContentRating {
  return meta.rated === "M" ? ContentRating.MATURE : ContentRating.EVERYONE;
}

function subtitleOf(meta: StoryMeta): string {
  const parts = [`${meta.chapters} ch`];
  if (meta.words !== undefined) {
    parts.push(`${compact(meta.words)} words`);
  }
  const epoch = meta.updated ?? meta.published;
  if (epoch) {
    parts.push(`${meta.updated ? "Updated" : "Published"} ${formatDate(epoch)}`);
  }
  if (meta.complete) {
    parts.push("Complete");
  }
  return parts.join(" · ");
}

function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function compact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return String(value);
}

function formatDate(epoch: number): string {
  const date = new Date(epoch * 1000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function slugOf(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

const LANG_CODES: Record<string, string> = {
  English: "en",
  Español: "es",
  Spanish: "es",
  Français: "fr",
  French: "fr",
  Deutsch: "de",
  German: "de",
  中文: "zh",
  Chinese: "zh",
  日本語: "ja",
  Japanese: "ja",
  Nederlands: "nl",
  Dutch: "nl",
  Português: "pt",
  Portuguese: "pt",
  Русский: "ru",
  Russian: "ru",
  Italiano: "it",
  Italian: "it",
  Polski: "pl",
  Polish: "pl",
  Indonesian: "id",
  "Bahasa Indonesia": "id",
  한국어: "ko",
  Korean: "ko",
};

function langCodeOf(language: string | undefined): string {
  return (language && LANG_CODES[language]) || "en";
}

export const FanFiction = new FanFictionExtension();
