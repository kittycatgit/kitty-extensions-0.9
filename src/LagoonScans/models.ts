/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://lagoonscans.com";

// A real URL on the site that serves no image, so the app draws its placeholder.
export const FALLBACK_COVER = `${DOMAIN}/wp-content/uploads/no-cover.png`;

export const seriesUrl = (slug: string): string => `${DOMAIN}/manga/${slug}/`;

export const chapterUrl = (chapterSlug: string): string => `${DOMAIN}/${chapterSlug}/`;

export interface LagoonCard {
  slug: string;
  title: string;
  cover: string;
  type?: string;
  latestChapter?: string;
  rating?: string;
  status?: string;
  // Only Latest Update rows carry these.
  latestChapterSlug?: string;
  latestChapterAge?: string;
}

export interface LagoonGenre {
  id: string;
  name: string;
}

export interface LagoonRecommendationTab {
  termId: string;
  name: string;
  cards: LagoonCard[];
}

export interface LagoonHome {
  popular: LagoonCard[];
  latest: LagoonCard[];
  recommendations: LagoonRecommendationTab[];
}

export type LagoonSearchMetadata = {
  page?: number;
  completed?: boolean;
  genres?: string[];
  status?: string;
  type?: string;
};

// The site's unsorted listing is already A-Z, so there is no separate default.
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "update", label: "Latest update" },
  { id: "latest", label: "Recently added" },
  { id: "popular", label: "Popular" },
  { id: "title", label: "Title A-Z" },
  { id: "titlereverse", label: "Title Z-A" },
];

export const STATUSES: { id: string; title: string }[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

export const TYPES: { id: string; title: string }[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "comic", title: "Comic" },
  { id: "novel", title: "Novel" },
];

export const POPULAR_SECTION_ID = "popular-today";
export const LATEST_SECTION_ID = "latest-update";
export const RECOMMENDATION_PREFIX = "recommend-";
export const GENRES_SECTION_ID = "genres";

// Rails backed by the /manga/ listing. No Ongoing or Manhwa rail: every series
// is ongoing and nearly all are manhwa, so both would repeat Latest Update.
export const LISTING_SECTIONS: {
  id: string;
  title: string;
  order: string;
  type?: string;
}[] = [
  { id: "most-popular", title: "Most Popular", order: "popular" },
  { id: "new-series", title: "New Series", order: "latest" },
  { id: "manga", title: "Manga", order: "update", type: "manga" },
  { id: "manhua", title: "Manhua", order: "update", type: "manhua" },
];
