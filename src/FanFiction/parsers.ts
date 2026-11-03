/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  GENRES,
  PLACEHOLDER_COVER,
  type Fandom,
  type Story,
  type StoryCard,
  type StoryChapter,
  type StoryMeta,
} from "./models";

const GENRE_NAMES = new Set(GENRES.map((genre) => genre.title));

export function isChallenge(body: string): boolean {
  return /<title>Just a moment\.\.\.<\/title>|challenge-platform|cf_chl_opt/i.test(body);
}

function absolute(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  return path.startsWith("http") ? path : `${DOMAIN}${path}`;
}

function coverOf(img: cheerio.Cheerio<AnyNode>, size: "75" | "180"): string {
  const original = img.attr("data-original");
  if (!original) {
    return PLACEHOLDER_COVER;
  }
  return absolute(original.replace(/\/\d+\/$/, `/${size}/`)) ?? PLACEHOLDER_COVER;
}

function parseNumber(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }
  const value = Number(text.replace(/,/g, "").trim());
  return isNaN(value) ? undefined : value;
}

/**
 * The meta line is ` - ` separated with mostly labelled tokens. Epoch spans are
 * folded into `@<epoch>` before the tags are stripped so the dates survive.
 */
export function parseMeta(html: string): StoryMeta {
  const folded = html.replace(/<span[^>]*data-xutime=['"]?(\d+)['"]?[^>]*>[^<]*<\/span>/gi, "@$1");
  const text = cheerio.load(folded, null, false).root().text().replace(/\s+/g, " ").trim();
  const tokens = text.split(/\s+-\s+/);

  const meta: StoryMeta = { genres: [], characters: [], chapters: 1, complete: false };
  const prefix: string[] = [];
  let seenRated = false;
  let seenLanguage = false;

  for (const raw of tokens) {
    const token = raw.trim();
    const labelled = /^([A-Za-z]+):\s*(.*)$/.exec(token);
    const label = labelled?.[1];
    const value = labelled?.[2] ?? "";

    if (label === "Rated") {
      meta.rated = value.replace(/^Fiction\s+/, "").trim();
      seenRated = true;
      continue;
    }
    if (!seenRated) {
      prefix.push(token);
      continue;
    }
    if (!seenLanguage) {
      meta.language = token;
      seenLanguage = true;
      continue;
    }

    switch (label) {
      case "Chapters":
        meta.chapters = parseNumber(value) ?? 1;
        continue;
      case "Words":
        meta.words = parseNumber(value);
        continue;
      case "Reviews":
        meta.reviews = parseNumber(value);
        continue;
      case "Favs":
        meta.favs = parseNumber(value);
        continue;
      case "Follows":
        meta.follows = parseNumber(value);
        continue;
      case "Updated":
        meta.updated = parseNumber(value.replace("@", ""));
        continue;
      case "Published":
        meta.published = parseNumber(value.replace("@", ""));
        continue;
      case "Status":
        meta.complete = /complete/i.test(value);
        continue;
      case "id":
        continue;
      default:
        break;
    }

    if (token === "Complete") {
      meta.complete = true;
      continue;
    }

    const parts = token.split("/");
    if (meta.genres.length === 0 && parts.every((part) => GENRE_NAMES.has(part))) {
      meta.genres = parts;
      continue;
    }

    meta.characters.push(
      ...token
        .split(/,\s*/)
        .map((name) => name.replace(/[[\]]/g, "").trim())
        .filter(Boolean),
    );
  }

  if (prefix.length) {
    meta.fandom = prefix.join(" - ");
  }
  return meta;
}

export function parseCards(html: string): StoryCard[] {
  const $ = cheerio.load(html);
  const cards: StoryCard[] = [];

  $("div.z-list").each((_, element) => {
    const card = $(element);
    const link = card.find("a.stitle").first();
    const id = /\/s\/(\d+)\//.exec(link.attr("href") ?? "")?.[1];
    if (!id) {
      return;
    }

    const body = card.find("div.z-indent.z-padtop").first();
    const metaHtml = body.find("div.z-padtop2").first().html() ?? "";
    const summary = body.clone().children("div.z-padtop2").remove().end().text().trim();

    cards.push({
      id,
      title: link.text().trim(),
      author: card.find('a[href^="/u/"]').first().text().trim() || undefined,
      cover: coverOf(link.find("img").first(), "75"),
      summary,
      meta: parseMeta(metaHtml),
    });
  });

  return cards;
}

export function hasNextPage(html: string): boolean {
  return /Next\s*(?:&#187;|»|&raquo;)/i.test(html);
}

export function parseFandoms(html: string): Fandom[] {
  const $ = cheerio.load(html);
  const fandoms: Fandom[] = [];

  $("#list_output div > a").each((_, element) => {
    const link = $(element);
    const path = (link.attr("href") ?? "").replace(/^\/|\/$/g, "");
    const name = link.text().trim();
    if (!path || !name) {
      return;
    }
    const count = link.next("span").text().replace(/[()]/g, "").trim();
    fandoms.push({ name, path, count });
  });

  return fandoms;
}

export function parseChapterSelect(html: string): StoryChapter[] {
  const $ = cheerio.load(html);
  const chapters: StoryChapter[] = [];

  $("#chap_select")
    .first()
    .find("option")
    .each((_, element) => {
      const option = $(element);
      const number = Number(option.attr("value"));
      if (isNaN(number)) {
        return;
      }
      const title = option
        .text()
        .replace(/^\d+\.\s*/, "")
        .trim();
      chapters.push({ number, title: title || `Chapter ${number}` });
    });

  return chapters;
}

export function parseStory(html: string, id: string): Story {
  const $ = cheerio.load(html);
  const profile = $("#profile_top").first();

  if (profile.length === 0) {
    const warning = $(".gui_warning").first().text().replace(/\s+/g, " ").trim();
    throw new Error(warning || "Story not found");
  }

  const title = profile.find("b").first().text().trim();
  const author = profile.find('a[href^="/u/"]').first().text().trim() || undefined;
  const summary = profile.children("div").first().text().trim();
  const metaHtml = profile.find("span.xgray").first().html() ?? "";
  const meta = parseMeta(metaHtml);

  const large = $("#img_large img").first();
  const cover = large.length ? coverOf(large, "180") : PLACEHOLDER_COVER;

  const crumbs = $("#pre_story_links a");
  const category = crumbs.first().text().trim() || undefined;
  const fandom = crumbs.length > 1 ? crumbs.last().text().trim() : undefined;

  let chapters = parseChapterSelect(html);
  if (chapters.length === 0) {
    chapters = [{ number: 1, title: title || "Chapter 1" }];
  }
  if (meta.chapters < chapters.length) {
    meta.chapters = chapters.length;
  }

  return { id, title, author, summary, cover, category, fandom, meta, chapters };
}

export function parseChapterText(html: string): { title?: string; body: string } {
  const $ = cheerio.load(html);
  const text = $("#storytext").first();

  if (text.length === 0) {
    const message = $(".gui_warning").first().text().replace(/\s+/g, " ").trim();
    if (message) {
      throw new Error(message);
    }
    throw new Error(
      /Chapter not found/i.test(html) ? "Chapter not found" : "The chapter text could not be found",
    );
  }

  const selected = $("#chap_select option[selected]").first().text().trim();
  const title = selected.replace(/^\d+\.\s*/, "") || undefined;

  return { title, body: text.html() ?? "" };
}
