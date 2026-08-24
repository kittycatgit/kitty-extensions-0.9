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
  stats?: { views?: number; bookmarksCount?: number };
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

/** Discover rails, matching the sections the site's own home page shows. */
export const HOME_SECTIONS: { id: string; title: string; prop: string }[] = [
  { id: "hero", title: "Featured", prop: "heroItems" },
  { id: "trending", title: "Trending", prop: "trendingItems" },
  { id: "popular", title: "Popular", prop: "popularItems" },
  { id: "rising", title: "Rising", prop: "risingItems" },
  { id: "topUpdate", title: "Top Updates", prop: "topUpdateItems" },
];
