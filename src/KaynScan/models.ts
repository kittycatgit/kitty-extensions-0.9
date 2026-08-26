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
  isNew?: boolean;
  isPinned?: boolean;
  lastChapterAddedAt?: string | null;
  updatedAt?: string | null;
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

/** The catalogue reply behind the home page: comics, novels, and their counts. */
export type ApiPosts = {
  posts?: ApiSeries[];
  novelPosts?: ApiSeries[];
};

/** A series carries a few of its most recent chapters in the catalogue reply. */
export type ApiRecentChapter = {
  id?: string | number;
  number?: number | string;
  createdAt?: string | null;
  isLocked?: boolean;
  isAccessible?: boolean;
};

/** A chapter as its own route returns it: images for a comic, text for a novel. */
export type ApiChapterDetail = {
  content?: string | null;
  images?: { url?: string | null; order?: number | null }[] | null;
  isAccessible?: boolean;
  isLocked?: boolean;
};

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

/**
 * A chapter, whole.
 *
 * One route hands back both kinds: a comic arrives as an ordered list of
 * images, a novel as its text. It also says whether the chapter is one the
 * reader may open at all, which the listing only hints at.
 */
export function chapterApiUrl(chapterId: string): string {
  return `${API}/chapter?chapterId=${encodeURIComponent(chapterId)}`;
}

export const POPULAR_SECTION_ID = "popular";
export const MOST_POPULAR_SECTION_ID = "mostPopular";
export const RELEASES_SECTION_ID = "releases";
export const LATEST_SECTION_ID = "latest";
export const NOVELS_SECTION_ID = "novels";
export const GENRES_SECTION_ID = "genres";

/**
 * What the home screen shows.
 *
 * These are the rows the site's own front page carries, in its order and under
 * its names, and they come from the one request it makes for them - the whole
 * catalogue at once, which is then cut into rows here exactly as the site cuts
 * it there. Novels sit in their own list on that reply, so they get their own
 * row rather than being mixed in.
 */
export const HOME_SECTIONS = [
  { id: POPULAR_SECTION_ID, title: "Popular Today" },
  { id: RELEASES_SECTION_ID, title: "Latest Releases" },
  { id: MOST_POPULAR_SECTION_ID, title: "Most Popular" },
  { id: LATEST_SECTION_ID, title: "Latest Updates" },
  { id: NOVELS_SECTION_ID, title: "Novels" },
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

/** The whole catalogue in one reply, which is how the site builds its own home
 * page. It is asked for once and kept a short while, since every row is cut
 * from it and asking per row would fetch the same half a megabyte each time. */
export const POSTS_URL = `${API}/posts?perPage=500`;
export const HOME_STATE_KEY = "kaynscan.home";
export const HOME_TTL_MS = 10 * 60_000;

/** How much of a row is worth keeping; the app pages through what it is given. */
export const ROW_CAP = 60;

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
