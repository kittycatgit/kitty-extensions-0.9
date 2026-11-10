/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface ListItem {
  id: number;
  slug: string;
  title: string;
  coverKey?: string | null;
  coverOriginal?: string | null;
  status?: string;
  isMtl?: boolean;
  chapterCount?: number;
  latestChapterTitle?: string;
  ratingAvg?: number | null;
  authorName?: string | null;
}

export interface Listing {
  items: ListItem[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface Novel {
  id: number;
  slug: string;
  title: string;
  altTitles?: string[];
  description?: string;
  status?: string;
  isMtl?: boolean;
  isAdult?: boolean;
  originalLanguage?: string | null;
  coverKey?: string | null;
  sourceChapterCount?: number;
}

export interface TocItem {
  number: number;
  title: string;
  createdAt?: string;
}

export interface Toc {
  items: TocItem[];
  range?: { page: number; from: number; to: number };
  ranges?: { page: number; from: number; to: number }[];
  order?: string;
}

export type ReadNovelFilters = {
  genre?: string;
  status?: string;
  sort?: string;
};

export type ReadNovelMetadata = ReadNovelFilters & {
  page?: number;
};

// Covers live on one CDN shared by every domain this app serves. Some novels
// have none at all — the site draws a gradient in their place — and an empty
// url would blank the whole row, so those fall back to the site's own icon.
export const CDN = "https://cdn.wuxiaworld.eu";
export const PLACEHOLDER = "https://readnovel.eu/apple-touch-icon.png";

export function coverUrl(key?: string | null, original?: string | null): string {
  if (key) {
    return `${CDN}/${key}-240.webp`;
  }

  return original ? `${CDN}/${original}` : PLACEHOLDER;
}

export const SORTS = [
  { id: "popular", title: "Popular" },
  { id: "views", title: "Most Viewed" },
  { id: "latest", title: "Latest Update" },
  { id: "new", title: "Newest" },
  { id: "rating", title: "Top Rated" },
  { id: "chapters", title: "Most Chapters" },
];

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];
