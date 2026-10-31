/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const DOMAIN = "https://coffeemanga.net";
export const HOST = "coffeemanga.net";

export const seriesUrl = (slug: string): string => `${DOMAIN}/manga/${slug}/`;

export const chapterUrl = (slug: string, chapterSlug: string): string =>
  `${DOMAIN}/manga/${slug}/${chapterSlug}/`;

// 20 rows per page, newest first; the HTML series page carries page 1 as well.
export const chaptersJsonUrl = (slug: string, page: number): string =>
  `${DOMAIN}/manga/${slug}/chapters/${page}.json`;

// The library ignores ?page=; only the /page/N/ path form pages.
export const libraryUrl = (page: number, params: Record<string, string>): string => {
  const query = Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `${DOMAIN}/manga/${page > 1 ? `page/${page}/` : ""}${query ? `?${query}` : ""}`;
};

export const searchUrl = (title: string, page: number): string =>
  `${DOMAIN}/search?q=${encodeURIComponent(title)}${page > 1 ? `&page=${page}` : ""}`;

export const CHAPTER_BATCH = 4;

export type CoffeeSearchMetadata = {
  page?: number;
  completed?: boolean;
  genre?: string;
  type?: string;
  status?: string;
  section?: string;
};

// `orden` values the library accepts; /search ignores ordering entirely.
export const SORTS: { id: string; label: string }[] = [
  { id: "reciente", label: "Recently updated" },
  { id: "nuevas", label: "New series" },
  { id: "vistas", label: "Most viewed" },
  { id: "valoradas", label: "Top rated" },
  { id: "seguidas", label: "Most followed" },
  { id: "alfabetico", label: "A-Z" },
];

export const TYPES: { id: string; title: string }[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "webtoon", title: "Webtoon" },
  { id: "novel", title: "Novel" },
];

export const STATUSES: { id: string; title: string }[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "On hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

// The "BL" section exists too but the site only serves it to signed-in users.
export const SECTIONS: { id: string; title: string }[] = [
  { id: "shoujo", title: "Shoujo" },
  { id: "shounen", title: "Shounen" },
];

export type RowSource =
  | { kind: "heroes" }
  | { kind: "home"; code: string }
  | { kind: "library"; order: string }
  | { kind: "genres" };

export type Row = {
  id: string;
  title: string;
  type: "featured" | "simpleCarousel" | "prominentCarousel" | "chapterUpdates" | "genres";
  source: RowSource;
};

// Home page rails in the site's own order; the two paged grids and the extra
// library orderings page through /manga/page/N/.
export const ROWS: Row[] = [
  { id: "featured", title: "Featured", type: "featured", source: { kind: "heroes" } },
  {
    id: "latest",
    title: "Latest updates",
    type: "chapterUpdates",
    source: { kind: "library", order: "reciente" },
  },
  {
    id: "reading_now",
    title: "Most read right now",
    type: "simpleCarousel",
    source: { kind: "home", code: "reading_now" },
  },
  {
    id: "trending",
    title: "Popular this week",
    type: "prominentCarousel",
    source: { kind: "home", code: "trending" },
  },
  {
    id: "newest",
    title: "Newly added",
    type: "simpleCarousel",
    source: { kind: "library", order: "nuevas" },
  },
  {
    id: "most_viewed",
    title: "Most viewed",
    type: "simpleCarousel",
    source: { kind: "library", order: "vistas" },
  },
  {
    id: "top_rated",
    title: "Top rated",
    type: "simpleCarousel",
    source: { kind: "library", order: "valoradas" },
  },
  {
    id: "most_followed",
    title: "Most followed",
    type: "simpleCarousel",
    source: { kind: "library", order: "seguidas" },
  },
  { id: "genres", title: "Genres", type: "genres", source: { kind: "genres" } },
];

// Shapes of the Inertia page props the site renders into <script data-page>.
export type ChapterRef = {
  slug: string;
  label: string;
  url?: string;
  published_at?: string | null;
  published_label?: string;
  locked?: boolean;
  number?: string | number | null;
  title?: string | null;
};

export type Card = {
  slug: string;
  title: string;
  type?: string;
  status?: string;
  cover?: string;
  cover_srcset?: string;
  cover_lg?: string;
  cover_canonical?: string;
  chapters?: ChapterRef[];
  is_adult?: boolean;
};

export type Taxon = { slug: string; name: string; count?: number };

export type Series = Card & {
  alt_titles?: string[];
  synopsis?: string | null;
  release_year?: number | null;
  genres?: Taxon[];
  tags?: Taxon[];
  authors?: (Taxon | string)[];
  artists?: (Taxon | string)[];
  chapter_count?: number;
};

export type Pagination = { page: number; last: number; total?: number };

export type ChapterPage = { items: ChapterRef[]; page: number; last: number; total?: number };

export type HomeProps = {
  heroes?: Card[];
  sections?: { code: string; items?: Card[] }[];
  genres?: Taxon[];
};

export type ListingProps = {
  series?: Card[];
  pagination?: Pagination;
  filters?: { genres?: Taxon[] };
};

export type SeriesProps = {
  series?: Series;
  chapters?: ChapterRef[];
  chapters_pagination?: Pagination;
  rating?: { avg?: number | null };
};

export type ReaderProps = {
  series?: { slug: string };
  chapter?: { id: number; slug: string; url?: string };
  reader?: { x?: string };
  total?: number;
};

export type InertiaPage<P> = { component: string; url: string; props: P };
