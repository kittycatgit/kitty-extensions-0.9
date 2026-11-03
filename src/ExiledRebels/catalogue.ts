/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { ExiledRebelsApi } from "./api";
import {
  ADDIS_ORIGINALS_CATEGORY,
  EXTRA_PAGE_SLUGS,
  genreId,
  NON_SERIES_CATEGORIES,
  NOVEL_PAGE_PARENTS,
  PAGE_SLUG_OVERRIDES,
  PLACEHOLDER_COVER,
  REST_PAGE_SIZE,
  type Series,
  type WpCategory,
  type WpPage,
  type WpPost,
} from "./models";
import { decodeEntities, isEndTitle, parsePageMeta } from "./parsers";

export type Genre = { id: string; title: string; count: number };

export type Catalogue = {
  series: Series[];
  bySlug: Map<string, Series>;
  byPageSlug: Map<string, Series>;
  byCategory: Map<number, Series>;
  categories: Map<number, WpCategory>;
  genres: Genre[];
};

const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORY_FIELDS = "id,name,slug,parent,count";
// With page bodies included the API falls over above fifty rows per call. The
// bodies stay in the build: genres, status, summary and TOC counts that search
// and the rails filter on only exist in that HTML.
const PAGE_LIST_SIZE = 50;
const PAGE_FIELDS =
  "id,slug,parent,date_gmt,modified_gmt,title,content,featured_media,_links,_embedded";
export const POST_FIELDS = "id,slug,date_gmt,title,categories,jetpack_featured_media_url";

// A few MB of page HTML: far too big for setState, so it lives here.
let cache: { at: number; value: Catalogue } | undefined;
let inflight: Promise<Catalogue> | undefined;

