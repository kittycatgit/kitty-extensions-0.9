/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface ApiCard {
  id: string;
  slug: string;
  urlSlug?: string;
  title: string;
  coverImage: string | null;
  type?: string;
  status?: string;
  rating?: number;
  isMature?: boolean;
  genres?: { genre?: { slug?: string } }[];
}

export interface ApiSeries {
  id: string;
  slug: string;
  urlSlug?: string;
  title: string;
  altTitle?: string;
  originalTitle?: string;
  aliases?: string[];
  description?: string;
  coverImage?: string | null;
  type?: string;
  status?: string;
  rating?: number;
  nsfw?: boolean;
  genres?: ({ genre?: { name?: string; slug?: string } } | { name?: string; slug?: string })[];
}

export interface ApiChapter {
  id: string;
  number: number;
  title: string | null;
  isLocked?: boolean;
  coinPrice?: number;
  publishedAt?: string;
  contentFormat?: string;
  hasAccess?: boolean;
}

export interface ApiPage {
  id: string;
  pageNumber: number;
  kind?: string;
  imageUrl: string;
  isEncrypted?: boolean;
  hasFragments?: boolean;
  hasStrips?: boolean;
}

export type KeroFilters = {
  genre?: string[];
  type?: string;
  status?: string;
  sort?: string;
};

export type KeroMetadata = KeroFilters & {
  page?: number;
};

export const SORTS = [
  { id: "latest", title: "Latest Update" },
  { id: "popular", title: "Popular" },
  { id: "newest", title: "Newest" },
];

export const TYPES = ["MANHWA", "MANHUA", "MANGA", "WEBTOON", "COMIC"];
export const STATUSES = ["ONGOING", "COMPLETED", "HIATUS", "DROPPED"];
