/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

/** Shapes returned by the Guya API that this site runs on. */

export type GuyaSeriesSummary = {
  author: string;
  artist: string;
  description: string;
  slug: string;
  cover: string;
  groups: Record<string, string>;
  last_updated: number;
};

/** `/api/get_all_series/` is keyed by display title. */
export type GuyaAllSeries = Record<string, GuyaSeriesSummary>;

export type GuyaChapter = {
  volume: string;
  title: string;
  folder: string;
  is_public: boolean;
  /** Group id to the ordered list of page file names for that group. */
  groups: Record<string, string[]>;
  release_date: Record<string, number>;
};

/** `/api/series/<slug>/`. `chapters` is keyed by chapter number. */
export type GuyaSeries = {
  slug: string;
  title: string;
  description: string;
  author: string;
  artist: string;
  cover: string;
  groups: Record<string, string>;
  preferred_sort: string[];
  chapters: Record<string, GuyaChapter>;
};

export type DankeSearchMetadata = {
  page?: number;
  category?: string;
  completed?: boolean;
};

/**
 * The site groups titles into sections in its navigation. There is no API for
 * them - `/api/get_all_series/` ignores any trailing segment and always returns
 * every title - so membership is read from each section's page.
 */
export const CATEGORIES: { id: string; title: string; path: string }[] = [
  { id: "series", title: "Series", path: "/series/" },
  { id: "oneshots", title: "Oneshots", path: "/oneshots/" },
  { id: "nsfw", title: "NSFW", path: "/nsfw/" },
];

export const PAGE_SIZE = 40;
