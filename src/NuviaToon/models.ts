/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export type Kind = "comic" | "novel";

export interface ApiGenre {
  slug: string;
  name: string;
}

export interface ApiChapter {
  id: string;
  number: number;
  title: string | null;
  priceCoins?: number;
  publishedAt?: string;
}

export interface ApiSeries {
  id: string;
  kind: Kind;
  slug: string;
  title: string;
  type?: string;
  seriesStatus?: string;
  coverUrl?: string;
  coverThumbUrl?: string;
  ratingAvg?: number;
  viewCount?: number;
  chapterCount?: number;
  releaseYear?: number | null;
  author?: string | null;
  artist?: string | null;
  altTitles?: string[];
  description?: string;
  genres?: ApiGenre[];
  chapters?: ApiChapter[];
}

export interface ApiPage {
  index: number;
  url: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
}

export type NuviaFilters = {
  genre?: string;
  status?: string;
  kind?: Kind;
  sort?: string;
};

export type NuviaMetadata = NuviaFilters & {
  page?: number;
};

// Status is an enum and rejects anything but these, uppercase.
export const STATUSES = [
  { id: "ONGOING", title: "Ongoing" },
  { id: "COMPLETED", title: "Completed" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "CANCELLED", title: "Cancelled" },
];

export const SORTS = [
  { id: "latest", title: "Latest Update" },
  { id: "popular", title: "Popular" },
  { id: "rating", title: "Top Rated" },
  { id: "newest", title: "Newest" },
  { id: "alphabetical", title: "A to Z" },
];

export const KINDS = [
  { id: "comic", title: "Comics" },
  { id: "novel", title: "Novels" },
];

// Both halves of the site share one id space, so the kind travels with the id.
export function packId(kind: Kind, slug: string): string {
  return `${kind}:${slug}`;
}

export function unpackId(mangaId: string): { kind: Kind; slug: string } {
  const separator = mangaId.indexOf(":");

  if (separator === -1) {
    return { kind: "comic", slug: mangaId };
  }

  const kind = mangaId.slice(0, separator);

  return { kind: kind === "novel" ? "novel" : "comic", slug: mangaId.slice(separator + 1) };
}
