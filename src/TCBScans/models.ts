/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://tcbonepiecechapters.com";

// The app's default user agent drops the `Version/` and `Safari/` tokens, which
// is exactly what the bot filter here looks for. Send a complete one.
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// An empty imageUrl fails the whole row it is in, so point at a real URL that
// serves no image and let the app draw its own placeholder.
export const FALLBACK_COVER = `${DOMAIN}/files/_no-cover.png`;

export const PROJECTS_PATH = "/projects";

// Ids hold both path segments - `13/chainsaw-man` - since a series is only
// addressable by number and slug together.
export function seriesUrl(mangaId: string): string {
  return `${DOMAIN}/mangas/${mangaId}`;
}

export function chapterUrl(chapterId: string): string {
  return `${DOMAIN}/chapters/${chapterId}`;
}

export function seriesIdFromHref(href: string): string | undefined {
  return /^\/mangas\/(\d+\/[^/?#"]+)/.exec(href)?.[1];
}

export function chapterIdFromHref(href: string): string | undefined {
  return /^\/chapters\/(\d+\/[^/?#"]+)/.exec(href)?.[1];
}

export const LATEST_SECTION_ID = "latest";
export const SERIES_SECTION_ID = "series";

export const HOME_SECTIONS = [
  { id: LATEST_SECTION_ID, title: "Latest Releases" },
  { id: SERIES_SECTION_ID, title: "All Series" },
] as const;

export type TCBSearchMetadata = {
  page?: number;
  completed?: boolean;
};

export const PAGE_SIZE = 24;
