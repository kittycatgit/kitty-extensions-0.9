/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

/**
 * Where the site lives now.
 *
 * It moved from kaynscan.org, and the old API host it used to answer from -
 * api.kaynscan.org - is not merely gone but misconfigured: its DNS record is
 * proxied and points back at Cloudflare's own addresses, so Cloudflare refuses
 * to proxy to itself and answers every request with a 403 error page. Nothing
 * sent from here could have changed that. The new site answers on its own
 * origin.
 */
export const DOMAIN = "https://kaynscans.com";
export const API = `${DOMAIN}/api`;

/**
 * A complete Safari string.
 *
 * The app's own default omits the `Version/` and `Safari/` tokens a real Safari
 * always sends, which is the signature rate limiters use to tell a native client
 * from a browser.
 */
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** A series' own page, which is where its chapters and description live. */
export const seriesPath = (slug: string): string => `/series/comic/${slug}`;
export const seriesUrl = (slug: string): string => `${DOMAIN}${seriesPath(slug)}`;

/** A chapter is addressed by its number within the series, not by an id. */
export const chapterUrl = (slug: string, number: string): string =>
  `${DOMAIN}${seriesPath(slug)}/chapter/${number}`;

/** Artwork and pages are served from the site's own origin, as bare paths. */
export function assetUrl(path: string | null | undefined): string {
  const value = (path ?? "").trim();

  if (!value) {
    // An empty string is rejected as an invalid URL and, because covers are
    // converted as an array, one blank cover fails a whole row.
    return `${DOMAIN}/favicon.ico`;
  }

  return value.startsWith("http") ? value : `${DOMAIN}${value.startsWith("/") ? "" : "/"}${value}`;
}

/** The most the listing endpoint will return at once, whatever is asked for. */
export const LISTING_LIMIT = 100;

/** How much of a row to fetch at a time. */
export const ROW_LIMIT = 24;

/** What the listing endpoint genuinely narrows on - each checked against the API. */
export const TYPES = ["MANHWA", "MANHUA", "MANGA"] as const;
export const STATUSES = ["ONGOING", "COMPLETED", "HIATUS", "DROPPED"] as const;

export const SORTS: SortingOption[] = [
  { id: "latest", label: "Latest Updates" },
  { id: "popular", label: "Popular" },
];

export const DEFAULT_SORT = "latest";

/** One page of the catalogue, however it has been narrowed. */
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

/** The rows the home page offers, each a differently narrowed catalogue. */
export const HOME_SECTIONS = [
  { id: "popular", title: "Popular", sort: "popular" },
  { id: "latest", title: "Latest Updates", sort: DEFAULT_SORT },
  { id: "manhwa", title: "Manhwa", sort: "popular", type: "MANHWA" },
  { id: "manhua", title: "Manhua", sort: "popular", type: "MANHUA" },
  { id: "manga", title: "Manga", sort: "popular", type: "MANGA" },
  { id: "completed", title: "Completed", sort: "popular", status: "COMPLETED" },
] as const;

/**
 * What an advanced search carries between the form and the query.
 *
 * A `type` alias rather than an interface: the app passes this as arbitrary
 * JSON, and only a type alias gets the implicit index signature that satisfies.
 */
export type KaynSearchMetadata = {
  genre?: string;
  type?: string;
  status?: string;
  page?: number;
  completed?: boolean;
};

/** A series as the listing endpoint describes it. */
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

/** One page of series, with the paging the API reports for it. */
export interface KaynListing {
  data?: KaynSeries[];
  meta?: { total?: number; page?: number; limit?: number; totalPages?: number; hasMore?: boolean };
}

/** A genre, as the site names it. */
export interface KaynGenre {
  id?: number | string;
  name?: string;
  slug?: string;
}

/**
 * A chapter, as the series page carries it.
 *
 * The site now sells chapters: `isLocked` marks one that has to be paid for
 * with the site's coins, and those cannot be read by anyone not signed in and
 * out of pocket. They are listed rather than hidden - a reader looking for
 * chapter 40 should see that it exists - and refused clearly when opened.
 */
export interface KaynChapter {
  number?: number | string;
  title?: string | null;
  isLocked?: boolean;
  coinPrice?: number;
  publishedAt?: string | null;
  /** When a paid chapter stops being paid. Absent on ones with no date set. */
  becomesFreeAt?: string | null;
}
