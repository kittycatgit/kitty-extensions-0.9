/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  BasicRateLimiter,
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Metadata,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import {
  PAGE_SIZE,
  type DankeSearchMetadata,
  type GuyaAllSeries,
  type GuyaSeries,
  type GuyaSeriesSummary,
} from "./models";
import pbconfig from "./pbconfig";

const DOMAIN = "https://danke.moe";

/** The full index is a single large document, so hold it briefly per session. */
const INDEX_TTL_MS = 5 * 60 * 1000;

type IndexEntry = GuyaSeriesSummary & { displayTitle: string };

class DankeFursLesenExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 10,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private index?: { at: number; entries: IndexEntry[] };

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}${path}`,
      method: "GET",
    });

    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  /** `/api/get_all_series/` is the only listing endpoint, so cache it. */
  private async getIndex(): Promise<IndexEntry[]> {
    const cached = this.index;
    if (cached && Date.now() - cached.at < INDEX_TTL_MS) {
      return cached.entries;
    }

    const all = await this.fetchJson<GuyaAllSeries>("/api/get_all_series/");
    const entries = Object.entries(all).map(([displayTitle, series]) => ({
      ...series,
      displayTitle,
    }));

    this.index = { at: Date.now(), entries };
    return entries;
  }

  private toSearchResult(entry: IndexEntry): SearchResultItem {
    return {
      mangaId: entry.slug,
      title: entry.displayTitle,
      imageUrl: entry.cover ? `${DOMAIN}${entry.cover}` : "",
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.fetchJson<GuyaSeries>(`/api/series/${mangaId}/`);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: [],
        thumbnailUrl: series.cover ? `${DOMAIN}${series.cover}` : "",
        synopsis: stripHtml(series.description),
        contentRating: pbconfig.contentRating as ContentRating,
        shareUrl: `${DOMAIN}/read/manga/${mangaId}/`,
        ...(series.author ? { author: series.author } : {}),
        ...(series.artist ? { artist: series.artist } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = await this.fetchJson<GuyaSeries>(`/api/series/${sourceManga.mangaId}/`);
    const chapters: Chapter[] = [];

    for (const [key, chapter] of Object.entries(series.chapters)) {
      const groupId = Object.keys(chapter.groups)[0];
      if (!groupId) {
        continue;
      }

      const released = chapter.release_date[groupId];
      const volume = Number(chapter.volume);

      chapters.push({
        chapterId: key,
        sourceManga,
        langCode: "en",
        chapNum: Number(key),
        ...(chapter.title ? { title: chapter.title } : {}),
        ...(isNaN(volume) ? {} : { volume }),
        ...(released ? { publishDate: new Date(released * 1000) } : {}),
        ...(series.groups[groupId] ? { version: series.groups[groupId] } : {}),
      });
    }

    // The API returns chapters keyed by number; present newest first.
    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const series = await this.fetchJson<GuyaSeries>(`/api/series/${chapter.sourceManga.mangaId}/`);

    const entry = series.chapters[chapter.chapterId];
    if (!entry) {
      throw new Error(`Chapter ${chapter.chapterId} is no longer listed`);
    }

    const groupId = Object.keys(entry.groups)[0];
    const pages = groupId ? (entry.groups[groupId] ?? []) : [];

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: pages.map(
        (page) =>
          `${DOMAIN}/media/manga/${series.slug}/chapters/${entry.folder}/${groupId}/${page}`,
      ),
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as DankeSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const title = (query.title ?? "").trim().toLowerCase();

    // There is no search endpoint, so filter the cached index locally.
    const matches = (await this.getIndex()).filter(
      (entry) =>
        !title || entry.displayTitle.toLowerCase().includes(title) || entry.slug.includes(title),
    );

    const start = (page - 1) * PAGE_SIZE;
    const slice = matches.slice(start, start + PAGE_SIZE);

    return {
      items: slice.map((entry) => this.toSearchResult(entry)),
      metadata: start + slice.length < matches.length ? { page: page + 1 } : { completed: true },
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return [
      { id: "latest", label: "Latest" },
      { id: "alphabet", label: "A-Z" },
    ];
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: "alphabet", title: "All Series", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as DankeSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const entries = [...(await this.getIndex())];

    if (section.id === "latest") {
      entries.sort((a, b) => b.last_updated - a.last_updated);
    } else {
      entries.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
    }

    const start = (page - 1) * PAGE_SIZE;
    const slice = entries.slice(start, start + PAGE_SIZE);

    return {
      items: slice.map((entry) => ({
        type: "simpleCarouselItem" as const,
        mangaId: entry.slug,
        imageUrl: entry.cover ? `${DOMAIN}${entry.cover}` : "",
        title: entry.displayTitle,
      })),
      metadata: start + slice.length < entries.length ? { page: page + 1 } : { completed: true },
    };
  }
}

/** Descriptions are authored as HTML, which the app renders as plain text. */
function stripHtml(value: string): string {
  return Application.decodeHTMLEntities(
    (value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}

export const DankeFursLesen = new DankeFursLesenExtension();
