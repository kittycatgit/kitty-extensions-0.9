/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface LwCard {
  id: string;
  title: string;
  imageUrl: string;
  subtitle: string;
}

export interface LwReader {
  pageCount: number;
  firstPage: string;
  canRead: boolean;
  needsToUnlock: boolean;
  requiresLogin: boolean;
  insufficientCoins: boolean;
}

export type LwFilters = {
  genre?: string;
  status?: string;
  type?: string;
  sort?: string;
  mainGenre?: string;
};

export type LwMetadata = LwFilters & {
  page?: number;
};

// Both lists are the component's own option values; anything else is ignored
// server-side and the unfiltered listing comes back instead.
export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "onhold", title: "On hold" },
  { id: "droped", title: "Dropped" },
  { id: "soon", title: "Coming soon" },
];

export const TYPES = [
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "manga", title: "Manga" },
  { id: "comic", title: "Comic" },
];

export const SORTS = [
  { id: "latest", title: "Latest" },
  { id: "oldest", title: "Oldest" },
  { id: "popular", title: "Popular" },
  { id: "most_viewed", title: "Most viewed" },
  { id: "most_rated", title: "Most rated" },
];
