/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  type SirenCard,
  type SirenChapterRow,
  type SirenHome,
  type SirenSeries,
  type SirenUpdate,
} from "./models";

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const RELATIVE_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function slugOf(href: string | undefined): string {
  if (!href) {
    return "";
  }

  return href
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0]!;
}

export function absolute(url: string | undefined, domain: string): string {
  const value = (url ?? "").trim();

  if (!value || value.startsWith("data:")) {
    return "";
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  return value.startsWith("http") ? value : `${domain}${value.startsWith("/") ? "" : "/"}${value}`;
}

function coverOf($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>): string {
  const img = scope.find("img").first();
  return (img.attr("data-src") ?? img.attr("src") ?? "").trim();
}

function ratingOf($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>) {
  const rating = scope.find("span.font-semibold").first().text().trim();
  const reviews = scope.find("span.opacity-70").first().text().trim();

  return /^\d+(\.\d+)?$/.test(rating) ? { rating, reviews: reviews || undefined } : {};
}

// Slider cards (featured, trending, most reviewed, novels) and editor's picks.
function parseSlideCard($: cheerio.CheerioAPI, el: AnyNode): SirenCard | undefined {
  const card = $(el);
  const slug = slugOf(card.attr("href"));
  const title = (card.attr("title") ?? card.find("h3, p").first().text()).trim();

  if (!slug || !title) {
    return undefined;
  }

  const synopsis = card.find("p.line-clamp-2").first().text().trim();

  return {
    slug,
    title,
    cover: coverOf($, card),
    ...ratingOf($, card),
    ...(synopsis ? { synopsis } : {}),
    tags: card
      .find("span.rounded-full")
      .map((_, tag) => $(tag).text().trim())
      .get()
      .filter(Boolean),
  };
}

export function parseSlideCards($: cheerio.CheerioAPI, selector: string): SirenCard[] {
  return $(selector)
    .map((_, el) => parseSlideCard($, el))
    .get()
    .filter((card): card is SirenCard => card !== undefined);
}

// Grid cards: the home "Newly Added" grid, the browse page and every
// `?_ajax=search` / `?_ajax=home` fragment.
export function parseGridCards($: cheerio.CheerioAPI, scope?: string): SirenCard[] {
  const cards: SirenCard[] = [];

  $(scope ? `${scope} a.group[href]` : "a.group[href]").each((_, el) => {
    const card = $(el);
    const slug = slugOf(card.attr("href"));
    const title = card.find("h2").first().text().trim();

    if (!slug || !title) {
      return;
    }

    const type = card
      .find("span")
      .filter((__, span) => $(span).text().trim() === "Type:")
      .first()
      .next("span")
      .text()
      .trim();
    const synopsis = card.find("p.line-clamp-3").first().text().trim();

    cards.push({
      slug,
      title,
      cover: coverOf($, card),
      ...(type ? { type } : {}),
      ...ratingOf($, card),
      ...(synopsis ? { synopsis } : {}),
      tags: card
        .find("span.rounded-full")
        .map((__, tag) => $(tag).text().trim())
        .get()
        .filter(Boolean),
    });
  });

  return cards;
}

export function parseHome(html: string): SirenHome {
  const $ = cheerio.load(html);

  return {
    featured: parseSlideCards($, "#featured-slider > a[data-slide-card]"),
    novels: parseSlideCards($, "#novel-slider > a[data-slide-card]"),
    trending: parseSlideCards($, "#trending-today > a[data-slide-card]"),
    mostReviewed: parseSlideCards($, "#most-reviewed > a[data-slide-card]"),
    editorsChoice: parseSlideCards($, "#editors-choice-stack a[data-ec-card]:not([data-ec-clone])"),
    newlyAdded: parseGridCards($, "#series-grid"),
  };
}

// `?_ajax=search` / `?_ajax=home` answer with bare card markup in a JSON string.
export function parseGridFragment(html: string): SirenCard[] {
  return parseGridCards(cheerio.load(html, null, false));
}

export function parseFragmentCards(html: string): SirenCard[] {
  return parseSlideCards(cheerio.load(html, null, false), "a[data-slide-card]");
}

// "Recently Updated" cards list several chapters each; the newest free one is
// the entry, since a paid row cannot be opened without an account.
export function parseRecentUpdates(html: string): { items: SirenUpdate[]; hasNext: boolean } {
  const $ = cheerio.load(html);
  const items: SirenUpdate[] = [];

  $("#recent-updated-section article.ru-card, article.ru-card").each((_, el) => {
    const card = $(el);
    const link = card.find("h2.ru-title > a").first();
    const slug = slugOf(link.attr("href"));
    const title = link.text().trim();
    const rows = card.find("a.ru-row");
    const row = rows.not(".ru-row--paid").first().length
      ? rows.not(".ru-row--paid").first()
      : rows.first();
    const chapterId = chapterIdOf(slug, row.attr("href"));

    if (!slug || !title || !chapterId) {
      return;
    }

    const coins = row.find(".ru-gate").attr("data-tip")?.trim();
    const date = parseIsoDate(row.find("time").attr("datetime"));

    items.push({
      slug,
      title,
      cover: coverOf($, card.find(".ru-media")),
      chapterId,
      chapterName: row.find(".ru-ch").text().trim() || chapterId,
      ...(coins ? { coins } : {}),
      ...(date ? { date } : {}),
    });
  });

  // Both the home widget (buttons) and the standalone page (links) are handled.
  const hasNext =
    $('button[aria-label="Next recently updated page"]:not([disabled])').length > 0 ||
    $("a.ru-page--step[rel=next]").length > 0;

  return { items: dedupe(items), hasNext };
}

function dedupe(items: SirenUpdate[]): SirenUpdate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.slug)) {
      return false;
    }
    seen.add(item.slug);
    return true;
  });
}

