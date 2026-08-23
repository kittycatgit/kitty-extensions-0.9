/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SortingOption } from "@paperback/types";

export type MadaraSearchMetadata = {
  genres?: Record<string, "included" | "excluded">;
};

// `id` maps to Madara's `m_orderby` value; "relevance" is the default (no param).
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "relevance", label: "Relevance" },
  { id: "latest", label: "Latest" },
  { id: "alphabet", label: "A-Z" },
  { id: "rating", label: "Rating" },
  { id: "trending", label: "Trending" },
  { id: "views", label: "Views" },
  { id: "new-manga", label: "New" },
];
