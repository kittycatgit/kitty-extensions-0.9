/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type MangaKAltName = {
  name?: string;
  language?: string;
};

export type MangaKRef = {
  id: string;
  name: string;
  slug: string;
};

export type MangaKStats = {
  views?: number;
  bookmarksCount?: number;
  chaptersCount?: number;
};

export type MangaKItem = {
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
  altNames?: (MangaKAltName | string)[] | null;
  displayViews?: string;
  displayBookmarks?: string;
  displayChapters?: string;
  displayUpdated?: string;
  isAdult?: boolean;
  isRaw?: boolean;
  isMtl?: boolean;
  authors?: MangaKRef[];
  artists?: MangaKRef[];
  genres?: MangaKRef[];
  tags?: MangaKRef[];
  type?: { name?: string; slug?: string } | null;
  demographic?: string | null;
  contentRating?: string | null;
  chapters?: MangaKChapter[];
  stats?: MangaKStats;
};

export type MangaKChapter = {
  id: string;
  name: string;
  slug: string;
  url: string;
  // The page props spell this `updatedAt`; the chapter feed spells it `updated_at`.
  updatedAt?: string;
  updated_at?: string;
  group?: string | null;
};

export type MangaKChapterFeed = {
  data?: { chapters?: MangaKChapter[] };
};

export type MangaKPagination = {
  page?: number;
  total_pages?: number;
  has_next?: boolean;
};

export type TriState = Record<string, "included" | "excluded">;

export type MangaKMetadata = {
  page?: number;
  completed?: boolean;
  genres?: TriState;
  status?: string;
  type?: string;
  demographics?: string[];
  rating?: string;
  formats?: string[];
  minChapters?: string;
  maxChapters?: string;
  tag?: string;
  author?: string;
  raw?: boolean;
  uncensored?: boolean;
  mtl?: boolean;
};

export type Option = { id: string; title: string };

// The site's own sort vocabulary; "best match" is what it uses when a title is
// searched without a sort, so it is not listed.
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest Updated" },
  { id: "newest", label: "Recently Added" },
  { id: "popular", label: "Most Followed" },
  { id: "rating", label: "Highest Rating" },
  { id: "views_today", label: "Most Viewed: Today" },
  { id: "views_7days", label: "Most Viewed: 7 Days" },
  { id: "views_30days", label: "Most Viewed: 30 Days" },
  { id: "views", label: "Most Viewed: All Time" },
  { id: "chapters", label: "Most Chapters" },
  { id: "alphabetical", label: "A-Z" },
];

export const DEFAULT_SORT = "latest";

export const STATUSES: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const TYPES: Option[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
];

export const DEMOGRAPHICS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
];

export const RATINGS: Option[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const FORMATS: Option[] = [
  { id: "4-koma", title: "4-Koma" },
  { id: "adaptation", title: "Adaptation" },
  { id: "full-color", title: "Full Color" },
  { id: "oneshot", title: "Oneshot" },
  { id: "web-comic", title: "Web Comic" },
];

// `prop` is the key each rail sits under in the home page's embedded props.
export const HOME_SECTIONS: { id: string; title: string; prop: string }[] = [
  { id: "hero", title: "Featured", prop: "heroItems" },
  { id: "trending", title: "Trending", prop: "trendingItems" },
  { id: "popular", title: "Popular", prop: "popularItems" },
  { id: "rising", title: "Rising", prop: "risingItems" },
  { id: "topUpdate", title: "Top Updates", prop: "topUpdateItems" },
  { id: "newManga", title: "New Series", prop: "newMangaItems" },
];

// Ranked by the site's search sorts, so these page like any search.
export const RANKED_SECTIONS: { id: string; title: string; sort: string }[] = [
  { id: "topToday", title: "Top Today", sort: "views_today" },
  { id: "topWeek", title: "Top This Week", sort: "views_7days" },
  { id: "topMonth", title: "Top This Month", sort: "views_30days" },
  { id: "topRated", title: "Top Rated", sort: "rating" },
  { id: "mostFollowed", title: "Most Followed", sort: "popular" },
];
