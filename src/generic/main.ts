/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  CookieStorageInterceptor,
  DiscoverSectionType,
  Form,
  PaperbackInterceptor,
  URL,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";

import type { basePbConfig } from "./config";
import { getUsePostIds, MadaraSearchForm, MadaraSettings } from "./forms";
import { SORTING_OPTIONS, type MadaraSearchMetadata } from "./models";
import { MadaraInterceptor } from "./network";
import { MadaraParser } from "./parsers";

export interface GenericParams {
  name: string;
  domain: string;
  contentRating: ContentRating;
  language: string;
  usePostIds: boolean;
  searchPagePathName?: string;
  searchMangaSelector?: string;
  searchRatingSelector?: string;
  hasProtectedChapters?: boolean;
  protectedChapterDataSelector?: string;
  chapterEndpoint?: number;
  chapterDetailsSelector?: string;
  bypassPage?: string;
  useListParameter?: boolean;
  directoryPath?: string;
  parser?: MadaraParser;
  requestManager?: PaperbackInterceptor;
  userAgent?: string;
}

type Metadata = {
  page?: number;
  completed?: boolean;
};

export abstract class MadaraGeneric implements ExtensionImpl<typeof basePbConfig> {
  readonly domain: string;

  readonly name: string;

  readonly defaultContentRating: ContentRating;

  readonly language: string;

  readonly usePostIds: boolean;

  // The path segment before the page number: /page/2/?s&post_type=wp-manga -> "page".
  readonly searchPagePathName: string;

  readonly searchMangaSelector: string;

  readonly searchRatingSelector: string;

  // True when the site runs the wp-manga-chapter-protector plugin.
  readonly hasProtectedChapters: boolean;

  readonly protectedChapterDataSelector: string;

  // Picks one of the four request shapes in getChapters().
  readonly chapterEndpoint: number;

  readonly chapterDetailsSelector: string;

  // Page the app must load to solve Cloudflare when only part of the site is challenged.
  readonly bypassPage: string;

  // Set this when the directory path parser gets it wrong.
  readonly directoryPath: string;

  // Some sources redirect to the manga page when ?style=list is added.
  readonly useListParameter: boolean;

  readonly userAgent?: string;

  parser: MadaraParser;

  requestManager: PaperbackInterceptor;

