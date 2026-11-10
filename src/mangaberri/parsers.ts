/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { Chapter, SourceManga, Tag } from "@paperback/types";
import type { CheerioAPI } from "cheerio";

export interface BerriCard {
  slug: string;
  title: string;
  imageUrl: string;
  subtitle: string;
}

// The two sites run the same engine under different skins, so cards are matched
// by what they link to rather than by class name.
export function parseCards($: CheerioAPI, domain: string): BerriCard[] {
  const found = new Map<string, BerriCard>();

  for (const element of $('a[href*="/title/"]').toArray()) {
    const anchor = $(element);
    const slug = (anchor.attr("href") ?? "").replace(/\/$/, "").split("/title/").pop() ?? "";

    if (!slug || slug.includes("/")) {
      continue;
    }

    // The cover sits inside the link on some rails and beside it on others, so
    // the card is the nearest ancestor that actually holds an image.
    let card = anchor;
    let image = anchor.find("img").first();

    for (let depth = 0; depth < 5 && image.length === 0; depth += 1) {
      card = card.parent();

      if (card.length === 0) {
        break;
      }

      image = card.find("img").first();
    }

    const title =
      (image.attr("alt") ?? "").replace(/^Cover of\s*/i, "").trim() ||
      card.find("h3 a, h2 a, h3, h2").first().text().replace(/\s+/g, " ").trim() ||
      anchor.text().replace(/\s+/g, " ").trim();

    if (!title || /^view\b/i.test(title)) {
      continue;
    }

    const source = image.attr("src") ?? image.attr("data-src") ?? "";
    const candidate: BerriCard = {
      slug,
      title: Application.decodeHTMLEntities(title),
      imageUrl: absolute(source, domain),
      subtitle: card.find("[class*='rating'], [class*='label'] span").first().text().trim(),
    };

    const existing = found.get(slug);

    // Keep whichever mention of the series carried a cover.
    if (!existing || (!existing.imageUrl && candidate.imageUrl)) {
      found.set(slug, candidate);
    }
  }

  return [...found.values()].filter((card) => card.imageUrl.length > 0);
}

export function parseSeries(
  $: CheerioAPI,
  slug: string,
  domain: string,
  contentRating: SourceManga["mangaInfo"]["contentRating"],
): SourceManga {
  const meta = (name: string): string =>
    $(`meta[property="${name}"], meta[name="${name}"]`).first().attr("content") ?? "";

  const tags: Tag[] = [];
  $('a[href*="/genre/"]').each((_, element) => {
    const id = ($(element).attr("href") ?? "").replace(/\/$/, "").split("/genre/").pop() ?? "";
    const title = $(element).text().replace(/\s+/g, " ").trim();

    if (id && title && !id.includes("/") && !tags.some((tag) => tag.id === id)) {
      tags.push({ id, title });
    }
  });

  const stats = new Map<string, string>();
  $("dl dt").each((_, element) => {
    const label = $(element).text().replace(/\s+/g, " ").trim().toLowerCase();
    const value = $(element).next("dd").text().replace(/\s+/g, " ").trim();

    if (label && value) {
      stats.set(label, value);
    }
  });

  // The story block wraps headings, stats and a "read first chapter" link
  // around the real text, so the prose element itself is read, not the wrapper.
  const synopsis =
    [
      $("p.collection-synopsis").first(),
      $("[class*='story'] > div").last(),
      $("[class*='synopsis'], [class*='about']").first(),
    ]
      .map((node) => node.text().replace(/\s+/g, " ").trim())
      .find((text) => text.length > 40) ?? meta("description");

  const status = /\b(ongoing|completed|hiatus|dropped)\b/i.exec($("body").text())?.[1];
  const rating = Number(/([\d.]+)/.exec(stats.get("reader rating") ?? "")?.[1] ?? NaN);

  return {
    mangaId: slug,
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(
        $("h1").first().text().replace(/\s+/g, " ").trim(),
      ),
      secondaryTitles: $("[class*='alternate-title']")
        .first()
        .text()
        .split(/[,;|]/)
        .map((title) => Application.decodeHTMLEntities(title.replace(/\s+/g, " ").trim()))
        .filter((title) => title.length > 0),
      thumbnailUrl: absolute(meta("og:image"), domain),
      synopsis: Application.decodeHTMLEntities(synopsis),
      contentRating,
      shareUrl: `${domain}/title/${slug}`,
      ...(status ? { status: status.toUpperCase() } : {}),
      ...(isNaN(rating) || rating <= 0 ? {} : { rating }),
      ...(tags.length ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
      ...(stats.get("chapters") ? { additionalInfo: { Chapters: stats.get("chapters")! } } : {}),
    },
  };
}

export function parseChapters(
  $: CheerioAPI,
  sourceManga: SourceManga,
  language: string,
): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  for (const element of $("a[data-chapter-row]").toArray()) {
    const row = $(element);
    const chapterId = row.attr("data-chapter-id") ?? "";
    const name = row.find("span[class*='name'] strong").first().text().replace(/\s+/g, " ").trim();
    const chapNum = Number(/([\d.]+)/.exec(name)?.[1] ?? NaN);

    if (!chapterId || seen.has(chapterId) || isNaN(chapNum)) {
      continue;
    }
    seen.add(chapterId);

    const created = Number(row.attr("data-created-at") ?? NaN);
    const iso = row.find("time").first().attr("datetime") ?? "";
    const published = !isNaN(created) ? new Date(created * 1000) : new Date(iso);

    chapters.push({
      chapterId,
      sourceManga,
      langCode: language,
      chapNum,
      title: Application.decodeHTMLEntities(name.replace(/\s*NEW CHAPTER\s*/i, "").trim()),
      ...(isNaN(published.getTime()) ? {} : { publishDate: published }),
    });
  }

  return chapters.sort((left, right) => right.chapNum - left.chapNum);
}

// A reader page also carries covers of other chapters, so only files under this
// chapter's own folder count, ordered by the page number in the file name.
export function parsePages(html: string, chapterId: string, domain: string): string[] {
  // Three naming schemes are in use: p0001_hfrughwl.webp on recent uploads,
  // p0001.webp and plain 0001.webp on older ones.
  const pattern = new RegExp(
    `/mangas/${chapterId}/p?(\\d+)(?:_[A-Za-z0-9]+)?\\.(?:webp|jpe?g|png|avif|gif)`,
    "g",
  );
  const pages = new Map<number, string>();

  for (const match of html.matchAll(pattern)) {
    pages.set(Number(match[1]), absolute(match[0], domain));
  }

  return [...pages.entries()].sort((left, right) => left[0] - right[0]).map(([, url]) => url);
}

function absolute(url: string, domain: string): string {
  if (!url) {
    return "";
  }

  return encodeURI(
    url.startsWith("http") ? url : `${domain}${url.startsWith("/") ? "" : "/"}${url}`,
  );
}
