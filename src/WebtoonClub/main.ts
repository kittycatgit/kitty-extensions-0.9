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

import { WebtoonClubSearchForm } from "./forms";
import {
  ARCHIVE_RAILS,
  DEFAULT_SORT,
  DOMAIN,
  HOME_RAILS,
  SORTING_OPTIONS,
  type WebtoonClubApiChapter,
  type WebtoonClubCard,
  type WebtoonClubHomeRails,
  type WebtoonClubRef,
  type WebtoonClubSearchMetadata,
} from "./models";
import { WebtoonClubInterceptor } from "./network";
import {
  parseChapterImages,
  parseGenres,
  parseHome,
  parseListing,
  parseSearch,
  parseSeries,
} from "./parsers";
import type pbconfigType from "./pbconfig";

const DAY = 24 * 60 * 60 * 1000;
const ADULT_GENRES = new Set(["adult", "hentai", "smut", "erotica", "mature", "ecchi"]);

let genreCache: { at: number; genres: WebtoonClubRef[] } | undefined;
let homeCache: { at: number; rails: WebtoonClubHomeRails } | undefined;

function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

class WebtoonClubExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new WebtoonClubInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getHome(): Promise<WebtoonClubHomeRails> {
    if (homeCache && Date.now() - homeCache.at < 10 * 60 * 1000) {
      return homeCache.rails;
    }
    const rails = parseHome(await this.getText(`${DOMAIN}/`));
    homeCache = { at: Date.now(), rails };
    return rails;
  }

  private async getGenres(): Promise<WebtoonClubRef[]> {
    if (genreCache && Date.now() - genreCache.at < DAY) {
      return genreCache.genres;
    }
    const genres = parseGenres(await this.getText(`${DOMAIN}/api/genres`));
    if (genres.length === 0) {
      throw new Error("The site returned an empty genre list.");
    }
    genreCache = { at: Date.now(), genres };
    return genres;
  }

  private subtitleOf(card: WebtoonClubCard): string {
    return [card.latestChapter, card.updated].filter(Boolean).join(" · ");
  }

  private ratingOf(card: WebtoonClubCard): ContentRating {
    return card.nsfw ? ContentRating.ADULT : ContentRating.MATURE;
  }

  private toSearchResult(card: WebtoonClubCard): SearchResultItem {
    const subtitle = this.subtitleOf(card);
    return {
      mangaId: card.slug,
      title: card.title,
      imageUrl: card.cover,
      contentRating: this.ratingOf(card),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = parseSeries(await this.getText(`${DOMAIN}/webtoon/${mangaId}`), mangaId);

    const tagGroups: TagSection[] = [];
    if (series.genres.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: series.genres.map((g) => ({ id: g.slug, title: g.name })),
      });
    }

    const additionalInfo: Record<string, string> = {};
    for (const key of ["Type", "Origin", "Released", "Chapters", "Updated"]) {
      if (series.details[key]) additionalInfo[key] = series.details[key];
    }
    if (series.ratingCount) additionalInfo["Ratings"] = withCommas(series.ratingCount);

    const status = series.details["Status"];
    const adultGenre = series.genres.some((g) => ADULT_GENRES.has(g.slug));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: series.altTitles,
        thumbnailUrl: series.cover,
        synopsis: series.synopsis,
        contentRating: series.nsfw || adultGenre ? ContentRating.ADULT : ContentRating.MATURE,
        shareUrl: `${DOMAIN}/webtoon/${mangaId}`,
        ...(status ? { status } : {}),
        ...(series.authors.length ? { author: series.authors.join(", ") } : {}),
        ...(series.ratingAvg ? { rating: series.ratingAvg / 5 } : {}),
        // Everything on the site is a vertical strip, whatever the Type row says.
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = parseSeries(
      await this.getText(`${DOMAIN}/webtoon/${sourceManga.mangaId}`),
      sourceManga.mangaId,
    );
    const body = await this.getText(`${DOMAIN}/api/comics/${series.comicId}/chapters`);
    const rows = (JSON.parse(body) as { chapters?: WebtoonClubApiChapter[] }).chapters ?? [];
    if (rows.length === 0) {
      throw new Error(`No chapters were returned for ${sourceManga.mangaId}.`);
    }

    const chapters: Chapter[] = [];
    for (const row of rows) {
      const chapterId = row.slug?.trim();
      if (!chapterId || /\s/.test(chapterId)) continue;
      const chapNum = Number(row.chapterNumber);
      const title = row.title?.trim();
      const published = row.date ? new Date(row.date) : undefined;
      chapters.push({
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum: isNaN(chapNum) ? 0 : chapNum,
        ...(title && !/^ch(apter)?\.?\s*[\d.]*$/i.test(title) ? { title } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const html = await this.getText(`${DOMAIN}/webtoon/${mangaId}/${chapter.chapterId}`);
    return { id: chapter.chapterId, mangaId, pages: parseChapterImages(html) };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<WebtoonClubSearchForm> {
    return new WebtoonClubSearchForm(
      query.metadata as WebtoonClubSearchMetadata | undefined,
      this.getGenres(),
    );
  }

  // The runtime has no URLSearchParams.
  private query(params: [string, string][]): string {
    return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  }

  private archiveUrl(filters: WebtoonClubSearchMetadata, page: number, sort: string): string {
    const params: [string, string][] = [["sort", sort]];
    if (page > 1) params.push(["page", String(page)]);
    if (filters.status) params.push(["status", filters.status]);
    if (filters.type) params.push(["type", filters.type]);
    if (filters.genre) params.push(["genre", filters.genre]);
    return `${DOMAIN}/webtoons?${this.query(params)}`;
  }

  // The search page only sorts by popularity or age; anything else is its
  // "best match" default.
  private searchUrl(title: string, page: number, sort: string): string {
    const params: [string, string][] = [["q", title]];
    if (sort === "popular" || sort === "newest") params.push(["sort", sort]);
    if (page > 1) params.push(["page", String(page)]);
    return `${DOMAIN}/search?${this.query(params)}`;
  }

  // Search rows carry type and status, so those two filters the search page
  // lacks are applied to its rows here. Rows show only a few genres, so a
  // genre cannot be checked the same way.
  private matchesFilters(card: WebtoonClubCard, filters: WebtoonClubSearchMetadata): boolean {
    if (filters.type && card.type !== filters.type) return false;
    if (filters.status && card.status !== filters.status) return false;
    return true;
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as WebtoonClubSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = { ...(query.metadata as WebtoonClubSearchMetadata | undefined), ...paging };
    const page = paging?.page ?? 1;
    const title = (query.title ?? "").trim();
    const sort = sortingOption?.id ?? DEFAULT_SORT;

    if (!title) {
      const listing = parseListing(await this.getText(this.archiveUrl(filters, page, sort)));
      return {
        items: listing.cards.map((card) => this.toSearchResult(card)),
        metadata: listing.hasNext ? { ...filters, page: page + 1 } : { completed: true },
      };
    }

    if (filters.genre) {
      throw new Error("The site cannot search a title within a genre; clear one of the two.");
    }

    const listing = parseSearch(await this.getText(this.searchUrl(title, page, sort)));
    return {
      items: listing.cards
        .filter((card) => this.matchesFilters(card, filters))
        .map((card) => this.toSearchResult(card)),
      metadata: listing.hasNext ? { ...filters, page: page + 1 } : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const sections: DiscoverSection[] = HOME_RAILS.map((rail) => ({
      id: `home-${rail.key}`,
      title: rail.title,
      type:
        rail.key === "featured" ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
    for (const rail of ARCHIVE_RAILS) {
      sections.push({ id: rail.id, title: rail.title, type: DiscoverSectionType.simpleCarousel });
    }
    sections.push({ id: "genres", title: "Genres", type: DiscoverSectionType.genres });
    return sections;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const genres = await this.getGenres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.name,
          searchQuery: {
            title: "",
            metadata: { genre: genre.slug } satisfies WebtoonClubSearchMetadata,
          },
        })),
      };
    }

    const paging = metadata as WebtoonClubSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }
    const page = paging?.page ?? 1;

    const archive = ARCHIVE_RAILS.find((rail) => rail.id === section.id);
    if (archive) {
      const listing = parseListing(
        await this.getText(
          this.archiveUrl(archive.status ? { status: archive.status } : {}, page, archive.sort),
        ),
      );
      return {
        items: listing.cards.map((card) => this.toCarouselItem(card)),
        metadata: listing.hasNext ? { page: page + 1 } : { completed: true },
      };
    }

    const key = section.id.replace(/^home-/, "") as keyof WebtoonClubHomeRails;
    const cards = (await this.getHome())[key];
    if (!cards) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    return {
      items: cards.map((card) => {
        if (key === "featured") {
          const featured = card as WebtoonClubHomeRails["featured"][number];
          return {
            type: "featuredCarouselItem" as const,
            mangaId: card.slug,
            imageUrl: card.cover,
            title: card.title,
            contentRating: this.ratingOf(card),
            ...(featured.summary ? { summary: featured.summary } : {}),
            ...(featured.rating ? { supertitle: `★ ${featured.rating}` } : {}),
          };
        }
        return this.toCarouselItem(card);
      }),
      metadata: { completed: true },
    };
  }

  private toCarouselItem(card: WebtoonClubCard): DiscoverSectionItem {
    const subtitle = this.subtitleOf(card);
    return {
      type: "simpleCarouselItem" as const,
      mangaId: card.slug,
      imageUrl: card.cover,
      title: card.title,
      contentRating: this.ratingOf(card),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const WebtoonClub = new WebtoonClubExtension();
