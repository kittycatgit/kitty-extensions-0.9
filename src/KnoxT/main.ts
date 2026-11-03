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
import * as cheerio from "cheerio";

import { toXhtmlDocument } from "../novel/xhtml";
import { KnoxTSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  DOMAIN,
  GENRES_SECTION_ID,
  HOME_SECTIONS,
  LISTING_SECTIONS,
  SORTING_OPTIONS,
  type Card,
  type KnoxTMetadata,
  type PopularRange,
  type Vocab,
} from "./models";
import { KnoxTInterceptor } from "./network";
import {
  hasNextListingPage,
  hasNextSearchPage,
  parseChapterBody,
  parseEditorsChoice,
  parseListing,
  parsePopular,
  parseSeries,
  parseSmallCards,
  parseTrending,
  parseVocab,
  seriesUrl,
} from "./parsers";
import type pbconfigType from "./pbconfig";

const HOME_TTL = 5 * 60 * 1000;
const VOCAB_TTL = 24 * 60 * 60 * 1000;

// Six rails read the same 200 KB home page, so it is fetched once per visit.
let homeCache: { at: number; html: string } | undefined;
let vocabCache: { at: number; vocab: Vocab } | undefined;

class KnoxTExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new KnoxTInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async document(url: string): Promise<cheerio.CheerioAPI> {
    return cheerio.load(await this.getText(url));
  }

  private async home(): Promise<cheerio.CheerioAPI> {
    if (!homeCache || Date.now() - homeCache.at > HOME_TTL) {
      homeCache = { at: Date.now(), html: await this.getText(`${DOMAIN}/`) };
    }
    return cheerio.load(homeCache.html);
  }

  private async vocab(): Promise<Vocab> {
    if (!vocabCache || Date.now() - vocabCache.at > VOCAB_TTL) {
      vocabCache = { at: Date.now(), vocab: parseVocab(await this.document(`${DOMAIN}/series/`)) };
    }
    return vocabCache.vocab;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = parseSeries(await this.document(seriesUrl(mangaId)));

    const tagGroups: TagSection[] = [];
    if (series.genres.length) {
      tagGroups.push({ id: "genres", title: "Genres", tags: series.genres });
    }
    if (series.tags.length) {
      tagGroups.push({ id: "tags", title: "Tags", tags: series.tags });
    }

    const additionalInfo: Record<string, string> = {};
    if (series.types.length) additionalInfo["Type"] = series.types.join(", ");
    if (series.released) additionalInfo["Released"] = series.released;
    if (series.language) additionalInfo["Native language"] = series.language;
    if (series.followers) additionalInfo["Followers"] = series.followers;
    additionalInfo["Chapters"] = String(series.chapters.length);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: series.altTitles,
        thumbnailUrl: series.cover,
        synopsis: series.synopsis,
        contentRating: series.mature ? ContentRating.ADULT : ContentRating.MATURE,
        contentType: "novel",
        status: series.status ?? "Unknown",
        shareUrl: seriesUrl(mangaId),
        ...(series.authors.length ? { author: series.authors.join(", ") } : {}),
        ...(series.artists.length ? { artist: series.artists.join(", ") } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        additionalInfo,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = parseSeries(await this.document(seriesUrl(sourceManga.mangaId)));
    const total = series.chapters.length;

    // The list is newest first; extras carry no number, so order is kept by index.
    return series.chapters.map((row, index) => ({
      chapterId: row.id,
      sourceManga,
      langCode: "en",
      chapNum: row.number,
      sortingIndex: total - index,
      ...(row.number === 0 && row.label
        ? { title: [row.label, row.title].filter(Boolean).join(" ") }
        : row.title
          ? { title: row.title }
          : {}),
      ...(row.date ? { publishDate: row.date } : {}),
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const page = parseChapterBody(await this.document(`${DOMAIN}/${chapter.chapterId}/`));

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: toXhtmlDocument(page.body, chapter.title ?? page.title),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<KnoxTSearchForm> {
    return new KnoxTSearchForm(query.metadata as KnoxTMetadata | undefined, this.vocab());
  }

  private toSearchResult(card: Card): SearchResultItem {
    return {
      mangaId: card.id,
      title: card.title,
      imageUrl: card.cover,
      ...(card.subtitle ? { subtitle: card.subtitle } : {}),
    };
  }

  // `/series/` reads `?page=N`; the keyword search only honours `/page/N/`.
  private listingUrl(query: string, page: number): string {
    return `${DOMAIN}/series/?${query}${page > 1 ? `&page=${page}` : ""}`;
  }

  private searchUrl(title: string, page: number): string {
    const prefix = page > 1 ? `${DOMAIN}/page/${page}/` : `${DOMAIN}/`;
    return `${prefix}?s=${encodeURIComponent(title)}`;
  }

  private filterQuery(filters: KnoxTMetadata, sort: string): string {
    const parts: string[] = [];
    for (const genre of filters.genres ?? [])
      parts.push(`genre%5B%5D=${encodeURIComponent(genre)}`);
    for (const type of filters.types ?? []) parts.push(`type%5B%5D=${encodeURIComponent(type)}`);
    if (filters.status) parts.push(`status=${encodeURIComponent(filters.status)}`);
    parts.push(`order=${encodeURIComponent(sort)}`);
    return parts.join("&");
  }

  private async listingPage(
    query: string,
    page: number,
    carry: KnoxTMetadata,
  ): Promise<PagedResults<SearchResultItem>> {
    const $ = await this.document(this.listingUrl(query, page));
    const cards = parseListing($);
    const more = cards.length > 0 && hasNextListingPage($);

    return {
      items: cards.map((card) => this.toSearchResult(card)),
      metadata: more ? { ...carry, page: page + 1 } : { completed: true },
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as KnoxTMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters: KnoxTMetadata = { ...(query.metadata as KnoxTMetadata | undefined), ...paging };
    const page = filters.page ?? 1;
    const title = (query.title ?? "").trim();
    const { page: _page, completed: _completed, ...carry } = filters;

    if (title) {
      const $ = await this.document(this.searchUrl(title, page));
      const cards = parseListing($);
      const more = cards.length > 0 && hasNextSearchPage($);

      return {
        items: cards.map((card) => this.toSearchResult(card)),
        metadata: more ? { ...carry, page: page + 1 } : { completed: true },
      };
    }

    return await this.listingPage(
      this.filterQuery(carry, sortingOption?.id ?? DEFAULT_SORT),
      page,
      carry,
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const simple = DiscoverSectionType.simpleCarousel;
    return [
      {
        id: HOME_SECTIONS.editorsChoice,
        title: "Editor's Choice",
        type: DiscoverSectionType.featured,
      },
      { id: HOME_SECTIONS.trending, title: "Trending This Week", type: simple },
      { id: LISTING_SECTIONS[0]!.id, title: LISTING_SECTIONS[0]!.title, type: simple },
      { id: HOME_SECTIONS.recommendation, title: "Recommendation", type: simple },
      { id: HOME_SECTIONS.popularWeekly, title: "Popular This Week", type: simple },
      { id: HOME_SECTIONS.popularMonthly, title: "Popular This Month", type: simple },
      { id: HOME_SECTIONS.popularAlltime, title: "Popular All Time", type: simple },
      ...LISTING_SECTIONS.slice(1).map((section) => ({
        id: section.id,
        title: section.title,
        type: simple,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  private toSectionItem(card: Card, featured: boolean): DiscoverSectionItem {
    if (featured) {
      return {
        type: "featuredCarouselItem",
        mangaId: card.id,
        imageUrl: card.cover,
        title: card.title,
        ...(card.subtitle ? { supertitle: card.subtitle } : {}),
        ...(card.summary ? { summary: card.summary } : {}),
      };
    }

    return {
      type: "simpleCarouselItem",
      mangaId: card.id,
      imageUrl: card.cover,
      title: card.title,
      ...(card.subtitle ? { subtitle: card.subtitle } : {}),
    };
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as KnoxTMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    if (section.id === GENRES_SECTION_ID) {
      const { genres } = await this.vocab();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genres: [genre.id] } satisfies KnoxTMetadata },
        })),
        metadata: { completed: true },
      };
    }

    const listing = LISTING_SECTIONS.find((entry) => entry.id === section.id);
    if (listing) {
      const page = paging?.page ?? 1;
      const results = await this.listingPage(listing.query, page, {});
      return {
        items: results.items.map((item) => ({
          type: "simpleCarouselItem" as const,
          mangaId: item.mangaId,
          imageUrl: item.imageUrl,
          title: item.title,
          ...(item.subtitle ? { subtitle: item.subtitle } : {}),
        })),
        metadata: results.metadata,
      };
    }

    const $ = await this.home();
    let cards: Card[];
    switch (section.id) {
      case HOME_SECTIONS.editorsChoice:
        cards = parseEditorsChoice($);
        break;
      case HOME_SECTIONS.trending:
        cards = parseTrending($);
        break;
      case HOME_SECTIONS.recommendation:
        // One pick per genre tab; the tabs' genres hold a single series each.
        cards = parseSmallCards($, "div.series-gen div.tab-pane");
        break;
      case HOME_SECTIONS.popularWeekly:
      case HOME_SECTIONS.popularMonthly:
      case HOME_SECTIONS.popularAlltime:
        cards = parsePopular($, section.id.replace("popular-", "") as PopularRange);
        break;
      default:
        throw new Error(`Unknown discover section ${section.id}`);
    }

    if (cards.length === 0) {
      throw new Error(`No titles were found for ${section.title}.`);
    }

    return {
      items: cards.map((card) =>
        this.toSectionItem(card, section.id === HOME_SECTIONS.editorsChoice),
      ),
      metadata: { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const KnoxT = new KnoxTExtension();
