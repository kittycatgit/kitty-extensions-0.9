/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";

import {
  DOMAIN,
  FALLBACK_COVER,
  seriesPageUrl,
  toId,
  type ApiChapter,
  type ApiChapterDetail,
  type ApiPosts,
  type ApiRecentChapter,
  type ApiSeries,
  type GenreChoice,
} from "./models";

/**
 * An address only counts if it has a scheme and a host to fetch from.
 *
 * Some covers are still listed over plain http, which the phone refuses to load
 * at all - the host answers those with a redirect rather than the image. They
 * are asked for securely instead, which is how the same file is served.
 */
function usable(candidate: string | null | undefined): string {
  const value = (candidate ?? "").trim();

  if (/^https?:\/\/[^/\s]+\.[^/\s]+\/\S/.test(value)) {
    return value.startsWith("http://") ? `https://${value.slice("http://".length)}` : value;
  }

  if (value.startsWith("/")) {
    return `${DOMAIN}${value}`;
  }

  return FALLBACK_COVER;
}

/**
 * Genres arrive either as objects or as bare names depending on the route.
 *
 * A tag's id crosses the bridge and so must keep to the characters ids may use;
 * a name like "slice of life" has spaces in it and would be refused, taking the
 * whole series with it. The site's own numeric id is used where there is one,
 * and a name is reduced to something legal where there is not.
 */
function genreTags(series: ApiSeries): { id: string; title: string }[] {
  const tags: { id: string; title: string }[] = [];

  for (const genre of series.genres ?? []) {
    const title = (typeof genre === "string" ? genre : (genre?.name ?? "")).trim();

    if (!title) {
      continue;
    }

    const id =
      typeof genre === "string" || genre?.id === undefined
        ? title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        : String(genre.id);

    if (id) {
      // Written the way the genre row writes it, so a series does not shout a
      // genre the rest of the extension spells plainly.
      tags.push({ id, title: casingScore(title) > 0 ? title : titleCased(title) });
    }
  }

  return tags;
}

/**
 * What a title reads as underneath its name.
 *
 * The listing gives a kind, a state and a score; showing them together says
 * more at a glance than any one of them, and a title missing some still reads
 * properly rather than leaving stray separators behind.
 */
export function seriesSubtitle(series: ApiSeries): string | undefined {
  const bits: string[] = [];
  const type = (series.seriesType ?? "").trim();
  const status = (series.seriesStatus ?? "").trim();

  if (type) {
    bits.push(type.charAt(0) + type.slice(1).toLowerCase());
  }

  if (status) {
    bits.push(status.charAt(0) + status.slice(1).toLowerCase());
  }

  // The listing already carries the most recent chapters, so the newest one a
  // reader can actually open is free to show and is what they look for first.
  const latest = (series.chapters ?? [])
    .filter((chapter) => chapter.isLocked !== true && chapter.isAccessible !== false)
    .map((chapter) => Number(chapter.number))
    .filter((number) => Number.isFinite(number));

  if (latest.length > 0) {
    bits.push(`Ch. ${Math.max(...latest)}`);
  }

  if (typeof series.averageRating === "number" && series.averageRating > 0) {
    bits.push(`${series.averageRating.toFixed(1)}/10`);
  }

  return bits.length > 0 ? bits.join(" • ") : undefined;
}

export function toSearchResult(series: ApiSeries): SearchResultItem | undefined {
  const slug = (series.slug ?? "").trim();
  const title = (series.postTitle ?? "").trim();

  if (!slug || !title) {
    return undefined;
  }

  const mangaId = toId(slug);

  const subtitle = seriesSubtitle(series);

  return {
    mangaId,
    title,
    imageUrl: usable(series.featuredImage),
    ...(subtitle ? { subtitle } : {}),
  };
}

/** The site's own words for where a series stands, in the app's casing. */
function statusOf(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return value ? value.charAt(0) + value.slice(1).toLowerCase() : "Unknown";
}

/**
 * A series as the app shows it.
 *
 * The blurb arrives as the site's own markup, so it is read as HTML rather than
 * printed with its tags showing.
 */
