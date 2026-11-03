/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://www.divinedaolibrary.com";

export const PAGE_SIZE = 10;

export type Term = { id: string; slug: string; name: string };

/** A large story card as rendered on /stories, collections and search results. */
export type StoryCard = {
  slug: string;
  title: string;
  cover: string;
  author?: string;
  blurb?: string;
  status?: string;
  rating?: string;
  chapters?: string;
  words?: string;
  updated?: string;
  genres: string[];
};

/** A small home-page card: the story plus its newest chapter. */
export type UpdateCard = {
  slug: string;
  title: string;
  cover: string;
  author?: string;
  blurb?: string;
  latestChapter?: string;
  latestDate?: string;
};

/** A chapter card from /latest-chapters. */
export type ChapterCard = {
  storySlug: string;
  chapterSlug: string;
  title: string;
  cover: string;
  storyTitle?: string;
  storyStatus?: string;
};

export type ChapterEntry = {
  slug: string;
  postId: string;
  title: string;
  group?: string;
  date?: Date;
};

export type Story = {
  id: string;
  slug: string;
  title: string;
  cover: string;
  translator?: string;
  originalAuthor?: string;
  altTitles: string[];
  synopsis: string;
  status?: string;
  rating?: string;
  words?: string;
  published?: string;
  nextChapter?: string;
  chapterCount?: number;
  genres: Term[];
  tags: Term[];
  chapters: ChapterEntry[];
};

export type TriState = Record<string, "included" | "excluded">;

export type SearchMetadata = {
  page?: number;
  completed?: boolean;
  genres?: TriState;
  rating?: string;
  status?: string;
  sentence?: boolean;
};

export const SORTS: SortingOption[] = [
  { id: "modified", label: "Updated" },
  { id: "date", label: "Published" },
  { id: "title", label: "Title" },
  { id: "comment_count", label: "Comments" },
  { id: "words", label: "Words" },
];

// Values are case-sensitive on the site.
export const RATINGS = ["Everyone", "Teen", "Mature", "Adult"].map((id) => ({ id, title: id }));

export const STATUSES = ["Ongoing", "Completed", "Oneshot", "Hiatus", "Canceled"].map((id) => ({
  id,
  title: id,
}));

export type Rail =
  | { id: "latest"; title: string; kind: "home" }
  | { id: "latest-chapters"; title: string; kind: "chapters" }
  | { id: string; title: string; kind: "collection"; slug: string }
  | { id: string; title: string; kind: "stories"; orderby: string }
  | { id: "genres"; title: string; kind: "genres" };

export const RAILS: Rail[] = [
  { id: "latest", title: "Latest Update", kind: "home" },
  { id: "latest-chapters", title: "Latest Chapters", kind: "chapters" },
  { id: "ongoing", title: "Ongoing", kind: "collection", slug: "ongoing" },
  { id: "completed", title: "Completed", kind: "collection", slug: "completed" },
  { id: "dropped", title: "Dropped", kind: "collection", slug: "dropped" },
  { id: "longest", title: "Longest", kind: "stories", orderby: "words" },
  { id: "newest", title: "Newest", kind: "stories", orderby: "date" },
  { id: "discussed", title: "Most Discussed", kind: "stories", orderby: "comment_count" },
  { id: "genres", title: "Genres", kind: "genres" },
];
