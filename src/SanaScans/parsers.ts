/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";

import type { HomeItem } from "./models";

// Every rail key the home stream carries; a rail's data ends where the next
// key begins.
const STREAM_KEYS = [
  "combinedSliderPosts",
  "todayPosts",
  "weeklyPosts",
  "monthlyPosts",
  "latestMangaPosts",
  "latestNovelPosts",
  "transformedTopSeries",
  "chapterUpdates",
  "publishedCollections",
];

export function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.includes("<") && !value.includes("&")) return value.trim();
  const $ = cheerio.load(value, null, false);
  $("br").replaceWith("\n");
  $("p").after("\n");
  return $.root()
    .text()
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Strings in the stream are JS literals (`\x3C`, `\"`, `’`), not JSON.
function unescapeJs(value: string): string {
  return value.replace(
    /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g,
    (_match: string, code: string): string => {
      if (code.startsWith("x") || code.startsWith("u")) {
        return String.fromCharCode(parseInt(code.slice(1), 16));
      }
      return { n: "\n", t: "\t", r: "\r", "0": "\0" }[code] ?? code;
    },
  );
}

function stringField(item: string, key: string): string | undefined {
  const match = new RegExp(`(?:^|[{,])${key}:"((?:[^"\\\\]|\\\\.)*)"`).exec(item);
  return match ? unescapeJs(match[1]!) : undefined;
}

function numberField(item: string, key: string): number | undefined {
  const match = new RegExp(`(?:^|[{,])${key}:(-?\\d+(?:\\.\\d+)?)`).exec(item);
  return match ? Number(match[1]) : undefined;
}

// Splits the top-level objects of the array that follows `key:` in the stream.
function railItems(stream: string, key: string): string[] {
  const start = stream.indexOf(`${key}:`);
  if (start < 0) {
    throw new Error(`The home page no longer carries "${key}".`);
  }

  let end = stream.length;
  for (const other of STREAM_KEYS) {
    if (other === key) continue;
    const at = stream.indexOf(`${other}:`, start + key.length);
    if (at >= 0 && at < end) end = at;
  }

  // `$R[n]=` assignments decorate every value; drop them so only real brackets remain.
  const segment = stream.slice(start + key.length + 1, end).replace(/\$R\[\d+\]=/g, "");
  const open = segment.indexOf("[");
  if (open < 0) return [];

  const items: string[] = [];
  let depth = 0;
  let itemStart = -1;
  let inString = false;

  for (let i = open; i < segment.length; i++) {
    const char = segment[i]!;

    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[" || char === "{") {
      depth++;
      if (depth === 2 && char === "{") itemStart = i;
    } else if (char === "]" || char === "}") {
      if (depth === 2 && char === "}" && itemStart >= 0) {
        items.push(segment.slice(itemStart, i + 1));
        itemStart = -1;
      }
      depth--;
      if (depth === 0) break;
    }
  }

  return items;
}

function genreNames(item: string): string[] {
  const names: string[] = [];
  for (const match of item.matchAll(/name:"((?:[^"\\]|\\.)*)"/g)) {
    const name = unescapeJs(match[1]!).trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function parseHomeRail(html: string, key: string): HomeItem[] {
  const items: HomeItem[] = [];

  for (const item of railItems(html, key)) {
    const slug = stringField(item, "slug");
    const title = stringField(item, "postTitle") ?? stringField(item, "title");
    if (!slug || !title) continue;

    const summary = stringField(item, "postContent");
    const chapters = /_count:\{chapters:(\d+)/.exec(item);

    items.push({
      slug,
      title: title.trim(),
      cover: stringField(item, "featuredImage") ?? stringField(item, "coverImage") ?? "",
      status: stringField(item, "seriesStatus"),
      type: stringField(item, "seriesType"),
      rating: numberField(item, "averageRating"),
      views: numberField(item, "sumViews"),
      chapters: chapters ? Number(chapters[1]) : undefined,
      summary: summary ? stripHtml(summary) : undefined,
      genres: genreNames(item),
    });
  }

  return items;
}
