/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://coffeemanga.net";

export const seriesUrl = (slug: string): string => `${DOMAIN}/manga/${slug}/`;

export const chapterUrl = (slug: string, chapterSlug: string): string =>
  `${DOMAIN}/manga/${slug}/${chapterSlug}/`;

export const chaptersUrl = (slug: string): string => `${DOMAIN}/manga/${slug}/ajax/chapters/`;

export const genreUrl = (genre: string, page: number, sort?: string): string =>
  `${DOMAIN}/manga-genre/${genre}/page/${page}/${sort ? `?m_orderby=${sort}` : ""}`;

export const browseUrl = (page: number, sort: string): string =>
  `${DOMAIN}/manga/page/${page}/?m_orderby=${sort}`;

export const searchUrl = (title: string, page: number): string =>
  `${DOMAIN}/page/${page}/?s=${encodeURIComponent(title)}&post_type=wp-manga`;

export type CoffeeSearchMetadata = {
  page?: number;
  completed?: boolean;
  genre?: string;
  seen?: string[];
};

// m_orderby is honoured on the directory and genre pages but ignored on ?s=
// searches, where the site always answers in relevance order.
export const SORTS: { id: string; label: string }[] = [
  { id: "views", label: "Most read" },
  { id: "trending", label: "Popular today" },
  { id: "latest", label: "Latest updates" },
  { id: "new-manga", label: "New series" },
  { id: "rating", label: "Rating" },
  { id: "alphabet", label: "A-Z" },
];

// Titles and orderings taken from the site's own home page rails and the
// "View all" link each one carries.
export const ROWS: { id: string; title: string; ordering: string }[] = [
  { id: "popular_today", title: "Popular today", ordering: "trending" },
  { id: "latest_updates", title: "Latest updates", ordering: "latest" },
  { id: "new_series", title: "New Series", ordering: "new-manga" },
  { id: "most_read", title: "Most read", ordering: "views" },
];

export const FEATURED_ROW = { id: "featured", title: "Featured" };

export const SEEN_LIMIT = 360;
