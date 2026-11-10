/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface Genre {
  id: number;
  name: string;
}

export interface QueryPost {
  id: number;
  slug: string;
  postTitle: string;
  featuredImage: string;
  seriesType: string;
  seriesStatus: string;
  genres?: Genre[];
}

export interface QueryResponse {
  posts: QueryPost[];
  totalCount: number;
}

export interface PostResponse {
  post: QueryPost & {
    postContent: string;
    alternativeTitles: string;
    author: string;
    artist: string;
    isNovel: boolean;
    averageRating?: number;
    totalViews?: number;
    _count?: { chapters?: number };
  };
  totalChapterCount: number;
}

export interface ApiChapter {
  id: number;
  slug: string;
  number: number;
  title: string | null;
  createdAt: string;
  price: number;
  isLocked?: boolean;
  isAccessible?: boolean;
  isPermanentlyLocked?: boolean;
}

export interface ChaptersResponse {
  post: { chapters: ApiChapter[] };
}

export interface ChapterResponse {
  chapter: ApiChapter & {
    content: string | null;
    images: { id: number; url: string }[];
    mangaPost?: { isNovel?: boolean; slug?: string };
  };
}

export type VComicsFilters = {
  genreIds?: string[];
  seriesType?: string;
  seriesStatus?: string;
};

export type VComicsMetadata = VComicsFilters & {
  page?: number;
};

export const PER_PAGE = 27;

// The API hands back some media urls with a doubled slash after the host.
export function normaliseUrl(url: string): string {
  return url.replace(/([^:])\/{2,}/g, "$1/");
}
