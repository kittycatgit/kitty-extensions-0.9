/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
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

  // Every page is read through the app's WebView, as a frame navigation: the site's Cloudflare clearance is bound to the
  // browser's TLS fingerprint, so a cookie earned in the bypass never works for the app's own HTTP client, and the
  // firewall refuses that client's script-style requests outright. `extra` runs inside the loaded frame and its return
  // value comes back beside the document (used for the TOC, which the page fetches over ajax).
  private async webPage(
    url: string,
    extra = "return null;",
  ): Promise<{ html: string; extra: unknown }> {
    const { result, storage } = await Application.executeInWebView({
      source: {
        baseUrl: url,
        html: "<!DOCTYPE html><html><head></head><body></body></html>",
        loadCSS: false,
        loadImages: false,
        userAgent: await Application.getDefaultUserAgent(),
      },
      inject: `return new Promise((resolve) => {
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;left:0;top:0;width:900px;height:600px;opacity:0";
        const done = (value) => { frame.remove(); resolve(value); };
        frame.addEventListener("load", async () => {
          try {
            const doc = frame.contentDocument, win = frame.contentWindow;
            if (!doc || !doc.documentElement) return done({ error: "no document" });
            const title = doc.title || "";
            if (/just a moment|attention required|access denied/i.test(title)) return done({ challenge: title });
            const extra = await (async function (document, window, fetch) { ${extra} })(doc, win, win.fetch.bind(win));
            done({ html: doc.documentElement.outerHTML, extra });
          } catch (e) { done({ error: String(e && e.message || e) }); }
        }, { once: true });
        setTimeout(() => done({ error: "timed out" }), 45000);
        frame.src = ${JSON.stringify(url)};
        document.body.appendChild(frame);
      });`,
      storage: { cookies: this.cookieStorage.cookiesForUrl(url) },
    });
    for (const cookie of storage?.cookies ?? []) this.cookieStorage.setCookie(cookie);
    const page = (result ?? {}) as {
      html?: string;
      extra?: unknown;
      challenge?: string;
      error?: string;
    };
    if (page.challenge) {
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: { "user-agent": await Application.getDefaultUserAgent() },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }
    if (!page.html)
      throw new Error(`ScribbleHub: the page did not load (${page.error ?? "empty"}): ${url}`);
    return { html: page.html, extra: page.extra };
  }

  private async document(url: string): Promise<cheerio.CheerioAPI> {
    return cheerio.load((await this.webPage(url)).html);
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

  // One WebView visit: the series page loads in the frame, then the page's own TOC ajax is paged from inside that
  // frame (a browser request, 15 rows a page, newest first) until a page repeats or comes back empty.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const postId = sourceManga.mangaId.split("/")[0];
    const { html, extra } = await this.webPage(
      this.getMangaShareUrl(sourceManga.mangaId),
      `const pages = [];
       for (let page = 1; page <= 200; page++) {
         const r = await fetch("/wp-admin/admin-ajax.php", { method: "POST", credentials: "include",
           headers: { "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" },
           body: "action=wi_getreleases_pagination&mypostid=${postId}&pagenum=" + page });
         if (r.status !== 200) break;
         const text = await r.text();
         if (!/toc_w/.test(text) || pages.includes(text)) break;
         pages.push(text);
       }
       return pages;`,
    );
    const rows: ChapterRow[] = [];
    const seen = new Set<string>();
    const batches = Array.isArray(extra) && extra.length > 0 ? (extra as string[]) : [html];
    for (const batch of batches) {
      for (const row of parseChapterRows(cheerio.load(batch))) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
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
