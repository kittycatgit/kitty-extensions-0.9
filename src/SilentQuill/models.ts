/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://www.silentquill.net";

// Series and chapters both live at the site root; only the slug identifies them.
export const seriesUrl = (slug: string): string => `${DOMAIN}/${slug}/`;

export const chapterUrl = (slug: string): string => `${DOMAIN}/${slug}/`;

export const browseUrl = (page: number, order: string, extra = ""): string =>
  `${DOMAIN}/manga/?page=${page}&order=${order}${extra}`;

// Filters are dropped when a title is supplied, so the two never share a URL.
export const searchUrl = (title: string, page: number): string =>
  `${DOMAIN}/page/${page}/?s=${encodeURIComponent(title)}`;

export type SilentQuillMetadata = {
  page?: number;
  completed?: boolean;
  genres?: string[];
  status?: string;
  type?: string;
  seen?: string[];
};

export const ORDERS = [
  { id: "update", label: "Latest Update" },
  { id: "popular", label: "Popular" },
  { id: "latest", label: "Recently Added" },
  { id: "title", label: "A-Z" },
  { id: "titlereverse", label: "Z-A" },
];

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

export const TYPES = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "comic", title: "Comic" },
  { id: "novel", title: "Novel" },
];

// Titles follow the site's own home page rails.
export const ROWS = [
  { id: "new_releases", title: "New Releases", order: "update" },
  { id: "popular", title: "Popular", order: "popular" },
  { id: "new_series", title: "New Series", order: "latest" },
];

export const SEEN_LIMIT = 360;
