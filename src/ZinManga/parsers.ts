/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type SearchResultItem, type Tag, type TagSection } from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { DOMAIN, seriesUrl } from "./models";

// An empty imageUrl empties the entire row it appears in, so point coverless
// titles at a path the host won't serve and let the app draw its placeholder.
const MISSING_COVER = `${DOMAIN}/image/none.webp`;

// Ids reject spaces and most punctuation; one bad id fails the whole object.
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function slugOf(href: string): string {
  return (href ?? "").split("?")[0]!.replace(/\/$/, "").split("/").pop()!.trim();
}

// Artwork loads lazily, so `src` is usually a placeholder and the real address
// sits on one of the data attributes, varying by which plugin wrote the page.
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

// Rocket Loader leaves the link's `title` attribute unquoted, so a parser stops
// at its first space and every result comes back titled "Read". Use the heading.
function titleIn($: CheerioAPI, row: Element): string {
  const heading = $("div.post-title a", row).first().text().trim();

  return Application.decodeHTMLEntities(heading);
}

function subtitleIn($: CheerioAPI, row: Element): string {
  const chapter = $("div.chapter-item a, span.chapter a", row).first().text().trim();

  return chapter ? Application.decodeHTMLEntities(chapter) : "";
}

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

// Search rows use c-tabs-item__content, directory rows use page-item-detail,
// and neither page carries the other's class.
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

  // Adult titles are marked with a badge, not a field in the detail rows.
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

// The filter matches the input's value. The label's `for` is only the
// checkbox's own id and searching by it returns nothing.
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
