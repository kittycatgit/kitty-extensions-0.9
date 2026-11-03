/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type Chapter, type SourceManga, type Tag } from "@paperback/types";
import * as cheerio from "cheerio";

import {
  DOMAIN,
  type ApiTitle,
  type FlightRef,
  type FlightSeries,
  type HomeData,
  type HomeItem,
} from "./models";

// Covers are gated by the CDN; this is a stable site asset the app can show.
export const FALLBACK_COVER = `${DOMAIN}/sites/lgbtoon/logo.png`;

const PUSH_RE = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

/** Joins the RSC flight chunks a Next.js page streams into one string. */
export function flightText(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(PUSH_RE)) {
    parts.push(JSON.parse(match[1] ?? '""') as string);
  }
  return parts.join("");
}

/** Pulls the JSON object or array following `"key":` out of flight text. */
export function flightValue<T>(flight: string, key: string): T {
  const marker = `"${key}":`;
  const at = flight.indexOf(marker);
  if (at < 0) {
    throw new Error(`No ${key} in the page data`);
  }

  const start = at + marker.length;
  const open = flight.charAt(start);
  const close = open === "[" ? "]" : "}";
  if (open !== "[" && open !== "{") {
    throw new Error(`Unexpected ${key} in the page data`);
  }

  let depth = 0;
  let inString = false;

  for (let i = start; i < flight.length; i++) {
    const c = flight.charAt(i);
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      return JSON.parse(flight.slice(start, i + 1)) as T;
    }
  }

  throw new Error(`Unterminated ${key} in the page data`);
}

export function parseHome(html: string): HomeData {
  const data = flightValue<HomeData>(flightText(html), "initialData");
  if (!data.trending?.day?.length || !data.latest?.hot?.length) {
    throw new Error("The home page data has no rails");
  }
  return data;
}

export function parseSeries(html: string): { series: FlightSeries; synopsis: string } {
  const series = flightValue<FlightSeries>(flightText(html), "initialDetail");
  if (!series.hid || !series.title) {
    throw new Error("The series page data is incomplete");
  }
  // synopsisHtml is a flight reference, so the text comes from the markup.
  const synopsis = cheerio.load(html)(".title-detail__synopsis").text().trim();
  return { series, synopsis };
}

// Only the first two pages are SSR'd as <img>; the full list is streamed as
// the reader's initialPages prop.
export function parsePages(html: string): string[] {
  if (/<title>[^<]*Chapter Not Found/i.test(html)) {
    throw new Error("The site has no such chapter");
  }

  const pages = flightValue<unknown[]>(flightText(html), "initialPages");
  return pages.filter((p): p is string => typeof p === "string" && p.startsWith("http"));
}

export function parseGenreIndex(html: string): Tag[] {
  const $ = cheerio.load(html);
  const tags: Tag[] = [];
  $('a[href^="/browse?genre="]').each((_, a) => {
    const slug = $(a).attr("href")?.split("genre=")[1]?.trim();
    const name = $(a).find(".dir-page__pill-name").text().trim();
    if (slug && name) tags.push({ id: slug, title: name });
  });
  return tags;
}

