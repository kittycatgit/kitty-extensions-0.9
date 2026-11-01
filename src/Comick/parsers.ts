/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import { COVERS, DEMOGRAPHICS, DOMAIN, MISSING_COVER, PUBLICATION, RATINGS } from "./models";

export type Cover = { b2key?: string | null };
export type Title = { title?: string | null; lang?: string | null; is_default?: boolean | null };
export type GenreLink = {
  md_genres?: { group?: string | null; name?: string | null; slug?: string | null } | null;
};
export type Person = { name?: string | null; slug?: string | null };

// The list shape shared by search, /top lists and latest-chapter comics.
export type ComicCard = {
  hid?: string | null;
  slug?: string | null;
  title?: string | null;
  content_rating?: string | null;
  last_chapter?: number | string | null;
  bayesian_rating?: string | number | null;
  md_covers?: Cover[] | null;
  md_titles?: Title[] | null;
};

export type ComicDetail = ComicCard & {
  desc?: string | null;
  status?: number | null;
  demographic?: number | null;
  country?: string | null;
  year?: number | null;
  user_follow_count?: number | null;
  translation_status?: string | null;
  md_comic_md_genres?: GenreLink[] | null;
};

export type ComicResponse = {
  comic?: ComicDetail | null;
  authors?: Person[] | null;
  artists?: Person[] | null;
  demographic?: string | null;
};

export type LatestChapter = {
  hid?: string | null;
  chap?: string | null;
  publish_at?: string | null;
  md_comics?: ComicCard | null;
};

export type LibraryRow = {
  hid: string;
  title?: string | null;
  slug?: string | null;
  media_type?: string | null;
  status?: number | null;
  rating?: number | null;
  publication_status?: number | null;
  bayesian_rating?: number | null;
  cover_url?: string | null;
  last_released_number?: string | null;
  translation_status?: string | null;
  titles?: Title[] | null;
  url?: string | null;
  progress?: { number?: string | null; volume?: string | null; hid?: string | null } | null;
  progressed_at?: string | null;
  followed_at?: string | null;
};

export type Genre = { group?: string | null; name?: string | null; slug?: string | null };

export function coverUrl(covers: Cover[] | null | undefined): string {
  const key = covers?.find((cover) => cover.b2key)?.b2key;

  return key ? `${COVERS}/${key}` : MISSING_COVER;
}

export function ratingOf(rating: string | null | undefined): ContentRating {
  switch (rating) {
    case "erotica":
    case "pornographic":
      return ContentRating.ADULT;
    case "suggestive":
      return ContentRating.MATURE;
    default:
      return ContentRating.EVERYONE;
  }
}

// Ratings up to and including the ceiling, in the site's own words.
export function ratingsUpTo(ceiling: string): string[] {
  const index = RATINGS.findIndex((rating) => rating.id === ceiling);

  return RATINGS.slice(0, index === -1 ? 2 : index + 1).map((rating) => rating.id);
}

export function statusOf(code: number | null | undefined): string | undefined {
  return PUBLICATION.find((status) => status.id === String(code))?.title;
}

export function primaryTitle(card: ComicCard): string {
  const preferred =
    card.md_titles?.find((title) => title.is_default && title.title)?.title ??
    card.md_titles?.find((title) => title.lang === "en" && title.title)?.title;

  return (preferred ?? card.title ?? "").trim() || (card.hid ?? "Untitled");
}

export function secondaryTitles(card: ComicCard, primary: string): string[] {
  const seen = new Set<string>([primary]);
  const titles: string[] = [];

  for (const entry of [card.title, ...(card.md_titles ?? []).map((title) => title.title)]) {
    const title = (entry ?? "").trim();

    if (title && !seen.has(title)) {
      seen.add(title);
      titles.push(title);
    }
  }

  return titles.slice(0, 20);
}

