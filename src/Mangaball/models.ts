/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DiscoverSectionType, type SortingOption } from "@paperback/types";

export type ApiImage = {
  cdn_mangadex?: string | null;
  cdn_mangaupdate?: string | null;
  cdn_mangaupdates?: string | null;
  file?: string | null;
  cover?: { path?: string } | null;
};

export type ApiTag = {
  id: string;
  name: string;
  slug?: string;
  group?: string;
};

export type ApiPerson = {
  name: string;
  roles?: string[] | null;
};

export type ApiRecentChapter = {
  id: string;
  name?: string;
  number?: number;
  lang?: string;
  created_at?: string;
};

export type ApiTitle = {
  id?: string;
  _id?: string;
  name: string;
  slug?: string;
  alternateName?: string[];
  image?: ApiImage | null;
  description?: string[] | string | null;
  originalLanguage?: string | null;
  publicationDemographic?: string | null;
  status?: string | null;
  date_published?: number | null;
  availableTranslatedLanguages?: string[];
  tags?: ApiTag[];
  author?: ApiPerson[];
  authors?: ApiPerson[];
  stats?: { chapters?: number; views?: number; followers?: number } | null;
  ratings?: { rating_average?: number; total_rating?: number } | null;
  rating?: number | null;
  views?: number;
  is18plus?: boolean | null;
  latest_chapter?: string | number | null;
  chapters_count?: number;
  recent_chapters?: ApiRecentChapter[];
};

export type ApiPagination = {
  page?: number;
  total_pages?: number;
};

export type ApiList<T> = {
  status?: string;
  data?: T[];
  pagination?: ApiPagination;
};

export type ApiChapter = {
  id: string;
  name?: string;
  number?: number;
  chapter_number?: number;
  volume?: number;
  lang?: string;
  created_at?: string;
  group_name?: string;
  group?: { name?: string } | null;
};

export type ApiChapterDetail = {
  data?: { chapter?: { pages?: string[] } };
};

export type TriState = Record<string, "included" | "excluded">;

export type MangaballMetadata = {
  page?: number;
  completed?: boolean;
  firstId?: string;
  tags?: TriState;
  status?: string;
  type?: string;
  demographic?: string;
  adultMode?: string;
  anyTag?: boolean;
};

export type Option = { id: string; title: string };

export type TagGroup = { id: string; title: string; tags: Option[] };

export const TAG_GROUPS: { id: string; title: string }[] = [
  { id: "genre", title: "Genres" },
  { id: "theme", title: "Themes" },
  { id: "format", title: "Formats" },
  { id: "content", title: "Content warnings" },
];

// The site's own sort vocabulary; everything but the title sort is descending.
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "lastupdate", label: "Latest Updated" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Top Rated" },
  { id: "created_at", label: "Recently Added" },
  { id: "name", label: "Title A-Z" },
];

export const STATUSES: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const TYPES: Option[] = [
  { id: "manga", title: "Manga (Japanese)" },
  { id: "manhwa", title: "Manhwa (Korean)" },
  { id: "manhua", title: "Manhua (Chinese)" },
  { id: "comics", title: "Comics (Western)" },
];

export const DEMOGRAPHICS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
];

export const ADULT_MODES: Option[] = [
  { id: "all", title: "All content (18+ included)" },
  { id: "no_18", title: "Safe only (no 18+)" },
  { id: "only_18", title: "18+ only" },
];

export const ORIGIN_LABELS: Record<string, string> = {
  ja: "Manga",
  jp: "Manga",
  ko: "Manhwa",
  kr: "Manhwa",
  zh: "Manhua",
  cn: "Manhua",
  "zh-hk": "Manhua",
  en: "Comics",
};

export type HomeSection = {
  id: string;
  title: string;
  type: DiscoverSectionType;
  path: string;
  query?: string;
  limit: number;
  paged: boolean;
};

