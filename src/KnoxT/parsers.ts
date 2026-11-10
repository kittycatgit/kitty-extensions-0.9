/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  PLACEHOLDER_COVER,
  type Card,
  type ChapterRow,
  type Option,
  type PopularRange,
  type Series,
  type Vocab,
} from "./models";

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Series and chapter ids are the last path segment of their permalink.
export function slugOf(href: string | undefined): string {
  const path = (href ?? "").replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] ?? "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Photon covers carry `?resize=W,H`; the bare URL is the full upload.
function coverOf(img: cheerio.Cheerio<AnyNode>): string {
  const lazy = img.attr("data-lazy-src");
  const src = img.attr("src") ?? "";
  const chosen = src.startsWith("data:") || !src ? (lazy ?? "") : src;
  const bare = chosen.split("?")[0] ?? "";
  return bare.startsWith("http") ? bare : PLACEHOLDER_COVER;
}

function joinBits(bits: (string | undefined)[]): string | undefined {
  const kept = bits.map((bit) => clean(bit ?? "")).filter(Boolean);
  return kept.length > 0 ? kept.join(" • ") : undefined;
}

export function parseEditorsChoice($: cheerio.CheerioAPI): Card[] {
  const cards: Card[] = [];

  $("div.slidtop div.slide-item").each((_, el) => {
    const item = $(el);
    const link = item.find("div.slide-content span.ellipsis a").first();
    const id = slugOf(link.attr("href"));
    if (!id) return;

    const status = item
      .find("div.cast span.director")
      .text()
      .replace(/Status:/i, "");
    const type = item.find("div.cast span.actor a").first().text();
    const rating = clean(item.find("div.site-vote span span").text());

    cards.push({
      id,
      title: clean(link.text()),
      cover: coverOf(item.find("div.poster img").first()),
      subtitle: joinBits([status, type, rating ? `${rating}/10` : undefined]),
      summary: clean(item.find("div.excerpt p.story").text()) || undefined,
    });
  });

  return cards;
}

export function parseTrending($: cheerio.CheerioAPI): Card[] {
  const cards: Card[] = [];

  $("div.trendarea div.trendlist").each((_, el) => {
    const item = $(el);
    const link = item.find("div.trenti a").first();
    const id = slugOf(link.attr("href"));
    if (!id) return;

    cards.push({
      id,
      title: clean(link.text()),
      cover: coverOf(item.find("div.thumbtr img").first()),
      subtitle: joinBits([
        item.find("div.thumbtr div.status").text(),
        item.find("span.toptype a").first().text(),
      ]),
      summary: clean(item.find("div.trendsys").text()) || undefined,
    });
  });

  return cards;
}

// Home "Latest Release" style cards (`article.bs`), used by the recommendation tabs.
export function parseSmallCards($: cheerio.CheerioAPI, scope: string): Card[] {
  const cards: Card[] = [];

  $(`${scope} article.bs`).each((_, el) => {
    const item = $(el);
    const link = item.find("div.bsx > a").first();
    const id = slugOf(link.attr("href"));
    if (!id) return;

    cards.push({
      id,
      title: clean(item.find("span.ntitle").text()) || clean(link.attr("title") ?? ""),
      cover: coverOf(item.find("img").first()),
      subtitle: joinBits([item.find("span.nchapter").text(), item.find("span.ndate").text()]),
    });
  });

  return cards;
}

export function parsePopular($: cheerio.CheerioAPI, range: PopularRange): Card[] {
  const cards: Card[] = [];

  $(`div.wpop-${range} ul li`).each((_, el) => {
    const item = $(el);
    const link = item.find("div.leftseries h4 a").first();
    const id = slugOf(link.attr("href"));
    if (!id) return;

    const genres = item
      .find("div.leftseries span a[rel=tag]")
      .map((__, a) => clean($(a).text()))
      .get()
      .slice(0, 3);

    cards.push({
      id,
      title: clean(link.text()),
      cover: coverOf(item.find("div.imgseries img").first()),
      subtitle: genres.length > 0 ? genres.join(", ") : undefined,
    });
  });

  return cards;
}

