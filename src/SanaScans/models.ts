/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://sanascans.com";
export const API = "https://api.sanascans.com/api";
export const PAGE_SIZE = 30;

export type SanaGenre = { id: number; name: string };

export type SanaChapterRef = {
  id?: number;
  number: number;
  title?: string;
  slug: string;
  createdAt?: string;
  price?: number;
  isLocked?: boolean;
  isAccessible?: boolean;
};

export type SanaPost = {
  id: number;
  slug: string;
  postTitle: string;
  featuredImage?: string;
  seriesType?: string;
  seriesStatus?: string;
  alternativeTitles?: string;
  author?: string;
  artist?: string;
  postContent?: string;
  genres?: SanaGenre[];
  chapters?: SanaChapterRef[];
  averageRating?: number;
  totalRatings?: number;
  totalViews?: number;
  chaptersPricing?: number;
  createdAt?: string;
  lastChapterAddedAt?: string;
  _count?: { chapters?: number; bookmarks?: number; ratings?: number };
};

export type SanaQueryPage = { posts?: SanaPost[]; totalCount?: number };

export type SanaPostDetails = { post: SanaPost; totalChapterCount?: number };

export type SanaChapterList = {
  post?: { chapters?: SanaChapterRef[] };
  totalChapterCount?: number;
};

export type SanaChapterPage = {
  chapter?: SanaChapterRef & { images?: { url: string; order?: number }[] };
};

// Home rails parsed from the site's SSR stream; each key is a rail.
export type HomeItem = {
  slug: string;
  title: string;
  cover: string;
  status?: string;
  type?: string;
  rating?: number;
  views?: number;
  chapters?: number;
  summary?: string;
  genres?: string[];
};

export type TriState = Record<string, "included" | "excluded">;

export type SanaMetadata = {
  page?: number;
  completed?: boolean;
  genres?: TriState;
  types?: string[];
  statuses?: string[];
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "lastChapterAddedAt", label: "Latest Chapters" },
  { id: "totalViews", label: "Popular" },
  { id: "createdAt", label: "Newest" },
  { id: "updatedAt", label: "Recently Updated" },
  { id: "chaptersCount", label: "Most Chapters" },
  { id: "postTitle", label: "A-Z" },
];

export const DEFAULT_SORT = "lastChapterAddedAt";

export const TYPES = [
  { id: "MANGA", title: "Manga" },
  { id: "MANHWA", title: "Manhwa" },
  { id: "MANHUA", title: "Manhua" },
  { id: "NOVEL", title: "Novel" },
];

export const STATUSES = [
  { id: "ONGOING", title: "Ongoing" },
  { id: "COMPLETED", title: "Completed" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "DROPPED", title: "Dropped" },
  { id: "CANCELLED", title: "Cancelled" },
  { id: "COMING_SOON", title: "Coming Soon" },
  { id: "MASS_RELEASED", title: "Mass Released" },
  { id: "ONE_SHOT", title: "One Shot" },
];

export const HOME_RAILS: { id: string; title: string; key: string }[] = [
  { id: "hero", title: "Featured", key: "combinedSliderPosts" },
  { id: "popularToday", title: "Popular Today", key: "todayPosts" },
  { id: "popularWeekly", title: "Popular This Week", key: "weeklyPosts" },
  { id: "popularMonthly", title: "Popular This Month", key: "monthlyPosts" },
];

// Rails backed by the JSON API; `query` is the /api/query string, `latest` the
// /api/posts feed. Nearly the whole catalogue is ongoing, so an "Ongoing" rail
// would repeat the latest feed and is left out.
export const API_RAILS: { id: string; title: string; query?: string; latest?: true }[] = [
  { id: "latestUpdates", title: "Latest Updates", latest: true },
  { id: "newSeries", title: "New Series", query: "orderBy=createdAt&orderDirection=desc" },
  { id: "mostViewed", title: "Most Viewed", query: "orderBy=totalViews&orderDirection=desc" },
  {
    id: "completed",
    title: "Completed",
    query: "seriesStatus=COMPLETED&orderBy=lastChapterAddedAt",
  },
];
