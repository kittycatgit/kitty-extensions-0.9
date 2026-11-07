/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

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
  type Form,
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

import { MangaballSearchForm, MangaballSettingsForm } from "./forms";
import {
  FALLBACK_TAGS,
  HOME_SECTIONS,
  ORIGIN_LABELS,
  POPULAR_GENRES,
  SORTING_OPTIONS,
  TAG_GROUPS,
  type ApiChapter,
  type ApiChapterDetail,
  type ApiImage,
  type ApiList,
  type ApiPagination,
  type ApiTag,
  type ApiTitle,
  type MangaballMetadata,
  type TagGroup,
} from "./models";
import { MangaballInterceptor } from "./network";
import type pbconfigType from "./pbconfig";
import { getAdultMode, getLanguageSetting, isLanguageAllowed } from "./settings";

const DOMAIN = "https://mangaball.com";
const API = `${DOMAIN}/api/v1`;
const COVER_CDN = "https://bulbasaur.poke-black-and-white.net/covers/";
const PLACEHOLDER_COVER = `${DOMAIN}/images/groups/icons/default.png`;

const TAGS_STATE_KEY = "mangaball_tags_v2";
const TAGS_TTL_MS = 24 * 60 * 60 * 1000;

// Titles and chapters are Mongo ids; share links append a cosmetic slug.
const HEX_ID = /[a-f0-9]{24}/i;

type TagCache = { fetchedAt: number; groups: TagGroup[] };

class MangaballExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new MangaballInterceptor("main", DOMAIN);

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getJson<T>(path: string, query: string): Promise<T> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${API}/${path}${query ? `?${query}` : ""}`,
      method: "GET",
    });
    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  }

  // ---- discover -----------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: section.type,
      })),
      { id: "genres", title: "Popular Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const genres = (await this.getTagGroups()).find((group) => group.id === "genre")?.tags ?? [];
      return {
        items: POPULAR_GENRES.flatMap((name) => {
          const tag = genres.find((entry) => entry.title === name);
          return tag
            ? [
                {
                  type: "genresCarouselItem" as const,
                  name: tag.title,
                  searchQuery: {
                    title: "",
                    metadata: { tags: { [tag.id]: "included" } } satisfies MangaballMetadata,
                  },
                },
              ]
            : [];
        }),
      };
    }

    const home = HOME_SECTIONS.find((entry) => entry.id === section.id);
    if (!home) {
      return { items: [] };
    }

    const paging = metadata as MangaballMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }
    const page = paging?.page ?? 1;

    const query = [
      home.query,
      `limit=${home.limit}`,
      home.paged ? `page=${page}` : undefined,
      `adult_mode=${getAdultMode()}`,
    ]
      .filter(Boolean)
      .join("&");
    const response = await this.getJson<ApiList<ApiTitle>>(home.path, query);
    const titles = (response.data ?? []).filter((title) => titleId(title) && title.name);

    let items: DiscoverSectionItem[];
    switch (home.type) {
      case DiscoverSectionType.featured:
        items = titles.map((title) => ({
          type: "featuredCarouselItem" as const,
          ...baseItem(title),
          ...(synopsis(title) ? { summary: synopsis(title) } : {}),
        }));
        break;
      case DiscoverSectionType.chapterUpdates:
        // Freshly imported titles carry no chapters yet; the site shows them as
        // "No chapters available", which is nothing to open.
        items = titles.flatMap((title) => {
          const chapter = title.recent_chapters?.[0];
          if (!chapter?.id) return [];
          const published = chapter.created_at ? new Date(chapter.created_at) : undefined;
          return [
            {
              type: "chapterUpdatesCarouselItem" as const,
              ...baseItem(title),
              chapterId: chapter.id,
              subtitle: [chapter.name, chapter.lang?.toUpperCase()].filter(Boolean).join(" · "),
              ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
            },
          ];
        });
        break;
      case DiscoverSectionType.prominentCarousel:
        items = titles.map((title) => ({
          type: "prominentCarouselItem" as const,
          ...baseItem(title),
          ...withSubtitle(title),
        }));
        break;
      default:
        items = titles.map((title) => ({
          type: "simpleCarouselItem" as const,
          ...baseItem(title),
          ...withSubtitle(title),
        }));
    }

    // A listing that stops paginating hands back its first page again; the
    // first id tells that apart from a real next page.
    const firstId = titles[0] ? titleId(titles[0]) : undefined;
    if (paging?.firstId && paging.firstId === firstId) {
      return { items: [], metadata: { completed: true } };
    }
    const more = home.paged
      ? response.pagination
        ? hasMore(response.pagination, page)
        : titles.length >= home.limit
      : false;

    return {
      items,
      metadata: more ? { page: page + 1, ...(firstId ? { firstId } : {}) } : { completed: true },
    };
  }

  // ---- manga --------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = HEX_ID.exec(mangaId)?.[0] ?? mangaId;
    const response = await this.getJson<{ data?: ApiTitle }>(`title/detail/${id}`, "");
    const title = response.data;
    if (!title?.name) {
      throw new Error(`Title ${id} was not found`);
    }

    const tagGroups: TagSection[] = [];
    for (const group of TAG_GROUPS) {
      const tags = (title.tags ?? [])
        .filter((tag) => tag.group === group.id && tag.id && tag.name)
        .map((tag) => ({ id: tag.id, title: tag.name }));
      if (tags.length) {
        tagGroups.push({ id: group.id, title: group.title, tags });
      }
    }

    const people = title.authors?.length ? title.authors : (title.author ?? []);
    const authors = people.filter((p) => !p.roles?.length || p.roles.includes("author"));
    const artists = people.filter((p) => p.roles?.includes("artist"));

    const additionalInfo: Record<string, string> = {};
    const origin = title.originalLanguage ? ORIGIN_LABELS[title.originalLanguage] : undefined;
    if (origin) additionalInfo["Type"] = origin;
    if (title.publicationDemographic) {
      additionalInfo["Demographic"] = capitalize(title.publicationDemographic);
    }
    if (title.date_published) additionalInfo["Year"] = String(title.date_published);
    const chapterCount = title.chapters_count ?? title.stats?.chapters;
    if (chapterCount) additionalInfo["Chapters"] = String(chapterCount);
    if (title.stats?.views) additionalInfo["Views"] = title.stats.views.toLocaleString("en-US");
    if (title.stats?.followers) additionalInfo["Followers"] = String(title.stats.followers);
    if (title.availableTranslatedLanguages?.length) {
      additionalInfo["Languages"] = title.availableTranslatedLanguages.join(", ");
    }
    if (title.ratings?.total_rating) {
      additionalInfo["Rating"] =
        `${title.ratings.rating_average} / 10 (${title.ratings.total_rating} votes)`;
    }

    const secondaryTitles: string[] = [];
    for (const alt of title.alternateName ?? []) {
      if (alt && alt !== title.name && !secondaryTitles.includes(alt)) {
        secondaryTitles.push(alt);
      }
    }

    const rating = title.ratings?.rating_average;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title.name,
        secondaryTitles,
        thumbnailUrl: coverUrl(title.image),
        synopsis: synopsis(title),
        contentRating: contentRating(title),
        shareUrl: `${DOMAIN}/title-detail/${id}${title.slug ? `-${title.slug}` : ""}`,
        ...(title.status ? { status: capitalize(title.status) } : {}),
        ...(authors.length ? { author: authors.map((p) => p.name).join(", ") } : {}),
        ...(artists.length ? { artist: artists.map((p) => p.name).join(", ") } : {}),
        ...(rating ? { rating: rating / 10 } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = HEX_ID.exec(sourceManga.mangaId)?.[0] ?? sourceManga.mangaId;
    const languages = getLanguageSetting();
    const language = languages.includes("all") ? "all" : languages.join(",");

    const rows: ApiChapter[] = [];
    const limit = 1000;
    for (let page = 1; ; page++) {
      const response = await this.getJson<ApiList<ApiChapter>>(
        "title/chapter-listing",
        `title_id=${id}&page=${page}&limit=${limit}&group_by=flat&sort_order=desc&language=${encodeURIComponent(language)}`,
      );
      rows.push(...(response.data ?? []));
      if (!response.pagination || !hasMore(response.pagination, page)) break;
    }

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const lang = (row.lang ?? "").trim();
      if (!row.id || seen.has(row.id) || !isLanguageAllowed(lang)) continue;
      seen.add(row.id);

      const published = row.created_at ? new Date(row.created_at) : undefined;
      const group = row.group_name ?? row.group?.name;
      const number = Number(row.number ?? row.chapter_number ?? 0);
      chapters.push({
        chapterId: row.id,
        sourceManga,
        langCode: lang || "en",
        chapNum: Number.isFinite(number) ? number : 0,
        ...(row.name ? { title: row.name } : {}),
        ...(row.volume ? { volume: row.volume } : {}),
        ...(group ? { version: group } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const response = await this.getJson<ApiChapterDetail>(
      "chapter-detail",
      `chapter_id=${encodeURIComponent(chapter.chapterId)}&user_id=demo_user`,
    );
    const pages = (response.data?.chapter?.pages ?? []).filter((page) => /^https?:/.test(page));
    if (pages.length === 0) {
      throw new Error(`No pages were returned for chapter ${chapter.chapterId}`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // ---- search -------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async getTagGroups(): Promise<TagGroup[]> {
    const cached = Application.getState(TAGS_STATE_KEY) as TagCache | undefined;
    if (cached?.groups?.length && Date.now() - cached.fetchedAt < TAGS_TTL_MS) {
      return cached.groups;
    }

    try {
      const response = await this.getJson<{ data?: Record<string, ApiTag[]> }>(
        "tag/get-grouped",
        "",
      );
      const groups: TagGroup[] = [];
      for (const group of TAG_GROUPS) {
        const tags = (response.data?.[group.id] ?? [])
          .filter((tag) => tag.id && tag.name)
          .map((tag) => ({ id: tag.id, title: tag.name }));
        if (tags.length) {
          groups.push({ id: group.id, title: group.title, tags });
        }
      }
      if (groups.length === 0) {
        throw new Error("Empty tag list");
      }
      Application.setState({ fetchedAt: Date.now(), groups } satisfies TagCache, TAGS_STATE_KEY);
      return groups;
    } catch {
      return cached?.groups?.length ? cached.groups : FALLBACK_TAGS;
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<MangaballSearchForm> {
    return new MangaballSearchForm(
      query.metadata as MangaballMetadata | undefined,
      await this.getTagGroups(),
    );
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as MangaballMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }
    const page = paging?.page ?? 1;
    const filters = query.metadata as MangaballMetadata | undefined;

    const params: string[] = [];
    const add = (key: string, value: string | undefined): void => {
      if (value) params.push(`${key}=${encodeURIComponent(value)}`);
    };

    add("keyword", (query.title ?? "").trim());

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [id, state] of Object.entries(filters?.tags ?? {})) {
      (state === "excluded" ? excluded : included).push(id);
    }
    add("included_tags", included.join(","));
    add("excluded_tags", excluded.join(","));
    add("tag_mode", filters?.anyTag ? "OR" : undefined);
    add("status", filters?.status);
    add("type", filters?.type);
    add("publicationDemographic", filters?.demographic);
    add("adult_mode", filters?.adultMode ?? getAdultMode());

    // A keyword search is ranked by relevance only while no sort is sent; a
    // filter-only browse needs one or the catalogue arrives in storage order.
    const sort = sortingOption?.id ?? (query.title?.trim() ? undefined : "lastupdate");
    add("sort_by", sort);
    add("sort_order", sort ? (sort === "name" ? "asc" : "desc") : undefined);
    params.push(`page=${page}`, "limit=24");

    const response = await this.getJson<ApiList<ApiTitle>>(
      "title/search-advanced",
      params.join("&"),
    );
    const titles = (response.data ?? []).filter((title) => titleId(title) && title.name);

    return {
      items: titles.map((title) => ({
        ...baseItem(title),
        ...withSubtitle(title),
      })),
      metadata: hasMore(response.pagination, page) ? { page: page + 1 } : { completed: true },
    };
  }

  // ---- misc ---------------------------------------------------------------

  async getSettingsForm(): Promise<Form> {
    return new MangaballSettingsForm();
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

function titleId(title: ApiTitle): string {
  return title.id ?? title._id ?? "";
}

function contentRating(title: ApiTitle): ContentRating {
  return title.is18plus ? ContentRating.ADULT : ContentRating.MATURE;
}

function baseItem(title: ApiTitle): {
  mangaId: string;
  imageUrl: string;
  title: string;
  contentRating: ContentRating;
} {
  return {
    mangaId: titleId(title),
    imageUrl: coverUrl(title.image),
    title: title.name,
    contentRating: contentRating(title),
  };
}

// What the site prints under a card: the newest chapter, else the count.
function withSubtitle(title: ApiTitle): { subtitle?: string } {
  const latest = title.latest_chapter ?? title.recent_chapters?.[0]?.number;
  const parts: string[] = [];
  if (latest !== undefined && latest !== null && latest !== "") {
    parts.push(`Ch. ${latest}`);
  } else if (title.stats?.chapters) {
    parts.push(`${title.stats.chapters} chapters`);
  }
  const origin = title.originalLanguage ? ORIGIN_LABELS[title.originalLanguage] : undefined;
  if (origin) parts.push(origin);
  if (parts.length === 0 && title.status) parts.push(capitalize(title.status));
  return parts.length ? { subtitle: parts.join(" · ") } : {};
}

// Same order the site's own getTitleImage uses.
function coverUrl(image: ApiImage | null | undefined): string {
  const path = image?.cover?.path?.trim();
  if (path) {
    return /^https?:\/\//.test(path) ? path : `${COVER_CDN}${path.replace(/^\/+/, "")}`;
  }
  for (const candidate of [
    image?.cdn_mangadex,
    image?.cdn_mangaupdates,
    image?.cdn_mangaupdate,
    image?.file,
  ]) {
    const url = candidate?.trim();
    if (url?.startsWith("https://")) return url;
  }
  return PLACEHOLDER_COVER;
}

function synopsis(title: ApiTitle): string {
  const description = title.description;
  const text = Array.isArray(description) ? description.join("\n\n") : (description ?? "");
  return Application.decodeHTMLEntities(text.replace(/<[^>]+>/g, "")).trim();
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ") : value;
}

function hasMore(pagination: ApiPagination | undefined, page: number): boolean {
  return (pagination?.total_pages ?? page) > page;
}

export const Mangaball = new MangaballExtension();
