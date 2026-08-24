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
 * The inject string is wrapped in a function body, so it must `return` its
 * value. A promise is awaited, which lets us wait for the reader to populate.
 */
const READER_SCRIPT = `
  return new Promise(function (resolve) {
    var deadline = Date.now() + 15000;

    function report(images, sources) {
      return JSON.stringify({
        images: images,
        readerPresent: !!window.ts_reader,
        paramsPresent: !!(window.ts_reader && window.ts_reader.params),
        sourceCount: sources ? sources.length : 0,
        readerAreaImgs: document.querySelectorAll('#readerarea img').length,
        scripts: document.querySelectorAll('script').length,
        readyState: document.readyState,
      });
    }

    function collect() {
      try {
        var reader = window.ts_reader;
        var sources = reader && reader.params && reader.params.sources;
        var images = [];

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

        if (images.length) return resolve(report(images, sources));
        if (Date.now() > deadline) return resolve(report([], sources));
        setTimeout(collect, 250);
      } catch (error) {
        resolve(JSON.stringify({ images: [], error: String(error) }));
      }
    }

    collect();
  });
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

    const { pages, diagnostics } = parseReport(result);
    if (pages.length === 0) {
      // Surface what the webview saw; without it a failure here is opaque.
      throw new Error(`Unable to read any pages for chapter ${chapter.chapterId} [${diagnostics}]`);
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

/**
 * The webview replies with a JSON report. Older shapes returned a bare array,
 * so tolerate that too.
 */
function parseReport(result: unknown): { pages: string[]; diagnostics: string } {
  let raw: unknown = result;

  if (typeof raw === "string") {
    const length = raw.length;
    try {
      raw = JSON.parse(raw);
    } catch {
      return { pages: [], diagnostics: `unparsable reply of ${length} chars` };
    }
  }

  if (Array.isArray(raw)) {
    return {
      pages: raw.filter((page): page is string => typeof page === "string"),
      diagnostics: "",
    };
  }

  if (!raw || typeof raw !== "object") {
    return { pages: [], diagnostics: `reply was ${raw === undefined ? "undefined" : typeof raw}` };
  }

  const report = raw as Record<string, unknown>;
  const pages = Array.isArray(report["images"])
    ? (report["images"] as unknown[]).filter((page): page is string => typeof page === "string")
    : [];

  const diagnostics = [
    `reader=${String(report["readerPresent"])}`,
    `params=${String(report["paramsPresent"])}`,
    `sources=${String(report["sourceCount"])}`,
    `readerAreaImgs=${String(report["readerAreaImgs"])}`,
    `scripts=${String(report["scripts"])}`,
    `readyState=${String(report["readyState"])}`,
    report["error"] ? `error=${JSON.stringify(report["error"])}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { pages, diagnostics };
}

export const ScytheScans = new ScytheScansExtension();
