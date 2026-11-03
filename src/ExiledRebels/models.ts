/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://exiledrebelsscanlations.com";
export const API = `${DOMAIN}/wp-json/wp/v2`;

// The site logo: a real image for titles whose page carries no cover.
export const PLACEHOLDER_COVER = `${DOMAIN}/wp-content/uploads/cropped-Exiled-Rebels-5s-1.png`;

export const PAGE_SIZE = 20;
export const REST_PAGE_SIZE = 100;

// Parent pages of the hand-written novel pages: "Novels" and "Addis' Originals".
export const NOVEL_PAGE_PARENTS = [7878, 7882];
// The Addis' Originals category only groups its children; the children are series.
export const ADDIS_ORIGINALS_CATEGORY = 582344627;

// Top-level categories that are not series: manga (download-only archives, so
// not readable here), site notices and the owner's travel diaries.
export const NON_SERIES_CATEGORIES = new Set([
  1694,
  1,
  582345003,
  582345292,
  582344658,
  582345272,
  ADDIS_ORIGINALS_CATEGORY,
]);

// Series whose page title does not match the category name.
export const PAGE_SLUG_OVERRIDES: Record<string, string> = {
  "a-heart-of-a-smith": "the-heart-of-a-smith",
  "artifact-refining-master": "artifact-refining-master-rebirth",
  "beast-store-no-138": "cute-beast-store-no-138",
  "interstellars-first-out-of-wedlock-pregnancy": "interstellars-unmarried-first-pregnancy",
  "the-governor-is-sick": "the-governors-illness",
  "overflowing-hidden-desires": "overflowing-hidden-desires",
  "pk-the-hero": "as-the-demon-king-i-had-no-choice-but-to-pk-the-hero",
};

// Pages that live outside the two novel parents and are fetched by slug.
export const EXTRA_PAGE_SLUGS = [
  "overflowing-hidden-desires",
  "as-the-demon-king-i-had-no-choice-but-to-pk-the-hero",
];

export const GENRE_PAGES = [
  { id: "page-fantasy", title: "Fantasy", path: "/fantasy/" },
  { id: "page-cultivation", title: "Cultivation", path: "/cultivation/" },
  { id: "page-comedy", title: "Comedy", path: "/comedy/" },
  { id: "page-modern", title: "Modern", path: "/modern/" },
  { id: "page-mystery", title: "Mystery & Suspense", path: "/mystery-suspense/" },
  { id: "page-omegaverse", title: "Omegaverse", path: "/omegaverse/" },
  {
    id: "page-transmigration",
    title: "Transmigration & Rebirth",
    path: "/transmigration-rebirth/",
  },
  { id: "page-matthia", title: "Matthia's Novels", path: "/matthia-novels/" },
];

export const ONGOING_PAGE_PATH = "/ongoing-novels/";

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest Update" },
  { id: "title", label: "Title" },
  { id: "chapters", label: "Chapter Count" },
];

export const STATUSES = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

export type SeriesStatus = "ongoing" | "completed";

export type ExiledMetadata = {
  page?: number;
  completed?: boolean;
  genres?: string[];
  status?: SeriesStatus;
};

export type WpCategory = { id: number; name: string; slug: string; parent: number; count: number };

export type WpPage = {
  id: number;
  slug: string;
  parent: number;
  date_gmt: string;
  modified_gmt: string;
  title: { rendered: string };
  content: { rendered: string };
  featured_media: number;
  _embedded?: { "wp:featuredmedia"?: { source_url?: string }[] };
};

export type WpPost = {
  id: number;
  slug: string;
  date_gmt: string;
  title: { rendered: string };
  categories: number[];
  content?: { rendered: string; protected?: boolean };
  jetpack_featured_media_url?: string;
};

export type PageMeta = {
  author?: string;
  genres: string[];
  translator?: string;
  editor?: string;
  year?: string;
  originStatus?: string;
  translationStatus?: string;
  summary: string;
  cover?: string;
  tocCount: number;
  lastTocTitle?: string;
};

export type Series = {
  id: string;
  categoryId: number;
  title: string;
  abbreviation?: string;
  pageSlug?: string;
  addedAt: number;
  updatedAt: number;
  chapterCount: number;
  status: SeriesStatus;
  cover: string;
  genres: string[];
  genreIds: string[];
  author?: string;
  translator?: string;
  editor?: string;
  year?: string;
  originStatus?: string;
  summary: string;
  latestChapter?: { slug: string; title: string; date: number };
};

export type HomePick = { id: string; title: string; links: string[] };

export function genreId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
