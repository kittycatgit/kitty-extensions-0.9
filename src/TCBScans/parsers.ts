/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type Chapter, type SourceManga } from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { DOMAIN, FALLBACK_COVER, chapterIdFromHref, seriesIdFromHref, seriesUrl } from "./models";

export type SeriesCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
};

export type ReleaseCard = SeriesCard & {
  chapterId: string;
  subtitle?: string;
};

// Lazy-loaded artwork leaves a placeholder in src and the real address in a data attribute.
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

function cover(...candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    const resolved = absolute(candidate);

    if (/^https?:\/\/[^/\s]+\.[^/\s]+\/\S/.test(resolved)) {
      return resolved;
    }
  }

  return FALLBACK_COVER;
}

// Cards carry no text label, so the title is the cover image's alt text.
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

// Alt text reads "One Piece Chapter 1191": the series name, then the chapter.
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
      // Only the release's own page names its series, so mangaId stays empty.
      mangaId: "",
      chapterId,
      title,
      imageUrl: cover(imageFrom(image)),
      ...(split?.[2] ? { subtitle: split[2].trim() } : {}),
    });
  });

  return items;
}

export function parseSeriesDetails($: CheerioAPI, mangaId: string): SourceManga {
  const primaryTitle = $("h1").first().text().trim() || mangaId;

  // The only artwork served off the CDN is the cover; everything else is a site fixture.
  const seriesImage = $('img[src*="cdn."]').first();

  // The blurb is the longest paragraph on the page; the short ones are notices and links.
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

// First div is the heading, "Chainsaw Man Chapter 179"; the second is the group's own title.
export function parseChapterList($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const seen = new Set<string>();
  const chapters: Chapter[] = [];

  $('a[href^="/chapters/"]').each((_, element) => {
    const anchor = $(element);
    const chapterId = chapterIdFromHref(anchor.attr("href") ?? "");

    if (!chapterId || seen.has(chapterId)) {
      return;
    }

    // Release cards are links around an image; chapter rows are links around text.
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
