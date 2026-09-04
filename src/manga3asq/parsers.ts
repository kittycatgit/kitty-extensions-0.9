/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type Chapter,
  type DiscoverSection,
  type DiscoverSectionItem,
  type SourceManga,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { getUsePostIds } from "../generic/forms";
import type { MadaraGeneric } from "../generic/main";
import { MadaraParser } from "../generic/parsers";

// WordPress renders the Arabic locale's month names, which Date cannot read;
// without this every chapter falls back to "now" and the whole list reads as
// published today.
const ARABIC_MONTHS: Record<string, number> = {
  يناير: 0,
  فبراير: 1,
  مارس: 2,
  أبريل: 3,
  إبريل: 3,
  مايو: 4,
  يونيو: 5,
  يوليو: 6,
  أغسطس: 7,
  اغسطس: 7,
  سبتمبر: 8,
  أكتوبر: 9,
  اكتوبر: 9,
  نوفمبر: 10,
  ديسمبر: 11,
};

export class Manga3asqParser extends MadaraParser {
  // parseDate is a field on the base, so it cannot be reached through super.
  private readonly base = new MadaraParser();

  // The class starts at 0621, not 0600: the Arabic comma sits inside the lower
  // block and would otherwise be swallowed into the month name.
  override parseDate = (date: string): Date => {
    const match = /(\d{1,2})\s*([\u0621-\u06FF]+)[\u060C,]?\s*(\d{4})/.exec(date);
    const month = match ? ARABIC_MONTHS[match[2] ?? ""] : undefined;

    if (match && month !== undefined) {
      return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
    }

    return this.base.parseDate(date);
  };

  // Each listing title carries a scanlator badge linking to the group's X
  // account, so the first anchor is not the series. The title already uses the
  // last one; the id has to match it or every row points at the wrong series.
  // The theme wraps the date in span.timediff, so the base's direct-child
  // selector reads nothing and every chapter falls back to "now".
  override parseChapterList(
    $: CheerioAPI,
    sourceManga: SourceManga,
    source: MadaraGeneric,
  ): Chapter[] {
    const rows = $("li.wp-manga-chapter").toArray() as Element[];
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const [index, obj] of rows.entries()) {
      const link = $("a", obj).first();
      const chapterId = this.idCleaner(link.attr("href") ?? "");

      if (!chapterId || chapterId === "#" || seen.has(chapterId)) {
        continue;
      }

      seen.add(chapterId);

      const title = Application.decodeHTMLEntities(link.text().trim());
      const parsed = Number(/([0-9]+(?:\.[0-9]+)?)/.exec(title)?.[1] ?? chapterId);
      const published = this.parseDate($("span.chapter-release-date i", obj).first().text().trim());

      chapters.push({
        sourceManga,
        chapterId,
        langCode: source.language,
        chapNum: Number.isFinite(parsed) ? parsed : 0,
        volume: 0,
        title,
        sortingIndex: rows.length - index,
        ...(published.getTime() ? { publishDate: published } : {}),
      });
    }

    return chapters;
  }

  override async parseDiscoverSections(
    $: CheerioAPI,
    section: DiscoverSection,
    source: MadaraGeneric,
  ): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];

    for (const obj of $("div.page-item-detail").toArray() as Element[]) {
      const heading = $("a", $("h3.h5", obj)).last();
      const title = heading.text().trim();
      const slug = this.idCleaner(heading.attr("href") ?? "");
      const postId = $("div", obj).attr("data-post-id") ?? "";

      if (!slug || !title) {
        continue;
      }

      const mangaId = getUsePostIds(source.usePostIds) ? postId : slug;
      const image = encodeURI((await this.getImageSrc($("img", obj), source)) ?? "");
      const subtitle = Application.decodeHTMLEntities(
        $("span.font-meta.chapter", obj).first().text().trim(),
      );

      if (section.type === DiscoverSectionType.featured) {
        items.push({
          type: "featuredCarouselItem",
          mangaId,
          imageUrl: image,
          title: Application.decodeHTMLEntities(title),
          supertitle: subtitle,
        });
        continue;
      }

      items.push({
        type:
          section.type === DiscoverSectionType.prominentCarousel
            ? "prominentCarouselItem"
            : "simpleCarouselItem",
        mangaId,
        imageUrl: image,
        title: Application.decodeHTMLEntities(title),
        subtitle,
      });
    }

    return items;
  }
}