// One rail per block on the home page, in the site's order; the origin tabs
// become sibling rails.
export const HOME_SECTIONS: HomeSection[] = [
  {
    id: "featured",
    title: "Featured Manga",
    type: DiscoverSectionType.featured,
    path: "title/featured",
    limit: 20,
    paged: false,
  },
  {
    id: "recommended",
    title: "Titles Recommended",
    type: DiscoverSectionType.prominentCarousel,
    path: "title/recommended",
    limit: 20,
    paged: false,
  },
  {
    id: "latest",
    title: "Latest Chapter Updates",
    type: DiscoverSectionType.chapterUpdates,
    path: "title/recently-updated",
    limit: 24,
    paged: true,
  },
  {
    id: "origin_manga",
    title: "By Origin: Manga",
    type: DiscoverSectionType.simpleCarousel,
    path: "title/by-origin",
    query: "origin=manga",
    limit: 20,
    paged: false,
  },
  {
    id: "origin_manhwa",
    title: "By Origin: Manhwa",
    type: DiscoverSectionType.simpleCarousel,
    path: "title/by-origin",
    query: "origin=manhwa",
    limit: 20,
    paged: false,
  },
  {
    id: "origin_manhua",
    title: "By Origin: Manhua",
    type: DiscoverSectionType.simpleCarousel,
    path: "title/by-origin",
    query: "origin=manhua",
    limit: 20,
    paged: false,
  },
  {
    id: "origin_comics",
    title: "By Origin: Comics",
    type: DiscoverSectionType.simpleCarousel,
    path: "title/by-origin",
    query: "origin=comics",
    limit: 20,
    paged: false,
  },
  {
    id: "recently_added",
    title: "Recently Added Titles",
    type: DiscoverSectionType.simpleCarousel,
    path: "title/recently-added",
    limit: 24,
    paged: true,
  },
  {
    id: "top_rating",
    title: "Top Rating Titles",
    type: DiscoverSectionType.simpleCarousel,
    path: "title/top-rating",
    query: "section_key=top_rating",
    limit: 20,
    paged: false,
  },
  {
    id: "ranking",
    title: "Ranking: Today",
    type: DiscoverSectionType.simpleCarousel,
    path: "title/top-views",
    query: "period=today&section_key=sidebar_ranking",
    limit: 20,
    paged: false,
  },
];

export const POPULAR_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Manhwa",
  "Manhua",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Isekai",
  "Reincarnation",
];

