/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  type ChapterCard,
  type ChapterEntry,
  type Story,
  type StoryCard,
  type Term,
  type UpdateCard,
} from "./models";

export const PLACEHOLDER_COVER = `${DOMAIN}/wp-content/uploads/2025/02/cropped-DDL-Main-Logo-192x192.png`;

function text(node: cheerio.Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
}

// Story URLs are /story/<slug>/ and chapter URLs /story/<story>/<chapter>/.
function pathSegments(href: string | undefined): string[] {
  if (!href) {
    return [];
  }
  const path = href.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] ?? "";
  return path.split("/").filter(Boolean);
}

export function storySlugOf(href: string | undefined): string {
  const parts = pathSegments(href);
  return parts[0] === "story" && parts[1] ? parts[1] : "";
}

function chapterSlugOf(href: string | undefined): string {
  const parts = pathSegments(href);
  return parts[0] === "story" && parts[2] ? parts[2] : "";
}

function cover(img: cheerio.Cheerio<AnyNode>): string {
  // Cards ship the 400x600 file first in srcset; the src can be a thumbnail.
  const src = img.attr("src") ?? "";
  const full = src.replace(/-\d+x\d+(\.[a-z]+)$/i, "$1");
  return full || PLACEHOLDER_COVER;
}

function statusOf(span: cheerio.Cheerio<AnyNode>): string | undefined {
  const classes = span.attr("class") ?? "";
  const match = /_(ongoing|completed|hiatus|canceled|oneshot)\b/.exec(classes);
  return match ? match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1) : undefined;
}

export function parseStoryCards($: cheerio.CheerioAPI, list: string): StoryCard[] {
  const cards: StoryCard[] = [];

  $(`${list} li.card._story`).each((_, element) => {
    const card = $(element);
    const link = card.find("h3.card__title a").first();
    const slug = storySlugOf(link.attr("href"));

    if (!slug) {
      return;
    }

    const author =
      text(card.find("span.card__footer-author a").first()) ||
      text(card.find("span.card__by-author a").first());
    const chapters = text(card.find("span.card__footer-chapters").first()).replace(/\D/g, "");
    const words = text(card.find('span.card__footer-status:has(i[title="Total Words"])').first());
    const status = statusOf(card.find("span.card__footer-status[class*='_']").last());
    const ratingClasses = card.find("div.rating-letter-label").attr("class") ?? "";
    const rating = /_(everyone|teen|mature|adult)\b/.exec(ratingClasses)?.[1];

    cards.push({
      slug,
      title: text(link) || slug,
      cover: cover(card.find("a.card__image img").first()),
      ...(author ? { author } : {}),
      ...(text(card.find("div.card__content span").last())
        ? { blurb: text(card.find("div.card__content span").last()) }
        : {}),
      ...(status ? { status } : {}),
      ...(rating ? { rating: rating.charAt(0).toUpperCase() + rating.slice(1) } : {}),
      ...(chapters ? { chapters } : {}),
      ...(words ? { words } : {}),
      ...(text(card.find("span.card__footer-modified-date").first())
        ? { updated: text(card.find("span.card__footer-modified-date").first()) }
        : {}),
      genres: card
        .find("a.tag-pill._genre")
        .map((__, genre) => text($(genre)))
        .get(),
    });
  });

  return cards;
}

export function parseUpdateCards($: cheerio.CheerioAPI): UpdateCard[] {
  const cards: UpdateCard[] = [];

  $("section.latest-updates li.card._story-update").each((_, element) => {
    const card = $(element);
    const link = card.find("h3.card__title a").first();
    const slug = storySlugOf(link.attr("href"));

    if (!slug) {
      return;
    }

    const latest = card.find("ol.card__link-list li").first();
    const author = text(card.find("span.card__by-author a").first());
    const blurb = text(card.find("div.card__content span").last());
    const latestChapter = text(latest.find("a.card__link-list-link"));
    const latestDate = text(latest.find("span.date"));

    cards.push({
      slug,
      title: text(link) || slug,
      cover: cover(card.find("a.card__image img").first()),
      ...(author ? { author } : {}),
      ...(blurb ? { blurb } : {}),
      ...(latestChapter ? { latestChapter } : {}),
      ...(latestDate ? { latestDate } : {}),
    });
  });

  return cards;
}

