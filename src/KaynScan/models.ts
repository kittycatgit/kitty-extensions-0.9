/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://kaynscan.org";

/** The site reads everything through its own API on a sibling host. */
export const API = "https://api.kaynscan.org/api";

/**
 * The user agent every request presents.
 *
 * A complete, ordinary Safari string: the app's own default omits the
 * `Version/` and `Safari/` tokens a real Safari always sends, which is the
 * signature bot filters look for when telling a native client from a browser.
 */
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * Stand-in for a series listed without artwork.
 *
 * An empty address is rejected outright, and a row's items are converted
 * together, so one blank cover takes its whole row down. This is a real address
 * holding no image, so the app draws its own placeholder instead.
 */
export const FALLBACK_COVER = `${DOMAIN}/_no-cover.png`;

/** What a listing or search answers with. */
export type ApiListing = {
  posts?: ApiSeries[];
  totalCount?: number;
};

export type ApiSeries = {
  id?: string | number;
  slug?: string;
  postTitle?: string;
  postContent?: string;
  featuredImage?: string | null;
  seriesType?: string | null;
  seriesStatus?: string | null;
  hot?: boolean;
  isPinned?: boolean;
  averageRating?: number | null;
  genres?: ({ id?: number; name?: string } | string)[] | null;
  chapters?: ApiChapter[] | null;
};

export type ApiChapter = {
  id?: string | number;
  slug?: string;
  number?: number | string;
  title?: string | null;
  createdAt?: string | null;
  isLocked?: boolean;
  isAccessible?: boolean;
  price?: number | null;
};

export type ApiGenre = { id?: number; name?: string };

/**
 * Ids the app will accept.
 *
 * Anything crossing the bridge must be alphanumeric or drawn from
 * `._-@()[]%?#+=/&:`, and some of this site's slugs carry an apostrophe. One
 * such id is not rejected on its own - a row's items are converted together, so
 * a single bad slug takes the whole row down with it. Percent is a permitted
 * character, so the offending ones are escaped on the way out and unescaped
 * again whenever an address is built from them.
 */
const ID_UNSAFE = /[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g;

export function toId(slug: string): string {
  return slug.replace(ID_UNSAFE, (character) => {
    const escaped = encodeURIComponent(character);

    // encodeURIComponent leaves a few marks - an apostrophe among them - alone.
    return escaped === character
      ? `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
      : escaped;
  });
}

export function fromId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Series pages carry the slug; chapter pages hang off it. */
export function seriesPageUrl(slug: string): string {
  return `${DOMAIN}/series/${slug}`;
}

export function chapterPageUrl(seriesSlug: string, chapterSlug: string): string {
  return `${DOMAIN}/series/${seriesSlug}/${chapterSlug}`;
}

export const POPULAR_SECTION_ID = "popular";
export const LATEST_SECTION_ID = "latest";
export const GENRES_SECTION_ID = "genres";

/**
 * What the home screen shows.
 *
 * The site's own front page leads with what is popular today and then what has
 * just been posted, so those are the two rows of titles; the genre row is what
 * makes its couple of hundred tags reachable without typing them.
 */
export const HOME_SECTIONS = [
  { id: POPULAR_SECTION_ID, title: "Popular Today" },
  { id: LATEST_SECTION_ID, title: "Latest Updates" },
  { id: GENRES_SECTION_ID, title: "Genres" },
] as const;

/**
 * The listing endpoint answers in one of two orders: its default, which leads
 * with what was updated most recently, and another the site uses for what is
 * popular. Any value at all selects the second, so this names the one used.
 */
export const POPULAR_ORDER = "hot";

/** Values the listing endpoint genuinely narrows on - each was checked against
 * the live API, and the ones it quietly ignores are not offered. */
export const STATUSES = ["ONGOING", "COMPLETED", "HIATUS", "DROPPED"] as const;
export const TYPES = ["MANHWA", "MANHUA", "MANGA"] as const;

export const SORTS: SortingOption[] = [
  { id: "latest", label: "Latest Updates" },
  { id: POPULAR_ORDER, label: "Popular" },
];

export const DEFAULT_SORT = "latest";

/** Titles per page of results, and chapters per request. */
export const PAGE_SIZE = 30;
export const CHAPTER_BATCH = 500;

/** Paging and filter state carried between pages of results. */
export type KaynSearchMetadata = {
  page?: number;
  sort?: string;
  genreIds?: string[];
  status?: string;
  type?: string;
  completed?: boolean;
};

/** Genres change as the site tags new titles, so they are fetched rather than
 * written down here, and kept only briefly. */
export const GENRE_STATE_KEY = "kaynscan.genres";
export const GENRE_TTL_MS = 12 * 60 * 60_000;
