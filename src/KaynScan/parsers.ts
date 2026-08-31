/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { KaynChapter } from "./models";

// The chapter list never reaches the markup: it is streamed inside the framework
// payload as JSON with escaped quotes, hence the `\\"` in every pattern below.
export function parseChapters(html: string): KaynChapter[] {
  const rows: KaynChapter[] = [];
  const seen = new Set<string>();

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
      // Not JSON, so not the block we are after.
    }
  }

  return { genres: [] };
}

// Filenames come in two schemes (`p0001.webp` and `p-<uuid>.webp`) and neither the
// name nor the order in the payload is reliable, so sort on the stated pageNumber.
export function parsePages(html: string): string[] {
  const pages: { number: number; url: string }[] = [];
  const seen = new Set<number>();

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
