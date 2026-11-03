/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type Chapter, type SourceManga, type Tag } from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  FALLBACK_COVER,
  seriesUrl,
  type LagoonCard,
  type LagoonGenre,
  type LagoonHome,
} from "./models";

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function slugFromUrl(url: string | undefined, prefix: string): string | undefined {
  const match = (url ?? "").match(new RegExp(`${prefix}/([^/?#]+)/?`));
  return match?.[1];
}

export function parseGridCard($: cheerio.CheerioAPI, el: AnyNode): LagoonCard | undefined {
  const box = $(el);
  const link = box.find("a[href]").first();
  const slug = slugFromUrl(link.attr("href"), "/manga");
  const title = clean(link.attr("title")) || clean(box.find(".tt").text());

  if (!slug || !title) {
    return undefined;
  }

  const type = (box.find("span.type").attr("class") ?? "").replace("type", "").trim();
  const latestChapter = clean(box.find(".epxs").text());
  const rating = clean(box.find(".numscore").text());

  return {
    slug,
    title,
    cover: box.find("img").attr("src") || FALLBACK_COVER,
    ...(type ? { type } : {}),
    ...(latestChapter ? { latestChapter } : {}),
    ...(rating ? { rating } : {}),
  };
}

export function parseGridCards(
  $: cheerio.CheerioAPI,
  root?: cheerio.Cheerio<AnyNode>,
): LagoonCard[] {
  const scope = root ?? $.root();
  const cards: LagoonCard[] = [];

  scope.find(".bs .bsx").each((_, el) => {
    const card = parseGridCard($, el);
    if (card) {
      cards.push(card);
    }
  });

  return cards;
}

// Latest Update rows (`.utao .uta`) list the newest chapters per series.
export function parseLatestRows($: cheerio.CheerioAPI): LagoonCard[] {
  const cards: LagoonCard[] = [];

  $(".utao .uta").each((_, el) => {
    const row = $(el);
    const link = row.find(".imgu a.series").first();
    const slug = slugFromUrl(link.attr("href"), "/manga");
    const title = clean(row.find(".luf h4").text()) || clean(link.attr("title"));

    if (!slug || !title) {
      return;
    }

    const newest = row.find(".luf ul li").first();
    const chapterLink = newest.find("a").first();
    const type = (row.find("span.type").attr("class") ?? "").replace("type", "").trim();
    const status = clean(row.find(".statusind").text());

    cards.push({
      slug,
      title,
      cover: row.find(".imgu img").attr("src") || FALLBACK_COVER,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(clean(chapterLink.text()) ? { latestChapter: clean(chapterLink.text()) } : {}),
      ...(slugFromUrl(chapterLink.attr("href"), "lagoonscans\\.com")
        ? { latestChapterSlug: slugFromUrl(chapterLink.attr("href"), "lagoonscans\\.com") }
        : {}),
      ...(clean(newest.find("span").text())
        ? { latestChapterAge: clean(newest.find("span").text()) }
        : {}),
    });
  });

  return cards;
}

export function parseHome(html: string): LagoonHome {
  const $ = cheerio.load(html);
  const recommendations: LagoonHome["recommendations"] = [];

  $(".series-gen ul.nav-tabs li a").each((_, el) => {
    const termId = ($(el).attr("href") ?? "").replace("#series-", "").trim();
    const name = clean($(el).text());

    if (!termId || !name) {
      return;
    }

    recommendations.push({
      termId,
      name,
      cards: parseGridCards($, $(`#series-${termId}`)),
    });
  });

  return {
    popular: parseGridCards($, $(".hotslid")),
    latest: parseLatestRows($),
    recommendations,
  };
}

export function parseGenres(html: string): LagoonGenre[] {
  const $ = cheerio.load(html);
  const genres: LagoonGenre[] = [];

  $('input[name="genre[]"]').each((_, el) => {
    const id = clean($(el).attr("value"));
    const name = clean($(`label[for="${$(el).attr("id")}"]`).text());

    if (id && name) {
      genres.push({ id, name });
    }
  });

  return genres;
}

export function parseListingCards(html: string): LagoonCard[] {
  return parseGridCards(cheerio.load(html));
}

