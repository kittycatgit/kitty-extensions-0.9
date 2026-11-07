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

import { encodeId } from "../shared/ids";
import { MangaKSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  HOME_SECTIONS,
  RANKED_SECTIONS,
  SORTING_OPTIONS,
  type MangaKChapter,
  type MangaKChapterFeed,
  type MangaKItem,
  type MangaKMetadata,
  type MangaKPagination,
  type MangaKRef,
  type Option,
} from "./models";
import { MangaKInterceptor } from "./network";
import type pbconfigType from "./pbconfig";

const DOMAIN = "https://mangak.io";

// The series page embeds only the newest 50 chapters; the site's own reader
// reads the whole list from here.
const API_DOMAIN = "https://api.mangak.io";

type Listing = { items?: MangaKItem[]; pagination?: MangaKPagination };
type SearchListing = { ssrItems?: MangaKItem[]; ssrPagination?: MangaKPagination };

class MangaKExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new MangaKInterceptor("main", DOMAIN);

  /** Next.js embeds a build id in its data routes; it changes on every deploy. */
  private buildId?: string;

  private genreCache?: MangaKRef[];

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getBuildId(force = false): Promise<string> {
    if (this.buildId && !force) {
      return this.buildId;
    }

    const html = await this.getText(`${DOMAIN}/home`);
    const buildId = /"buildId":"([^"]+)"/.exec(html)?.[1];
    if (!buildId) {
      throw new Error("Unable to resolve the site build id");
    }

    this.buildId = buildId;
    return buildId;
  }

  // A stale build id yields a 404, so resolve it again once before giving up.
  private async getPageProps<T>(path: string, query = ""): Promise<T> {
    for (const force of [false, true]) {
      const buildId = await this.getBuildId(force);
      try {
        const body = await this.getText(`${DOMAIN}/_next/data/${buildId}/${path}${query}`);
        return (JSON.parse(body) as { pageProps: T }).pageProps;
      } catch (error) {
        if (force) {
          throw error;
        }
      }
    }

    throw new Error(`Unable to load ${path}`);
  }

  private toSearchResult(item: MangaKItem): SearchResultItem {
    const subtitle = [item.displayChapters, item.displayUpdated].filter(Boolean).join(" · ");

    return {
      mangaId: item.slug,
      title: item.name,
      imageUrl: item.cover ?? "",
      contentRating: item.isAdult ? ContentRating.ADULT : ContentRating.MATURE,
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const props = await this.getPageProps<{ initialManga: MangaKItem }>(`${mangaId}.json`);
    const manga = props.initialManga;

    const tagGroups: TagSection[] = [];
    const asTags = (refs: MangaKRef[] | undefined): Tag[] =>
      (refs ?? [])
        .filter((ref) => ref?.slug && ref.name)
        .map((ref) => ({ id: encodeId(ref.slug), title: ref.name }));
    const genres = asTags(manga.genres);
    if (genres.length) {
      tagGroups.push({ id: "genres", title: "Genres", tags: genres });
    }
    const tags = asTags(manga.tags);
    if (tags.length) {
      tagGroups.push({ id: "tags", title: "Tags", tags });
    }

    const additionalInfo: Record<string, string> = {};
    if (manga.type?.name) additionalInfo["Type"] = capitalize(manga.type.name);
    if (manga.demographic) additionalInfo["Demographic"] = capitalize(manga.demographic);
    if (manga.contentRating) additionalInfo["Content rating"] = capitalize(manga.contentRating);
    if (manga.displayChapters) additionalInfo["Chapters"] = manga.displayChapters;
    if (manga.displayViews) additionalInfo["Views"] = manga.displayViews;
    if (manga.displayBookmarks) additionalInfo["Bookmarks"] = manga.displayBookmarks;
    if (manga.displayUpdated) additionalInfo["Updated"] = manga.displayUpdated;
    if (manga.isRaw) additionalInfo["Raw"] = "Yes";
    if (manga.isMtl) additionalInfo["Machine translated"] = "Yes";

    // `altNames` holds `{ name, language }` objects; `secondaryTitles` is a
    // plain string array and the app rejects anything else.
    const secondaryTitles: string[] = [];
    for (const alt of manga.altNames ?? []) {
      const name = typeof alt === "string" ? alt : alt?.name;
      if (name && name !== manga.name && !secondaryTitles.includes(name)) {
        secondaryTitles.push(name);
      }
    }
    if (manga.altName && manga.altName !== manga.name && !secondaryTitles.includes(manga.altName)) {
      secondaryTitles.push(manga.altName);
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.name,
        secondaryTitles,
        thumbnailUrl: manga.cover ?? "",
        synopsis: manga.summary ?? "",
        contentRating: manga.isAdult ? ContentRating.ADULT : ContentRating.MATURE,
        shareUrl: `${DOMAIN}/${mangaId}`,
        ...(manga.status ? { status: capitalize(manga.status) } : {}),
        ...(manga.authors?.[0] ? { author: manga.authors.map((a) => a.name).join(", ") } : {}),
        ...(manga.artists?.[0] ? { artist: manga.artists.map((a) => a.name).join(", ") } : {}),
        ...(manga.rating ? { rating: manga.rating } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const props = await this.getPageProps<{ initialManga: MangaKItem; mangaHsid?: string }>(
      `${sourceManga.mangaId}.json`,
    );

    const rows = props.mangaHsid
      ? await this.getChapterFeed(props.mangaHsid)
      : (props.initialManga.chapters ?? []);

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const entry of rows) {
      const chapterId = entry.slug || entry.url?.split("/").filter(Boolean).pop();
      if (!chapterId || seen.has(chapterId)) {
        continue;
      }
      seen.add(chapterId);

      const updated = entry.updatedAt ?? entry.updated_at;
      const published = updated ? new Date(updated) : undefined;
      chapters.push({
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum: chapterNumber(entry),
        ...(entry.name ? { title: entry.name } : {}),
        ...(entry.group ? { version: entry.group } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  private async getChapterFeed(hsid: string): Promise<MangaKChapter[]> {
    const body = await this.getText(`${API_DOMAIN}/titles/${hsid}/chapters`);
    const rows = (JSON.parse(body) as MangaKChapterFeed).data?.chapters ?? [];

    // Better to fail than to quietly hand back the truncated page-props list.
    if (rows.length === 0) {
      throw new Error(`No chapters were returned for ${hsid}.`);
    }

    return rows;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const props = await this.getPageProps<{
      initialChapter: { images?: string[]; pages?: { url?: string }[] };
    }>(`${chapter.sourceManga.mangaId}/${chapter.chapterId}.json`);

    const images = props.initialChapter.images?.length
      ? props.initialChapter.images
      : (props.initialChapter.pages ?? []).map((page) => page.url ?? "");

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: images.filter((page) => !!page),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async getGenres(): Promise<MangaKRef[]> {
    if (this.genreCache) {
      return this.genreCache;
    }

    const props = await this.getPageProps<{ genres?: MangaKRef[] }>("latest.json");
    this.genreCache = (props.genres ?? []).filter((genre) => genre?.slug && genre.name);
    return this.genreCache;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<MangaKSearchForm> {
    let genres: Option[] | undefined;
    try {
      genres = (await this.getGenres()).map((genre) => ({
        id: encodeId(genre.slug),
        title: genre.name,
      }));
    } catch {
      genres = undefined;
    }

    return new MangaKSearchForm(query.metadata as MangaKMetadata | undefined, genres);
  }

  // Every filter the site's own search page knows, in its query vocabulary.
  private searchQuery(
    title: string,
    filters: MangaKMetadata | undefined,
    sort: string | undefined,
    page: number,
  ): string {
    const params: string[] = [];
    const add = (key: string, value: string | undefined): void => {
      if (value) {
        params.push(`${key}=${encodeURIComponent(value)}`);
      }
    };

    add("q", title);

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [slug, state] of Object.entries(filters?.genres ?? {})) {
      (state === "excluded" ? excluded : included).push(decodeURIComponent(slug));
    }
    add("genres", included.join(","));
    add("exclude", excluded.join(","));

    add("status", filters?.status);
    add("type", filters?.type);
    add("demographic", filters?.demographics?.join(","));
    add("content_rating", filters?.rating);
    add("format", filters?.formats?.join(","));
    add("min_ch", filters?.minChapters);
    add("max_ch", filters?.maxChapters);
    add("tag", filters?.tag);
    add("author", filters?.author);
    if (filters?.raw) add("raw", "true");
    if (filters?.uncensored) add("uncensored", "true");
    if (filters?.mtl) add("mtl", "true");

    // A title search is ranked by relevance only while no sort is sent: any sort
    // reorders the site's fuzzy match set instead, and "naruto" sorted by latest
    // comes back without a single Naruto title. So the sort picker only applies
    // to filter-only searches, which need one or the catalogue arrives unordered.
    add("sort", title ? undefined : (sort ?? DEFAULT_SORT));
    params.push(`page=${page}`);

    return `?${params.join("&")}`;
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as MangaKMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const filters = query.metadata as MangaKMetadata | undefined;
    const props = await this.getPageProps<SearchListing>(
      "search.json",
      this.searchQuery((query.title ?? "").trim(), filters, sortingOption?.id, page),
    );
    const items = props.ssrItems ?? [];

    return {
      items: items.map((item) => this.toSearchResult(item)),
      metadata: hasMore(props.ssrPagination, page) ? { page: page + 1 } : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type:
          section.id === "hero" ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
      })),
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      ...RANKED_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
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
          name: genre.name,
          searchQuery: {
            title: "",
            metadata: { genres: { [encodeId(genre.slug)]: "included" } } satisfies MangaKMetadata,
          },
        })),
      };
    }

    const paging = metadata as MangaKMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const home = HOME_SECTIONS.find((entry) => entry.id === section.id);
    const ranked = RANKED_SECTIONS.find((entry) => entry.id === section.id);

    let items: MangaKItem[];
    let pagination: MangaKPagination | undefined;

    if (home) {
      // Every home rail is delivered in one payload, so it does not paginate.
      const props = await this.getPageProps<Record<string, MangaKItem[]>>("home.json");
      items = props[home.prop] ?? [];
    } else if (ranked) {
      const props = await this.getPageProps<SearchListing>(
        "search.json",
        this.searchQuery("", undefined, ranked.sort, page),
      );
      items = props.ssrItems ?? [];
      pagination = props.ssrPagination;
    } else {
      const props = await this.getPageProps<Listing>("latest.json", `?page=${page}`);
      items = props.items ?? [];
      pagination = props.pagination;
    }

    const isFeatured = section.id === "hero";
    return {
      items: items
        .filter((item) => item?.slug && item.name)
        .map((item) => {
          const base = {
            mangaId: item.slug,
            imageUrl: item.cover ?? "",
            title: item.name,
            ...(item.isAdult ? { contentRating: ContentRating.ADULT } : {}),
          };

          if (isFeatured) {
            return {
              type: "featuredCarouselItem" as const,
              ...base,
              ...(item.summary ? { summary: item.summary } : {}),
            };
          }

          const subtitle = [item.displayChapters, item.displayUpdated].filter(Boolean).join(" · ");
          return {
            type: "simpleCarouselItem" as const,
            ...base,
            ...(subtitle ? { subtitle } : {}),
          };
        }),
      metadata: home
        ? { completed: true }
        : hasMore(pagination, page)
          ? { page: page + 1 }
          : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

// The feed's `number` is a running index (Chapter 194 is number 218 once the
// .5 chapters are counted), so the number is read off the name instead.
function chapterNumber(entry: { name: string; slug?: string }): number {
  const fromName = /(\d+(?:\.\d+)?)/.exec(entry.name)?.[1];
  if (fromName) {
    return Number(fromName);
  }

  const fromSlug = /chapter-(\d+)(?:-(\d+))?(?:$|-)/.exec(entry.slug ?? "");
  if (fromSlug) {
    return Number(fromSlug[2] ? `${fromSlug[1]}.${fromSlug[2]}` : fromSlug[1]);
  }

  return 0;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function hasMore(pagination: MangaKPagination | undefined, page: number): boolean {
  if (!pagination) {
    return false;
  }

  if (typeof pagination.has_next === "boolean") {
    return pagination.has_next;
  }

  return (pagination.total_pages ?? page) > page;
}

export const MangaK = new MangaKExtension();
