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
    const pages = parsePages(Application.arrayBufferToUTF8String(buffer));

    if (pages.length === 0) {
      throw new Error(`Unable to read any pages for chapter ${chapter.chapterId}`);
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

// ts_reader is configured by a base64 `data:` script rather than plain markup,
// so the page list is already in the html and no reader has to run for it.
function parsePages(html: string): string[] {
  const pages: string[] = [];

  for (const blob of html.match(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g) ?? []) {
    const decoded = Application.base64Decode(blob.split(",")[1] ?? "");

    if (typeof decoded !== "string" || !decoded.includes("ts_reader.run")) {
      continue;
    }

    const payload = /ts_reader\.run\((\{[\s\S]*?\})\);/.exec(decoded)?.[1];

    if (!payload) {
      continue;
    }

    for (const source of (JSON.parse(payload) as { sources?: { images?: string[] }[] }).sources ??
      []) {
      for (const url of source.images ?? []) {
        if (url && !pages.includes(url)) {
          pages.push(url);
        }
      }

      if (pages.length > 0) {
        return pages;
      }
    }
  }

  return pages;
}

export const ScytheScans = new ScytheScansExtension();
