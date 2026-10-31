/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { DiscoverSectionType } from "@paperback/types";

export const DOMAIN = "https://silentquill.net";

export const seriesUrl = (slug: string): string => `${DOMAIN}/series/${slug}/`;

// Chapters resolve from the site root by their own slug.
export const chapterUrl = (slug: string): string => `${DOMAIN}/${slug}/`;

export const homeUrl = (page: number): string =>
  page > 1 ? `${DOMAIN}/?page=${page}` : `${DOMAIN}/`;

export const searchUrl = (query: Record<string, string>): string => {
  const parts = Object.entries(query)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);

  return `${DOMAIN}/search/${parts.length ? `?${parts.join("&")}` : ""}`;
};

export type SilentQuillMetadata = {
  page?: number;
  completed?: boolean;
  seen?: string[];
  genre?: string;
  status?: string;
};

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

export type Row = {
  id: string;
  title: string;
  type: DiscoverSectionType;
  source: "featured" | "latest" | "top" | "genres" | "search";
  query?: Record<string, string>;
};

// One rail per block of the home page, plus the two status listings.
export const ROWS: Row[] = [
  { id: "featured", title: "Featured", type: DiscoverSectionType.featured, source: "featured" },
  {
    id: "latest",
    title: "Latest releases",
    type: DiscoverSectionType.chapterUpdates,
    source: "latest",
  },
  {
    id: "top",
    title: "Top 10 this week",
    type: DiscoverSectionType.prominentCarousel,
    source: "top",
  },
  {
    id: "ongoing",
    title: "Ongoing",
    type: DiscoverSectionType.simpleCarousel,
    source: "search",
    query: { status: "ongoing" },
  },
  {
    id: "completed",
    title: "Completed",
    type: DiscoverSectionType.simpleCarousel,
    source: "search",
    query: { status: "completed" },
  },
  { id: "genres", title: "Genres", type: DiscoverSectionType.genres, source: "genres" },
];

export const SEEN_LIMIT = 360;
