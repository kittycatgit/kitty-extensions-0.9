/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { DOMAIN, seriesUrl } from "./models";

// An empty imageUrl empties the whole row, so point coverless titles at a path
// the host will not serve and let the app draw its placeholder.
const MISSING_COVER = `${DOMAIN}/image/none.webp`;

// Section indexes rather than series.
const NOT_SERIES = new Set(["manga", "az-list", "genres", "page", "login", ""]);

export function slugOf(href: string): string {
  return (href ?? "").split("?")[0]!.replace(/\/$/, "").split("/").pop()!.trim();
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

// Covers lazy-load, so `src` holds an inline svg placeholder and the real
// address sits on data-src.
function imageFrom(node: Cheerio<Element>): string {
  for (const attribute of ["data-src", "data-lazy-src", "src"]) {
    const value = (node.first().attr(attribute) ?? "").trim();

    if (value && !value.startsWith("data:")) {
      return absolute(value);
    }
  }

  return MISSING_COVER;
}

export function parseResults($: CheerioAPI): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const element of $("div.listupd div.bsx > a, div.listupd a.tip").toArray()) {
    const node = $(element);
    const mangaId = slugOf(node.attr("href") ?? "");
    const title = Application.decodeHTMLEntities(
      (node.attr("title") ?? $("div.tt", element).first().text()).trim(),
    );

    if (NOT_SERIES.has(mangaId) || !title || seen.has(mangaId)) {
      continue;
    }

    seen.add(mangaId);

    const chapter = $("div.epxs", element).first().text().trim();

    results.push({
      mangaId,
      title,
      imageUrl: imageFrom($("img", element) as Cheerio<Element>),
      ...(chapter ? { subtitle: Application.decodeHTMLEntities(chapter) } : {}),
    });
  }

  return results;
}

export function parseSeries($: CheerioAPI, mangaId: string): SourceManga {
  const title = Application.decodeHTMLEntities(
    (
      $("div.kdt8-left-title").first().text() ||
      $("h1").first().text() ||
      ($('meta[property="og:title"]').attr("content") ?? "")
    ).trim(),
  );

  const synopsis = Application.decodeHTMLEntities(
    ($("div.kdt8-synopsis").first().text() || $("[itemprop=description]").first().text())
      .replace(/show more\s*↓?/i, "")
      .trim(),
  );

  const genres: Tag[] = [];
  for (const node of $("div.kdt8-genres a, span.mgen a").toArray()) {
    const id = slugOf($(node).attr("href") ?? "");
    const name = $(node).text().trim();

    if (id && name && !genres.some((genre) => genre.id === id)) {
      genres.push({ id, title: name });
    }
  }

  const tagGroups: TagSection[] = genres.length
    ? [{ id: "genres", title: "Genres", tags: genres }]
    : [];

  const cover = $("div.kdt8-cover img").first();
  const thumbnail = cover.length
    ? imageFrom(cover as Cheerio<Element>)
    : absolute($('meta[property="og:image"]').attr("content") ?? MISSING_COVER);

  const statusText = $("div.imptdt:contains(Status) i, div.tsinfo div.imptdt")
    .first()
    .text()
    .trim();
  const adult = genres.some((genre) => /^(adult|erotica|mature|smut|ecchi)$/i.test(genre.id));

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title || mangaId,
      secondaryTitles: [],
      thumbnailUrl: thumbnail,
      synopsis,
      contentRating: adult ? ContentRating.ADULT : ContentRating.MATURE,
      status: /completed|finished/i.test(statusText) ? "Completed" : "Ongoing",
      shareUrl: seriesUrl(mangaId),
      ...(tagGroups.length ? { tagGroups } : {}),
    },
  };
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const rows: Array<{ chapterId: string; number: number; title: string; published?: Date }> = [];
  const seen = new Set<string>();

  for (const element of $("#chapterlist li").toArray()) {
    const link = $("a", element).first();
    const chapterId = slugOf(link.attr("href") ?? "");

    if (!chapterId || seen.has(chapterId)) {
      continue;
    }

    seen.add(chapterId);

    const label = $("span.chapternum", element).first().text().trim();
    const attribute = Number($(element).attr("data-num"));
    const fromLabel = Number((label.match(/([0-9]+(?:\.[0-9]+)?)/) ?? [])[1]);
    const number = Number.isFinite(attribute) ? attribute : fromLabel;
    const date = new Date($("span.chapterdate", element).first().text().trim());

    rows.push({
      chapterId,
      number: Number.isFinite(number) ? number : 0,
      title: label,
      ...(isNaN(date.getTime()) ? {} : { published: date }),
    });
  }

  // The markup is not reliably ordered - half-numbered chapters sit out of
  // sequence - so the number decides, not the position.
  rows.sort((left, right) => right.number - left.number);

  return rows.map((row, index) => ({
    chapterId: row.chapterId,
    sourceManga,
    langCode: "en",
    chapNum: row.number,
    sortingIndex: rows.length - index,
    ...(row.title ? { title: row.title } : {}),
    ...(row.published ? { publishDate: row.published } : {}),
  }));
}

// The reader hands its pages to ts_reader.run() as JSON rather than markup.
export function parsePages(html: string): string[] {
  const payload = /ts_reader\.run\((\{[\s\S]*?\})\);/.exec(html)?.[1];

  if (!payload) {
    return [];
  }

  const sources = (JSON.parse(payload) as { sources?: Array<{ images?: string[] }> }).sources ?? [];
  const pages: string[] = [];

  for (const image of sources[0]?.images ?? []) {
    const url = absolute(image);

    if (url && !pages.includes(url)) {
      pages.push(url);
    }
  }

  return pages;
}

// The filter form carries every genre as a checkbox whose value is the id the
// search expects.
export function parseGenres($: CheerioAPI): Tag[] {
  const genres: Tag[] = [];

  for (const element of $('input[name="genre[]"]').toArray()) {
    const id = ($(element).attr("value") ?? "").trim();
    const title = $(element).parent().text().replace(/\s+/g, " ").trim();

    if (id && title && !genres.some((genre) => genre.id === id)) {
      genres.push({ id, title: Application.decodeHTMLEntities(title) });
    }
  }

  return genres.sort((a, b) => a.title.localeCompare(b.title));
}
