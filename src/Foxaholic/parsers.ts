/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  PLACEHOLDER_COVER,
  type FoxCard,
  type FoxChapterRow,
  type FoxNovel,
  type Option,
} from "./models";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const JUNK_SELECTOR = [
  "script",
  "style",
  "noscript",
  "iframe",
  "ins",
  "form",
  "#text-chapter-toolbar",
  ".chapter-warning",
  ".sharedaddy",
  ".unlock-buttons",
].join(", ");

// Ad slots the child theme injects around the text. One of them holds an
// unclosed <script>, which makes parsers nest the whole body inside the slot,
// so the slots are unwrapped rather than removed.
const AD_WRAPPER_SELECTOR = "div[id^=foxaholic-], div[class^=foxaholic-], div[id^=bg-ssp-]";

function stripAds($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>): void {
  scope.find(JUNK_SELECTOR).remove();

  for (let depth = 0; depth < 10; depth++) {
    const wrappers = scope.find(AD_WRAPPER_SELECTOR);
    if (wrappers.length === 0) {
      break;
    }
    wrappers.each((_, node) => {
      $(node).replaceWith($(node).contents());
    });
  }
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return cheerio.load(`<p>${text}</p>`, null, false)("p").text();
}

/** Novel slug from any URL under /novel/. */
export function novelIdOf(href: string | undefined): string | undefined {
  const match = /\/novel\/([^/?#]+)/.exec(href ?? "");
  return match?.[1];
}

/** Chapter path after /novel/<slug>/, e.g. `chapter-27` or `volume-1/chapter-6`. */
export function chapterIdOf(href: string | undefined): string | undefined {
  const match = /\/novel\/[^/?#]+\/(.+?)\/?(?:[?#].*)?$/.exec(href ?? "");
  return match?.[1];
}

function coverOf(img: cheerio.Cheerio<AnyNode>): string {
  const src = img.attr("data-src") ?? img.attr("src") ?? "";
  // The theme's lazy placeholder is the only cover some rows carry.
  if (!src || /dflazy/.test(src)) {
    return PLACEHOLDER_COVER;
  }
  return src.startsWith("http") ? src : `${DOMAIN}${src}`;
}

export function parseDate(text: string | undefined): Date | undefined {
  const value = clean(text ?? "");
  if (!value) {
    return undefined;
  }

  const relative = /^(\d+|an?)\s+(second|sec|minute|min|hour|day|week|month|year)s?\s+ago$/i.exec(
    value,
  );
  if (relative) {
    const count = /^\d+$/.test(relative[1]!) ? Number(relative[1]) : 1;
    const unit = relative[2]!.toLowerCase();
    const ms: Record<string, number> = {
      second: 1000,
      sec: 1000,
      minute: 60_000,
      min: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    };
    return new Date(Date.now() - count * (ms[unit] ?? 0));
  }

  const long = /^([a-z]+)\s+(\d{1,2}),\s+(\d{4})$/i.exec(value);
  if (long) {
    const month = MONTHS.indexOf(long[1]!.toLowerCase());
    if (month >= 0) {
      return new Date(Date.UTC(Number(long[3]), month, Number(long[2])));
    }
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/.exec(value);
  if (iso) {
    return new Date(
      Date.UTC(
        Number(iso[1]),
        Number(iso[2]) - 1,
        Number(iso[3]),
        Number(iso[4] ?? 0),
        Number(iso[5] ?? 0),
        Number(iso[6] ?? 0),
      ),
    );
  }

  return undefined;
}

function cardFromDetail($: cheerio.CheerioAPI, node: AnyNode): FoxCard | undefined {
  const card = $(node);
  const link = card.find(".post-title a").first();
  const id = novelIdOf(link.attr("href"));
  const title = clean(link.text());
  if (!id || !title) {
    return undefined;
  }

  const first = card.find(".list-chapter .chapter-item").first();
  const latest = clean(first.find(".chapter a").text());
  const volume = clean(first.find(".vol a").text());

  return {
    id,
    title,
    cover: coverOf(card.find(".item-thumb img").first()),
    ...(latest ? { latest: volume ? `${volume} ${latest}` : latest } : {}),
    ...(first.length ? { latestDate: clean(first.find(".post-on").text()) } : {}),
    genres: [],
    premium: first.hasClass("premium"),
  };
}

function cardFromGrid($: cheerio.CheerioAPI, node: AnyNode): FoxCard | undefined {
  const card = $(node);
  const link = card.find(".post-title a").first();
  const id = novelIdOf(link.attr("href"));
  const title = clean(link.text());
  if (!id || !title) {
    return undefined;
  }

  return {
    id,
    title,
    cover: coverOf(card.find(".item-thumb img").first()),
    genres: card
      .find(".meta-item.genres a")
      .map((_, a) => clean($(a).text()))
      .get()
      .filter(Boolean),
    summary: clean(card.find(".meta-item.description p").first().text()),
    premium: false,
  };
}

/** The three shortcode sections of the home page, keyed by their heading. */
export function parseHome(html: string): {
  favorites: FoxCard[];
  newProjects: FoxCard[];
  latest: FoxCard[];
} {
  const $ = cheerio.load(html);
  const sections: Record<string, FoxCard[]> = {};

  $(".c-blog__heading h4").each((_, heading) => {
    const name = clean($(heading).text()).toLowerCase();
    const wrap = $(heading).closest(".tab-wrap");
    const container = wrap.length
      ? wrap.nextAll(".tab-content-wrap").first()
      : $(heading).closest(".c-blog__heading").nextAll(".c-page").first();

    const cards: FoxCard[] = [];
    container.find(".page-item-detail").each((__, node) => {
      const card = cardFromDetail($, node);
      if (card) cards.push(card);
    });
    container.find(".grid9 .item").each((__, node) => {
      const card = cardFromGrid($, node);
      if (card) cards.push(card);
    });

    if (cards.length) {
      sections[name] = cards;
    }
  });

  const pick = (needle: string): FoxCard[] => {
    const key = Object.keys(sections).find((name) => name.includes(needle));
    if (!key) {
      throw new Error(`The home page no longer carries a "${needle}" section`);
    }
    return sections[key]!;
  };

  return {
    favorites: pick("favorites"),
    newProjects: pick("new projects"),
    latest: pick("latest releases"),
  };
}

export function parseListing(html: string): { items: FoxCard[]; hasNext: boolean } {
  const $ = cheerio.load(html);
  const items: FoxCard[] = [];

  $(".c-tabs-item__content").each((_, node) => {
    const row = $(node);
    const link = row.find(".post-title a").first();
    const id = novelIdOf(link.attr("href"));
    const title = clean(link.text());
    if (!id || !title) {
      return;
    }

    const latest = clean(row.find(".latest-chap .chapter a").first().text());

    items.push({
      id,
      title,
      cover: coverOf(row.find(".tab-thumb img").first()),
      ...(latest ? { latest } : {}),
      latestDate: clean(row.find(".post-on .font-meta").first().text()),
      genres: row
        .find(".mg_genres a")
        .map((__, a) => clean($(a).text()))
        .get()
        .filter(Boolean),
      status: clean(row.find(".mg_status .summary-content").text()) || undefined,
      premium: false,
    });
  });

  return { items, hasNext: $(".nav-previous a").length > 0 };
}

/** Genre checkboxes of the advanced search form on any listing page. */
export function parseGenres(html: string): Option[] {
  const $ = cheerio.load(html);
  const genres: Option[] = [];

  $('form.search-advanced-form input[name="genre[]"]').each((_, input) => {
    const slug = clean($(input).attr("value") ?? "");
    const label = clean($(`label[for="${$(input).attr("id")}"]`).text());
    if (slug && label && !/\s/.test(slug)) {
      genres.push({ id: slug, title: label });
    }
  });

  return genres;
}

function parseChapterRows($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>): FoxChapterRow[] {
  const rows: FoxChapterRow[] = [];

  scope.find("li.wp-manga-chapter").each((_, node) => {
    const li = $(node);
    const link = li.find("a").first();
    const href = link.attr("href") ?? "";
    const title = clean(link.text());
    const date = clean(li.find(".chapter-release-date i").text()) || undefined;

    if (!title) {
      return;
    }

    const coins = /\bcoin-(\d+)\b/.exec(li.attr("class") ?? "");
    if (href === "#" || !href) {
      // Locked rows carry no URL; the id keeps the price so opening one can say why.
      rows.push({
        id: `premium-${coins?.[1] ?? "0"}-${title
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, "-")
          .replace(/^[-.]+|[-.]+$/g, "")}`,
        title,
        ...(date ? { date } : {}),
        coins: Number(coins?.[1] ?? 0),
      });
      return;
    }

    const id = chapterIdOf(href);
    if (id) {
      rows.push({ id, title, ...(date ? { date } : {}) });
    }
  });

  return rows;
}

/** Rows from the ajax chapter endpoint, which answers with the same `li` list. */
export function parseChapterList(html: string): FoxChapterRow[] {
  const $ = cheerio.load(html);
  return parseChapterRows($, $.root());
}

export function parseNovel(html: string, id: string): FoxNovel {
  const $ = cheerio.load(html);
  const title = clean($(".post-title h1").first().text());

  if (!title) {
    throw new Error(`No novel found at /novel/${id}/`);
  }

  const rows = new Map<string, cheerio.Cheerio<AnyNode>>();
  $(".summary_content .post-content_item, .post-status .post-content_item").each((_, node) => {
    const label = clean($(node).find(".summary-heading").text()).toLowerCase();
    if (label) {
      rows.set(label, $(node).find(".summary-content").first());
    }
  });

  const texts = (label: string): string[] =>
    (rows.get(label)?.find("a").length
      ? rows
          .get(label)!
          .find("a")
          .map((_, a) => clean($(a).text()))
          .get()
      : clean(rows.get(label)?.text() ?? "")
          .split(",")
          .map((part) => part.trim())
    ).filter(Boolean);

  const taxonomy = (label: string, base: string): { slug: string; title: string }[] =>
    (rows.get(label)?.find("a") ?? $())
      .map((_, a) => {
        const slug = new RegExp(`/${base}/([^/?#]+)`).exec($(a).attr("href") ?? "")?.[1];
        const name = clean($(a).text());
        return slug && name ? { slug, title: name } : undefined;
      })
      .get()
      .filter((entry): entry is { slug: string; title: string } => entry !== undefined);

  const summary = $(".description-summary .summary__content").first();
  stripAds($, summary);
  const synopsis = summary
    .find("p")
    .map((_, p) => clean($(p).text()))
    .get()
    // The first paragraph is often just the word "Synopsis" used as a heading.
    .filter(
      (line, index) => line && line !== "\u00a0" && !(index === 0 && /^synopsis:?$/i.test(line)),
    )
    .join("\n\n");

  const cover = $(".summary_image img").first();
  const ogImage = $('meta[property="og:image"]').attr("content");

  const altLabel = rows.has("alternative") ? "alternative" : "title";

  return {
    id,
    title,
    altTitles: texts(altLabel).filter((alt) => alt.toLowerCase() !== title.toLowerCase()),
    cover: cover.length ? coverOf(cover) : ogImage || PLACEHOLDER_COVER,
    authors: texts("author"),
    teams: texts("team").map((team) => team.replace(/^translator:\s*/i, "")),
    genres: taxonomy("genre", "genre"),
    tags: taxonomy(rows.has("tags") ? "tags" : "tag(s)", "(?:novel-)?tag"),
    type: clean(rows.get("type")?.text() ?? "") || undefined,
    translation: clean(rows.get("translation")?.text() ?? "") || undefined,
    status: clean(rows.get("novel")?.text() ?? "") || undefined,
    rank: clean(rows.get("rank")?.text() ?? "") || undefined,
    synopsis,
    rows: parseChapterRows($, $(".listing-chapters_wrap")),
    deferredChapters: $("#manga-chapters-holder").length > 0,
  };
}

export function parseChapterText(html: string): { title?: string; body: string } {
  const $ = cheerio.load(html);
  const content = $(".reading-content .text-left, .reading-content .text-right").first();

  if (content.length === 0) {
    throw new Error("The chapter text could not be found; it may need a login or coins");
  }

  stripAds($, content);

  const hasText = content
    .find("p")
    .toArray()
    .some((p) => clean($(p).text()).replace(/ /g, "") !== "");
  if (!hasText) {
    throw new Error("The chapter body is empty; it is probably locked or password-protected");
  }

  const crumb = clean($("ol.breadcrumb li.active").first().text());
  const title = crumb ? decodeEntities(crumb) : undefined;

  return { ...(title ? { title } : {}), body: content.html() ?? "" };
}