  constructor(params: GenericParams) {
    this.name = params.name;
    this.domain = params.domain;
    this.defaultContentRating = params.contentRating ?? ContentRating.EVERYONE;
    this.language = params.language ?? "🇬🇧";
    this.usePostIds = params.usePostIds ?? true;
    this.searchPagePathName = params.searchPagePathName ?? "page";
    this.searchMangaSelector = params.searchMangaSelector ?? "div.c-tabs-item__content";
    this.searchRatingSelector = params.searchRatingSelector ?? "span.score";
    this.hasProtectedChapters = params.hasProtectedChapters ?? false;
    this.protectedChapterDataSelector =
      params.protectedChapterDataSelector ?? "#chapter-protector-data";
    this.chapterEndpoint = params.chapterEndpoint ?? 3;
    this.chapterDetailsSelector = params.chapterDetailsSelector ?? "div.page-break > img";
    this.bypassPage = params.bypassPage ?? "";
    this.directoryPath = params.directoryPath ?? "";
    this.useListParameter = params.useListParameter ?? true;
    this.parser = params.parser ?? new MadaraParser();
    this.requestManager = params.requestManager ?? new MadaraInterceptor("main", this);
    this.userAgent = params.userAgent;
  }

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  async initialise(): Promise<void> {
    this.cookieStorageInterceptor.registerInterceptor();
    this.requestManager?.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new MadaraSettings(this.name, this.domain);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const [_response, buffer] = await Application.scheduleRequest({
      url: getUsePostIds(this.usePostIds)
        ? `${this.domain}/?p=${mangaId}/`
        : `${this.domain}/temp_dirpath/${mangaId}/`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    return this.parser.parseMangaDetails($, mangaId, this);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    let requestConfig: Request;
    const mangaId = await this.getPostAndSlug(sourceManga.mangaId);

    switch (this.chapterEndpoint) {
      case 0:
        requestConfig = {
          url: `${this.domain}/wp-admin/admin-ajax.php`,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `action=manga_get_chapters&manga=${encodeURIComponent(mangaId.postId)}`,
        };
        break;

      case 1:
        requestConfig = {
          url: `${this.domain}/temp_dirpath/${mangaId.slug}/ajax/chapters`,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
        };
        break;

      case 2:
        requestConfig = {
          url: `${this.domain}/temp_dirpath/${mangaId.slug}`,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
        };
        break;

      case 3:
        requestConfig = {
          url: `${this.domain}/temp_dirpath/${mangaId.slug}`,
          method: "GET",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
        };
        break;

      default:
        throw new Error("Invalid chapter endpoint!");
    }

    const [_response, buffer] = await Application.scheduleRequest(requestConfig);

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    return this.parser.parseChapterList($, sourceManga, this);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = await this.getPostAndSlug(chapter.sourceManga.mangaId);
    const chapterId = chapter.chapterId;

    const url = new URL(this.domain).addPathComponent("temp_dirpath");
    url.addPathComponent(mangaId.slug);

    url.addPathComponent(chapterId);

    if (this.useListParameter) {
      url.setQueryItem("style", "list");
    }

    const [_response, buffer] = await Application.scheduleRequest({
      url: url.toString(),
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    if (this.hasProtectedChapters) {
      return this.parser.parseProtectedChapterDetails(
        $,
        chapter,
        this.protectedChapterDataSelector,
        this,
      );
    }

    return this.parser.parseChapterDetails($, chapter, this.chapterDetailsSelector, this);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "new_series",
        title: "New Series",
        type: DiscoverSectionType.featured,
      },
      {
        id: "recently_updated",
        title: "Recently Updated",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "currently_trending",
        title: "Currently Trending",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "most_popular",
        title: "Most Popular",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let param = "";
    const page = metadata?.page ?? 1;

    switch (section.id) {
      case "new_series":
        param = "?m_orderby=new-manga";
        break;
      case "recently_updated":
        param = "?m_orderby=latest";
        break;
      case "currently_trending":
        param = "?m_orderby=trending";
        break;
      case "most_popular":
        param = "?m_orderby=views";
        break;

      default:
        throw new Error("Invalid sectionId provided!");
    }

    const [_response, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/temp_dirpath/page/${page}/${param}`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    const items = await this.parser.parseDiscoverSections($, section, this);

    metadata = { page: page + 1 }; // Madara has no last-page marker; it just 404s past the end.

    return {
      items: items,
      metadata: metadata,
    };
  }

  async fetchGenres(): Promise<Tag[]> {
    const [_response, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/?s=&post_type=wp-manga`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    const tagSections = await this.parser.parseSearchTags($);
    const genreTags = tagSections.find((x) => x.id === "genres") as TagSection;

    return genreTags.tags;
  }

  async getAdvancedSearchForm(query: SearchQuery<MadaraSearchMetadata>): Promise<MadaraSearchForm> {
    return new MadaraSearchForm(query.metadata, this.fetchGenres());
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getSearchResults(
    query: SearchQuery<MadaraSearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;

    const [_response, buffer] = await this.constructSearchRequest(page, query, sortingOption);

    if (_response.status === 404) {
      return { items: [], metadata: undefined }; // Past the last page Madara answers 404.
    }

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    const results = await this.parser.parseSearchResults($, this);

    const usePostIds = getUsePostIds(this.usePostIds);
    const items: SearchResultItem[] = await Promise.all(
      results.map(async (result) => ({
        mangaId: usePostIds ? (await this.getPostAndSlug(result.slug)).postId : result.slug,
        imageUrl: result.image,
        title: result.title,
        subtitle: result.subtitle,
      })),
    );

    return {
      items: items,
      metadata: items.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  // Called by the app once the user has cleared the in-app Cloudflare challenge.
  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.storeBypassCookies(cookies);
  }

  /** @deprecated the app now calls {@link cloudflareBypassCompleted}. */
  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
    this.storeBypassCookies(cookies);
  }

  private storeBypassCookies(cookies: Cookie[]): void {
    for (const cookie of cookies) {
      // cf_clearance carries the bypass, but the site's own session cookie is
      // issued alongside it and is needed too.
      if (/^(?:__)?_?cf/i.test(cookie.name) || /session|phpsessid/i.test(cookie.name)) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  constructSearchRequest(
    page: number,
    query: SearchQuery<MadaraSearchMetadata>,
    sortingOption?: SortingOption,
  ) {
    const urlBuilder = new URL(this.domain)
      .addPathComponent(this.searchPagePathName)
      .addPathComponent(page.toString())
      .setQueryItem("s", this.sanitizeQuery(query?.title ?? ""))
      .setQueryItem("post_type", "wp-manga");

    const genreFilters = Object.keys(query.metadata?.genres ?? {});

    if (genreFilters.length) {
      genreFilters.forEach((genre, i) => urlBuilder.setQueryItem(`genre[${i}]`, genre));
      urlBuilder.setQueryItem("op", "1");
    }

    if (sortingOption && sortingOption.id !== "relevance") {
      urlBuilder.setQueryItem("m_orderby", sortingOption.id);
    }

    return Application.scheduleRequest({
      url: urlBuilder.toString(),
      method: "GET",
    });
  }

  // Convert smart quotes; iOS types them by default and the search rejects them.
  sanitizeQuery(query: string): string {
    return query.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  }

  async getPostAndSlug(mangaId: string) {
    const isPostId = !isNaN(Number(mangaId));
    let postId: number = 0;
    let slug: string = "";

    if (!isPostId) {
      slug = mangaId.toString();

      if (getUsePostIds(this.usePostIds)) {
        postId = Application.getState(slug) as number;
        if (!postId) {
          postId = await this.convertSlugToPostId(slug);
        }
      }
    } else {
      const postIdInput = Number(mangaId);

      slug = Application.getState(postIdInput.toString()) as string;

      if (!slug) {
        slug = (await this.convertPostIdToSlug(postIdInput)).slug;
      }

      postId = postIdInput;
    }

    if (getUsePostIds(this.usePostIds)) {
      Application.setState(postId.toString(), slug);
      Application.setState(slug, postId.toString());
    }

    return {
      postId: postId.toString(),
      slug: slug,
    };
  }

  async convertPostIdToSlug(postId: number) {
    const [, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/?p=${postId}`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    let parseURL: string;
    parseURL = $('meta[property="og:url"]').attr("content") ?? "";

    if (!parseURL.includes(this.domain)) {
      parseURL = $('link[rel="canonical"]').attr("href") ?? "";
    }

    if (!parseURL.includes(this.domain)) {
      throw new Error(`Unable to parse slug for postId: ${postId}!`);
    }

    const URLSplit = parseURL.replace(/\/$/, "").split("/");

    const slug: string = URLSplit.slice(-1).pop() ?? "";
    const path: string = URLSplit.slice(-2).shift() ?? "";

    if (!slug) {
      throw new Error(`Unable to fetch slug for this item! postId: ${postId}`);
    }

    return { path, slug };
  }

  async convertSlugToPostId(slug: string): Promise<number> {
    // The Link header on a HEAD response carries ?p=<postId>. Credit to the MadaraDex team.
    const [headResponse] = await Application.scheduleRequest({
      url: `${this.domain}/temp_dirpath/${slug}`,
      method: "HEAD",
    });

    const postIdRegex = headResponse?.headers?.["link"]?.match(/\?p=(\d+)/);
    const postIdMatch = postIdRegex?.[1] ? Number(postIdRegex[1]) : NaN;
    if (!isNaN(postIdMatch)) {
      return postIdMatch;
    }

    const [, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/temp_dirpath/${slug}`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    const postId_1 = $('link[rel="shortlink"]')?.attr("href")?.split("/?p=")[1];
    if (postId_1) {
      const postId = Number(postId_1);
      if (!isNaN(postId)) {
        return postId;
      }
    }

    const postId_2 = $("a.wp-manga-action-button")?.attr("data-post");
    if (postId_2) {
      const postId = Number(postId_2);
      if (!isNaN(postId)) {
        return postId;
      }
    }

    const page = $.root().html();
    const match = page?.match(/manga_id["']?\s*:\s*["']?(\d+)/);
    if (match?.[1]) {
      const postId = Number(match[1]);
      if (!isNaN(postId)) {
        return postId;
      }
    }

    throw new Error(`Unable to fetch numeric postId for this item! slug:${slug}`);
  }

  async getDirectoryPath(): Promise<string> {
    if (this.directoryPath) {
      return this.directoryPath;
    }

    const getPath = Application.getState(`dirpath_${this.domain}`) as string;
    if (getPath) {
      return getPath;
    }

    const [_response, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/?s=&post_type=wp-manga#directoryRequest`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    const path = this.parser.parseDirectoryPath($, this); // Falls back to "manga".

    Application.setState(path, `dirpath_${this.domain}`);
    return path;
  }
}
