/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number; total_pages: number };
}

export interface ApiComic {
  id: string;
  title: string;
  slug: string;
  alternative_titles?: string;
  cover_image?: string;
  synopsis?: string;
  author?: string;
  artist?: string;
  publisher?: string;
  release_year?: string | number;
  status?: string;
  type?: string;
  rating?: number | string;
  total_views?: number;
  genres?: ApiGenre[];
  chapters?: ApiChapter[];
}

export interface ApiGenre {
  id?: string;
  name: string;
  slug?: string;
}

export interface ApiChapter {
  id: string;
  title: string;
  chapter_number: number;
  slug: string;
  created_at?: string;
  lang?: string;
}

export interface ApiChapterDetail extends ApiChapter {
  pages?: { id: number; image_url: string }[];
}

export type ManhwaHFilters = {
  genre?: string;
  status?: string;
  sort?: string;
};

export type ManhwaHMetadata = ManhwaHFilters & {
  page?: number;
};

export const LIMIT = 24;

// hot, views and popular return the same order, as do latest, updated and
// trending, so only one of each is offered.
export const SORTS = [
  { id: "latest", title: "Latest Update" },
  { id: "hot", title: "Popular" },
  { id: "rating", title: "Top Rated" },
  { id: "new", title: "New Series" },
];

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "dropped", title: "Dropped" },
];