export function parseLatestPage(html: string): LagoonCard[] {
  return parseLatestRows(cheerio.load(html));
}

export function hasNextPage(html: string): boolean {
  return cheerio.load(html)(".pagination a.next").length > 0;
}

function parseLongDate(text: string): Date | undefined {
  const match = clean(text).match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  const month = match ? MONTHS[match[1]!.toLowerCase()] : undefined;

  if (!match || month === undefined) {
    return undefined;
  }

  return new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
}

export function parseSeries(html: string, slug: string): SourceManga {
  const $ = cheerio.load(html);
  const title = clean($("h1.entry-title").first().text());

  if (!title) {
    throw new Error(`No title found for ${slug}`);
  }

  const info: Record<string, string> = {};
  $("table.infotable tr").each((_, el) => {
    const label = clean($(el).find("td").first().text());
    const value = clean($(el).find("td").last().text());
    if (label && value) {
      info[label] = value;
    }
  });

  const genres: Tag[] = [];
  $(".seriestugenre a").each((_, el) => {
    const id = slugFromUrl($(el).attr("href"), "/genres");
    const name = clean($(el).text());
    if (id && name) {
      genres.push({ id, title: name });
    }
  });

  const ratingText = $(".rating .num").first().attr("content") || clean($(".rating .num").text());
  const rating = Number(ratingText);
  const secondaryTitles = clean($(".seriestualt").text())
    .split(/,\s*/)
    .map((name) => name.trim())
    .filter((name) => name && name !== title);
  const latest = clean($(".lastend .epcurlast").text());
  const additionalInfo: Record<string, string> = {};

  for (const key of ["Type", "Released", "Serialization", "Posted On", "Updated On"]) {
    if (info[key]) {
      additionalInfo[key] = info[key];
    }
  }
  if (latest) {
    additionalInfo["Latest chapter"] = latest;
  }

  const mature = genres.some((genre) => /mature|adult|smut/i.test(genre.title));

  return {
    mangaId: slug,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles,
      thumbnailUrl: $(".seriestucontl .thumb img").attr("src") || FALLBACK_COVER,
      synopsis: clean($(".entry-content.entry-content-single").text()),
      contentRating: mature ? ContentRating.ADULT : ContentRating.MATURE,
      ...(info.Status ? { status: info.Status } : {}),
      ...(info.Author ? { author: info.Author } : {}),
      ...(info.Artist ? { artist: info.Artist } : {}),
      ...(Number.isFinite(rating) && rating > 0 ? { rating: rating / 10 } : {}),
      tagGroups: genres.length > 0 ? [{ id: "genres", title: "Genres", tags: genres }] : [],
      additionalInfo,
      shareUrl: seriesUrl(slug),
    },
  };
}

export function parseChapters(html: string, sourceManga: SourceManga): Chapter[] {
  const $ = cheerio.load(html);
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  $("#chapterlist li[data-num]").each((_, el) => {
    const row = $(el);
    const href = row.find(".eph-num a").attr("href") ?? "";
    const chapterId = slugFromUrl(href, "lagoonscans\\.com");
    // data-num can carry editor notes such as "111 fixed".
    const number = Number.parseFloat(clean(row.attr("data-num")));
    const label = clean(row.find(".chapternum").text());

    if (!chapterId || seen.has(chapterId) || !Number.isFinite(number)) {
      return;
    }
    seen.add(chapterId);

    const restates = new RegExp(`^chapter\\s*${number}$`, "i").test(label);
    const published = parseLongDate(row.find(".chapterdate").text());

    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: number,
      sortingIndex: number,
      ...(label && !restates ? { title: label } : {}),
      ...(published ? { publishDate: published } : {}),
    });
  });

  return chapters;
}

// The reader is filled by JS from an inline `ts_reader.run({...})` payload.
export function parseChapterPages(html: string): string[] {
  const match = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);

  if (!match) {
    return [];
  }

  const payload = JSON.parse(match[1]!) as { sources?: { images?: string[] }[] };
  const images = payload.sources?.[0]?.images ?? [];

  return images
    .map((url) => clean(url))
    .filter((url) => url.length > 0)
    .map((url) => (url.startsWith("http") ? url : `${DOMAIN}${url}`));
}
