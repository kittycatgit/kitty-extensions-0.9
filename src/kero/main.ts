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
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import type { basePbConfig } from "./config";
import { KeroSearchForm } from "./forms";
import { SORTS, type ApiCard, type KeroFilters, type KeroMetadata } from "./models";
import {
  parseCards,
  parseChapterList,
  parseGenres,
  parseMeta,
  parsePages,
  parseSeriesObject,
  parseTotalPages,
  decodePayload,
} from "./parsers";

const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

const RAILS = [
  { id: "latest", title: "Latest Updates", sort: "latest" },
  { id: "popular", title: "Popular", sort: "popular" },
  { id: "newest", title: "Newest", sort: "newest" },
  { id: "completed", title: "Completed", sort: "latest", status: "COMPLETED" },
] as const;

export abstract class KeroGeneric implements ExtensionImpl<typeof basePbConfig> {
  abstract domain: string;

  abstract name: string;

  abstract contentRating: ContentRating;

  language = "en";

  // Series live under one kind segment on both sites built on this platform.
  seriesPath = "series/comic";

  private genreCache?: { at: number; genres: { name: string; slug: string }[] };

  async initialise(): Promise<void> {
    // No cookies or tokens are needed.
  }

  private async getText(url: string): Promise<string> {
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    return Application.arrayBufferToUTF8String(buffer);
  }

  private listingUrl(page: number, params: Record<string, string>): string {
    const query = [["page", page.toString()], ...Object.entries(params)]
      .filter(([, value]) => value.length > 0)
      // Spaces go as `+`: a raw `%20` in a query value makes iOS re-encode the
      // whole url and the search then misses.
      .map(([key, value]) => `${key}=${encodeURIComponent(value).replaceAll("%20", "+")}`)
      .join("&");

    return `${this.domain}/series?${query}`;
  }

  private cardToItem(card: ApiCard) {
    return {
      mangaId: card.urlSlug ?? card.slug,
      title: Application.decodeHTMLEntities(card.title),
      imageUrl: card.coverImage ? `${this.domain}${card.coverImage}` : "",
      subtitle: card.type ?? "",
    };
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
    metadata: KeroMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const html = await this.getText(
      this.listingUrl(page, { sort: rail.sort, status: "status" in rail ? rail.status : "" }),
    );
    const payload = decodePayload(html);
    const cards = parseCards(payload);

    const items: DiscoverSectionItem[] = cards.map((card) =>
      section.type === DiscoverSectionType.featured
        ? { ...this.cardToItem(card), type: "featuredCarouselItem" as const }
        : { ...this.cardToItem(card), type: "simpleCarouselItem" as const },
    );

    return {
      items,
      ...(page < parseTotalPages(payload) ? { metadata: { page: page + 1 } } : {}),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  async getAdvancedSearchForm(query: SearchQuery<KeroFilters>) {
    return new KeroSearchForm(query.metadata, await this.genres());
  }

  private async genres(): Promise<{ name: string; slug: string }[]> {
    if (this.genreCache && Date.now() - this.genreCache.at < GENRES_TTL_MS) {
      return this.genreCache.genres;
    }

    const payload = decodePayload(await this.getText(`${this.domain}/series`));
    const genres = parseGenres(payload);

    if (genres.length === 0) {
      throw new Error("Parsed no genres from the listing");
    }

    this.genreCache = { at: Date.now(), genres };

    return genres;
  }

  async getSearchResults(
    query: SearchQuery<KeroFilters>,
    metadata: KeroMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: KeroFilters = { ...query.metadata, ...metadata };
    const page = metadata?.page ?? 1;

    const html = await this.getText(
      this.listingUrl(page, {
        q: (query.title ?? "").trim(),
        // Several genres narrow together, but only comma-joined: repeating the
        // key makes the site answer the unfiltered listing.
        genre: (filters.genre ?? []).join(","),
        type: filters.type ?? "",
        status: filters.status ?? "",
        sort: sortingOption?.id ?? filters.sort ?? "",
      }),
    );

    const payload = decodePayload(html);
    const items: SearchResultItem[] = parseCards(payload).map((card) => this.cardToItem(card));

    return {
      items,
      ...(page < parseTotalPages(payload) ? { metadata: { ...filters, page: page + 1 } } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await this.getText(`${this.domain}/${this.seriesPath}/${mangaId}`);
    const payload = decodePayload(html);
    const series = parseSeriesObject(payload);

    if (!series) {
      throw new Error(`No series record on the page for ${mangaId}`);
    }

    const author = /"author":\{"@type":"Person","name":"([^"]+)"/.exec(payload)?.[1];
    // The series record lists genres flat; listing cards nest them under `genre`.
    const genres = (series.genres ?? [])
      .map((entry) =>
        "genre" in entry ? entry.genre : (entry as { name?: string; slug?: string }),
      )
      .filter((genre): genre is { name?: string; slug?: string } => Boolean(genre?.slug))
      .map((genre) => ({ id: genre.slug!, title: genre.name ?? genre.slug! }));

    const secondaryTitles = [...new Set([series.originalTitle, ...(series.aliases ?? [])])]
      .filter((title): title is string => Boolean(title) && title !== series.title)
      .map((title) => Application.decodeHTMLEntities(title));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(series.title),
        secondaryTitles,
        thumbnailUrl: series.coverImage ? `${this.domain}${series.coverImage}` : "",
        synopsis: Application.decodeHTMLEntities(
          (series.description ?? parseMeta(html, "description"))
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
        contentRating: series.nsfw ? ContentRating.ADULT : this.contentRating,
        shareUrl: `${this.domain}/${this.seriesPath}/${mangaId}`,
        ...(series.status ? { status: series.status } : {}),
        ...(author ? { author } : {}),
        ...(series.rating ? { rating: series.rating / 2 } : {}),
        ...(genres.length ? { tagGroups: [{ id: "genres", title: "Genres", tags: genres }] } : {}),
        ...(series.type ? { additionalInfo: { Type: series.type } } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const payload = decodePayload(
      await this.getText(`${this.domain}/${this.seriesPath}/${sourceManga.mangaId}`),
    );
    const parsed = parseChapterList(payload);

    if (parsed.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return parsed
      .map((chapter) => {
        const published = chapter.publishedAt ? new Date(chapter.publishedAt) : undefined;

        return {
          // The reader is addressed by chapter number, not by the record id.
          chapterId: chapter.number.toString(),
          sourceManga,
          langCode: this.language,
          chapNum: chapter.number,
          ...(chapter.title ? { title: chapter.title } : {}),
          ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
          ...(chapter.coinPrice
            ? { additionalInfo: { Price: `${chapter.coinPrice.toString()} coins` } }
            : {}),
        };
      })
      .sort((left, right) => right.chapNum - left.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const payload = decodePayload(
      await this.getText(
        `${this.domain}/${this.seriesPath}/${chapter.sourceManga.mangaId}/chapter/${chapter.chapterId}`,
      ),
    );

    const pages = parsePages(payload);

    if (pages.length === 0) {
      throw new Error(
        `Chapter ${chapter.chapterId} serves no pages: it is locked on ${this.name} and has to be unlocked there.`,
      );
    }

    const protected_ = pages.find(
      (page) => page.isEncrypted === true || page.hasFragments === true || page.hasStrips === true,
    );

    if (protected_) {
      throw new Error(
        `Page ${protected_.pageNumber.toString()} of chapter ${chapter.chapterId} is served in pieces that this extension cannot reassemble.`,
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: pages.map((page) =>
        page.imageUrl.startsWith("http") ? page.imageUrl : `${this.domain}${page.imageUrl}`,
      ),
    };
  }
}
