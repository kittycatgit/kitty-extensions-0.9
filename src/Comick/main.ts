/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type Chapter,
  type ChapterReadActionQueueProcessingResult,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type ManagedCollection,
  type ManagedCollectionChangeset,
  type MangaProgress,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type TrackedMangaChapterReadAction,
} from "@paperback/types";

import { currentSession, library, SessionError } from "./auth";
import { ComickProgressForm, ComickSearchForm, ComickSettingsForm, storedRating } from "./forms";
import {
  API,
  COLLECTIONS,
  PAGE_SIZE,
  ROWS,
  SEEN_LIMIT,
  SORTS,
  TOP_SHELF,
  type ComickMetadata,
  type Row,
} from "./models";
import { ComickInterceptor } from "./network";
import {
  coverUrl,
  parseComic,
  parseGenres,
  parseLibraryRow,
  ratingOf,
  ratingsUpTo,
  toSearchItem,
  type ComicCard,
  type ComicResponse,
  type Genre,
  type LatestChapter,
  type LibraryRow,
} from "./parsers";
import pbconfig from "./pbconfig";

type TopResponse = {
  trending?: Record<string, ComicCard[]>;
  topFollowNewComics?: Record<string, ComicCard[]>;
  completions?: ComicCard[];
  rank?: ComicCard[];
};

type Entry = { data?: LibraryRow };
type LibraryPage = { data?: LibraryRow[]; next_cursor?: string | null };

const TOP_TTL_MS = 10 * 60 * 1000;
const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

// The home payload is one large object; it is far past what setState accepts.
let topCache: { at: number; top: TopResponse } | undefined;
let genresCache: { at: number; genres: Genre[] } | undefined;

class ComickExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new ComickInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app's own cookie store keeps the bypass cookies; nothing to hold here.
  }

  private async json<T>(url: string): Promise<T> {
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    const text = Application.arrayBufferToUTF8String(buffer);

    if (response.status !== 200) {
      throw new Error(`Comick answered ${response.status} for ${url}: ${text.slice(0, 120)}`);
    }

    return JSON.parse(text) as T;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseComic(mangaId, await this.json<ComicResponse>(`${API}/v1.0/comic/${mangaId}/`));
  }

  async getSettingsForm(): Promise<Form> {
    return new ComickSettingsForm();
  }

  // --- Search ---------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.label }));
  }

  private searchQuery(
    title: string,
    filters: ComickMetadata,
    sort: string | undefined,
    page: number,
  ): string {
    const params: string[] = [`page=${page}`, `limit=${PAGE_SIZE}`];
    const add = (key: string, value: string | undefined): void => {
      if (value) {
        params.push(`${key}=${encodeURIComponent(value)}`);
      }
    };

    add("q", title);
    add("sort", sort);

    for (const rating of ratingsUpTo(filters.rating ?? storedRating())) {
      add("content_rating", rating);
    }

    for (const [slug, mode] of Object.entries(filters.genres ?? {})) {
      add(mode === "excluded" ? "excludes" : "genres", slug);
    }

    filters.demographics?.forEach((demographic) => add("demographic", demographic));
    filters.countries?.forEach((country) => add("country", country));
    filters.statuses?.forEach((status) => add("status", status));
    add("from", filters.from);
    add("to", filters.to);
    add("minimum", filters.minimum);

    return params.join("&");
  }

  private async search(query: string): Promise<SearchResultItem[]> {
    const cards = await this.json<ComicCard[]>(`${API}/v1.0/search/?${query}`);

    if (!Array.isArray(cards)) {
      throw new Error("Comick search returned no list.");
    }

    return cards.map(toSearchItem).filter((item): item is SearchResultItem => item !== undefined);
  }

  async getSearchResults(
    query: SearchQuery<ComickMetadata>,
    metadata: ComickMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const filters = { ...(query.metadata as ComickMetadata | undefined), ...metadata };
    const title = (query.title ?? "").trim();
    // Relevance wins for a typed title; the sort only shapes browsing.
    const sort = title ? undefined : (sortingOption?.id ?? SORTS[0]!.id);

    return this.paged(
      await this.search(this.searchQuery(title, filters, sort, page)),
      page,
      filters,
    );
  }

  private async genres(): Promise<Genre[]> {
    if (genresCache && Date.now() - genresCache.at < GENRES_TTL_MS) {
      return genresCache.genres;
    }

    const genres = await this.json<Genre[]>(`${API}/genre/`);

    if (!Array.isArray(genres) || genres.length === 0) {
      throw new Error("Comick returned no genre list.");
    }

    genresCache = { at: Date.now(), genres };

    return genres;
  }

  async getAdvancedSearchForm(query: SearchQuery<ComickMetadata>): Promise<ComickSearchForm> {
    const genres = await this.genres();

    return new ComickSearchForm(
      query.metadata as ComickMetadata | undefined,
      parseGenres(genres, ["genre"]),
      parseGenres(genres, ["theme", "format", "content"]),
    );
  }

  // --- Discover -------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return ROWS.map((row) => ({ id: row.id, title: row.title, type: row.type }));
  }

  private async top(): Promise<TopResponse> {
    if (topCache && Date.now() - topCache.at < TOP_TTL_MS) {
      return topCache.top;
    }

    const top = await this.json<TopResponse>(`${API}/top`);
    topCache = { at: Date.now(), top };

    return top;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: ComickMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const row = ROWS.find((entry) => entry.id === section.id);

    if (!row) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const allowed = new Set(ratingsUpTo(storedRating()));
    const permitted = (card: ComicCard): boolean => allowed.has(card.content_rating ?? "safe");

    switch (row.source.kind) {
      case "search": {
        const query = this.searchQuery("", {}, undefined, page).replace(
          /^/,
          `${row.source.query}&`,
        );
        const results = this.paged(await this.search(query), page, metadata);

        return {
          items: results.items.map((item) => this.item(row, item)),
          metadata: results.metadata,
        };
      }
      case "top": {
        const top = await this.top();
        const list = row.source.list;
        const cards =
          list === "trending" || list === "topFollowNewComics"
            ? (top[list]?.["7"] ?? [])
            : (top[list] ?? []);
        const items = cards
          .filter(permitted)
          .map(toSearchItem)
          .filter((item): item is SearchResultItem => item !== undefined);

        if (items.length === 0) {
          throw new Error(`Comick's home payload had no "${list}" list.`);
        }

        // The lists are fixed size, so they page client-side.
        const shelf = items.slice((page - 1) * TOP_SHELF, page * TOP_SHELF);

        return {
          items: shelf.map((item) => this.item(row, item)),
          metadata: page * TOP_SHELF >= items.length ? { completed: true } : { page: page + 1 },
        };
      }
      case "latest": {
        const chapters = await this.json<LatestChapter[]>(
          `${API}/chapter/?lang=en&order=new&page=${page}&limit=${PAGE_SIZE}`,
        );

        if (!Array.isArray(chapters)) {
          throw new Error("Comick returned no latest-chapter list.");
        }

        const seen = new Set(metadata?.seen ?? []);
        const items: DiscoverSectionItem[] = [];

        for (const chapter of chapters) {
          const comic = chapter.md_comics;

          if (!comic?.hid || !chapter.hid || seen.has(comic.hid) || !permitted(comic)) {
            continue;
          }

          seen.add(comic.hid);

          const published = chapter.publish_at ? new Date(chapter.publish_at) : undefined;

          items.push({
            type: "chapterUpdatesCarouselItem",
            mangaId: comic.hid,
            chapterId: chapter.hid,
            imageUrl: coverUrl(comic.md_covers),
            title: (comic.title ?? "").trim() || comic.hid,
            contentRating: ratingOf(comic.content_rating),
            ...(chapter.chap ? { subtitle: `Ch. ${chapter.chap}` } : {}),
            ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
          });
        }

        // Pages overlap at the edges; an all-seen page is the end.
        if (items.length === 0 || page >= 100) {
          return { items, metadata: { completed: true } };
        }

        return { items, metadata: { page: page + 1, seen: [...seen].slice(-SEEN_LIMIT) } };
      }
      case "genres":
        return {
          items: parseGenres(await this.genres(), ["genre"]).map((genre) => ({
            type: "genresCarouselItem" as const,
            name: genre.title,
            searchQuery: { title: "", metadata: { genres: { [genre.id]: "included" } } },
          })),
        };
    }
  }

  private item(row: Row, card: SearchResultItem): DiscoverSectionItem {
    const base = {
      mangaId: card.mangaId,
      imageUrl: card.imageUrl,
      title: card.title,
      ...(card.contentRating ? { contentRating: card.contentRating } : {}),
    };

    switch (row.type) {
      case DiscoverSectionType.featured:
        return { type: "featuredCarouselItem", ...base };
      case DiscoverSectionType.prominentCarousel:
        return {
          type: "prominentCarouselItem",
          ...base,
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        };
      default:
        return {
          type: "simpleCarouselItem",
          ...base,
          ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        };
    }
  }

  // Past the catalog's end the API keeps answering with repeats, so an
  // all-seen page ends the row.
  private paged(
    found: SearchResultItem[],
    page: number,
    metadata: ComickMetadata | undefined,
  ): PagedResults<SearchResultItem> {
    const seen = new Set(metadata?.seen ?? []);
    const fresh = found.filter((item) => !seen.has(item.mangaId));

    if (fresh.length === 0) {
      return { items: [], metadata: { completed: true } };
    }

    for (const item of found) {
      seen.add(item.mangaId);
    }

    return {
      items: fresh,
      metadata: { ...metadata, page: page + 1, seen: [...seen].slice(-SEEN_LIMIT) },
    };
  }

  // --- Managed collections ---------------------------------------------------

  async getManagedLibraryCollections(): Promise<ManagedCollection[]> {
    return COLLECTIONS.map((collection) => ({ id: collection.id, title: collection.title }));
  }

  async getSourceMangaInManagedCollection(collection: ManagedCollection): Promise<SourceManga[]> {
    if (!currentSession()) {
      throw new SessionError("You need to be logged in");
    }

    const rows: SourceManga[] = [];
    let cursor: string | undefined;

    do {
      const query = `media_type=manga&status=${collection.id}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { body } = await library<LibraryPage>(`/me/library?${query}`);

      for (const row of body?.data ?? []) {
        if (row.hid) {
          rows.push(parseLibraryRow(row));
        }
      }

      cursor = body?.next_cursor ?? undefined;
    } while (cursor);

    return rows;
  }

  async commitManagedCollectionChanges(changeset: ManagedCollectionChangeset): Promise<void> {
    if (!currentSession()) {
      throw new SessionError("You need to be logged in");
    }

    const status = Number(changeset.collection.id);
    const entry = (hid: string): string => `/me/library/${encodeURIComponent(hid)}`;

    // Promise.all aborts the whole changeset on any failure.
    await Promise.all([
      ...(changeset.additions ?? []).map((manga) =>
        library(entry(manga.mangaId), "PUT", { status }),
      ),
      ...(changeset.deletions ?? []).map((manga) =>
        library(entry(manga.mangaId), "DELETE", undefined, [204]),
      ),
    ]);
  }

  // --- Progress ---------------------------------------------------------------

  private async entry(hid: string): Promise<LibraryRow | undefined> {
    const result = await library<Entry>(
      `/me/library/${encodeURIComponent(hid)}`,
      "GET",
      undefined,
      [200, 404],
    );

    return result.status === 200 ? result.body?.data : undefined;
  }

  async getMangaProgressManagementForm(sourceManga: SourceManga): Promise<Form> {
    if (!currentSession()) {
      throw new SessionError("You need to be logged in through the Comick settings");
    }

    return new ComickProgressForm(sourceManga.mangaId, sourceManga.mangaInfo.primaryTitle);
  }

  async getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress | undefined> {
    if (!currentSession()) {
      return undefined;
    }

    const row = await this.entry(sourceManga.mangaId);
    const number = Number(row?.progress?.number);

    if (!row || !Number.isFinite(number)) {
      return undefined;
    }

    const lastReadChapter: Chapter = {
      chapterId: row.progress?.hid ?? String(number),
      sourceManga,
      langCode: "en",
      chapNum: number,
      ...(row.progress?.volume && Number.isFinite(Number(row.progress.volume))
        ? { volume: Number(row.progress.volume) }
        : {}),
    };
    const lastReadTime = row.progressed_at ? new Date(row.progressed_at) : undefined;

    return {
      sourceManga,
      lastReadChapter,
      ...(lastReadTime && !isNaN(lastReadTime.getTime()) ? { lastReadTime } : {}),
      ...(row.rating ? { userRating: row.rating } : {}),
    };
  }

  // Comick keeps one chapter number per title, so only the furthest read
  // chapter per title is sent and remote progress is never lowered.
  async processChapterReadActionQueue(
    actions: TrackedMangaChapterReadAction[],
  ): Promise<ChapterReadActionQueueProcessingResult> {
    const successfulItems: string[] = [];
    const failedItems: string[] = [];

    if (!currentSession()) {
      return { successfulItems, failedItems: actions.map((action) => action.id) };
    }

    const byTitle = new Map<string, TrackedMangaChapterReadAction[]>();

    for (const action of actions) {
      const hid = action.sourceManga.mangaId;
      byTitle.set(hid, [...(byTitle.get(hid) ?? []), action]);
    }

    let first = true;

    for (const [hid, group] of byTitle) {
      const furthest = Math.max(...group.map((action) => action.chapterNum));

      try {
        if (!first) {
          // Library writes are limited to 60 a minute per user.
          await Application.sleep(1);
        }

        first = false;

        const row = await this.entry(hid);
        const remote = Number(row?.progress?.number);
        const path = `/me/library/${encodeURIComponent(hid)}`;
        const progress = { number: String(furthest) };

        if (!row) {
          await library(path, "PUT", { status: 1, progress });
        } else if (!(Number.isFinite(remote) && remote >= furthest)) {
          await library(path, "PATCH", { progress });
        }

        successfulItems.push(...group.map((action) => action.id));
      } catch {
        failedItems.push(...group.map((action) => action.id));
      }
    }

    return { successfulItems, failedItems };
  }
}

export const Comick = new ComickExtension();
