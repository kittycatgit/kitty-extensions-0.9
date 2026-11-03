/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type ToonzRef = { name: string; slug: string };

/** One grid card as rendered on the segment pages and the `/comics` archive. */
export type ToonzCard = {
  slug: string;
  path: string;
  title: string;
  cover: string;
  nsfw: boolean;
  latestChapter?: string;
  updated?: string;
  rating?: string;
};

export type ToonzFeatured = ToonzCard & {
  summary?: string;
  chapters?: string;
};

export type ToonzSegmentRails = {
  featured: ToonzFeatured[];
  newTitles: ToonzCard[];
  recentlyUpdated: ToonzCard[];
  trendingToday: ToonzCard[];
  trendingWeek: ToonzCard[];
  popularToday: ToonzCard[];
  popularWeek: ToonzCard[];
};

export type ToonzListing = { cards: ToonzCard[]; hasNext: boolean };

export type ToonzSeries = {
  comicId: string;
  slug: string;
  path: string;
  title: string;
  cover: string;
  banner?: string;
  synopsis: string;
  details: Record<string, string>;
  authors: string[];
  genres: ToonzRef[];
  themes: { group: string; tags: string[] }[];
  altTitles: string[];
  ratingAvg?: number;
  ratingCount?: number;
  chapterCount?: number;
  comicType?: string;
  nsfw: boolean;
};

export type ToonzApiChapter = {
  id: number;
  chapterNumber: string;
  title: string | null;
  slug: string;
  pageCount?: number;
  date?: string;
};

export type ToonzApiSearchItem = {
  id: number;
  title: string;
  slug: string;
  cover_thumb?: string;
  type?: string;
  catalog?: string;
  authors?: string[];
};

export type TriState = Record<string, "included" | "excluded">;

export type ToonzSearchMetadata = {
  page?: number;
  completed?: boolean;
  genres?: TriState;
  status?: string;
  types?: string[];
  rating?: string;
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest update" },
  { id: "popular", label: "Most popular" },
  { id: "rating", label: "Top rated" },
  { id: "a-z", label: "A to Z" },
];

export const DEFAULT_SORT = "latest";

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
  { id: "upcoming", title: "Upcoming" },
];

export const TYPES = [
  { id: "manhwa", title: "Manhwa" },
  { id: "manga", title: "Manga" },
  { id: "manhua", title: "Manhua" },
  { id: "webtoon", title: "Webtoon" },
  { id: "comic", title: "Comic" },
];

export const RATINGS = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Explicit" },
];

export const SEGMENTS = [
  { id: "manhwa", title: "Manhwa" },
  { id: "manga", title: "Manga" },
] as const;

export const SEGMENT_RAILS: { key: keyof ToonzSegmentRails; title: string }[] = [
  { key: "featured", title: "Top Rated This Month" },
  { key: "newTitles", title: "New Titles" },
  { key: "recentlyUpdated", title: "Recently Updated" },
  { key: "trendingToday", title: "Trending Today" },
  { key: "trendingWeek", title: "Trending This Week" },
  { key: "popularToday", title: "Popular Updates Today" },
  { key: "popularWeek", title: "Popular Updates This Week" },
];

export const ARCHIVE_RAILS = [
  { id: "archive-latest", title: "Latest Updates", sort: "latest" },
  { id: "archive-popular", title: "Most Popular", sort: "popular" },
  { id: "archive-rating", title: "Top Rated", sort: "rating" },
];
