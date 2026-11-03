/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://baetoon.com";

// A real image on the site, so a title without a cover still renders its row.
export const PLACEHOLDER_COVER = `${DOMAIN}/apple-touch-icon.png`;

export const PAGE_SIZE = 60;

export type BaeItem = {
  id: string;
  slug: string;
  title: string;
  cover?: string;
  coverNormal?: string;
  fallback?: string;
  latestChapter?: string;
  latestChapterNum?: number;
  latestChapterUrl?: string;
  tags?: string[];
  author?: string;
  synopsis?: string;
  status?: string;
  views?: number;
  viewsFormatted?: string;
  rating?: number;
  updatedAt?: string;
};

export type BaeHotItem = {
  id: string;
  title: string;
  cover?: string;
  latestChapter?: string;
  views?: number;
  viewsFormatted?: string;
  tags?: string[];
};

export type BaeGenre = { name: string; slug: string; count?: number };

export type BaeHome = {
  spotlight?: BaeItem[];
  hotToday?: BaeItem[];
  latestUpdates?: BaeItem[];
  recentAdded?: BaeItem[];
  sidebarHot?: { weekly?: BaeHotItem[]; monthly?: BaeHotItem[]; allTime?: BaeHotItem[] };
  popularGenres?: BaeGenre[];
};

export type BaeChapterSource = {
  id: string;
  title?: string;
  datetime?: string;
  pagesCount?: number;
  sourceName?: string;
};

export type BaeChapter = BaeChapterSource & {
  number: string;
  sources?: BaeChapterSource[];
};

export type BaeTitle = {
  id: string;
  slug: string;
  title: string;
  alternativeNames?: string[];
  coverNormal?: string;
  coverSmall?: string;
  fallback?: string;
  author?: string;
  artist?: string;
  tags?: string[];
  keywords?: string[];
  type?: string;
  status?: string;
  released?: string;
  officialTranslation?: boolean;
  animeAdaptation?: boolean;
  adultContent?: boolean;
  subscriptions?: number;
  views?: number;
  rating?: number;
  description?: string;
  chapters?: BaeChapter[];
};

export type BaeChapterPage = { id: string; number?: string; pages?: string[] };

export type BaeEnvelope<T> = {
  status?: string;
  code?: number;
  data?: T;
  pagination?: { total?: number; page?: number; totalPages?: number; limit?: number };
};

export type BaeSearchMetadata = {
  page?: number;
  completed?: boolean;
  genre?: string;
};

export const SORTS: SortingOption[] = [
  { id: "recent-add", label: "Recently added" },
  { id: "lastest-updates", label: "Latest updates" },
  { id: "most-view", label: "Most viewed" },
  { id: "top-rates", label: "Top rated" },
  { id: "a-z", label: "A to Z" },
];

export const SECTION = {
  spotlight: "spotlight",
  hotToday: "hot-today",
  latest: "latest-updates",
  hotWeekly: "hot-weekly",
  hotMonthly: "hot-monthly",
  hotAllTime: "hot-all-time",
  popularGenres: "popular-genres",
  recentAdded: "recent-added",
  mostViewed: "most-viewed",
  topRated: "top-rated",
  genres: "genres",
} as const;

// Rails backed by a search sort page endlessly through the catalogue.
export const SORTED_SECTIONS: Record<string, string> = {
  [SECTION.recentAdded]: "recent-add",
  [SECTION.mostViewed]: "most-view",
  [SECTION.topRated]: "top-rates",
};

// Tag ids cannot hold spaces or quotes, so genre names become slugs and the
// cached vocabulary maps them back to the exact name the API filters on.
export function genreId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function withCommas(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
