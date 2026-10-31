/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type SourceManga, type Tag, type TagSection } from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { DOMAIN, seriesUrl, type Option } from "./models";

export type Card = {
  mangaId: string;
  title: string;
  imageUrl: string;
  subtitle?: string;
  chapterId?: string;
  rank?: number;
};

export type ChapterRow = {
  chapterId: string;
  number: number;
  title?: string;
  published?: Date;
};

export type Filters = {
  types: Option[];
  genres: Option[];
  statuses: Option[];
};

const ADULT_GENRES = new Set([
  "adult",
  "mature",
  "hentai",
  "smut",
  "ecchi",
  "porn-comic",
  "doujinshi",
  "yaoi",
  "yuri",
  "netorare",
  "incest",
  "milf",
]);

const text = (node: Cheerio<AnyNode>): string =>
  Application.decodeHTMLEntities(node.text()).replace(/\s+/g, " ").trim();

// Last path segment of a site link; slugs are already percent-encoded.
export const slugOf = (href: string | undefined): string =>
  (href ?? "").split("?")[0]!.replace(/\/+$/, "").split("/").pop() ?? "";

const image = (img: Cheerio<AnyNode>): string => {
  const src = img.attr("data-src") ?? img.attr("src") ?? "";

  return src.trim().startsWith("/") ? `${DOMAIN}${src.trim()}` : src.trim();
};

const parseCard = ($: CheerioAPI, card: AnyNode): Card | undefined => {
  const link = $("h3 a", card).first();
  const mangaId = slugOf(link.attr("href"));
  const title = text(link);
  const imageUrl = image($("a.mt-cover img", card).first());

  if (!mangaId || !title || !imageUrl) {
    return undefined;
  }

  const chapter = $("a.mt-chapter", card).first();
  const chapterId = slugOf(chapter.attr("href"));
  const chapterName = text(chapter.clone().children().remove().end());
  const when = text($("small", card).first());
  const rank = Number(text($("span.mt-rank", card).first()));

  return {
    mangaId,
    title,
    imageUrl,
    ...(chapterName ? { subtitle: chapterName } : when ? { subtitle: when } : {}),
    ...(chapterId ? { chapterId } : {}),
    ...(rank ? { rank } : {}),
  };
};

export const parseCards = ($: CheerioAPI, root: Cheerio<AnyNode>): Card[] =>
  $("article.mt-card", root)
    .toArray()
    .map((card) => parseCard($, card))
    .filter((card): card is Card => card !== undefined);

export const parseHero = ($: CheerioAPI): Card[] =>
  $("section.mt-hero article.mt-slide")
    .toArray()
    .flatMap((slide) => {
      const cover = $("a.mt-hero-cover", slide).first();
      const mangaId = slugOf(cover.attr("href"));
      const title = text($("h1", slide).first());
      const imageUrl = image($("img", cover).first());
      const tags = $("div.mt-tags a", slide)
        .toArray()
        .map((tag) => text($(tag)))
        .join(", ");

      return mangaId && title && imageUrl
        ? [{ mangaId, title, imageUrl, ...(tags ? { subtitle: tags } : {}) }]
        : [];
    });

export const homeSection = ($: CheerioAPI, heading: string): Cheerio<AnyNode> =>
  $("section.mt-section")
    .filter((_, section) => text($("h2", section).first()).endsWith(heading))
    .first();

export const parseFilters = ($: CheerioAPI): Filters => {
  const options = (label: string): Option[] =>
    $("form#mt-advanced label")
      .filter((_, node) => $(node).contents().first().text().trim() === label)
      .first()
      .find("option")
      .toArray()
      .map((option) => ({ id: $(option).attr("value") ?? "", title: text($(option)) }))
      .filter((option) => option.id !== "");

  return { types: options("Series type"), genres: options("Genre"), statuses: options("Status") };
};

