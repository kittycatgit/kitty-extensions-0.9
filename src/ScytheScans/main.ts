/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { type Chapter, type ChapterDetails, type ContentRating } from "@paperback/types";
import { type CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";

import { MangaStreamGeneric } from "../mangastream/main";
import pbconfig from "./pbconfig";

const DOMAIN_NAME: string = "https://scythescans.com";

/**
 * Read the page list out of the reader.
 *
 * The chapter page ships no page images - a plain fetch returns only the
 * cover, with or without navigation headers. The theme's `ts_reader` library
 * arrives through the site's autoptimize bundles and is handed its sources at
 * runtime, so the list only exists once the page has actually run.
 *
 * This has to be a synchronous expression: the webview evaluates it and takes
 * the completion value, so a promise would come back unresolved.
 */
const READER_SCRIPT = `
  (function () {
    try {
      var images = [];
      var reader = window.ts_reader;
      var sources = reader && reader.params && reader.params.sources;

      if (sources && sources.length) {
        for (var i = 0; i < sources.length; i++) {
          var list = sources[i].images || [];
          for (var j = 0; j < list.length; j++) {
            if (list[j] && images.indexOf(list[j]) === -1) images.push(list[j]);
          }
          if (images.length) break;
        }
      }

      if (!images.length) {
        // Fall back to whatever the reader has already rendered.
        var rendered = document.querySelectorAll('#readerarea img');
        for (var k = 0; k < rendered.length; k++) {
          var src = rendered[k].getAttribute('src') || rendered[k].getAttribute('data-src');
          if (src && src.indexOf('readerarea.svg') === -1 && images.indexOf(src) === -1) {
            images.push(src);
          }
        }
      }

      return JSON.stringify(images);
    } catch (error) {
      return '[]';
    }
  })()
`;

class ScytheScansExtension extends MangaStreamGeneric {
  domain = DOMAIN_NAME;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;

  override configureSections(): void {
    // The theme's default latest-updates container is absent here; this site
    // lays the cards out in a plain `listupd`, which the popular slider also
    // uses, so exclude that one.
    this.latestUpdatesSection.selectorFunc = ($: CheerioAPI) =>
      $("div.bsx", "div.postbody div.listupd:not(.popularslider)");
  }

  override async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = await this.resolveChapterUrl(chapter);

    const [, buffer] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);

    const { result } = await Application.executeInWebView({
      source: {
        html,
        baseUrl: chapterUrl,
        loadCSS: false,
        loadImages: true,
      },
      inject: READER_SCRIPT,
      storage: { cookies: this.cookieStorageInterceptor.cookies as never },
    });

    const pages = parsePages(result);
    if (pages.length === 0) {
      throw new Error(`Unable to read any pages for chapter ${chapter.chapterId}`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  /** The chapter list carries the absolute URL for each entry. */
  private async resolveChapterUrl(chapter: Chapter): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${this.domain}/${this.directoryPath}/${chapter.sourceManga.mangaId}/`,
      method: "GET",
    });

    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const entry = $("div#chapterlist li")
      .toArray()
      .find((element) => $(element).attr("data-num") === chapter.chapterId);

    const url = entry ? $("a", entry).attr("href") : undefined;
    if (!url) {
      throw new Error(`Unable to find chapter ${chapter.chapterId}`);
    }

    return url;
  }
}

/** The webview hands back a JSON string, but tolerate an array as well. */
function parsePages(result: unknown): string[] {
  let raw: unknown = result;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((page): page is string => typeof page === "string" && page.length > 0);
}

export const ScytheScans = new ScytheScansExtension();
