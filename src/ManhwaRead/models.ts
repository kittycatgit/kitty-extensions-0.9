/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type ManhwaReadSearchMetadata = {
  page?: number;
  sort?: string;
  completed?: boolean;
};

/** Values the site accepts for its `sortby` query parameter. */
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "release", label: "Latest" },
  { id: "daily_top", label: "Popular Today" },
  { id: "weekly_top", label: "Popular This Week" },
  { id: "monthly_top", label: "Popular This Month" },
  { id: "all_top", label: "Most Popular" },
];

export const DEFAULT_SORT = "release";

/** One rail per sort mode the site exposes. */
export const HOME_SECTIONS: { id: string; title: string; sort: string }[] = [
  { id: "daily_top", title: "Popular Today", sort: "daily_top" },
  { id: "weekly_top", title: "Popular This Week", sort: "weekly_top" },
  { id: "monthly_top", title: "Popular This Month", sort: "monthly_top" },
  { id: "all_top", title: "Most Popular", sort: "all_top" },
  { id: "release", title: "Latest Updates", sort: "release" },
];

/** The site publishes status as a `data-status` attribute. */
export const STATUS_LABELS: Record<string, string> = {
  ongoing: "Ongoing",
  incomplete: "Ongoing",
  completed: "Completed",
  canceled: "Cancelled",
  cancelled: "Cancelled",
  "on-hold": "Hiatus",
};
