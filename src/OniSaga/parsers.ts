/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import { DOMAIN, FALLBACK_COVER, STATUS_LABELS } from "./models";

function absolute(url: string | undefined): string {
  if (!url) {
    return "";
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function slugFromHref(href: string | undefined): string | undefined {
  return href?.match(/\/manga\/([^/?#]+)/)?.[1];
}

export function chapterIdFromHref(href: string | undefined): string | undefined {
  return href?.match(/\/read\/[^/]+\/([^/?#]+)/)?.[1];
}

// The cover sits outside the anchor, in the card wrapper. Stop after two levels
// up or a card picks up its neighbour's image.
function coverNear($: CheerioAPI, link: ReturnType<CheerioAPI>): { src?: string; alt?: string } {
  const read = (scope: ReturnType<CheerioAPI>): { src?: string; alt?: string } | undefined => {
    const image = scope.find("img").first();

    if (image.length === 0) {
      return undefined;
    }

    const src = image.attr("src") ?? image.attr("data-src") ?? image.attr("data-lazy-src");
    return { ...(src ? { src } : {}), ...(image.attr("alt") ? { alt: image.attr("alt") } : {}) };
  };

  const own = read(link);

  if (own?.src) {
    return own;
  }

  let node = link.parent();

  for (let level = 0; level < 2 && node.length > 0; level += 1) {
    const found = read(node);

    if (found?.src) {
      return found;
    }

    node = node.parent();
  }

  return own ?? {};
}

function cleanTitle(value: string | undefined): string | undefined {
  const cleaned = (value ?? "")
    // Alt text is the title plus a label: "… manga cover" or "… cover".
    .replace(/\s*(?:manga\s*)?cover\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Card buttons share the series link; their labels are not titles.
  return cleaned && !/^(read now|read|continue)$/i.test(cleaned) ? cleaned : undefined;
}

// A card links to its series from the cover, the title and a "Read Now" button,
// and the button comes first, so merge every anchor for a slug.
export function parseListing($: CheerioAPI): SearchResultItem[] {
  const found = new Map<string, { title?: string; imageUrl?: string }>();
  const order: string[] = [];

  for (const element of $('a[href*="/manga/"]').toArray()) {
    const link = $(element);
    const slug = slugFromHref(link.attr("href"));

    if (!slug) {
      continue;
    }

    if (!found.has(slug)) {
      found.set(slug, {});
      order.push(slug);
    }

    const entry = found.get(slug)!;

    const cover = coverNear($, link);

    if (!entry.imageUrl && cover.src) {
      entry.imageUrl = absolute(cover.src);
    }

    if (!entry.title) {
      entry.title =
        cleanTitle(link.attr("title")) ?? cleanTitle(cover.alt) ?? cleanTitle(link.text());
    }
  }

  const items: SearchResultItem[] = [];

  for (const slug of order) {
    const entry = found.get(slug)!;

    if (!entry.title) {
      continue;
    }

    items.push({
      mangaId: slug,
      title: entry.title,
      imageUrl: entry.imageUrl || FALLBACK_COVER,
    });
  }

  return items;
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
  const meta = (property: string): string | undefined =>
    $(`meta[property="${property}"]`).attr("content")?.trim() ||
    $(`meta[name="${property}"]`).attr("content")?.trim();

  const title = $("h1").first().text().replace(/\s+/g, " ").trim() || mangaId;

  const tags: Tag[] = [];
  const seenGenre = new Set<string>();
  for (const element of $('a[href*="/genre/"]').toArray()) {
    const anchor = $(element);
    const id = anchor.attr("href")?.match(/\/genre\/([^/?#]+)/)?.[1];
    const label = anchor.text().replace(/\s+/g, " ").trim();

    if (id && label && !seenGenre.has(id)) {
      seenGenre.add(id);
      tags.push({ id, title: label });
    }
  }

  // The "Authors" heading is itself an author link; skip it.
  const authors: string[] = [];
  for (const element of $('a[href*="/author"]').toArray()) {
    const name = $(element).text().replace(/\s+/g, " ").trim();
    if (name && !/^authors?$/i.test(name) && !authors.includes(name)) {
      authors.push(name);
    }
  }

  const statusText = $("*")
    .filter((_, element) => {
      const node = $(element);
      return (
        node.children().length === 0 &&
        /^(ongoing|completed|hiatus|cancelled|dropped)$/i.test(node.text().trim())
      );
    })
    .first()
    .text()
    .trim()
    .toLowerCase();

  const chapterCount = $('a[href*="/read/"]').length;
  const additionalInfo: Record<string, string> = {};
  if (chapterCount > 0) {
    additionalInfo["Chapters"] = String(chapterCount);
  }

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl: absolute(meta("og:image")),
      synopsis: (meta("og:description") ?? "").trim(),
      contentRating: ContentRating.MATURE,
      ...(statusText ? { status: STATUS_LABELS[statusText] ?? statusText } : {}),
      ...(authors.length > 0 ? { author: authors.join(", ") } : {}),
      ...(tags.length > 0 ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
      ...(Object.keys(additionalInfo).length > 0 ? { additionalInfo } : {}),
      shareUrl: `${DOMAIN}/manga/${mangaId}`,
    },
  };
}

function parseRelativeDate(text: string): Date | undefined {
  const match = text.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);

  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };

  const ms = unitMs[match[2]!.toLowerCase()];
  return ms ? new Date(Date.now() - amount * ms) : undefined;
}

// Rows print the page count as "21p".
export function pageCountFromRow(text: string): number | undefined {
  const match = text.match(/(\d+)\s*p\b/i);
  return match ? Number(match[1]) : undefined;
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const rows: { chapter: Chapter; pages?: number }[] = [];
  const seen = new Set<string>();

  for (const element of $('a[href*="/read/"]').toArray()) {
    const anchor = $(element);
    const chapterId = chapterIdFromHref(anchor.attr("href"));

    if (!chapterId || seen.has(chapterId)) {
      continue;
    }

    const text = anchor.text().replace(/\s+/g, " ").trim();
    const chapNum = Number(
      text.match(/chapter\s*([\d.]+)/i)?.[1] ?? text.match(/^([\d.]+)\b/)?.[1] ?? 0,
    );
    const volume = text.match(/vol\.?\s*([\d.]+)/i)?.[1];
    const published = parseRelativeDate(text);
    const pages = pageCountFromRow(text);

    seen.add(chapterId);
    rows.push({
      chapter: {
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum,
        ...(volume ? { volume: Number(volume) } : {}),
        ...(published ? { publishDate: published } : {}),
        ...(pages ? { additionalInfo: { pages: String(pages) } } : {}),
      },
      ...(pages ? { pages } : {}),
    });
  }

  const sorted = rows.sort((a, b) => b.chapter.chapNum - a.chapter.chapNum);

  return sorted.map((row, index) => ({ ...row.chapter, sortingIndex: sorted.length - index }));
}
