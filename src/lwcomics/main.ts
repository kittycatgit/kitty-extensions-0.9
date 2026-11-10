/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
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
} from "@paperback/types";
import * as cheerio from "cheerio";

import type { basePbConfig } from "./config";
import { LwSearchForm } from "./forms";
import { SORTS, type LwCard, type LwFilters, type LwMetadata } from "./models";
import { LwInterceptor } from "./network";
import {
  parseCards,
  parseChapters,
  parseGenreOptions,
  parseReader,
  parseSeriesPage,
} from "./parsers";

const SESSION_TTL_MS = 20 * 60 * 1000;

const RAILS = [
  { id: "latest", title: "Latest Updates", sort: "latest" },
  { id: "popular", title: "Popular", sort: "popular" },
  { id: "most_viewed", title: "Most Viewed", sort: "most_viewed" },
  { id: "most_rated", title: "Most Rated", sort: "most_rated" },
] as const;

interface SearchSession {
  at: number;
  csrf: string;
  snapshot: string;
  genres: { id: string; title: string }[];
}

// A shared Laravel/Livewire comic platform: listings and search only exist as
// a `pages::search` component, so browsing means driving that component over
// /livewire/update rather than fetching a listing URL.
export abstract class LwComicsGeneric implements ExtensionImpl<typeof basePbConfig> {
  abstract domain: string;

  abstract name: string;

  abstract contentRating: ContentRating;

  language = "en";

  private interceptor?: LwInterceptor;

  private session?: SearchSession;

  async initialise(): Promise<void> {
    this.interceptor = this.interceptor ?? new LwInterceptor(this.name.toLowerCase(), this.domain);
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app's cookie store carries the clearance; the session is re-read on
    // the next search anyway.
    this.session = undefined;
  }

  private async getText(url: string, extra?: Partial<Request>): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET", ...extra });

