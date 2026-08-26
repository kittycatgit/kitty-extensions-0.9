/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://tcbonepiecechapters.com";

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
 * Stand-in for a title the site lists without artwork.
 *
 * An empty address is rejected outright, and because a row's items are
 * converted together one blank cover takes its whole row down. This is a real
 * address holding no image, so the app draws its own placeholder instead of
 * being handed nothing.
 */
export const FALLBACK_COVER = `${DOMAIN}/files/_no-cover.png`;

/** Every series the group scanlates, on one page. */
export const PROJECTS_PATH = "/projects";

/**
 * Ids carry the site's own path segments - `13/chainsaw-man` - because a
 * series is only addressable by number *and* slug. Both are allowed in an id;
 * a space would not be.
 */
export function seriesUrl(mangaId: string): string {
  return `${DOMAIN}/mangas/${mangaId}`;
}

export function chapterUrl(chapterId: string): string {
  return `${DOMAIN}/chapters/${chapterId}`;
}

/** Pulls `13/chainsaw-man` out of `/mangas/13/chainsaw-man`. */
export function seriesIdFromHref(href: string): string | undefined {
  return /^\/mangas\/(\d+\/[^/?#"]+)/.exec(href)?.[1];
}

export function chapterIdFromHref(href: string): string | undefined {
  return /^\/chapters\/(\d+\/[^/?#"]+)/.exec(href)?.[1];
}

export const LATEST_SECTION_ID = "latest";
export const SERIES_SECTION_ID = "series";

/**
 * What the home screen shows.
 *
 * The site is one group's own release page: a few dozen series and a running
 * list of what has just been posted. That is the whole of it, so those are the
 * two rows - anything else would be the same titles under another heading.
 */
export const HOME_SECTIONS = [
  { id: LATEST_SECTION_ID, title: "Latest Releases" },
  { id: SERIES_SECTION_ID, title: "All Series" },
] as const;

/** Paging state carried between pages of results. */
export type TCBSearchMetadata = {
  page?: number;
  completed?: boolean;
};

/** How many titles a page of results carries. */
export const PAGE_SIZE = 24;
