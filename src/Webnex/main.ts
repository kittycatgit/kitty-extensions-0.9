/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
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

import { WebnexSearchForm } from "./forms";
import {
  browseUrl,
  CHAPTERS_PER_PAGE,
  DOMAIN,
  homeUrl,
  pagesUrl,
  readUrl,
  ROWS,
  SEEN_LIMIT,
  seriesUrl,
  SORTS,
  TAXONOMY_ACTION,
  type Row,
  type WebnexMetadata,
} from "./models";
import { WebnexInterceptor } from "./network";
import {
  catalogError,
  homeSection,
  nameOf,
  parseCards,
  parseChapterRows,
  parseGenreCloud,
  parsePages,
  parseSeries,
  parseTaxonomy,
  type Card,
  type Taxonomy,
} from "./parsers";
import pbconfig from "./pbconfig";

const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;
const TAXONOMY_LIMIT = 150;
const CHAPTER_PAGE_BATCH = 4;

// The full list is a few hundred KB, far past what setState accepts.
let taxonomyCache: { at: number; taxonomy: Taxonomy } | undefined;

class WebnexExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new WebnexInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app's own cookie store keeps the bypass cookies; nothing to hold here.
  }

  private async document(url: string): Promise<cheerio.CheerioAPI> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.document(seriesUrl(mangaId)), mangaId);
  }

  // Fifty rows per page; past the end the site repeats the last page.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const first = parseChapterRows(await this.document(seriesUrl(mangaId)));
    const rows = new Map(first.rows.map((row) => [row.chapterId, row]));
    const pages = Math.ceil(first.total / CHAPTERS_PER_PAGE);

    for (let page = 2; page <= pages; page += CHAPTER_PAGE_BATCH) {
      const batch = [];

      for (let offset = 0; offset < CHAPTER_PAGE_BATCH && page + offset <= pages; offset++) {
        batch.push(this.document(seriesUrl(mangaId, page + offset)));
      }

      const before = rows.size;

      for (const $ of await Promise.all(batch)) {
        for (const row of parseChapterRows($).rows) {
          if (!rows.has(row.chapterId)) {
            rows.set(row.chapterId, row);
          }
        }
      }

      if (rows.size === before) {
        break;
      }
    }

    if (rows.size === 0) {
      throw new Error(`No chapters were listed for ${mangaId}.`);
    }

    const sorted = [...rows.values()].sort((left, right) => right.number - left.number);

    return sorted.map((row, index) => ({
      chapterId: row.chapterId,
      sourceManga,
      langCode: "en",
      chapNum: row.number,
      sortingIndex: sorted.length - index,
      ...(row.title ? { title: row.title } : {}),
      ...(row.group ? { version: row.group } : {}),
      ...(row.published ? { publishDate: row.published } : {}),
    }));
  }

  // The pages endpoint only answers a request carrying the reader cookie the
  // chapter page sets, with that chapter page as referer.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterId = chapter.chapterId;
    // The reader cookie is only issued to what looks like a page navigation.
    const [response] = await Application.scheduleRequest({
      url: readUrl(chapterId),
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "sec-fetch-site": "none",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
      },
    });
    const cookie = Object.entries(response.headers ?? {})
      .filter(([name]) => name.toLowerCase() === "set-cookie")
      .map(([, value]) => /wnx_reader=([^;,\s]+)/.exec(value)?.[1])
      .find(Boolean);

    if (!cookie) {
      throw new Error(
        `webnex.cc issued no reader cookie for ${chapterId}; the chapter may be gone.`,
      );
    }

    const [, buffer] = await Application.scheduleRequest({
      url: pagesUrl(chapterId),
      method: "GET",
      // The gate wants the whole same-origin fetch signature once any
      // Sec-Fetch header is present, and the test harness always sends one.
      headers: {
        referer: readUrl(chapterId),
        accept: "application/json",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
      cookies: { wnx_reader: cookie },
    });
    const { pages, message } = parsePages(Application.arrayBufferToUTF8String(buffer));

    if (pages.length === 0) {
      throw new Error(message ?? `No pages were listed for ${chapterId}.`);
    }

    return { id: chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.label }));
  }

  // The site hides erotica and 18+ by default; lift the ceiling unless the app
  // itself is set to hide adult titles.
  private defaultRating(): string {
    return Application.filterAdultTitles ? "suggestive" : "pornographic";
  }

  private browseQuery(
    title: string,
    filters: WebnexMetadata,
    sort: string | undefined,
    page: number,
  ): string {
    const params: string[] = [];
    const add = (key: string, value: string | undefined): void => {
      if (value) {
        params.push(`${key}=${encodeURIComponent(value)}`);
      }
    };

    add("q", title);
    filters.kinds?.forEach((kind) => add("kind", kind));
    filters.statuses?.forEach((status) => add("status", status));
    filters.demographics?.forEach((demographic) => add("demographic", demographic));
    filters.languages?.forEach((language) => add("language", language));
    add("rating", filters.rating ?? this.defaultRating());

    for (const [key, prefix] of [
      ["genres", "genre"],
      ["tags", "tag"],
    ] as const) {
      for (const [id, mode] of Object.entries(filters[key] ?? {})) {
        add(mode === "excluded" ? `x${prefix}` : prefix, nameOf(id));
      }
    }

    if (filters.matchAny) {
      add("match", "any");
    }

    add("from", filters.from);
    add("to", filters.to);
    add("chapters", filters.chapters);
    add("author", filters.author);
    add("artist", filters.artist);

    if (sort && sort !== SORTS[0]!.id) {
      add("sort", sort);
    }

    if (page > 1) {
      add("page", String(page));
    }

    return params.join("&");
  }

  private async browse(query: string): Promise<Card[]> {
    const $ = await this.document(browseUrl(query));
    const failure = catalogError($);

    if (failure) {
      throw new Error(`webnex.cc could not list the catalog: ${failure}`);
    }

    return parseCards($, $("section.browse"));
  }

  async getSearchResults(
    query: SearchQuery<WebnexMetadata>,
    metadata: WebnexMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const filters = { ...(query.metadata as WebnexMetadata | undefined), ...metadata };
    const found = await this.browse(
      this.browseQuery((query.title ?? "").trim(), filters, sortingOption?.id, page),
    );

    return this.paged(found, page, filters);
  }

  private async taxonomy(): Promise<Taxonomy | undefined> {
    if (taxonomyCache && Date.now() - taxonomyCache.at < TAXONOMY_TTL_MS) {
      return taxonomyCache.taxonomy;
    }

    try {
      const [, buffer] = await Application.scheduleRequest({
        url: browseUrl(),
        method: "POST",
        headers: {
          "next-action": TAXONOMY_ACTION,
          accept: "text/x-component",
          "content-type": "text/plain;charset=UTF-8",
        },
        body: "[]",
      });
      const taxonomy = parseTaxonomy(Application.arrayBufferToUTF8String(buffer), TAXONOMY_LIMIT);
      taxonomyCache = { at: Date.now(), taxonomy };

      return taxonomy;
    } catch {
      return taxonomyCache?.taxonomy;
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<WebnexMetadata>): Promise<WebnexSearchForm> {
    return new WebnexSearchForm(
      query.metadata as WebnexMetadata | undefined,
      await this.taxonomy(),
      this.defaultRating(),
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return ROWS.map((row) => ({ id: row.id, title: row.title, type: row.type }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: WebnexMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const row = ROWS.find((entry) => entry.id === section.id);

    if (!row) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;

    if (row.source.kind === "browse") {
      const query = [
        row.source.query,
        `rating=${this.defaultRating()}`,
        page > 1 ? `page=${page}` : "",
      ]
        .filter(Boolean)
        .join("&");
      const results = this.paged(await this.browse(query), page, metadata);

      return {
        items: results.items.map((item) => this.item(row, item)),
        metadata: results.metadata,
      };
    }

    if (row.type === DiscoverSectionType.genres) {
      return {
        items: parseGenreCloud(await this.document(homeUrl())).map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genres: { [genre.id]: "included" } } },
        })),
      };
    }

    // Only the latest grid pages; the other home rails are one shelf each.
    const paged = row.id === "latest";
    const $ = await this.document(homeUrl(paged && page > 1 ? `latest=${page}` : ""));
    const cards = parseCards($, homeSection($, row.source.heading));

    if (!paged) {
      return { items: cards.map((item) => this.item(row, item)), metadata: { completed: true } };
    }

    const results = this.paged(cards, page, metadata);

    return { items: results.items.map((item) => this.item(row, item)), metadata: results.metadata };
  }

  private item(row: Row, card: Card): DiscoverSectionItem {
    const base = { mangaId: card.mangaId, imageUrl: card.imageUrl, title: card.title };

    switch (row.type) {
      case DiscoverSectionType.featured:
        return {
          type: "featuredCarouselItem",
          ...base,
          ...(card.rank ? { supertitle: `#${card.rank}` } : {}),
        };
      case DiscoverSectionType.prominentCarousel:
        return {
          type: "prominentCarouselItem",
          ...base,
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        };
      case DiscoverSectionType.chapterUpdates:
        return {
          type: "chapterUpdatesCarouselItem",
          ...base,
          chapterId: card.chapterId ?? "",
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        };
      default:
        return {
          type: "simpleCarouselItem",
          ...base,
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        };
    }
  }

  // Past the last page the site serves the last one again, so an all-seen
  // page ends the row.
  private paged(
    found: Card[],
    page: number,
    metadata: WebnexMetadata | undefined,
  ): PagedResults<SearchResultItem> {
    const seen = new Set(metadata?.seen ?? []);
    const fresh = found.filter((item) => !seen.has(item.mangaId));

    if (fresh.length === 0) {
      return { items: [], metadata: { completed: true } };
    }

    for (const item of found) {
      seen.add(item.mangaId);
    }

    return {
      items: fresh,
      metadata: { ...metadata, page: page + 1, seen: [...seen].slice(-SEEN_LIMIT) },
    };
  }
}

export const Webnex = new WebnexExtension();

export { DOMAIN };
