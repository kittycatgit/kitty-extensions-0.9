/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { STATUS_LABELS } from "./models";

// Series live at /manhwa/<slug>/ and the slug alone is the id.
export function slugFromHref(href: string | undefined): string | undefined {
  const path = (href ?? "").split(/[?#]/)[0]?.replace(/\/+$/, "");
  const parts = path?.split("/").filter(Boolean) ?? [];
  const index = parts.indexOf("manhwa");
  return index >= 0 ? parts[index + 1] : parts[parts.length - 1];
}

export function chapterIdFromHref(href: string | undefined): string | undefined {
  const path = (href ?? "").split(/[?#]/)[0]?.replace(/\/+$/, "");
  return path?.split("/").filter(Boolean).pop();
}

// Artwork is lazy-loaded: the real address is in a data attribute and src holds
// a placeholder, or nothing, until the browser gets to it.
function imageFrom(element: Cheerio<Element>): string | undefined {
  const candidates = [
    element.attr("data-src"),
    element.attr("data-lazy-src"),
    element.attr("data-cfsrc"),
    element.attr("data-original"),
    element.attr("src"),
    // Last resort: the first srcset entry is a scaled-down variant.
    element.attr("srcset")?.split(",")[0]?.trim().split(" ")[0],
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();

    // A data: URI here is the placeholder, never the artwork.
    if (value && !value.startsWith("data:")) {
      return value;
    }
  }

  return undefined;
}

// Some pages carry a broken og:image ("https:/" with no host), so check every
// candidate for a scheme and a host. An empty imageUrl fails the whole row.
function firstUsableImage(domain: string, candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    const value = candidate?.trim();

    if (!value || value.startsWith("data:")) {
      continue;
    }

    const resolved = absolute(domain, value);

    if (/^https?:\/\/[^/\s]+\.[^/\s]+\/\S/.test(resolved)) {
      return resolved;
    }
  }

  return `${domain}/_no-cover.png`;
}

function absolute(domain: string, src: string | undefined): string {
  const value = (src ?? "").trim();
  if (!value) return "";
  if (value.startsWith("http")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return value.startsWith("/") ? `${domain}${value}` : `${domain}/${value}`;
}

// Every home rail and the search listing share these rows.
export function parseListing($: CheerioAPI, domain: string): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const element of $(".manga-item").toArray()) {
    const link = $("a.manga-item__link", element).first();
    const mangaId = slugFromHref(link.attr("href"));
    if (!mangaId || seen.has(mangaId)) {
      continue;
    }
    seen.add(mangaId);

    const image = $("img", element).first();
    const title = link.attr("title")?.trim() || link.text().trim();

    const subtitle = $("a.chapter-item", element).first().text().replace(/\s+/g, " ").trim();

    items.push({
      mangaId,
      title: title || mangaId,
      imageUrl: firstUsableImage(domain, [imageFrom(image)]),
      ...(subtitle ? { subtitle } : {}),
    });
  }

  return items;
}

// The paginator only renders a forward link while further pages exist.
export function hasNextPage($: CheerioAPI): boolean {
  return (
    $(".wp-pagenavi a.last, .wp-pagenavi a.nextpostslink, a.next.page-numbers, a.next").length > 0
  );
}

export function parseMangaDetails($: CheerioAPI, mangaId: string, domain: string): SourceManga {
  // A bare `h1` is the site logo, so stay inside the summary block.
  const primaryTitle = $("#mangaSummary .manga-titles h1").first().text().trim() || mangaId;

  const secondaryTitles = $("#mangaSummary .manga-titles h2")
    .first()
    .text()
    .split("|")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const synopsis =
    $("#mangaDesc > .manga-desc__content").first().text().trim() ||
    $("meta[name='description']").attr("content")?.trim() ||
    "";

  const asTags = (values: string[]): Tag[] =>
    values.map((value) => ({ id: value.toLowerCase().replace(/\s+/g, "-"), title: value }));

  const textsOf = (selector: string): string[] => {
    const seen = new Set<string>();
    for (const element of $(selector).toArray()) {
      const value = $(element).text().trim();
      if (value) seen.add(value);
    }
    return [...seen];
  };

  // Metadata is printed as a label followed by a sibling list of links.
  const labelled = (label: string): string[] =>
    textsOf(`#mangaSummary .text-primary:contains(${label}) + .flex a span:first-child`);

  const tagGroups: TagSection[] = [];
  // Genre links point at `/genre/<slug>/`; the nav's `/genre-index/` does not match.
  const genres = textsOf("#mangaSummary a[href*='/genre/']");
  if (genres.length > 0) {
    tagGroups.push({ id: "genres", title: "Genres", tags: asTags(genres) });
  }
  const tags = labelled("Tags");
  if (tags.length > 0) {
    tagGroups.push({ id: "tags", title: "Tags", tags: asTags(tags) });
  }

  const rawStatus = ($("#mangaSummary [data-status]").first().attr("data-status") ?? "")
    .trim()
    .toLowerCase();
  const status = STATUS_LABELS[rawStatus];

  const author = labelled("Author").join(", ");
  const artist = labelled("Artist").join(", ");

  const additionalInfo: Record<string, string> = {};
  const chapterCount = $("#chaptersList > a.chapter-item").length;
  if (chapterCount > 0) {
    additionalInfo["Chapters"] = String(chapterCount);
  }
  // The chapter list runs oldest first, so the newest sits last.
  const latest = $("#chaptersList > a.chapter-item")
    .last()
    .find("span.chapter-item__name")
    .text()
    .trim();
  if (latest) {
    additionalInfo["Latest"] = latest;
  }
  const type = $("#mangaSummary .manga-type").first().text().trim();
  if (type) {
    additionalInfo["Type"] = type;
  }

  const rating = Number(
    $("[itemprop='ratingValue'], #mangaSummary .manga-rating").first().text().trim(),
  );

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: firstUsableImage(domain, [
        imageFrom($("#mangaSummary img").first()),
        $("meta[property='og:image']").attr("content"),
        imageFrom($(".manga-poster img, .summary_image img, .thumb img").first()),
      ]),
      synopsis,
      contentRating: ContentRating.MATURE,
      shareUrl: `${domain}/manhwa/${mangaId}/`,
      ...(status ? { status } : {}),
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      ...(isNaN(rating) || rating <= 0 ? {} : { rating }),
      ...(tagGroups.length ? { tagGroups } : {}),
      ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
    },
  };
}