// `/series/` listing and `?s=` search share the `article.maindet` card.
export function parseListing($: cheerio.CheerioAPI): Card[] {
  const cards: Card[] = [];

  $("article.maindet").each((_, el) => {
    const item = $(el);
    const link = item.find("div.mdthumb a").first();
    const id = slugOf(link.attr("href"));
    if (!id) return;

    const genres = item
      .find("span.mdgenre a")
      .map((__, a) => clean($(a).text()).replace(/^#\s*/, ""))
      .get()
      .slice(0, 2);

    cards.push({
      id,
      title: clean(item.find("h2[itemprop=headline] a").text()) || clean(link.attr("title") ?? ""),
      cover: coverOf(item.find("div.mdthumb img").first()),
      subtitle: joinBits([item.find("span.nchapter").text(), genres.join(", ")]),
      summary: clean(item.find("div.contexcerpt").text()) || undefined,
    });
  });

  return cards;
}

export function hasNextListingPage($: cheerio.CheerioAPI): boolean {
  return $("div.hpage a.r").length > 0;
}

export function hasNextSearchPage($: cheerio.CheerioAPI): boolean {
  return $("div.pagination a.next").length > 0;
}

function parseCheckboxes($: cheerio.CheerioAPI, name: string): Option[] {
  const options: Option[] = [];

  $(`input[name="${name}"]`).each((_, el) => {
    const input = $(el);
    const id = (input.attr("value") ?? "").trim();
    const title = clean($(`label[for="${input.attr("id") ?? ""}"]`).text());
    // A few type terms are editor leftovers with encoded or "Remove term" slugs.
    if (!id || !title || id.includes("%") || id.startsWith("remove-term")) return;
    options.push({ id, title });
  });

  return options;
}

export function parseVocab($: cheerio.CheerioAPI): Vocab {
  const genres = parseCheckboxes($, "genre[]");
  const types = parseCheckboxes($, "type[]");

  if (genres.length === 0 || types.length === 0) {
    throw new Error("The series filter form could not be read.");
  }

  return { genres, types };
}

export function parseDate(text: string): Date | undefined {
  const match = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (!match) return undefined;

  const month = MONTHS[match[1]!.toLowerCase()];
  if (month === undefined) return undefined;

  return new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
}

function parseChapterRows($: cheerio.CheerioAPI): ChapterRow[] {
  const rows: ChapterRow[] = [];

  $("div.eplister ul li").each((_, el) => {
    const item = $(el);
    const link = item.find("a").first();
    const id = slugOf(link.attr("href"));
    if (!id) return;

    const label = clean(item.find("div.epl-num").text());
    const numeric = /(\d+(?:\.\d+)?)/.exec(label.replace(/^Ch\.?\s*/i, ""));
    // "Ch. Extra:7" has no chapter number; keep it as a titled extra.
    const number = numeric && !/extra/i.test(label) ? Number(numeric[1]) : 0;

    rows.push({
      id,
      number,
      label,
      title: clean(item.find("div.epl-title").text()),
      date: parseDate(item.find("div.epl-date").text()),
    });
  });

  return rows;
}

function synopsisOf($: cheerio.CheerioAPI): string {
  const content = $("div.bixbox.synp div.entry-content").first().clone();
  content
    .find("sup.modern-footnotes-footnote, span.modern-footnotes-footnote__note, img, script, style")
    .remove();

  const lines: string[] = [];
  content.children().each((_, el) => {
    const text = clean($(el).text());
    if (text) lines.push(text);
  });

  // The page prints its ko-fi and paypal banners as escaped markup inside the
  // entry text, so removing the <img> nodes does not reach them.
  return (lines.length > 0 ? lines.join("\n") : clean(content.text()))
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

export function parseSeries($: cheerio.CheerioAPI): Series {
  const title = clean($("h1.entry-title").first().text());
  if (!title) {
    throw new Error("The series page could not be read.");
  }

  const info: Record<string, cheerio.Cheerio<AnyNode>> = {};
  $("div.spe span").each((_, el) => {
    const label = clean($(el).find("b").first().text()).replace(/:$/, "").toLowerCase();
    if (label) info[label] = $(el);
  });

  const valueOf = (key: string): string | undefined => {
    const span = info[key];
    if (!span) return undefined;
    const text = clean(span.text().replace(span.find("b").first().text(), ""));
    return text || undefined;
  };
  const linksOf = (key: string): string[] =>
    info[key]
      ?.find("a")
      .map((_, a) => clean($(a).text()))
      .get()
      .filter(Boolean) ?? [];
  const termsOf = (selector: string): Option[] =>
    $(selector)
      .map((_, a) => ({ id: slugOf($(a).attr("href")), title: clean($(a).text()) }))
      .get()
      .filter((term) => term.id && term.title);

  return {
    title,
    altTitles: clean($("span.alter").first().text())
      .split(/\s*[|/]\s*/)
      .map((name) => name.trim())
      .filter((name) => name && name !== title),
    cover: coverOf($("div.thumbook div.thumb img").first()),
    status: valueOf("status"),
    types: linksOf("type"),
    authors: linksOf("author"),
    artists: linksOf("artist"),
    released: valueOf("released"),
    language: valueOf("native language"),
    followers: clean($("div.bmc").first().text()) || undefined,
    genres: termsOf("div.genxed a"),
    tags: termsOf("div.bottom.tags a"),
    synopsis: synopsisOf($),
    mature: $("div.warning").length > 0,
    chapters: parseChapterRows($),
  };
}

export function parseChapterBody($: cheerio.CheerioAPI): { title?: string; body: string } {
  const content = $("div.epcontent.entry-content").first();
  if (content.length === 0) {
    throw new Error("The chapter text could not be found.");
  }

  // Sponsor banners and tracking scripts are injected between paragraphs.
  content.find("div.kln, script, noscript, style, iframe, ins").remove();
  content.find("img").each((_, el) => {
    const img = $(el);
    const lazy = img.attr("data-lazy-src");
    const src = img.attr("src") ?? "";
    if (lazy && (!src || src.startsWith("data:"))) {
      img.attr("src", lazy.replace(/[?&]is-pending-load=1/, ""));
    }
  });

  const subtitle = clean($("div.cat-series").first().text());
  const heading = clean($("h1.entry-title").first().text());

  return { title: subtitle || heading || undefined, body: content.html() ?? "" };
}

export function seriesUrl(mangaId: string): string {
  return `${DOMAIN}/${mangaId}/`;
}
