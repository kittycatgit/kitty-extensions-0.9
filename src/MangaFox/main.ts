/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// oxlint-disable no-eval

// TODO:
// - Add the English name to the title view
// - Add additional info to the title view
// - Make getChapterDetails only return new chapters
// - Fix exclude search
// - Remove eval usage

import {
  BasicRateLimiter,
  ContentRating,
  CookieStorageInterceptor,
  DiscoverSectionType,
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
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import {
  SearchFilterForm,
  type SearchFilter,
  type SearchFilterValue,
} from "@paperback/types/lib/compat/0.8";
import * as cheerio from "cheerio";
import { type CheerioAPI } from "cheerio";

import { genreOptions } from "./genreOptions";
import { genres } from "./genres";
import { DOMAIN, MOBILE_DOMAIN, type Metadata } from "./models";

// Covers come as plain http (or protocol-relative) from the markup; the app refuses plain http (ATS) and the CDN serves https.
const httpsUrl = (u: string | undefined): string =>
  (u ?? "").replace(/^http:\/\//, "https://").replace(/^\/\//, "https://");
import { MangaFoxInterceptor } from "./network";
import type MangaFoxConfig from "./pbconfig";

// Main extension class
export class MangaFoxExtension implements ExtensionImpl<typeof MangaFoxConfig> {
  // Implementation of the main rate limiter
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 4,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // Implementation of the main interceptor
  mainInterceptor = new MangaFoxInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  // Method from the Extension interface which we implement, initializes the rate limiter, interceptor, discover sections and search filters
  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor(); // last, so its headers are what goes out
  }

  // Every block of the site's home page in the site's order, plus the directory's completed view and the genres grid.
  // Text-only home blocks (ranking, trending) have no covers there, so those rails come from their own listing pages.
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "hot-release", title: "Hot Manga Releases", type: DiscoverSectionType.featured },
      { id: "being-read", title: "Being Read Right Now", type: DiscoverSectionType.simpleCarousel },
      { id: "ranking", title: "Popular Manga Ranking", type: DiscoverSectionType.simpleCarousel },
      { id: "recommended", title: "Recommended", type: DiscoverSectionType.simpleCarousel },
      { id: "new-manga", title: "New Manga Release", type: DiscoverSectionType.prominentCarousel },
      { id: "latest-updates", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: "trending", title: "Trending Manga", type: DiscoverSectionType.simpleCarousel },
      { id: "completed", title: "Completed", type: DiscoverSectionType.simpleCarousel },
      { id: "get-genre-section", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  // Populates both the discover sections
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "hot-release":
        return this.homeBlock("Hot Manga Releases", "featuredCarouselItem");
      case "being-read":
        return this.homeBlock("Being Read Right Now");
      case "recommended":
        return this.homeBlock("Recommended");
      case "ranking":
        return this.listPage(() => `${DOMAIN}/ranking/`, metadata, false);
      case "trending":
        return this.listPage(() => `${DOMAIN}/trending/`, metadata, false);
      case "new-manga":
        return this.listPage(
          (n) => (n > 1 ? `${DOMAIN}/directory/${n}.html?news` : `${DOMAIN}/directory/?news`),
          metadata,
          true,
        );
      case "completed":
        return this.listPage(
          (n) =>
            n > 1 ? `${DOMAIN}/directory/${n}.html?complete` : `${DOMAIN}/directory/?complete`,
          metadata,
          true,
        );
      case "latest-updates":
        return this.getLatestUpdates(section, metadata);
      case "get-genre-section":
        return this.getGenresSectionItems();
      default:
        return { items: [] };
    }
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  // Cover tiles of a listing (home blocks, /hot/, /ranking/, /trending/, /directory/): list-1 and list-3 share the item markup.
  private tiles(
    $: CheerioAPI,
    root: unknown,
    kind: "simpleCarouselItem" | "featuredCarouselItem" = "simpleCarouselItem",
  ): DiscoverSectionItem[] {
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $("ul.manga-list-1-list > li, ul.manga-list-3-list > li", root as string).each((_, element) => {
      const unit = $(element);
      const mangaLink = $('a[href^="/manga/"]', unit).first();
      const mangaId = mangaLink.attr("href")?.split("/manga/")[1]?.replace(/\//g, "") || "";
      const image = httpsUrl($("img.manga-list-1-cover", unit).attr("src"));
      const title = mangaLink.attr("title")?.trim() ?? "";
      const subtitle = $("p.manga-list-1-item-subtitle", unit).text().trim();
      const safeId = decodeURIComponent(mangaId)
        .replace(/[^\w@.]/g, "_")
        .trim();
      if (!safeId || !title || !image || seen.has(safeId)) return;
      seen.add(safeId);
      items.push(
        kind === "featuredCarouselItem"
          ? {
              type: "featuredCarouselItem",
              mangaId: safeId,
              imageUrl: image,
              title,
              ...(subtitle ? { supertitle: subtitle } : {}),
            }
          : createDiscoverSectionItem({
              id: safeId,
              image,
              title,
              subtitle,
              type: "simpleCarouselItem",
            }),
      );
    });
    return items;
  }

  // The home page block with this heading.
  private async homeBlock(
    heading: string,
    kind: "simpleCarouselItem" | "featuredCarouselItem" = "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await this.fetchCheerio({ url: `${DOMAIN}/`, method: "GET" });
    const block = $("div.manga-list-1, div.manga-list-3")
      .filter((_, element) =>
        $("div.manga-list-1-title, div.manga-list-3-title", element)
          .first()
          .text()
          .includes(heading),
      )
      .first();
    return { items: this.tiles($, block, kind), metadata: undefined };
  }

  // A listing page; paged ones advance while the pager's ">" link points at a real page.
  private async listPage(
    urlFor: (page: number) => string,
    metadata: Metadata | undefined,
    paged: boolean,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const $ = await this.fetchCheerio({ url: urlFor(page), method: "GET" });
    const items = this.tiles($, $.root());
    const more =
      paged &&
      $(".pager-list-left a")
        .toArray()
        .some((a) => $(a).text().trim() === ">" && ($(a).attr("href") ?? "").startsWith("/"));
    return { items, metadata: more && items.length > 0 ? { page: page + 1 } : undefined };
  }

  async getLatestUpdates(
    section: DiscoverSection,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = [];
    const collectedIds = metadata?.collectedIds ?? [];
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;

    // Build the URL with proper pagination
    // Slash-terminated: /releases without it 301s to plain http, which iOS refuses.
    const request = {
      url: page > 1 ? `${DOMAIN}/releases/${page}.html` : `${DOMAIN}/releases/`,
      method: "GET",
    };

    const $ = await this.fetchCheerio(request);

    // Process manga items - updated for manga-list-4 structure
    $("div.manga-list-4 ul.manga-list-4-list li").each((_, element) => {
      const unit = $(element);

      const mangaLink = $("p.manga-list-4-item-title a", unit).first();
      const mangaId = mangaLink.attr("href")?.split("/manga/")[1]?.replace(/\//g, "") || "";
      const image = httpsUrl($("img.manga-list-4-cover", unit).attr("src"));
      const title = mangaLink.attr("title")?.trim() ?? "";
      //const subtitle = $('p.manga-list-4-item-subtitle', unit).text().trim();
      const subtitle = $("ul.manga-list-4-item-part > li", unit).first().text().trim();

      const safeId = decodeURIComponent(mangaId)
        .replace(/[^\w@.]/g, "_")
        .trim();

      if (safeId && title && image && !collectedIds.includes(safeId)) {
        collectedIds.push(safeId);
        items.push(
          createDiscoverSectionItem({
            id: safeId,
            image: image,
            title: title,
            subtitle: subtitle,
            type: "simpleCarouselItem",
          }),
        );
      }
    });

    // Improved pagination detection based on the provided HTML
    let nextPage: number | undefined;

    // Look for the ">" link which indicates next page is available
    const nextPageLink = $(".pager-list-left a").filter(function () {
      return $(this).text() === ">";
    });

    if (nextPageLink.length > 0) {
      const nextPageHref = nextPageLink.attr("href");
      if (nextPageHref) {
        // Extract page number from href format like "/directory/2.html?news"
        const pageMatch = nextPageHref.match(/\/directory\/(\d+)\.html/);
        if (pageMatch && pageMatch[1]) {
          nextPage = parseInt(pageMatch[1], 10);
        } else {
          // Fallback - increment current page
          nextPage = page + 1;
        }
      }
    }

    return {
      items: items,
      metadata: nextPage ? { page: nextPage, collectedIds } : undefined,
    };
  }

  // Populates the genres section
  async getGenresSectionItems(): Promise<PagedResults<DiscoverSectionItem>> {
    // We are using genres array from the imported file here
    return {
      items: genres.map((genre) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          filters: [{ id: "genres", value: { [genre.id]: "included" } }],
        },
        name: genre.name,
        // No need to pass metadata for genres as it's a static list
        metadata: undefined,
      })),
    };
  }

  // Populate search filters
  async getSearchFilters(): Promise<SearchFilter[]> {
    const filters: SearchFilter[] = [];

    // Type filter dropdown
    filters.push({
      id: "genres",
      type: "multiselect",
      options: genreOptions,
      allowExclusion: true,
      value: {},
      title: "Genre Filter",
      allowEmptySelection: false,
      maximum: undefined,
    });

    return filters;
  }

  // Populates search
  async getSearchResults(
    query: SearchQuery<SearchFilterValue[]>,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const collectedIds = metadata?.collectedIds ?? [];
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const urlBuilder = new URL(DOMAIN).addPathComponent("search");
    let fixedUrl = "";

    if (page > 1) {
      urlBuilder.setQueryItem("page", page.toString());
    }

    // Get the filters to access the genre options
    const filters = await this.getSearchFilters();
    const genreFilter = filters.find((f) => f.id === "genres");

    // Define type for the multiselect filter
    interface FilterOption {
      id: string;
      value: string;
    }

    type MultiselectFilter = SearchFilter & {
      type: "multiselect";
      options: FilterOption[];
    };

    // Handle genres
    const genresFilter = query.metadata?.find((f) => f.id === "genres")?.value as Record<
      string,
      "included" | "excluded"
    >;
    if (genresFilter && genreFilter) {
      const typedGenreFilter = genreFilter as MultiselectFilter;
      Object.entries(genresFilter).forEach(([id, inclusion]) => {
        if (inclusion === "included") {
          // Get the genre option by id with proper typing
          const genreOption = typedGenreFilter.options.find((opt) => opt.id === id);
          if (genreOption) {
            // Use the genre's ID directly for the query parameter
            urlBuilder.setQueryItem("genres", genreOption.id);
          }
        }
        // Excluded genres not supported in the provided URL examples
      });
    }

    if (query.title && query.title.trim() !== "") {
      // Don't encode apostrophes as they should remain in the URL
      urlBuilder.setQueryItem("title", query.title);

      fixedUrl = urlBuilder.toString();
    } else {
      urlBuilder.removeQueryItem("title");
      const url = urlBuilder.toString();

      fixedUrl = url.replace("title=%22%22", "title=");
    }

    const request = {
      url: fixedUrl,
      method: "GET",
    };

    const $ = await this.fetchCheerio(request);
    const searchResults: SearchResultItem[] = [];

    // Process manga items - updated for manga-list-4 structure
    $("div.manga-list-4 ul.manga-list-4-list li").each((_, element) => {
      const unit = $(element);

      const mangaLink = $("p.manga-list-4-item-title a", unit).first();
      const mangaId = mangaLink.attr("href")?.split("/manga/")[1]?.replace(/\//g, "") || "";
      const image = httpsUrl($("img.manga-list-4-cover", unit).attr("src"));
      const title = mangaLink.attr("title")?.trim() ?? "";
      //const subtitle = $('p.manga-list-4-item-subtitle', unit).text().trim();
      const subtitle = $("ul.manga-list-4-item-part > li", unit).first().text().trim();

      const safeId = decodeURIComponent(mangaId)
        .replace(/[^\w@.]/g, "_")
        .trim();

      if (safeId && title && image && !collectedIds.includes(safeId)) {
        collectedIds.push(safeId);
        searchResults.push({
          mangaId: safeId,
          imageUrl: image,
          title: title,
          subtitle: subtitle,
        });
      }
    });

    // Improved pagination detection based on the provided HTML
    let nextPage: number | undefined;

    // Look for the ">" link which indicates next page is available
    const nextPageLink = $(".pager-list-left a").filter(function () {
      return $(this).text() === ">";
    });

    if (nextPageLink.length > 0) {
      const nextPageHref = nextPageLink.attr("href");
      if (nextPageHref) {
        // Extract page number from href format like "/directory/2.html?news"
        const pageMatch = nextPageHref.match(/\/directory\/(\d+)\.html/);
        if (pageMatch && pageMatch[1]) {
          nextPage = parseInt(pageMatch[1], 10);
        } else {
          // Fallback - increment current page
          nextPage = page + 1;
        }
      }
    }

    return {
      items: searchResults,
      metadata: nextPage ? { page: nextPage, collectedIds } : undefined,
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchFilterValue[]>) {
    // TODO: Replace compat wrapper with proper search form implementation
    return new SearchFilterForm(query.metadata, this.getSearchFilters());
  }

  // Populates the title details
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const request = {
      // With the trailing slash: without it the site 301s to plain http, which iOS refuses (ATS).
      url: `${new URL(DOMAIN).addPathComponent("manga").addPathComponent(mangaId).toString()}/`,
      method: "GET",
    };

    const $ = await this.fetchCheerio(request);

    const section = $(".detail-info");

    const title = $("span.detail-info-right-title-font", section).text().trim();
    const rating = $("span.item-score", section).text().trim().replace(",", ".");
    const author = $("p.detail-info-right-say a", section).text().trim();
    const image = httpsUrl($(".detail-info-cover-img", $(".detail-info-cover")).attr("src"));
    const description = $("p.fullcontent").text().trim();

    const arrayTags: Tag[] = [];
    for (const tag of $("a", ".detail-info-right-tag-list").toArray()) {
      const id = $(tag).attr("href")?.split("/directory/")[1]?.replace(/\//g, "");
      const label = $(tag).text().trim();

      if (!id || !label) continue;
      arrayTags.push({ id: id, title: label });
    }
    //const tagSections: TagSection[] = [App.createTagSection({ id: '0', label: 'genres', tags: arrayTags.map(x => App.createTag(x)) })]

    // Build tag sections
    const tags: TagSection[] = [];
    if (genres.length > 0) {
      tags.push({
        id: "genres",
        title: "Genres",
        tags: arrayTags.map((genre) => ({
          id: genre.id.toLowerCase().replace(/\s+/g, "_"),
          title: genre.title,
        })),
      });
    }

    const rawStatus = $(".detail-info-right-title-tip", section).text().trim();
    let status = "ONGOING";
    switch (rawStatus.toUpperCase()) {
      case "ONGOING":
        status = "Ongoing";
        break;
      case "COMPLETED":
        status = "Completed";
        break;
      default:
        status = "Ongoing";
        break;
    }

    // Determine content rating based on genres
    let contentRating = ContentRating.EVERYONE;

    // These are the genres considered for higher content rating
    const adultGenres = ["Adult", "Lolicon", "Shotacon"];
    const matureGenres = [
      "Ecchi",
      "Mature",
      "Smut",
      "Yaoi",
      "Yuri",
      ...adultGenres, // Include adult genres as mature as well
    ];

    // Access the name property of each genre object for comparison
    if (genres.some((genre) => adultGenres.includes(genre.name))) {
      contentRating = ContentRating.ADULT;
    } else if (genres.some((genre) => matureGenres.includes(genre.name))) {
      contentRating = ContentRating.MATURE;
    }

    return {
      mangaId: mangaId,
      mangaInfo: {
        primaryTitle: title,
        thumbnailUrl: image,
        rating: Number(rating),
        status: status,
        author: author,
        artist: author,
        tagGroups: tags,
        synopsis: description,
        secondaryTitles: [],
        contentRating: contentRating,
      },
    };
  }

  // Populates the chapter list
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const request = {
      url: `${new URL(DOMAIN).addPathComponent("manga").addPathComponent(sourceManga.mangaId).toString()}/`,
      method: "GET",
    };

    const $ = await this.fetchCheerio(request);
    const chapters: Chapter[] = [];

    for (const chapter of $("div#chapterlist ul li").children("a").toArray()) {
      //const title = $('p.title3', chapter).html() ?? ''
      const date = parseDate($("p.title2", chapter).html() ?? "");
      const chapterIdRaw = $(chapter).attr("href")?.trim();

      const chapterIdRegex = chapterIdRaw?.match(/\/manga\/[a-zA-Z0-9_]*\/(.*)\//);

      // The whole path after the title ("v01/c001", "c1046.5"): the reader URL does not resolve without the volume segment.
      const chapterId: string | null = chapterIdRegex?.[1] ?? null;

      if (!chapterId) continue;
      const volume = /(?:^|\/)v(\d+)/.exec(chapterId)?.[1];

      console.log(`Chapter ID: ${chapterId}`);

      const chapRegex = chapterId?.match(/c([0-9.]+)/);
      let chapNum = 0;
      if (chapRegex && chapRegex[1]) chapNum = Number(chapRegex[1]);

      chapters.push({
        ...(volume ? { volume: Number(volume) } : {}),
        chapterId: chapterId,
        sourceManga: sourceManga,
        //title: title,
        langCode: "🇬🇧",
        chapNum: isNaN(chapNum) ? 0 : chapNum,
        publishDate: date,
      });
    }

    // Reverse to show newest chapters first
    return chapters.reverse();
  }

  // The mobile "roll" reader lists every page of a chapter in one document (data-original on each img), where the
  // desktop reader hands out two pages per scripted request: one request instead of a dozen, and no key dance.
  // The desktop's page count is one higher than the image count: its last "page" is the end-of-chapter screen.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.fetchCheerio({
      url: `${MOBILE_DOMAIN}/roll_manga/${chapter.sourceManga.mangaId}/${chapter.chapterId}/1.html`,
      method: "GET",
    });
    const pages: string[] = [];
    $("img[data-original], .reader-main img, #viewer img").each((_, el) => {
      const src = httpsUrl($(el).attr("data-original") ?? $(el).attr("src"));
      if (/\/store\/manga\//.test(src) && !pages.includes(src)) pages.push(src);
    });
    if (pages.length === 0) {
      throw new Error(
        `MangaFox: no pages found for ${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [_, data] = await Application.scheduleRequest(request);
    return cheerio.load(Application.arrayBufferToUTF8String(data));
  }
}

function createDiscoverSectionItem(options: {
  id: string;
  image: string;
  title: string;
  subtitle?: string;
  type: "simpleCarouselItem";
}): DiscoverSectionItem {
  return {
    type: options.type,
    mangaId: options.id,
    imageUrl: options.image,
    title: options.title,
    subtitle: options.subtitle,
    metadata: undefined,
  };
}

const parseDate = (date: string): Date => {
  date = date.toUpperCase();
  let time: Date;
  const number = Number((/\d*/.exec(date) ?? [])[0]);
  if (date.includes("LESS THAN AN HOUR") || date.includes("JUST NOW") || date.includes("TODAY")) {
    time = new Date(Date.now());
  } else if (date.includes("YEAR") || date.includes("YEARS")) {
    time = new Date(Date.now() - number * 31556952000);
  } else if (date.includes("MONTH") || date.includes("MONTHS")) {
    time = new Date(Date.now() - number * 2592000000);
  } else if (date.includes("WEEK") || date.includes("WEEKS")) {
    time = new Date(Date.now() - number * 604800000);
  } else if (date.includes("YESTERDAY")) {
    time = new Date(Date.now() - 86400000);
  } else if (date.includes("DAY") || date.includes("DAYS")) {
    time = new Date(Date.now() - number * 86400000);
  } else if (date.includes("HOUR") || date.includes("HOURS")) {
    time = new Date(Date.now() - number * 3600000);
  } else if (date.includes("MINUTE") || date.includes("MINUTES")) {
    time = new Date(Date.now() - number * 60000);
  } else if (date.includes("SECOND") || date.includes("SECONDS")) {
    time = new Date(Date.now() - number * 1000);
  } else {
    time = new Date(date);
  }
  return time;
};

export const MangaFox = new MangaFoxExtension();
