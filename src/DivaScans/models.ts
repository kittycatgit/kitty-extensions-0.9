/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type DivaRef = { name: string; slug: string };

export type DivaVocab = { genres: DivaRef[]; tags: DivaRef[] };

export type DivaChapter = {
  number: number;
  title?: string;
  is_free?: boolean;
  is_premium?: boolean;
  url?: string;
  published_at?: string;
  early_access_until?: string | null;
};

export type DivaSeries = {
  id?: string;
  slug: string;
  title: string;
  original_title?: string | null;
  alternative_titles?: string[];
  type?: string;
  status?: string;
  origin?: string;
  description?: string | null;
  cover_image?: string | null;
  author?: string | null;
  artist?: string | null;
  rating?: number;
  rating_count?: number;
  views?: number;
  bookmarks?: number;
  chapter_count?: number;
  free_chapter_count?: number;
  paid_chapter_count?: number;
  early_access_chapter_count?: number;
  genres?: string[];
  genre_slugs?: string[];
  tags?: string[];
  tag_slugs?: string[];
  is_nsfw?: boolean;
  url?: string;
  updated_at?: string;
  created_at?: string;
  last_chapter_at?: string;
  latest_chapter?: DivaChapter | null;
  chapters?: DivaChapter[];
  team?: { name?: string; slug?: string } | null;
};

export type DivaPagination = { page?: number; total_pages?: number; has_more?: boolean };

export type DivaListing = { data?: DivaSeries[]; pagination?: DivaPagination };

export type DivaSearch = { results?: DivaSeries[]; total?: number };

export type DivaMetadata = {
  page?: number;
  completed?: boolean;
  type?: string;
  status?: string;
  origin?: string;
  nsfw?: string;
  genre?: string;
  exgenre?: string;
  tag?: string;
  extag?: string;
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "popular", label: "Popular" },
  { id: "latest", label: "Latest Updates" },
  { id: "trending", label: "Trending" },
  { id: "rating", label: "Top Rated" },
  { id: "bookmarked", label: "Most Bookmarked" },
  { id: "newest", label: "Newest" },
  { id: "longest", label: "Longest" },
  { id: "alphabetical", label: "A-Z" },
];

export const DEFAULT_SORT = "popular";

export const TYPES: DivaRef[] = [
  { name: "Comic", slug: "comic" },
  { name: "Novel", slug: "novel" },
];

export const STATUSES: DivaRef[] = [
  { name: "Ongoing", slug: "ONGOING" },
  { name: "Completed", slug: "COMPLETED" },
  { name: "Hiatus", slug: "HIATUS" },
  { name: "Dropped", slug: "DROPPED" },
  { name: "Discontinued", slug: "DISCONTINUED" },
  { name: "Upcoming", slug: "UPCOMING" },
];

export const ORIGINS: DivaRef[] = [
  { name: "Korean", slug: "korean" },
  { name: "Japanese", slug: "japanese" },
  { name: "Chinese", slug: "chinese" },
  { name: "Other", slug: "other" },
];

export const NSFW_MODES: DivaRef[] = [
  { name: "Include", slug: "include" },
  { name: "Exclude", slug: "exclude" },
  { name: "Only", slug: "only" },
];

// Every home rail is one sort of the same listing endpoint.
export const HOME_SECTIONS: { id: string; title: string; query: string }[] = [
  { id: "hero", title: "Popular Today", query: "sort=popular" },
  { id: "newest", title: "New Series", query: "sort=newest" },
  { id: "latestComic", title: "Latest Comic Updates", query: "sort=latest&type=comic" },
  { id: "latestNovel", title: "Latest Novel Updates", query: "sort=latest&type=novel" },
  { id: "topRated", title: "Top Rated", query: "sort=rating" },
  { id: "trending", title: "Trending", query: "sort=trending" },
  { id: "bookmarked", title: "Most Bookmarked", query: "sort=bookmarked" },
  { id: "longest", title: "Longest", query: "sort=longest" },
];
