/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import {
  DOMAIN,
  FALLBACK_COVER,
  seriesPageUrl,
  toId,
  type ApiChapter,
  type ApiSeries,
} from "./models";

/**
 * An address only counts if it has a scheme and a host to fetch from.
 *
 * Some covers are still listed over plain http, which the phone refuses to load
 * at all - the host answers those with a redirect rather than the image. They
 * are asked for securely instead, which is how the same file is served.
 */
function usable(candidate: string | null | undefined): string {
  const value = (candidate ?? "").trim();

  if (/^https?:\/\/[^/\s]+\.[^/\s]+\/\S/.test(value)) {
    return value.startsWith("http://") ? `https://${value.slice("http://".length)}` : value;
  }

  if (value.startsWith("/")) {
    return `${DOMAIN}${value}`;
  }

  return FALLBACK_COVER;
}

/** Genres arrive either as objects or as bare names depending on the route. */
function genreNames(series: ApiSeries): string[] {
  return (series.genres ?? [])
    .map((genre) => (typeof genre === "string" ? genre : (genre?.name ?? "")))
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * What a title reads as underneath its name.
 *
 * The listing gives a kind, a state and a score; showing them together says
 * more at a glance than any one of them, and a title missing some still reads
 * properly rather than leaving stray separators behind.
 */
export function seriesSubtitle(series: ApiSeries): string | undefined {
  const bits: string[] = [];
  const type = (series.seriesType ?? "").trim();
  const status = (series.seriesStatus ?? "").trim();

  if (type) {
    bits.push(type.charAt(0) + type.slice(1).toLowerCase());
  }

  if (status) {
    bits.push(status.charAt(0) + status.slice(1).toLowerCase());
  }

  // The listing already carries the most recent chapters, so the newest one a
  // reader can actually open is free to show and is what they look for first.
  const latest = (series.chapters ?? [])
    .filter((chapter) => chapter.isLocked !== true && chapter.isAccessible !== false)
    .map((chapter) => Number(chapter.number))
    .filter((number) => Number.isFinite(number));

  if (latest.length > 0) {
    bits.push(`Ch. ${Math.max(...latest)}`);
  }

  if (typeof series.averageRating === "number" && series.averageRating > 0) {
    bits.push(`${series.averageRating.toFixed(1)}/10`);
  }

  return bits.length > 0 ? bits.join(" • ") : undefined;
}

export function toSearchResult(series: ApiSeries): SearchResultItem | undefined {
  const slug = (series.slug ?? "").trim();
  const title = (series.postTitle ?? "").trim();

  if (!slug || !title) {
    return undefined;
  }

  // Novels are text, not pages; the reader has nothing to show for them, so
  // they are left out rather than offered and then found unreadable.
  if ((series.seriesType ?? "").toUpperCase() === "NOVEL") {
    return undefined;
  }

  const mangaId = toId(slug);

  const subtitle = seriesSubtitle(series);

  return {
    mangaId,
    title,
    imageUrl: usable(series.featuredImage),
    ...(subtitle ? { subtitle } : {}),
  };
}

/** The site's own words for where a series stands, in the app's casing. */
function statusOf(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return value ? value.charAt(0) + value.slice(1).toLowerCase() : "Unknown";
}

/**
 * A series as the app shows it.
 *
 * The blurb arrives as the site's own markup, so it is read as HTML rather than
 * printed with its tags showing.
 */
export function toSourceManga($: CheerioAPI, series: ApiSeries, mangaId: string): SourceManga {
  const names = genreNames(series);
  const tagGroups: TagSection[] = names.length
    ? [
        {
          id: "genres",
          title: "Genres",
          tags: names.map((name) => ({ id: name.toLowerCase(), title: name })),
        },
      ]
    : [];

  const synopsis = series.postContent ? $(`<div>${series.postContent}</div>`).text().trim() : "";
  const type = (series.seriesType ?? "").trim();

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: (series.postTitle ?? "").trim() || mangaId,
      secondaryTitles: [],
      thumbnailUrl: usable(series.featuredImage),
      synopsis,
      contentRating: ContentRating.MATURE,
      status: statusOf(series.seriesStatus),
      shareUrl: seriesPageUrl(mangaId),
      ...(typeof series.averageRating === "number" && series.averageRating > 0
        ? { rating: series.averageRating }
        : {}),
      ...(tagGroups.length ? { tagGroups } : {}),
      ...(type ? { additionalInfo: { Type: type.charAt(0) + type.slice(1).toLowerCase() } } : {}),
    },
  };
}

/**
 * A series' chapters, newest first.
 *
 * Chapters the site is holding back - behind a timer or a price - are left out:
 * they cannot be opened, and listing them only offers the reader a page that
 * will not load.
 */
export function toChapters(rows: ApiChapter[], sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];

  for (const row of rows) {
    const slug = (row.slug ?? "").trim();

    if (!slug) {
      continue;
    }

    const chapterId = toId(slug);

    if (row.isLocked === true || row.isAccessible === false) {
      continue;
    }

    const number = Number(row.number);
    const title = (row.title ?? "").trim();
    const published = row.createdAt ? new Date(row.createdAt) : undefined;

    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: Number.isFinite(number) ? number : 0,
      ...(title ? { title } : {}),
      ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
    });
  }

  return chapters;
}

/**
 * A chapter's pages.
 *
 * The reader builds itself with script, but the page lists every image in its
 * own structured data first, in reading order - which is both the complete list
 * and the one that can be read without running anything.
 */
export function parsePages($: CheerioAPI): string[] {
  const pages: string[] = [];

  $('[itemprop="articleBody"] meta[itemprop="image"]').each((_, element) => {
    const source = ($(element).attr("content") ?? "").trim();

    if (/^https?:\/\/[^/\s]+\.[^/\s]+\/\S/.test(source)) {
      pages.push(
        source.startsWith("http://") ? `https://${source.slice("http://".length)}` : source,
      );
    }
  });

  return pages;
}
