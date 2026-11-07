/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://www.scribblehub.com";

// The site's default avatar; an empty imageUrl would fail the whole rail.
export const PLACEHOLDER_COVER = "https://cdn.scribblehub.com/default/avatarnew.png";

export type Option = { id: string; title: string };
export type TriState = Record<string, "included" | "excluded">;

export type Vocab = { genres: Option[]; tags: Option[]; warnings: Option[] };

export type SearchMetadata = {
  genres?: TriState;
  genreMode?: "and" | "or";
  tags?: TriState;
  warnings?: TriState;
  status?: string;
  page?: number;
};

export type Card = {
  id: string;
  title: string;
  cover: string;
  subtitle?: string;
  chapterId?: string;
};

export type ChapterRow = {
  id: string;
  order: number;
  title: string;
  date?: Date;
};

export type SeriesStats = Record<string, string>;

export type Series = {
  title: string;
  cover: string;
  synopsis: string;
  author?: string;
  status?: string;
  lastUpdate?: string;
  rating?: number;
  ratingCount?: string;
  genres: Option[];
  tags: Option[];
  warnings: Option[];
  stats: SeriesStats;
};

export const HOME_SECTIONS = {
  trending: "trending",
  latest: "latest-series",
  updates: "latest-updates",
} as const;

export const STATUSES: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

export const GENRE_MODES: Option[] = [
  { id: "and", title: "Match every genre" },
  { id: "or", title: "Match any genre" },
];

export const DEFAULT_SORT = "pageviews";

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "pageviews", label: "Pageviews" },
  { id: "lastchpdate", label: "Last update" },
  { id: "dateadded", label: "Date added" },
  { id: "ratings", label: "Ratings" },
  { id: "numofrate", label: "Number of ratings" },
  { id: "favorites", label: "Favorites" },
  { id: "readers", label: "Readers" },
  { id: "reviews", label: "Reviews" },
  { id: "chapters", label: "Chapters" },
  { id: "frequency", label: "Chapters per week" },
  { id: "pages", label: "Pages" },
  { id: "totalwords", label: "Total words" },
];

export const VOCAB_STATE_KEY = "scribblehub.vocab";
export const VOCAB_TTL = 24 * 60 * 60 * 1000;

// Snapshot of the series finder, used only when the live form cannot be read.
export const FALLBACK_GENRES: Option[] = [
  { id: "9", title: "Action" },
  { id: "902", title: "Adult" },
  { id: "8", title: "Adventure" },
  { id: "891", title: "Boys Love" },
  { id: "7", title: "Comedy" },
  { id: "903", title: "Drama" },
  { id: "904", title: "Ecchi" },
  { id: "38", title: "Fanfiction" },
  { id: "19", title: "Fantasy" },
  { id: "905", title: "Gender Bender" },
  { id: "892", title: "Girls Love" },
  { id: "1015", title: "Harem" },
  { id: "21", title: "Historical" },
  { id: "22", title: "Horror" },
  { id: "37", title: "Isekai" },
  { id: "906", title: "Josei" },
  { id: "1180", title: "LitRPG" },
  { id: "907", title: "Martial Arts" },
  { id: "20", title: "Mature" },
  { id: "908", title: "Mecha" },
  { id: "909", title: "Mystery" },
  { id: "910", title: "Psychological" },
  { id: "6", title: "Romance" },
  { id: "911", title: "School Life" },
  { id: "912", title: "Sci-fi" },
  { id: "913", title: "Seinen" },
  { id: "914", title: "Slice of Life" },
  { id: "915", title: "Smut" },
  { id: "916", title: "Sports" },
  { id: "5", title: "Supernatural" },
  { id: "901", title: "Tragedy" },
];

export const FALLBACK_WARNINGS: Option[] = [
  { id: "48", title: "Gore" },
  { id: "50", title: "Sexual Content" },
  { id: "49", title: "Strong Language" },
];
