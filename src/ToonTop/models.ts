/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

/** A named reference as the site returns them (genres, tags, authors). */
export type ToonTopRef = {
  id: string;
  name: string;
  slug: string;
};

/** A row in any listing, and the detail payload, share one shape. */
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
  altNames?: string[] | null;
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

/** `sort` accepted by the genre listings. */
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest" },
  { id: "popular", label: "Popular" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Top Rated" },
];

export const DEFAULT_SORT = "latest";

/**
 * Rankings computed locally. The site ships per-title day/week/month view
 * counts on every listing row, but neither `latest` nor `popular` honours a
 * sort parameter, so these are ordered client side over a pooled sample.
 */
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

/** Discover rails, matching the sections the site's own home page shows. */
export const HOME_SECTIONS: { id: string; title: string; prop: string }[] = [
  { id: "hero", title: "Featured", prop: "heroItems" },
  { id: "trending", title: "Trending", prop: "trendingItems" },
  { id: "popular", title: "Popular", prop: "popularItems" },
  { id: "rising", title: "Rising", prop: "risingItems" },
  { id: "topUpdate", title: "Top Updates", prop: "topUpdateItems" },
];
