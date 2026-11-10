/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { ApiCard, ApiChapter, ApiPage, ApiSeries } from "./models";

// These sites are Next.js App Router: the data arrives as RSC flight chunks,
// each a JavaScript string literal inside `self.__next_f.push([1,"..."])`.
// Each literal is parsed as JSON so every escape level unwinds exactly once;
// unescaping the html by hand corrupts strings that contain quotes.
export function decodePayload(html: string): string {
  let payload = "";

  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      payload += JSON.parse(match[1]!) as string;
    } catch {
      // A chunk that will not parse carries no data this source needs.
    }
  }

  if (!payload) {
    throw new Error("No flight payload on the page");
  }

  return payload;
}

function balanced(text: string, start: number): string | undefined {
  const open = text[start];

  if (open !== "{" && open !== "[") {
    return undefined;
  }

  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function parseAt<T>(text: string, start: number): T | undefined {
  const slice = balanced(text, start);

  if (!slice) {
    return undefined;
  }

  try {
    return JSON.parse(slice) as T;
  } catch {
    return undefined;
  }
}

// Listing cards are the only objects that open with a cuid id followed by a slug.
export function parseCards(payload: string): ApiCard[] {
  const cards: ApiCard[] = [];
  const seen = new Set<string>();
  const pattern = /\{"id":"[a-z0-9]{20,}","slug":"/g;

  for (const match of payload.matchAll(pattern)) {
    const card = parseAt<ApiCard>(payload, match.index);

    if (!card?.slug || !card.title || seen.has(card.slug)) {
      continue;
    }

    seen.add(card.slug);
    cards.push(card);
  }

  return cards;
}

// The series page carries the whole record under a "series" key, with aliases,
// the original title and the full description the meta tag truncates.
export function parseSeriesObject(payload: string): ApiSeries | undefined {
  for (const match of payload.matchAll(/"series":\{/g)) {
    const series = parseAt<ApiSeries>(payload, match.index + '"series":'.length);

    if (series?.urlSlug || series?.slug) {
      return series;
    }
  }

  return undefined;
}

export function parseTotalPages(payload: string): number {
  return Number(/"totalPages":(\d+)/.exec(payload)?.[1] ?? "1");
}

// Both the series itself and every card on the page carry a "chapters" array,
// so the longest one is the series list.
export function parseChapterList(payload: string): ApiChapter[] {
  let longest: ApiChapter[] = [];

  for (const match of payload.matchAll(/"chapters":/g)) {
    const chapters = parseAt<ApiChapter[]>(payload, match.index + '"chapters":'.length);

    if (chapters && chapters.length > longest.length) {
      longest = chapters;
    }
  }

  return longest.filter((chapter) => typeof chapter.number === "number");
}

export function parsePages(payload: string): ApiPage[] {
  const pages: ApiPage[] = [];
  const seen = new Set<number>();

  for (const match of payload.matchAll(/\{"id":"[a-z0-9]{20,}","pageNumber":/g)) {
    const page = parseAt<ApiPage>(payload, match.index);

    if (!page?.imageUrl || seen.has(page.pageNumber)) {
      continue;
    }

    seen.add(page.pageNumber);
    pages.push(page);
  }

  return pages.sort((left, right) => left.pageNumber - right.pageNumber);
}

export function parseGenres(payload: string): { name: string; slug: string }[] {
  const genres = new Map<string, string>();

  for (const match of payload.matchAll(/"name":"([^"]+)","slug":"([a-z0-9-]+)","count":\d+/g)) {
    genres.set(match[2]!, match[1]!);
  }

  return [...genres].map(([slug, name]) => ({ slug, name }));
}

export function parseMeta(html: string, property: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)="${property}"[^>]+content="([^"]*)"`,
    "i",
  );

  return pattern.exec(html)?.[1] ?? "";
}
