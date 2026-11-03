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
  type TagSection,
} from "@paperback/types";

import { decodeImageList, decryptImagePath } from "./crypto";
import { SoraRawSearchForm } from "./forms";
import {
  DEFAULT_SORT,
  LISTING_SECTIONS,
  SORTING_OPTIONS,
  TOP_SECTIONS,
  type SoraChapterPage,
  type SoraGenre,
  type SoraGenreRef,
  type SoraIndexEntry,
  type SoraItem,
  type SoraListingProps,
  type SoraManga,
  type SoraPagination,
  type SoraSearchMetadata,
  type SoraTop,
} from "./models";
import { SoraRawInterceptor } from "./network";
import type pbconfigType from "./pbconfig";

const DOMAIN = "https://soraraw.com";
const THUMB_DOMAIN = "https://i.mangaraw.lat";
// Resolved by the site from an obfuscated `config.json` field; the value is stable.
const IMAGE_API = "https://api.mangarawgo.site";

const PAGE_SIZE = 48;
const INDEX_PAGE_LIMIT = 40;
const MIN_GENRE_TOTAL = 20;
const DAY = 24 * 60 * 60 * 1000;

// The search index is ~18 MB of JSON, far past the setState ceiling, so it
// lives in module scope for the life of the extension.
let indexCache: { at: number; entries: SoraIndexEntry[] } | undefined;
let genreCache: { at: number; genres: SoraGenre[] } | undefined;

type HomeProps = SoraListingProps;

class SoraRawExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new SoraRawInterceptor("main", DOMAIN);

  private buildId?: string;

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return Application.arrayBufferToUTF8String(buffer);
  }

  private async getJson<T>(url: string): Promise<T> {
    return JSON.parse(await this.getText(url)) as T;
  }

  private async getBuildId(force = false): Promise<string> {
    if (this.buildId && !force) {
      return this.buildId;
    }

    const html = await this.getText(`${DOMAIN}/`);
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

  private async getListing(
    path: string,
    page: number,
    slug?: string,
  ): Promise<{ items: SoraItem[]; pagination?: SoraPagination }> {
    // The app runtime has no URLSearchParams; slugs are ASCII so this is safe.
    const params: string[] = [];
    if (slug) params.push(`slug=${encodeURIComponent(slug)}`);
    if (page > 1) params.push(`page=${page}`);
    const query = params.length ? `?${params.join("&")}` : "";
    const route = page > 1 ? `${path}/page/${page}.json` : `${path}.json`;

    const props = await this.getPageProps<SoraListingProps>(route, query);
    return { items: props.data?.results ?? [], pagination: props.data?.pagination };
  }

  private async getGenres(): Promise<SoraGenre[]> {
    if (genreCache && Date.now() - genreCache.at < DAY) {
      return genreCache.genres;
    }

    const all = await this.getJson<SoraGenre[]>(`${DOMAIN}/genres.json`);
    const genres = all.filter((genre) => genre.total >= MIN_GENRE_TOTAL && !!genre.slug);
    genreCache = { at: Date.now(), genres };
    return genres;
  }

  // The site has no server-side search: it ships its catalogue as static
  // JSON pages and searches them in the browser. Pages stop at the first 404.
  private async getIndex(): Promise<SoraIndexEntry[]> {
    if (indexCache && Date.now() - indexCache.at < DAY) {
      return indexCache.entries;
    }

    const entries: SoraIndexEntry[] = [];
    for (let page = 1; page <= INDEX_PAGE_LIMIT; page++) {
      let list: SoraIndexEntry[];
      try {
        list =
          (await this.getJson<{ list?: SoraIndexEntry[] }>(`${DOMAIN}/mangas_${page}.json`)).list ??
          [];
      } catch {
        break;
      }
      if (list.length === 0) {
        break;
      }
      for (const entry of list) {
        if (entry.dcma === "no" && entry.slug) {
          entries.push({
            id: entry.id,
            name: entry.name,
            alt_names: entry.alt_names,
            slug: entry.slug,
            author: entry.author,
            img: entry.img,
            views: entry.views,
            number_bookmark: entry.number_bookmark,
            mode: entry.mode,
            type: entry.type,
            genres: entry.genres,
            c_name: entry.c_name,
            c_title: entry.c_title,
            c_published: entry.c_published,
            is_adult: entry.is_adult,
          });
        }
      }
    }

    if (entries.length === 0) {
      throw new Error("The search index came back empty.");
    }

    indexCache = { at: Date.now(), entries };
    return entries;
  }

  private coverOf(item: { image?: string; img?: string }): string {
    const file = item.image ?? item.img;
    return file ? `${THUMB_DOMAIN}/${file}` : `${DOMAIN}/soraraw.webp`;
  }

  private subtitleOf(item: { c_name?: number | null; c_title?: string | null }): string {
    if (item.c_name !== null && item.c_name !== undefined) {
      return `第${item.c_name}話`;
    }
    return item.c_title ?? "";
  }

  private toSearchResult(item: SoraItem | SoraIndexEntry): SearchResultItem {
    const subtitle = this.subtitleOf(item);
    return {
      mangaId: item.slug,
      title: item.name,
      imageUrl: this.coverOf(item),
      contentRating: item.is_adult === "yes" ? ContentRating.ADULT : ContentRating.MATURE,
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const props = await this.getPageProps<{ data: { manga: SoraManga } }>(
      `manga/${mangaId}.json`,
      `?slug=${encodeURIComponent(mangaId)}`,
    );
    const manga = props.data.manga;

    const tagGroups: TagSection[] = [];
    if (manga.genres?.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: manga.genres.map((genre) => ({ id: genre.slug, title: genre.name })),
      });
    }

    const chapters = manga.chapters ?? [];
    const additionalInfo: Record<string, string> = {};
    if (chapters.length) additionalInfo["Chapters"] = String(chapters.length);
    const latest = chapters[0];
    if (latest) additionalInfo["Latest chapter"] = latest.title ?? `第${latest.name ?? ""}話`;
    if (manga.views) additionalInfo["Views"] = withCommas(manga.views);
    if (manga.number_bookmark) {
      additionalInfo["Bookmarks"] = withCommas(manga.number_bookmark);
    }
    if (manga.number_rate) additionalInfo["Ratings"] = String(manga.number_rate);
    if (manga.mode) additionalInfo["Reading direction"] = manga.mode;
    if (manga.is_doujin === "yes") additionalInfo["Doujinshi"] = "Yes";
    if (manga.is_bl === "yes") additionalInfo["BL"] = "Yes";

    const secondaryTitles: string[] = [];
    for (const alt of manga.names ?? []) {
      if (alt.name && alt.name !== manga.name && !secondaryTitles.includes(alt.name)) {
        secondaryTitles.push(alt.name);
      }
    }

    const rating = Number(manga.rate);
    const author = manga.author?.trim();

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.name,
        secondaryTitles,
        thumbnailUrl: this.coverOf(manga),
        synopsis: synopsisOf(manga),
        contentRating: manga.is_adult === "yes" ? ContentRating.ADULT : ContentRating.MATURE,
        shareUrl: `${DOMAIN}/manga/${mangaId}`,
        status: manga.type === "complete" ? "Completed" : "Ongoing",
        ...(author ? { author } : {}),
        ...(rating > 0 ? { rating: rating / 5 } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const props = await this.getPageProps<{ data: { manga: SoraManga } }>(
      `manga/${sourceManga.mangaId}.json`,
      `?slug=${encodeURIComponent(sourceManga.mangaId)}`,
    );

    const chapters: Chapter[] = [];
    for (const row of props.data.manga.chapters ?? []) {
      const tail = row.path.split("-ch-")[1];
      if (!tail) {
        continue;
      }

      const published = row.published_at ? new Date(row.published_at) : undefined;
      chapters.push({
        chapterId: `ch-${tail}`,
        sourceManga,
        langCode: "ja",
        chapNum: chapterNumber(row.name, tail),
        sortingIndex: parseFloat(String(row.order)) || 0,
        ...(row.title ? { title: row.title } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => (b.sortingIndex ?? 0) - (a.sortingIndex ?? 0));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const props = await this.getPageProps<{ data: SoraChapterPage }>(
      `manga/${mangaId}/${chapter.chapterId}.json`,
      `?slug=${encodeURIComponent(mangaId)}&slug1=${encodeURIComponent(chapter.chapterId)}`,
    );
    const meta = props.data.chapter;

    const opensAt = meta.schedule_open_at ? new Date(meta.schedule_open_at) : undefined;
    if (meta.mode === "spoiler" || (opensAt && opensAt.getTime() > Date.now())) {
      throw new Error(
        `This chapter is not released yet${opensAt ? ` (opens ${opensAt.toISOString()})` : ""}.`,
      );
    }

    const stamp = meta.updated_at ? Date.parse(meta.updated_at) : Date.now();
    const payload = await this.getJson<{ d?: string }>(
      `${IMAGE_API}/${meta.manga_id}/${meta.id}.json?t=${stamp}`,
    );
    if (!payload.d) {
      throw new Error("The image list came back empty.");
    }

    // Server B carries every chapter; T and D only hold older ones.
    const hosts: [keyof typeof meta, "b" | "d" | "t" | "p"][] = [
      ["_b", "b"],
      ["_t", "t"],
      ["_d", "d"],
      ["_p", "p"],
    ];
    const pages: string[] = [];
    for (const row of decodeImageList(payload.d)) {
      for (const [hostKey, pathKey] of hosts) {
        const host = meta[hostKey];
        const encrypted = row[pathKey];
        if (typeof host === "string" && host && encrypted) {
          pages.push(`${host}/${decryptImagePath(encrypted, meta.uuid)}`);
          break;
        }
      }
    }

    if (pages.length === 0) {
      throw new Error("No readable image host was offered for this chapter.");
    }

    return { id: chapter.chapterId, mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<SoraRawSearchForm> {
    return new SoraRawSearchForm(
      query.metadata as SoraSearchMetadata | undefined,
      this.getGenres(),
    );
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as SoraSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = { ...(query.metadata as SoraSearchMetadata | undefined), ...paging };
    const page = paging?.page ?? 1;
    const sort = sortingOption?.id ?? DEFAULT_SORT;
    const title = (query.title ?? "").trim();

    const included = Object.entries(filters.genres ?? {})
      .filter(([, state]) => state === "included")
      .map(([slug]) => slug);
    const excluded = Object.entries(filters.genres ?? {})
      .filter(([, state]) => state === "excluded")
      .map(([slug]) => slug);

    // The server only lists by date, and by one genre or one status at a
    // time; anything richer runs over the static index instead.
    const serverSide =
      !title &&
      sort === DEFAULT_SORT &&
      !filters.content &&
      !filters.mode &&
      excluded.length === 0 &&
      (included.length === 0 || (included.length === 1 && !filters.status));

    let items: SearchResultItem[];
    let more: boolean;

    if (serverSide) {
      const route = included[0]
        ? this.getListing("genre/" + included[0], page, included[0])
        : this.getListing(
            filters.status === "complete"
              ? "complete"
              : filters.status === "ongoing"
                ? "on-going"
                : "newest",
            page,
          );
      const listing = await route;
      items = listing.items.map((item) => this.toSearchResult(item));
      more = (listing.pagination?.total_page ?? page) > page;
    } else {
      const [index, genres] = await Promise.all([this.getIndex(), this.getGenres()]);
      const idOf = new Map(genres.map((genre) => [genre.slug, genre.id]));
      const includedIds = included.map((slug) => idOf.get(slug)).filter(isNumber);
      const excludedIds = excluded.map((slug) => idOf.get(slug)).filter(isNumber);
      const tokens = title.toLowerCase().split(/\s+/).filter(Boolean);

      const matches = index.filter((entry) => {
        if (filters.status === "ongoing" && entry.type !== "incomplete") return false;
        if (filters.status === "complete" && entry.type !== "complete") return false;
        if (filters.content === "adult" && entry.is_adult !== "yes") return false;
        if (filters.content === "general" && entry.is_adult === "yes") return false;
        if (filters.mode && entry.mode !== filters.mode) return false;
        const entryGenres = entry.genres ?? [];
        if (includedIds.some((id) => !entryGenres.includes(id))) return false;
        if (excludedIds.some((id) => entryGenres.includes(id))) return false;
        if (tokens.length) {
          const haystack =
            `${entry.name} ${entry.alt_names ?? ""} ${entry.author ?? ""}`.toLowerCase();
          if (tokens.some((token) => !haystack.includes(token))) return false;
        }
        return true;
      });

      matches.sort((a, b) => {
        if (sort === "views") return (b.views ?? 0) - (a.views ?? 0);
        if (sort === "bookmark") return (b.number_bookmark ?? 0) - (a.number_bookmark ?? 0);
        return (b.c_published ?? "").localeCompare(a.c_published ?? "");
      });

      const start = (page - 1) * PAGE_SIZE;
      items = matches.slice(start, start + PAGE_SIZE).map((entry) => this.toSearchResult(entry));
      more = start + PAGE_SIZE < matches.length;
    }

    const next: SoraSearchMetadata = more ? { ...filters, page: page + 1 } : { completed: true };
    return { items, metadata: next };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "hero", title: "Featured", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      ...TOP_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: "ongoing", title: "Ongoing", type: DiscoverSectionType.simpleCarousel },
      { id: "completed", title: "Completed", type: DiscoverSectionType.simpleCarousel },
      ...(await this.getHomeGenreRails()).map((genre) => ({
        id: `genre-${genre.slug}`,
        title: genre.name,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  private homeGenres?: SoraGenreRef[];

  private async getHomeGenreRails(): Promise<SoraGenreRef[]> {
    if (this.homeGenres) {
      return this.homeGenres;
    }
    const home = await this.getPageProps<HomeProps>("index.json");
    this.homeGenres = (home.data?.genres ?? []).map(({ id, name, slug }) => ({ id, name, slug }));
    return this.homeGenres;
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
            metadata: { genres: { [genre.slug]: "included" } } satisfies SoraSearchMetadata,
          },
          ...(genre.is_adult === "yes" ? { contentRating: ContentRating.ADULT } : {}),
        })),
      };
    }

    const paging = metadata as SoraSearchMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }
    const page = paging?.page ?? 1;

    let items: SoraItem[];
    let more = false;

    const top = TOP_SECTIONS.find((entry) => entry.id === section.id);
    const listing = LISTING_SECTIONS.find((entry) => entry.id === section.id);

    if (section.id === "hero") {
      const home = await this.getPageProps<HomeProps>("index.json");
      items = home.data?.hot ?? [];
    } else if (top) {
      const file = await this.getJson<SoraTop>(`${DOMAIN}/top/${top.file}.json`);
      const all = file[top.key] ?? [];
      const start = (page - 1) * PAGE_SIZE;
      items = all.slice(start, start + PAGE_SIZE);
      more = start + PAGE_SIZE < all.length;
    } else if (listing) {
      const result = await this.getListing(listing.path, page);
      items = result.items;
      more = (result.pagination?.total_page ?? page) > page;
    } else if (section.id.startsWith("genre-")) {
      const slug = section.id.slice("genre-".length);
      const result = await this.getListing(`genre/${slug}`, page, slug);
      items = result.items;
      more = (result.pagination?.total_page ?? page) > page;
    } else {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const isFeatured = section.id === "hero";
    return {
      items: items.map((item) => {
        const base = {
          mangaId: item.slug,
          imageUrl: this.coverOf(item),
          title: item.name,
          contentRating: item.is_adult === "yes" ? ContentRating.ADULT : ContentRating.MATURE,
        };
        if (isFeatured) {
          return {
            type: "featuredCarouselItem" as const,
            ...base,
            ...(item.author ? { supertitle: item.author } : {}),
          };
        }
        const subtitle = this.subtitleOf(item);
        return {
          type: "simpleCarouselItem" as const,
          ...base,
          ...(subtitle ? { subtitle } : {}),
        };
      }),
      metadata: more ? { page: page + 1 } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

// `name` is the chapter number but can be null; the path tail then carries it
// with the decimal point written as a hyphen (`ch-53-5`).
function chapterNumber(name: number | null, tail: string): number {
  if (typeof name === "number" && !isNaN(name)) {
    return name;
  }
  const parsed = parseFloat(tail.replace("-", "."));
  return isNaN(parsed) ? 0 : parsed;
}

// The synopsis is an Editor.js document; its leading blocks are SEO keyword
// lines, which are dropped when a real paragraph follows them.
function synopsisOf(manga: SoraManga): string {
  if (manga.description) {
    return manga.description;
  }
  if (!manga.content) {
    return "";
  }

  let blocks: { type?: string; data?: { text?: string } }[];
  try {
    blocks = (JSON.parse(manga.content) as { blocks?: typeof blocks }).blocks ?? [];
  } catch {
    return "";
  }

  const paragraphs = blocks
    .map((block) =>
      Application.decodeHTMLEntities((block.data?.text ?? "").replace(/<[^>]+>/g, "")).trim(),
    )
    .filter(Boolean);
  const keywordLine = /\b(raw|free|zip|pdf|torrent)\b/i;
  const prose = paragraphs.filter((text) => !keywordLine.test(text));
  return (prose.length ? prose : paragraphs).join("\n\n");
}

export const SoraRaw = new SoraRawExtension();
