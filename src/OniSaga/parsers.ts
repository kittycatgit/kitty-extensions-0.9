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
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";

import { encodeId } from "../shared/ids";
import { DOMAIN, STATUS_LABELS, coverUrl, type Listing, type Option } from "./models";

function text($el: Cheerio<Element>): string {
  return $el.text().replace(/\s+/g, " ").trim();
}

export function slugFromHref(href: string | undefined): string | undefined {
  return href?.match(/\/title\/([^/?#]+)/)?.[1];
}

export function releaseFromHref(href: string | undefined): string | undefined {
  return href?.match(/\/read\/[^/?#]+\/([^/?#]+)/)?.[1];
}

export function cursorFromHref(href: string | undefined): string | undefined {
  const cursor = href?.match(/[?&](?:cursor|cc)=([^&#]+)/)?.[1];
  return cursor ? decodeURIComponent(cursor) : undefined;
}

// Cards everywhere carry a cover <img>, a `/title/` link and a medium badge;
// the title is the link text or the jacket fallback when the cover is missing.
export function parseCards($: CheerioAPI): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const element of $('a[href*="/title/"]').toArray()) {
    const link = $(element);
    const slug = slugFromHref(link.attr("href"));
    if (!slug || seen.has(slug)) {
      continue;
    }

    const card = link.closest("li, article").first();
    const host = card.length ? card : link;
    const medium = (
      host.attr("data-medium") ??
      host.find("[data-medium]").attr("data-medium") ??
      ""
    ).toLowerCase();
    if (medium === "novel") {
      continue;
    }

    const title =
      text(host.find("h3, h2, [class*=Title], [class*=title]").first()) ||
      text(
        host
          .find("a[href*='/title/']")
          .filter((_, a) => text($(a)).length > 0)
          .first(),
      ) ||
      text(link);
    if (!title) {
      continue;
    }

    seen.add(slug);
    const chapters = text(host.find("[class*=_meta] [aria-hidden], [class*=unitLabel]").first());
    const updated = text(host.find("time").first());
    const subtitle = [chapters && /^\d/.test(chapters) ? chapters : "", updated]
      .filter(Boolean)
      .join(" · ");

    items.push({
      mangaId: slug,
      title,
      imageUrl: coverUrl(slug),
      ...(subtitle ? { subtitle } : {}),
    });
  }

  return items;
}

export function parseListing($: CheerioAPI): Listing {
  const next = $('a[href*="cursor="]')
    .toArray()
    .map((a) => $(a).attr("href"))
    .find(Boolean);

  return { items: parseCards($), cursor: cursorFromHref(next) };
}

export type UpdateEntry = {
  mangaId: string;
  title: string;
  chapterId: string;
  label: string;
  date?: Date;
};

export function parseUpdates($: CheerioAPI): { entries: UpdateEntry[]; cursor?: string } {
  const entries: UpdateEntry[] = [];

  for (const element of $("li.iuPllG_entry, li[class*=_entry]").toArray()) {
    const entry = $(element);
    if ((entry.attr("data-medium") ?? "").toLowerCase() === "novel") {
      continue;
    }

    const slug = slugFromHref(entry.find('a[href*="/title/"]').attr("href"));
    const title = text(entry.find("[class*=entryTitle] a").first());
    const unit = entry.find('a[href*="/read/"]').first();
    const chapterId = releaseFromHref(unit.attr("href"));
    if (!slug || !title || !chapterId) {
      continue;
    }

    const label = text(unit.find("[class*=unitTitle]").first()) || text(unit);
    const when = unit.find("time").attr("datetime");
    const date = when ? new Date(when) : undefined;
    entries.push({
      mangaId: slug,
      title,
      chapterId,
      label,
      ...(date && !isNaN(date.getTime()) ? { date } : {}),
    });
  }

  const next = $('a[href*="/updates?cursor="]').attr("href");
  return { entries, cursor: cursorFromHref(next) };
}

export function parseSpotlight($: CheerioAPI): { slug: string; title: string; summary: string }[] {
  const slides: { slug: string; title: string; summary: string }[] = [];

  for (const element of $("[data-slide], [class*=_slide]").toArray()) {
    const slide = $(element);
    if ((slide.find("[data-medium]").attr("data-medium") ?? "").toLowerCase() === "novel") {
      continue;
    }

    const link = slide.find('h2 a[href*="/title/"], a[href*="/title/"]').first();
    const slug = slugFromHref(link.attr("href"));
    const title = text(link);
    if (!slug || !title || slides.some((s) => s.slug === slug)) {
      continue;
    }

    slides.push({ slug, title, summary: text(slide.find("[class*=synopsis]").first()) });
  }

  return slides;
}

export function parseTrending($: CheerioAPI): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  const section = $('section[aria-labelledby="trending-title"]');

  for (const element of section.find('a[href*="/title/"]').toArray()) {
    const link = $(element);
    const slug = slugFromHref(link.attr("href"));
    const title = text(link);
    if (slug && title && !items.some((item) => item.mangaId === slug)) {
      items.push({ mangaId: slug, title, imageUrl: coverUrl(slug) });
    }
  }

  return items;
}

// The browse form lists every genre as a checkbox with its title count.
export function parseGenres($: CheerioAPI): Option[] {
  const genres: Option[] = [];

  for (const element of $('input[type="checkbox"][name="genre"]').toArray()) {
    const input = $(element);
    const id = input.attr("value");
    const label = input.closest("label");
    const title = text(label.find("[class*=checkRow]").first() || label)
      .replace(/\s*\d[\d,]*\s*$/, "")
      .trim();
    if (id && title) {
      genres.push({ id: encodeId(id), title });
    }
  }

  return genres;
}

function facts($: CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  for (const dl of $("main dl").toArray()) {
    const children = $(dl).children("dt, dd, div").toArray();
    let key = "";
    for (const child of children) {
      const el = $(child);
      if (child.tagName === "div") {
        const dt = text(el.find("dt").first());
        const dd = text(el.find("dd").first());
        if (dt && dd) map.set(dt.toLowerCase(), dd);
        continue;
      }
      if (child.tagName === "dt") {
        key = text(el).toLowerCase();
      } else if (key && !map.has(key)) {
        map.set(key, text(el));
      }
    }
  }
  return map;
}

function ratingOf(label: string | undefined, synopsis: string): ContentRating {
  const value = (label ?? "").toLowerCase();
  if (/adult|explicit|pornographic|18\+|hentai/.test(value)) return ContentRating.ADULT;
  if (/mature|teen|suggestive|erotica|17\+|16\+/.test(value)) return ContentRating.MATURE;
  if (/general|everyone|all ages|safe/.test(value)) return ContentRating.EVERYONE;
  return /\b(sex|hentai|smut)\b/i.test(synopsis) ? ContentRating.ADULT : ContentRating.MATURE;
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
  const title = text($("main h1").first()) || mangaId;
  const synopsis = text($("[class*=synopsis]").first());
  const info = facts($);

  const secondaryTitles: string[] = [];
  const titles = $('section[aria-labelledby="titles-heading"]');
  for (const dd of titles.find("dd").toArray()) {
    const alt = text($(dd));
    if (alt && alt !== title && !secondaryTitles.includes(alt)) {
      secondaryTitles.push(alt);
    }
  }

  const authors: string[] = [];
  const artists: string[] = [];
  for (const element of $("[class*=creditRole]").toArray()) {
    const role = text($(element)).toLowerCase();
    const name = text($(element).parent().find("[class*=creditName]").first());
    if (!name) continue;
    if (/art|illustrat|draw/.test(role)) artists.push(name);
    else authors.push(name);
  }

  const groups = new Map<string, Tag[]>();
  const terms = $('section[aria-labelledby="terms-heading"]');
  const termScope = terms.length ? terms : $("main");
  for (const element of termScope.find('a[href*="/browse?"]').toArray()) {
    const href = $(element).attr("href") ?? "";
    const match = /[?&](genre|theme|tag|demographic|form)=([^&#]+)/.exec(href);
    const name = text($(element));
    if (!match?.[1] || !match[2] || !name) continue;
    const group = match[1] === "genre" ? "Genres" : match[1] === "theme" ? "Themes" : "Tags";
    const list = groups.get(group) ?? [];
    const id = `${match[1]}:${decodeURIComponent(match[2])}`;
    if (!list.some((tag) => tag.id === encodeId(id))) {
      list.push({ id: encodeId(id), title: name });
    }
    groups.set(group, list);
  }
  const tagGroups: TagSection[] = [...groups].map(([group, tags]) => ({
    id: group.toLowerCase(),
    title: group,
    tags,
  }));

  const statusRaw = (info.get("publication status") ?? info.get("status") ?? "").toLowerCase();
  const status = STATUS_LABELS[statusRaw] ?? (statusRaw ? capitalize(statusRaw) : undefined);

  const additionalInfo: Record<string, string> = {};
  for (const [label, key] of [
    ["Origin", "origin"],
    ["Format", "publication format"],
    ["Demographic", "demographic"],
    ["Content rating", "content rating"],
    ["Original language", "original language"],
    ["First published", "first published"],
    ["Color", "color"],
    ["Chapters", "english"],
  ] as const) {
    const value = info.get(key);
    if (value) additionalInfo[label] = value;
  }

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles,
      thumbnailUrl: coverUrl(mangaId),
      synopsis,
      contentRating: ratingOf(info.get("content rating"), synopsis),
      shareUrl: `${DOMAIN}/title/${mangaId}`,
      ...(status ? { status } : {}),
      ...(authors.length ? { author: authors.join(", ") } : {}),
      ...(artists.length ? { artist: artists.join(", ") } : {}),
      ...(tagGroups.length ? { tagGroups } : {}),
      ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
    },
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function parseChapters(
  $: CheerioAPI,
  sourceManga: SourceManga,
): { chapters: Chapter[]; cursor?: string } {
  const chapters: Chapter[] = [];
  const section = $('section[aria-labelledby="chapters-heading"]');

  for (const element of section.find('a[href*="/read/"]').toArray()) {
    const unit = $(element);
    const chapterId = releaseFromHref(unit.attr("href"));
    if (!chapterId || !unit.attr("data-unit")) {
      continue;
    }

    const label = unit.attr("aria-label") ?? "";
    const title = text(unit.find("[class*=unitTitle]").first());
    const num = Number(/^\s*([\d.]+)\s*:/.exec(label)?.[1] ?? /([\d.]+)/.exec(title)?.[1]);
    const when = unit.find("time").attr("datetime");
    const date = when ? new Date(when) : undefined;

    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: isNaN(num) ? 0 : num,
      ...(title ? { title } : {}),
      ...(date && !isNaN(date.getTime()) ? { publishDate: date } : {}),
    });
  }

  const next = section
    .find('nav[aria-label="Chapter pages"] a, a[href*="cc="]')
    .toArray()
    .map((a) => $(a))
    .find((a) => /next/i.test(text(a)) || /cc=/.test(a.attr("href") ?? ""));

  return { chapters, cursor: cursorFromHref(next?.attr("href")) };
}

// The full page strip sits inside <noscript>, which cheerio keeps as text, so
// the images are read off the raw markup. Each one is signed and short-lived.
export function parsePages(html: string): string[] {
  const pages = new Map<number, string>();
  const re =
    /<img\b[^>]*\bsrc="(https:\/\/media\.onisaga\.com\/api\/media\/[^"]+)"[^>]*\balt="Page (\d+) of \d+"/g;

  for (const match of html.matchAll(re)) {
    const url = (match[1] ?? "").replace(/&amp;/g, "&");
    const n = Number(match[2]);
    if (url && !isNaN(n) && !pages.has(n)) {
      pages.set(n, url);
    }
  }

  return [...pages].sort((a, b) => a[0] - b[0]).map(([, url]) => url);
}
