/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type SearchResultItem, type Tag, type TagSection } from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { DOMAIN, seriesUrl } from "./models";

/**
 * A cover the app can always convert.
 *
 * An empty URL is rejected outright, and because a row's items are converted as
 * one array a single title without artwork empties the row it appears in. A
 * title the site has no cover for therefore points at a path the cover host
 * does not serve: the URL converts, nothing decodes, and the app draws its own
 * placeholder rather than the row disappearing.
 */
const MISSING_COVER = `${DOMAIN}/image/none.webp`;

/** An id the bridge will carry: a space in one fails the whole object. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** The slug at the end of a series link, however the link was written. */
export function slugOf(href: string): string {
  return (href ?? "").split("?")[0]!.replace(/\/$/, "").split("/").pop()!.trim();
}

/**
 * The real address of an image.
 *
 * The theme loads its artwork lazily, so the `src` attribute is often a
 * placeholder and the address that matters is on one of several other
 * attributes, differing by which plugin wrote the page.
 */
export function imageFrom($: CheerioAPI, node: Cheerio<Element>): string {
  for (const attribute of ["data-src", "data-lazy-src", "srcset", "src", "data-cfsrc"]) {
    const value = (node.first().attr(attribute) ?? "").trim();

    if (value) {
      const url = attribute === "srcset" ? (value.split(" ")[0] ?? "") : value;
      const absolute = url.startsWith("//")
        ? `https:${url}`
        : url.startsWith("/")
          ? `${DOMAIN}${url}`
          : url;

      if (absolute.startsWith("http")) {
        return absolute.replace(/^http:\/\//, "https://");
      }
    }
  }

  return MISSING_COVER;
}

/**
 * A row's title, read from the heading rather than the link's `title`.
 *
 * Cloudflare's Rocket Loader rewrites the inline handler beside that attribute
 * and leaves it unquoted - `title=Read Some Title Manga Online="if (!window..."`
 * - and a parser stops at the first space of an unquoted value, so every result
 * comes back titled "Read". The heading carries the same title as text, which
 * Rocket Loader does not touch.
 */
function titleIn($: CheerioAPI, row: Element): string {
  const heading = $("div.post-title a", row).first().text().trim();

  return Application.decodeHTMLEntities(heading);
}

/** The newest chapter a listing row mentions, as a line under the title. */
function subtitleIn($: CheerioAPI, row: Element): string {
  const chapter = $("div.chapter-item a, span.chapter a", row).first().text().trim();

  return chapter ? Application.decodeHTMLEntities(chapter) : "";
}

/** One row of a listing or a page of search results. */
function rowToResult($: CheerioAPI, row: Element): SearchResultItem | undefined {
  const href = $("a", row).first().attr("href") ?? "";
  const mangaId = slugOf(href);
  const title = titleIn($, row);

  if (!mangaId || !title) {
    return undefined;
  }

  const subtitle = subtitleIn($, row);

  return {
    mangaId,
    title,
    imageUrl: imageFrom($, $("img", row) as Cheerio<Element>),
    ...(subtitle ? { subtitle } : {}),
  };
}

/**
 * Search results and directory listings, which are laid out differently.
 *
 * The search route wraps each result in `div.c-tabs-item__content`; the
 * directory route uses `div.page-item-detail` and carries neither class of the
 * other. Both are looked for so one reader serves both pages.
 */
export function parseResults($: CheerioAPI): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const row of $("div.c-tabs-item__content, div.page-item-detail").toArray()) {
    const result = rowToResult($, row);

    if (result && !seen.has(result.mangaId)) {
      seen.add(result.mangaId);
      results.push(result);
    }
  }

  return results;
}

/** The labelled rows the series page lists its details in. */
function detailRows($: CheerioAPI): Map<string, string> {
  const rows = new Map<string, string>();

  for (const row of $("div.post-content_item").toArray()) {
    const label = $("div.summary-heading", row).text().trim().toLowerCase();
    const value = $("div.summary-content", row).text().trim();

    if (label) {
      rows.set(label, value);
    }
  }

  return rows;
}

/** A series as the app shows it. */
export function parseSeries($: CheerioAPI, mangaId: string) {
  const rows = detailRows($);

  const title = Application.decodeHTMLEntities(
    $("div.post-title h1").children().remove().end().text().trim(),
  );

  const synopsis = Application.decodeHTMLEntities(
    $("div.description-summary div.summary__content, div.description-summary").first().text(),
  )
    .replace(/show more/i, "")
    .trim();

  const genres: Tag[] = [];
  for (const node of $("div.genres-content a").toArray()) {
    const name = $(node).text().trim();
    const id = slugify(name);

    if (name && id && !genres.some((genre) => genre.id === id)) {
      genres.push({ id, title: name });
    }
  }

  const tagGroups: TagSection[] = genres.length
    ? [{ id: "genres", title: "Genres", tags: genres }]
    : [];

  const status = /completed/i.test(rows.get("status") ?? "") ? "Completed" : "Ongoing";
  const rating = Number($("#averagerate").first().text().trim());

  const alternative = (rows.get("alternative") ?? "")
    .split(/\s*[;,|]\s*/)
    .map((value) => Application.decodeHTMLEntities(value.trim()))
    .filter((value) => value.length > 0 && value !== title);

  // The site marks a title adult with a badge rather than a field.
  const adult = $("span.manga-title-badges.adult").length > 0;

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title || mangaId,
      secondaryTitles: alternative,
      thumbnailUrl: imageFrom($, $("div.summary_image img") as Cheerio<Element>),
      synopsis,
      contentRating: adult ? ContentRating.ADULT : ContentRating.MATURE,
      status,
      shareUrl: seriesUrl(mangaId),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(tagGroups.length ? { tagGroups } : {}),
    },
  };
}

/**
 * A chapter's pages.
 *
 * The reader writes each page as an image inside its own break, and the address
 * is on `data-src` as often as on `src`.
 */
export function parsePages($: CheerioAPI): string[] {
  const pages: string[] = [];

  for (const node of $("div.page-break img, img.wp-manga-chapter-img").toArray()) {
    const page = imageFrom($, $(node) as Cheerio<Element>);

    if (page && page !== MISSING_COVER && !pages.includes(page)) {
      pages.push(page);
    }
  }

  return pages;
}

/**
 * The genres the search actually filters by.
 *
 * Each genre is a checkbox carrying its slug in the input's value and its name
 * in the label beside it. The slug is what the filter matches: asking this site
 * for the label's `for` - which is only the checkbox's own id - returns nothing
 * at all, while the value returns the titles.
 */
export function parseGenres($: CheerioAPI): Tag[] {
  const genres: Tag[] = [];

  for (const box of $("div.checkbox-group div.checkbox").toArray()) {
    const id = ($("input", box).attr("value") ?? "").trim();
    const title = $("label", box).text().trim();

    if (id && title && !genres.some((genre) => genre.id === id)) {
      genres.push({ id, title });
    }
  }

  return genres;
}
