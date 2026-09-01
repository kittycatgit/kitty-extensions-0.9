/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { chapterUrl, DOMAIN, seriesUrl } from "./models";

// An empty imageUrl empties the whole row it appears in, so point coverless
// titles at a path the host won't serve and let the app draw its placeholder.
const MISSING_COVER = `${DOMAIN}/image/none.webp`;

// /manga/feed/ is the WordPress RSS route, not a series.
const NOT_SERIES = new Set(["feed", "page", ""]);

export function slugOf(href: string): string {
  const path = (href ?? "").split("?")[0]!.replace(/\/$/, "");

  return path.split("/").pop()!.trim();
}

function absolute(url: string): string {
  const trimmed = url.trim();

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return (trimmed.startsWith("/") ? `${DOMAIN}${trimmed}` : trimmed).replace(
    /^http:\/\//,
    "https://",
  );
}

// Covers are served at several widths; the listing markup points `src` at the
// smallest, so take the widest candidate the srcset offers instead.
function imageFrom(node: Cheerio<Element>): string {
  const srcset = (node.first().attr("srcset") ?? "").trim();

  if (srcset) {
    let best = "";
    let width = -1;

    for (const candidate of srcset.split(",")) {
      const [url, size] = candidate.trim().split(/\s+/);
      const parsed = Number((size ?? "").replace(/[^0-9]/g, ""));

      if (url && parsed > width) {
        best = url;
        width = parsed;
      }
    }

    if (best) {
      return absolute(best);
    }
  }

  for (const attribute of ["data-src", "data-lazy-src", "src"]) {
    const value = (node.first().attr(attribute) ?? "").trim();

    if (value && !value.startsWith("data:")) {
      return absolute(value);
    }
  }

  return MISSING_COVER;
}

function cardToResult($: CheerioAPI, card: Element): SearchResultItem | undefined {
  const node = $(card);
  const mangaId = slugOf(node.attr("href") ?? "");
  const title = Application.decodeHTMLEntities(
    (node.attr("title") ?? $("div.ac-t", card).first().text()).trim(),
  );

  if (NOT_SERIES.has(mangaId) || !title) {
    return undefined;
  }

  const chapter = $("div.ac-ch", card).first().text().trim();

  return {
    mangaId,
    title,
    imageUrl: imageFrom($("img", card) as Cheerio<Element>),
    ...(chapter ? { subtitle: Application.decodeHTMLEntities(chapter) } : {}),
  };
}

export function parseResults($: CheerioAPI): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const card of $("a.acard").toArray()) {
    const result = cardToResult($, card);

    if (result && !seen.has(result.mangaId)) {
      seen.add(result.mangaId);
      results.push(result);
    }
  }

  return results;
}

// The home page hero is built from its own markup rather than the card grid,
// and its artwork is a CSS background instead of an <img>.
export function parseFeatured($: CheerioAPI): DiscoverSectionItem[] {
  const items: DiscoverSectionItem[] = [];
  const seen = new Set<string>();

  for (const slide of $("div.hslide").toArray()) {
    const link = $("h2.htitle a, h3.htitle a", slide).first();
    const mangaId = slugOf(link.attr("href") ?? "");
    const title = Application.decodeHTMLEntities(link.text().trim());

    if (NOT_SERIES.has(mangaId) || !title || seen.has(mangaId)) {
      continue;
    }

    seen.add(mangaId);

    const background = $("div.hslide__bg", slide).first().attr("style") ?? "";
    const cover = /url\(\s*['"]?([^'")]+)/.exec(background)?.[1] ?? "";

    items.push({
      type: "featuredCarouselItem",
      mangaId,
      title,
      imageUrl: cover ? absolute(cover) : MISSING_COVER,
    });
  }

  return items;
}

export function parseSeries($: CheerioAPI, mangaId: string): SourceManga {
  const title = Application.decodeHTMLEntities(
    ($("h1.htitle").first().text() || $('meta[property="og:title"]').attr("content") || "").trim(),
  );

  const synopsis = Application.decodeHTMLEntities(
    ($("p.hsyn").first().text() || $('meta[property="og:description"]').attr("content") || "")
      .replace(/^Read\s+(manhwa|manhua|manga)\s+/i, "")
      .trim(),
  );

  const genres: Tag[] = [];
  for (const node of $("div.hchips--genres a.chip").toArray()) {
    const id = slugOf($(node).attr("href") ?? "");
    const name = $(node).text().trim();

    if (id && name && !genres.some((genre) => genre.id === id)) {
      genres.push({ id, title: name });
    }
  }

  const tagGroups: TagSection[] = genres.length
    ? [{ id: "genres", title: "Genres", tags: genres }]
    : [];

  const statusText = $("span.htag--status").first().text().trim();
  const status = /complet|finish/i.test(statusText) ? "Completed" : "Ongoing";

  const rating = Number(
    ($("div.hinfo span.rt, div.htag span.rt")
      .first()
      .text()
      .trim()
      .match(/[0-9.]+/) ?? [])[0],
  );

  const adult = genres.some((genre) => /^(adult|mature|smut|ecchi)$/i.test(genre.id));

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title || mangaId,
      secondaryTitles: [],
      thumbnailUrl: absolute($('meta[property="og:image"]').attr("content") ?? MISSING_COVER),
      synopsis,
      contentRating: adult ? ContentRating.ADULT : ContentRating.MATURE,
      status,
      shareUrl: seriesUrl(mangaId),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(tagGroups.length ? { tagGroups } : {}),
    },
  };
}

// Rows carry a relative age ("20 hours ago"); older ones switch to a date.
function parseAge(value: string): Date | undefined {
  const text = value.trim();

  if (!text) {
    return undefined;
  }

  const relative = /^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(text);

  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const ms: Record<string, number> = {
      second: 1000,
      minute: 60000,
      hour: 3600000,
      day: 86400000,
      week: 604800000,
      month: 2592000000,
      year: 31536000000,
    };

    return new Date(Date.now() - amount * (ms[unit] ?? 0));
  }

  const parsed = new Date(text);

  return isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  for (const row of $("li.wp-manga-chapter").toArray()) {
    const link = $("a", row).first();
    const chapterId = slugOf(link.attr("href") ?? "");

    if (!chapterId || seen.has(chapterId)) {
      continue;
    }

    seen.add(chapterId);

    const name = Application.decodeHTMLEntities(link.text().trim());
    const number = Number((name.match(/([0-9]+(?:\.[0-9]+)?)/) ?? [])[1] ?? 0);
    const published = parseAge($("span.chapter-release-date", row).first().text());

    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: Number.isFinite(number) ? number : 0,
      sortingIndex: Number.isFinite(number) ? number : 0,
      ...(published ? { publishDate: published } : {}),
    });
  }

  return chapters;
}

export function parsePages($: CheerioAPI): string[] {
  const pages: string[] = [];

  for (const node of $("div.page-break img, img.wp-manga-chapter-img").toArray()) {
    const page = imageFrom($(node) as Cheerio<Element>);

    if (page !== MISSING_COVER && !pages.includes(page)) {
      pages.push(page);
    }
  }

  return pages;
}

export function parseGenres($: CheerioAPI): Tag[] {
  const genres: Tag[] = [];

  for (const node of $('a[href*="/manga-genre/"]').toArray()) {
    const id = slugOf($(node).attr("href") ?? "");
    const title = $(node).text().trim();

    if (id && title && !genres.some((genre) => genre.id === id)) {
      genres.push({ id, title: Application.decodeHTMLEntities(title) });
    }
  }

  return genres.sort((a, b) => a.title.localeCompare(b.title));
}

export { chapterUrl };
