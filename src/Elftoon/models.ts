/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export type Option = { id: string; title: string };

export type ElftoonSeries = {
  slug: string;
  title: string;
  type?: string | null;
  status?: string | null;
  origin?: string | null;
  description?: string | null;
  cover_image?: string | null;
  author?: string | null;
  artist?: string | null;
  rating?: number | null;
  rating_count?: number | null;
  views?: number | null;
  bookmarks?: number | null;
  chapter_count?: number | null;
  free_chapter_count?: number | null;
  paid_chapter_count?: number | null;
  early_access_chapter_count?: number | null;
  genres?: string[];
  genre_slugs?: string[];
  tags?: string[];
  tag_slugs?: string[];
  is_nsfw?: boolean;
  url?: string;
  last_chapter_at?: string | null;
  original_title?: string | null;
  alternative_titles?: string[];
  team?: { name?: string; slug?: string } | null;
};

export type ElftoonPagination = {
  page?: number;
  total_pages?: number;
  has_more?: boolean;
};

export type ElftoonListing = { data?: ElftoonSeries[]; pagination?: ElftoonPagination };

export type ElftoonSearch = { results?: ElftoonSeries[]; total?: number };

export type ElftoonChapterRow = {
  number: number;
  title?: string | null;
  is_free?: boolean;
  published_at?: string | null;
};

export type ElftoonChapterList = {
  counts?: { total?: number };
  chapters?: ElftoonChapterRow[];
};

export type ElftoonGenre = { name: string; slug: string; series_count?: number };

/** One page object from the reader's RSC payload. */
export type ElftoonPage = { pageNumber?: number; imageUrl?: string };

export type ElftoonMetadata = {
  page?: number;
  completed?: boolean;
  genre?: string;
  exgenre?: string;
  tag?: string;
  status?: string;
  origin?: string;
  nsfw?: string;
  minChapters?: string;
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "popular", label: "Most Read" },
  { id: "trending", label: "Trending" },
  { id: "latest", label: "Latest Updated" },
  { id: "newest", label: "Recently Added" },
  { id: "rating", label: "Highest Rated" },
  { id: "bookmarked", label: "Most Bookmarked" },
  { id: "longest", label: "Most Chapters" },
  { id: "alphabetical", label: "A-Z" },
];

export const DEFAULT_SORT = "popular";

export const STATUSES: Option[] = [
  { id: "ONGOING", title: "Ongoing" },
  { id: "COMPLETED", title: "Completed" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "DROPPED", title: "Dropped" },
  { id: "DISCONTINUED", title: "Discontinued" },
  { id: "UPCOMING", title: "Upcoming" },
];

export const ORIGINS: Option[] = [
  { id: "korean", title: "Korean" },
  { id: "japanese", title: "Japanese" },
  { id: "chinese", title: "Chinese" },
  { id: "other", title: "Other" },
];

export const NSFW_MODES: Option[] = [
  { id: "include", title: "Show everything" },
  { id: "exclude", title: "Hide mature" },
  { id: "only", title: "Mature only" },
];

// The site's genre list on 2026-11-07, used only when /api/ai/genres is unreachable.
export const FALLBACK_GENRES: Option[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "apocalypse", title: "Apocalypse" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "cultivation", title: "Cultivation" },
  { id: "demons", title: "Demons" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "ghosts", title: "Ghosts" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "isekai", title: "Isekai" },
  { id: "magic", title: "Magic" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "mature", title: "Mature" },
  { id: "military", title: "Military" },
  { id: "modern", title: "Modern" },
  { id: "monsters", title: "Monsters" },
  { id: "murim", title: "Murim" },
  { id: "mystery", title: "Mystery" },
  { id: "philosophical", title: "Philosophical" },
  { id: "post-apocalyptic", title: "Post-Apocalyptic" },
  { id: "psychological", title: "Psychological" },
  { id: "rebirth", title: "Rebirth" },
  { id: "reincarnation", title: "Reincarnation" },
  { id: "romance", title: "Romance" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "shounen", title: "Shounen" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "sports", title: "Sports" },
  { id: "superhero", title: "Superhero" },
  { id: "supernatural", title: "Supernatural" },
  { id: "survival", title: "Survival" },
  { id: "system", title: "System" },
  { id: "thriller", title: "Thriller" },
  { id: "time-travel", title: "Time Travel" },
  { id: "tragedy", title: "Tragedy" },
  { id: "video-games", title: "Video Games" },
  { id: "virtual-reality", title: "Virtual Reality" },
  { id: "wuxia", title: "Wuxia" },
];
