/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption, Tag } from "@paperback/types";

/** Paging and filter state carried between pages of results. */
export type MangaHubSearchMetadata = {
  offset?: number;
  page?: number;
  sort?: string;
  genres?: string[];
  hideNSFW?: boolean;
  hideYaoi?: boolean;
  hideLicensed?: boolean;
  completed?: boolean;
};

/**
 * Records as the GraphQL schema declares them.
 *
 * Two fields are delimited strings rather than lists: `genres` is comma
 * separated and `alternativeTitle` is semicolon separated.
 */
export type ApiManga = {
  id: number;
  title: string;
  slug: string;
  mainSlug?: string | null;
  alternativeTitle?: string | null;
  status?: string | null;
  image?: string | null;
  latestChapter?: number | null;
  genres?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  rank?: number | null;
  isWebtoon?: boolean | null;
  isYaoi?: boolean | null;
  isPorn?: boolean | null;
  isSoftPorn?: boolean | null;
  isSafe?: boolean | null;
  isLicensed?: boolean | null;
  createdDate?: string | null;
  updatedDate?: string | null;
  chapters?: ApiChapter[] | null;
};

export type ApiChapter = {
  id: number;
  number: number;
  title?: string | null;
  slug?: string | null;
  date?: string | null;
};

/** The reader payload; `pages` is a JSON string, not an object. */
export type ApiChapterFull = ApiChapter & {
  mangaID?: number | null;
  pages?: string | null;
  s?: string | null;
};

export type ApiGenre = {
  id: number;
  slug: string;
  title: string;
  count?: number | null;
  group?: string | null;
};

export type ApiSearch = { rows?: ApiManga[] | null; count?: number | null };

/** The source the site itself queries; the schema exposes others it does not use. */
export const SOURCE = "m01";

export const API_URL = "https://api.mghcdn.com/graphql";
export const DOMAIN = "https://mangahub.io";
export const COVER_CDN = "https://thumb.mghcdn.com";
export const PAGE_CDN = "https://imgx.mghcdn.com";

/**
 * Stand-in cover for titles the API has no artwork for.
 *
 * The app rejects an empty string with "Invalid URL" and, because covers are
 * converted as an array, one missing cover fails the whole rail rather than a
 * single card. This is a real URL on the cover host that holds no image, so
 * the app falls through to its own placeholder rather than being handed
 * substitute artwork.
 */
export const FALLBACK_COVER = `${COVER_CDN}/no-cover.jpg`;

/**
 * The schema's own `SearchMod` values, all verified to return distinct rows.
 *
 * `Status` is deliberately absent: the schema accepts it but the resolver
 * ignores it, returning the same 77,973 rows with mixed statuses whichever
 * value is passed, so offering it would be a filter that does nothing.
 */
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "POPULAR", label: "Popular" },
  { id: "LATEST", label: "Latest" },
  { id: "NEW", label: "Newest" },
  { id: "COMPLETED", label: "Completed" },
  { id: "ALPHABET", label: "A – Z" },
];

export const DEFAULT_SORT = "POPULAR";

export const PAGE_SIZE = 30;
/** `latestPopular` takes no paging arguments and answers with a fixed 20. */
export const LATEST_PAGE_SIZE = 30;

export const GENRE_CACHE_TTL = 24 * 60 * 60 * 1000;
export const GENRE_STATE_KEY = "mangahub.genres";
/** Bumped when older builds cached a token the site never issued. */
export const ACCESS_STATE_KEY = "mangahub.access2";

export const POPULAR_UPDATES_SECTION_ID = "popular-updates";
export const LATEST_SECTION_ID = "latest-updates";
export const GENRES_SECTION_ID = "genres";

/** Rails backed by a `search` sort, all rendered the same way. */
export const SORTED_SECTIONS: { id: string; title: string; mod: string }[] = [
  { id: "popular", title: "Popular", mod: "POPULAR" },
  { id: "new", title: "New", mod: "NEW" },
  { id: "completed", title: "Completed", mod: "COMPLETED" },
];

export const STATUS_LABELS: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  hiatus: "Hiatus",
};

/**
 * Fallback genre list, captured from the API's own `genres` query.
 *
 * The live list is fetched and cached at runtime; this is only what the filter
 * falls back to when that request fails, and the name-to-slug map the detail
 * parser uses to build valid tag ids.
 */
