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
  type Tag,
  type TagSection,
} from "@paperback/types";

import { ElftoonSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  FALLBACK_GENRES,
  SORTING_OPTIONS,
  type ElftoonChapterList,
  type ElftoonGenre,
  type ElftoonListing,
  type ElftoonMetadata,
  type ElftoonPage,
  type ElftoonSearch,
  type ElftoonSeries,
  type Option,
} from "./models";
import { ElftoonInterceptor } from "./network";
import type pbconfigType from "./pbconfig";

// elftoon.com 301s here; the public catalogue API lives under /api/ai.
const DOMAIN = "https://elftoon.net";
const API = `${DOMAIN}/api/ai`;
const PLACEHOLDER_COVER = `${DOMAIN}/apple-touch-icon.png`;

const GENRE_STATE_KEY = "elftoon-genres";
const GENRE_CACHE_TTL = 24 * 60 * 60 * 1000;

// What the site's home page shows, in its order, each backed by the same sort the API names.
const HOME_SECTIONS: { id: string; title: string; sort: string; limit?: number }[] = [
  { id: "popular", title: "Popular Today", sort: "popular" },
  { id: "latest", title: "Latest Comic Updates", sort: "latest" },
  { id: "top", title: "Top 10 Comics", sort: "rating", limit: 10 },
];

class ElftoonExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new ElftoonInterceptor("main", DOMAIN);

  private genreCache?: Option[];

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getJson<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const query = Object.entries(params)
      .filter((entry): entry is [string, string] => !!entry[1])
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    return JSON.parse(await this.getText(`${API}${path}${query ? `?${query}` : ""}`)) as T;
  }

  private toSearchResult(item: ElftoonSeries): SearchResultItem {
    return {
      mangaId: item.slug,
      title: item.title,
      imageUrl: item.cover_image || PLACEHOLDER_COVER,
      contentRating: item.is_nsfw ? ContentRating.ADULT : ContentRating.MATURE,
      ...(subtitleOf(item) ? { subtitle: subtitleOf(item) } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.getJson<ElftoonSeries>(`/series/${mangaId}`, { chapters: "none" });
    if (series.url?.includes("/series/novel/")) {
      throw new Error("Novels are not supported by this extension.");
    }

    const tagGroups: TagSection[] = [];
    const genres = pairTags(series.genres, series.genre_slugs);
    if (genres.length) {
      tagGroups.push({ id: "genres", title: "Genres", tags: genres });
    }
    const tags = pairTags(series.tags, series.tag_slugs);
    if (tags.length) {
      tagGroups.push({ id: "tags", title: "Tags", tags });
    }

    const additionalInfo: Record<string, string> = {};
    if (series.type) additionalInfo["Type"] = capitalize(series.type);
    if (series.origin) additionalInfo["Origin"] = capitalize(series.origin);
    if (series.chapter_count) {
      const parts = [`${series.chapter_count} total`];
      if (series.free_chapter_count) parts.push(`${series.free_chapter_count} free`);
      if (series.paid_chapter_count) parts.push(`${series.paid_chapter_count} paid`);
      if (series.early_access_chapter_count) {
        parts.push(`${series.early_access_chapter_count} early access`);
      }
      additionalInfo["Chapters"] = parts.join(" · ");
    }
    if (series.bookmarks) additionalInfo["Bookmarks"] = String(series.bookmarks);
    if (series.views) additionalInfo["Views"] = String(series.views);
    if (series.rating_count) additionalInfo["Ratings"] = String(series.rating_count);
    if (series.team?.name) additionalInfo["Team"] = series.team.name;

    const secondaryTitles: string[] = [];
    for (const alt of [series.original_title, ...(series.alternative_titles ?? [])]) {
      if (alt && alt !== series.title && !secondaryTitles.includes(alt)) {
        secondaryTitles.push(alt);
      }
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles,
        thumbnailUrl: series.cover_image || PLACEHOLDER_COVER,
        synopsis: series.description ?? "",
        contentRating: series.is_nsfw ? ContentRating.ADULT : ContentRating.MATURE,
        contentType: "comic",
        shareUrl: series.url ?? `${DOMAIN}/series/comic/${mangaId}`,
        ...(series.status ? { status: capitalize(series.status) } : {}),
        ...(series.author ? { author: series.author } : {}),
        ...(series.artist ? { artist: series.artist } : {}),
        ...(series.rating ? { rating: Math.max(0, Math.min(1, series.rating / 10)) } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    // 100 a page, newest first; the counts say when the list is complete.
    for (let page = 1; page <= 1000; page++) {
      const list = await this.getJson<ElftoonChapterList>(
        `/series/${sourceManga.mangaId}/chapters`,
        { page: String(page), limit: "100", order: "desc" },
      );
      const rows = list.chapters ?? [];

      for (const row of rows) {
        // Paid and early-access chapters are never served without an account.
        if (row.is_free === false) {
          continue;
        }
        const chapterId = String(row.number);
        if (seen.has(chapterId)) {
          continue;
        }
        seen.add(chapterId);

        const published = row.published_at ? new Date(row.published_at) : undefined;
        const title = row.title?.trim();
        chapters.push({
          chapterId,
          sourceManga,
          langCode: "en",
          chapNum: row.number,
          ...(title && title !== chapterId ? { title } : {}),
          ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
        });
      }

      if (rows.length < 100 || page * 100 >= (list.counts?.total ?? 0)) {
        break;
      }
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${DOMAIN}/series/comic/${chapter.sourceManga.mangaId}/chapter/${chapter.chapterId}`;
    const pages = extractPages(await this.getText(url));

    if (pages.length === 0) {
      throw new Error(`No pages were found for chapter ${chapter.chapterId}; it may be locked.`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: pages.map((page) => (page.startsWith("http") ? page : `${DOMAIN}${page}`)),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async getGenres(): Promise<Option[]> {
    if (this.genreCache) {
      return this.genreCache;
    }

    const cached = Application.getState(GENRE_STATE_KEY) as
      | { at: number; genres: Option[] }
      | undefined;
    if (cached && Date.now() - cached.at < GENRE_CACHE_TTL && cached.genres.length > 0) {
      this.genreCache = cached.genres;
      return cached.genres;
    }

    const body = await this.getJson<{ genres?: ElftoonGenre[] }>("/genres", {});
    const genres = (body.genres ?? [])
      .filter((genre) => genre.slug && genre.name && (genre.series_count ?? 0) > 0)
      .map((genre) => ({ id: genre.slug, title: genre.name }));
    if (genres.length === 0) {
      throw new Error("The genre list came back empty.");
    }

    Application.setState({ at: Date.now(), genres }, GENRE_STATE_KEY);
    this.genreCache = genres;
    return genres;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<ElftoonSearchForm> {
    let genres: Option[];
    try {
      genres = await this.getGenres();
    } catch {
      genres = FALLBACK_GENRES;
    }

    return new ElftoonSearchForm(query.metadata as ElftoonMetadata | undefined, genres);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as ElftoonMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = query.metadata as ElftoonMetadata | undefined;
    const title = (query.title ?? "").trim();

    if (title) {
      if (title.length < 2) {
        throw new Error("Type at least two characters to search.");
      }

      // The search endpoint ranks the 20 best title/author matches and takes no
      // catalogue filters or pages, so the form's filters are applied to that set.
      const body = await this.getJson<ElftoonSearch>("/search", {
        q: title,
        type: "comic",
        limit: "20",
        nsfw: filters?.nsfw,
      });
      return {
        items: (body.results ?? [])
          .filter((item) => matchesFilters(item, filters))
          .map((item) => this.toSearchResult(item)),
        metadata: { completed: true },
      };
    }

    const page = paging?.page ?? 1;
    const listing = await this.getJson<ElftoonListing>("/series", {
      type: "comic",
      sort: sortingOption?.id ?? DEFAULT_SORT,
      page: String(page),
      limit: "50",
      genre: filters?.genre,
      exgenre: filters?.exgenre,
      tag: filters?.tag,
      status: filters?.status,
      origin: filters?.origin,
      nsfw: filters?.nsfw,
      ch_min: filters?.minChapters,
    });

    return {
      items: (listing.data ?? []).map((item) => this.toSearchResult(item)),
      metadata: listing.pagination?.has_more ? { page: page + 1 } : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type:
          section.id === "popular"
            ? DiscoverSectionType.featured
            : DiscoverSectionType.simpleCarousel,
      })),
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const genres = await this.getGenres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genre: genre.id } satisfies ElftoonMetadata },
        })),
      };
    }

    const home = HOME_SECTIONS.find((entry) => entry.id === section.id);
    if (!home) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const paging = metadata as ElftoonMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const listing = await this.getJson<ElftoonListing>("/series", {
      type: "comic",
      sort: home.sort,
      page: String(page),
      limit: String(home.limit ?? 20),
    });

    const isFeatured = section.id === "popular";
    return {
      items: (listing.data ?? [])
        .filter((item) => item.slug && item.title)
        .map((item) => {
          const base = {
            mangaId: item.slug,
            imageUrl: item.cover_image || PLACEHOLDER_COVER,
            title: item.title,
            ...(item.is_nsfw ? { contentRating: ContentRating.ADULT } : {}),
          };

          if (isFeatured) {
            return {
              type: "featuredCarouselItem" as const,
              ...base,
              ...(item.description ? { summary: item.description } : {}),
              ...(subtitleOf(item) ? { supertitle: subtitleOf(item) } : {}),
            };
          }

          return {
            type: "simpleCarouselItem" as const,
            ...base,
            ...(subtitleOf(item) ? { subtitle: subtitleOf(item) } : {}),
          };
        }),
      // The top-ten rail is the site's fixed list; the others page the catalogue.
      metadata:
        !home.limit && listing.pagination?.has_more ? { page: page + 1 } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

function capitalize(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function pairTags(names: string[] | undefined, slugs: string[] | undefined): Tag[] {
  return (names ?? [])
    .map((name, index) => ({ id: slugs?.[index] ?? slugify(name), title: name }))
    .filter((tag) => tag.id && tag.title);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function timeAgo(iso: string): string | undefined {
  const then = new Date(iso).getTime();
  if (isNaN(then)) {
    return undefined;
  }
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

// The site's cards show the chapter count and how long ago the last one landed.
function subtitleOf(item: ElftoonSeries): string | undefined {
  const parts: string[] = [];
  if (item.chapter_count) {
    parts.push(`${item.chapter_count} chapters`);
  }
  const ago = item.last_chapter_at ? timeAgo(item.last_chapter_at) : undefined;
  if (ago) {
    parts.push(ago);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

function matchesFilters(item: ElftoonSeries, filters: ElftoonMetadata | undefined): boolean {
  if (!filters) {
    return true;
  }
  const genres = [...(item.genre_slugs ?? []), ...(item.genres ?? [])].map((g) => g.toLowerCase());
  const tags = [...(item.tag_slugs ?? []), ...(item.tags ?? [])].map((t) => t.toLowerCase());
  const wanted = (value: string | undefined): string | undefined =>
    value ? value.toLowerCase() : undefined;

  const genre = wanted(filters.genre);
  if (genre && !genres.includes(genre)) return false;
  const exgenre = wanted(filters.exgenre);
  if (exgenre && genres.includes(exgenre)) return false;
  const tag = wanted(filters.tag);
  if (tag && !tags.includes(tag) && !tags.includes(slugify(tag))) return false;
  if (filters.status && item.status?.toUpperCase() !== filters.status) return false;
  const minChapters = Number(filters.minChapters);
  if (minChapters > 0 && (item.chapter_count ?? 0) < minChapters) return false;
  return true;
}

/**
 * The reader page embeds its chapter as React flight data: a series of
 * `self.__next_f.push([1,"..."])` JS strings that, once unescaped and joined,
 * hold `"chapter":{...,"pages":[...]}`. Only the page order and urls matter;
 * every `/uploads/` page file is a plain image whatever the tile flags say.
 */
export function extractPages(html: string): string[] {
  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    try {
      chunks.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      // A chunk that is not a plain JSON string carries no page data.
    }
  }
  const flight = chunks.join("");

  const marker = flight.indexOf('"pages":[');
  if (marker < 0) {
    return [];
  }
  const start = flight.lastIndexOf('"chapter":{', marker);
  if (start < 0) {
    return [];
  }

  const object = balancedObject(flight, start + '"chapter":'.length);
  if (!object) {
    return [];
  }

  const chapter = JSON.parse(object) as { pages?: ElftoonPage[] };
  return (chapter.pages ?? [])
    .filter((page) => !!page.imageUrl)
    .sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0))
    .map((page) => page.imageUrl as string);
}

function balancedObject(text: string, from: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(from, i + 1);
      }
    }
  }
  return undefined;
}

export const Elftoon = new ElftoonExtension();
