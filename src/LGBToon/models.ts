/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://lgbtoon.com";

// The API clamps anything larger back down to this.
export const PAGE_SIZE = 60;

export type TriState = Record<string, "included" | "excluded">;

export type Option = { id: string; title: string };

/** One row of `/api/titles`. */
export type ApiTitle = {
  id: string;
  slug: string;
  title: string;
  href: string;
  cover?: string;
  imgUrl?: string;
  latestChapter?: string;
  latestChapterNum?: number;
  tags?: string[];
  author?: string;
  synopsis?: string;
  status?: string;
  views?: number;
  rating?: number;
  updatedAt?: string;
  type?: string;
  typeLabel?: string;
  is18plus?: boolean;
  subgenre?: string;
};

export type ApiTitlesPage = {
  status?: string;
  data?: { items?: ApiTitle[]; total?: number; page?: number; totalPages?: number };
};

/** One card of the home page's embedded `initialData`. */
export type HomeItem = {
  href: string;
  title: string;
  imgUrl?: string;
  cover?: string;
  type?: string;
  typeLabel?: string;
  chapter?: string;
  timeAgo?: string;
  is18plus?: boolean;
  subgenre?: string;
};

export type HomeData = {
  trending?: { day?: HomeItem[]; week?: HomeItem[]; month?: HomeItem[] };
  latest?: { hot?: HomeItem[]; new?: HomeItem[] };
};

export type FlightRef = { id: number; title: string };

export type FlightChapter = {
  id: string;
  number: number;
  name?: string;
  date?: string;
  language?: string;
  source?: string;
};

/** The `initialDetail` object embedded in a series page. */
export type FlightSeries = {
  hid: string;
  slug: string;
  url?: string;
  title: string;
  altTitles?: string[];
  poster?: string;
  banner?: string;
  type?: string;
  typeLabel?: string;
  status?: string;
  year?: number;
  contentRating?: string;
  rating?: number;
  ratingCount?: number;
  follows?: number;
  genres?: FlightRef[];
  themes?: FlightRef[];
  demographics?: FlightRef[];
  authors?: FlightRef[];
  artists?: FlightRef[];
  is18plus?: boolean;
  subgenre?: string;
  chapters?: FlightChapter[];
};

export type LGBToonSearchMetadata = {
  page?: number;
  completed?: boolean;
  genres?: TriState;
  types?: string[];
  demographic?: string;
  status?: string;
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "chapter_updated_at:desc", label: "Latest Updates" },
  { id: "views_7d:desc", label: "Trending (7 days)" },
  { id: "created_at:desc", label: "Recently Added" },
  { id: "views_total:desc", label: "Most Viewed" },
  { id: "follows_total:desc", label: "Most Followed" },
];

export const TYPES: Option[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "other", title: "Other" },
];

export const DEMOGRAPHICS: Option[] = [
  { id: "boys-love", title: "Boys' Love" },
  { id: "girls-love", title: "Girls' Love" },
];

// The UI's releasing/finished values return nothing; the API wants these.
export const STATUSES: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

/** Rails read from the home page's embedded data, in the order the site shows them. */
// The site serves the same list for its Day and Week trending tabs, so Week is skipped.
export const HOME_SECTIONS = [
  { id: "trending-day", title: "Trending Today", pick: (d: HomeData) => d.trending?.day },
  { id: "trending-month", title: "Trending This Month", pick: (d: HomeData) => d.trending?.month },
  { id: "fresh-hot", title: "Fresh Chapters: Hot", pick: (d: HomeData) => d.latest?.hot },
  { id: "fresh-new", title: "Fresh Chapters: New", pick: (d: HomeData) => d.latest?.new },
] as const;

/** Paged rails backed by `/api/titles`. */
export const API_SECTIONS = [
  { id: "recently-updated", title: "Recently Updated", query: "sort=chapter_updated_at:desc" },
  { id: "recently-added", title: "Recently Added", query: "sort=created_at:desc" },
  { id: "most-viewed", title: "Most Viewed", query: "sort=views_total:desc" },
  { id: "most-followed", title: "Most Followed", query: "sort=follows_total:desc" },
  { id: "boys-love", title: "Boys' Love", query: "demographics=boys-love&sort=views_7d:desc" },
  { id: "girls-love", title: "Girls' Love", query: "demographics=girls-love&sort=views_7d:desc" },
  { id: "ongoing", title: "Ongoing", query: "status=ongoing&sort=chapter_updated_at:desc" },
  { id: "completed", title: "Completed", query: "status=completed&sort=chapter_updated_at:desc" },
] as const;

export const GENRES_SECTION_ID = "genres";
