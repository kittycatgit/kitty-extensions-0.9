/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface ApiListItem {
  id: number;
  title: string;
  slug: string;
  cover: string;
  status?: string;
  type?: string;
  rate?: number;
  chapter_count?: number;
  recent_views?: number;
  genres?: string[];
}

export interface ApiDetail extends ApiListItem {
  description?: string;
  author?: string;
  artist?: string;
  alt_titles?: string;
  studio?: string;
  release_year?: string | number;
  chapters?: ApiChapter[];
}

export interface ApiChapter {
  id: number;
  title: string;
  chapter_number: number;
  is_locked?: boolean;
  coins?: number;
  expired?: boolean;
  created_at?: string;
}

export interface ApiChapterDetail extends ApiChapter {
  content?: string[];
}

export type RenaFilters = {
  genre?: string;
  status?: string;
  type?: string;
};

export type RenaMetadata = RenaFilters & {
  offset?: number;
};

// One response holds at most fifty titles; `offset` is the only way further in.
export const BATCH = 50;

export const STATUSES = ["Ongoing", "Completed", "Hiatus", "Dropped"];
export const TYPES = ["Manhwa", "Manhua", "Manga", "Webtoon"];