function normalise(text: string): string {
  return decodeEntities(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function gmtDate(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const time = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function seriesOfPost(post: WpPost, byCategory: Map<number, Series>): Series | undefined {
  for (const id of post.categories) {
    const series = byCategory.get(id);
    if (series) {
      return series;
    }
  }
  return undefined;
}

function titleCase(genre: string): string {
  return genre.charAt(0).toUpperCase() + genre.slice(1);
}

async function build(api: ExiledRebelsApi): Promise<Catalogue> {
  const categoryRows = await api.all<WpCategory>(
    "categories",
    `per_page=${REST_PAGE_SIZE}&_fields=${CATEGORY_FIELDS}`,
  );
  const categories = new Map(categoryRows.map((row) => [row.id, row]));

  const pageRows: WpPage[] = [];
  for (const parent of NOVEL_PAGE_PARENTS) {
    pageRows.push(
      ...(await api.all<WpPage>(
        "pages",
        `parent=${parent}&per_page=${PAGE_LIST_SIZE}&_fields=${PAGE_FIELDS}&_embed=wp:featuredmedia`,
      )),
    );
  }
  pageRows.push(
    ...(
      await api.list<WpPage[]>(
        "pages",
        `slug=${EXTRA_PAGE_SLUGS.join(",")}&_fields=${PAGE_FIELDS}&_embed=wp:featuredmedia`,
      )
    ).body,
  );

  const latest = (
    await api.list<WpPost[]>("posts", `per_page=${REST_PAGE_SIZE}&_fields=${POST_FIELDS}`)
  ).body;

  const pagesBySlug = new Map(pageRows.map((page) => [page.slug, page]));
  const pagesByName = new Map<string, WpPage>();
  for (const page of pageRows) {
    pagesByName.set(normalise(page.title.rendered), page);
  }

  const children = new Map<number, WpCategory[]>();
  for (const row of categoryRows) {
    const siblings = children.get(row.parent) ?? [];
    siblings.push(row);
    children.set(row.parent, siblings);
  }

  const seriesCategories = categoryRows.filter(
    (row) =>
      (row.parent === 0 && !NON_SERIES_CATEGORIES.has(row.id)) ||
      row.parent === ADDIS_ORIGINALS_CATEGORY,
  );

  const series: Series[] = [];
  const byCategory = new Map<number, Series>();

  for (const category of seriesCategories) {
    const pageSlug =
      PAGE_SLUG_OVERRIDES[category.slug] ??
      (pagesBySlug.has(category.slug)
        ? category.slug
        : pagesByName.get(normalise(category.name))?.slug);
    const page = pageSlug ? pagesBySlug.get(pageSlug) : undefined;

    if (!page && category.count === 0) {
      continue;
    }

    const meta = page ? parsePageMeta(page) : undefined;
    const child = (children.get(category.id) ?? []).find((row) => /chapters$/i.test(row.slug));
    const abbreviation = child
      ? decodeEntities(child.name)
          .replace(/\s*chapters\s*$/i, "")
          .trim()
      : undefined;
    const featured = page?._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
    const completed =
      /complete|finished/i.test(meta?.translationStatus ?? "") || isEndTitle(meta?.lastTocTitle);
    const genres = meta?.genres ?? [];

    const entry: Series = {
      id: category.slug,
      categoryId: category.id,
      title: page ? decodeEntities(page.title.rendered) : decodeEntities(category.name),
      ...(abbreviation && abbreviation.toLowerCase() !== "re" ? { abbreviation } : {}),
      ...(page ? { pageSlug: page.slug } : {}),
      addedAt: gmtDate(page?.date_gmt),
      updatedAt: gmtDate(page?.modified_gmt),
      chapterCount: meta && meta.tocCount > 0 ? meta.tocCount : category.count,
      status: completed ? "completed" : "ongoing",
      cover: featured ?? meta?.cover ?? PLACEHOLDER_COVER,
      genres,
      genreIds: genres.map(genreId),
      ...(meta?.author ? { author: meta.author } : {}),
      ...(meta?.translator ? { translator: meta.translator } : {}),
      ...(meta?.editor ? { editor: meta.editor } : {}),
      ...(meta?.year ? { year: meta.year } : {}),
      ...(meta?.originStatus ? { originStatus: meta.originStatus } : {}),
      summary: meta?.summary ?? "",
    };

    series.push(entry);
    byCategory.set(category.id, entry);
  }

  // The newest hundred posts give exact update times and a cover for series
  // whose page has none (chapters carry the featured image).
  for (const post of latest) {
    const entry = seriesOfPost(post, byCategory);
    if (!entry) {
      continue;
    }
    const date = gmtDate(post.date_gmt);
    if (!entry.latestChapter) {
      entry.latestChapter = { slug: post.slug, title: decodeEntities(post.title.rendered), date };
      entry.updatedAt = Math.max(entry.updatedAt, date);
    }
    if (entry.cover === PLACEHOLDER_COVER && post.jetpack_featured_media_url) {
      entry.cover = post.jetpack_featured_media_url;
    }
  }

  // Pages without any image: the newest posts of those series carry one.
  const uncovered = series.filter((entry) => entry.cover === PLACEHOLDER_COVER);
  if (uncovered.length > 0) {
    const { body } = await api.list<WpPost[]>(
      "posts",
      `categories=${uncovered.map((entry) => entry.categoryId).join(",")}&per_page=${REST_PAGE_SIZE}&_fields=${POST_FIELDS}`,
    );
    for (const post of body) {
      const entry = seriesOfPost(post, byCategory);
      if (entry && entry.cover === PLACEHOLDER_COVER && post.jetpack_featured_media_url) {
        entry.cover = post.jetpack_featured_media_url;
      }
    }
    // That one call favours the busiest series; the rest take a call each.
    for (const entry of uncovered.filter((row) => row.cover === PLACEHOLDER_COVER)) {
      const newest = (
        await api.list<WpPost[]>(
          "posts",
          `categories=${entry.categoryId}&per_page=1&_fields=${POST_FIELDS}`,
        )
      ).body[0];
      if (newest?.jetpack_featured_media_url) {
        entry.cover = newest.jetpack_featured_media_url;
      }
    }
  }

  const counts = new Map<string, Genre>();
  for (const entry of series) {
    entry.genreIds.forEach((id, index) => {
      const genre = counts.get(id) ?? { id, title: titleCase(entry.genres[index]!), count: 0 };
      genre.count += 1;
      counts.set(id, genre);
    });
  }
  const genres = [...counts.values()]
    .filter((genre) => genre.count >= 2)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

  return {
    series,
    bySlug: new Map(series.map((entry) => [entry.id, entry])),
    byPageSlug: new Map(
      series.filter((entry) => entry.pageSlug).map((entry) => [entry.pageSlug!, entry]),
    ),
    byCategory,
    categories,
    genres,
  };
}

export async function loadCatalogue(api: ExiledRebelsApi): Promise<Catalogue> {
  if (cache && Date.now() - cache.at < CATALOGUE_TTL_MS) {
    return cache.value;
  }

  if (!inflight) {
    inflight = build(api)
      .then((value) => {
        cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = undefined;
      });
  }

  return inflight;
}