export function toSourceManga($: CheerioAPI, series: ApiSeries, mangaId: string): SourceManga {
  const type = (series.seriesType ?? "").trim();
  const tags = genreTags(series);
  const tagGroups: TagSection[] = tags.length ? [{ id: "genres", title: "Genres", tags }] : [];

  const synopsis = series.postContent ? $(`<div>${series.postContent}</div>`).text().trim() : "";

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: (series.postTitle ?? "").trim() || mangaId,
      secondaryTitles: [],
      thumbnailUrl: usable(series.featuredImage),
      synopsis,
      contentRating: ContentRating.MATURE,
      // The app reads a novel differently from a comic, so it is told which
      // this is rather than being left to find out at the first chapter.
      contentType: type.toUpperCase() === "NOVEL" ? "novel" : "comic",
      status: statusOf(series.seriesStatus),
      shareUrl: seriesPageUrl(mangaId),
      ...(typeof series.averageRating === "number" && series.averageRating > 0
        ? { rating: series.averageRating }
        : {}),
      ...(tagGroups.length ? { tagGroups } : {}),
      ...(type ? { additionalInfo: { Type: type.charAt(0) + type.slice(1).toLowerCase() } } : {}),
    },
  };
}

/**
 * A series' chapters, newest first.
 *
 * Chapters the site is holding back - behind a timer or a price - are left out:
 * they cannot be opened, and listing them only offers the reader a page that
 * will not load.
 */
export function toChapters(rows: ApiChapter[], sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];

  for (const row of rows) {
    // The chapter route is addressed by id, and an id is always safe to carry.
    const chapterId = row.id === undefined ? "" : String(row.id);

    if (!chapterId) {
      continue;
    }

    if (row.isLocked === true || row.isAccessible === false) {
      continue;
    }

    const number = Number(row.number);
    const title = (row.title ?? "").trim();
    const published = row.createdAt ? new Date(row.createdAt) : undefined;

    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: Number.isFinite(number) ? number : 0,
      ...(title ? { title } : {}),
      ...(published && !Number.isNaN(published.getTime()) ? { publishDate: published } : {}),
    });
  }

  return chapters;
}

/** A card as a row shows it. Rows are kept ready-made so the whole catalogue
 * need not be held in state just to slice it. */
export type RowItem = { mangaId: string; title: string; imageUrl: string; subtitle?: string };
export type ReleaseItem = RowItem & { chapterId: string };

/**
 * How a genre is written, out of the several ways the site writes it.
 *
 * A name that varies only in case is the same genre said differently, so the
 * one that reads properly is preferred over the shouted or the whispered
 * version, and a genre the site only ever writes in one case is given capitals
 * so it does not sit oddly beside the rest.
 */
/**
 * The name two spellings of one genre share.
 *
 * The site writes a genre in whatever case it likes, sometimes runs the words
 * together, and has at least one name carrying an invisible mark that survives
 * trimming - "Reincarnation" with a zero-width space on the end is a different
 * string from "Reincarnation" but not a different genre. Reducing a name to its
 * letters and digits is what lets those meet.
 */
function groupKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Capitals where a name starts a word, without tripping over accents. */
function titleCased(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[^\p{L}\p{N}'’])(\p{Ll})/gu, (_match, before: string, letter: string) => {
      return before + letter.toUpperCase();
    });
}

/**
 * How well a name is written, out of the several ways the site writes it.
 *
 * A name shouted in capitals or whispered in none is worth less than one whose
 * words each start with a capital, which is how a genre is normally set down.
 */
function casingScore(name: string): number {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  if (!words.length || name === name.toUpperCase() || name === name.toLowerCase()) {
    return 0;
  }

  return words.filter((word) => /^\p{Lu}/u.test(word)).length / words.length;
}

function displayName(group: { name: string; worn: number }[]): string {
  const best = [...group].sort(
    (left, right) =>
      casingScore(right.name) - casingScore(left.name) ||
      right.worn - left.worn ||
      left.name.localeCompare(right.name),
  )[0]!.name;

  // A name the site only ever shouts or only ever whispers is set down the way
  // the rest of the row is, so it does not sit oddly beside them.
  return casingScore(best) > 0 ? best : titleCased(best);
}

export type HomeRows = {
  popular: RowItem[];
  fresh: RowItem[];
  completed: RowItem[];
  mostPopular: RowItem[];
  latest: RowItem[];
  novels: RowItem[];
  releases: ReleaseItem[];
  genres: GenreChoice[];
};

