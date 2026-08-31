/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

// The old api.kaynscan.org host is dead: its DNS points back at Cloudflare, which
// 403s everything. The site answers on its own origin now.
export const DOMAIN = "https://kaynscans.com";
export const API = `${DOMAIN}/api`;

// The app's default UA drops the Version/ and Safari/ tokens, which is what rate
// limiters look at to spot a native client.
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const seriesPath = (slug: string): string => `/series/comic/${slug}`;
export const seriesUrl = (slug: string): string => `${DOMAIN}${seriesPath(slug)}`;

// Chapters are addressed by their number within the series, not by an id.
export const chapterUrl = (slug: string, number: string): string =>
  `${DOMAIN}${seriesPath(slug)}/chapter/${number}`;

export function assetUrl(path: string | null | undefined): string {
  const value = (path ?? "").trim();

  if (!value) {
    // An empty URL is invalid, and covers convert as an array, so one blank
    // cover fails the whole row.
    return `${DOMAIN}/favicon.ico`;
  }

  return value.startsWith("http") ? value : `${DOMAIN}${value.startsWith("/") ? "" : "/"}${value}`;
}

// The listing endpoint caps at 100 whatever you ask for.
export const LISTING_LIMIT = 100;

export const ROW_LIMIT = 24;

export const TYPES = ["MANHWA", "MANHUA", "MANGA"] as const;
export const STATUSES = ["ONGOING", "COMPLETED", "HIATUS", "DROPPED"] as const;

export const SORTS: SortingOption[] = [
  { id: "latest", label: "Latest Updates" },
  { id: "popular", label: "Popular" },
];

export const DEFAULT_SORT = "latest";

export function listingUrl(params: {
  page?: number;
  limit?: number;
  q?: string;
  type?: string;
  status?: string;
  genre?: string;
  sort?: string;
}): string {
  const parts: string[] = [];
  const add = (key: string, value: string | number | undefined): void => {
    const text = String(value ?? "").trim();

    if (text) {
      parts.push(`${key}=${encodeURIComponent(text)}`);
    }
  };

  add("page", params.page);
  add("limit", params.limit);
  add("q", params.q);
  add("type", params.type);
  add("status", params.status);
  add("genre", params.genre);
  add("sort", params.sort === DEFAULT_SORT ? "" : params.sort);

  return `${API}/series${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
}

export const HOME_SECTIONS = [
  { id: "popular", title: "Popular", sort: "popular" },
  { id: "latest", title: "Latest Updates", sort: DEFAULT_SORT },
  { id: "manhwa", title: "Manhwa", sort: "popular", type: "MANHWA" },
  { id: "manhua", title: "Manhua", sort: "popular", type: "MANHUA" },
  { id: "manga", title: "Manga", sort: "popular", type: "MANGA" },
  { id: "completed", title: "Completed", sort: "popular", status: "COMPLETED" },
] as const;

// Must stay a type alias, not an interface: only aliases get the implicit index
// signature that the app's Metadata JSON requires.
export type KaynSearchMetadata = {
  genre?: string;
  type?: string;
  status?: string;
  page?: number;
  completed?: boolean;
};

export interface KaynSeries {
  id?: string;
  slug?: string;
  urlSlug?: string;
  title?: string;
  coverImage?: string | null;
  type?: string | null;
  status?: string | null;
  rating?: number | null;
  isMature?: boolean;
  genres?: { genre?: { slug?: string; name?: string } }[];
  _count?: { chapters?: number };
}

export interface KaynListing {
  data?: KaynSeries[];
  meta?: { total?: number; page?: number; limit?: number; totalPages?: number; hasMore?: boolean };
}

export interface KaynGenre {
  id?: number | string;
  name?: string;
  slug?: string;
}

// Locked chapters need coins and a signed-in account; they still show in the list
// and are refused on open.
export interface KaynChapter {
  number?: number | string;
  title?: string | null;
  isLocked?: boolean;
  coinPrice?: number;
  publishedAt?: string | null;
  becomesFreeAt?: string | null;
}
