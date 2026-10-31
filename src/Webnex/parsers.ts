/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { DOMAIN, seriesUrl } from "./models";

// An empty imageUrl empties the whole row, so point coverless titles at a path
// the host will not serve and let the app draw its placeholder.
const MISSING_COVER = `${DOMAIN}/cover/none.webp`;

// Genre and tag names carry spaces and apostrophes, which ids may not; percent
// encoding is reversible and only uses characters the bridge accepts.
export function idOf(name: string): string {
  return encodeURIComponent(name).replace(
    /[!'()*~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function nameOf(id: string): string {
  return decodeURIComponent(id);
}

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

// React streams each Suspense boundary as an empty <template id="P:x"> whose
// markup lands later in <div hidden id="S:x">, so a node's children can sit
// anywhere in the document. This follows the placeholders.
export function resolved($: CheerioAPI, root: Cheerio<Element>, selector: string): Element[] {
  const found = root.find(selector).toArray();
  const queue = root.find('template[id^="P:"]').toArray();
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = ($(queue.shift()!).attr("id") ?? "").slice(2);

    if (!id || visited.has(id)) {
      continue;
    }

    visited.add(id);

    const chunk = $(`div[hidden][id="S:${id}"]`);
    found.push(...chunk.find(selector).toArray());
    queue.push(...chunk.find('template[id^="P:"]').toArray());
  }

  return found;
}

function cover($: CheerioAPI, element: Element): string {
  const src = ($("img.cover-img", element).first().attr("src") ?? "").trim();

  return src ? absolute(src) : MISSING_COVER;
}

export type Card = SearchResultItem & { chapterId?: string; rank?: number };

export function parseCards($: CheerioAPI, root: Cheerio<Element>): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  for (const element of resolved($, root, "li.card-item")) {
    const mangaId = slugOf($("a.card-link", element).first().attr("href") ?? "");
    const title = text($("h3.card-title", element).first());

    if (!mangaId || !title || seen.has(mangaId)) {
      continue;
    }

    seen.add(mangaId);

    const latest = $("ul.card-chapters a", element).first();
    const label =
      text(latest.find("span.card-ch-label")) || text($("p.card-meta span", element).first());
    const when =
      text(latest.find("span.card-ch-time")) || text($("p.card-meta time", element).first());
    const chapterId = slugOf(latest.attr("href") ?? "");
    const rank = Number(text($("span.card-rank", element).first()));
    const subtitle = [label, when].filter(Boolean).join(" · ");

    cards.push({
      mangaId,
      title,
      imageUrl: cover($, element),
      ...(subtitle ? { subtitle } : {}),
      ...(chapterId ? { chapterId } : {}),
      ...(Number.isFinite(rank) && rank > 0 ? { rank } : {}),
    });
  }

  return cards.sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity));
}

export function homeSection($: CheerioAPI, heading: string): Cheerio<Element> {
  return $(`section[aria-labelledby="${heading}"]`).first();
}

export function parseGenreCloud($: CheerioAPI): Tag[] {
  const genres: Tag[] = [];

  for (const element of $("ul.genre-cloud a.chip").toArray()) {
    const name = text($(element));

    if (name && !genres.some((genre) => genre.title === name)) {
      genres.push({ id: idOf(name), title: name });
    }
  }

  return genres;
}

// The listing renders its failure inline rather than failing the request.
export function catalogError($: CheerioAPI): string | undefined {
  const notice = text(
    $("section.browse p.notice-error, section.browse .notice.notice-error").first(),
  );

  return /could not load/i.test(notice) ? notice : undefined;
}

function ratingOf(label: string, tags: string[]): ContentRating {
  if (
    /^18\+$|erotica/i.test(label) ||
    tags.some((tag) => /^(\+18|18\+|adult|smut|hentai|pornographic|erotica)$/i.test(tag))
  ) {
    return ContentRating.ADULT;
  }

  if (/suggestive/i.test(label) || tags.some((tag) => /^(mature|ecchi|gore)$/i.test(tag))) {
    return ContentRating.MATURE;
  }

  return ContentRating.EVERYONE;
}

