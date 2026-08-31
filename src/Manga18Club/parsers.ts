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
import type { CheerioAPI } from "cheerio";

export function slugFromUrl(url: string | undefined): string | undefined {
  const parts = (url ?? "").split("?")[0]?.replace(/\/+$/, "").split("/");
  const index = parts?.indexOf("manhwa") ?? -1;
  return index >= 0 ? parts?.[index + 1] : undefined;
}

// Search results, genre listings and the home page all use these same rows.
export function parseSearchResults($: CheerioAPI): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const element of $("div.story_item").toArray()) {
    const link = $("div.mg_name a, a[href*='/manhwa/']", element).first();
    const mangaId = slugFromUrl(link.attr("href"));
    if (!mangaId || seen.has(mangaId)) {
      continue;
    }
    seen.add(mangaId);

    const image = $("img", element).first();
    const title = link.attr("title")?.trim() || link.text().trim() || image.attr("alt")?.trim();
    const subtitle = $("div.mg_chapter a, div.chapter_count a", element).first().text().trim();

    items.push({
      mangaId,
      title: title ?? mangaId,
      imageUrl: image.attr("src") ?? image.attr("data-src") ?? "",
      ...(subtitle ? { subtitle } : {}),
    });
  }

  return items;
}

// Pagination links only. Series rows link to /manhwa/<slug>/96, and that trailing
// number reads as a page number, which paginates forever.
export function hasNextPage($: CheerioAPI, currentPage: number): boolean {
  return $("a[href*='/list-manga'], a[href*='/manga-list']")
    .toArray()
    .some((element) => {
      const path = ($(element).attr("href") ?? "").split("?")[0] ?? "";
      const match = /\/(\d+)\/?$/.exec(path);
      return match?.[1] !== undefined && Number(match[1]) > currentPage;
    });
}

export function parseMangaDetails($: CheerioAPI, mangaId: string, domain: string): SourceManga {
  const primaryTitle = $("h1").first().text().trim() || mangaId;

  const thumbnailUrl =
    $("img.img-responsive[src*='/manga/'], div.story_avatar img, div.detail_avatar img")
      .first()
      .attr("src") ??
    $("meta[property='og:image']").attr("content") ??
    "";

  const synopsis =
    $("div.story-detail-info, div.summary_content, div#summary, div.detail_reviewContent")
      .first()
      .text()
      .trim() ||
    $("meta[name='description']").attr("content")?.trim() ||
    "";

  const tags: Tag[] = [];
  for (const element of $("a[href*='/manga-list/']").toArray()) {
    const id = $(element).attr("href")?.replace(/\/+$/, "").split("/").pop();
    const title = $(element).text().trim();
    if (id && title && !tags.some((tag) => tag.id === id)) {
      tags.push({ id, title });
    }
  }
  const tagGroups: TagSection[] = tags.length ? [{ id: "genres", title: "Genres", tags }] : [];

  const infoText = $("div.story_info, div.detail_item, ul.manga-info-text, div.mg_info")
    .first()
    .text();
  const author = /Author\s*[:：]\s*([^\n]+)/i.exec(infoText)?.[1]?.trim();
  const status = /Status\s*[:：]\s*([^\n]+)/i.exec(infoText)?.[1]?.trim();

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles: [],
      thumbnailUrl,
      synopsis,
      contentRating: ContentRating.ADULT,
      shareUrl: `${domain}/manhwa/${mangaId}`,
      ...(author ? { author } : {}),
      ...(status ? { status } : {}),
      ...(tagGroups.length ? { tagGroups } : {}),
    },
  };
}

// The detail page carries the whole chapter list, newest first.
export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  for (const element of $("a[href*='/chapter-']").toArray()) {
    const href = $(element).attr("href")?.split("?")[0]?.replace(/\/+$/, "");
    const chapterId = href?.split("/").pop();
    if (!href || !chapterId || seen.has(chapterId) || !/chapter-/i.test(chapterId)) {
      continue;
    }
    // "Related" rails link to chapters of other titles.
    if (slugFromUrl(href) !== sourceManga.mangaId) {
      continue;
    }
    seen.add(chapterId);

    const title = $(element).text().trim();
    const chapNum = Number(/chapter-([\d.]+)/i.exec(chapterId)?.[1] ?? NaN);

    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: isNaN(chapNum) ? chapters.length + 1 : chapNum,
      ...(title ? { title } : {}),
    });
  }

  return chapters;
}

export function parseChapterPages($: CheerioAPI, html: string): string[] {
  const pages: string[] = [];

  // Page URLs are base64 inside an inline script, so they appear neither as text nor as
  // <img> tags. Document order is reading order.
  for (const candidate of html.match(/[A-Za-z0-9+/]{60,}={0,2}/g) ?? []) {
    const decoded = Application.base64Decode(candidate);
    if (typeof decoded !== "string") {
      continue;
    }

    const url = decoded.trim();
    if (/\/chapters\/.+\.(?:jpg|jpeg|png|webp)$/i.test(url) && !pages.includes(url)) {
      pages.push(url);
    }
  }

  if (pages.length > 0) {
    return pages;
  }

  // Some chapters are still served with the images in the markup.
  for (const element of $("div#chapter_boxImages img, img.image-chapter").toArray()) {
    const source = ($(element).attr("src") ?? $(element).attr("data-src") ?? "").trim();
    if (source && !pages.includes(source)) {
      pages.push(source);
    }
  }

  return pages;
}
