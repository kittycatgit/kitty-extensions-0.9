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

import { decodeId, encodeId } from "../shared/ids";
import { SanaScansSearchForm } from "./forms";
import {
  API,
  API_RAILS,
  DEFAULT_SORT,
  DOMAIN,
  HOME_RAILS,
  PAGE_SIZE,
  SORTING_OPTIONS,
  type HomeItem,
  type SanaChapterList,
  type SanaChapterPage,
  type SanaChapterRef,
  type SanaGenre,
  type SanaMetadata,
  type SanaPost,
  type SanaPostDetails,
  type SanaQueryPage,
} from "./models";
import { SanaScansInterceptor } from "./network";
import { parseHomeRail, stripHtml } from "./parsers";
import type pbconfigType from "./pbconfig";

const PLACEHOLDER_COVER = `${DOMAIN}/apple-touch-icon.png`;
const GENRE_TTL = 24 * 60 * 60 * 1000;
const HOME_TTL = 10 * 60 * 1000;

// The home page is ~600 KB, so its rails are parsed once and shared by the
// five rails that read from it.
let genreCache: { at: number; genres: SanaGenre[] } | undefined;
let homeCache: { at: number; rails: Record<string, HomeItem[]> } | undefined;

class SanaScansExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new SanaScansInterceptor("main", DOMAIN);

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

  private async getGenres(): Promise<SanaGenre[]> {
    if (genreCache && Date.now() - genreCache.at < GENRE_TTL) {
      return genreCache.genres;
    }

    const rows = await this.getJson<SanaGenre[]>(`${API}/genres`);
    const genres = (Array.isArray(rows) ? rows : [])
      .filter((row) => typeof row.id === "number" && row.name?.trim())
      .map((row) => ({ id: row.id, name: row.name.trim() }));

    if (genres.length === 0) {
      throw new Error("The genre list came back empty.");
    }

    genreCache = { at: Date.now(), genres };
    return genres;
  }

  private async getHomeRail(key: string): Promise<HomeItem[]> {
    if (!homeCache || Date.now() - homeCache.at > HOME_TTL) {
      const html = await this.getText(`${DOMAIN}/`);
      const rails: Record<string, HomeItem[]> = {};
      for (const rail of HOME_RAILS) {
        rails[rail.key] = parseHomeRail(html, rail.key);
      }
      homeCache = { at: Date.now(), rails };
    }

    const items = homeCache.rails[key] ?? [];
    if (items.length === 0) {
      throw new Error(`The home page carried no items for ${key}.`);
    }
    return items;
  }

  private async queryPosts(
    params: string,
    page: number,
  ): Promise<{ posts: SanaPost[]; hasMore: boolean }> {
    const result = await this.getJson<SanaQueryPage>(
      `${API}/query?page=${page}&perPage=${PAGE_SIZE}&${params}`,
    );
    const posts = result.posts ?? [];
    const total = result.totalCount ?? 0;
    return { posts, hasMore: posts.length > 0 && page * PAGE_SIZE < total };
  }

  private async latestPosts(page: number): Promise<{ posts: SanaPost[]; hasMore: boolean }> {
    const result = await this.getJson<SanaQueryPage>(
      `${API}/posts?page=${page}&perPage=${PAGE_SIZE}&isNovel=false`,
    );
    const posts = result.posts ?? [];
    const total = result.totalCount ?? 0;
    return { posts, hasMore: posts.length > 0 && page * PAGE_SIZE < total };
  }

  private cover(url: string | undefined): string {
    return url?.trim() || PLACEHOLDER_COVER;
  }

  private postSubtitle(post: SanaPost): string | undefined {
    const bits: string[] = [];
    const latest = post.chapters?.[0];
    if (latest && typeof latest.number === "number") {
      bits.push(`Ch. ${latest.number}`);
    } else if (post._count?.chapters) {
      bits.push(`${post._count.chapters} chapters`);
    }
    if (post.seriesStatus) bits.push(titleCase(post.seriesStatus));
    return bits.length ? bits.join(" • ") : undefined;
  }

  private homeSubtitle(item: HomeItem): string | undefined {
    const bits: string[] = [];
    if (item.views) bits.push(`${withCommas(item.views)} views`);
    if (item.chapters) bits.push(`${item.chapters} chapters`);
    if (!item.views && !item.chapters && item.genres?.length) bits.push(item.genres.join(", "));
    if (item.status) bits.push(titleCase(item.status));
    return bits.length ? bits.join(" • ") : undefined;
  }

  private toSearchResult(post: SanaPost): SearchResultItem {
    const subtitle = this.postSubtitle(post);
    return {
      mangaId: encodeId(post.slug),
      title: post.postTitle.trim(),
      imageUrl: this.cover(post.featuredImage),
      contentRating: ContentRating.MATURE,
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = decodeId(mangaId);
    const details = await this.getJson<SanaPostDetails>(
      `${API}/post?postSlug=${encodeURIComponent(slug)}`,
    );
    const post = details.post;
    if (!post?.slug) {
      throw new Error(`No series found for ${mangaId}.`);
    }

    const tagGroups: TagSection[] = [];
    const genres = (post.genres ?? []).filter((genre) => genre.name?.trim());
    if (genres.length) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genres.map((genre) => ({ id: String(genre.id), title: genre.name.trim() })),
      });
    }

    const secondaryTitles = (post.alternativeTitles ?? "")
      .split(/[\n|;]/)
      .map((title) => title.trim())
      .filter((title) => title && title !== post.postTitle);

    const chapterCount = details.totalChapterCount ?? post._count?.chapters;
    const additionalInfo: Record<string, string> = {};
    if (post.seriesType) additionalInfo["Type"] = titleCase(post.seriesType);
    if (chapterCount) additionalInfo["Chapters"] = String(chapterCount);
    if (post.totalViews) additionalInfo["Views"] = withCommas(post.totalViews);
    if (post._count?.bookmarks) additionalInfo["Bookmarks"] = withCommas(post._count.bookmarks);
    if (post.totalRatings) additionalInfo["Ratings"] = withCommas(post.totalRatings);
    if (post.chaptersPricing)
      additionalInfo["Locked chapter price"] = `${post.chaptersPricing} coins`;
    if (post.createdAt) additionalInfo["Added"] = post.createdAt.slice(0, 10);

    const author = post.author?.trim();
    const artist = post.artist?.trim();
    const rating = typeof post.averageRating === "number" ? post.averageRating / 10 : undefined;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: post.postTitle.trim(),
        secondaryTitles,
        thumbnailUrl: this.cover(post.featuredImage),
        synopsis: stripHtml(post.postContent),
        contentRating: ContentRating.MATURE,
        shareUrl: `${DOMAIN}/series/${encodeURIComponent(post.slug)}`,
        ...(post.seriesStatus ? { status: titleCase(post.seriesStatus) } : {}),
        ...(author ? { author } : {}),
        ...(artist ? { artist } : {}),
        ...(rating !== undefined ? { rating: Math.min(1, Math.max(0, rating)) } : {}),
        contentType: "comic",
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    // Only the numeric post id unlocks the chapter list, and only the post
    // endpoint carries it.
    const details = await this.getJson<SanaPostDetails>(
      `${API}/post?postSlug=${encodeURIComponent(decodeId(mangaId))}`,
    );
    const postId = details.post?.id;
    if (typeof postId !== "number") {
      throw new Error(`No series found for ${mangaId}.`);
    }

    const list = await this.getJson<SanaChapterList>(`${API}/chapters?postId=${postId}`);
    const rows = list.post?.chapters ?? [];
    const total = list.totalChapterCount ?? rows.length;
    if (rows.length < total) {
      throw new Error(`Only ${rows.length} of ${total} chapters were returned for ${mangaId}.`);
    }

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const rawSlug = (row.slug ?? "").trim();
      const chapterId = rawSlug ? encodeId(rawSlug) : "";
      const chapNum = Number(row.number);
      if (!chapterId || seen.has(chapterId) || !Number.isFinite(chapNum)) continue;
      seen.add(chapterId);

      const title = row.title?.trim();
      const published = row.createdAt ? new Date(row.createdAt) : undefined;
      chapters.push({
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum,
        sortingIndex: chapNum,
        ...(title ? { title } : {}),
        ...(row.isAccessible === false ? { version: "Locked" } : {}),
        ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const page = await this.getJson<SanaChapterPage>(
      `${API}/chapter?mangaslug=${encodeURIComponent(decodeId(mangaId))}&chapterslug=${encodeURIComponent(decodeId(chapter.chapterId))}`,
    );
    const row = page.chapter;
    if (!row) {
      throw new Error(`Chapter ${chapter.chapterId} was not found for ${mangaId}.`);
    }

    if (row.isAccessible === false || row.isLocked) {
      const price = row.price ? `${row.price} coins` : "coins";
      throw new Error(
        `Chapter ${row.number} is locked and costs ${price} on sanascans.com. Unlock it there with an account first.`,
      );
    }

    const pages = [...(row.images ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((image) => image.url)
      .filter((url) => url?.startsWith("http"));

    if (pages.length === 0) {
      throw new Error(`No pages were returned for chapter ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId, pages };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<SanaScansSearchForm> {
    return new SanaScansSearchForm(query.metadata as SanaMetadata | undefined, this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as SanaMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const filters = { ...(query.metadata as SanaMetadata | undefined), ...paging };
    const page = paging?.page ?? 1;
    const sort = sortingOption?.id ?? DEFAULT_SORT;
    const title = (query.title ?? "").trim();

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [id, state] of Object.entries(filters.genres ?? {})) {
      (state === "excluded" ? excluded : included).push(id);
    }

    const params = [`orderBy=${sort}`, `orderDirection=${sort === "postTitle" ? "asc" : "desc"}`];
    if (title) params.push(`searchTerm=${encodeURIComponent(title)}`);
    if (included.length) params.push(`genreIds=${included.join(",")}`);
    if (excluded.length) params.push(`excludedGenreIds=${excluded.join(",")}`);
    if (filters.types?.length) params.push(`seriesType=${filters.types.join(",")}`);
    if (filters.statuses?.length) params.push(`seriesStatus=${filters.statuses.join(",")}`);

    const { posts, hasMore } = await this.queryPosts(params.join("&"), page);
    const next: SanaMetadata = hasMore ? { ...filters, page: page + 1 } : { completed: true };
    delete next.completed;
    if (!hasMore) next.completed = true;

    return { items: posts.map((post) => this.toSearchResult(post)), metadata: next };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...HOME_RAILS.map((rail) => ({
        id: rail.id,
        title: rail.title,
        type:
          rail.id === "hero" ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
      })),
      ...API_RAILS.map((rail) => ({
        id: rail.id,
        title: rail.title,
        type:
          rail.id === "latestUpdates"
            ? DiscoverSectionType.chapterUpdates
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
          name: genre.name,
          searchQuery: {
            title: "",
            metadata: { genres: { [String(genre.id)]: "included" } } satisfies SanaMetadata,
          },
        })),
        metadata: { completed: true },
      };
    }

    const paging = metadata as SanaMetadata | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const home = HOME_RAILS.find((rail) => rail.id === section.id);
    if (home) {
      return { items: this.homeItems(await this.getHomeRail(home.key), section.id === "hero") };
    }

    const rail = API_RAILS.find((entry) => entry.id === section.id);
    if (!rail) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = paging?.page ?? 1;
    const { posts, hasMore } = rail.latest
      ? await this.latestPosts(page)
      : await this.queryPosts(rail.query!, page);

    const items: DiscoverSectionItem[] = [];
    for (const post of posts) {
      if (section.id === "latestUpdates") {
        const newest = post.chapters?.[0];
        if (!newest?.slug) continue;
        const published = newest.createdAt ? new Date(newest.createdAt) : undefined;
        items.push({
          type: "chapterUpdatesCarouselItem",
          mangaId: encodeId(post.slug),
          chapterId: encodeId(newest.slug),
          imageUrl: this.cover(post.featuredImage),
          title: post.postTitle.trim(),
          subtitle: chapterLabel(newest),
          contentRating: ContentRating.MATURE,
          ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
        });
        continue;
      }

      const subtitle = this.postSubtitle(post);
      items.push({
        type: "simpleCarouselItem",
        mangaId: encodeId(post.slug),
        imageUrl: this.cover(post.featuredImage),
        title: post.postTitle.trim(),
        contentRating: ContentRating.MATURE,
        ...(subtitle ? { subtitle } : {}),
      });
    }

    return { items, metadata: hasMore ? { page: page + 1 } : { completed: true } };
  }

  private homeItems(items: HomeItem[], featured: boolean): DiscoverSectionItem[] {
    return items.map((item) => {
      const base = {
        mangaId: encodeId(item.slug),
        imageUrl: this.cover(item.cover),
        title: item.title,
        contentRating: ContentRating.MATURE,
      };
      if (featured) {
        return {
          type: "featuredCarouselItem" as const,
          ...base,
          ...(item.summary ? { summary: item.summary } : {}),
          ...(item.chapters ? { supertitle: `${item.chapters} chapters` } : {}),
        };
      }
      const subtitle = this.homeSubtitle(item);
      return {
        type: "simpleCarouselItem" as const,
        ...base,
        ...(subtitle ? { subtitle } : {}),
      };
    });
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

function chapterLabel(chapter: SanaChapterRef): string {
  const label = `Chapter ${chapter.number}`;
  return chapter.isAccessible === false ? `${label} (locked)` : label;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function withCommas(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const SanaScans = new SanaScansExtension();
