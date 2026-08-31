/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://www.zinmanga.net";

// No trailing slash: `/manga/{slug}/` 301s to the same path on plain http,
// which iOS refuses to follow (App Transport Security), so the page never loads.
export const seriesUrl = (slug: string): string => `${DOMAIN}/manga/${slug}`;

export const chapterUrl = (slug: string, chapterSlug: string): string =>
  `${DOMAIN}/manga/${slug}/${chapterSlug}`;

export const chaptersApiUrl = (slug: string): string =>
  `${DOMAIN}/api/comics/${encodeURIComponent(slug)}/chapters?per_page=-1&order=desc`;

export interface ZinChapter {
  chapter_id?: number;
  chapter_num?: number | string | null;
  chapter_name?: string | null;
  chapter_slug?: string | null;
  updated_at?: string | null;
  view?: number | null;
}

export interface ZinChapterPage {
  success?: boolean;
  data?: { chapters?: ZinChapter[]; total?: number };
}

export type ZinSearchMetadata = {
  page?: number;
  completed?: boolean;
  genres?: string[];
  seen?: string[];
};

export const SORTS: { id: string; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "latest", label: "Latest" },
  { id: "views", label: "Most read" },
  { id: "trending", label: "Trending" },
  { id: "rating", label: "Rating" },
  { id: "alphabet", label: "A-Z" },
];

// No "New Series" row on purpose: `new-manga` and `latest` return mostly the
// same titles.
export const ROWS: { id: string; title: string; ordering: string }[] = [
  { id: "most_popular", title: "Most Popular", ordering: "views" },
  { id: "recently_updated", title: "Recently Updated", ordering: "latest" },
  { id: "currently_trending", title: "Currently Trending", ordering: "trending" },
  { id: "top_rated", title: "Highest Rated", ordering: "rating" },
];

export const SEEN_LIMIT = 360;
