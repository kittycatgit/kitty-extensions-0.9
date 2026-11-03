/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://xnovel.me";
export const GRAPHQL_URL = `${DOMAIN}/n2/`;

// Only the sized file name exists; novels without one get the site icon so the
// row still renders.
export const PLACEHOLDER_COVER = `${DOMAIN}/static-assets/img/favicon.png`;

export const LISTING_PAGE_SIZE = 20;
export const SEARCH_PAGE_SIZE = 36;
export const CHAPTER_PAGE_SIZE = 60;

export type TriState = Record<string, "included" | "excluded">;

export type XNovelMetadata = {
  page?: number;
  completed?: boolean;
  genres?: TriState;
  sort?: string;
};

export type Genre = { slug: string; title: string };

// The site has no genre endpoint; this is the list its search page bundles.
export const GENRES: Genre[] = [
  { slug: "action", title: "Action" },
  { slug: "adult", title: "Adult" },
  { slug: "adventure", title: "Adventure" },
  { slug: "anime-&-comics", title: "Anime & Comics" },
  { slug: "comedy", title: "Comedy" },
  { slug: "drama", title: "Drama" },
  { slug: "eastern", title: "Eastern" },
  { slug: "ecchi", title: "Ecchi" },
  { slug: "fan-fiction", title: "Fan-Fiction" },
  { slug: "fantasy", title: "Fantasy" },
  { slug: "game", title: "Game" },
  { slug: "gender-bender", title: "Gender-Bender" },
  { slug: "harem", title: "Harem" },
  { slug: "historical", title: "Historical" },
  { slug: "horror", title: "Horror" },
  { slug: "isekai", title: "Isekai" },
  { slug: "josei", title: "Josei" },
  { slug: "lgbt+", title: "LGBT+" },
  { slug: "litrpg", title: "LitRPG" },
  { slug: "magic", title: "Magic" },
  { slug: "magical-realism", title: "Magical-Realism" },
  { slug: "martial-arts", title: "Martial-Arts" },
  { slug: "mature", title: "Mature" },
  { slug: "mecha", title: "Mecha" },
  { slug: "military", title: "Military" },
  { slug: "modern-life", title: "Modern-Life" },
  { slug: "mystery", title: "Mystery" },
  { slug: "other", title: "Other" },
  { slug: "psychological", title: "Psychological" },
  { slug: "reincarnation", title: "Reincarnation" },
  { slug: "romance", title: "Romance" },
  { slug: "romancei", title: "Romancei" },
  { slug: "school-life", title: "School-Life" },
  { slug: "sci-fi", title: "Sci-fi" },
  { slug: "seinen", title: "Seinen" },
  { slug: "shoujo", title: "Shoujo" },
  { slug: "shoujo-ai", title: "Shoujo-Ai" },
  { slug: "shounen", title: "Shounen" },
  { slug: "shounen-ai", title: "Shounen-Ai" },
  { slug: "slice-of-life", title: "Slice-of-Life" },
  { slug: "smut", title: "Smut" },
  { slug: "sports", title: "Sports" },
  { slug: "supernatural", title: "Supernatural" },
  { slug: "system", title: "System" },
  { slug: "thriller", title: "Thriller" },
  { slug: "tragedy", title: "Tragedy" },
  { slug: "urban", title: "Urban" },
  { slug: "video-games", title: "Video-Games" },
  { slug: "war", title: "War" },
  { slug: "wuxia", title: "Wuxia" },
  { slug: "xianxia", title: "Xianxia" },
  { slug: "xuanhuan", title: "Xuanhuan" },
  { slug: "yaoi", title: "Yaoi" },
  { slug: "yuri", title: "Yuri" },
];

// Tag ids cannot carry `&` or `+`; the slug is restored before it reaches the API.
export function genreId(slug: string): string {
  return slug.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function genreSlug(id: string): string {
  return GENRES.find((genre) => genreId(genre.slug) === id)?.slug ?? id;
}

// Novel records spell genres with underscores (`fan_fiction`); the vocabulary
// uses hyphens.
export function genreIdFromRecord(name: string): string {
  return genreId(name.toLowerCase().replace(/[\s_]+/g, "-"));
}

export const ADULT_GENRES = new Set(["adult", "smut", "mature", "ecchi"]);

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "field_update", label: "Recently updated" },
  { id: "field_follow", label: "Most follows" },
  { id: "field_chapter", label: "Most chapters" },
  { id: "field_review", label: "Most reviews" },
  { id: "field_comment", label: "Most comments" },
];

export type ListingWhere = "popular" | "update" | "completed" | "ongoing";

export const LISTING_SECTIONS: { id: ListingWhere; title: string }[] = [
  { id: "popular", title: "Hot Novels" },
  { id: "update", title: "Latest Releases" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

export const GENRES_SECTION_ID = "genres";

export type ChapterRef = {
  ch_id?: string;
  ch_index?: number;
  ch_title?: string;
  ChPath?: string;
  date_create?: number;
  date_update?: number;
};

export type NovelRecord = {
  N_id: string;
  N_title?: string;
  N_Path?: string;
  info_slug?: string;
  info_descText?: string;
  info_meta_AlternativeNames?: string[] | null;
  info_meta_Author?: string[] | null;
  info_meta_Genre?: string[] | null;
  info_meta_Tag?: string[] | null;
  info_meta_Source?: string | string[] | null;
  info_meta_Status?: string | null;
  rate?: number | null;
  votes?: number | null;
  follows?: number | null;
  reviews?: number | null;
  urlCoverOri?: string | null;
  date_create?: number | null;
  date_update?: number | null;
  chaptersNodes_last?: { id?: string | null; data?: ChapterRef | null }[] | null;
};

export type Paging = { total?: number; pages?: number; page?: number };

export type NovelList = { paging?: Paging; items?: { id?: string | null; data?: NovelRecord }[] };

export type ChapterRow = ChapterRef & { N_id?: string };

export type ChapterList = { paging?: Paging; items?: { id?: string | null; data?: ChapterRow }[] };

export type ChapterNode = {
  ch_id?: string;
  ch_index?: number;
  ch_title?: string;
  sourcesNode_list?: { data?: { content?: string[] | null } | null }[] | null;
};
