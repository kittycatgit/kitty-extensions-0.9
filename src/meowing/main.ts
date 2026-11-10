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

import { encodeId } from "../shared/ids";
import type { basePbConfig } from "./config";
import { MeowingSearchForm } from "./forms";
import {
  PAGE_SIZE,
  uploadUrl,
  type CatalogEntry,
  type MeowingFilters,
  type MeowingMetadata,
} from "./models";
import { parseCatalog, parseChapters, parsePages, parseSeriesPage } from "./parsers";

const CATALOG_TTL_MS = 60 * 60 * 1000;

const RAILS = [
  { id: "latest", title: "Latest Updates" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "all", title: "All Series" },
] as const;

// Shared by the Meowing-built scan sites: `/series/` ships the whole catalogue
// in one response, series pages hold the full chapter list, and page images are
// `uid` attributes pointing at a single shared CDN.
export abstract class MeowingGeneric implements ExtensionImpl<typeof basePbConfig> {
  abstract domain: string;

  abstract name: string;

  abstract contentRating: ContentRating;

  language = "en";

  private catalogCache?: { at: number; entries: CatalogEntry[] };

  async initialise(): Promise<void> {
    // Nothing to register: no cookies, headers or tokens are needed.
  }

  private async getHtml(url: string): Promise<cheerio.CheerioAPI> {
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  async catalog(): Promise<CatalogEntry[]> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL_MS) {
      return this.catalogCache.entries;
    }

    const $ = await this.getHtml(`${this.domain}/series/`);
    const entries = parseCatalog($);

    if (entries.length === 0) {
      throw new Error(`Parsed no series from ${this.domain}/series/`);
    }

    this.catalogCache = { at: Date.now(), entries };

    return entries;
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    // Smaller sites have nothing completed; an advertised row that never fills
    // is worse than one row less.
    const statuses = new Set((await this.catalog()).map((entry) => entry.status.toLowerCase()));

    return RAILS.filter(
      (rail) => rail.id === "latest" || rail.id === "all" || statuses.has(rail.id),
    ).map((rail, index) => ({
      id: rail.id,
      title: rail.title,
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MeowingMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "latest") {
      const $ = await this.getHtml(this.domain);
      const items = parseCatalog($).map((entry) => this.toDiscoverItem(entry, section));

      return { items };
    }

    const entries = await this.catalog();
    const filtered =
      section.id === "all"
        ? entries
        : entries.filter((entry) => entry.status.toLowerCase() === section.id);

    return this.paginate(
      filtered.map((entry) => this.toDiscoverItem(entry, section)),
      metadata?.page ?? 1,
    );
  }

  private toDiscoverItem(entry: CatalogEntry, section: DiscoverSection): DiscoverSectionItem {
    const common = { mangaId: entry.id, imageUrl: entry.imageUrl, title: entry.title };

    return section.type === DiscoverSectionType.featured
      ? { ...common, type: "featuredCarouselItem" }
      : { ...common, subtitle: entry.type.toUpperCase(), type: "simpleCarouselItem" };
  }

  private paginate<T>(items: T[], page: number): PagedResults<T> {
    const start = (page - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    return {
      items: slice,
      ...(start + slice.length < items.length ? { metadata: { page: page + 1 } } : {}),
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<MeowingFilters>) {
    const entries = await this.catalog();

    return new MeowingSearchForm(query.metadata, {
      genres: [...new Set(entries.flatMap((entry) => entry.tags))].sort(),
      types: [...new Set(entries.map((entry) => entry.type))].filter(Boolean).sort(),
      statuses: [...new Set(entries.map((entry) => entry.status))].filter(Boolean).sort(),
    });
  }

  // The site filters its own catalogue in the browser, so the match happens
  // here against the one listing response.
  async getSearchResults(
    query: SearchQuery<MeowingFilters>,
    metadata: MeowingMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: MeowingFilters = { ...query.metadata, ...metadata };
    const needle = (query.title ?? "").trim().toLowerCase();
    const entries = await this.catalog();

    const matched = entries.filter((entry) => {
      if (needle) {
        const haystack = [entry.title, ...entry.secondaryTitles].join(" ").toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }

      if (filters.status && entry.status.toLowerCase() !== filters.status.toLowerCase()) {
        return false;
      }

      if (filters.type && entry.type.toLowerCase() !== filters.type.toLowerCase()) {
        return false;
      }

      const wanted = filters.genres ?? [];

      return wanted.every((genre) =>
        entry.tags.some(
          (tag) => tag.trim().toLowerCase() === decodeURIComponent(genre).trim().toLowerCase(),
        ),
      );
    });

    const page = metadata?.page ?? 1;
    const paged = this.paginate(
      matched.map((entry) => ({
        mangaId: entry.id,
        imageUrl: entry.imageUrl,
        title: entry.title,
        subtitle: entry.type.toUpperCase(),
      })),
      page,
    );

    return {
      items: paged.items,
      ...(paged.metadata ? { metadata: { ...filters, page: page + 1 } } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.getHtml(`${this.domain}/series/${mangaId}/`);
    const page = parseSeriesPage($);
    const entry = (await this.catalog()).find((candidate) => candidate.id === mangaId);

    // A display name is not a legal id: a space fails the whole mangaInfo object,
    // and these names carry spaces, stray padding and non-latin text.
    const tags = [
      ...new Set((entry?.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0)),
    ].map((tag) => ({ id: encodeId(tag), title: tag }));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: page.title || (entry?.title ?? mangaId),
        secondaryTitles: entry?.secondaryTitles ?? [],
        thumbnailUrl: page.imageUrl || (entry?.imageUrl ?? ""),
        synopsis: page.synopsis,
        contentRating: this.contentRating,
        shareUrl: `${this.domain}/series/${mangaId}/`,
        ...(entry?.status ? { status: entry.status.toUpperCase() } : {}),
        ...(page.author ? { author: page.author } : {}),
        ...(page.artist ? { artist: page.artist } : {}),
        ...(tags.length ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
        ...(entry?.type ? { additionalInfo: { Type: entry.type.toUpperCase() } } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.getHtml(`${this.domain}/series/${sourceManga.mangaId}/`);
    const chapters = parseChapters($, sourceManga, this.language);

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.getHtml(`${this.domain}/chapter/${chapter.chapterId}/`);
    const uids = parsePages($);

    if (uids.length === 0) {
      throw new Error(
        `${chapter.title ?? chapter.chapterId} serves no pages: it is coin-locked on ${this.name} and has to be unlocked there.`,
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: uids.map(uploadUrl),
    };
  }
}
