/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  type WebtoonClubCard,
  type WebtoonClubFeatured,
  type WebtoonClubHomeRails,
  type WebtoonClubListing,
  type WebtoonClubRef,
  type WebtoonClubSeries,
} from "./models";

const PLACEHOLDER = `${DOMAIN}/branding/webtoonclub/icon-180.png`;
const STATUS_WORDS = new Set(["ongoing", "completed", "hiatus", "cancelled", "upcoming"]);

// Pages stream: later blocks arrive as `<div hidden id="S:n">` chunks that the
// browser swaps into `<template id="B:n">` slots; swapping here keeps every
// card under its own heading.
export function load(html: string): cheerio.CheerioAPI {
  const $ = cheerio.load(html);
  const chunks = new Map<string, string>();
  $("div[hidden][id^='S:']").each((_, el) => {
    chunks.set($(el).attr("id")!.slice(2), $(el).html() ?? "");
    $(el).remove();
  });

  for (let pass = 0; pass < 20; pass++) {
    let swapped = false;
    $("template[id^='B:'],template[id^='P:']").each((_, el) => {
      const chunk = chunks.get($(el).attr("id")!.slice(2));
      if (chunk !== undefined) {
        $(el).replaceWith(chunk);
        swapped = true;
      }
    });
    if (!swapped) break;
  }
  return $;
}

