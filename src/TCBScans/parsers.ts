/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type Chapter, type SourceManga } from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { DOMAIN, FALLBACK_COVER, chapterIdFromHref, seriesIdFromHref, seriesUrl } from "./models";

/** A series as the listing pages present it: a link wrapped around its cover. */
export type SeriesCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
};

/** A release as the front page presents it. */
export type ReleaseCard = SeriesCard & {
  chapterId: string;
  /** The series a release belongs to is only knowable from its own page, so a
   * release stands in for its series by its chapter until then. */
  subtitle?: string;
};

/**
 * An image address off an element that may not have loaded yet.
 *
 * Reading `src` alone works until a page lazy-loads its artwork, at which point
 * `src` holds a placeholder and the real address sits in a data attribute.
 */
function imageFrom(element: Cheerio<Element>): string | undefined {
  const candidates = [
    element.attr("data-src"),
    element.attr("data-lazy-src"),
    element.attr("src"),
    element.attr("srcset")?.split(",")[0]?.trim().split(" ")[0],
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();

    if (value && !value.startsWith("data:")) {
      return value;
    }
  }

  return undefined;
}

function absolute(src: string | undefined): string {
  const value = (src ?? "").trim();

  if (!value) {
    return "";
  }

  if (value.startsWith("http")) {
    return value;
  }

  return value.startsWith("/") ? `${DOMAIN}${value}` : `${DOMAIN}/${value}`;
}

/** The first candidate that resolves to an address with a scheme and a host. */
function cover(...candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    const resolved = absolute(candidate);

    if (/^https?:\/\/[^/\s]+\.[^/\s]+\/\S/.test(resolved)) {
      return resolved;
    }
  }

  return FALLBACK_COVER;
}

/**
 * Every series the group lists.
 *
 * A card is a link around a single image, and the title is the image's own
 * alternative text - there is no separate label to read.
 */
export function parseSeriesList($: CheerioAPI): SeriesCard[] {
  const seen = new Set<string>();
  const items: SeriesCard[] = [];

  $('a[href^="/mangas/"]').each((_, element) => {
    const anchor = $(element);
    const mangaId = seriesIdFromHref(anchor.attr("href") ?? "");

    if (!mangaId || seen.has(mangaId)) {
      return;
    }

    const image = anchor.find("img").first();
    const title = (image.attr("alt") ?? anchor.text()).trim();

    if (!title) {
      return;
    }

    seen.add(mangaId);
    items.push({ mangaId, title, imageUrl: cover(imageFrom(image)) });
  });

  return items;
}

/**
 * What the front page has just posted.
 *
 * Each release names its series in its own alternative text - "One Piece
 * Chapter 1191" - so the series name is what is left once the chapter is taken
 * off the end, and the chapter is what was taken off.
 */
export function parseLatestReleases($: CheerioAPI): ReleaseCard[] {
  const seen = new Set<string>();
  const items: ReleaseCard[] = [];

  $('a[href^="/chapters/"]').each((_, element) => {
    const anchor = $(element);
    const chapterId = chapterIdFromHref(anchor.attr("href") ?? "");

    if (!chapterId || seen.has(chapterId)) {
      return;
    }

    const image = anchor.find("img").first();

    if (image.length === 0) {
      return;
    }

    const label = (image.attr("alt") ?? "").trim();

    if (!label) {
      return;
    }

    const split = /^(.*?)\s+(Chapter\s+[\d.]+.*)$/i.exec(label);
    const title = (split?.[1] ?? label).trim();

    seen.add(chapterId);
    items.push({
      mangaId: "",
      chapterId,
      title,
      imageUrl: cover(imageFrom(image)),
      ...(split?.[2] ? { subtitle: split[2].trim() } : {}),
    });
  });

  return items;
}

/** A series' own page: its name, artwork and blurb. */
export function parseSeriesDetails($: CheerioAPI, mangaId: string): SourceManga {
  const primaryTitle = $("h1").first().text().trim() || mangaId;

  // The cover is the one piece of artwork the page carries that is not a site
  // fixture, so it is the first image served off the content host.
  const seriesImage = $('img[src*="cdn."]').first();

  // The blurb is the longest run of prose on the page; the shorter paragraphs
  // are notices and links.
  let synopsis = "";
  $("p").each((_, element) => {
    const text = $(element).text().trim();

    if (text.length > synopsis.length) {
      synopsis = text;
    }
  });

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles: [],
      thumbnailUrl: cover(imageFrom(seriesImage)),
      synopsis,
      contentRating: ContentRating.EVERYONE,
      shareUrl: seriesUrl(mangaId),
    },
  };
}

/**
 * A series' chapters.
 *
 * Each entry carries its own heading - "Chainsaw Man Chapter 179" - and, below
 * it, whatever the group titled that chapter. The number is taken from the
 * heading; the group's title is kept as the chapter's name when there is one.
 */
export function parseChapterList($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const seen = new Set<string>();
  const chapters: Chapter[] = [];

  $('a[href^="/chapters/"]').each((_, element) => {
    const anchor = $(element);
    const chapterId = chapterIdFromHref(anchor.attr("href") ?? "");

    if (!chapterId || seen.has(chapterId)) {
      return;
    }

    // A release card is a link around an image; a chapter row is a link around
    // text. Only the rows belong to a chapter list.
    if (anchor.find("img").length > 0) {
      return;
    }

    const heading = anchor.find("div").first().text().trim();
    const name = anchor.find("div").eq(1).text().trim();
    const number = Number(/Chapter\s+([\d.]+)/i.exec(heading)?.[1]);

    seen.add(chapterId);
    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: Number.isFinite(number) ? number : 0,
      ...(name ? { title: name } : {}),
    });
  });

  return chapters;
}

/**
 * A chapter's pages.
 *
 * They are plain images on the content host, in reading order, with nothing
 * signed or hidden about them.
 */
export function parsePages($: CheerioAPI): string[] {
  const pages: string[] = [];

  $("img.fixed-ratio-content").each((_, element) => {
    const source = absolute(imageFrom($(element)));

    if (/^https?:\/\/[^/\s]+\.[^/\s]+\/\S/.test(source)) {
      pages.push(source);
    }
  });

  return pages;
}