export const GENRES: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "adult", title: "Adult" },
  { id: "drama", title: "Drama" },
  { id: "historical", title: "Historical" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "romance", title: "Romance" },
  { id: "ecchi", title: "Ecchi" },
  { id: "supernatural", title: "Supernatural" },
  { id: "webtoons", title: "Webtoons" },
  { id: "manhwa", title: "Manhwa" },
  { id: "fantasy", title: "Fantasy" },
  { id: "harem", title: "Harem" },
  { id: "shounen", title: "Shounen" },
  { id: "manhua", title: "Manhua" },
  { id: "mature", title: "Mature" },
  { id: "seinen", title: "Seinen" },
  { id: "sports", title: "Sports" },
  { id: "school-life", title: "School Life" },
  { id: "smut", title: "Smut" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "shounen-ai", title: "Shounen ai" },
  { id: "slice-of-life", title: "Slice of life" },
  { id: "shoujo-ai", title: "Shoujo ai" },
  { id: "cooking", title: "Cooking" },
  { id: "horror", title: "Horror" },
  { id: "tragedy", title: "Tragedy" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "yuri", title: "Yuri" },
  { id: "yaoi", title: "Yaoi" },
  { id: "shoujo", title: "Shoujo" },
  { id: "gender-bender", title: "Gender bender" },
  { id: "josei", title: "Josei" },
  { id: "mecha", title: "Mecha" },
  { id: "medical", title: "Medical" },
  { id: "magic", title: "Magic" },
  { id: "4-koma", title: "4-Koma" },
  { id: "music", title: "Music" },
  { id: "webtoon", title: "Webtoon" },
  { id: "isekai", title: "Isekai" },
  { id: "game", title: "Game" },
  { id: "award-winning", title: "Award Winning" },
  { id: "oneshot", title: "Oneshot" },
  { id: "demons", title: "Demons" },
  { id: "military", title: "Military" },
  { id: "police", title: "Police" },
  { id: "super-power", title: "Super Power" },
  { id: "food", title: "Food" },
  { id: "kids", title: "Kids" },
  { id: "magical-girls", title: "Magical Girls" },
  { id: "wuxia", title: "Wuxia" },
  { id: "superhero", title: "Superhero" },
  { id: "thriller", title: "Thriller" },
  { id: "crime", title: "Crime" },
  { id: "philosophical", title: "Philosophical" },
  { id: "adaptation", title: "Adaptation" },
  { id: "full-color", title: "Full Color" },
  { id: "crossdressing", title: "Crossdressing" },
  { id: "reincarnation", title: "Reincarnation" },
  { id: "manga", title: "Manga" },
  { id: "cartoon", title: "Cartoon" },
  { id: "survival", title: "Survival" },
  { id: "comic", title: "Comic" },
  { id: "english", title: "English" },
  { id: "harlequin", title: "Harlequin" },
  { id: "time-travel", title: "Time Travel" },
  { id: "traditional-games", title: "Traditional Games" },
  { id: "reverse-harem", title: "Reverse Harem" },
  { id: "animals", title: "Animals" },
  { id: "aliens", title: "Aliens" },
  { id: "loli", title: "Loli" },
  { id: "video-games", title: "Video Games" },
  { id: "monsters", title: "Monsters" },
  { id: "office-workers", title: "Office Workers" },
  { id: "system", title: "System" },
  { id: "villainess", title: "Villainess" },
  { id: "zombies", title: "Zombies" },
  { id: "vampires", title: "Vampires" },
  { id: "violence", title: "Violence" },
  { id: "monster-girls", title: "Monster Girls" },
  { id: "anthology", title: "Anthology" },
  { id: "ghosts", title: "Ghosts" },
  { id: "delinquents", title: "Delinquents" },
  { id: "post-apocalyptic", title: "Post-Apocalyptic" },
  { id: "xianxia", title: "Xianxia" },
  { id: "xuanhuan", title: "Xuanhuan" },
  { id: "r-18", title: "R-18" },
  { id: "cultivation", title: "Cultivation" },
  { id: "rebirth", title: "Rebirth" },
  { id: "gore", title: "Gore" },
  { id: "russian", title: "Russian" },
  { id: "samurai", title: "Samurai" },
  { id: "ninja", title: "Ninja" },
  { id: "revenge", title: "Revenge" },
  { id: "cheat-systems", title: "Cheat Systems" },
  { id: "dungeons", title: "Dungeons" },
  { id: "overpowered", title: "Overpowered" },
  { id: "royal-family", title: "Royal family" },
  { id: "long-strip", title: "Long Strip" },
  { id: "shota", title: "Shota" },
  { id: "web-comic", title: "Web Comic" },
  { id: "virtual-reality", title: "Virtual Reality" },
  { id: "genderswap", title: "Genderswap" },
  { id: "suggestive", title: "Suggestive" },
  { id: "mafia", title: "Mafia" },
  { id: "murim", title: "Murim" },
  { id: "returner", title: "Returner" },
  { id: "official-colored", title: "Official colored" },
  { id: "sexual-violence", title: "Sexual Violence" },
  { id: "gyaru", title: "Gyaru" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
  { id: "blood", title: "Blood" },
  { id: "fighting", title: "Fighting" },
  { id: "girls-love", title: "Girls' love" },
  { id: "regression", title: "Regression" },
  { id: "tower-climbing", title: "Tower Climbing" },
  { id: "fan-colored", title: "Fan Colored" },
  { id: "self-published", title: "Self-Published" },
  { id: "safe", title: "Safe" },
  { id: "boys-love", title: "Boys' Love" },
  { id: "incest", title: "Incest" },
  { id: "weak-to-strong", title: "Weak-to-Strong" },
  { id: "ruthless-protagonist", title: "Ruthless Protagonist" },
  { id: "smart-mc", title: "Smart MC" },
  { id: "hunters", title: "Hunters" },
  { id: "mahjong", title: "Mahjong" },
  { id: "hentai", title: "Hentai" },
  { id: "maga", title: "Maga" },
];
