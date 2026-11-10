/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import type { basePbConfig } from "./config";
import { parseCards, parseChapters, parsePages, parseSeries } from "./parsers";

const RAILS = [
  { id: "latest", title: "Latest Updates", path: "latest" },
  { id: "ongoing", title: "Ongoing", path: "ongoing" },
  { id: "completed", title: "Completed", path: "completed" },
  { id: "all", title: "All Series", path: "manga" },
] as const;

// Two sites share this engine ("mangaberri"): /manga?page=N listings,
// /title/<slug> series pages, /read/<id> readers and page files under
// /mangas/<chapterId>/.
export abstract class MangaBerriGeneric implements ExtensionImpl<typeof basePbConfig> {
  abstract domain: string;

  abstract name: string;

  abstract contentRating: ContentRating;

  language = "en";

  async initialise(): Promise<void> {
    // Nothing to register: no cookies or tokens are involved.
  }

  private async getText(url: string): Promise<string> {
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    return Application.arrayBufferToUTF8String(buffer);
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
    metadata: { page?: number } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const html = await this.getText(`${this.domain}/${rail.path}?page=${page.toString()}`);
    const cards = parseCards(cheerio.load(html), this.domain);

    const items: DiscoverSectionItem[] = cards.map((card) =>
      section.type === DiscoverSectionType.featured
        ? {
            mangaId: card.slug,
            imageUrl: card.imageUrl,
            title: card.title,
            type: "featuredCarouselItem" as const,
          }
        : {
            mangaId: card.slug,
            imageUrl: card.imageUrl,
            title: card.title,
            subtitle: card.subtitle,
            type: "simpleCarouselItem" as const,
          },
    );

    return { items, ...(items.length > 0 ? { metadata: { page: page + 1 } } : {}) };
  }

  async getSearchResults(
    query: SearchQuery<never>,
    metadata: { page?: number } | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();

    // Spaces go as `+`; a percent-encoded space makes iOS re-encode the whole
    // url and the search then misses.
    const url = title
      ? `${this.domain}/search?q=${encodeURIComponent(title).replaceAll("%20", "+")}&page=${page.toString()}`
      : `${this.domain}/manga?page=${page.toString()}`;

    const cards = parseCards(cheerio.load(await this.getText(url)), this.domain);

    return {
      items: cards.map((card) => ({
        mangaId: card.slug,
        imageUrl: card.imageUrl,
        title: card.title,
        subtitle: card.subtitle,
      })),
      ...(cards.length > 0 ? { metadata: { page: page + 1 } } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await this.getText(`${this.domain}/title/${mangaId}`);

    return parseSeries(cheerio.load(html), mangaId, this.domain, this.contentRating);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const html = await this.getText(`${this.domain}/title/${sourceManga.mangaId}`);
    const chapters = parseChapters(cheerio.load(html), sourceManga, this.language);

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await this.getText(`${this.domain}/read/${chapter.chapterId}`);
    const pages = parsePages(html, chapter.chapterId, this.domain);

    if (pages.length === 0) {
      throw new Error(`Chapter ${chapter.chapterId} serves no pages`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}
