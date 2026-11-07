/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

// Every page embeds its Inertia payload as <script data-page="app">.
export type H2RPage<T> = {
  component: string;
  props: T;
  url: string;
};

export type H2RRef = {
  id: number;
  name: string;
  type: string;
  url: string;
};

// A listing card, as served in home rails, browse, ranking and search.
export type H2RBook = {
  id: number;
  title: string;
  url: string;
  cover?: string | null;
  type?: string;
  typeLabel?: string;
  chapters?: number;
  pageCount?: number;
  artist?: H2RRef | null;
  rating?: number | null;
  views?: number;
  recs?: number;
  isNew?: boolean;
  isHot?: boolean;
  isPick?: boolean;
  isUpdated?: boolean;
  description?: string | null;
};

export type H2RBookDetails = {
  id: number;
  title: string;
  url: string;
  cover?: string | null;
  alt?: string | null;
  type?: { label: string; url: string } | null;
  status?: { label: string; url: string } | null;
  year?: number | null;
  badge?: string | null;
  description?: string | null;
  tags?: H2RRef[];
  groups?: { label: string; type: string; tags: H2RRef[] }[];
  isVideo?: boolean;
};

export type H2RStats = {
  views?: number;
  rating?: number | null;
  ratings?: number;
  rank?: number | null;
  updated?: string | null;
};

export type H2RChapter = {
  id: number;
  number?: string | null;
  title?: string | null;
  url: string;
  date?: string | null;
  isMembers?: boolean;
};

export type H2RPaged = {
  data: H2RBook[];
  page: number;
  lastPage: number;
  total?: number;
};

export type H2RTag = {
  id: number;
  name: string;
  count: number;
};

export type H2RHomeProps = {
  pick?: { book: H2RBook; read?: string } | null;
  top?: H2RBook[];
  latest?: H2RBook[];
};

export type H2RListingProps = { books?: H2RPaged };

export type H2RRankingProps = {
  podium?: H2RBook[];
  grid?: H2RBook[];
  pages?: { page: number; lastPage: number };
};

export type H2RBookProps = {
  book: H2RBookDetails;
  stats?: H2RStats;
  chapters?: H2RChapter[];
};

export type H2RReaderProps = {
  images?: string[];
  suffix?: string | null;
};

export type TriState = Record<string, "included" | "excluded">;

export type Option = { id: string; title: string };

export type H2RPaging = {
  page?: number;
  completed?: boolean;
};

export type H2RFilters = {
  tags?: TriState;
  type?: string;
  status?: string;
  any?: boolean;
  artist?: string;
};

export const TYPES: Option[] = [
  { id: "original", title: "Original" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "imageset", title: "Image sets" },
  { id: "video", title: "Videos" },
];

export const STATUSES: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

// "Best match" is the site's default and sends no sort parameter.
export const BEST_MATCH = "best-match";

export const SORTING_OPTIONS: SortingOption[] = [
  { id: BEST_MATCH, label: "Best match" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "latest", label: "Recently updated" },
  { id: "most-viewed", label: "Most read" },
  { id: "top-rated", label: "Highest rated" },
  { id: "alphabetical", label: "A to Z" },
  { id: "most-chapters", label: "Most chapters" },
  { id: "most-pages", label: "Most pages" },
  { id: "fewest-pages", label: "Fewest pages" },
];

// Rails backed by a paginated site listing: `path` is fetched with ?page=N.
export const LISTING_SECTIONS: { id: string; title: string; path: string }[] = [
  { id: "top_yesterday", title: "Top yesterday", path: "/ranking" },
  { id: "just_added", title: "Just added", path: "/browse" },
  { id: "new_doujinshi", title: "New doujinshi", path: "/search?type=doujinshi&sort=newest" },
  { id: "new_original", title: "New originals", path: "/search?type=original&sort=newest" },
  { id: "new_imageset", title: "New image sets", path: "/search?type=imageset&sort=newest" },
  { id: "trending", title: "Trending", path: "/browse/trending" },
  { id: "staff_picks", title: "Staff picks", path: "/browse/staff-picks" },
  { id: "last_week", title: "Top last week", path: "/browse/last-week" },
  { id: "last_month", title: "Top last month", path: "/browse/last-month" },
  { id: "top_rated", title: "Highest rated", path: "/browse/top-rated" },
];
