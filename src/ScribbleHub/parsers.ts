/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type * as cheerio from "cheerio";
import type { Element } from "domhandler";

import { toXhtmlDocument } from "../novel/xhtml";
import {
  DOMAIN,
  PLACEHOLDER_COVER,
  type Card,
  type ChapterRow,
  type Option,
  type Series,
  type Vocab,
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
  sec: 1000,
  min: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

// Series ids keep the site's `<number>/<slug>` path so share URLs stay canonical.
export function seriesIdOf(href: string | undefined): string | undefined {
  return /\/series\/(\d+\/[^/?#]+)/.exec(href ?? "")?.[1];
}

export function chapterIdOf(href: string | undefined): string | undefined {
  return /\/(read\/[^/?#]+\/chapter\/\d+)/.exec(href ?? "")?.[1];
}

function coverOf(img: cheerio.Cheerio<Element>): string {
  const src = clean(img.attr("data-src") ?? img.attr("src"));
  if (!src) return PLACEHOLDER_COVER;
  return src.startsWith("http") ? src : `${DOMAIN}${src}`;
}

// "Nov 5, 2026 01:05 AM" on the TOC, "7 hours ago" for the newest releases.
export function parseDate(text: string | undefined): Date | undefined {
  const value = clean(text);
  const absolute =
    /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(value);
  if (absolute) {
    const month = MONTHS[absolute[1]!.toLowerCase()];
    if (month === undefined) return undefined;
    let hour = Number(absolute[4] ?? 0);
    if (absolute[6]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (absolute[6]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(
      Date.UTC(Number(absolute[3]), month, Number(absolute[2]), hour, Number(absolute[5] ?? 0)),
    );
  }

  const relative = /(\d+)\s*(sec|min|hour|day|week|month|year)/i.exec(value);
  if (relative) {
    const unit = RELATIVE_UNITS[relative[2]!.toLowerCase()];
    if (unit) return new Date(Date.now() - Number(relative[1]) * unit);
  }
  return undefined;
}

export function parseListing($: cheerio.CheerioAPI): Card[] {
  const cards: Card[] = [];

  $("div.search_main_box").each((_, el) => {
    const box = $(el);
    const link = box.find("div.search_title a[href*='/series/']").first();
    const id = seriesIdOf(link.attr("href"));
    const title = clean(link.text());
    if (!id || !title) return;

    const chapters = clean(box.find("span.nl_stat:has(i.fa-list-alt)").text());
    const rating = clean(box.find("div.search_ratings").text()).replace(/[()]/g, "");
    const subtitle = [chapters, rating ? `${rating} stars` : ""].filter(Boolean).join(" · ");

    cards.push({
      id,
      title,
      cover: coverOf(box.find("div.search_img img").first()),
      ...(subtitle ? { subtitle } : {}),
    });
  });

  return cards;
}

export function hasNextPage($: cheerio.CheerioAPI): boolean {
  return $("a.page-link.next").length > 0;
}

// The home page's "Latest Updates" table; every row names its newest chapter.
export function parseLatestUpdates($: cheerio.CheerioAPI): Card[] {
  const cards: Card[] = [];

  $("table#main_releases tr.toc_w").each((_, el) => {
    const row = $(el);
    const link = row.find("a.fp_title").first();
    const id = seriesIdOf(link.attr("href"));
    const title = clean(link.attr("title") ?? link.text());
    if (!id || !title) return;

    const chapterLink = row.find("a[href*='/read/']").first();
    const chapterId = chapterIdOf(chapterLink.attr("href"));
    const chapterTitle = clean(chapterLink.text());

    cards.push({
      id,
      title,
      cover: coverOf(row.find("div.m_img_fic img").first()),
      ...(chapterTitle ? { subtitle: chapterTitle } : {}),
      ...(chapterId ? { chapterId } : {}),
    });
  });

  return cards;
}

function optionsOf(
  $: cheerio.CheerioAPI,
  anchors: cheerio.Cheerio<Element>,
  idAttr: string,
): Option[] {
  const options: Option[] = [];
  anchors.each((_, el) => {
    const anchor = $(el);
    const title = clean(anchor.text());
    const id =
      idAttr === "href"
        ? /\/(?:tag|genre|content)\/([^/?#]+)/.exec(anchor.attr("href") ?? "")?.[1]
        : anchor.attr(idAttr);
    if (id && title) options.push({ id, title });
  });
  return options;
}

export function parseSeries($: cheerio.CheerioAPI): Series {
  const title = clean(
    $("div.fic_title").first().attr("title") ?? $("div.fic_title").first().text(),
  );
  if (!title) {
    throw new Error("The series page could not be read.");
  }

  const synopsis = $("div.wi_fic_desc")
    .first()
    .find("p")
    .toArray()
    .map((p) => clean($(p).text()))
    .filter(Boolean)
    .join("\n\n");

  const stats: Record<string, string> = {};
  $("div.fic_stats span.st_item").each((_, el) => {
    const item = $(el);
    const label = clean(item.find("span.mb_stat").text());
    const value = clean(item.clone().children("span.mb_stat").remove().end().text());
    if (label && value) stats[label] = value;
  });

  const ratingText = clean($("div.fic_rate > span > span > span").first().text());
  const rating = Number(ratingText);
  const ratingCount = clean($("span.rate_more").first().text());

  const statusLine = clean($("li:has(i.fa.status) > span:not(.rnd_stats)").first().text());
  const status = statusLine.split(" - ")[0]?.trim() || undefined;
  const lastUpdate = clean($("span[title^='Last updated']").first().text()) || undefined;

  return {
    title,
    cover: coverOf($("div.fic_image img").first()),
    synopsis: synopsis || clean($("div.wi_fic_desc").first().text()),
    author: clean($("span.auth_name_fic").first().text()) || undefined,
    status,
    lastUpdate,
    rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
    ratingCount: ratingCount || undefined,
    genres: optionsOf($, $("span.wi_fic_genre a.fic_genre"), "gid"),
    tags: optionsOf($, $("span.wi_fic_showtags a.stag"), "href"),
    warnings: optionsOf($, $("li.mature_contains a"), "href"),
    stats,
  };
}

// One page of the TOC ajax; the newest chapter comes first and carries the
// highest `order`.
export function parseChapterRows($: cheerio.CheerioAPI): ChapterRow[] {
  const rows: ChapterRow[] = [];

  $("li.toc_w").each((_, el) => {
    const item = $(el);
    const link = item.find("a.toc_a").first();
    const id = chapterIdOf(link.attr("href"));
    if (!id) return;

    const dateCell = item.find("span.fic_date_pub").first();
    rows.push({
      id,
      order: Number(item.attr("order") ?? 0),
      title: clean(link.text()),
      date: parseDate(dateCell.attr("title") ?? dateCell.text()),
    });
  });

  return rows;
}

export function parseChapterBody($: cheerio.CheerioAPI, fallbackTitle?: string): string {
  const body = $("div#chp_raw").first();
  if (body.length === 0) {
    throw new Error("The chapter page has no text; the site may have changed.");
  }
  body.find("script, style, .wi-ads, .ads-title").remove();

  return toXhtmlDocument(
    body.html() ?? "",
    clean($("div.chapter-title").first().text()) || fallbackTitle,
  );
}

// The finder's filter widgets: tri-state spans for genres and warnings, a
// select2 multi-select for the 700+ tags.
export function parseVocab($: cheerio.CheerioAPI): Vocab {
  const genres: Option[] = [];
  $("span.sfc_genre[gmeid]").each((_, el) => {
    const id = $(el).attr("gmeid");
    const title = clean($(el).parent().find("span.lbl_cl").text());
    if (id && title) genres.push({ id, title });
  });

  const warnings: Option[] = [];
  $("span.sfc_mature[ctid]").each((_, el) => {
    const id = $(el).attr("ctid");
    const title = clean($(el).parent().find("span.lbl_cl").text());
    if (id && title) warnings.push({ id, title });
  });

  const tags: Option[] = [];
  $("select[name='tagsalledit_include[]'] option").each((_, el) => {
    const id = $(el).attr("value");
    const title = clean($(el).text());
    if (id && title) tags.push({ id, title });
  });

  if (genres.length === 0) {
    throw new Error("The series finder form could not be read.");
  }

  return { genres, tags, warnings };
}