export const parseSeries = ($: CheerioAPI, mangaId: string): SourceManga => {
  const info = $("div.mt-detail-info").first();
  const primaryTitle = text($("h1", info).first());

  if (!primaryTitle) {
    throw new Error(`No series found at ${seriesUrl(mangaId)}.`);
  }

  const secondaryTitles = text($("details.mt-alternative p", info))
    .split(/\s*,\s*/)
    .filter((title) => title && title !== primaryTitle);

  const credit = (label: string): string | undefined =>
    $("div.mt-creators > div", info)
      .filter((_, node) => text($("span", node).first()) === label)
      .find("a")
      .toArray()
      .map((node) => text($(node)))
      .filter((name) => name && name !== "Updating")
      .join(", ") || undefined;

  const facts: Record<string, string> = {};
  $("details.mt-information dt", info).each((_, dt) => {
    facts[text($(dt))] = text($(dt).next("dd"));
  });

  const status = facts["Status"] ?? text($("span.mt-status-pill", info)).replace(/^●\s*/, "");
  const genres: Tag[] = $("div.mt-detail-genres a", info)
    .toArray()
    .map((node) => ({ id: slugOf($(node).attr("href")), title: text($(node)) }))
    .filter((tag) => tag.id && tag.title);

  const adult =
    $("span.manga-title-badges.adult", info).length > 0 ||
    genres.some((tag) => ADULT_GENRES.has(tag.id));

  const synopsis = $("div.description-summary div.summary__content")
    .first()
    .find("p")
    .toArray()
    .map((node) => text($(node)))
    .filter((line) => line && line !== "Show more")
    .join("\n\n");

  const rating = Number(text($("div.mt-detail-rating strong").first()));
  const thumbnailUrl = image($("div.mt-detail-cover img").first());
  const tagGroups: TagSection[] = genres.length
    ? [{ id: "genres", title: "Genres", tags: genres }]
    : [];

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl,
      synopsis,
      contentRating: adult ? ContentRating.ADULT : ContentRating.EVERYONE,
      status: /^on-?going$/i.test(status) ? "Ongoing" : status || "Unknown",
      ...(credit("Author") ? { author: credit("Author") } : {}),
      ...(credit("Artist") ? { artist: credit("Artist") } : {}),
      ...(rating ? { rating: rating / 5 } : {}),
      tagGroups,
      shareUrl: seriesUrl(mangaId),
      additionalInfo: Object.fromEntries(Object.entries(facts).filter(([key]) => key !== "Status")),
    },
  };
};

const UNITS: Record<string, number> = {
  second: 1000,
  min: 60_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export const parseDate = (value: string): Date | undefined => {
  const relative = /(\d+)\s*(second|min|minute|hour|day|week|month|year)s?\s+ago/i.exec(value);

  if (relative) {
    return new Date(Date.now() - Number(relative[1]) * UNITS[relative[2]!.toLowerCase()]!);
  }

  if (/just now|less than an hour/i.test(value)) {
    return new Date();
  }

  if (/yesterday/i.test(value)) {
    return new Date(Date.now() - UNITS["day"]!);
  }

  const absolute = new Date(value);

  return Number.isNaN(absolute.getTime()) ? undefined : absolute;
};

export const parseChapterRows = ($: CheerioAPI): ChapterRow[] =>
  $("li.wp-manga-chapter")
    .toArray()
    .flatMap((row) => {
      const link = $("a", row).first();
      const chapterId = slugOf(link.attr("href"));
      const name = text(link);

      if (!chapterId) {
        return [];
      }

      const numbered = /(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+(?:[.,]\d+)?)/i.exec(name);
      const fromName = numbered?.[1] ?? /(\d+(?:[.,]\d+)?)/.exec(name)?.[1];
      const fromId = /(\d+(?:[-_.]\d+)?)$/.exec(chapterId)?.[1]?.replace(/[-_]/, ".");
      const number = Number((fromName ?? fromId ?? "0").replace(",", "."));
      const remainder = numbered
        ? name
            .replace(numbered[0], "")
            .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
            .trim()
        : "";
      const when =
        $("span.chapter-release-date a[title]", row).first().attr("title") ??
        text($("span.chapter-release-date", row).first());
      const published = parseDate(when);

      return [
        {
          chapterId,
          number,
          ...(remainder ? { title: remainder } : {}),
          ...(published ? { published } : {}),
        },
      ];
    });

export const parsePages = ($: CheerioAPI): string[] =>
  $("div.page-break img")
    .toArray()
    .map((img) => image($(img)))
    .filter((src) => src !== "");
