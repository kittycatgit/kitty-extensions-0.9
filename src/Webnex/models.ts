/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { DiscoverSectionType } from "@paperback/types";

export const DOMAIN = "https://webnex.cc";

export const seriesUrl = (mangaId: string, page = 1): string =>
  `${DOMAIN}/manga/${mangaId}${page > 1 ? `?page=${page}` : ""}`;

export const readUrl = (chapterId: string): string => `${DOMAIN}/read/${chapterId}`;

export const pagesUrl = (chapterId: string): string => `${readUrl(chapterId)}/pages`;

export const homeUrl = (query = ""): string => `${DOMAIN}/${query ? `?${query}` : ""}`;

export const browseUrl = (query = ""): string => `${DOMAIN}/browse${query ? `?${query}` : ""}`;

export const CHAPTERS_PER_PAGE = 50;

export const SEEN_LIMIT = 360;

// Next.js server action the filter panel calls for the genre and tag lists.
export const TAXONOMY_ACTION = "00e6c8a31fab7f595154855a5f303208d861493c64";

export type TriState = Record<string, "included" | "excluded">;

export type WebnexMetadata = {
  page?: number;
  completed?: boolean;
  seen?: string[];
  kinds?: string[];
  statuses?: string[];
  demographics?: string[];
  languages?: string[];
  rating?: string;
  genres?: TriState;
  tags?: TriState;
  matchAny?: boolean;
  from?: string;
  to?: string;
  chapters?: string;
  author?: string;
  artist?: string;
};

export const SORTS = [
  { id: "coverage", label: "Most sources" },
  { id: "updated", label: "Latest update" },
  { id: "year_newest", label: "Newest releases" },
  { id: "year_oldest", label: "Oldest releases" },
  { id: "title", label: "Title A-Z" },
];

export const KINDS = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
];

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "On hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const DEMOGRAPHICS = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
];

// The site hides erotica and 18+ unless the ceiling is raised explicitly.
export const RATINGS = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "18+" },
];

export const LANGUAGES = [
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "zh", title: "Chinese" },
  { id: "zh-hk", title: "Chinese (Hong Kong)" },
];

export type Row = {
  id: string;
  title: string;
  type: DiscoverSectionType;
  // Home rails are read off the home page; browse rails page through /browse.
  source: { kind: "home"; heading: string } | { kind: "browse"; query: string };
};

const year = new Date().getFullYear();

export const ROWS: Row[] = [
  {
    id: "popular",
    title: "Popular this week",
    type: DiscoverSectionType.featured,
    source: { kind: "home", heading: "popular-heading" },
  },
  {
    id: "latest",
    title: "Latest updates",
    type: DiscoverSectionType.chapterUpdates,
    source: { kind: "home", heading: "latest-heading" },
  },
  {
    id: "favourites",
    title: "Readers' favourites",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "home", heading: "taste-heading" },
  },
  {
    id: "sources",
    title: "On the most sources",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "browse", query: "" },
  },
  {
    id: "new",
    title: `New in ${year}`,
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "browse", query: `from=${year}` },
  },
  {
    id: "manhwa",
    title: "Manhwa",
    type: DiscoverSectionType.prominentCarousel,
    source: { kind: "browse", query: "kind=manhwa" },
  },
  {
    id: "manga",
    title: "Manga",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "browse", query: "kind=manga" },
  },
  {
    id: "manhua",
    title: "Manhua",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "browse", query: "kind=manhua" },
  },
  {
    id: "newest",
    title: "Newest releases",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "browse", query: "sort=year_newest" },
  },
  {
    id: "completed",
    title: "Completed",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "browse", query: "status=completed" },
  },
  {
    id: "genres",
    title: "Genres",
    type: DiscoverSectionType.genres,
    source: { kind: "home", heading: "genres-heading" },
  },
];
