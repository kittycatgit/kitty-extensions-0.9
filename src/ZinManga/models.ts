/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://www.zinmanga.net";

/**
 * Paths are written without a trailing slash, deliberately.
 *
 * `/manga/{slug}/` is answered with a 301 to the same path on plain **http**,
 * which iOS refuses to follow at all - the request fails outright as an App
 * Transport Security error and the page never loads. Without the slash the page
 * is served directly, over the connection it was asked for.
 */
export const seriesUrl = (slug: string): string => `${DOMAIN}/manga/${slug}`;

export const chapterUrl = (slug: string, chapterSlug: string): string =>
  `${DOMAIN}/manga/${slug}/${chapterSlug}`;

export const chaptersApiUrl = (slug: string): string =>
  `${DOMAIN}/api/comics/${encodeURIComponent(slug)}/chapters?per_page=-1&order=desc`;

/** One chapter, as the site's own reader asks for it. */
export interface ZinChapter {
  chapter_id?: number;
  chapter_num?: number | string | null;
  chapter_name?: string | null;
  chapter_slug?: string | null;
  updated_at?: string | null;
  view?: number | null;
}

/** What the chapter endpoint answers with. */
export interface ZinChapterPage {
  success?: boolean;
  data?: { chapters?: ZinChapter[]; total?: number };
}

/** Paging and filter state carried between pages of results. */
export type ZinSearchMetadata = {
  page?: number;
  completed?: boolean;
  genres?: string[];
  seen?: string[];
};

/** The orderings the site's own listing offers. */
export const SORTS: { id: string; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "latest", label: "Latest" },
  { id: "views", label: "Most read" },
  { id: "trending", label: "Trending" },
  { id: "rating", label: "Rating" },
  { id: "alphabet", label: "A-Z" },
];

/**
 * The rows on the discover page, and the ordering behind each.
 *
 * Each was checked against the others: no two return the same titles. The
 * theme's usual "New Series" row is not among them - `new-manga` and `latest`
 * share eight of their twelve titles, because a series added this week is also
 * one updated this week.
 */
export const ROWS: { id: string; title: string; ordering: string }[] = [
  { id: "most_popular", title: "Most Popular", ordering: "views" },
  { id: "recently_updated", title: "Recently Updated", ordering: "latest" },
  { id: "currently_trending", title: "Currently Trending", ordering: "trending" },
  { id: "top_rated", title: "Highest Rated", ordering: "rating" },
];

/** How many already-shown titles a row remembers while it is scrolled. */
export const SEEN_LIMIT = 360;
