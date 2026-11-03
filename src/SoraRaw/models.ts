/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type YesNo = "yes" | "no";

export type SoraGenreRef = { id: number; name: string; slug: string };

export type SoraGenre = SoraGenreRef & { total: number; is_adult: YesNo };

export type SoraPagination = {
  total: number;
  current_page: number;
  per_page: number;
  total_page: number;
};

/** Listing row shared by the home, newest, ongoing, completed, genre and top payloads. */
export type SoraItem = {
  id: number;
  name: string;
  slug: string;
  author?: string | null;
  image?: string;
  views?: number;
  rate?: string | number;
  number_rate?: number;
  number_bookmark?: number;
  type?: "incomplete" | "complete";
  mode?: string;
  updated_at?: string;
  published_at?: string;
  c_name?: number | null;
  c_title?: string | null;
  c_slug?: string;
  c_published_at?: string;
  is_adult?: YesNo;
  dcma?: YesNo;
  genres?: SoraGenreRef[];
};

/** Row of the static `/mangas_N.json` search index. */
export type SoraIndexEntry = {
  id: number;
  name: string;
  alt_names?: string | null;
  slug: string;
  author?: string | null;
  img?: string;
  views?: number;
  number_bookmark?: number;
  mode?: string;
  type?: "incomplete" | "complete";
  genres?: number[];
  c_name?: number | null;
  c_title?: string | null;
  c_published?: string;
  is_adult?: YesNo;
  dcma?: YesNo;
};

export type SoraChapterRow = {
  id: number;
  name: number | null;
  title: string | null;
  order: number | string;
  mode?: string;
  path: string;
  published_at?: string;
};

export type SoraManga = SoraItem & {
  description?: string | null;
  content?: string | null;
  is_bl?: YesNo;
  is_doujin?: YesNo;
  names?: { id: number; name: string }[];
  chapters?: SoraChapterRow[];
};

export type SoraChapterPage = {
  chapter: {
    id: number;
    manga_id: number;
    uuid: string;
    mode?: string;
    updated_at?: string;
    schedule_open_at?: string | null;
    _b?: string | null;
    _d?: string | null;
    _t?: string | null;
    _p?: string | null;
  };
};

export type SoraListingProps = {
  data: {
    hot?: SoraItem[];
    results?: SoraItem[];
    pagination?: SoraPagination;
    genres?: (SoraGenreRef & { manga: SoraItem[] })[];
  };
  initialTrending?: { mangas?: SoraItem[]; manga18s?: SoraItem[] };
};

export type SoraTop = { mangas?: SoraItem[]; manga18s?: SoraItem[] };

export type TriState = Record<string, "included" | "excluded">;

export type SoraSearchMetadata = {
  page?: number;
  completed?: boolean;
  genres?: TriState;
  status?: "ongoing" | "complete";
  content?: "general" | "adult";
  mode?: "vertical" | "horizontal";
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "updated", label: "Latest update" },
  { id: "views", label: "Most viewed" },
  { id: "bookmark", label: "Most bookmarked" },
];

export const DEFAULT_SORT = "updated";

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "complete", title: "Completed" },
];

export const CONTENTS = [
  { id: "general", title: "General" },
  { id: "adult", title: "Adult" },
];

export const MODES = [
  { id: "horizontal", title: "Manga (horizontal)" },
  { id: "vertical", title: "Webtoon (vertical)" },
];

export const TOP_SECTIONS = [
  { id: "top-week", title: "Trending This Week", file: "last7Days", key: "mangas" as const },
  { id: "top-month", title: "Trending This Month", file: "last30Days", key: "mangas" as const },
  { id: "top-rising", title: "Rising", file: "rising", key: "mangas" as const },
  { id: "top-lifetime", title: "All-Time Favorites", file: "lifetime", key: "mangas" as const },
  {
    id: "top-week-adult",
    title: "Trending This Week (18+)",
    file: "last7Days",
    key: "manga18s" as const,
  },
];

export const LISTING_SECTIONS = [
  { id: "latest", title: "Latest Updates", path: "newest" },
  { id: "ongoing", title: "Ongoing", path: "on-going" },
  { id: "completed", title: "Completed", path: "complete" },
];