// `/slug-chapter-6` → `chapter-6`; the series slug may itself end in a number.
export function chapterIdOf(seriesSlug: string, href: string | undefined): string {
  const path = slugOf(href);
  const prefix = `${seriesSlug}-`;

  return path.startsWith(prefix) ? path.slice(prefix.length) : "";
}

export function parseGenres(html: string): { slug: string; name: string }[] {
  const $ = cheerio.load(html);
  const genres: { slug: string; name: string }[] = [];
  const seen = new Set<string>();

  $("#fsel-genres a[role=option][href]").each((_, el) => {
    const match = /tag(?:\[\]|%5B%5D)=([^&]+)/.exec($(el).attr("href") ?? "");
    const name = decodeURIComponent((match?.[1] ?? "").replace(/\+/g, " ")).trim();
    const slug = tagId(name);

    if (!name || !slug || seen.has(slug)) {
      return;
    }

    seen.add(slug);
    genres.push({ slug, name });
  });

  return genres;
}

// Tag values are free text with spaces and punctuation; ids may hold neither.
export function tagId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseSeries(html: string): SirenSeries {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim();
  const uid = $("#chapters-list").attr("data-series-uid")?.trim() ?? "";

  if (!title || !uid) {
    throw new Error("The series page did not load: no title or series id found.");
  }

  const labelled = (label: string): string | undefined => {
    const value = $("span.text-xs")
      .filter((_, el) => $(el).text().trim() === label)
      .first()
      .parent()
      .next("span")
      .text()
      .trim();
    return value || undefined;
  };
  const boxed = (label: string): string | undefined => {
    const value = $("div.text-xs")
      .filter((_, el) => $(el).text().trim() === label)
      .first()
      .next("div")
      .find("span.text-sm")
      .first()
      .text()
      .trim();
    return value || undefined;
  };

  const altTitles = ($("h1").first().next("p[title]").attr("title") ?? "")
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part && part !== title);

  const genres: { slug: string; name: string }[] = [];
  const seen = new Set<string>();
  $('a[href*="?browse&tag"]').each((_, el) => {
    const name = $(el).text().trim();
    const slug = tagId(name);
    if (name && slug && !seen.has(slug)) {
      seen.add(slug);
      genres.push({ slug, name });
    }
  });

  const cover = (
    $('meta[property="og:image"]').attr("content") ??
    $("#cover-zoom-btn img").attr("data-src") ??
    ""
  ).trim();

  return {
    title,
    altTitles,
    cover,
    author: labelled("Author"),
    artist: labelled("Artist"),
    status: boxed("Status"),
    type: boxed("Type"),
    genres,
    synopsis: $("#series-desc").first().text().replace(/\s+/g, " ").trim(),
    uid,
  };
}

