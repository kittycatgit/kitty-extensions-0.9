/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type ContentRating,
  type DiscoverSection,
  type DiscoverSectionItem,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";
import { type CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";

import { MangaStreamGeneric } from "../mangastream/main";
import type {
  MangaStreamDiscoverSection,
  MangaStreamFilters,
  MangaStreamSearchMetadata,
} from "../mangastream/models";
import pbconfig from "./pbconfig";

const DOMAIN_NAME: string = "https://scythescans.com";

// A fetched chapter page has no page images; ts_reader fills them in at runtime.
// The inject body must `return` — a promise here, so we can wait for the reader.
const READER_SCRIPT = `
  return new Promise(function (resolve) {
    var deadline = Date.now() + 15000;

    function report(images, sources) {
      return JSON.stringify({
        images: images,
        readerPresent: !!window.ts_reader,
        paramsPresent: !!(window.ts_reader && window.ts_reader.params),
        sourceCount: sources ? sources.length : 0,
        readerAreaImgs: document.querySelectorAll('#readerarea img').length,
        scripts: document.querySelectorAll('script').length,
        readyState: document.readyState,
      });
    }

    function collect() {
      try {
        var reader = window.ts_reader;
        var sources = reader && reader.params && reader.params.sources;
        var images = [];

        if (sources && sources.length) {
          for (var i = 0; i < sources.length; i++) {
            var list = sources[i].images || [];
            for (var j = 0; j < list.length; j++) {
              if (list[j] && images.indexOf(list[j]) === -1) images.push(list[j]);
            }
            if (images.length) break;
          }
        }

        if (!images.length) {
          // Fall back to whatever the reader has already rendered.
          var rendered = document.querySelectorAll('#readerarea img');
          for (var k = 0; k < rendered.length; k++) {
            var src = rendered[k].getAttribute('src') || rendered[k].getAttribute('data-src');
            if (src && src.indexOf('readerarea.svg') === -1 && images.indexOf(src) === -1) {
              images.push(src);
            }
          }
        }

        if (images.length) return resolve(report(images, sources));
        if (Date.now() > deadline) return resolve(report([], sources));
        setTimeout(collect, 250);
      } catch (error) {
        resolve(JSON.stringify({ images: [], error: String(error) }));
      }
    }

    collect();
  });
`;

class ScytheScansExtension extends MangaStreamGeneric {
  domain = DOMAIN_NAME;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;

  override configureSections(): void {
    // This site lays every rail out as `bsx` cards in a `listupd`, and shows four.
    this.featuredSection.selectorFunc = ($: CheerioAPI) =>
      $("div.bsx", $("h2:contains(Popular Today)").closest("div.bixbox"));

    this.latestUpdatesSection.selectorFunc = ($: CheerioAPI) =>
      $("div.bsx", $("h2:contains(Latest Update)").closest("div.bixbox"));
    this.latestUpdatesSection.subtitleSelectorFunc = (
      $: CheerioAPI,
      element: Parameters<MangaStreamDiscoverSection["subtitleSelectorFunc"]>[1],
    ) => $("div.epxs, div.adds div.epxs", element).first().text().trim();

    this.discoverSections = [
      this.featuredSection,
      this.latestUpdatesSection,
      this.railFor("recommendation", "Recommendation"),
      this.popularSeriesRail(),
    ];
  }

  private railFor(id: string, heading: string): MangaStreamDiscoverSection {
    return {
      id,
      title: heading,
      type: DiscoverSectionType.simpleCarousel,
      selectorFunc: ($: CheerioAPI) =>
        $("div.bsx", $(`h2:contains(${heading})`).closest("div.bixbox, div.section")),
      titleSelectorFunc: ($: CheerioAPI, element) => $("a", element).attr("title") ?? "",
      subtitleSelectorFunc: ($: CheerioAPI, element) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "simpleCarouselItem",
      enabled: true,
    };
  }

  // Not a `bsx` grid but the ranking widget: titles are text, not link attributes.
  private popularSeriesRail(): MangaStreamDiscoverSection {
    return {
      id: "popular_series",
      title: "Popular Series",
      type: DiscoverSectionType.simpleCarousel,
      selectorFunc: ($: CheerioAPI) => $("div.serieslist.pop li"),
      titleSelectorFunc: ($: CheerioAPI, element) =>
        $("div.leftseries h2 a, div.leftseries a", element).first().text().trim(),
      subtitleSelectorFunc: ($: CheerioAPI, element) =>
        $("div.leftseries span, span.mgen", element).first().text().trim(),
      itemType: "simpleCarouselItem",
      enabled: true,
    };
  }

  // The base resolves rails through a switch that only knows "popular" and
  // "latest_updates"; every other id silently falls through to latest updates.
  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const resolved =
      this.discoverSections.find((entry) => entry.id === section.id) ?? this.latestUpdatesSection;

    const paginates = resolved.id === this.latestUpdatesSection.id;
    const page = metadata?.page ?? 1;
    const url = paginates && page > 1 ? `${this.domain}/page/${page}/` : this.domain;

    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const items = await this.parser.parseHomeSection($, resolved, this);

    return {
      items,
      ...(paginates && items.length > 0 && linksToPage($, page + 1)
        ? { metadata: { page: page + 1 } }
        : {}),
    };
  }

  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/${this.directoryPath}/${mangaId}/`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const manga = this.parser.parseMangaDetails($, mangaId, this);

    // Rows read `<div class="imptdt">Label <i>Value</i></div>`: the label is the
    // row's own text, the value the child. There is no colon to split on.
    const rows = new Map<string, string>();
    $("div.tsinfo div.imptdt").each((_, element) => {
      const row = $(element);
      const label = row.clone().children().remove().end().text().replace(/\s+/g, " ").trim();
      const value = row.children().first().text().replace(/\s+/g, " ").trim();
      if (label && value) {
        rows.set(label.toLowerCase(), value);
      }
    });

    const additionalInfo: Record<string, string> = {};
    for (const [label, key] of [
      ["type", "Type"],
      ["released", "Released"],
      ["serialization", "Serialization"],
      ["posted on", "Posted"],
      ["updated on", "Updated"],
    ] as const) {
      const value = rows.get(label);
      if (value) {
        additionalInfo[key] = value;
      }
    }

    const chapterCount = $("div#chapterlist li").length;
    if (chapterCount > 0) {
      additionalInfo["Chapters"] = String(chapterCount);
    }

    const status = rows.get("status");
    const rating = Number($("[itemprop='ratingValue']").first().text().trim());

    manga.mangaInfo = {
      ...manga.mangaInfo,
      shareUrl: `${this.domain}/${this.directoryPath}/${mangaId}/`,
      ...(status ? { status } : {}),
      ...(isNaN(rating) || rating <= 0 ? {} : { rating }),
      ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
    };

    return manga;
  }

  // Title search paginates by path (`/page/2/?s=`); the theme's `?page=` is ignored.
  override async getSearchResults(
    query: SearchQuery<MangaStreamFilters>,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();

    if (!title) {
      return super.getSearchResults(query, metadata);
    }

    const path = page > 1 ? `/page/${page}` : "";
    const [, buffer] = await Application.scheduleRequest({
      url: `${this.domain}${path}/?s=${encodeURIComponent(title)}`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const items: SearchResultItem[] = this.parser.parseSearchResults($).map((result) => ({
      mangaId: result.mangaId,
      title: result.title,
      imageUrl: result.imageUrl,
      ...(result.subtitle ? { subtitle: result.subtitle } : {}),
    }));

    return {
      items,
      ...(items.length > 0 && linksToPage($, page + 1) ? { metadata: { page: page + 1 } } : {}),
    };
  }

  override async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = await this.resolveChapterUrl(chapter);

    const [, buffer] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);

    const { result } = await Application.executeInWebView({
      source: {
        html,
        baseUrl: chapterUrl,
        loadCSS: false,
        loadImages: true,
      },
      inject: READER_SCRIPT,
      storage: { cookies: this.cookieStorageInterceptor.cookies as never },
    });

    const { pages, diagnostics } = parseReport(result);
    if (pages.length === 0) {
      throw new Error(`Unable to read any pages for chapter ${chapter.chapterId} [${diagnostics}]`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  private async resolveChapterUrl(chapter: Chapter): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/${this.directoryPath}/${chapter.sourceManga.mangaId}/`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const entry = $("div#chapterlist li")
      .toArray()
      .find((element) => $(element).attr("data-num") === chapter.chapterId);

    const url = entry ? $("a", entry).attr("href") : undefined;
    if (!url) {
      throw new Error(`Unable to find chapter ${chapter.chapterId}`);
    }

    return url;
  }
}

