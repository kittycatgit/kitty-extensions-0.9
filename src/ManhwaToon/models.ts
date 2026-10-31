/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { DiscoverSectionType } from "@paperback/types";

export const DOMAIN = "https://www.manhwatoon.me";
export const DIRECTORY = "manhwa";
export const SEEN_LIMIT = 360;

const pagePath = (page: number): string => (page > 1 ? `page/${page}/` : "");

export const seriesUrl = (mangaId: string): string => `${DOMAIN}/${DIRECTORY}/${mangaId}/`;
export const chaptersUrl = (mangaId: string): string => `${seriesUrl(mangaId)}ajax/chapters/`;
export const chapterUrl = (mangaId: string, chapterId: string): string =>
  `${seriesUrl(mangaId)}${chapterId}/?style=list`;
export const homeUrl = (page = 1): string => `${DOMAIN}/${pagePath(page)}`;
export const searchUrl = (page: number, query: string): string =>
  `${DOMAIN}/${pagePath(page)}?${query}`;
export const directoryUrl = (page: number, query = ""): string =>
  `${DOMAIN}/${DIRECTORY}/${pagePath(page)}${query ? `?${query}` : ""}`;
export const genreUrl = (slug: string, page: number): string =>
  `${DOMAIN}/manhwa-genre/${slug}/${pagePath(page)}`;

export type ManhwaToonMetadata = {
  page?: number;
  completed?: boolean;
  seen?: string[];
  types?: string[];
  statuses?: string[];
  adult?: string;
  genres?: string[];
  author?: string;
  artist?: string;
  release?: string;
};

export type Option = { id: string; title: string };

// `id` is the site's m_orderby value; relevance sends none.
export const SORTS: Option[] = [
  { id: "relevance", title: "Relevance" },
  { id: "latest", title: "Latest updates" },
  { id: "new-manga", title: "Newest series" },
  { id: "alphabet", title: "A-Z" },
  { id: "rating", title: "Highest rated" },
  { id: "views", title: "Most viewed" },
  { id: "trending", title: "Trending" },
];

export const ADULT: Option[] = [
  { id: "all", title: "All content" },
  { id: "0", title: "Exclude adult" },
  { id: "1", title: "Adult only" },
];

export type Row = {
  id: string;
  title: string;
  type: DiscoverSectionType;
  source:
    | { kind: "hero" }
    | { kind: "home"; heading: string }
    | { kind: "updates" }
    | { kind: "directory"; query: string }
    | { kind: "genre"; slug: string }
    | { kind: "genres" };
};

export const ROWS: Row[] = [
  {
    id: "featured",
    title: "Featured",
    type: DiscoverSectionType.featured,
    source: { kind: "hero" },
  },
  {
    id: "popular",
    title: "Popular now",
    type: DiscoverSectionType.prominentCarousel,
    source: { kind: "home", heading: "Popular now" },
  },
  {
    id: "latest",
    title: "Latest updates",
    type: DiscoverSectionType.chapterUpdates,
    source: { kind: "updates" },
  },
  {
    id: "new",
    title: "New series",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "home", heading: "New series" },
  },
  {
    id: "trending",
    title: "Trending",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "directory", query: "m_orderby=trending" },
  },
  {
    id: "views",
    title: "Most viewed",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "directory", query: "m_orderby=views" },
  },
  {
    id: "rating",
    title: "Highest rated",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "directory", query: "m_orderby=rating" },
  },
  {
    id: "manhwa",
    title: "Manhwa",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "genre", slug: "manhwa" },
  },
  {
    id: "manhua",
    title: "Manhua",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "genre", slug: "manhua" },
  },
  {
    id: "manga",
    title: "Manga",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "genre", slug: "manga" },
  },
  {
    id: "genres",
    title: "Genres",
    type: DiscoverSectionType.genres,
    source: { kind: "genres" },
  },
];
