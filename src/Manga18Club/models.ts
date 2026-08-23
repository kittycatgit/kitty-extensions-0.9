/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption, Tag } from "@paperback/types";

/**
 * Carried between pages of results, and produced by the advanced search form.
 *
 * `genre` holds a slug from {@link GENRES}. When it is set the extension
 * browses `/manga-list/<genre>` instead of `/list-manga`, because the site
 * exposes genre filtering as a path rather than a query parameter.
 */
export type Manga18SearchMetadata = {
  page?: number;
  genre?: string;
  completed?: boolean;
};

/** `id` maps to the site's `order_by` query parameter. */
export const SORTING_OPTIONS: SortingOption[] = [
  // Not a typo on our end - the site spells the parameter this way.
  { id: "lastest", label: "Latest" },
  { id: "views", label: "Most Views" },
  { id: "name", label: "A-Z" },
];

export const DEFAULT_SORT = "lastest";

/**
 * Genre slugs are taken verbatim from the site's own links; their casing is
 * inconsistent (`Ecchi` alongside `action`) and the paths are case sensitive.
 */
export const GENRES: Tag[] = [
  { id: "18", title: "18+" },
  { id: "action", title: "Action" },
  { id: "adult", title: "Adult" },
  { id: "Adventure", title: "Adventure" },
  { id: "anime", title: "Anime" },
  { id: "comedy", title: "Comedy" },
  { id: "comic", title: "Comic" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "drama", title: "Drama" },
  { id: "Ecchi", title: "Ecchi" },
  { id: "Fantasy", title: "Fantasy" },
  { id: "Gender-Bender", title: "Gender Bender" },
  { id: "Harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "Horror", title: "Horror" },
  { id: "Josei", title: "Josei" },
  { id: "live-action", title: "Live action" },
  { id: "Manhua", title: "Manhua" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Martial-art", title: "Martial Art" },
  { id: "Mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "mystery", title: "Mystery" },
  { id: "one-shot", title: "One shot" },
  { id: "psychological", title: "Psychological" },
  { id: "raw", title: "Raw" },
  { id: "romance", title: "Romance" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shojou-ai", title: "Shojou Ai" },
  { id: "Shoujo", title: "Shoujo" },
  { id: "Shounen", title: "Shounen" },
  { id: "shounen-ai", title: "Shounen Ai" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "Smut", title: "Smut" },
  { id: "Sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "Tragedy", title: "Tragedy" },
  { id: "Uncensored", title: "Uncensored" },
  { id: "Yaoi", title: "Yaoi" },
];