// Asking for a page past the last one 404s instead of returning an empty list.
function linksToPage($: CheerioAPI, page: number): boolean {
  return $("a[href]")
    .toArray()
    .some((element) => ($(element).attr("href") ?? "").includes(`/page/${page}/`));
}

// The webview replies with a JSON report; older builds sent a bare array.
function parseReport(result: unknown): { pages: string[]; diagnostics: string } {
  let raw: unknown = result;

  if (typeof raw === "string") {
    const length = raw.length;
    try {
      raw = JSON.parse(raw);
    } catch {
      return { pages: [], diagnostics: `unparsable reply of ${length} chars` };
    }
  }

  if (Array.isArray(raw)) {
    return {
      pages: raw.filter((page): page is string => typeof page === "string"),
      diagnostics: "",
    };
  }

  if (!raw || typeof raw !== "object") {
    return { pages: [], diagnostics: `reply was ${raw === undefined ? "undefined" : typeof raw}` };
  }

  const report = raw as Record<string, unknown>;
  const pages = Array.isArray(report["images"])
    ? (report["images"] as unknown[]).filter((page): page is string => typeof page === "string")
    : [];

  const diagnostics = [
    `reader=${String(report["readerPresent"])}`,
    `params=${String(report["paramsPresent"])}`,
    `sources=${String(report["sourceCount"])}`,
    `readerAreaImgs=${String(report["readerAreaImgs"])}`,
    `scripts=${String(report["scripts"])}`,
    `readyState=${String(report["readyState"])}`,
    report["error"] ? `error=${JSON.stringify(report["error"])}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { pages, diagnostics };
}

export const ScytheScans = new ScytheScansExtension();