/** `/title/<slug>-<id>` → `<slug>-<id>`, the id the extension uses everywhere. */
export function mangaIdFromHref(href: string): string {
  return (
    href
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/title\//, "")
      .split(/[?#]/)[0] ?? ""
  );
}

// Chapter dates only exist as "4d ago"-style text, so they are approximate.
const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
  y: 31_536_000_000,
};

export function relativeDate(text: string | undefined): Date | undefined {
  const match = /^(\d+)\s*(mo|m|h|d|w|y)\s*ago$/i.exec((text ?? "").trim());
  if (!match) {
    return /just now/i.test(text ?? "") ? new Date() : undefined;
  }
  return new Date(Date.now() - Number(match[1]) * (UNIT_MS[match[2]!.toLowerCase()] ?? 0));
}

export function ratingOf(is18plus: boolean | undefined, level?: string): ContentRating {
  if (is18plus || level === "erotica" || level === "pornographic") return ContentRating.ADULT;
  return level === "safe" ? ContentRating.EVERYONE : ContentRating.MATURE;
}

const STATUS_LABELS: Record<string, string> = {
  releasing: "Ongoing",
  finished: "Completed",
  on_hiatus: "Hiatus",
  discontinued: "Cancelled",
  not_yet_released: "Not yet released",
};

export function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function names(refs: FlightRef[] | undefined): string[] {
  return (refs ?? []).map((ref) => ref.title.trim()).filter(Boolean);
}

function tagsOf(refs: FlightRef[] | undefined): Tag[] {
  return names(refs).map((name) => ({
    id: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    title: name,
  }));
}

export function toSourceManga(
  mangaId: string,
  series: FlightSeries,
  synopsis: string,
): SourceManga {
  const chapterNumbers = new Set((series.chapters ?? []).map((c) => c.number));
  const info: Record<string, string> = {};
  if (series.typeLabel) info["Type"] = series.typeLabel;
  if (series.subgenre) info["Category"] = series.subgenre;
  if (series.year) info["Year"] = String(series.year);
  if (series.contentRating) info["Content rating"] = series.contentRating;
  if (typeof series.ratingCount === "number") info["Ratings"] = withCommas(series.ratingCount);
  if (typeof series.follows === "number") info["Follows"] = withCommas(series.follows);
  if (chapterNumbers.size) info["Chapters"] = String(chapterNumbers.size);

  const tagGroups = [
    { id: "genres", title: "Genres", tags: tagsOf(series.genres) },
    { id: "themes", title: "Themes", tags: tagsOf(series.themes) },
    { id: "demographics", title: "Demographics", tags: tagsOf(series.demographics) },
  ].filter((group) => group.tags.length > 0);

  const author = names(series.authors).join(", ");
  const artist = names(series.artists).join(", ");

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: series.title.trim(),
      secondaryTitles: (series.altTitles ?? []).map((t) => t.trim()).filter(Boolean),
      thumbnailUrl: series.poster || FALLBACK_COVER,
      ...(series.banner ? { bannerUrl: series.banner } : {}),
      synopsis,
      contentRating: ratingOf(series.is18plus, series.contentRating),
      status: STATUS_LABELS[series.status ?? ""] ?? series.status ?? "Unknown",
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      ...(typeof series.rating === "number" ? { rating: series.rating / 5 } : {}),
      // The site only hosts vertical strips, so a missing type still reads as one.
      tagGroups,
      additionalInfo: info,
      shareUrl: `${DOMAIN}/title/${mangaId}`,
    },
  };
}

// Every scanlation source is listed per number; the number route renders the
// first one, so that entry is the chapter.
export function toChapters(series: FlightSeries, sourceManga: SourceManga): Chapter[] {
  const seen = new Set<number>();
  const chapters: Chapter[] = [];

  for (const row of series.chapters ?? []) {
    if (typeof row.number !== "number" || seen.has(row.number)) continue;
    seen.add(row.number);

    const name = (row.name ?? "").trim();
    const restates = new RegExp(`^(chapter|chap|ch)\\.?\\s*${row.number}$`, "i").test(name);
    const published = relativeDate(row.date);

    chapters.push({
      chapterId: String(row.number),
      sourceManga,
      langCode: "en",
      chapNum: row.number,
      sortingIndex: row.number,
      ...(name && !restates ? { title: name } : {}),
      ...(published ? { publishDate: published } : {}),
    });
  }

  return chapters.sort((a, b) => b.chapNum - a.chapNum);
}

export function apiSubtitle(item: ApiTitle): string | undefined {
  const bits = [item.latestChapter?.trim(), item.status?.trim()].filter(Boolean);
  return bits.length ? bits.join(" • ") : undefined;
}

export function homeSubtitle(item: HomeItem): string | undefined {
  const bits = [item.chapter?.trim(), item.timeAgo?.trim()].filter(Boolean);
  return bits.length ? bits.join(" • ") : undefined;
}
