/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { Chapter, SourceManga } from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import type { CatalogEntry } from "./models";

// Listing cards carry everything in attributes: `alt` is the clean title,
// `title` repeats it with every alternative, and `tags` is a JSON array.
export function parseCatalog($: CheerioAPI): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();

  for (const element of $("[data-type][data-status]").toArray()) {
    const card = $(element);
    const href = card.find('a[href^="/series/"]').first().attr("href") ?? "";
    const id = href.replace(/\/$/, "").split("/").pop() ?? "";

    if (!id || seen.has(id)) {
      continue;
    }

    const title = Application.decodeHTMLEntities(card.attr("alt") ?? "");
    if (!title) {
      continue;
    }
    seen.add(id);

    const titleAttribute = Application.decodeHTMLEntities(card.attr("title") ?? "");
    const secondaryTitles = titleAttribute
      .slice(title.length)
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    let tags: string[] = [];
    try {
      const raw = card.attr("tags");
      tags = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      tags = [];
    }

    const style = card.find("[style*='background-image']").first().attr("style") ?? "";
    const imageUrl = /url\((.*?)\)/.exec(style)?.[1]?.replace(/["']/g, "") ?? "";

    entries.push({
      id,
      title,
      secondaryTitles,
      imageUrl,
      tags,
      type: card.attr("data-type") ?? "",
      status: card.attr("data-status") ?? "",
    });
  }

  return entries;
}

export function parseSeriesPage($: CheerioAPI): {
  title: string;
  imageUrl: string;
  synopsis: string;
  author?: string;
  artist?: string;
} {
  const labelled = (label: string): string | undefined => {
    const span = $(`span:contains(${label})`).first();
    const value = span.parent().next().text().replace(/\s+/g, " ").trim();
    return value.length > 0 ? value : undefined;
  };

  return {
    title: Application.decodeHTMLEntities(
      $('meta[property="og:title"]').attr("content") ?? $("h1").first().text().trim(),
    ),
    imageUrl: $('meta[property="og:image"]').attr("content") ?? "",
    synopsis: Application.decodeHTMLEntities(synopsisOf($)),
    ...(labelled("Author") ? { author: labelled("Author")! } : {}),
    ...(labelled("Artist") ? { artist: labelled("Artist")! } : {}),
  };
}

// Each chapter anchor carries `title` (its name), `d` (a date, absolute or
// relative) and `c` (the coin cost; anything above 1 is locked).
export function parseChapters(
  $: CheerioAPI,
  sourceManga: SourceManga,
  language: string,
): Chapter[] {
  // The page also carries bare "start reading" links to the first chapter with
  // no attributes, so entries are merged by id and the dated anchor wins.
  const byId = new Map<string, Chapter>();

  for (const element of $('a[href*="/chapter/"]').toArray()) {
    const anchor = $(element);
    const href = anchor.attr("href") ?? "";
    const chapterId = href.replace(/\/$/, "").split("/").pop() ?? "";

    if (!chapterId) {
      continue;
    }

    const name = Application.decodeHTMLEntities(anchor.attr("title") ?? anchor.attr("alt") ?? "");
    const chapNum = Number(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? NaN);

    if (isNaN(chapNum)) {
      continue;
    }

    const publishDate = parseDate(anchor.attr("d") ?? "");

    if (byId.has(chapterId) && !publishDate) {
      continue;
    }

    const cost = Number(anchor.attr("c") ?? "0");

    byId.set(chapterId, {
      chapterId,
      sourceManga,
      langCode: language,
      chapNum,
      ...(name ? { title: name } : {}),
      ...(publishDate ? { publishDate } : {}),
      ...(cost > 1 ? { additionalInfo: { Cost: `${cost.toString()} coins` } } : {}),
    });
  }

  return [...byId.values()].sort((left, right) => right.chapNum - left.chapNum);
}

// Page images are placeholders in the markup; the real id is in `uid`.
export function parsePages($: CheerioAPI): string[] {
  const pages: string[] = [];

  for (const element of $("#pages img.myImage, img.myImage").toArray()) {
    const uid = $(element).attr("uid");

    if (uid && !pages.includes(uid)) {
      pages.push(uid);
    }
  }

  return pages;
}

function parseDate(value: string): Date | undefined {
  const text = value.trim();

  if (!text) {
    return undefined;
  }

  const relative = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(text);

  if (relative) {
    const amount = Number(relative[1]);
    const unit = (relative[2] ?? "").toLowerCase();
    const perUnit: Record<string, number> = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() - amount * (perUnit[unit] ?? 0));
  }

  const parsed = new Date(text);

  return isNaN(parsed.getTime()) ? undefined : parsed;
}

// The synopsis is one pre-wrap paragraph; its <br> breaks are real paragraph
// breaks that .text() would drop, and anything else inside #expand_content is
// the "Alternative titles" block, which is not part of the description.
function synopsisOf($: CheerioAPI): string {
  for (const node of [$("#expand_content p").first(), $('p[style*="pre-wrap"]').first()]) {
    if (node.length === 0) {
      continue;
    }

    node.find("br").replaceWith("\n");
    const text = node
      .text()
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  // A title with no synopsis block has none; the meta tag here is the site
  // tagline and the title, which is not a description.
  return "";
}
