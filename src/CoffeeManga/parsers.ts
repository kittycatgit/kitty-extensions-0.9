/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import {
  DOMAIN,
  seriesUrl,
  type Card,
  type ChapterRef,
  type InertiaPage,
  type Series,
  type SeriesProps,
  type Taxon,
} from "./models";
import { widest } from "./reader";

// An empty imageUrl empties the whole row it appears in, so coverless titles
// point at a path the host won't serve and the app draws its placeholder.
const MISSING_COVER = `${DOMAIN}/image/none.webp`;

// Every page is an Inertia app: the props are embedded as JSON and the markup
// around them is only the server-rendered first paint.
export function inertia<P>(html: string): InertiaPage<P> {
  const match = /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/.exec(html);

  if (!match) {
    throw new Error("The page carried no Inertia data; the site may have changed or challenged.");
  }

  return JSON.parse(match[1]!) as InertiaPage<P>;
}

function absolute(url: string): string {
  const trimmed = url.trim();

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return (trimmed.startsWith("/") ? `${DOMAIN}${trimmed}` : trimmed).replace(
    /^http:\/\//,
    "https://",
  );
}

export function coverOf(card: Card): string {
  const best =
    card.cover_canonical || card.cover_lg || widest(card.cover_srcset ?? "") || card.cover || "";

  return best ? absolute(best) : MISSING_COVER;
}

function subtitleOf(chapter: ChapterRef | undefined): string | undefined {
  if (!chapter) {
    return undefined;
  }

  const label = chapter.label.trim();

  return chapter.published_label ? `${label} · ${chapter.published_label}` : label;
}

export function cardToResult(card: Card): SearchResultItem {
  const subtitle = subtitleOf(card.chapters?.[0]);

  return {
    mangaId: card.slug,
    title: card.title.trim(),
    imageUrl: coverOf(card),
    ...(subtitle ? { subtitle } : {}),
  };
}

export function cardsToResults(cards: Card[] | undefined): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const card of cards ?? []) {
    if (card.slug && card.title && !seen.has(card.slug)) {
      seen.add(card.slug);
      results.push(cardToResult(card));
    }
  }

  return results;
}

export function cardToItem(
  card: Card,
  type: "featured" | "simpleCarousel" | "prominentCarousel" | "chapterUpdates",
): DiscoverSectionItem {
  const base = { mangaId: card.slug, title: card.title.trim(), imageUrl: coverOf(card) };
  const latest = card.chapters?.[0];
  const subtitle = subtitleOf(latest);

  switch (type) {
    case "featured":
      return { type: "featuredCarouselItem", ...base };
    case "prominentCarousel":
      return { type: "prominentCarouselItem", ...base, ...(subtitle ? { subtitle } : {}) };
    case "chapterUpdates":
      // A card without any chapter has nothing to update to; show it plainly.
      if (!latest) {
        return { type: "simpleCarouselItem", ...base };
      }

      return {
        type: "chapterUpdatesCarouselItem",
        ...base,
        chapterId: latest.slug,
        ...(subtitle ? { subtitle } : {}),
        ...(latest.published_at ? { publishDate: new Date(latest.published_at) } : {}),
      };
    default:
      return { type: "simpleCarouselItem", ...base, ...(subtitle ? { subtitle } : {}) };
  }
}

const nameOf = (entry: Taxon | string): string =>
  (typeof entry === "string" ? entry : entry.name).trim();

function tagsOf(taxa: Taxon[] | undefined): Tag[] {
  const tags: Tag[] = [];

  for (const taxon of taxa ?? []) {
    if (taxon.slug && taxon.name && !tags.some((tag) => tag.id === taxon.slug)) {
      tags.push({ id: taxon.slug, title: taxon.name.trim() });
    }
  }

  return tags;
}

const STATUS_LABELS: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "Hiatus",
  cancelled: "Cancelled",
};

export function parseSeries(props: SeriesProps, mangaId: string): SourceManga {
  const series: Series | undefined = props.series;

  if (!series?.title) {
    throw new Error(`No series data was returned for ${mangaId}.`);
  }

  const genres = tagsOf(series.genres);
  const tags = tagsOf(series.tags);
  const tagGroups: TagSection[] = [
    ...(genres.length ? [{ id: "genres", title: "Genres", tags: genres }] : []),
    ...(tags.length ? [{ id: "tags", title: "Tags", tags }] : []),
  ];

  const adult =
    series.is_adult === true ||
    genres.some((genre) => /^(adult|mature|smut|ecchi|hentai)$/i.test(genre.id));

  const author = (series.authors ?? []).map(nameOf).filter(Boolean).join(", ");
  const artist = (series.artists ?? []).map(nameOf).filter(Boolean).join(", ");
  const rating = Number(props.rating?.avg);
  const total = props.chapters_pagination?.total ?? series.chapter_count;
  const type = series.type ? series.type.charAt(0).toUpperCase() + series.type.slice(1) : "";

  const additionalInfo: Record<string, string> = {
    ...(type ? { Type: type } : {}),
    ...(series.release_year ? { Year: String(series.release_year) } : {}),
    ...(typeof total === "number" ? { Chapters: String(total) } : {}),
  };

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: series.title.trim(),
      secondaryTitles: (series.alt_titles ?? []).map((title) => title.trim()).filter(Boolean),
      thumbnailUrl: coverOf(series),
      synopsis: (series.synopsis ?? "").trim(),
      contentRating: adult ? ContentRating.ADULT : ContentRating.MATURE,
      status: STATUS_LABELS[series.status ?? ""] ?? "Unknown",
      shareUrl: seriesUrl(mangaId),
      contentType: "comic",
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(tagGroups.length ? { tagGroups } : {}),
      ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
    },
  };
}

function numberOf(row: ChapterRef): number {
  const explicit = Number(row.number);

  if (Number.isFinite(explicit) && row.number !== null && row.number !== "") {
    return explicit;
  }

  return Number(/([0-9]+(?:\.[0-9]+)?)/.exec(row.label)?.[1] ?? 0);
}

export function parseChapterRows(rows: ChapterRef[], sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];

  for (const row of rows) {
    if (!row.slug) {
      continue;
    }

    const title = (row.title ?? "").trim();
    const published = row.published_at ? new Date(row.published_at) : undefined;

    chapters.push({
      chapterId: row.slug,
      sourceManga,
      langCode: "en",
      chapNum: numberOf(row),
      sortingIndex: 0,
      ...(title ? { title: row.locked ? `${title} (locked)` : title } : {}),
      ...(!title && row.locked ? { title: "Locked" } : {}),
      ...(published && !isNaN(published.getTime()) ? { publishDate: published } : {}),
    });
  }

  return chapters;
}