function addedAt(series: ApiSeries): number {
  const stamp = series.lastChapterAddedAt ?? series.updatedAt ?? null;
  const time = stamp ? new Date(stamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function toRow(list: ApiSeries[], cap: number): RowItem[] {
  const items: RowItem[] = [];

  for (const series of list) {
    const result = toSearchResult(series);

    if (!result) {
      continue;
    }

    const subtitle = seriesSubtitle(series);
    items.push({
      mangaId: result.mangaId,
      title: result.title,
      imageUrl: result.imageUrl,
      ...(subtitle ? { subtitle } : {}),
    });

    if (items.length >= cap) {
      break;
    }
  }

  return items;
}

/**
 * The home screen's rows, cut from the single reply the site's own front page
 * asks for.
 *
 * Each is the site's own idea of itself: what it marks hot today, what it calls
 * new, what has finished, what is rated highest, what has just had a chapter
 * posted, and the novels it keeps in a list of their own. The genres are the
 * ones actually worn by something here, most-used first, so every one leads
 * somewhere and the ones worth tapping come first.
 */
export function toHomeRows(payload: ApiPosts, cap: number): HomeRows {
  const posts = (payload.posts ?? []).filter((series) => (series.slug ?? "").trim().length > 0);
  const novels = (payload.novelPosts ?? []).filter((s) => (s.slug ?? "").trim().length > 0);

  const rated = [...posts].sort(
    (left, right) => (right.averageRating ?? 0) - (left.averageRating ?? 0),
  );
  const recent = [...posts].sort((left, right) => addedAt(right) - addedAt(left));

  const releases: ReleaseItem[] = [];
  const pending = [...posts]
    .flatMap((series) =>
      ((series.chapters ?? []) as ApiRecentChapter[]).map((chapter) => ({ series, chapter })),
    )
    .filter(({ chapter }) => {
      // A chapter still behind a timer or a price cannot be opened, so it is
      // not offered as something just released.
      return (
        chapter.id !== undefined && chapter.isLocked !== true && chapter.isAccessible !== false
      );
    })
    .sort((left, right) => {
      const at = (value: ApiRecentChapter) =>
        value.createdAt ? new Date(value.createdAt).getTime() || 0 : 0;
      return at(right.chapter) - at(left.chapter);
    });

  // A series that posted three chapters this morning is still one thing to
  // look at, and three of the same cover in a row reads as a fault rather than
  // as news. Each series appears once, at its newest chapter; the row then
  // carries what is new across the whole site instead of repeating its busiest
  // few titles.
  const already = new Set<string>();

  for (const { series, chapter } of pending) {
    const result = toSearchResult(series);

    if (!result || already.has(result.mangaId)) {
      continue;
    }

    already.add(result.mangaId);

    const number = Number(chapter.number);
    releases.push({
      mangaId: result.mangaId,
      chapterId: String(chapter.id),
      title: result.title,
      imageUrl: result.imageUrl,
      ...(Number.isFinite(number) && number > 0 ? { subtitle: `Chapter ${number}` } : {}),
    });

    if (releases.length >= cap) {
      break;
    }
  }

  // A genre in the row is a question put to the search endpoint, and that
  // endpoint only answers to the site's own numeric ids. A genre that arrived
  // as a bare name has no such id and could only lead to an empty shelf, so it
  // is left out of the row - it still shows on a series, where it is only a
  // label. The site lists far more genres than it has tagged anything with;
  // these are the ones something actually wears.
  //
  // The site also carries the same genre more than once - "drama", "Drama" and
  // "DRAMA" are three separate ids, holding different titles between them.
  // Showing all three would be nonsense, and picking one would hide the rest,
  // so they are gathered into a single entry that asks about every id it stands
  // for; the endpoint takes them together and answers with the union.
  const variants = new Map<string, { id: string; name: string; worn: number }[]>();
  for (const series of [...posts, ...novels]) {
    for (const genre of series.genres ?? []) {
      if (typeof genre === "string" || genre?.id === undefined || genre.id === null) {
        continue;
      }

      const name = (genre.name ?? "").trim();
      const id = String(genre.id);

      // An id that is not one of the site's own numbers cannot be asked about:
      // the endpoint answers anything it does not recognise with the entire
      // catalogue, which would show every title in the library under one genre.
      if (!name || !/^\d+$/.test(id)) {
        continue;
      }

      const key = groupKey(name);

      if (!key) {
        continue;
      }

      const group = variants.get(key) ?? [];
      const seen = group.find((entry) => entry.id === id);

      if (seen) {
        seen.worn += 1;
      } else {
        group.push({ id, name, worn: 1 });
      }

      variants.set(key, group);
    }
  }

  const statusIs = (series: ApiSeries, value: string) =>
    (series.seriesStatus ?? "").toUpperCase() === value;

  return {
    popular: toRow(
      posts.filter((series) => series.hot === true),
      cap,
    ),
    fresh: toRow(
      posts.filter((series) => series.isNew === true),
      cap,
    ),
    completed: toRow(
      posts.filter((series) => statusIs(series, "COMPLETED")),
      cap,
    ),
    mostPopular: toRow(rated, cap),
    latest: toRow(recent, cap),
    novels: toRow(novels, cap),
    releases,
    // The genres a reader is looking for are the ones the site tags most; an
    // alphabetical row leads with whatever oddity starts with a digit.
    genres: [...variants.values()]
      .map((group) => ({
        // The endpoint does not care what order the ids come in, but the form
        // remembers a genre by them joined together - so they are put in a
        // fixed order rather than one that shifts as the site tags new titles.
        ids: group.map((entry) => entry.id).sort((left, right) => Number(left) - Number(right)),
        title: displayName(group),
        worn: group.reduce((total, entry) => total + entry.worn, 0),
      }))
      .sort((left, right) => right.worn - left.worn || left.title.localeCompare(right.title))
      .map(({ ids, title }) => ({ ids, title })),
  };
}

/** A comic chapter's pages, in the order the site gives them. */
export function toPages(detail: ApiChapterDetail): string[] {
  return [...(detail.images ?? [])]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((image) => usable(image.url))
    .filter((url) => !url.endsWith("/_no-cover.png"));
}

/**
 * Elements a chapter of prose has any business containing.
 *
 * Anything else the site's editor left behind - a stray widget, a share button,
 * an advert - is dropped, while its text is kept, so the chapter reads as a
 * chapter.
 */
const NOVEL_ELEMENTS = new Set([
  "p",
  "br",
  "hr",
  "em",
  "strong",
  "i",
  "b",
  "u",
  "s",
  "small",
  "sup",
  "sub",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "div",
  "span",
  "a",
  "img",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
]);

/** Elements written without a closing tag, which XHTML wants closed anyway. */
const NOVEL_VOID_ELEMENTS = new Set(["br", "hr", "img"]);

/** Attributes worth keeping; the rest are markup the reader cannot act on. */
const NOVEL_ATTRIBUTES = new Set(["href", "src", "alt", "title"]);

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/**
 * Writes a parsed chapter back out as XHTML.
 *
 * The reader parses a chapter as XML, which is stricter than the markup a web
 * page gets away with: every element must be closed, and the document must have
 * a single root. The site writes `<br>` between its lines, which is perfectly
 * good HTML and fatal here - it ends the chapter at the first line with the
 * parser's own error where the text should be. Reading the markup properly and
 * writing it back out closed is what makes it survive that.
 */
function toXhtml(nodes: AnyNode[]): string {
  let out = "";

  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeText((node as Text).data ?? "");
      continue;
    }

    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") {
      continue;
    }

    const element = node as Element;
    const name = (element.name ?? "").toLowerCase();
    const children = (element.children ?? []) as AnyNode[];

    if (!NOVEL_ELEMENTS.has(name)) {
      // Not something a chapter should carry - but the words inside it may be.
      out += name === "script" || name === "style" ? "" : toXhtml(children);
      continue;
    }

    const attributes = Object.entries(element.attribs ?? {})
      .filter(
        ([key, value]) =>
          NOVEL_ATTRIBUTES.has(key.toLowerCase()) && typeof value === "string" && value.length > 0,
      )
      .map(([key, value]) => ` ${key.toLowerCase()}="${escapeAttribute(String(value))}"`)
      .join("");

    if (NOVEL_VOID_ELEMENTS.has(name)) {
      out += `<${name}${attributes}/>`;
      continue;
    }

    out += `<${name}${attributes}>${toXhtml(children)}</${name}>`;
  }

  return out;
}

/**
 * A novel chapter's text, as the reader can render it.
 *
 * The markup is read the forgiving way a browser reads a page - unclosed tags
 * and all - and written back out the strict way the reader requires, under a
 * single root element, since some chapters open with a line of bare text that
 * would otherwise have nothing holding it.
 */
export function toNovelHtml($: CheerioAPI, detail: ApiChapterDetail): string {
  const content = (detail.content ?? "").trim();

  if (!content) {
    return "";
  }

  const parsed = $(`<div>${content}</div>`);
  const body = toXhtml(parsed.contents().toArray() as AnyNode[]).trim();

  return body ? `<div>${body}</div>` : "";
}
