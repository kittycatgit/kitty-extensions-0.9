/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://onisaga.com";
export const MEDIA_DOMAIN = "https://media.onisaga.com";

export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// Chapter editions are per language; the list is fetched in English only.
export const LANG = "en";

// A series page lists 20 chapters; `chapters=all` pages 100 at a time by cursor.
export const CHAPTER_PAGE_LIMIT = 40;

// Every rail asked for at once earns a challenge, so site HTML is paced.
export const HTML_GAP_MS = 700;

export function coverUrl(slug: string, width = 480): string {
  return `${MEDIA_DOMAIN}/api/covers/${slug}?w=${width}`;
}

export type Option = { id: string; title: string };

export type OniSagaMetadata = {
  cursor?: string;
  completed?: boolean;
  genres?: string[];
  themes?: string[];
  statuses?: string[];
  origins?: string[];
  demographics?: string[];
  forms?: string[];
};

export type Listing = {
  items: import("@paperback/types").SearchResultItem[];
  cursor?: string;
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "updated", label: "Recently Updated" },
  { id: "new", label: "Recently Added" },
  { id: "published", label: "Newly Published" },
  { id: "title", label: "Title A-Z" },
];

export const DEFAULT_SORT = "updated";

export const STATUSES: Option[] = [
  { id: "releasing", title: "Releasing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const ORIGINS: Option[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "comic", title: "Comic" },
  { id: "oel", title: "OEL" },
  { id: "other_asian", title: "Other Asian" },
  { id: "other", title: "Other" },
];

export const DEMOGRAPHICS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "kodomo", title: "Kodomo" },
];

export const FORMS: Option[] = [{ id: "oneshot", title: "Oneshot" }];

// Themes are not listed on the browse form; these are the ones the home page links.
export const THEMES: Option[] = [
  { id: "school-life", title: "School Life" },
  { id: "magic", title: "Magic" },
  { id: "reincarnation", title: "Reincarnation" },
  { id: "military", title: "Military" },
  { id: "heterosexual", title: "Heterosexual" },
  { id: "animals", title: "Animals" },
  { id: "harem-subtext", title: "Harem Subtext" },
];

export const STATUS_LABELS: Record<string, string> = {
  publishing: "Ongoing",
  releasing: "Ongoing",
  ongoing: "Ongoing",
  completed: "Completed",
  finished: "Completed",
  hiatus: "Hiatus",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  dropped: "Cancelled",
};

export const GENRE_STATE_KEY = "onisaga.genres";
export const GENRE_CACHE_TTL = 24 * 60 * 60 * 1000;

// `path` is relative to the site; cursor-paged rails read their next link.
export const HOME_SECTIONS: { id: string; title: string; path: string }[] = [
  { id: "spotlight", title: "Spotlight", path: "/" },
  { id: "updates", title: "Latest Updates", path: "/updates" },
  { id: "trending", title: "Trending This Week", path: "/" },
  { id: "new", title: "New Series", path: "/browse?medium=comic&sort=new" },
  { id: "published", title: "Newly Published", path: "/browse?medium=comic&sort=published" },
  { id: "finished", title: "Finished Series", path: "/browse?medium=comic&status=completed" },
];

export const GENRES_SECTION_ID = "genres";
