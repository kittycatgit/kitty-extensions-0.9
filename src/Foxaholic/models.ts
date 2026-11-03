/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://www.foxaholic.com";

// The theme's own lazy-load placeholder, served for novels without a cover.
export const PLACEHOLDER_COVER = `${DOMAIN}/wp-content/themes/madara/images/dflazy.jpg`;

export type Option = { id: string; title: string };

export type FoxaholicMetadata = {
  genres?: string[];
  /** "1" = every selected genre must match; unset = any of them. */
  op?: string;
  statuses?: string[];
  adult?: string;
  author?: string;
  artist?: string;
  release?: string;
  page?: number;
  completed?: boolean;
};

export type FoxCard = {
  id: string;
  title: string;
  cover: string;
  /** Latest chapter label as the site prints it, e.g. "Chapter 27". */
  latest?: string;
  /** Relative or absolute date text next to the latest chapter. */
  latestDate?: string;
  genres: string[];
  summary?: string;
  status?: string;
  premium: boolean;
};

export type FoxChapterRow = {
  id: string;
  title: string;
  date?: string;
  /** Coin price for rows the site locks; undefined for free chapters. */
  coins?: number;
};

export type FoxNovel = {
  id: string;
  title: string;
  altTitles: string[];
  cover: string;
  authors: string[];
  teams: string[];
  genres: { slug: string; title: string }[];
  tags: { slug: string; title: string }[];
  type?: string;
  translation?: string;
  status?: string;
  rank?: string;
  synopsis: string;
  rows: FoxChapterRow[];
  /** Set when the page defers its chapter list to the ajax endpoint. */
  deferredChapters: boolean;
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "relevance", label: "Relevance" },
  { id: "latest", label: "Latest" },
  { id: "alphabet", label: "A–Z" },
  { id: "new-manga", label: "New" },
  { id: "trending", label: "Trending" },
  { id: "views", label: "Most Views" },
];

export const STATUSES: Option[] = [
  { id: "on-going", title: "OnGoing" },
  { id: "end", title: "Completed" },
  { id: "canceled", title: "Canceled" },
  { id: "on-hold", title: "On Hold" },
  { id: "upcoming", title: "Upcoming" },
];

export const ADULT_OPTIONS: Option[] = [
  { id: "0", title: "No adult content" },
  { id: "1", title: "Only adult content" },
];

export const GENRE_MATCH: Option[] = [
  { id: "", title: "Any selected genre" },
  { id: "1", title: "All selected genres" },
];

export type HomeRail = { id: string; title: string; key: "favorites" | "newProjects" | "latest" };

export const HOME_RAILS: HomeRail[] = [
  { id: "favorites", title: "Favorites of the Day", key: "favorites" },
  { id: "new-projects", title: "New Projects", key: "newProjects" },
  { id: "latest-releases", title: "Latest Releases", key: "latest" },
];

export type ListingRail = { id: string; title: string; sort: string; status?: string };

// The site renders no ratings, so Madara's rating sort is left out.
export const LISTING_RAILS: ListingRail[] = [
  { id: "latest-updates", title: "Latest Updates", sort: "latest" },
  { id: "new-novels", title: "New Novels", sort: "new-manga" },
  { id: "trending", title: "Trending", sort: "trending" },
  { id: "most-viewed", title: "Most Viewed", sort: "views" },
  { id: "a-z", title: "A–Z", sort: "alphabet" },
  { id: "ongoing", title: "Ongoing", sort: "latest", status: "on-going" },
  { id: "completed", title: "Completed", sort: "latest", status: "end" },
];

export const GENRES_SECTION_ID = "genres";
