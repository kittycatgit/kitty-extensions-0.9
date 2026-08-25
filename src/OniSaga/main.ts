/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
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
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  DOMAIN,
  HOME_SECTIONS,
  pageMarkerUrl,
  readerUrl,
  type OniSagaSearchMetadata,
} from "./models";
import { OniSagaInterceptor } from "./network";
import { parseChapters, parseListing, parseMangaDetails } from "./parsers";
import type pbconfigType from "./pbconfig";

/** Lightest page that still carries the header search component. */
const SNAPSHOT_PAGE = "/top-manga";

/** Browsing with no query: the lightest route that paginates. */
const BROWSE_PATH = "/top-manga";

class OniSagaExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new OniSagaInterceptor("main");

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    // The page interceptor is the only throttle: it paces page resolution and
    // honours a 429's Retry-After itself. A window-based limiter on top of it
    // only stalled the reader for a full minute at a time.
    this.interceptor.registerInterceptor();
  }

  private async fetch(path: string): Promise<cheerio.CheerioAPI> {
    const url = path.startsWith("http") ? path : `${DOMAIN}${path}`;
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return cheerio.load(Application.arrayBufferToUTF8String(buffer));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetch(`/manga/${mangaId}`);
    return parseMangaDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetch(`/manga/${sourceManga.mangaId}`);
    const chapters = parseChapters($, sourceManga);

    // The reader token is minted per chapter from its own reader page, so the
    // interceptor needs to know which series each chapter belongs to.
    for (const chapter of chapters) {
      this.interceptor.noteChapterOwner(chapter.chapterId, sourceManga.mangaId);
    }

    return chapters;
  }

  /**
   * Reports the pages without resolving any of them.
   *
   * Each real page URL costs its own rate limited call and expires ten minutes
   * later, so resolving a long chapter here would both trip the limiter and
   * hand back links that die before they are read. The markers returned here
   * are swapped for freshly signed URLs by the interceptor, one at a time, as
   * the reader reaches each page.
   */
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    this.interceptor.noteChapterOwner(chapter.chapterId, mangaId);

    const url = readerUrl(mangaId, chapter.chapterId);
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);

    // Readiness first: a chapter the site has not finished preparing answers
    // with a waiting screen rather than a reader, and saying so is far more
    // use than complaining that its length cannot be read.
    const token = html.match(/readerToken['"]?\s*:\s*['"]([^'"]{8,})['"]/)?.[1];
    const preparing = /loading pages|hang tight|being processed|preparing/i.test(html);

    if (!token || preparing) {
      throw new Error(
        `The site is still preparing chapter ${chapter.chapterId}. Give it a minute and open it again.`,
      );
    }

    const declared = Number(
      html.match(/['"]?(?:pageCount|totalPages|pages_count)['"]?\s*:\s*(\d+)/)?.[1] ??
        html.match(/(\d+)\s*pages\b/i)?.[1] ??
        html.match(/data-pages=['"](\d+)['"]/)?.[1] ??
        chapter.additionalInfo?.pages ??
        0,
    );

    let total = Number.isFinite(declared) && declared > 0 ? declared : 0;

    if (total <= 0) {
      // The reader page did not say, so ask the site directly. It also reports
      // whether the chapter is still being imported, which is the honest
      // reason an otherwise fine chapter has no pages to show yet.
      const info = await this.interceptor.chapterInfo(chapter.chapterId, token);

      if (info?.importing) {
        throw new Error(
          `The site is still importing chapter ${chapter.chapterId}. Give it a minute and open it again.`,
        );
      }

      total = info?.total ?? 0;
    }

    if (total <= 0) {
      throw new Error(
        `Chapter ${chapter.chapterId} reports no pages. It may have been removed, or the site may still be working on it.`,
      );
    }

    // Hand over the token from the page just fetched, so resolving the first
    // page does not fetch the very same page again, and count this request so
    // the first resolution waits its turn rather than arriving on its heels.
    this.interceptor.noteToken(chapter.chapterId, token);
    this.interceptor.noteMeteredRequest();

    const pages: string[] = [];
    for (let index = 0; index < total; index += 1) {
      pages.push(pageMarkerUrl(chapter.chapterId, index));
    }

    return { id: chapter.chapterId, mangaId, pages };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as OniSagaSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    const title = (query.title ?? "").trim();

    // Opening the source without typing anything should still show titles, so
    // an empty query browses the catalogue instead of returning nothing.
    if (!title) {
      const page = paging?.page ?? 1;
      const $browse = await this.fetch(page > 1 ? `${BROWSE_PATH}?page=${page}` : BROWSE_PATH);
      const rows = parseListing($browse);

      return {
        items: rows,
        metadata: rows.length > 0 ? { page: page + 1 } : { completed: true },
      };
    }

    // The catalogue's own filter page weighs some 14 MB, so the header's
    // search component is used instead: it answers the same query with a
    // fragment of a few dozen kilobytes.
    const $ = await this.fetch(SNAPSHOT_PAGE);
    const token = $('meta[name="csrf-token"]').attr("content") ?? "";
    const snapshot = $("[wire\\:snapshot]")
      .toArray()
      .map((element) => $(element).attr("wire:snapshot") ?? "")
      .find((value) => value.includes("search-component"));

    if (!snapshot) {
      throw new Error("The site's search component could not be found.");
    }

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/livewire/update`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Livewire": "true",
        ...(token ? { "X-CSRF-TOKEN": token } : {}),
        referer: `${DOMAIN}${SNAPSHOT_PAGE}`,
      },
      body: JSON.stringify({
        _token: token,
        components: [{ snapshot, updates: { q: title }, calls: [] }],
      }),
    });

    const payload = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
      components?: { effects?: { html?: string } }[];
    };

    const fragment = payload.components?.[0]?.effects?.html ?? "";
    const items = fragment ? parseListing(cheerio.load(fragment)) : [];

    // The quick search answers with a single set of matches, not pages of them.
    return { items, metadata: { completed: true } };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return HOME_SECTIONS.map((section, index) => ({
      id: section.id,
      title: section.title,
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const paging = metadata as OniSagaSearchMetadata | undefined;

    if (paging?.completed) {
      return { items: [] };
    }

    // Resolve by id so each rail keeps its own route rather than falling
    // through to a shared default.
    const entry = HOME_SECTIONS.find((candidate) => candidate.id === section.id);

    if (!entry) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const $ = await this.fetch(page > 1 ? `${entry.path}?page=${page}` : entry.path);
    const rows = parseListing($);
    const featured = section.id === HOME_SECTIONS[0]!.id;

    return {
      items: rows.map((row) =>
        featured
          ? {
              type: "featuredCarouselItem" as const,
              mangaId: row.mangaId,
              imageUrl: row.imageUrl,
              title: row.title,
            }
          : {
              type: "simpleCarouselItem" as const,
              mangaId: row.mangaId,
              imageUrl: row.imageUrl,
              title: row.title,
            },
      ),
      metadata: entry.paginates && rows.length > 0 ? { page: page + 1 } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }
      this.cookieStorage.setCookie(cookie);
    }
  }
}

export const OniSaga = new OniSagaExtension();