export function parseChapterCards($: cheerio.CheerioAPI): ChapterCard[] {
  const cards: ChapterCard[] = [];

  $("ul#list-of-chapters li.card._chapter").each((_, element) => {
    const card = $(element);
    const link = card.find("h3.card__title a").first();
    const href = link.attr("href");
    const storySlug = storySlugOf(href);
    const chapterSlug = chapterSlugOf(href);

    if (!storySlug || !chapterSlug) {
      return;
    }

    const storyLink = card.find("ol.card__link-list a.card__link-list-link").first();
    const storyStatus = text(card.find("ol.card__link-list span.status").first());

    cards.push({
      storySlug,
      chapterSlug,
      title: text(link) || chapterSlug,
      cover: cover(card.find("a.card__image img").first()),
      ...(text(storyLink) ? { storyTitle: text(storyLink) } : {}),
      ...(storyStatus ? { storyStatus } : {}),
    });
  });

  return cards;
}

export function hasNoResults($: cheerio.CheerioAPI): boolean {
  return (
    $("section.search-results__content._no-results").length > 0 || $("li.no-results").length > 0
  );
}

function termOf($: cheerio.CheerioAPI, anchor: AnyNode): Term | undefined {
  const node = $(anchor);
  const slug = /_taxonomy-slug-(\S+)/.exec(node.attr("class") ?? "")?.[1];
  const name = text(node);
  return slug && name ? { id: slug, slug, name } : undefined;
}

