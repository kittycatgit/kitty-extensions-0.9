/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { DOMAIN, seriesUrl } from "./models";

// An empty imageUrl empties the whole row, so point coverless titles at a path
// the host will not serve and let the app draw its placeholder.
const MISSING_COVER = `${DOMAIN}/img/none`;

export type Card = SearchResultItem & { chapterId?: string };

export function slugOf(href: string): string {
  return (href ?? "").split(/[?#]/)[0]!.replace(/\/$/, "").split("/").pop()!.trim();
}

function absolute(url: string): string {
  const trimmed = url.trim();

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return trimmed.startsWith("/") ? `${DOMAIN}${trimmed}` : trimmed;
}

function text(node: Cheerio<Element>): string {
  return Application.decodeHTMLEntities(node.text().replace(/\s+/g, " ").trim());
}

function cover(node: Cheerio<Element>): string {
  const src = (node.first().attr("src") ?? "").trim();

  return src && !src.startsWith("data:") ? absolute(src) : MISSING_COVER;
}

// React streams each Suspense boundary as an empty <template id="P:x"> (or
// "B:x") whose markup lands later in <div hidden id="S:x">. Splicing the
// chunks back into place lets ordinary selectors see the whole page.
export function hydrate($: CheerioAPI): CheerioAPI {
  for (let pass = 0; pass < 20; pass += 1) {
    const chunks = $('div[hidden][id^="S:"]').toArray();

    if (chunks.length === 0) {
      break;
    }

    for (const chunk of chunks) {
      const id = ($(chunk).attr("id") ?? "").slice(2);
      const slot = $(`template[id="P:${id}"], template[id="B:${id}"]`).first();

      if (slot.length) {
        slot.replaceWith($(chunk).contents());
      }

      $(chunk).remove();
    }
  }

  return $;
}

// The RSC payload arrives as JS string literals pushed into self.__next_f;
// joined, it holds the data the client components render from.
export function flight(html: string): string {
  const parts: string[] = [];

  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    parts.push(JSON.parse(`"${match[1]}"`) as string);
  }

  return parts.join("");
}

// Returns the JSON array that follows `"key":` in the payload, matching
// brackets so nested objects and bracketed strings do not cut it short.
export function jsonArrayAfter<T>(payload: string, key: string): T[] {
  const start = payload.indexOf(`"${key}":[`);

  if (start < 0) {
    return [];
  }

  let index = start + key.length + 3;
  let depth = 0;
  let quoted = false;

  for (; index < payload.length; index += 1) {
    const char = payload[index];

    if (quoted) {
      if (char === "\\") {
        index += 1;
      } else if (char === '"') {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === "[" || char === "{") {
      depth += 1;
    } else if (char === "]" || char === "}") {
      depth -= 1;

      if (depth === 0) {
        break;
      }
    }
  }

  return JSON.parse(payload.slice(start + key.length + 3, index + 1)) as T[];
}

// Chapter rows only say "19 days" or "1 month"; the number anchors them.
export function relativeDate(label: string): Date | undefined {
  const now = Date.now();

  if (/^(just now|now|today|new)$/i.test(label.trim())) {
    return new Date(now);
  }

  const match = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(label);

  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit: Record<string, number> = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };

  return new Date(now - amount * unit[match[2]!.toLowerCase()]!);
}

// "Ch. 61" plus whatever time label sits beside it, minus the NEW badge.
function chapterLabel($: CheerioAPI, link: Element): string {
  const spans = $("span", link)
    .toArray()
    .map((span) => text($(span)))
    .filter((value) => value && !/^new$/i.test(value));

  return spans.join(" · ");
}

function card(
  $: CheerioAPI,
  mangaId: string,
  title: string,
  image: Cheerio<Element>,
  chapterLink: Cheerio<Element>,
): Card {
  const chapterId = slugOf(chapterLink.attr("href") ?? "");
  const subtitle = chapterLink.length ? chapterLabel($, chapterLink.get(0)!) : "";

  return {
    mangaId,
    title,
    imageUrl: cover(image),
    ...(subtitle ? { subtitle } : {}),
    ...(chapterId ? { chapterId } : {}),
  };
}

// Search listing: a cover link holding the h3, then the chapter links beside it.
export function parseSearch($: CheerioAPI): Card[] {
  const results: Card[] = [];
  const seen = new Set<string>();

  for (const heading of $('main a[href^="/series/"] h3').toArray()) {
    const link = $(heading).closest("a");
    const mangaId = slugOf(link.attr("href") ?? "");
    const title = Application.decodeHTMLEntities(
      ($(heading).attr("title") ?? "").trim() || text($(heading)),
    );

    if (!mangaId || !title || seen.has(mangaId)) {
      continue;
    }

    seen.add(mangaId);
    results.push(
      card(
        $,
        mangaId,
        title,
        $("img", link),
        link.parent().find(`a[href^="/series/${mangaId}/"]`).not(link).first() as Cheerio<Element>,
      ),
    );
  }

  return results;
}

// Home "Latest releases": one <article> per series, rendered once for each
// layout, so the slug dedupes.
export function parseLatest($: CheerioAPI): Card[] {
  const results: Card[] = [];
  const seen = new Set<string>();

  for (const article of $("main article").toArray()) {
    const link = $('a[title][href^="/series/"]', article).first();
    const mangaId = slugOf(link.attr("href") ?? "");
    const title = Application.decodeHTMLEntities((link.attr("title") ?? "").trim());

    if (!mangaId || !title || seen.has(mangaId)) {
      continue;
    }

    seen.add(mangaId);
    results.push(
      card(
        $,
        mangaId,
        title,
        $("img", article),
        $(`a[href^="/series/${mangaId}/"]`, article)
          .not(link)
          .filter("[href*='-chapter-']")
          .first(),
      ),
    );
  }

  return results;
}

// Home "Top 10 this week": cover links whose caption is a titled <p>.
export function parseTop($: CheerioAPI): Card[] {
  const results: Card[] = [];
  const section = $("main h3")
    .filter((_, element) => /top 10/i.test($(element).text()))
    .closest("section");

  for (const caption of $('a[href^="/series/"] p[title]', section).toArray()) {
    const link = $(caption).closest("a");
    const mangaId = slugOf(link.attr("href") ?? "");
    const title = Application.decodeHTMLEntities(($(caption).attr("title") ?? "").trim());

    if (mangaId && title && !results.some((item) => item.mangaId === mangaId)) {
      results.push({
        mangaId,
        title,
        imageUrl: cover($("img", link)),
        subtitle: `#${results.length + 1}`,
      });
    }
  }

  return results;
}

type FeaturedEntry = { title?: string; slug?: string; cover_url?: string; excerpt?: string };

// The hero carousel only links its first slide; the rest live in the payload.
export function parseFeatured(payload: string): Card[] {
  const results: Card[] = [];

  for (const entry of jsonArrayAfter<FeaturedEntry>(payload, "items")) {
    if (entry.slug && entry.title && !results.some((item) => item.mangaId === entry.slug)) {
      results.push({
        mangaId: entry.slug,
        title: entry.title,
        imageUrl: entry.cover_url ? absolute(entry.cover_url) : MISSING_COVER,
        ...(entry.excerpt ? { subtitle: entry.excerpt } : {}),
      });
    }
  }

  return results;
}

export function parseGenreCloud($: CheerioAPI): Tag[] {
  const genres: Tag[] = [];

  for (const link of $('main nav a[href*="genre="]').toArray()) {
    const id = /genre=([^&]+)/.exec($(link).attr("href") ?? "")?.[1] ?? "";
    const title = text($(link));

    if (id && title && !genres.some((genre) => genre.id === id)) {
      genres.push({ id: decodeURIComponent(id), title });
    }
  }

  return genres;
}

// The search page's genre dropdown carries every genre with its count.
export function parseGenres($: CheerioAPI): Tag[] {
  const genres: Tag[] = [];

  for (const option of $("main select option[value]").toArray()) {
    const id = ($(option).attr("value") ?? "").trim();
    const title = text($(option)).replace(/\s*\(\d+\)$/, "");

    if (id && title && !genres.some((genre) => genre.id === id)) {
      genres.push({ id, title });
    }
  }

  return genres.sort((a, b) => a.title.localeCompare(b.title));
}

export function ratingOf(genres: Tag[]): ContentRating {
  if (
    genres.some((genre) =>
      /^(adult|erotica|hentai|smut|sexual-violence|pornographic)$/.test(genre.id),
    )
  ) {
    return ContentRating.ADULT;
  }

  if (genres.some((genre) => /^(ecchi|mature|suggestive|gore)$/.test(genre.id))) {
    return ContentRating.MATURE;
  }

  return ContentRating.EVERYONE;
}

export function parseSeries($: CheerioAPI, mangaId: string): SourceManga {
  const main = $("main");
  const heading = main.find("h1").first();
  const title = text(heading);

  if (!title) {
    throw new Error(`No series found for ${mangaId}.`);
  }

  // "Author · art by Artist" sits right under the title.
  const credits = text(heading.parent().next("p"));
  const [author = "", artist = ""] = credits.split(/\s*·\s*art by\s*/i);

  const facts: Record<string, string> = {};
  for (const row of main.find("dl dt").toArray()) {
    facts[text($(row))] = text($(row).next("dd"));
  }

  const synopsis = Application.decodeHTMLEntities(
    main.find("dl").first().next("div").text().trim(),
  );

  const genres: Tag[] = [];
  for (const link of main.find('a[href*="/search/?genre="]').toArray()) {
    const id = /genre=([^&]+)/.exec($(link).attr("href") ?? "")?.[1] ?? "";
    const name = text($(link));

    if (id && name && !genres.some((genre) => genre.id === id)) {
      genres.push({ id: decodeURIComponent(id), title: name });
    }
  }

  const group = text(main.find("p:contains('Translated by') span").first());
  const additionalInfo: Record<string, string> = {};
  for (const key of ["Chapters", "Volumes", "Views"]) {
    if (facts[key]) {
      additionalInfo[key] = facts[key];
    }
  }

  if (group) {
    additionalInfo["Translated by"] = group;
  }

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl: cover(main.find("img").first() as Cheerio<Element>),
      synopsis,
      contentRating: ratingOf(genres),
      contentType: "comic",
      status: facts["Status"] || "Unknown",
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      ...(genres.length ? { tagGroups: [{ id: "genres", title: "Genres", tags: genres }] } : {}),
      additionalInfo,
      shareUrl: seriesUrl(mangaId),
    },
  };
}

