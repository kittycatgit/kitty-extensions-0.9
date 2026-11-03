/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://www.fanfiction.net";

/** The site's own 60×90 placeholder, shown for stories without a cover. */
export const PLACEHOLDER_COVER = `${DOMAIN}/static/images/d_60_90.jpg`;

export type Option = { id: string; title: string };

export type FanFictionMetadata = {
  /** Fandom path as in the site URL, e.g. `anime/Naruto`. */
  fandom?: string;
  rating?: string;
  language?: string;
  length?: string;
  status?: string;
  time?: string;
  genre1?: string;
  genre2?: string;
  excludeGenre?: string;
  match?: string;
  page?: number;
  completed?: boolean;
};

export type StoryMeta = {
  fandom?: string;
  rated?: string;
  language?: string;
  genres: string[];
  characters: string[];
  chapters: number;
  words?: number;
  reviews?: number;
  favs?: number;
  follows?: number;
  updated?: number;
  published?: number;
  complete: boolean;
};

export type StoryCard = {
  id: string;
  title: string;
  author?: string;
  cover: string;
  summary: string;
  meta: StoryMeta;
};

export type StoryChapter = { number: number; title: string };

export type Story = {
  id: string;
  title: string;
  author?: string;
  summary: string;
  cover: string;
  category?: string;
  fandom?: string;
  meta: StoryMeta;
  chapters: StoryChapter[];
};

export type Fandom = { name: string; path: string; count: string };

export type Category = { id: string; title: string };

export const CATEGORIES: Category[] = [
  { id: "anime", title: "Anime/Manga" },
  { id: "book", title: "Books" },
  { id: "cartoon", title: "Cartoons" },
  { id: "comic", title: "Comics" },
  { id: "game", title: "Games" },
  { id: "misc", title: "Misc" },
  { id: "play", title: "Plays/Musicals" },
  { id: "movie", title: "Movies" },
  { id: "tv", title: "TV Shows" },
];

export const JUST_IN_SECTIONS = [
  { id: "just-in", title: "Just In", sortId: "1" },
  { id: "just-updated", title: "Just Updated", sortId: "2" },
  { id: "new-crossovers", title: "New Crossovers", sortId: "3" },
];

// Fandom listings take `srt`; keyword search only knows relevance and the two
// date sorts, so the others fall back to relevance there.
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "1", label: "Update Date" },
  { id: "2", label: "Publish Date" },
  { id: "3", label: "Reviews" },
  { id: "4", label: "Favorites" },
  { id: "5", label: "Follows" },
];

export const SEARCH_SORTS: Record<string, string> = { "1": "dateupdate", "2": "datesubmit" };

// The vocabularies below are static constants of the site's filter forms;
// there is no endpoint that serves them, so they are bundled.
export const RATINGS: Option[] = [
  { id: "10", title: "All" },
  { id: "103", title: "K → T" },
  { id: "102", title: "K → K+" },
  { id: "1", title: "K" },
  { id: "2", title: "K+" },
  { id: "3", title: "T" },
  { id: "4", title: "M" },
];

/** Keyword search spells the same ratings with `0` as "all". */
export const SEARCH_RATINGS: Record<string, string> = { "10": "0" };

export const LANGUAGES: Option[] = [
  { id: "1", title: "English" },
  { id: "2", title: "Español" },
  { id: "3", title: "Français" },
  { id: "4", title: "Deutsch" },
  { id: "5", title: "中文" },
  { id: "6", title: "日本語" },
  { id: "7", title: "Nederlands" },
  { id: "8", title: "Português" },
  { id: "10", title: "Русский" },
  { id: "11", title: "Italiano" },
  { id: "12", title: "България" },
  { id: "13", title: "Polski" },
  { id: "14", title: "Magyar" },
  { id: "15", title: "עברית" },
  { id: "16", title: "العربية" },
  { id: "17", title: "Svenska" },
  { id: "18", title: "Norsk" },
  { id: "19", title: "Dansk" },
  { id: "20", title: "Suomi" },
  { id: "21", title: "Filipino" },
  { id: "22", title: "Esperanto" },
  { id: "23", title: "हिंदी" },
  { id: "24", title: "ਪੰਜਾਬੀ" },
  { id: "25", title: "فارسی" },
  { id: "26", title: "Ελληνικά" },
  { id: "27", title: "Română" },
  { id: "29", title: "Српски" },
  { id: "30", title: "Türkçe" },
  { id: "31", title: "Čeština" },
  { id: "32", title: "Bahasa Indonesia" },
  { id: "33", title: "Hrvatski" },
  { id: "34", title: "Català" },
  { id: "35", title: "Latina" },
  { id: "36", title: "한국어" },
  { id: "37", title: "Tiếng Việt" },
  { id: "38", title: "ภาษาไทย" },
  { id: "40", title: "Íslenska" },
  { id: "41", title: "Eesti" },
  { id: "42", title: "Bahasa Melayu" },
  { id: "43", title: "Slovenčina" },
  { id: "44", title: "Українська" },
  { id: "45", title: "Afrikaans" },
];

export const LENGTHS: Option[] = [
  { id: "11", title: "< 1K words" },
  { id: "51", title: "< 5K words" },
  { id: "1", title: "> 1K words" },
  { id: "5", title: "> 5K words" },
  { id: "10", title: "> 10K words" },
  { id: "20", title: "> 20K words" },
  { id: "40", title: "> 40K words" },
  { id: "60", title: "> 60K words" },
  { id: "100", title: "> 100K words" },
];

/** Keyword search uses a coarser `words` scale; this is the nearest bucket. */
export const SEARCH_LENGTHS: Record<string, string> = {
  "11": "1",
  "51": "2",
  "1": "0",
  "5": "3",
  "10": "4",
  "20": "4",
  "40": "5",
  "60": "6",
  "100": "7",
};

export const STATUSES: Option[] = [
  { id: "1", title: "In-Progress" },
  { id: "2", title: "Complete" },
];

export const TIME_RANGES: Option[] = [
  { id: "1", title: "Updated within 24 hours" },
  { id: "2", title: "Updated within 1 week" },
  { id: "3", title: "Updated within 1 month" },
  { id: "4", title: "Updated within 6 months" },
  { id: "5", title: "Updated within 1 year" },
  { id: "11", title: "Published within 24 hours" },
  { id: "12", title: "Published within 1 week" },
  { id: "13", title: "Published within 1 month" },
  { id: "14", title: "Published within 6 months" },
  { id: "15", title: "Published within 1 year" },
];

export const GENRES: Option[] = [
  { id: "6", title: "Adventure" },
  { id: "10", title: "Angst" },
  { id: "18", title: "Crime" },
  { id: "4", title: "Drama" },
  { id: "19", title: "Family" },
  { id: "14", title: "Fantasy" },
  { id: "21", title: "Friendship" },
  { id: "1", title: "General" },
  { id: "8", title: "Horror" },
  { id: "3", title: "Humor" },
  { id: "20", title: "Hurt/Comfort" },
  { id: "7", title: "Mystery" },
  { id: "9", title: "Parody" },
  { id: "5", title: "Poetry" },
  { id: "2", title: "Romance" },
  { id: "13", title: "Sci-Fi" },
  { id: "15", title: "Spiritual" },
  { id: "11", title: "Supernatural" },
  { id: "12", title: "Suspense" },
  { id: "16", title: "Tragedy" },
  { id: "17", title: "Western" },
];

export const MATCHES: Option[] = [
  { id: "title", title: "Title only" },
  { id: "summary", title: "Summary only" },
];
