/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import * as cheerio from "cheerio";

export type ChapterPage = {
  locked: boolean;
  coinPrice: number;
  protectedContent: boolean;
  images: string[];
  proseHtml: string;
};

// The reader's props sit in the RSC payload with escaped quotes; the flags we
// need are adjacent there, so a regex is enough.
export function parseChapterPage(html: string): ChapterPage {
  const lock =
    /isUnlocked\\?":(true|false),\\?"isLocked\\?":(true|false),\\?"coinPrice\\?":(\d+)/.exec(html);
  const locked = lock?.[2] === "true";
  const coinPrice = lock ? Number(lock[3]) : 0;
  const protectedContent =
    /isProtected\\?":true/.test(html) ||
    /enableDomScrambling\\?":true/.test(html) ||
    /xorEncryption\\?":(?!null)/.test(html);

  const $ = cheerio.load(html);
  const images: string[] = [];
  $('img[alt^="Page "]').each((_, img) => {
    const src = $(img).attr("src");
    if (src) images.push(src);
  });

  const proseHtml = $("[data-reader-prose]")
    .toArray()
    .map((block) => $(block).html() ?? "")
    .join("\n");

  return { locked, coinPrice, protectedContent, images, proseHtml };
}

export function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.includes("<") && !value.includes("&")) return value.trim();
  const $ = cheerio.load(value, null, false);
  $("br").replaceWith("\n");
  $("p").after("\n");
  return $.root()
    .text()
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
