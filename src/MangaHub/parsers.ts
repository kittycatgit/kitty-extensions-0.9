/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type Chapter, type SourceManga, type Tag } from "@paperback/types";

import {
  COVER_CDN,
  DOMAIN,
  FALLBACK_COVER,
  GENRES,
  PAGE_CDN,
  STATUS_LABELS,
  type ApiChapter,
  type ApiChapterFull,
  type ApiManga,
} from "./models";

/** The catalogue's slug for each genre, looked up by display name. */
const GENRE_SLUGS = new Map(GENRES.map((genre) => [genre.title.toLowerCase(), genre.id]));

/**
 * Turns a genre name into a usable tag id.
 *
 * An id may only hold alphanumerics and `._-@()[]%?#+=/&:`, so a name such as
 * "Martial Arts" is rejected outright and takes the whole title with it. The
 * catalogue's own slug is preferred so the id also matches the search filter.
 */
export function genreId(name: string): string {
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

/**
 * Covers arrive as a bare path such as `mh/eleceed.jpg`.
 *
 * Some titles have none at all, and an empty string is not a URL the app will
 * accept, so those fall back to a placeholder rather than being emitted blank.
 */
export function coverUrl(image: string | null | undefined): string {
  const path = (image ?? "").trim();

  if (!path) {
    return FALLBACK_COVER;
  }

  return /^https?:\/\//i.test(path) ? path : `${COVER_CDN}/${path.replace(/^\/+/, "")}`;
}

export function contentRatingOf(manga: ApiManga): ContentRating {
  if (manga.isPorn || manga.isSoftPorn) {
    return ContentRating.ADULT;
  }

  // Listing rows only carry `isSafe`, so anything not flagged safe is treated
  // as mature rather than assumed harmless.
  return manga.isSafe ? ContentRating.EVERYONE : ContentRating.MATURE;
}

function statusOf(raw: string | null | undefined): string {
  const key = (raw ?? "").toLowerCase();
  return STATUS_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");
}

/** `genres` is a comma-separated string rather than a list. */
export function splitGenres(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * `alternativeTitle` is a semicolon-separated string.
 *
 * Anything that is not a usable string is dropped: a non-string reaching
 * `secondaryTitles` fails to cross the bridge and takes the title with it.
 */
export function splitAlternativeTitles(raw: string | null | undefined): string[] {
  const titles: string[] = [];

  for (const part of (raw ?? "").split(";")) {
    const cleaned = typeof part === "string" ? part.trim() : "";
    if (cleaned && !titles.includes(cleaned)) {
      titles.push(cleaned);
    }
  }

  return titles;
}

export function parseMangaDetails(manga: ApiManga): SourceManga {
  const genres = splitGenres(manga.genres);
  const tags: Tag[] = genres.map((genre) => ({ id: genreId(genre), title: genre }));
  const chapterCount = manga.chapters?.length;

  const additionalInfo: Record<string, string> = {};
  if (typeof manga.latestChapter === "number") {
    additionalInfo["Latest Chapter"] = String(manga.latestChapter);
  }
  if (typeof chapterCount === "number") {
    additionalInfo["Chapters"] = String(chapterCount);
  }
  if (typeof manga.rank === "number") {
    additionalInfo["Rank"] = `#${manga.rank}`;
  }
  if (manga.isWebtoon) {
    additionalInfo["Format"] = "Webtoon";
  }
  if (manga.isLicensed) {
    additionalInfo["Licensed"] = "Yes";
  }
  if (manga.updatedDate) {
    const updated = new Date(manga.updatedDate);
    if (!Number.isNaN(updated.getTime())) {
      additionalInfo["Updated"] = updated.toISOString().slice(0, 10);
    }
  }

  return {
    mangaId: manga.slug,
    mangaInfo: {
      primaryTitle: manga.title?.trim() || manga.slug,
      secondaryTitles: splitAlternativeTitles(manga.alternativeTitle),
      thumbnailUrl: coverUrl(manga.image),
      synopsis: (manga.description ?? "").trim(),
      contentRating: contentRatingOf(manga),
      status: statusOf(manga.status),
      ...(manga.author?.trim() ? { author: manga.author.trim() } : {}),
      ...(manga.artist?.trim() ? { artist: manga.artist.trim() } : {}),
      ...(tags.length > 0 ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
      ...(Object.keys(additionalInfo).length > 0 ? { additionalInfo } : {}),
      shareUrl: `${DOMAIN}/manga/${manga.slug}`,
    },
  };
}

/** The API lists chapters oldest first; the app shows them newest first. */
export function parseChapters(rows: ApiChapter[], sourceManga: SourceManga): Chapter[] {
  const sorted = [...rows].sort((a, b) => b.number - a.number);

  return sorted.map((row, index) => {
    const published = row.date ? new Date(row.date) : undefined;

    return {
      // The reader is addressed by chapter number, so that is the stable id.
      chapterId: String(row.number),
      sourceManga,
      langCode: "en",
      chapNum: row.number,
      ...(row.title?.trim() ? { title: row.title.trim() } : {}),
      ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
      sortingIndex: sorted.length - index,
    };
  });
}

/**
 * Builds page URLs from the reader payload.
 *
 * `pages` is a JSON *string* holding a shared path and the file name of each
 * page, which are joined onto the image CDN.
 */
export function parseChapterPages(chapter: ApiChapterFull): string[] {
  const raw = chapter.pages;
  if (!raw) {
    return [];
  }

  let payload: unknown;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const { p, i } = payload as { p?: unknown; i?: unknown };
  const prefix = typeof p === "string" ? p : "";

  if (!Array.isArray(i)) {
    return [];
  }

  return i
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .map((name) => `${PAGE_CDN}/${`${prefix}${name}`.replace(/^\/+/, "")}`);
}
