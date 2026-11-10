/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  type Chapter,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import type { MangaStreamGeneric } from "../mangastream/main";
import type { MangaStreamSearchResultItem } from "../mangastream/models";
import { MangaStreamParser } from "../mangastream/parsers";

// The Themesia "lightnovel" theme shares the filter vocabulary of its comic
// siblings but none of their markup: listings are `div.maindet` cards, series
// details sit in `div.serto*` boxes and chapters in `div.eplister` with flat
// root permalinks instead of `div#chapterlist` with `data-num`.
export class LightNovelParser extends MangaStreamParser {
  override parseSearchResults($: CheerioAPI): MangaStreamSearchResultItem[] {
    const results: MangaStreamSearchResultItem[] = [];

    for (const element of $(".maindet").toArray()) {
      const href = $("div.mdthumb a, h2 a", element).first().attr("href") ?? "";
      const parts = href.replace(/\/$/, "").split("/");
      const slug = parts.pop() ?? "";
      const path = parts.pop() ?? "";

      if (!slug || !path) {
        continue;
      }

      results.push({
        mangaId: slug,
        title: Application.decodeHTMLEntities(
          $("h2 a", element).first().attr("title") ?? $("h2", element).first().text().trim(),
        ),
        imageUrl: this.getImageSrc($("img", element).first()) ?? "",
        subtitle: $("span.nchapter a", element).first().text().trim(),
        path,
      });
    }

    return results;
  }

  override parseMangaDetails(
    $: CheerioAPI,
    mangaId: string,
    source: MangaStreamGeneric,
  ): SourceManga {
    const title = Application.decodeHTMLEntities($("h1.entry-title").first().text().trim());
    const alternative = Application.decodeHTMLEntities($("span.alter").first().text().trim());

    const rows = new Map<string, string>();
    $("div.sertoauth div.serl").each((_, element) => {
      const label = $("span.sername", element).text().replace(/\s+/g, " ").trim().toLowerCase();
      const value = $("span.serval", element).text().replace(/\s+/g, " ").trim();
      if (label && value) {
        rows.set(label, value);
      }
    });

    const tags: Tag[] = [];
    $("div.sertogenre a").each((_, element) => {
      const name = $(element).text().replace(/^#\s*/, "").trim();
      const id = ($(element).attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";
      if (name && id) {
        tags.push({ id, title: name });
      }
    });

    // Inline ad scripts sit between the paragraphs, and .text() would read
    // their bodies as prose; paragraphs also need their breaks kept.
    const story = $("div.sersys, div.entry-content").first().clone();
    story.find("script, style, ins, .code-block").remove();

    const paragraphs = story
      .find("p")
      .toArray()
      .map((node) => $(node).text().replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0);

    const synopsis = Application.decodeHTMLEntities(
      paragraphs.length > 0 ? paragraphs.join("\n\n") : story.text().replace(/\s+/g, " ").trim(),
    );

    const rating = Number(
      $("div.rating strong, span.numscore")
        .first()
        .text()
        .replace(/[^\d.]/g, ""),
    );
    const status = $("div.sertostat span").first().text().trim();

    const additionalInfo: Record<string, string> = {};
    for (const [label, key] of [
      ["native language", "Language"],
      ["released", "Released"],
      ["author", "Author"],
      ["artist", "Artist"],
      ["year", "Year"],
    ] as const) {
      const value = rows.get(label);
      if (value) {
        additionalInfo[key] = value;
      }
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: alternative ? [alternative] : [],
        thumbnailUrl: this.getImageSrc($("div.sertothumb img, div.thumb img").first()) ?? "",
        synopsis,
        contentRating: source.contentRating ?? ContentRating.EVERYONE,
        contentType: "novel",
        shareUrl: `${source.domain}/${source.directoryPath}/${mangaId}/`,
        ...(status ? { status } : {}),
        ...(rows.get("author") ? { author: rows.get("author")! } : {}),
        ...(isNaN(rating) || rating <= 0 ? {} : { rating }),
        ...(tags.length ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  override parseChapterList(
    $: CheerioAPI,
    sourceManga: SourceManga,
    source: MangaStreamGeneric,
  ): Chapter[] {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const element of $("div.eplister li, div.eplisterfull li").toArray()) {
      const href = $("a", element).first().attr("href") ?? "";

      if (!href) {
        continue;
      }

      // Chapters are root-level permalinks here, so the id is the whole slug.
      const chapterId = href.replace(/\/$/, "").split("/").pop() ?? "";

      if (!chapterId || seen.has(chapterId)) {
        continue;
      }
      seen.add(chapterId);

      const numberText = $("div.epl-num", element).text().trim();
      const chapNum = Number(/(\d+(?:\.\d+)?)/.exec(numberText)?.[1] ?? NaN);
      const title = Application.decodeHTMLEntities($("div.epl-title", element).text().trim());
      const date = new Date($("div.epl-date", element).text().trim());

      chapters.push({
        chapterId,
        sourceManga,
        langCode: source.language,
        chapNum: isNaN(chapNum) ? chapters.length + 1 : chapNum,
        ...(title ? { title } : {}),
        ...(isNaN(date.getTime()) ? {} : { publishDate: date }),
      });
    }

    return chapters;
  }

  // The filter dropdowns are `c4` (genres) and three `c1` radio lists; the comic
  // theme tags its genre list `genrez`, which this one does not.
  override parseTags($: CheerioAPI): TagSection[] {
    const sections: TagSection[] = [
      { id: "0", title: "genres", tags: [] },
      { id: "1", title: "status", tags: [] },
      { id: "2", title: "type", tags: [] },
      { id: "3", title: "order", tags: [] },
    ];

    const lists = $("ul.dropdown-menu.c4, ul.dropdown-menu.c1").toArray();

    for (let index = 0; index < sections.length; index += 1) {
      const list = lists[index];
      const section = sections[index];

      if (!list || !section) {
        continue;
      }

      for (const row of $("li", list).toArray()) {
        const value = $("input", row).attr("value") ?? "";
        const title = $("label", row).text().trim();

        if (!value || !title) {
          continue;
        }

        section.tags.push({ id: `${section.title}_${value}`, title });
      }
    }

    return sections;
  }
}
