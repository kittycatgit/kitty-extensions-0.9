/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";

import {
  DOMAIN,
  type MikanCard,
  type MikanChapterRow,
  type MikanFilters,
  type MikanOption,
  type MikanSeries,
  type MikanSpotlight,
} from "./models";

function lastSegment(href: string | undefined): string {
  return (href ?? "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop()!;
}

function absolute(url: string | undefined): string {
  const value = (url ?? "").trim();

  if (!value || value.startsWith("data:")) {
    return "";
  }

  return value.startsWith("http") ? value : `${DOMAIN}${value.startsWith("/") ? "" : "/"}${value}`;
}

function dateOf(value: string | undefined): Date | undefined {
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

export function parseListing(html: string): { cards: MikanCard[]; hasNext: boolean } {
  const $ = cheerio.load(html);
  const cards: MikanCard[] = [];

  $("article.card").each((_, el) => {
    const card = $(el);
    const slug = lastSegment(card.find("a.card__cover").attr("href"));
    const title = card.find(".card__title").text().trim();

    if (!slug || !title) {
      return;
    }

    const subtitle = card.find("p.card__sub").text().trim();

    cards.push({
      slug,
      title,
      cover: absolute(card.find("a.card__cover img").attr("src")),
      ...(subtitle ? { subtitle } : {}),
      pills: card
        .find("a.chapter-pill")
        .map((_, pill) => ({
          id: lastSegment($(pill).attr("href")),
          label: $(pill).find("span").first().text().trim(),
          date: dateOf($(pill).find("time").attr("datetime")),
        }))
        .get()
        .filter((pill) => pill.id !== ""),
    });
  });

  return { cards, hasNext: $("a.pager__step[rel='next']").length > 0 };
}

export function parseSpotlight(html: string): MikanSpotlight[] {
  const $ = cheerio.load(html);

  return $("section.spotlight article.spotlight__slide")
    .map((_, el) => {
      const slide = $(el);
      const meta = slide.find("p.spotlight__meta").text().trim();
      const summary = slide.find("p.spotlight__summary").text().trim();

      return {
        slug: lastSegment(slide.find("a.spotlight__cover").attr("href")),
        title: slide.find("h2").text().trim(),
        cover: absolute(slide.find("a.spotlight__cover img").attr("src")),
        ...(meta ? { meta } : {}),
        ...(summary ? { summary } : {}),
      };
    })
    .get()
    .filter((slide) => slide.slug !== "" && slide.title !== "");
}

// Every listing page carries the same filter form.
export function parseFilters(html: string): MikanFilters {
  const $ = cheerio.load(html);
  const options = (name: string): MikanOption[] =>
    $(`form[data-filter-form] select[name='${name}'] option`)
      .map((_, el) => ({ id: ($(el).attr("value") ?? "").trim(), title: $(el).text().trim() }))
      .get()
      .filter((option) => option.id !== "" && option.title !== "");

  return { sorts: options("sort"), genres: options("genre"), statuses: options("status") };
}

export function parseSeries(html: string): MikanSeries {
  const $ = cheerio.load(html);
  const book = $("div.page--book").first();
  const title = book.find("h1").first().text().trim();

  if (!title) {
    throw new Error("The series page no longer carries a title.");
  }

  // "Ongoing · By Shima Tokio · 2022": any of the three parts can be missing.
  const credit = book
    .find("p.book__credit")
    .text()
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const author = credit.find((part) => /^by\s/i.test(part))?.replace(/^by\s+/i, "");
  const year = credit.find((part) => /^\d{4}$/.test(part));
  const status = credit.find((part) => part !== year && !/^by\s/i.test(part));

  const stats: Record<string, string> = {};
  book.find("dl.stats div").each((_, el) => {
    stats[$(el).find("dt").text().trim().toLowerCase()] = $(el)
      .find("dd")
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .trim();
  });

  return {
    title,
    altTitles: book
      .find("p.book__alt")
      .text()
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean),
    cover: absolute(book.find("div.book__cover img").attr("src")),
    ...(status ? { status } : {}),
    ...(author ? { author } : {}),
    ...(year ? { year } : {}),
    ...(stats.views ? { views: stats.views } : {}),
    genres: book
      .find("nav.chips[aria-label='Genres'] a.chip")
      .map((_, el) => ({ id: lastSegment($(el).attr("href")), title: $(el).text().trim() }))
      .get()
      .filter((genre) => genre.id !== "" && genre.title !== ""),
    synopsis: book
      .find("section.synopsis div.clamp p")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join("\n\n"),
  };
}

// Rows come newest first, all on the series page.
export function parseChapters(html: string): MikanChapterRow[] {
  const $ = cheerio.load(html);

  return $("ol[data-chapter-list] li[data-chapter-row]")
    .map((_, el) => {
      const row = $(el);
      const name = row.find(".chapterlist__name").clone();
      name.find("em").remove();

      return {
        id: (row.attr("data-chapter-id") ?? "").trim(),
        name: name.text().trim(),
        date: dateOf(row.find("time").attr("datetime")),
      };
    })
    .get()
    .filter((row) => row.id !== "");
}

export function parsePages(html: string): { pages: string[]; expected: number } {
  const $ = cheerio.load(html);
  const pages = $("#chapter-reader figure.rpage img")
    .map((_, el) => ({
      index: Number($(el).attr("data-page")),
      url: absolute($(el).attr("data-src") ?? $(el).attr("src")),
    }))
    .get()
    .filter((page) => page.url !== "")
    .sort((a, b) => a.index - b.index)
    .map((page) => page.url);

  return { pages, expected: Number($("[data-reader]").attr("data-page-count") ?? pages.length) };
}
