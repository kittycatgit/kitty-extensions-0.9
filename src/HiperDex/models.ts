/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type SortingOption, type Tag } from "@paperback/types";

/** Paging and filter state carried between pages of results. */
export type HiperDexSearchMetadata = {
  offset?: number;
  page?: number;
  sort?: string;
  genres?: string[];
  type?: string;
  status?: string;
  contentRating?: string;
  year?: number;
  completed?: boolean;
};

/** Shapes returned by the site's tRPC API, narrowed to the fields used here. */
export type ApiSeries = {
  id: number;
  slug: string;
  title: string;
  /** A JSON-encoded array on the detail route, a real array on search hits. */
  alternativeTitles?: string | string[] | null;
  synopsis?: string | null;
  coverUrl?: string | null;
  type?: string | null;
  status?: string | null;
  contentRating?: string | null;
  year?: number | null;
  score?: number | null;
  scoredBy?: number | null;
  views?: number | null;
  favorites?: number | null;
  genres?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  updatedAt?: string | null;
};

export type ApiChapter = {
  id: number;
  seriesId: number;
  number: number;
  volume?: number | null;
  title?: string | null;
  language?: string | null;
  pagesCount?: number | null;
  views?: number | null;
  createdAt?: string | null;
};

export type ApiPage = {
  pageOrder: number;
  webpUrl?: string | null;
  avifUrl?: string | null;
};

export type ApiTrendingItem = ApiSeries & {
  latestChapter?: { number: number; createdAt?: string | null } | null;
};

export type ApiLatestItem = {
  seriesId: number;
  seriesSlug: string;
  seriesTitle: string;
  seriesCoverUrl?: string | null;
  seriesStatus?: string | null;
  score?: number | null;
  chapters?: { id: number; number: number; title?: string | null; createdAt?: string | null }[];
};

/**
 * Values accepted by the API's own schema. Anything outside these is rejected
 * with a validation error rather than silently ignored, so the lists below are
 * the server's vocabulary rather than a guess.
 */
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "recent", label: "Recently Updated" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "popular", label: "Most Popular" },
  { id: "score", label: "Highest Rated" },
  { id: "alphabetical", label: "A \u2013 Z" },
  { id: "relevance", label: "Relevance" },
];

export const DEFAULT_SORT = "recent";

/**
 * Page sizes per procedure, taken from what each one's schema accepts.
 *
 * `search.query` allows up to 100 and `recommendations.trending` rejects
 * anything above 20 outright, so these are limits rather than preferences.
 */
export const PAGE_SIZE = 30;
export const TRENDING_PAGE_SIZE = 20;
export const LATEST_PAGE_SIZE = 40;

/** Widest rating the API will return; the app does its own filtering per item. */
export const MAX_RATING = "pornographic";