// The summary is free HTML; the site's convention is a run of <h3> headings
// (Author, Raws, Other Names, Description) followed by their paragraphs.
function parseSummary(
  $: cheerio.CheerioAPI,
  summary: cheerio.Cheerio<AnyNode>,
): { originalAuthor?: string; altTitles: string[]; synopsis: string } {
  let originalAuthor: string | undefined;
  let altTitles: string[] = [];
  const description: string[] = [];
  let section = "";

  summary.children().each((_, element) => {
    const node = $(element);
    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? "";

    if (/^h[1-6]$/.test(tag)) {
      const heading = text(node);
      const author = /^Author:\s*(.+)$/i.exec(heading);
      if (author) {
        originalAuthor = author[1]!.trim();
        section = "author";
      } else if (/^Other Names?/i.test(heading)) {
        section = "names";
      } else if (/^Description/i.test(heading)) {
        section = "description";
      } else {
        section = "other";
      }
      return;
    }

    const content = text(node);
    if (!content) {
      return;
    }

    if (section === "names") {
      altTitles = content
        .split(/\s*,\s*/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else if (section === "description") {
      description.push(content);
    }
  });

  // Stories without the heading convention keep every paragraph as synopsis.
  const synopsis =
    description.length > 0
      ? description.join("\n\n")
      : summary
          .find("p")
          .map((_, paragraph) => text($(paragraph)))
          .get()
          .filter(Boolean)
          .join("\n\n");

  return { ...(originalAuthor ? { originalAuthor } : {}), altTitles, synopsis };
}

export function parseChapterList($: cheerio.CheerioAPI): ChapterEntry[] {
  const entries: ChapterEntry[] = [];

  $("section.story__chapters div.chapter-group").each((_, groupElement) => {
    const group = $(groupElement);
    const groupName = text(group.find("button.chapter-group__name span").first());

    group
      .find("ol.chapter-group__list li.chapter-group__list-item[data-post-id]")
      .each((__, element) => {
        const item = $(element);
        const link = item.find("a.chapter-group__list-item-link").first();
        const slug = chapterSlugOf(link.attr("href"));
        const postId = item.attr("data-post-id") ?? "";

        if (!slug || !postId) {
          return;
        }

        const stamp = Number(item.find("time.chapter-group__list-item-date").attr("datetime"));
        const date = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp * 1000) : undefined;

        entries.push({
          slug,
          postId,
          title: text(link) || slug,
          ...(groupName && !/^unassigned$/i.test(groupName) ? { group: groupName } : {}),
          ...(date ? { date } : {}),
        });
      });
  });

  return entries;
}

export function parseStory($: cheerio.CheerioAPI, slug: string): Story {
  const article = $("article.story__article").first();
  const title = text($("h1.story__identity-title").first());

  if (!title) {
    throw new Error(`No story found at ${slug}`);
  }

  const thumbnail = $("figure.story__thumbnail").first();
  const full = thumbnail.find("a").attr("href");
  const coverUrl = full && /\.(jpe?g|png|webp)$/i.test(full) ? full : cover(thumbnail.find("img"));
  const translator = text($("div.story__identity-meta a.author").first());
  const summary = parseSummary($, $("section.story__summary").first());
  const meta = $("div.story__meta").first();
  const status = statusOf(meta.find("span.story__status").first());
  const words = text(meta.find("span.story__words").first());
  const published = text(meta.find("span.story__date .hide-below-480").first());
  const rating = text(meta.find("span.story__rating").first());
  const nextChapter = text($("section.story__scheduled-chapter span").first()).replace(
    /^Next Chapter:\s*/i,
    "",
  );
  const count = Number(
    /(\d[\d,]*)\s+Chapters?/i
      .exec(text($('button[data-target="chapters"]').first()))?.[1]
      ?.replace(/,/g, ""),
  );

  const genres = $("div.story__taxonomies a._taxonomy-genre")
    .map((_, anchor) => termOf($, anchor))
    .get()
    .filter((term): term is Term => Boolean(term));
  const tags = $("section.story__tags-and-warnings a._taxonomy-post_tag")
    .map((_, anchor) => termOf($, anchor))
    .get()
    .filter((term): term is Term => Boolean(term));

  return {
    id: article.attr("data-id") ?? "",
    slug,
    title,
    cover: coverUrl,
    ...(translator ? { translator } : {}),
    ...(summary.originalAuthor ? { originalAuthor: summary.originalAuthor } : {}),
    altTitles: summary.altTitles,
    synopsis: summary.synopsis,
    ...(status ? { status } : {}),
    ...(rating ? { rating } : {}),
    ...(words ? { words } : {}),
    ...(published ? { published } : {}),
    ...(nextChapter ? { nextChapter } : {}),
    ...(Number.isFinite(count) && count > 0 ? { chapterCount: count } : {}),
    genres,
    tags,
    chapters: parseChapterList($),
  };
}

export function parseChapterBody($: cheerio.CheerioAPI): { title: string; html: string } {
  const body = $("section#chapter-content > div.resize-font").first();

  if (body.length === 0) {
    throw new Error("The chapter text is missing from the page.");
  }

  body.find("script, style, span[id^='more-']").remove();

  return {
    title: text($("h1.chapter__title").first()),
    html: body.html() ?? "",
  };
}

export function parseGenres(payload: string): Term[] {
  const rows = JSON.parse(payload) as { id?: number; name?: string; slug?: string }[];

  if (!Array.isArray(rows)) {
    throw new Error("The genre list was not a JSON array.");
  }

  return rows
    .filter((row) => typeof row.id === "number" && row.slug && row.name)
    .map((row) => ({ id: String(row.id), slug: row.slug!, name: decodeEntities(row.name!) }));
}

function decodeEntities(value: string): string {
  return cheerio.load(`<p>${value}</p>`, null, false)("p").text();
}
