/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import type {
  ToonzCard,
  ToonzFeatured,
  ToonzListing,
  ToonzRef,
  ToonzSegmentRails,
  ToonzSeries,
} from "./models";

const DOMAIN = "https://toonz.to";
const PLACEHOLDER = `${DOMAIN}/branding/toonz/apple-touch-icon.png`;

/**
 * Pages stream: later blocks arrive as `<div hidden id="S:n">` chunks that the
 * browser swaps into `<template id="B:n">`/`<template id="P:n">` slots. Doing
 * the swap here keeps every card under its own heading.
 */
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

function parseCard($: cheerio.CheerioAPI, anchor: AnyNode): ToonzCard | undefined {
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
    path: href.split("?")[0]!,
    title,
    cover: absolute(img.attr("src")),
    nsfw: img.attr("data-nsfw") !== undefined,
    ...(latest ? { latestChapter: latest.replace(/^Ch\.\s*/i, "Ch. ") } : {}),
    ...(updated ? { updated } : {}),
    ...(rating ? { rating } : {}),
  };
}

function cardsIn($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>): ToonzCard[] {
  const seen = new Set<string>();
  const cards: ToonzCard[] = [];
  scope.find("a[href^='/manhwa/'],a[href^='/manga/'],a[href^='/manhua/']").each((_, a) => {
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

export function parseSegment(html: string): ToonzSegmentRails {
  const $ = load(html);

  const featured: ToonzFeatured[] = [];
  $("section[aria-label='Featured'] article").each((_, article) => {
    const el = $(article);
    const link = el.find("h2 a").first();
    const img = el.find("img[data-cover]").first();
    const href = link.attr("href") ?? "";
    const slug = slugOf(href);
    if (!slug) return;
    const dl: Record<string, string> = {};
    el.find("dl > div").each((_, row) => {
      dl[text($, $(row).find("dt"))] = text($, $(row).find("dd b"));
    });
    featured.push({
      slug,
      path: href,
      title: text($, link) || img.attr("alt")?.trim() || slug,
      cover: absolute(img.attr("src")),
      nsfw: img.attr("data-nsfw") !== undefined,
      summary: text($, el.find("h2").first().next("p")),
      ...(dl["Chapters"]
        ? { chapters: dl["Chapters"], latestChapter: `${dl["Chapters"]} chapters` }
        : {}),
      ...(dl["Rating"] ? { rating: dl["Rating"] } : {}),
      ...(dl["Last update"] ? { updated: dl["Last update"] } : {}),
    });
  });

  const tabbed = (heading: string): [ToonzCard[], ToonzCard[]] => {
    const panels = sectionTitled($, heading).find("div[role='tabpanel']");
    const today = panels.filter((_, p) => $(p).attr("hidden") === undefined).first();
    const week = panels.filter((_, p) => $(p).attr("hidden") !== undefined).first();
    return [cardsIn($, today), cardsIn($, week)];
  };
  const [trendingToday, trendingWeek] = tabbed("Trending");
  const [popularToday, popularWeek] = tabbed("Popular Updates");

  return {
    featured,
    newTitles: cardsIn($, sectionTitled($, "New Titles")),
    recentlyUpdated: cardsIn($, sectionTitled($, "Recently Updated")),
    trendingToday,
    trendingWeek,
    popularToday,
    popularWeek,
  };
}

export function parseListing(html: string): ToonzListing {
  const $ = load(html);
  const next = $("a[aria-label='Go to next page']").first();
  return {
    cards: cardsIn($, $("main").length ? $("main") : $("body")),
    hasNext: next.length > 0 && next.attr("aria-disabled") !== "true" && !!next.attr("href"),
  };
}

export function parseGenres(json: string): ToonzRef[] {
  const list = JSON.parse(json) as ToonzRef[];
  return list.filter((g) => g.slug && g.name);
}

function flightNumber(html: string, key: string): number | undefined {
  const match = new RegExp(`\\\\"${key}\\\\":([\\d.]+)`).exec(html);
  return match ? Number(match[1]) : undefined;
}

function flightString(html: string, key: string): string | undefined {
  return new RegExp(`\\\\"${key}\\\\":\\\\"([^\\\\"]*)\\\\"`).exec(html)?.[1];
}

export function parseSeries(html: string, slug: string): ToonzSeries {
  const $ = load(html);
  const main = $("main").length ? $("main") : $("body");

  const marker = main.find("span[data-comic-id]").first();
  const comicId = marker.attr("data-comic-id") ?? "";
  if (!comicId) {
    throw new Error(`Series ${slug} was not found on the site.`);
  }

  const title = text($, main.find("h1").first()) || marker.attr("data-title") || slug;
  const canonical = $("link[rel='canonical']").attr("href") ?? "";
  const path = canonical.startsWith(DOMAIN) ? canonical.slice(DOMAIN.length) : `/comic/${slug}`;

  const coverImg = main
    .find("img[data-cover]")
    .filter((_, img) => !$(img).closest("section").length)
    .first();
  const cover = coverImg.attr("src") ?? $("meta[property='og:image']").attr("content");
  const banner = main.find("div[data-ed-banner] img").attr("src");

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
    if (!key || key === "Rating" || key === "Last update") return;
    if (key === "Author") {
      dd.find("a").each((_, a) => {
        authors.push(text($, a));
      });
      if (authors.length === 0 && text($, dd)) authors.push(text($, dd));
    }
    details[key] = text($, dd);
  });

  const genres: ToonzRef[] = [];
  main.find("div[role='tabpanel'][id$='-panel-genres'] a[href^='/genre/']").each((_, a) => {
    genres.push({ name: text($, a), slug: slugOf($(a).attr("href") ?? "") });
  });

  const themes: { group: string; tags: string[] }[] = [];
  main.find("div[role='tabpanel'][id$='-panel-themes'] > div > div").each((_, group) => {
    const name = text($, $(group).children("p").first());
    const tags = $(group)
      .find("span[title]")
      .toArray()
      .map((s) => text($, s))
      .filter(Boolean);
    if (name && tags.length) themes.push({ group: name, tags });
  });

  const altTitles = main
    .find("div[role='tabpanel'][id$='-panel-aka'] span")
    .toArray()
    .map((s) => text($, s))
    .filter((t) => t && t !== title);

  return {
    comicId,
    slug,
    path,
    title,
    cover: absolute(cover),
    ...(banner ? { banner: absolute(banner) } : {}),
    synopsis,
    details,
    authors,
    genres,
    themes,
    altTitles: [...new Set(altTitles)],
    ratingAvg: flightNumber(html, "ratingAvg"),
    ratingCount: flightNumber(html, "ratingCount"),
    chapterCount: flightNumber(html, "chapterCount"),
    comicType: flightString(html, "comicType"),
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

  const images = JSON.parse(raw) as { filename?: string; sortOrder?: number }[];
  return images
    .filter((img) => !!img.filename)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((img) => `${DOMAIN}/uploads/${img.filename}`);
}

export function chapterContentRating(html: string): string | undefined {
  return flightString(html, "contentRating");
}
