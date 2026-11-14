/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://mangamikan.com";

export type MikanOption = { id: string; title: string };

export type MikanPill = { id: string; label: string; date?: Date };

export type MikanCard = {
  slug: string;
  title: string;
  cover: string;
  subtitle?: string;
  pills: MikanPill[];
};

export type MikanSpotlight = {
  slug: string;
  title: string;
  cover: string;
  meta?: string;
  summary?: string;
};

export type MikanSeries = {
  title: string;
  altTitles: string[];
  cover: string;
  status?: string;
  author?: string;
  year?: string;
  views?: string;
  genres: MikanOption[];
  synopsis: string;
};

export type MikanChapterRow = { id: string; name: string; date?: Date };

export type MikanFilters = {
  sorts: MikanOption[];
  genres: MikanOption[];
  statuses: MikanOption[];
};

export type MikanSearchMetadata = {
  page?: number;
  completed?: boolean;
  genre?: string;
  status?: string;
};

export const SECTIONS = {
  featured: "featured",
  latest: "latest",
  mostRead: "most-read",
  newest: "new",
  ongoing: "ongoing",
  completed: "completed",
  genres: "genres",
} as const;