// Used only while /tag/get-grouped cannot be reached.
export const FALLBACK_TAGS: TagGroup[] = [
  {
    id: "genre",
    title: "Genres",
    tags: [
      { id: "685146c5f3ed681c80f257e3", title: "Action" },
      { id: "689371f0a943baf927094f03", title: "Adult" },
      { id: "685146c5f3ed681c80f257e6", title: "Adventure" },
      { id: "685148ef15e8b86aae68e573", title: "Boys' Love" },
      { id: "685146c5f3ed681c80f257e5", title: "Comedy" },
      { id: "685148da15e8b86aae68e51f", title: "Crime" },
      { id: "685148cf15e8b86aae68e4dd", title: "Drama" },
      { id: "6892a73ba943baf927094e37", title: "Ecchi" },
      { id: "685146c5f3ed681c80f257ea", title: "Fantasy" },
      { id: "685148da15e8b86aae68e524", title: "Girls' Love" },
      { id: "685148db15e8b86aae68e527", title: "Historical" },
      { id: "685148da15e8b86aae68e520", title: "Horror" },
      { id: "685146c5f3ed681c80f257e9", title: "Isekai" },
      { id: "6851490d15e8b86aae68e5d4", title: "Magical Girls" },
      { id: "68932d11a943baf927094e7b", title: "Mature" },
      { id: "6851490c15e8b86aae68e5d2", title: "Mecha" },
      { id: "6851494e15e8b86aae68e66e", title: "Medical" },
      { id: "685148d215e8b86aae68e4f4", title: "Mystery" },
      { id: "685148e215e8b86aae68e544", title: "Philosophical" },
      { id: "685148d715e8b86aae68e507", title: "Psychological" },
      { id: "685148cf15e8b86aae68e4db", title: "Romance" },
      { id: "685148cf15e8b86aae68e4da", title: "Sci-Fi" },
      { id: "689f0ab1f2e66744c6091524", title: "Shounen Ai" },
      { id: "685148d015e8b86aae68e4e3", title: "Slice of Life" },
      { id: "689371f2a943baf927094f04", title: "Smut" },
      { id: "685148f515e8b86aae68e588", title: "Sports" },
      { id: "6851492915e8b86aae68e61c", title: "Superhero" },
      { id: "685148d915e8b86aae68e51e", title: "Thriller" },
      { id: "685148db15e8b86aae68e529", title: "Tragedy" },
      { id: "6851490715e8b86aae68e5c3", title: "Wuxia" },
      { id: "68932f68a943baf927094eaa", title: "Yaoi" },
      { id: "6896a885a943baf927094f66", title: "Yuri" },
    ],
  },
  {
    id: "theme",
    title: "Themes",
    tags: [
      { id: "6851490d15e8b86aae68e5d5", title: "Aliens" },
      { id: "685148e715e8b86aae68e54b", title: "Animals" },
      { id: "685148d215e8b86aae68e4f8", title: "Cooking" },
      { id: "685148df15e8b86aae68e534", title: "Crossdressing" },
      { id: "685148d915e8b86aae68e519", title: "Delinquents" },
      { id: "685146c5f3ed681c80f257e4", title: "Demons" },
      { id: "685148d715e8b86aae68e505", title: "Genderswap" },
      { id: "685148d615e8b86aae68e501", title: "Ghosts" },
      { id: "685146c5f3ed681c80f257e8", title: "Harem" },
      { id: "685148f215e8b86aae68e584", title: "Incest" },
      { id: "685148d915e8b86aae68e518", title: "Mafia" },
      { id: "685148d715e8b86aae68e509", title: "Magic" },
      { id: "6851490615e8b86aae68e5c2", title: "Martial Arts" },
      { id: "685148e215e8b86aae68e541", title: "Military" },
      { id: "685148db15e8b86aae68e52c", title: "Monster Girls" },
      { id: "685146c5f3ed681c80f257e2", title: "Monsters" },
      { id: "685148d015e8b86aae68e4e4", title: "Music" },
      { id: "685148d715e8b86aae68e508", title: "Ninja" },
      { id: "685148d315e8b86aae68e4fd", title: "Office Workers" },
      { id: "6851498815e8b86aae68e714", title: "Police" },
      { id: "685148e215e8b86aae68e540", title: "Post-Apocalyptic" },
      { id: "685146c5f3ed681c80f257e1", title: "Reincarnation" },
      { id: "685148df15e8b86aae68e533", title: "Reverse Harem" },
      { id: "6851490415e8b86aae68e5b9", title: "Samurai" },
      { id: "685148d015e8b86aae68e4e7", title: "School Life" },
      { id: "685148db15e8b86aae68e528", title: "Supernatural" },
      { id: "685148cf15e8b86aae68e4dc", title: "Survival" },
      { id: "6851490c15e8b86aae68e5d1", title: "Time Travel" },
      { id: "685148f915e8b86aae68e597", title: "Vampires" },
      { id: "685148e115e8b86aae68e53c", title: "Video Games" },
      { id: "6851492115e8b86aae68e602", title: "Villainess" },
      { id: "68514a1115e8b86aae68e83e", title: "Virtual Reality" },
      { id: "6851490c15e8b86aae68e5d3", title: "Zombies" },
    ],
  },
  {
    id: "format",
    title: "Formats",
    tags: [
      { id: "685148d115e8b86aae68e4ec", title: "4-Koma" },
      { id: "685148cf15e8b86aae68e4de", title: "Adaptation" },
      { id: "685148e915e8b86aae68e558", title: "Anthology" },
      { id: "685148fe15e8b86aae68e5a7", title: "Award Winning" },
      { id: "6851490e15e8b86aae68e5da", title: "Doujinshi" },
      { id: "6851498215e8b86aae68e704", title: "Fan Colored" },
      { id: "685148d615e8b86aae68e502", title: "Full Color" },
      { id: "685148d915e8b86aae68e517", title: "Long Strip" },
      { id: "6851493515e8b86aae68e64a", title: "Official Colored" },
      { id: "685148eb15e8b86aae68e56c", title: "Oneshot" },
      { id: "6851492e15e8b86aae68e633", title: "Self-Published" },
      { id: "685148d715e8b86aae68e50d", title: "Web Comic" },
    ],
  },
  {
    id: "content",
    title: "Content warnings",
    tags: [
      { id: "685148d115e8b86aae68e4f3", title: "Gore" },
      { id: "685146c5f3ed681c80f257e7", title: "Sexual Violence" },
    ],
  },
];
