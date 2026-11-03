/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://webtoonclub.com";

export type WebtoonClubRef = { name: string; slug: string };

/** One grid card as rendered on the home page and the `/webtoons` archive. */
export type WebtoonClubCard = {
  slug: string;
  title: string;
  cover: string;
  nsfw: boolean;
  latestChapter?: string;
  updated?: string;
  rating?: string;
  type?: string;
  status?: string;
  genres?: string[];
};

export type WebtoonClubFeatured = WebtoonClubCard & {
  summary?: string;
};

export type WebtoonClubHomeRails = {
  featured: WebtoonClubFeatured[];
  trendingToday: WebtoonClubCard[];
  trendingWeek: WebtoonClubCard[];
  popularToday: WebtoonClubCard[];
  popularWeek: WebtoonClubCard[];
  newTitles: WebtoonClubCard[];
  recentlyUpdated: WebtoonClubCard[];
};

export type WebtoonClubListing = { cards: WebtoonClubCard[]; hasNext: boolean };

export type WebtoonClubSeries = {
  comicId: string;
  slug: string;
  title: string;
  cover: string;
  synopsis: string;
  details: Record<string, string>;
  authors: string[];
  genres: WebtoonClubRef[];
  altTitles: string[];
  ratingAvg?: number;
  ratingCount?: number;
  nsfw: boolean;
};

export type WebtoonClubApiChapter = {
  id: number;
  chapterNumber: string;
  title: string | null;
  slug: string;
  pageCount?: number;
  date?: string;
};

export type WebtoonClubSearchMetadata = {
  page?: number;
  completed?: boolean;
  genre?: string;
  status?: string;
  type?: string;
};

// The site's own menu links `newest`, `chapters` and `title`, but the server
// ignores those; these are the values it actually orders by.
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest update" },
  { id: "popular", label: "Most popular" },
  { id: "rating", label: "Top rated" },
  { id: "oldest", label: "Oldest update" },
  { id: "a-z", label: "A to Z" },
  { id: "z-a", label: "Z to A" },
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

export const HOME_RAILS: { key: keyof WebtoonClubHomeRails; title: string }[] = [
  { key: "featured", title: "Top Rated This Month" },
  { key: "trendingToday", title: "Trending Today" },
  { key: "trendingWeek", title: "Trending This Week" },
  { key: "popularToday", title: "Popular Updates Today" },
  { key: "popularWeek", title: "Popular Updates This Week" },
  { key: "newTitles", title: "New Titles" },
  { key: "recentlyUpdated", title: "Recently Updated" },
];

export const ARCHIVE_RAILS: { id: string; title: string; sort: string; status?: string }[] = [
  { id: "archive-latest", title: "Latest Updates", sort: "latest" },
  { id: "archive-popular", title: "Most Popular", sort: "popular" },
  { id: "archive-rating", title: "Top Rated", sort: "rating" },
  { id: "archive-ongoing", title: "Ongoing", sort: "latest", status: "ongoing" },
  { id: "archive-completed", title: "Completed", sort: "latest", status: "completed" },
];
