/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type Chapter, type SourceManga, type Tag } from "@paperback/types";

import {
  CONTENT_RATINGS,
  GENRES,
  STATUS_LABELS,
  type ApiChapter,
  type ApiPage,
  type ApiSeries,
} from "./models";

/**
 * Normalises the alternative-title field into plain strings.
 *
 * The detail route returns a JSON-encoded array while search hits return a real
 * array, and either can hold objects rather than strings. Anything that is not
 * a usable string is dropped: a non-string reaching `secondaryTitles` fails to
 * cross the bridge and takes the whole title with it.
 */
export function normaliseTitles(raw: ApiSeries["alternativeTitles"]): string[] {
  let values: unknown = raw;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return [];
    }

    try {
      values = JSON.parse(trimmed);
    } catch {
      // Not JSON, so treat the whole field as a single title.
      return [trimmed];
    }
  }

  if (!Array.isArray(values)) {
    return [];
  }

  const titles: string[] = [];

  for (const value of values) {
    const title =
      typeof value === "string"
        ? value
        : typeof (value as { name?: unknown })?.name === "string"
          ? (value as { name: string }).name
          : undefined;

    const cleaned = title?.trim();
    if (cleaned && !titles.includes(cleaned)) {
      titles.push(cleaned);
    }
  }

  return titles;
}

export function contentRatingOf(raw: string | null | undefined): ContentRating {
  return CONTENT_RATINGS[(raw ?? "").toLowerCase()] ?? ContentRating.ADULT;
}

function statusOf(raw: string | null | undefined): string {
  const key = (raw ?? "").toLowerCase();
  return STATUS_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");
}

function joinNames(values: string[] | null | undefined): string | undefined {
  const names = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return names.length > 0 ? names.join(", ") : undefined;
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The site's own slug for each genre, looked up by display name. */
const GENRE_SLUGS = new Map(GENRES.map((genre) => [genre.title.toLowerCase(), genre.id]));

/**
 * Turns a genre name into a usable tag id.
 *
 * The detail route names genres rather than slugging them, and an id may only
 * hold alphanumerics and `._-@()[]%?#+=/&:` — a name like "Age Gap" is rejected
 * outright and takes the whole title with it. The catalogue's own slug is used
 * where there is one so the id matches what the search filter expects.
 */
function genreId(name: string): string {
  const known = GENRE_SLUGS.get(name.toLowerCase());

  if (known) {
    return known;
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "unknown";
}

/** Builds the detail record, carrying across every field the API exposes. */
export function parseMangaDetails(
  series: ApiSeries,
  domain: string,
  chapterCount?: number,
): SourceManga {
  const genres = (series.genres ?? []).filter((genre) => typeof genre === "string" && genre.trim());
  const tags: Tag[] = genres.map((genre) => ({ id: genreId(genre), title: genre }));

  const additionalInfo: Record<string, string> = {};
  if (series.type) {
    additionalInfo["Type"] = series.type.charAt(0).toUpperCase() + series.type.slice(1);
  }
  if (typeof series.year === "number") {
    additionalInfo["Year"] = String(series.year);
  }
  if (typeof series.views === "number") {
    additionalInfo["Views"] = series.views.toLocaleString("en-US");
  }
  if (typeof series.favorites === "number") {
    additionalInfo["Favorites"] = series.favorites.toLocaleString("en-US");
  }
  if (typeof series.score === "number") {
    const scoredBy = typeof series.scoredBy === "number" ? ` (${series.scoredBy} votes)` : "";
    additionalInfo["Rating"] = `${series.score.toFixed(1)} / 5${scoredBy}`;
  }
  if (typeof chapterCount === "number") {
    additionalInfo["Chapters"] = String(chapterCount);
  }

  return {
    mangaId: series.slug,
    mangaInfo: {
      primaryTitle: series.title?.trim() || series.slug,
      secondaryTitles: normaliseTitles(series.alternativeTitles),
      thumbnailUrl: series.coverUrl ?? "",
      synopsis: (series.synopsis ?? "").trim(),
      contentRating: contentRatingOf(series.contentRating),
      status: statusOf(series.status),
      ...(joinNames(series.authors) ? { author: joinNames(series.authors) } : {}),
      ...(joinNames(series.artists) ? { artist: joinNames(series.artists) } : {}),
      // The site scores out of five; the app expects the same scale it is given.
      ...(numberOrUndefined(series.score) !== undefined ? { rating: series.score as number } : {}),
      ...(tags.length > 0 ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
      ...(Object.keys(additionalInfo).length > 0 ? { additionalInfo } : {}),
      shareUrl: `${domain}/manga/${series.slug}`,
    },
  };
}

/** Newest chapter first, which is the order the app lists them in. */
export function parseChapters(rows: ApiChapter[], sourceManga: SourceManga): Chapter[] {
  const sorted = [...rows].sort((a, b) => b.number - a.number);

  return sorted.map((row, index) => {
    const published = row.createdAt ? new Date(row.createdAt) : undefined;

    return {
      // The reader is addressed by chapter number, so that is the stable id.
      chapterId: String(row.number),
      sourceManga,
      langCode: (row.language ?? "en").toLowerCase(),
      chapNum: row.number,
      ...(row.title?.trim() ? { title: row.title.trim() } : {}),
      ...(typeof row.volume === "number" ? { volume: row.volume } : {}),
      ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
      sortingIndex: sorted.length - index,
    };
  });
}

/** Page URLs in reading order, preferring the webp the site itself serves. */
export function parseChapterPages(pages: ApiPage[]): string[] {
  return [...pages]
    .sort((a, b) => a.pageOrder - b.pageOrder)
    .map((page) => page.webpUrl ?? page.avifUrl ?? "")
    .filter((url) => url.length > 0);
}