export function absolute(url: string | undefined): string {
  if (!url) return PLACEHOLDER;
  if (url.startsWith("http")) return url;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

function slugOf(href: string): string {
  return href.split("?")[0]!.split("/").filter(Boolean).pop() ?? "";
}

function text($: cheerio.CheerioAPI, el: AnyNode | cheerio.Cheerio<AnyNode>): string {
  return $(el as AnyNode)
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

function parseCard($: cheerio.CheerioAPI, anchor: AnyNode): WebtoonClubCard | undefined {
  const a = $(anchor);
  const href = a.attr("href") ?? "";
  const img = a.find("img[data-cover]").first();
  const slug = slugOf(href);
  if (!slug || img.length === 0) return undefined;

  const title = text($, a.find("h3").first()) || img.attr("alt")?.trim() || slug;
  const spans = a
    .children("div")
    .last()
    .children("span")
    .toArray()
    .map((s) => text($, s));
  const latest = spans.find((s) => /^Ch\./i.test(s));
  const updated = spans.find((s) => /ago$|^\d{4}$|^[A-Z][a-z]{2} /.test(s));
  const rating = img
    .parent()
    .children("span")
    .toArray()
    .map((s) => text($, s))
    .find((s) => /^\d(\.\d)?$/.test(s));

  return {
    slug,
    title,
    cover: absolute(img.attr("src")),
    nsfw: img.attr("data-nsfw") !== undefined,
    ...(latest ? { latestChapter: latest.replace(/^Ch\.\s*/i, "Ch. ") } : {}),
    ...(updated ? { updated } : {}),
    ...(rating ? { rating } : {}),
  };
}

function cardsIn($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>): WebtoonClubCard[] {
  const seen = new Set<string>();
  const cards: WebtoonClubCard[] = [];
  scope.find("a[href^='/webtoon/']").each((_, a) => {
    const card = parseCard($, a);
    if (card && !seen.has(card.slug)) {
      seen.add(card.slug);
      cards.push(card);
    }
  });
  return cards;
}

function sectionTitled($: cheerio.CheerioAPI, heading: string): cheerio.Cheerio<AnyNode> {
  return $("h2")
    .filter((_, h) => text($, h) === heading)
    .first()
    .closest("section");
}

export function parseHome(html: string): WebtoonClubHomeRails {
  const $ = load(html);

  const featured: WebtoonClubFeatured[] = [];
  $("section[aria-label='Featured'] article").each((_, article) => {
    const el = $(article);
    const link = el.find("h2 a").first();
    const img = el.find("img[data-cover]").first();
    const slug = slugOf(link.attr("href") ?? "");
    if (!slug) return;
    const dl: Record<string, string> = {};
    el.find("dl > div").each((_, row) => {
      dl[text($, $(row).find("dt"))] = text($, $(row).find("dd b"));
    });
    featured.push({
      slug,
      title: text($, link) || img.attr("alt")?.trim() || slug,
      cover: absolute(img.attr("src")),
      nsfw: img.attr("data-nsfw") !== undefined,
      summary: text($, el.find("h2").first().next("p")),
      ...(dl["Chapters"] ? { latestChapter: `${dl["Chapters"]} chapters` } : {}),
      ...(dl["Rating"] ? { rating: dl["Rating"] } : {}),
      ...(dl["Last update"] ? { updated: dl["Last update"] } : {}),
    });
  });

  const tabbed = (heading: string): [WebtoonClubCard[], WebtoonClubCard[]] => {
    const panels = sectionTitled($, heading).find("div[role='tabpanel']");
    const today = panels.filter((_, p) => $(p).attr("hidden") === undefined).first();
    const week = panels.filter((_, p) => $(p).attr("hidden") !== undefined).first();
    return [cardsIn($, today), cardsIn($, week)];
  };
  const [trendingToday, trendingWeek] = tabbed("Trending");
  const [popularToday, popularWeek] = tabbed("Popular Updates");

  return {
    featured,
    trendingToday,
    trendingWeek,
    popularToday,
    popularWeek,
    newTitles: cardsIn($, sectionTitled($, "New Titles")),
    recentlyUpdated: cardsIn($, sectionTitled($, "Recently Updated")),
  };
}

function hasNextPage($: cheerio.CheerioAPI): boolean {
  const next = $("a[aria-label='Go to next page']").first();
  return next.length > 0 && next.attr("aria-disabled") !== "true" && !!next.attr("href");
}

export function parseListing(html: string): WebtoonClubListing {
  const $ = load(html);
  return {
    cards: cardsIn($, $("main").length ? $("main") : $("body")),
    hasNext: hasNextPage($),
  };
}

// Search rows are a different layout from grid cards: cover anchor, title
// anchor, then a dotted meta line (type · year · status · CH.n · count · rating).
export function parseSearch(html: string): WebtoonClubListing {
  const $ = load(html);
  const cards: WebtoonClubCard[] = [];
  const seen = new Set<string>();

  $("main article").each((_, article) => {
    const el = $(article);
    const img = el.find("img[data-cover]").first();
    const titleLink = el
      .find("a[href^='/webtoon/']")
      .filter((_, a) => $(a).find("img").length === 0)
      .first();
    const slug = slugOf(titleLink.attr("href") ?? "");
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const leafSpans = (scope: cheerio.Cheerio<AnyNode>): string[] =>
      scope
        .find("span")
        .filter((_, s) => $(s).children().length === 0)
        .toArray()
        .map((s) => text($, s))
        .filter((s) => s && s !== "·");

    const metaDiv = titleLink.parent().next("div");
    const meta = leafSpans(metaDiv);
    const genres = leafSpans(metaDiv.next("div"));
    const latest = meta.find((s) => /^CH\./i.test(s));
    const status = meta.find((s) => STATUS_WORDS.has(s.toLowerCase()));
    const rating = meta.find((s) => /^\d\.\d$/.test(s));
    const type = meta[0] && !/^\d/.test(meta[0]) ? meta[0].toLowerCase() : undefined;
    const paragraphs = el
      .find("p")
      .toArray()
      .map((p) => text($, p));
    const updated = paragraphs.find((p) => p.endsWith("ago"));

    cards.push({
      slug,
      title: text($, titleLink) || img.attr("alt")?.trim() || slug,
      cover: absolute(img.attr("src")),
      nsfw: img.attr("data-nsfw") !== undefined,
      ...(latest ? { latestChapter: latest.replace(/^CH\.\s*/i, "Ch. ") } : {}),
      ...(updated ? { updated } : {}),
      ...(rating ? { rating } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status: status.toLowerCase() } : {}),
      genres,
    });
  });

  return { cards, hasNext: hasNextPage($) };
}

export function parseGenres(json: string): WebtoonClubRef[] {
  const list = JSON.parse(json) as WebtoonClubRef[];
  return list.filter((g) => g.slug && g.name);
}

function flightNumber(html: string, key: string): number | undefined {
  const match = new RegExp(`\\\\"${key}\\\\":([\\d.]+)`).exec(html);
  return match ? Number(match[1]) : undefined;
}

export function parseSeries(html: string, slug: string): WebtoonClubSeries {
  const $ = load(html);
  const main = $("main").length ? $("main") : $("body");

  const comicId = main.find("[data-comic-id]").first().attr("data-comic-id") ?? "";
  if (!comicId) {
    throw new Error(`Series ${slug} was not found on the site.`);
  }

  const h1 = main.find("h1").first();
  const title = text($, h1) || slug;
  // The header holds an SEO sentence and then the alternative titles.
  const altLine = h1.parent().children("p").eq(1);
  const altTitles = text($, altLine)
    .split(" · ")
    .map((t) => t.trim())
    .filter((t) => t && t !== title);

  const coverImg = main
    .find("img[data-cover]")
    .filter((_, img) => !$(img).closest("section").length)
    .first();
  const cover = coverImg.attr("src") ?? $("meta[property='og:image']").attr("content");

  const showMore = main
    .find("button")
    .filter((_, b) => /Show More/i.test(text($, b)))
    .first();
  const synopsisNode = showMore.length ? showMore.parent().find("p").first() : $();
  const synopsis = (synopsisNode.text() || "").replace(/\*\*?([^*]+)\*\*?/g, "$1").trim();

  const details: Record<string, string> = {};
  const authors: string[] = [];
  main.find("dl > div").each((_, row) => {
    const key = text($, $(row).find("dt"));
    const dd = $(row).find("dd");
    if (!key) return;
    if (key === "Author") {
      dd.find("a").each((_, a) => {
        authors.push(text($, a));
      });
      if (authors.length === 0 && text($, dd)) authors.push(text($, dd));
    }
    details[key] = text($, dd);
  });

  const genres: WebtoonClubRef[] = [];
  const seenGenres = new Set<string>();
  main.find("a[href^='/genre/']").each((_, a) => {
    const genreSlug = slugOf($(a).attr("href") ?? "");
    if (genreSlug && !seenGenres.has(genreSlug)) {
      seenGenres.add(genreSlug);
      genres.push({ name: text($, a), slug: genreSlug });
    }
  });

  return {
    comicId,
    slug,
    title,
    cover: absolute(cover),
    synopsis,
    details,
    authors,
    genres,
    altTitles: [...new Set(altTitles)],
    ratingAvg: flightNumber(html, "ratingAvg"),
    ratingCount: flightNumber(html, "ratingCount"),
    nsfw: coverImg.attr("data-nsfw") !== undefined,
  };
}

/** The reader's full image list is embedded in the page's flight payload. */
export function parseChapterImages(html: string): string[] {
  const start = html.indexOf('\\"images\\":[');
  if (start < 0) {
    throw new Error("No images were found on the chapter page.");
  }
  const open = html.indexOf("[", start);
  const close = html.indexOf("]", open);
  const raw = html.slice(open, close + 1).replace(/\\"/g, '"');

  // Bare filenames live under the chapter's own folder; the ids precede the list.
  const ids = /\\"chapter\\":\{\\"id\\":(\d+),\\"comicId\\":(\d+)/.exec(html);
  const images = JSON.parse(raw) as { filename?: string; sortOrder?: number }[];
  return images
    .filter((img) => !!img.filename)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((img) => {
      if (img.filename!.includes("/")) return `${DOMAIN}/uploads/${img.filename}`;
      if (!ids) throw new Error("Chapter ids were not found on the chapter page.");
      return `${DOMAIN}/uploads/chapters/${ids[2]}/${ids[1]}/${img.filename}`;
    });
}
