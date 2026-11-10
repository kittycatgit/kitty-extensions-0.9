/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type PagedResults,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { MangaStreamGeneric } from "../mangastream/main";
import type { MangaStreamSearchMetadata } from "../mangastream/models";
import { toXhtmlDocument } from "../novel/xhtml";
import { LightNovelParser } from "./parsers";

// Rails are built from the site's own listing orders rather than the home page:
// every lightnovel site exposes the same four, and the home markup varies.
const RAILS: { id: string; title: string; order: string }[] = [
  { id: "latest_update", title: "Latest Updates", order: "update" },
  { id: "new_series", title: "New Series", order: "latest" },
  { id: "popular", title: "Popular", order: "popular" },
  { id: "top_rated", title: "Top Rated", order: "rating" },
];

export abstract class LightNovelGeneric extends MangaStreamGeneric {
  override directoryPath = "series";

  override parser = new LightNovelParser();

  override async getDiscoverSections(): Promise<DiscoverSection[]> {
    return RAILS.map((rail, index) => ({
      id: rail.id,
      title: rail.title,
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;

    const [, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/${this.directoryPath}/?page=${page.toString()}&order=${rail.order}`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const results = this.parser.parseSearchResults($);

    const items: DiscoverSectionItem[] = results.map((result) => ({
      mangaId: result.mangaId,
      imageUrl: result.imageUrl,
      title: result.title,
      ...(section.type === DiscoverSectionType.featured
        ? { supertitle: result.subtitle, type: "featuredCarouselItem" as const }
        : { subtitle: result.subtitle, type: "simpleCarouselItem" as const }),
    }));

    return {
      items,
      ...(items.length > 0 && !this.parser.isLastPage($) ? { metadata: { page: page + 1 } } : {}),
    };
  }

  // Chapters are prose at root-level permalinks, not pages under the series.
  override async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const [response, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/${chapter.chapterId}/`,
      method: "GET",
    });

    if (response.status !== 200) {
      throw new Error(`Chapter ${chapter.chapterId} answered ${response.status}`);
    }

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const body = $("div.epcontent").first().html() ?? $("div.entry-content").first().html() ?? "";

    if (!body.trim()) {
      throw new Error(`No chapter text found at ${chapter.chapterId}`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: toXhtmlDocument(body, chapter.title),
    };
  }
}