export function parseSeries($: CheerioAPI, mangaId: string): SourceManga {
  const title = text($("h1.series-title").first());

  if (!title) {
    throw new Error(`webnex.cc returned no series page for ${mangaId}.`);
  }

  const secondaryTitles = [
    text($("p.series-native").first()),
    ...$("details.series-more li")
      .toArray()
      .map((element) => text($(element))),
  ].filter((name, index, all) => name && name !== title && all.indexOf(name) === index);

  let author: string | undefined;
  let artist: string | undefined;

  for (const element of $("p.series-credits > span").toArray()) {
    const names = $("a", element)
      .toArray()
      .map((link) => text($(link)))
      .filter(Boolean)
      .join(", ");
    const label = text($(element));

    if (/^art by/i.test(label)) {
      artist = names;
    } else if (/^by/i.test(label)) {
      author = names;
    }
  }

  const facts = $("p.series-facts").first();
  const status = text(facts.find("span.fact-status"));
  const kind = text(facts.find('a[href*="kind="]'));
  const year = text(facts.find('a[href*="from="]'));
  const ratingLabel =
    facts
      .find("span")
      .toArray()
      .map((element) => text($(element)))
      .find((value) => /^(18\+|erotica|suggestive|safe)$/i.test(value)) ?? "";
  const language = facts
    .find("span")
    .toArray()
    .map((element) => text($(element)))
    .find((value) => value && value !== status && value !== ratingLabel && !/^(18\+)$/.test(value));

  const genres: Tag[] = [];
  const tags: Tag[] = [];

  for (const element of $("ul.tag-cloud a.chip").toArray()) {
    const name = text($(element));
    const href = $(element).attr("href") ?? "";
    const list = /[?&]genre=/.test(href) ? genres : tags;

    if (name && !list.some((tag) => tag.title === name)) {
      list.push({ id: idOf(name), title: name });
    }
  }

  const tagGroups: TagSection[] = [];

  if (genres.length > 0) {
    tagGroups.push({ id: "genres", title: "Genres", tags: genres });
  }

  if (tags.length > 0) {
    tagGroups.push({ id: "tags", title: "Tags", tags });
  }

  const thumbnail = ($("div.series-cover img").first().attr("src") ?? "").trim();
  const additionalInfo: Record<string, string> = {};

  for (const [key, value] of [
    ["Type", kind],
    ["Year", year],
    ["Language", language ?? ""],
    ["Chapters", text($("dl.series-numbers dt:contains(Chapters) + dd").first())],
  ]) {
    if (value) {
      additionalInfo[key!] = value;
    }
  }

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles,
      thumbnailUrl: thumbnail ? absolute(thumbnail) : MISSING_COVER,
      ...(thumbnail ? { bannerUrl: absolute(thumbnail) } : {}),
      synopsis: text($("div.series-desc").first()),
      contentRating: ratingOf(
        ratingLabel,
        [...genres, ...tags].map((tag) => tag.title),
      ),
      contentType: "comic",
      ...(status ? { status } : {}),
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      ...(tagGroups.length > 0 ? { tagGroups } : {}),
      ...(Object.keys(additionalInfo).length > 0 ? { additionalInfo } : {}),
      shareUrl: seriesUrl(mangaId),
    },
  };
}

export type ChapterRow = {
  chapterId: string;
  number: number;
  title?: string;
  group?: string;
  published?: Date;
};

export function parseChapterRows($: CheerioAPI): { rows: ChapterRow[]; total: number } {
  const rows: ChapterRow[] = [];

  for (const element of resolved($, $("ol.ch-list").first(), "li.ch-row")) {
    // A row still loading when the page flushed is itself made of
    // placeholders, so every field goes through the resolver.
    const row = $(element);
    const field = (selector: string): Cheerio<Element> => $(resolved($, row, selector)).first();
    const chapterId = slugOf(field("a.ch-link").attr("href") ?? "");
    const number = Number(
      text(field("span.ch-num"))
        .replace(/^chapter/i, "")
        .trim(),
    );

    if (!chapterId || !Number.isFinite(number)) {
      continue;
    }

    const titleNode = field("span.ch-title");
    const title = titleNode.hasClass("is-plain") ? "" : text(titleNode);
    // One uploader shows as a credit; several show as a source picker.
    const group = text(field("span.ch-credit-group, span.ch-source-name"));
    const stamp = field("time.ch-time").attr("datetime") ?? "";
    const published = new Date(stamp);

    rows.push({
      chapterId,
      number,
      ...(title ? { title } : {}),
      ...(group ? { group } : {}),
      ...(stamp && !isNaN(published.getTime()) ? { published } : {}),
    });
  }

  return { rows, total: Number(text($("span.chapters-count").first())) || rows.length };
}

export function parsePages(body: string): { pages: string[]; message?: string } {
  const payload = JSON.parse(body) as { pages?: unknown; message?: string };
  const pages: string[] = [];

  for (const page of Array.isArray(payload.pages) ? payload.pages : []) {
    if (typeof page === "string" && page.trim()) {
      pages.push(absolute(page));
    }
  }

  return { pages, ...(payload.message ? { message: payload.message } : {}) };
}

export type Taxonomy = { genres: Tag[]; tags: Tag[] };

// The action streams RSC lines; the list is the one keyed "1:".
export function parseTaxonomy(body: string, limit: number): Taxonomy {
  const line = body.split("\n").find((entry) => entry.startsWith("1:"));

  if (!line) {
    throw new Error("webnex.cc returned no genre list.");
  }

  const payload = JSON.parse(line.slice(2)) as {
    genres?: Array<{ name: string; count: number }>;
    tags?: Array<{ name: string; count: number }>;
  };

  const pick = (entries: Array<{ name: string; count: number }> = []): Tag[] => {
    const tags: Tag[] = [];

    for (const entry of [...entries].sort((a, b) => b.count - a.count)) {
      const name = entry.name.trim();

      if (name && !tags.some((tag) => tag.title === name)) {
        tags.push({ id: idOf(name), title: name });
      }

      if (tags.length >= limit) {
        break;
      }
    }

    return tags.sort((a, b) => a.title.localeCompare(b.title));
  };

  return { genres: pick(payload.genres), tags: pick(payload.tags) };
}
