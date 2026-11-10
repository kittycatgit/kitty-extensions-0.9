/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { Chapter, SourceManga } from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import type { LwCard, LwReader } from "./models";

// Listing cards are keyed `serie-<uuid>` by Livewire, which is the only stable
// hook on an otherwise utility-class-only markup.
export function parseCards($: CheerioAPI): LwCard[] {
  const cards: LwCard[] = [];
  const seen = new Set<string>();

  for (const element of $('[wire\\:key^="serie-"]').toArray()) {
    const card = $(element);
    const anchor = card.find('a[href*="/series/"]').first();
    const id = (anchor.attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";
    const title = anchor.attr("title") ?? "";

    if (!id || !title || seen.has(id)) {
      continue;
    }
    seen.add(id);

    // The label repeats the title and appends `[Type][Language]`.
    const label = anchor.attr("aria-label") ?? "";
    const badges = label.slice(title.length).match(/\[([^\]]+)\]/g) ?? [];

    cards.push({
      id,
      title: Application.decodeHTMLEntities(title),
      imageUrl: card.find("img").first().attr("src") ?? "",
      subtitle: badges.map((badge) => badge.replace(/[[\]]/g, "")).join(" · "),
    });
  }

  return cards;
}

export interface SeriesPage {
  title: string;
  imageUrl: string;
  synopsis: string;
  genres: string[];
  status?: string;
  type?: string;
  author?: string;
}

// The series page ships schema.org JSON-LD, which is the only place the genre
// list, the full description and the dates appear together.
export function parseSeriesPage($: CheerioAPI, html: string): SeriesPage {
  let graph: unknown[] = [];

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(script).text()) as { "@graph"?: unknown[] };
      graph = graph.concat(parsed["@graph"] ?? [parsed]);
    } catch {
      // A block that will not parse carries nothing this needs.
    }
  }

  const node = (type: string): Record<string, unknown> | undefined =>
    graph.find(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { "@type"?: string })["@type"] === type,
    );

  const work =
    node("ComicSeries") ?? node("Book") ?? node("CreativeWorkSeries") ?? node("WebPage") ?? {};
  const genres = Array.isArray(work["genre"]) ? (work["genre"] as string[]) : [];

  const meta = (name: string): string =>
    $(`meta[property="${name}"], meta[name="${name}"]`).first().attr("content") ?? "";

  const title =
    (typeof work["name"] === "string" ? work["name"] : "") || $("h1").first().text().trim();

  return {
    title: Application.decodeHTMLEntities(title.replace(/ - English .*$/, "")),
    imageUrl: meta("og:image"),
    synopsis: Application.decodeHTMLEntities(
      (typeof work["description"] === "string" ? work["description"] : meta("description"))
        .replace(/\s+/g, " ")
        .trim(),
    ),
    genres,
    ...(/>(Ongoing|Completed|Hiatus|On hold|Dropped)</.exec(html)
      ? { status: />(Ongoing|Completed|Hiatus|On hold|Dropped)</.exec(html)![1] }
      : {}),
    ...(/>(Webtoon|Manga|Manhwa|Manhua|Comic)</.exec(html)
      ? { type: />(Webtoon|Manga|Manhwa|Manhua|Comic)</.exec(html)![1] }
      : {}),
    ...(typeof (work["author"] as { name?: string } | undefined)?.name === "string"
      ? { author: (work["author"] as { name: string }).name }
      : {}),
  };
}

export function parseChapters(
  $: CheerioAPI,
  sourceManga: SourceManga,
  language: string,
): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  for (const element of $('a[href*="/read/"]').toArray()) {
    const anchor = $(element);
    const id = (anchor.attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";
    const title = anchor.attr("title") ?? anchor.attr("aria-label") ?? "";
    const chapNum = Number(/chapter\s*([\d.]+)/i.exec(title)?.[1] ?? NaN);

    if (!id || isNaN(chapNum) || seen.has(id)) {
      continue;
    }
    seen.add(id);

    chapters.push({
      chapterId: id,
      sourceManga,
      langCode: language,
      chapNum,
      title: Application.decodeHTMLEntities(title),
    });
  }

  return chapters.sort((left, right) => right.chapNum - left.chapNum);
}

// The reader's Livewire snapshot holds the page count and the lock state; the
// first page's own img tag gives the url template, so neither the file
// extension nor the series' media folder has to be guessed.
export function parseReader($: CheerioAPI, html: string): LwReader {
  const snapshots = $("[wire\\:snapshot]").toArray();
  let data: Record<string, unknown> | undefined;

  for (const element of snapshots) {
    try {
      const parsed = JSON.parse($(element).attr("wire:snapshot") ?? "{}") as {
        data?: Record<string, unknown>;
      };

      if (parsed.data && "pageCount" in parsed.data) {
        data = parsed.data;
        break;
      }
    } catch {
      // Not the reader component.
    }
  }

  // Some sites insert a `/revisions/<id>/` folder between the chapter and its
  // numbered files, so anything in between is allowed.
  const firstPage =
    /https:\/\/[^"' ]+\/chapters\/[0-9a-f-]{36}\/(?:[^"' ]*?\/)?0*1\.[a-z]{3,4}/i.exec(html)?.[0] ??
    "";

  return {
    pageCount: Number(data?.["pageCount"] ?? 0),
    firstPage,
    canRead: data?.["canRead"] !== false,
    needsToUnlock: data?.["needsToUnlock"] === true,
    requiresLogin: data?.["requiresLogin"] === true,
    insufficientCoins: data?.["insufficientCoins"] === true,
  };
}

export function parseGenreOptions(html: string): { id: string; title: string }[] {
  const start = /wire:model(?:\.live)?="genre"/.exec(html);

  if (!start) {
    return [];
  }

  const block = html.slice(start.index, start.index + 4000);
  const options: { id: string; title: string }[] = [];

  for (const match of block.matchAll(/value="(\d+)"[^>]*>([^<]{1,40})</g)) {
    options.push({ id: match[1]!, title: Application.decodeHTMLEntities(match[2]!.trim()) });
  }

  return options;
}
