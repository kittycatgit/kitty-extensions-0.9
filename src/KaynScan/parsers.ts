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
  type ApiChapterDetail,
  type ApiPosts,
  type ApiRecentChapter,
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

/**
 * Genres arrive either as objects or as bare names depending on the route.
 *
 * A tag's id crosses the bridge and so must keep to the characters ids may use;
 * a name like "slice of life" has spaces in it and would be refused, taking the
 * whole series with it. The site's own numeric id is used where there is one,
 * and a name is reduced to something legal where there is not.
 */
function genreTags(series: ApiSeries): { id: string; title: string }[] {
  const tags: { id: string; title: string }[] = [];

  for (const genre of series.genres ?? []) {
    const title = (typeof genre === "string" ? genre : (genre?.name ?? "")).trim();

    if (!title) {
      continue;
    }

    const id =
      typeof genre === "string" || genre?.id === undefined
        ? title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        : String(genre.id);

    if (id) {
      tags.push({ id, title });
    }
  }

  return tags;
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
  const type = (series.seriesType ?? "").trim();
  const tags = genreTags(series);
  const tagGroups: TagSection[] = tags.length ? [{ id: "genres", title: "Genres", tags }] : [];

  const synopsis = series.postContent ? $(`<div>${series.postContent}</div>`).text().trim() : "";

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: (series.postTitle ?? "").trim() || mangaId,
      secondaryTitles: [],
      thumbnailUrl: usable(series.featuredImage),
      synopsis,
      contentRating: ContentRating.MATURE,
      // The app reads a novel differently from a comic, so it is told which
      // this is rather than being left to find out at the first chapter.
      contentType: type.toUpperCase() === "NOVEL" ? "novel" : "comic",
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
    // The chapter route is addressed by id, and an id is always safe to carry.
    const chapterId = row.id === undefined ? "" : String(row.id);

    if (!chapterId) {
      continue;
    }

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

/** A card as a row shows it. Rows are kept ready-made so the whole catalogue
 * need not be held in state just to slice it. */
export type RowItem = { mangaId: string; title: string; imageUrl: string; subtitle?: string };
export type ReleaseItem = RowItem & { chapterId: string };

export type HomeRows = {
  popular: RowItem[];
  fresh: RowItem[];
  completed: RowItem[];
  mostPopular: RowItem[];
  latest: RowItem[];
  novels: RowItem[];
  releases: ReleaseItem[];
  genres: { id: string; title: string }[];
};

function addedAt(series: ApiSeries): number {
  const stamp = series.lastChapterAddedAt ?? series.updatedAt ?? null;
  const time = stamp ? new Date(stamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function toRow(list: ApiSeries[], cap: number): RowItem[] {
  const items: RowItem[] = [];

  for (const series of list) {
    const result = toSearchResult(series);

    if (!result) {
      continue;
    }

    const subtitle = seriesSubtitle(series);
    items.push({
      mangaId: result.mangaId,
      title: result.title,
      imageUrl: result.imageUrl,
      ...(subtitle ? { subtitle } : {}),
    });

    if (items.length >= cap) {
      break;
    }
  }

  return items;
}

/**
 * The home screen's rows, cut from the single reply the site's own front page
 * asks for.
 *
 * Each is the site's own idea of itself: what it marks hot today, what it calls
 * new, what has finished, what is rated highest, what has just had a chapter
 * posted, and the novels it keeps in a list of their own. The genres are the
 * ones actually worn by something here, so every one leads somewhere.
 */
export function toHomeRows(payload: ApiPosts, cap: number): HomeRows {
  const posts = (payload.posts ?? []).filter((series) => (series.slug ?? "").trim().length > 0);
  const novels = (payload.novelPosts ?? []).filter((s) => (s.slug ?? "").trim().length > 0);

  const rated = [...posts].sort(
    (left, right) => (right.averageRating ?? 0) - (left.averageRating ?? 0),
  );
  const recent = [...posts].sort((left, right) => addedAt(right) - addedAt(left));

  const releases: ReleaseItem[] = [];
  const pending = [...posts]
    .flatMap((series) =>
      ((series.chapters ?? []) as ApiRecentChapter[]).map((chapter) => ({ series, chapter })),
    )
    .filter(({ chapter }) => {
      // A chapter still behind a timer or a price cannot be opened, so it is
      // not offered as something just released.
      return (
        chapter.id !== undefined && chapter.isLocked !== true && chapter.isAccessible !== false
      );
    })
    .sort((left, right) => {
      const at = (value: ApiRecentChapter) =>
        value.createdAt ? new Date(value.createdAt).getTime() || 0 : 0;
      return at(right.chapter) - at(left.chapter);
    });

  for (const { series, chapter } of pending) {
    const result = toSearchResult(series);

    if (!result) {
      continue;
    }

    const number = Number(chapter.number);
    releases.push({
      mangaId: result.mangaId,
      chapterId: String(chapter.id),
      title: result.title,
      imageUrl: result.imageUrl,
      ...(Number.isFinite(number) && number > 0 ? { subtitle: `Chapter ${number}` } : {}),
    });

    if (releases.length >= cap) {
      break;
    }
  }

  const genres = new Map<string, string>();
  for (const series of [...posts, ...novels]) {
    for (const tag of genreTags(series)) {
      if (!genres.has(tag.id)) {
        genres.set(tag.id, tag.title);
      }
    }
  }

  const statusIs = (series: ApiSeries, value: string) =>
    (series.seriesStatus ?? "").toUpperCase() === value;

  return {
    popular: toRow(
      posts.filter((series) => series.hot === true),
      cap,
    ),
    fresh: toRow(
      posts.filter((series) => series.isNew === true),
      cap,
    ),
    completed: toRow(
      posts.filter((series) => statusIs(series, "COMPLETED")),
      cap,
    ),
    mostPopular: toRow(rated, cap),
    latest: toRow(recent, cap),
    novels: toRow(novels, cap),
    releases,
    genres: [...genres.entries()]
      .map(([id, title]) => ({ id, title }))
      .sort((left, right) => left.title.localeCompare(right.title)),
  };
}

/** A comic chapter's pages, in the order the site gives them. */
export function toPages(detail: ApiChapterDetail): string[] {
  return [...(detail.images ?? [])]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((image) => usable(image.url))
    .filter((url) => !url.endsWith("/_no-cover.png"));
}

/**
 * A novel chapter's text.
 *
 * It arrives as the site's own markup, which the app renders, so it is passed
 * through - short of anything that would run rather than be read.
 */
export function toNovelHtml(detail: ApiChapterDetail): string {
  return (detail.content ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .trim();
}