// Dates are printed dd/MM/yyyy, day first.
function parseDate(text: string): Date | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return isNaN(date.getTime()) ? undefined : date;
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  for (const element of $("#chaptersList > a.chapter-item").toArray()) {
    const chapterId = chapterIdFromHref($(element).attr("href"));
    if (!chapterId || seen.has(chapterId)) {
      continue;
    }
    seen.add(chapterId);

    const name = $("span.chapter-item__name", element).first().text().trim();
    const published = parseDate($("span.chapter-item__date", element).first().text());
    const parsed = Number(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? NaN);

    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: isNaN(parsed) ? chapters.length + 1 : parsed,
      ...(name ? { title: name } : {}),
      ...(published ? { publishDate: published } : {}),
    });
  }

  // The site lists oldest first; present newest first.
  return chapters.sort((a, b) => b.chapNum - a.chapNum);
}

// Page URLs are not in the markup. A `chapterData` script var holds a base64
// JSON array of file names to join onto its `base` prefix.
export function parseChapterPages(html: string): string[] {
  const match = /var\s+chapterData\s*=\s*(\{[\s\S]*?\})\s*[;\n]/.exec(html);
  if (!match?.[1]) {
    return [];
  }

  let payload: { data?: string; base?: string };
  try {
    payload = JSON.parse(match[1]) as { data?: string; base?: string };
  } catch {
    return [];
  }

  if (!payload.data) {
    return [];
  }

  const decoded = Application.base64Decode(payload.data);
  if (typeof decoded !== "string") {
    return [];
  }

  let entries: { src?: string }[];
  try {
    entries = JSON.parse(decoded) as { src?: string }[];
  } catch {
    return [];
  }

  const base = (payload.base ?? "").replace(/\/+$/, "");
  const pages: string[] = [];
  for (const entry of entries) {
    if (!entry?.src) {
      continue;
    }
    const url = entry.src.startsWith("http") ? entry.src : `${base}/${entry.src}`;
    if (!pages.includes(url)) {
      pages.push(url);
    }
  }

  return pages;
}