// Descriptions are markdown with link lists; keep the prose only.
export function plainText(markdown: string | null | undefined): string {
  return (markdown ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function subtitleOf(card: ComicCard): string | undefined {
  const chapter = card.last_chapter;
  const parts: string[] = [];

  if (chapter !== null && chapter !== undefined && chapter !== "" && Number(chapter) > 0) {
    parts.push(`Ch. ${chapter}`);
  }

  const score = Number(card.bayesian_rating);

  if (Number.isFinite(score) && score > 0) {
    parts.push(`★ ${score.toFixed(1)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function toSearchItem(card: ComicCard): SearchResultItem | undefined {
  if (!card.hid) {
    return undefined;
  }

  const subtitle = subtitleOf(card);

  return {
    mangaId: card.hid,
    title: primaryTitle(card),
    imageUrl: coverUrl(card.md_covers),
    contentRating: ratingOf(card.content_rating),
    ...(subtitle ? { subtitle } : {}),
  };
}

function tagsIn(links: GenreLink[] | null | undefined, groups: string[]): Tag[] {
  const tags = new Map<string, Tag>();

  for (const link of links ?? []) {
    const genre = link.md_genres;
    const group = (genre?.group ?? "").toLowerCase();

    if (genre?.slug && genre.name && groups.includes(group) && !tags.has(genre.slug)) {
      tags.set(genre.slug, { id: genre.slug, title: genre.name });
    }
  }

  return [...tags.values()];
}

export function parseComic(hid: string, response: ComicResponse): SourceManga {
  const comic = response.comic;

  if (!comic?.hid) {
    throw new Error(`Comick returned no comic for ${hid}.`);
  }

  const title = primaryTitle(comic);
  const sections: TagSection[] = [];
  const push = (id: string, name: string, tags: Tag[]): void => {
    if (tags.length > 0) {
      sections.push({ id, title: name, tags });
    }
  };

  push("genres", "Genres", tagsIn(comic.md_comic_md_genres, ["genre"]));
  push("themes", "Themes", tagsIn(comic.md_comic_md_genres, ["theme"]));
  push("format", "Format", tagsIn(comic.md_comic_md_genres, ["format"]));
  push("content", "Content", tagsIn(comic.md_comic_md_genres, ["content"]));

  const demographic =
    DEMOGRAPHICS.find((entry) => entry.id === String(comic.demographic))?.title ??
    response.demographic ??
    undefined;

  if (demographic) {
    push("demographic", "Demographic", [
      { id: `demographic-${comic.demographic ?? demographic.toLowerCase()}`, title: demographic },
    ]);
  }

  if (comic.country) {
    push("country", "Origin", [
      { id: `country-${comic.country}`, title: comic.country.toUpperCase() },
    ]);
  }

  const names = (people: Person[] | null | undefined): string =>
    [...new Set((people ?? []).map((person) => (person.name ?? "").trim()).filter(Boolean))].join(
      ", ",
    );
  const author = names(response.authors);
  const artist = names(response.artists);
  const score = Number(comic.bayesian_rating);
  const status = statusOf(comic.status);
  const additionalInfo: Record<string, string> = {};

  if (comic.year) {
    additionalInfo["Year"] = String(comic.year);
  }

  if (comic.user_follow_count) {
    additionalInfo["Follows"] = comic.user_follow_count.toLocaleString("en-US");
  }

  if (comic.last_chapter) {
    additionalInfo["Last chapter"] = String(comic.last_chapter);
  }

  if (comic.translation_status) {
    additionalInfo["Translation"] = comic.translation_status;
  }

  return {
    mangaId: comic.hid,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: secondaryTitles(comic, title),
      thumbnailUrl: coverUrl(comic.md_covers),
      synopsis: plainText(comic.desc),
      contentRating: ratingOf(comic.content_rating),
      contentType: "comic",
      ...(status ? { status } : {}),
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      ...(Number.isFinite(score) && score > 0 ? { rating: score / 10 } : {}),
      ...(sections.length > 0 ? { tagGroups: sections } : {}),
      ...(Object.keys(additionalInfo).length > 0 ? { additionalInfo } : {}),
      shareUrl: `${DOMAIN}/comic/${comic.slug ?? comic.hid}`,
    },
  };
}

// Library rows carry display metadata but no description or genres.
export function parseLibraryRow(row: LibraryRow): SourceManga {
  const card: ComicCard = { hid: row.hid, title: row.title, md_titles: row.titles };
  const title = primaryTitle(card);
  const score = Number(row.bayesian_rating);
  const status = statusOf(row.publication_status);
  const additionalInfo: Record<string, string> = {};

  if (row.last_released_number) {
    additionalInfo["Last chapter"] = row.last_released_number;
  }

  if (row.translation_status) {
    additionalInfo["Translation"] = row.translation_status;
  }

  return {
    mangaId: row.hid,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: secondaryTitles(card, title),
      thumbnailUrl: row.cover_url || MISSING_COVER,
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
      contentType: "comic",
      ...(status ? { status } : {}),
      ...(Number.isFinite(score) && score > 0 ? { rating: score / 10 } : {}),
      ...(Object.keys(additionalInfo).length > 0 ? { additionalInfo } : {}),
      shareUrl: row.url ?? `${DOMAIN}/comic/${row.slug ?? row.hid}`,
    },
  };
}

export function parseGenres(genres: Genre[], groups: string[]): { id: string; title: string }[] {
  const seen = new Set<string>();
  const options: { id: string; title: string }[] = [];

  for (const genre of genres) {
    const group = (genre.group ?? "").toLowerCase();

    if (genre.slug && genre.name && groups.includes(group) && !seen.has(genre.slug)) {
      seen.add(genre.slug);
      options.push({ id: genre.slug, title: genre.name });
    }
  }

  return options.sort((left, right) => left.title.localeCompare(right.title));
}
