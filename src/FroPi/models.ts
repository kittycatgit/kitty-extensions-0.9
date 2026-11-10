/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface ApiSeries {
  id: string;
  slug: string;
  title: string;
  altTitles?: string[];
  type?: string;
  status?: string;
  cover?: { url?: string };
  genres?: string[];
  tags?: string[];
  authors?: string[];
  artists?: string[];
  rating?: number;
  views?: number;
  chapterCount?: number;
  year?: number;
  ageRating?: string;
  description?: string;
}

export interface ApiChapter {
  id: string;
  number: number;
  season?: number;
  title: string | null;
  translator?: string | null;
  pageCount?: number;
  access?: string;
  publishedAt?: string;
}

export interface ApiList<T> {
  items: T[];
  nextCursor?: string | null;
}

export type FroPiFilters = {
  genre?: string;
  status?: string;
  type?: string;
  sort?: string;
};

export type FroPiMetadata = FroPiFilters & {
  cursor?: string;
};

// The API rejects anything above fifty and pages with an opaque cursor.
export const LIMIT = 50;

export const SORTS = [
  { id: "updated", title: "Latest Update" },
  { id: "latest", title: "Newest" },
  { id: "popularity", title: "Popularity" },
  { id: "views", title: "Most Viewed" },
  { id: "rating", title: "Top Rated" },
  { id: "chapters", title: "Most Chapters" },
];

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const TYPES = [
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "manga", title: "Manga" },
];
