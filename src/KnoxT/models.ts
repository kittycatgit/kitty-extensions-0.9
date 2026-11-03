/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://knoxt.space";

// The site's own logo; an empty imageUrl would fail the whole rail.
export const PLACEHOLDER_COVER = `${DOMAIN}/wp-content/uploads/2021/06/cropped-lion4-192x192.png`;

export type Option = { id: string; title: string };

export type Vocab = { genres: Option[]; types: Option[] };

export type KnoxTMetadata = {
  genres?: string[];
  types?: string[];
  status?: string;
  page?: number;
  completed?: boolean;
};

export type Card = {
  id: string;
  title: string;
  cover: string;
  subtitle?: string;
  summary?: string;
};

export type ChapterRow = {
  id: string;
  number: number;
  label: string;
  title: string;
  date?: Date;
};

export type Series = {
  title: string;
  altTitles: string[];
  cover: string;
  status?: string;
  types: string[];
  authors: string[];
  artists: string[];
  released?: string;
  language?: string;
  followers?: string;
  genres: Option[];
  tags: Option[];
  synopsis: string;
  mature: boolean;
  chapters: ChapterRow[];
};

export const STATUSES: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "hiatus", title: "Hiatus" },
  { id: "completed", title: "Completed" },
];

export const DEFAULT_SORT = "update";

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "update", label: "Latest update" },
  { id: "latest", label: "Latest added" },
  { id: "popular", label: "Popular" },
  { id: "rating", label: "Rating" },
  { id: "title", label: "Title A-Z" },
  { id: "titlereverse", label: "Title Z-A" },
];

export const POPULAR_RANGES = ["weekly", "monthly", "alltime"] as const;
export type PopularRange = (typeof POPULAR_RANGES)[number];

export const HOME_SECTIONS = {
  editorsChoice: "editors-choice",
  trending: "trending",
  recommendation: "recommendation",
  popularWeekly: "popular-weekly",
  popularMonthly: "popular-monthly",
  popularAlltime: "popular-alltime",
} as const;

// Listing-backed rails: `/series/?<query>&page=N`, 20 cards a page.
export const LISTING_SECTIONS: { id: string; title: string; query: string }[] = [
  { id: "latest", title: "Latest Release", query: "order=update" },
  { id: "ongoing", title: "Ongoing", query: "status=ongoing&order=update" },
  { id: "completed", title: "Completed", query: "status=completed&order=update" },
  { id: "hiatus", title: "On Hiatus", query: "status=hiatus&order=update" },
];

export const GENRES_SECTION_ID = "genres";
