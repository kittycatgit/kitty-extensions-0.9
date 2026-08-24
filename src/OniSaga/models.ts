/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://onisaga.com";

/**
 * Stand-in for a card the site renders without artwork.
 *
 * An empty string is rejected as an invalid URL and, because covers are
 * converted as an array, one blank cover fails the whole rail. This is a real
 * URL that holds no image, so the app falls through to its own placeholder
 * rather than being handed substitute artwork.
 */
export const FALLBACK_COVER = `${DOMAIN}/_no-cover.png`;

/** Paging and filter state carried between pages of results. */
export type OniSagaSearchMetadata = {
  page?: number;
  genres?: string[];
  completed?: boolean;
};

/**
 * Placeholder page URLs.
 *
 * A chapter's real page URLs are signed and expire ten minutes after they are
 * minted, and each one costs its own API call. Resolving a 157 page chapter up
 * front would therefore both trip the rate limiter and hand the reader links
 * that expire before it reaches them. Instead the chapter reports these
 * markers, and the interceptor swaps each one for a freshly signed URL at the
 * moment the reader actually asks for that page.
 */
export const PAGE_MARKER = "/_pbpage/";

export function pageMarkerUrl(chapterId: string, index: number): string {
  return `${DOMAIN}${PAGE_MARKER}${chapterId}/${index}`;
}

export function parsePageMarker(url: string): { chapterId: string; index: number } | undefined {
  const match = url.match(/\/_pbpage\/([^/]+)\/(\d+)/);
  return match ? { chapterId: match[1]!, index: Number(match[2]) } : undefined;
}

/** The reader API the site itself calls, one page at a time. */
export function pageApiUrl(chapterId: string, index: number): string {
  return `${DOMAIN}/api/chapter/${chapterId}/page/${index}`;
}

export function readerUrl(mangaId: string, chapterId: string): string {
  return `${DOMAIN}/read/${mangaId}/${chapterId}`;
}

/** Header the page API refuses to answer without. */
export const READER_TOKEN_HEADER = "X-Reader-Token";

/**
 * Minimum gap between page-resolution calls.
 *
 * The advertised allowance is 300, but there is a stricter burst limit behind
 * it: going too fast earns a 429 whose penalty lasts far longer than the time
 * saved. This is the pace the site's own reader keeps.
 */
export const PAGE_REQUEST_GAP_MS = 1200;

/** How long a 429 is respected for when the reply carries no Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

/** Reader tokens belong to a single chapter and are cached only briefly. */
export const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * How long a resolved page URL is reused.
 *
 * The signed URLs expire ten minutes after they are minted, so they are held a
 * little under that: long enough to serve the app's repeat requests for the
 * same page, short enough that a reused link is never already dead.
 */
export const SIGNED_URL_TTL_MS = 8 * 60 * 1000;

/**
 * Listing routes used for the home rails.
 *
 * `/browse` is deliberately absent: it renders its filter form as some
 * thirteen thousand checkboxes, which makes the page around 14 MB, where these
 * routes are a few hundred kilobytes for more titles.
 */
export const HOME_SECTIONS: { id: string; title: string; path: string; paginates: boolean }[] = [
  // `/home` ignores its page parameter and answers with the same rows every
  // time, so it is reported as a single page rather than scrolling duplicates
  // forever. The other two advance properly.
  { id: "home", title: "Latest Updates", path: "/home", paginates: false },
  { id: "trending", title: "Trending", path: "/trending", paginates: true },
  { id: "top", title: "Top Manga", path: "/top-manga", paginates: true },
];

export const GENRES_SECTION_ID = "genres";

export const SORTING_OPTIONS: SortingOption[] = [];

export const GENRE_CACHE_TTL = 24 * 60 * 60 * 1000;
export const GENRE_STATE_KEY = "onisaga.genres";

export const STATUS_LABELS: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "Hiatus",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  dropped: "Cancelled",
};
