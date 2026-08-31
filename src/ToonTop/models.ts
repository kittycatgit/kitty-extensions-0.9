/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type ToonTopAltName = {
  name?: string;
  language?: string;
};

export type ToonTopRef = {
  id: string;
  name: string;
  slug: string;
};

export type ToonTopStats = {
  views?: number;
  dayViews?: number;
  weekViews?: number;
  monthViews?: number;
  bookmarksCount?: number;
};

export type ToonTopItem = {
  id: string;
  url: string;
  name: string;
  slug: string;
  cover?: string;
  status?: string;
  summary?: string;
  rating?: number;
  updatedAt?: string;
  altName?: string;
  altNames?: ToonTopAltName[] | null;
  displayViews?: string;
  displayChapters?: string;
  displayUpdated?: string;
  isAdult?: boolean;
  isRaw?: boolean;
  isMtl?: boolean;
  authors?: ToonTopRef[];
  artists?: ToonTopRef[];
  genres?: ToonTopRef[];
  tags?: ToonTopRef[];
  chapters?: ToonTopChapter[];
  stats?: ToonTopStats;
};

export type ToonTopChapter = {
  id: string;
  name: string;
  slug: string;
  url: string;
  number?: number;
  updatedAt?: string;
  group?: string | null;
  views?: number;
};

export type ToonTopPagination = {
  page?: number;
  total_pages?: number;
  has_next?: boolean;
};

export type ToonTopSearchMetadata = {
  page?: number;
  genre?: string;
  completed?: boolean;
};

// Only the genre listings honour these; latest and popular ignore sort.
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest" },
  { id: "popular", label: "Popular" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Top Rated" },
];

export const DEFAULT_SORT = "latest";

// Ranked here, not by the site: listing rows carry day/week/month view counts,
// but no listing endpoint will sort by them.
export const RANKED_SECTIONS: {
  id: string;
  title: string;
  by: keyof ToonTopStats | "rating";
}[] = [
  { id: "topToday", title: "Top Today", by: "dayViews" },
  { id: "topWeek", title: "Top This Week", by: "weekViews" },
  { id: "topMonth", title: "Top This Month", by: "monthViews" },
  { id: "topRated", title: "Top Rated", by: "rating" },
  { id: "mostBookmarked", title: "Most Bookmarked", by: "bookmarksCount" },
];

// `prop` is the key each section sits under in the home page's embedded props.
export const HOME_SECTIONS: { id: string; title: string; prop: string }[] = [
  { id: "hero", title: "Featured", prop: "heroItems" },
  { id: "trending", title: "Trending", prop: "trendingItems" },
  { id: "popular", title: "Popular", prop: "popularItems" },
  { id: "rising", title: "Rising", prop: "risingItems" },
  { id: "topUpdate", title: "Top Updates", prop: "topUpdateItems" },
];