// Rows come back as an HTML string inside the `_chapters_html` JSON. The
// site sorts them by `data-index`, 0 being the newest.
export function parseChapterRows(rowsHtml: string, seriesSlug: string): SirenChapterRow[] {
  const $ = cheerio.load(rowsHtml, null, false);
  const rows: SirenChapterRow[] = [];
  const seen = new Set<string>();

  $("a.chapter-row[href]").each((position, el) => {
    const row = $(el);
    const id = chapterIdOf(seriesSlug, row.attr("href"));

    if (!id || seen.has(id)) {
      return;
    }

    seen.add(id);

    const label = (row.attr("data-ch-label") ?? row.find(".ch-title, .ch-name").first().text())
      .replace(/\s+/g, " ")
      .trim();
    const index = Number(row.attr("data-index"));
    const coins = row.attr("data-ch-coins")?.trim();
    const date = parseSiteDate(row.find(".ch-date-row span").last().text());

    rows.push({
      id,
      label: label || id,
      index: Number.isFinite(index) ? index : position,
      locked: row.attr("data-ch-locked") === "1",
      ...(coins && coins !== "0" ? { coins } : {}),
      ...(date ? { date } : {}),
    });
  });

  return rows.sort((a, b) => a.index - b.index);
}

export function chapterNumberOf(label: string, id: string): number {
  const fromLabel = /(\d+(?:\.\d+)?)/.exec(label);

  if (fromLabel) {
    return Number(fromLabel[1]);
  }

  // `chapter-6-5` is how the site spells 6.5 in a slug.
  const fromId = /chapter-(\d+)(?:-(\d+))?/i.exec(id);

  return fromId ? Number(`${fromId[1]}${fromId[2] ? `.${fromId[2]}` : ""}`) : 0;
}

export function parseChapterPages(html: string): string[] {
  const $ = cheerio.load(html);

  return $("#strip-reader img.reader-page")
    .map((_, img) => ($(img).attr("src") ?? $(img).attr("data-src") ?? "").trim())
    .get()
    .filter(Boolean);
}

// Novel chapters render prose as plain <p>/<em> inside `.reader-note .prose-note`.
export function parseChapterProse(html: string): string {
  const $ = cheerio.load(html);
  const note = $(".reader-note .prose-note").first();

  note.find("script, style").remove();

  return note.html()?.trim() ?? "";
}

// A locked chapter has no reader at all, just a notice in #reader-content:
// "This Chapter is locked ... 75 coins ... Buy Coins on Main Site".
export function isLockedChapterPage(html: string): { locked: boolean; coins?: string } {
  const $ = cheerio.load(html);
  const text = $("#reader-content").text().replace(/\s+/g, " ");

  if (!/chapter is locked/i.test(text)) {
    return { locked: false };
  }

  const coins = /(\d+)\s*coins?/i.exec(text)?.[1];
  return { locked: true, ...(coins ? { coins } : {}) };
}

export function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// "Oct 19, 2026", "12h ago", "3 days ago", "11m ago", "just now".
export function parseSiteDate(text: string | undefined): Date | undefined {
  const value = (text ?? "").trim().toLowerCase();

  if (!value) {
    return undefined;
  }

  const absolute = /^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(value);
  if (absolute) {
    const month = MONTHS[absolute[1]!];
    if (month !== undefined) {
      return new Date(Date.UTC(Number(absolute[3]), month, Number(absolute[2])));
    }
  }

  if (/^(just now|now|today)$/.test(value)) {
    return new Date();
  }

  const relative = /^(\d+)\s*(s|m|h|d|w|sec|min|hour|day|week|month|year)[a-z]*\s+ago$/.exec(value);
  if (relative) {
    const count = Number(relative[1]);
    const unit = relative[2]!;
    const millis =
      unit === "month"
        ? 30 * RELATIVE_UNITS.d!
        : unit === "year"
          ? 365 * RELATIVE_UNITS.d!
          : RELATIVE_UNITS[unit.charAt(0)]!;

    return new Date(Date.now() - count * millis);
  }

  return undefined;
}
