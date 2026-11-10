/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";
import * as cheerio from "cheerio";

import { toXhtmlDocument } from "../novel/xhtml";

// Madara puts novel prose in div.reading-content; the comic path the base uses
// (div.page-break > img) is empty on these sites, which reads as a 0-page chapter.
export async function madaraNovelChapter(
  domain: string,
  directoryPath: string,
  chapter: Chapter,
): Promise<ChapterDetails> {
  const mangaId = chapter.sourceManga.mangaId;

  const [response, buffer] = await Application.scheduleRequest({
    url: `${domain}/${directoryPath}/${mangaId}/${chapter.chapterId}/`,
    method: "GET",
  });

  if (response.status !== 200) {
    throw new Error(`Chapter ${chapter.chapterId} answered ${response.status}`);
  }

  const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
  const body =
    $("div.reading-content div.text-left").html() ?? $("div.reading-content").html() ?? "";

  if (!body.trim()) {
    throw new Error(`No chapter text found for ${mangaId}/${chapter.chapterId}`);
  }

  return {
    id: chapter.chapterId,
    mangaId,
    type: "html",
    html: toXhtmlDocument(body, chapter.title),
  };
}

export function asNovel(manga: SourceManga): SourceManga {
  return { ...manga, mangaInfo: { ...manga.mangaInfo, contentType: "novel" } };
}