    return Application.arrayBufferToUTF8String(buffer);
  }

  private async searchSession(): Promise<SearchSession> {
    if (this.session && Date.now() - this.session.at < SESSION_TTL_MS) {
      return this.session;
    }

    const html = await this.getText(`${this.domain}/search`);
    const csrf = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1];

    if (!csrf) {
      throw new Error("No csrf token on the search page");
    }

    const $ = cheerio.load(html);
    let snapshot: string | undefined;

    for (const element of $("[wire\\:snapshot]").toArray()) {
      const raw = $(element).attr("wire:snapshot") ?? "";

      if (/"name":"pages::search"/.test(raw)) {
        snapshot = raw;
        break;
      }
    }

    if (!snapshot) {
      throw new Error("No search component on the search page");
    }

    this.session = { at: Date.now(), csrf, snapshot, genres: parseGenreOptions(html) };

    return this.session;
  }

  // One Livewire round trip: the updates set the component's own properties and
  // the re-rendered html comes back in `effects`. Paging is a method call, not
  // a property: setting `paginators.page` is accepted and then ignored.
  private async livewire(
    updates: Record<string, string | number>,
    calls: { path: string; method: string; params: (string | number)[] }[] = [],
  ): Promise<string> {
    const session = await this.searchSession();

    const body = JSON.stringify({
      _token: session.csrf,
      components: [{ snapshot: session.snapshot, updates, calls }],
    });

    const [response, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/livewire/update`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/html, application/xhtml+xml",
        "x-csrf-token": session.csrf,
        "x-livewire": "true",
        referer: `${this.domain}/search`,
      },
      body,
    });

    const text = Application.arrayBufferToUTF8String(buffer);

    if (response.status === 419 || /session expired/i.test(text)) {
      // The session died; one retry with a fresh snapshot, never a silent empty
      // result.
      this.session = undefined;
      const retry = await this.searchSession();
      const [, retryBuffer] = await Application.scheduleRequest({
        url: `${this.domain}/livewire/update`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/html, application/xhtml+xml",
          "x-csrf-token": retry.csrf,
          "x-livewire": "true",
          referer: `${this.domain}/search`,
        },
        body: JSON.stringify({
          _token: retry.csrf,
          components: [{ snapshot: retry.snapshot, updates, calls }],
        }),
      });

      return this.effectsHtml(Application.arrayBufferToUTF8String(retryBuffer));
    }

    return this.effectsHtml(text);
  }

  private effectsHtml(text: string): string {
    const parsed = JSON.parse(text) as {
      components?: { snapshot?: string; effects?: { html?: string } }[];
    };
    const component = parsed.components?.[0];

    if (component?.snapshot && this.session) {
      // Keep the returned snapshot so the next page continues this listing.
      this.session.snapshot = component.snapshot;
    }

    return component?.effects?.html ?? "";
  }

  private async cards(updates: Record<string, string | number>, page: number): Promise<LwCard[]> {
    const html = await this.livewire(
      updates,
      page > 1 ? [{ path: "", method: "gotoPage", params: [page, "page"] }] : [],
    );

    return parseCards(cheerio.load(html));
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
    metadata: LwMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const cards = await this.cards({ sort: rail.sort, title: "" }, page);

    const items: DiscoverSectionItem[] = cards.map((card) =>
      section.type === DiscoverSectionType.featured
        ? {
            mangaId: card.id,
            imageUrl: card.imageUrl,
            title: card.title,
            supertitle: card.subtitle,
            type: "featuredCarouselItem" as const,
          }
        : {
            mangaId: card.id,
            imageUrl: card.imageUrl,
            title: card.title,
            subtitle: card.subtitle,
            type: "simpleCarouselItem" as const,
          },
    );

    return { items, ...(items.length > 0 ? { metadata: { page: page + 1 } } : {}) };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  // Genre ids are per-site, so callers (and the tests) read them from here.
  async searchGenres(): Promise<{ id: string; title: string }[]> {
    return (await this.searchSession()).genres;
  }

  async getAdvancedSearchForm(query: SearchQuery<LwFilters>) {
    const session = await this.searchSession();

    return new LwSearchForm(query.metadata, session.genres);
  }

  async getSearchResults(
    query: SearchQuery<LwFilters>,
    metadata: LwMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: LwFilters = { ...query.metadata, ...metadata };
    const page = metadata?.page ?? 1;

    const cards = await this.cards(
      {
        title: (query.title ?? "").trim(),
        genre: filters.genre ?? "",
        status: filters.status ?? "",
        type: filters.type ?? "",
        sort: sortingOption?.id ?? filters.sort ?? "",
      },
      page,
    );

    return {
      items: cards.map((card) => ({
        mangaId: card.id,
        imageUrl: card.imageUrl,
        title: card.title,
        subtitle: card.subtitle,
      })),
      ...(cards.length > 0 ? { metadata: { ...filters, page: page + 1 } } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await this.getText(`${this.domain}/series/${mangaId}`);
    const page = parseSeriesPage(cheerio.load(html), html);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: page.title,
        secondaryTitles: [],
        thumbnailUrl: page.imageUrl,
        synopsis: page.synopsis,
        contentRating: this.contentRating,
        shareUrl: `${this.domain}/series/${mangaId}`,
        ...(page.status ? { status: page.status } : {}),
        ...(page.author ? { author: page.author } : {}),
        ...(page.genres.length
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: page.genres.map((genre) => ({ id: genre, title: genre })),
                },
              ],
            }
          : {}),
        ...(page.type ? { additionalInfo: { Type: page.type } } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const html = await this.getText(`${this.domain}/series/${sourceManga.mangaId}`);
    const chapters = parseChapters(cheerio.load(html), sourceManga, this.language);

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await this.getText(`${this.domain}/read/${chapter.chapterId}`);
    const reader = parseReader(cheerio.load(html), html);

    if (reader.requiresLogin || reader.needsToUnlock || reader.insufficientCoins) {
      throw new Error(
        `Chapter ${chapter.chapNum.toString()} is locked on ${this.name} and has to be unlocked there.`,
      );
    }

    if (!reader.firstPage || reader.pageCount < 1) {
      throw new Error(`Chapter ${chapter.chapNum.toString()} serves no pages`);
    }

    // Pages are numbered files in one folder, so page one's url is the template
    // for the rest: its extension and media folder differ per series.
    const template = reader.firstPage.replace(/\/0*1(\.[a-z]{3,4})$/i, "/{page}$1");
    const pages: string[] = [];

    for (let index = 1; index <= reader.pageCount; index += 1) {
      pages.push(template.replace("{page}", index.toString().padStart(3, "0")));
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}
