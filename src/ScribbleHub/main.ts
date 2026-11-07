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

import { ScribbleHubSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  DOMAIN,
  FALLBACK_GENRES,
  FALLBACK_WARNINGS,
  HOME_SECTIONS,
  SORTING_OPTIONS,
  VOCAB_STATE_KEY,
  VOCAB_TTL,
  type ChapterRow,
  type SearchMetadata,
  type TriState,
  type Vocab,
} from "./models";
import { ScribbleHubInterceptor } from "./network";
import {
  hasNextPage,
  parseChapterBody,
  parseChapterRows,
  parseLatestUpdates,
  parseListing,
  parseSeries,
  parseVocab,
} from "./parsers";
import type pbconfigType from "./pbconfig";

type PageMetadata = { page: number };

const ADULT_MARKERS = /adult|smut|mature|sexual/i;

class ScribbleHubExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new ScribbleHubInterceptor("main", DOMAIN);

  private vocabCache?: Vocab;

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async request(request: Request): Promise<string> {
    const [, buffer] = await Application.scheduleRequest(request);
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async document(url: string): Promise<cheerio.CheerioAPI> {
    return cheerio.load(await this.request({ url, method: "GET" }));
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: HOME_SECTIONS.trending, title: "Trending", type: DiscoverSectionType.featured },
      {
        id: HOME_SECTIONS.latest,
        title: "Latest Series",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: HOME_SECTIONS.updates,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as PageMetadata | undefined)?.page ?? 1;

    // Each home rail's "View More" link is the paginated version of that rail.
    let url: string;
    switch (section.id) {
      case HOME_SECTIONS.trending:
        url = `${DOMAIN}/series-ranking/?sort=5&order=1&pg=${page}`;
        break;
      case HOME_SECTIONS.latest:
        url = `${DOMAIN}/latest-series/?pg=${page}`;
        break;
      case HOME_SECTIONS.updates:
        url = `${DOMAIN}/?pg=${page}`;
        break;
      default:
        return { items: [] };
    }

    const $ = await this.document(url);
    const cards = section.id === HOME_SECTIONS.updates ? parseLatestUpdates($) : parseListing($);
    if (cards.length === 0) {
      throw new Error(`The ${section.title} listing is empty; the site may have changed.`);
    }

    const items = cards.map((card): DiscoverSectionItem => {
      switch (section.type) {
        case DiscoverSectionType.featured:
          return {
            type: "featuredCarouselItem",
            mangaId: card.id,
            title: card.title,
            imageUrl: card.cover,
            ...(card.subtitle ? { supertitle: card.subtitle } : {}),
          };
        case DiscoverSectionType.chapterUpdates:
          return {
            type: "chapterUpdatesCarouselItem",
            mangaId: card.id,
            chapterId: card.chapterId ?? "",
            title: card.title,
            imageUrl: card.cover,
            ...(card.subtitle ? { subtitle: card.subtitle } : {}),
          };
        default:
          return {
            type: "simpleCarouselItem",
            mangaId: card.id,
            title: card.title,
            imageUrl: card.cover,
            ...(card.subtitle ? { subtitle: card.subtitle } : {}),
          };
      }
    });

    return {
      items,
      metadata: hasNextPage($) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async getVocab(): Promise<Vocab> {
    if (this.vocabCache) return this.vocabCache;

    const cached = Application.getState(VOCAB_STATE_KEY) as
      | { at: number; vocab: Vocab }
      | undefined;
    if (cached && Date.now() - cached.at < VOCAB_TTL && cached.vocab.genres.length > 0) {
      this.vocabCache = cached.vocab;
      return cached.vocab;
    }

    const vocab = parseVocab(await this.document(`${DOMAIN}/series-finder/?sf=1`));
    Application.setState({ at: Date.now(), vocab }, VOCAB_STATE_KEY);
    this.vocabCache = vocab;
    return vocab;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<ScribbleHubSearchForm> {
    const vocab = this.getVocab().catch(() => ({
      genres: FALLBACK_GENRES,
      tags: [],
      warnings: FALLBACK_WARNINGS,
    }));
    return new ScribbleHubSearchForm(query.metadata as SearchMetadata | undefined, vocab);
  }

  // Mirrors sf_genre_submit() in the site's sfinder.js.
  private searchUrl(
    title: string,
    filters: SearchMetadata | undefined,
    sort: string,
    page: number,
  ): string {
    const params = ["sf=1"];
    if (title) params.push(`sh=${encodeURIComponent(title)}`);

    const split = (state: TriState | undefined) => {
      const included: string[] = [];
      const excluded: string[] = [];
      for (const [id, mode] of Object.entries(state ?? {})) {
        (mode === "included" ? included : excluded).push(id);
      }
      return { included, excluded };
    };

    const genres = split(filters?.genres);
    if (genres.included.length)
      params.push(`gi=${genres.included.join(",")}`, `mgi=${filters?.genreMode ?? "and"}`);
    if (genres.excluded.length) params.push(`ge=${genres.excluded.join(",")}`);

    const tags = split(filters?.tags);
    if (tags.included.length) params.push(`tgi=${tags.included.join(",")}`, "mtgi=and");
    if (tags.excluded.length) params.push(`tge=${tags.excluded.join(",")}`);

    const warnings = split(filters?.warnings);
    if (warnings.included.length) params.push(`cti=${warnings.included.join(",")}`, "mct=and");
    if (warnings.excluded.length) params.push(`cte=${warnings.excluded.join(",")}`);

    if (filters?.status) params.push(`cp=${filters.status}`);
    params.push(`sort=${sort}`, "order=desc", `pg=${page}`);

    return `${DOMAIN}/series-finder/?${params.join("&")}`;
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as PageMetadata | undefined)?.page ?? 1;
    const filters = query.metadata as SearchMetadata | undefined;
    const sort = sortingOption?.id ?? DEFAULT_SORT;

    const $ = await this.document(this.searchUrl(query.title.trim(), filters, sort, page));
    const items = parseListing($).map((card): SearchResultItem => ({
      mangaId: card.id,
      title: card.title,
      imageUrl: card.cover,
      ...(card.subtitle ? { subtitle: card.subtitle } : {}),
    }));

    return {
      items,
      metadata: hasNextPage($) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return `${DOMAIN}/series/${mangaId}/`;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = parseSeries(await this.document(this.getMangaShareUrl(mangaId)));

    const tagGroups: TagSection[] = [];
    if (series.genres.length)
      tagGroups.push({ id: "genres", title: "Genres", tags: series.genres });
    if (series.tags.length) tagGroups.push({ id: "tags", title: "Tags", tags: series.tags });
    if (series.warnings.length) {
      tagGroups.push({ id: "warnings", title: "Content warnings", tags: series.warnings });
    }

    const additionalInfo: Record<string, string> = {};
    for (const [label, value] of Object.entries(series.stats)) additionalInfo[label] = value;
    if (series.ratingCount) additionalInfo["Ratings"] = series.ratingCount;
    if (series.lastUpdate) additionalInfo["Last update"] = series.lastUpdate;

    const adult =
      series.warnings.some((w) => /sexual/i.test(w.title)) ||
      series.genres.some((g) => ADULT_MARKERS.test(g.title));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: [],
        thumbnailUrl: series.cover,
        synopsis: series.synopsis,
        contentRating: adult ? ContentRating.ADULT : ContentRating.MATURE,
        contentType: "novel",
        status: series.status ?? "Unknown",
        ...(series.author ? { author: series.author } : {}),
        ...(series.rating ? { rating: series.rating / 5 } : {}),
        tagGroups,
        additionalInfo,
        shareUrl: this.getMangaShareUrl(mangaId),
      },
    };
  }

  // The TOC is served 15 rows per ajax page, newest first; an empty page ends it.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const postId = sourceManga.mangaId.split("/")[0];
    const rows: ChapterRow[] = [];

    for (let page = 1; ; page++) {
      const html = await this.request({
        url: `${DOMAIN}/wp-admin/admin-ajax.php`,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-requested-with": "XMLHttpRequest",
        },
        body: `action=wi_getreleases_pagination&mypostid=${postId}&pagenum=${page}`,
      });
      const batch = parseChapterRows(cheerio.load(html));
      if (batch.length === 0 || rows.some((row) => row.id === batch[0]!.id)) break;
      rows.push(...batch);
    }

    if (rows.length === 0) {
      throw new Error("The chapter list is empty; the site may have changed.");
    }

    return rows.map((row) => ({
      chapterId: row.id,
      sourceManga,
      langCode: "en",
      chapNum: row.order,
      title: row.title,
      volume: 0,
      version: "1",
      ...(row.date ? { publishDate: row.date } : {}),
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    // Chapter pages sit behind their own Cloudflare check, separate from the site's front page: the interceptor
    // points the bypass at the chapter URL itself, so the app solves that one and the retry reads the chapter.
    const $ = await this.document(`${DOMAIN}/${chapter.chapterId}/`);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: parseChapterBody($, chapter.title),
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const ScribbleHub = new ScribbleHubExtension();
