/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export type GuyaSeriesSummary = {
  author: string;
  artist: string;
  description: string;
  slug: string;
  cover: string;
  groups: Record<string, string>;
  last_updated: number;
};

// `/api/get_all_series/` is keyed by display title, not by slug.
export type GuyaAllSeries = Record<string, GuyaSeriesSummary>;

export type GuyaChapter = {
  volume: string;
  title: string;
  folder: string;
  is_public: boolean;
  // Group id to that group's ordered page file names.
  groups: Record<string, string[]>;
  release_date: Record<string, number>;
};

// `/api/series/<slug>/`, where `chapters` is keyed by chapter number.
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

// `/api/get_all_series/` ignores any trailing segment and always returns every
// title, so section membership has to be scraped from the section pages.
export const CATEGORIES: { id: string; title: string; path: string }[] = [
  { id: "series", title: "Series", path: "/series/" },
  { id: "oneshots", title: "Oneshots", path: "/oneshots/" },
  { id: "nsfw", title: "NSFW", path: "/nsfw/" },
];

export const PAGE_SIZE = 40;
