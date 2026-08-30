/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { KaynChapter } from "./models";

/**
 * The chapters a series page carries.
 *
 * The page is rendered on the server and its chapter list never reaches the
 * markup - only one link does. The data is streamed instead inside the
 * framework's own payload, as JSON with its quotes escaped, which is why it has
 * to be unescaped before it can be read. Reading that is less fragile than it
 * sounds: the objects are complete and self-describing, and a shape change
 * shows up as no chapters rather than as wrong ones.
 */
export function parseChapters(html: string): KaynChapter[] {
  const rows: KaynChapter[] = [];
  const seen = new Set<string>();

  // Each chapter arrives as an object carrying at least a number and whether it
  // has to be paid for.
  const pattern =
    /\\"number\\":(-?[\d.]+)[^{}]*?\\"isLocked\\":(true|false)[^{}]*?\\"coinPrice\\":(-?\d+)/g;

  for (const match of html.matchAll(pattern)) {
    const number = match[1] ?? "";

    if (!number || seen.has(number)) {
      continue;
    }

    seen.add(number);
    rows.push({
      number,
      isLocked: match[2] === "true",
      coinPrice: Number(match[3] ?? 0),
    });
  }

  return rows;
}

/**
 * The series' own description, as the page states it for search engines.
 *
 * Taken from the page's structured data rather than its markup: it is the same
 * information the site shows, in a form that does not move when the layout
 * does.
 */
export function parseBook(html: string): {
  title?: string;
  description?: string;
  image?: string;
  author?: string;
  genres: string[];
  rating?: number;
} {
  const blocks = [
    ...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1] ?? "") as Record<string, unknown>;

      if (parsed["@type"] !== "Book") {
        continue;
      }

      const author = parsed["author"] as { name?: string } | undefined;
      const rating = parsed["aggregateRating"] as { ratingValue?: number | string } | undefined;
      const genre = parsed["genre"];

      return {
        title: typeof parsed["name"] === "string" ? parsed["name"] : undefined,
        description: typeof parsed["description"] === "string" ? parsed["description"] : undefined,
        image: typeof parsed["image"] === "string" ? parsed["image"] : undefined,
        author: typeof author?.name === "string" ? author.name : undefined,
        genres: Array.isArray(genre) ? genre.filter((g): g is string => typeof g === "string") : [],
        rating: rating?.ratingValue === undefined ? undefined : Number(rating.ratingValue),
      };
    } catch {
      // A block that will not parse is not the one we want.
    }
  }

  return { genres: [] };
}

/**
 * Every page image of a chapter, in order.
 *
 * The reader lazy-loads them, so the browser only ever holds a handful - but
 * the server sends all of them in the HTML, addressed by a zero-padded page
 * number that sorts correctly as text.
 */
export function parsePages(html: string): string[] {
  const found = new Set<string>();

  for (const match of html.matchAll(/\/uploads\/series\/[^"'\\\s)]+?\/p\d+\.[a-z]{3,4}/gi)) {
    found.add(match[0]);
  }

  return [...found].sort((left, right) => left.localeCompare(right));
}
