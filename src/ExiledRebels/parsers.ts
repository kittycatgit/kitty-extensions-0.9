/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";

import { DOMAIN, type HomePick, type PageMeta, type WpPage } from "./models";

const LABELS: Record<string, keyof PageMeta> = {
  author: "author",
  genre: "genres",
  genres: "genres",
  translator: "translator",
  translators: "translator",
  editor: "editor",
  editors: "editor",
  year: "year",
  "novel status in country of origin": "originStatus",
  "novel status": "originStatus",
  "translation status": "translationStatus",
};

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function decodeEntities(html: string): string {
  return clean(cheerio.load(html, null, false).root().text());
}

function isContentImage(src: string | undefined): src is string {
  return !!src && /wp-content\/uploads|i0\.wp\.com/.test(src) && !/s\.w\.org/.test(src);
}

// The series pages are hand-written: labelled lines above a SUMMARY block,
// then the plugin-generated chapter list. Labels and values are often split
// across spans, so everything is matched on the flattened text of each block.
export function parsePageMeta(page: WpPage): PageMeta {
  const html = page.content.rendered;
  const tocStart = html.search(/<div[^>]*class="lcp_catlist/);
  const head = tocStart >= 0 ? html.slice(0, tocStart) : html;
  const $ = cheerio.load(head, null, false);

  const meta: PageMeta = { genres: [], summary: "", tocCount: 0 };
  const summary: string[] = [];
  let inSummary = false;

  $("p, h1, h2, h3, h4, h5, h6, li").each((_, el) => {
    const line = clean($(el).text());
    if (!line) {
      return;
    }

    if (/^summary\s*:?\s*$/i.test(line)) {
      inSummary = true;
      return;
    }

    if (/^chapters?\s*:?\s*$/i.test(line) || /^~+brought to you/i.test(line)) {
      inSummary = false;
      return;
    }

    const summaryInline = /^summary\s*:\s*(.+)$/i.exec(line);
    if (summaryInline) {
      inSummary = true;
      summary.push(summaryInline[1]!);
      return;
    }

    if (inSummary) {
      summary.push(line);
      return;
    }

    const labelled = /^([a-z() ]+?)\s*:\s*(.*)$/i.exec(line);
    if (labelled) {
      const key = LABELS[labelled[1]!.toLowerCase().replace(/\(s\)/g, "s").trim()];
      const value = clean(labelled[2]!);
      if (key === "genres") {
        meta.genres = value
          .split(/,|·|\//)
          .map((genre) => clean(genre).replace(/\.$/, ""))
          .filter((genre) => genre.length > 0 && genre.length <= 40);
        return;
      }
      if (key && key !== "summary" && key !== "tocCount" && key !== "lastTocTitle" && value) {
        if (!meta[key]) {
          meta[key] = value;
        }
        return;
      }
    }

    // "Title by Author" or " by Author" lines carry the author without a label.
    const by = /^(?:.*?\s)?by\s+(.+)$/i.exec(line);
    if (by && !meta.author && /[A-Za-z]/.test(by[1]!)) {
      meta.author = clean(by[1]!);
    }
  });

  meta.summary = summary.join("\n\n");

  const cover = $("img[src]")
    .map((_, el) => $(el).attr("src"))
    .get()
    .find(isContentImage);
  if (cover) {
    meta.cover = cover;
  }

  if (tocStart >= 0) {
    const toc = cheerio.load(html.slice(tocStart), null, false);
    const links = toc(`div.lcp_catlist a[href^="${DOMAIN}/"]`);
    meta.tocCount = links.length;
    const last = links.last();
    if (last.length) {
      meta.lastTocTitle = clean(last.text());
    }
  }

  return meta;
}

// Beaver Builder pages list series as photo links; headings precede their row.
export function parsePhotoLinks(html: string): string[] {
  const $ = cheerio.load(html);
  return $(".fl-photo-content > a[href]")
    .map((_, el) => $(el).attr("href") ?? "")
    .get()
    .filter((href) => href.startsWith(DOMAIN));
}

// Home page editorial rows: a heading followed by hand-picked novel links.
export function parseHomePicks(html: string): HomePick[] {
  const $ = cheerio.load(html);
  const picks: HomePick[] = [];
  let current: HomePick | undefined;

  $("span.fl-heading-text, .fl-photo-content > a[href]").each((_, el) => {
    if (el.tagName === "span") {
      const title = clean($(el).text());
      const id = `pick-${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`;
      current = { id, title, links: [] };
      return;
    }

    const href = $(el).attr("href") ?? "";
    if (current && href.startsWith(DOMAIN)) {
      if (!picks.includes(current)) {
        picks.push(current);
      }
      current.links.push(href);
    }
  });

  return picks;
}

export function slugOfLink(href: string): string {
  return href
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop()!;
}

const CHAPTER_TITLE = /(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i;
const EXTRA_TITLE = /\b(?:extra|prologue|epilogue|side story|afterword|interlude)\b/i;

export type ChapterTitle = { number: number; title?: string };

// Returns undefined for posts that are notices rather than chapters.
export function parseChapterTitle(raw: string): ChapterTitle | undefined {
  const text = decodeEntities(raw);
  const numbered = CHAPTER_TITLE.exec(text);

  if (numbered) {
    const rest = clean(
      text.slice(numbered.index + numbered[0].length).replace(/^[\s:：\-–—]+/, ""),
    );
    return { number: Number(numbered[1]), ...(rest ? { title: rest } : {}) };
  }

  if (EXTRA_TITLE.test(text)) {
    return { number: 0, title: text };
  }

  return undefined;
}

export function isEndTitle(title: string | undefined): boolean {
  return !!title && /[([{]\s*(the\s+)?(end|final)\s*[)\]}]|\bEND\s*:/i.test(title);
}

// Chapter bodies are clean WordPress HTML; only the share widgets, the
// navigation blocks and the Patreon plug need to go.
export function cleanChapterHtml(html: string): string {
  const $ = cheerio.load(html, null, false);
  $("div.wp-post-navigation, div.sharedaddy, script, style").remove();
  $("p").each((_, el) => {
    const node = $(el);
    if (
      node.find('a[href*="patreon.com"]').length > 0 ||
      (!clean(node.text()) && node.find("img").length === 0)
    ) {
      node.remove();
    }
  });
  $("h1").each((_, el) => {
    if (!clean($(el).text())) {
      $(el).remove();
    }
  });
  return $.html();
}
