/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type DiscoverSectionItem,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { MadaraGeneric } from "../generic/main";
import type { MadaraSearchMetadata } from "../generic/models";
import pbconfig from "./pbconfig";

const DOMAIN = "https://linkmanga.com";

// The site's WAF answers 403 to any listing that carries a query string, so
// `?s=`, `?m_orderby=` and `genre[]` are all unusable here. Everything this
// source does therefore goes through a path: /manga/page/N/,
// /manga-genre/<slug>/page/N/ and /search/<query>/page/N/.
class LinkMangaExtension extends MadaraGeneric {
  constructor() {
    super({
      domain: DOMAIN,
      name: pbconfig.name,
      contentRating: pbconfig.contentRating,
      language: pbconfig.language,
      usePostIds: false,
      chapterEndpoint: 1,
      directoryPath: "manga",
      // Results on every path-based listing are `page-item-detail` cards, not
      // the tabbed search markup the base expects.
      searchMangaSelector: "div.page-item-detail",
      // The reader's `?style=list` is a query string, which the WAF 403s.
      useListParameter: false,
    });
  }

  // The base reads genres off `/?s=&post_type=wp-manga`, which the WAF blocks;
  // the directory page carries the same list as links.
  override async fetchGenres(): Promise<Tag[]> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/manga/`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const tags: Tag[] = [];

    $('a[href*="/manga-genre/"]').each((_, element) => {
      const id = ($(element).attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";
      const title = $(element).text().replace(/\s+/g, " ").trim();

      if (id && title && !tags.some((tag) => tag.id === id)) {
        tags.push({ id, title });
      }
    });

    if (tags.length === 0) {
      throw new Error("Parsed no genres from the directory page");
    }

    return tags;
  }

  // Only the default order is reachable without a query string, so one row is
  // offered rather than four that would answer 403.
  override async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "latest",
        title: "Latest Updates",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: { page?: number } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/manga/page/${page.toString()}/`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const items = await this.parser.parseDiscoverSections($, section, this);

    return { items, ...(items.length > 0 ? { metadata: { page: page + 1 } } : {}) };
  }

  // `/search/<query>/` answered real results for a while and now serves an
  // "Access Denied" body with a 200, so title search goes through Madara's own
  // typeahead endpoint, which is a POST and therefore never carries a query
  // string. It returns ten titles and no covers, so each cover is read from the
  // series page.
  private async searchByTitle(title: string): Promise<SearchResultItem[]> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/wp-admin/admin-ajax.php`,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `action=wp-manga-search-manga&title=${encodeURIComponent(title).replaceAll("%20", "+")}`,
    });

    const payload = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
      success?: boolean;
      data?: { title: string; url: string; type?: string }[];
    };

    const entries = (payload.data ?? []).filter((entry) => entry.url.includes("/manga/"));

    return Promise.all(
      entries.map(async (entry) => {
        const slug = entry.url.replace(/\/$/, "").split("/").pop() ?? "";
        const [, page] = await Application.scheduleRequest({ url: entry.url, method: "GET" });
        const html = Application.arrayBufferToUTF8String(page);
        const cover = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? "";

        return {
          mangaId: slug,
          title: Application.decodeHTMLEntities(entry.title),
          imageUrl: encodeURI(cover),
        };
      }),
    );
  }

  override constructSearchRequest(
    page: number,
    query: SearchQuery<MadaraSearchMetadata>,
    _sortingOption?: SortingOption,
  ) {
    const included = Object.entries(query.metadata?.genres ?? {})
      .filter(([, state]) => state === "included")
      .map(([id]) => id);

    const suffix = page > 1 ? `page/${page.toString()}/` : "";
    let url: string;

    if (included[0]) {
      // The genre archive takes one genre; the query-string form that combines
      // several is what the WAF rejects.
      url = `${DOMAIN}/manga-genre/${included[0]}/${suffix}`;
    } else {
      url = `${DOMAIN}/manga/${suffix}`;
    }

    return Application.scheduleRequest({ url, method: "GET" });
  }

  override async getSearchResults(
    query: SearchQuery<MadaraSearchMetadata>,
    metadata: { page?: number } | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = this.sanitizeQuery(query?.title ?? "").trim();

    if (title) {
      // The typeahead answers one batch, so there is no second page to offer.
      return page > 1
        ? { items: [], metadata: undefined }
        : { items: await this.searchByTitle(title), metadata: undefined };
    }

    const [response, buffer] = await this.constructSearchRequest(page, query, sortingOption);

    // Past the last page the site redirects to page one instead of 404ing, so
    // paging on the returned items alone would loop forever.
    if (page > 1 && !response.url.includes(`/page/${page.toString()}/`)) {
      return { items: [], metadata: undefined };
    }

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const results = await this.parser.parseSearchResults($, this);

    const items: SearchResultItem[] = results.map((result) => ({
      mangaId: result.slug,
      imageUrl: result.image,
      title: result.title,
      subtitle: result.subtitle,
    }));

    return { items, ...(items.length > 0 ? { metadata: { page: page + 1 } } : {}) };
  }
}

export const LinkManga = new LinkMangaExtension();
