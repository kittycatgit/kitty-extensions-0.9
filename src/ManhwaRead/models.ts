/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type ManhwaReadSearchMetadata = {
  page?: number;
  sort?: string;
  completed?: boolean;
};

/**
 * `sortby` values confirmed to return distinct listings. The endpoint silently
 * falls back to its default for anything it does not recognise, so only values
 * verified against the live site are offered here.
 */
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "release", label: "Latest Release" },
  { id: "new", label: "New Manhwa" },
  { id: "weekly_top", label: "Popular this Week" },
  { id: "daily_top", label: "Popular Today" },
];

export const DEFAULT_SORT = "release";

/** The three rails the site's own home page shows, with the sort each maps to. */
export const HOME_SECTIONS: { id: string; title: string; sort: string }[] = [
  { id: "weekly_top", title: "Popular this Week", sort: "weekly_top" },
  { id: "new", title: "New Manhwa", sort: "new" },
  { id: "release", title: "Latest Release", sort: "release" },
];

/** Status is published as a `data-status` attribute. */
export const STATUS_LABELS: Record<string, string> = {
  ongoing: "Ongoing",
  incomplete: "Ongoing",
  completed: "Completed",
  canceled: "Cancelled",
  cancelled: "Cancelled",
  "on-hold": "Hiatus",
  hiatus: "Hiatus",
};