export const TYPE_OPTIONS: Tag[] = [
  { id: "manhwa", title: "Manhwa" },
  { id: "manga", title: "Manga" },
  { id: "manhua", title: "Manhua" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "releasing", title: "Releasing" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const CONTENT_RATING_OPTIONS: Tag[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

/** Home rails mirror the site's own trending periods plus its update feed. */
export const TRENDING_SECTIONS: { id: string; title: string; period: string }[] = [
  { id: "trending-day", title: "Trending Today", period: "day" },
  { id: "trending-week", title: "Trending This Week", period: "week" },
  { id: "trending-month", title: "Trending This Month", period: "month" },
];

export const LATEST_SECTION_ID = "latest-chapters";
export const GENRES_SECTION_ID = "genres";

export const STATUS_LABELS: Record<string, string> = {
  releasing: "Ongoing",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  hiatus: "Hiatus",
};

/** The API's rating vocabulary mapped onto the app's three tiers. */
export const CONTENT_RATINGS: Record<string, ContentRating> = {
  safe: ContentRating.EVERYONE,
  suggestive: ContentRating.MATURE,
  erotica: ContentRating.ADULT,
  pornographic: ContentRating.ADULT,
};

/** A genre as the API lists it. */
export type ApiGenre = { id: number; name: string; slug: string };

/** How long a fetched genre list is reused before being refreshed. */
export const GENRE_CACHE_TTL = 24 * 60 * 60 * 1000;
export const GENRE_STATE_KEY = "hiperdex.genres";

/**
 * Fallback genre list, captured from `search.genres`.
 *
 * The live list is fetched and cached at runtime; this is what the filter and
 * the genre rail fall back to when that request fails, and it is also the
 * name-to-slug map the detail parser uses to build valid tag ids.
 */
export const GENRES: Tag[] = [
  { id: "4-koma", title: "4-Koma" },
  { id: "action", title: "Action" },
  { id: "adaptation", title: "Adaptation" },
  { id: "adult", title: "Adult" },
  { id: "adventure", title: "Adventure" },
  { id: "age-gap", title: "Age Gap" },
  { id: "aliens", title: "Aliens" },
  { id: "ancient-korea", title: "Ancient Korea" },
  { id: "animals", title: "Animals" },
  { id: "anthology", title: "Anthology" },
  { id: "award-winning", title: "Award Winning" },
  { id: "campus", title: "Campus" },
  { id: "childhood-friends", title: "Childhood Friends" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "crime", title: "Crime" },
  { id: "crossdressing", title: "Crossdressing" },
  { id: "dance", title: "Dance" },
  { id: "delinquents", title: "Delinquents" },
  { id: "demons", title: "Demons" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "escolar", title: "Escolar" },
  { id: "fantasy", title: "Fantasy" },
  { id: "fellatio-blowjob", title: "Fellatio/Blowjob" },
  { id: "fetish", title: "Fetish" },
  { id: "full-color", title: "Full Color" },
  { id: "furry", title: "Furry" },
  { id: "gender-bender", title: "Gender Bender" },
  { id: "genderswap", title: "Genderswap" },
  { id: "ghosts", title: "Ghosts" },
  { id: "girls-love", title: "Girls' Love" },
  { id: "gore", title: "Gore" },
  { id: "guideverse", title: "Guideverse" },
  { id: "gyaru", title: "Gyaru" },
  { id: "hair-color-change", title: "Hair Color Change" },
  { id: "harem", title: "Harem" },
  { id: "hentai", title: "Hentai" },
  { id: "heroes", title: "Heroes" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "human-nonhuman-relationship", title: "Human-Nonhuman Relationship" },
  { id: "incest", title: "Incest" },
  { id: "isekai", title: "Isekai" },
  { id: "josei", title: "Josei" },
  { id: "korea", title: "Korea" },
  { id: "korean-ambience", title: "Korean Ambience" },
  { id: "korean-bl", title: "Korean BL" },
  { id: "loli", title: "Loli" },
  { id: "long-strip", title: "Long Strip" },
  { id: "long-haired-male-character-s", title: "Long-Haired Male Character/s" },
  { id: "long-haired-male-lead", title: "Long-Haired Male Lead" },
  { id: "love-triangle-s", title: "Love Triangle/s" },
  { id: "low-fantasy", title: "Low Fantasy" },
  { id: "maduro", title: "Maduro" },
  { id: "mafia", title: "Mafia" },
  { id: "magic", title: "Magic" },
  { id: "male-protagonist", title: "Male Protagonist" },
  { id: "manga", title: "Manga" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "masculine-uke", title: "Masculine Uke" },
  { id: "mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "medical", title: "Medical" },
  { id: "military", title: "Military" },
  { id: "monster-girls", title: "Monster Girls" },
  { id: "monsters", title: "Monsters" },
  { id: "monsters-invade-earth", title: "Monsters Invade Earth" },
  { id: "murim", title: "Murim" },
  { id: "music", title: "Music" },
  { id: "mystery", title: "Mystery" },
  { id: "nameverse", title: "Nameverse" },
  { id: "ninja", title: "Ninja" },
  { id: "office-workers", title: "Office Workers" },
  { id: "oneshot", title: "Oneshot" },
  { id: "orphan-female-lead", title: "Orphan Female Lead" },
  { id: "philosophical", title: "Philosophical" },
  { id: "police", title: "Police" },
  { id: "post-apocalyptic", title: "Post-Apocalyptic" },
  { id: "psychological", title: "Psychological" },
  { id: "red-haired-male-lead", title: "Red-Haired Male Lead" },
  { id: "red-haired-seme", title: "Red-Haired Seme" },
  { id: "regression", title: "Regression" },
  { id: "reincarnation", title: "Reincarnation" },
  { id: "revenge", title: "Revenge" },
  { id: "romance", title: "Romance" },
  { id: "samurai", title: "Samurai" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-fi" },
  { id: "secret-relationship", title: "Secret Relationship" },
  { id: "seinen", title: "Seinen" },
  { id: "self-published", title: "Self-Published" },
  { id: "sexual-violence", title: "Sexual Violence" },
  { id: "shota", title: "Shota" },
  { id: "shotacon", title: "Shotacon" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shoujo-ai", title: "Shoujo Ai" },
  { id: "shounen", title: "Shounen" },
  { id: "size-difference", title: "Size Difference" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "smut", title: "Smut" },
  { id: "sports", title: "Sports" },
  { id: "superhero", title: "Superhero" },
  { id: "supernatural", title: "Supernatural" },
  { id: "survival", title: "Survival" },
  { id: "suspense", title: "Suspense" },
  { id: "thriller", title: "Thriller" },
  { id: "time-travel", title: "Time Travel" },
  { id: "tower", title: "Tower" },
  { id: "tragedy", title: "Tragedy" },
  { id: "uncensored", title: "Uncensored" },
  { id: "vampires", title: "Vampires" },
  { id: "video-games", title: "Video Games" },
  { id: "villainess", title: "Villainess" },
  { id: "violence", title: "Violence" },
  { id: "virtual-reality", title: "Virtual Reality" },
  { id: "web-comic", title: "Web Comic" },
  { id: "webtoon", title: "Webtoon" },
  { id: "wuxia", title: "Wuxia" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
  { id: "zombies", title: "Zombies" },
];
