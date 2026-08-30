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

  // Each chapter is one object; its fields are read from the object rather than
  // in a fixed order, so a field moving or a new one appearing changes nothing.
  for (const match of html.matchAll(/\\"number\\":(-?[\d.]+)([^{}]{0,600})/g)) {
    const number = match[1] ?? "";
    const body = match[2] ?? "";
    const locked = /\\"isLocked\\":true/.test(body);

    if (!number || seen.has(number) || !/\\"isLocked\\":/.test(body)) {
      continue;
    }

    seen.add(number);

    const price = /\\"coinPrice\\":(-?\d+)/.exec(body);
    const free = /\\"becomesFreeAt\\":\\"([^\\"]+)\\"/.exec(body);

    rows.push({
      number,
      isLocked: locked,
      coinPrice: Number(price?.[1] ?? 0),
      ...(free?.[1] ? { becomesFreeAt: free[1] } : {}),
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
 * Every page image of a chapter, in the order the site numbers them.
 *
 * Two different naming schemes are in use: older chapters are `p0001.webp`,
 * which happens to sort correctly, while revised ones are `p-<uuid>.webp`,
 * which carries no order at all. Neither the filename nor the order the images
 * appear in the markup can be trusted, so the number the site states for each
 * page is used - it is present for both schemes and is what the site itself
 * reads.
 */
export function parsePages(html: string): string[] {
  const pages: { number: number; url: string }[] = [];
  const seen = new Set<number>();

  // The page objects carry the number first and the address a little after it.
  const pattern = /\\"pageNumber\\":(\d+)[^{}]{0,200}?\\"imageUrl\\":\\"([^\\"]+)\\"/g;

  for (const match of html.matchAll(pattern)) {
    const number = Number(match[1]);
    const url = (match[2] ?? "").trim();

    if (!url || !Number.isFinite(number) || seen.has(number)) {
      continue;
    }

    seen.add(number);
    pages.push({ number, url });
  }

  return pages.sort((left, right) => left.number - right.number).map((page) => page.url);
}