type ChapterEntry = {
  slug?: string;
  chapter_no?: string | number;
  subtitle?: string | null;
  volume_id?: number | null;
  time_ago?: string;
  sort_key?: number;
};

type VolumeEntry = { id?: number; name?: string };

// The chapter table is a client component fed every chapter through the
// payload, so the page needs no paging.
export function parseChapters(payload: string, sourceManga: SourceManga): Chapter[] {
  const volumes = new Map<number, number>();
  for (const volume of jsonArrayAfter<VolumeEntry>(payload, "volumes")) {
    const number = Number(/(\d+(?:\.\d+)?)/.exec(volume.name ?? "")?.[1]);

    if (volume.id !== undefined && Number.isFinite(number)) {
      volumes.set(volume.id, number);
    }
  }

  const entries = jsonArrayAfter<ChapterEntry>(payload, "chapters").filter((entry) => entry.slug);
  entries.sort((left, right) => (right.sort_key ?? 0) - (left.sort_key ?? 0));

  return entries.map((entry, index) => {
    const number = Number(entry.chapter_no);
    const published = relativeDate(entry.time_ago ?? "");
    const volume =
      entry.volume_id === null || entry.volume_id === undefined
        ? undefined
        : volumes.get(entry.volume_id);

    return {
      chapterId: entry.slug!,
      sourceManga,
      langCode: "en",
      chapNum: Number.isFinite(number) ? number : 0,
      sortingIndex: entries.length - index,
      ...(entry.subtitle ? { title: entry.subtitle } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(published ? { publishDate: published } : {}),
    };
  });
}

export function parsePages(payload: string): string[] {
  const pages: string[] = [];

  for (const page of jsonArrayAfter<{ url?: string }>(payload, "pages")) {
    if (page.url && !pages.includes(absolute(page.url))) {
      pages.push(absolute(page.url));
    }
  }

  return pages;
}
