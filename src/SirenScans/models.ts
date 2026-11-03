/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://sirenscans.org";

// Every JSON listing endpoint pages in steps of 20 cards.
export const PAGE_SIZE = 20;

export type SirenCard = {
  slug: string;
  title: string;
  cover: string;
  type?: string;
  rating?: string;
  reviews?: string;
  synopsis?: string;
  tags: string[];
};

export type SirenUpdate = {
  slug: string;
  title: string;
  cover: string;
  chapterId: string;
  chapterName: string;
  coins?: string;
  date?: Date;
};

export type SirenSeries = {
  title: string;
  altTitles: string[];
  cover: string;
  author?: string;
  artist?: string;
  status?: string;
  type?: string;
  genres: { slug: string; name: string }[];
  synopsis: string;
  uid: string;
};

export type SirenChapterRow = {
  id: string;
  label: string;
  index: number;
  locked: boolean;
  coins?: string;
  date?: Date;
};

export type SirenHome = {
  featured: SirenCard[];
  novels: SirenCard[];
  trending: SirenCard[];
  mostReviewed: SirenCard[];
  editorsChoice: SirenCard[];
  newlyAdded: SirenCard[];
};

export type SirenSearchMetadata = {
  page?: number;
  completed?: boolean;
  tags?: string[];
  type?: string;
  status?: string;
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "default", label: "Default" },
  { id: "trending", label: "Trending" },
  { id: "popular", label: "Popular" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Top Rated" },
  { id: "az", label: "A-Z" },
  { id: "za", label: "Z-A" },
];

export const TYPES = [
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "mangatoon", title: "Mangatoon" },
  { id: "manga", title: "Manga" },
  { id: "novel", title: "Novel" },
];

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

export const SECTIONS = {
  featured: "featured",
  novels: "novels",
  trending: "trending",
  trendingWeek: "trending-weekly",
  trendingMonth: "trending-monthly",
  trendingAll: "trending-all",
  mostReviewed: "most-reviewed",
  mostReviewedAll: "most-reviewed-all",
  recentlyUpdated: "recently-updated",
  editorsChoice: "editors-choice",
  newlyAdded: "newly-added",
  popular: "popular",
  topRated: "top-rated",
  completed: "completed",
  genres: "genres",
} as const;
