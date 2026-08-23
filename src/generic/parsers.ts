/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  type Chapter,
  type ChapterDetails,
  ContentRating,
  type DiscoverSection,
  type DiscoverSectionItem,
  DiscoverSectionType,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import { Element } from "domhandler"; // Import Element from domhandler

import { getUseHQThumbnails, getUsePostIds } from "./forms";
import { MadaraGeneric } from "./main";
import { decryptData, extractVariableValues } from "./utils";

export class MadaraParser {
  async parseMangaDetails(
    $: CheerioAPI,
    mangaId: string,
    source: MadaraGeneric,
  ): Promise<SourceManga> {
    const title: string = Application.decodeHTMLEntities(
      $("div.post-title h1, div#manga-title h1").children().remove().end().text().trim(),
    );

    const secondaryTitleBox = $("h5:contains(Alternative), h5:contains(Alt Name(s))")
      .parent()
      .next();
    const secondaryTitles: string[] = [];

    for (const title of secondaryTitleBox
      .text()
      .trim()
      .split(/\s*[/,;]\s*/)) {
      if (title == "" || !title) {
        continue;
      }

      secondaryTitles.push(Application.decodeHTMLEntities(title?.trim()));
    }

    const author: string = Application.decodeHTMLEntities(
      $("div.author-content").first().text().replace("\\n", "").trim(),
    ).replace("Updating", "");
    const artist: string = Application.decodeHTMLEntities(
      $("div.artist-content").first().text().replace("\\n", "").trim(),
    ).replace("Updating", "");
    const synopsis: string = Application.decodeHTMLEntities(
      $("div.description-summary, div.summary-container, div.manga-excerpt").first().text(),
    )
      .replace("Show more", "")
      .trim();

    const shareUrl: string = `${source.domain}/${await source.getDirectoryPath()}/${mangaId}`;

    const rating: number = (Number($("#averagerate").text().trim()) || 0) / 10;

    const image: string = encodeURI(
      await this.getImageSrc($("div.summary_image img").first(), source),
    );
    const parsedStatus: string = $("div.summary-content", $("div.post-content_item").last())
      .text()
      .trim();

    let status: string;
    switch (parsedStatus.toUpperCase()) {
      case "COMPLETED":
        status = "Completed";
        break;
      default:
        status = "Ongoing";
        break;
    }

    let contentRating = source.defaultContentRating;

    // Firstly check if the 18+ badge is present on the item
    const adultBadge = $("span.manga-title-badges.custom.adult");
    if (adultBadge.length) {
      contentRating = ContentRating.ADULT;
    }

    const genres: Tag[] = [];
    for (const obj of $("div.genres-content a").toArray()) {
      const title = $(obj).text();
      const id = this.idCleaner($(obj).attr("href") ?? "");

      if (!title || !id) continue;

      // If item contains NSFW, set item to adult
      if (["adult", "mature"].includes(title.toLowerCase())) {
        contentRating = ContentRating.ADULT;
      }

      genres.push({ title: title, id: id });
    }
    const tagGroups: TagSection[] = [{ title: "genres", id: "genres", tags: genres }];

    return {
      mangaId,
      mangaInfo: {
        shareUrl: shareUrl,
        rating: rating,
        primaryTitle: title,
        secondaryTitles: secondaryTitles,
        thumbnailUrl: image,
        author: author,
        artist: artist,
        tagGroups: tagGroups,
        synopsis: synopsis,
        contentRating: contentRating,
        status: status,
      },
    };
  }

  parseChapterList($: CheerioAPI, sourceManga: SourceManga, source: MadaraGeneric): Chapter[] {
    const chapters: Chapter[] = [];
    const nodeArray = $("li.wp-manga-chapter  ").toArray();
    let nodesProcessed = 0;

    // For each available chapter..
    for (const obj of nodeArray) {
      const sortingIndex = nodeArray.length - nodesProcessed++;
      const id = this.idCleaner($("a", obj).first().attr("href") ?? "");

      const chapName = $("a", obj).first().text().trim() ?? "";
      const chapNumRegex = id.match(
        /(?:chapter|ch.*?)(\d+\.?\d?(?:[-_]\d+)?)|(\d+\.?\d?(?:[-_]\d+)?)$/,
      );
      let chapNum: string | number =
        chapNumRegex && chapNumRegex[1]
          ? chapNumRegex[1].replace(/[-_]/gm, ".")
          : (chapNumRegex?.[2] ?? "0");

      // make sure the chapter number is a number and not NaN
      chapNum = parseFloat(chapNum) ?? 0;

      let mangaTime: Date;
      const timeSelector = $(
        "span.chapter-release-date > a, span.chapter-release-date > span.c-new-tag > a",
        obj,
      ).attr("title");
      if (typeof timeSelector !== "undefined") {
        // Firstly check if there is a NEW tag, if so parse the time from this
        mangaTime = this.parseDate(timeSelector ?? "");
      } else {
        // Else get the date from the info box
        mangaTime = this.parseDate($("span.chapter-release-date > i", obj).text().trim());
      }

      // Check if the date is a valid date, else return the current date
      if (!mangaTime.getTime()) mangaTime = new Date();

      if (!id || typeof id === "undefined" || id === "#") {
        console.log(
          `Could not parse out ID when getting chapters for mangaId:${sourceManga.mangaId} parsedId: ${id}`,
        );
        continue;
      }

      chapters.push({
        sourceManga: sourceManga,
        chapterId: id,
        langCode: source.language,
        chapNum: chapNum,
        title: chapName ? Application.decodeHTMLEntities(chapName) : "",
        publishDate: mangaTime,
        sortingIndex: sortingIndex,
        volume: 0,
      });
    }

    return chapters;
  }

  async parseChapterDetails(
    $: CheerioAPI,
    chapter: Chapter,
    selector: string,
    source: MadaraGeneric,
  ): Promise<ChapterDetails> {
    const pages: string[] = [];

    for (const obj of $(selector).get()) {
      const page = await this.getImageSrc($(obj) as Cheerio<Element>, source);
      if (!page) {
        console.log(
          `Could not parse pages for mangaId:${chapter.sourceManga.mangaId} chapterId:${chapter.chapterId}`,
        );
        continue;
      }
      pages.push(encodeURI(page));
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: pages,
    };
  }

  async parseProtectedChapterDetails(
    $: CheerioAPI,
    chapter: Chapter,
    selector: string,
    source: MadaraGeneric,
  ): Promise<ChapterDetails> {
    if (!$(selector).length) {
      return this.parseChapterDetails($, chapter, selector, source);
    }

    const variables = extractVariableValues(
      // @ts-expect-error It's fine
      $(selector).get()[0].children[0].data,
    );
    if (!("chapter_data" in variables) || !("wpmangaprotectornonce" in variables)) {
      throw new Error(
        `Could not parse page for mangaId:${chapter.sourceManga.mangaId} chapterId:${chapter.chapterId}. Reason: Lacks sufficient data`,
      );
    }

    const chapterList = await decryptData(
      variables["chapter_data"],
      variables["wpmangaprotectornonce"],
    );
    const pages: string[] = [];

    chapterList.forEach((page: string) => {
      pages.push(encodeURI(page));
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: pages,
    };
  }

  async parseDiscoverSections(
    $: CheerioAPI,
    section: DiscoverSection,
    source: MadaraGeneric,
  ): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];

    for (const obj of $("div.page-item-detail").toArray()) {
      const image = encodeURI((await this.getImageSrc($("img", obj), source)) ?? "");
      const title = $("a", $("h3.h5", obj)).last().text();

      const slug = this.idCleaner($("a", $("h3.h5", obj)).attr("href") ?? "");
      const postId = $("div", obj).attr("data-post-id") ?? "";
      const subtitle = $("span.font-meta.chapter", obj).first().text().trim();

      if (isNaN(Number(postId)) || !title) {
        continue;
      }

      switch (section.type) {
        case DiscoverSectionType.featured:
          items.push({
            mangaId: getUsePostIds(source.usePostIds) ? postId : slug,
            imageUrl: image,
            title: Application.decodeHTMLEntities(title),
            supertitle: Application.decodeHTMLEntities(subtitle),
            type: "featuredCarouselItem",
          });
          break;

        case DiscoverSectionType.prominentCarousel:
          items.push({
            mangaId: getUsePostIds(source.usePostIds) ? postId : slug,
            imageUrl: image,
            title: Application.decodeHTMLEntities(title),
            subtitle: Application.decodeHTMLEntities(subtitle),
            type: "prominentCarouselItem",
          });
          break;

        case DiscoverSectionType.simpleCarousel:
          items.push({
            mangaId: getUsePostIds(source.usePostIds) ? postId : slug,
            imageUrl: image,
            title: Application.decodeHTMLEntities(title),
            subtitle: Application.decodeHTMLEntities(subtitle),
            type: "simpleCarouselItem",
          });
          break;
      }
    }

    return items;
  }

  async parseSearchTags($: CheerioAPI): Promise<TagSection[]> {
    const genres: Tag[] = [];

    for (const obj of $(".checkbox-group div label").toArray()) {
      const title = $(obj).text().trim();
      const id = $(obj).attr("for") ?? "";

      if (!id || !title) {
        continue;
      }

      genres.push({ title: title, id: id });
    }

    const TagSections: TagSection[] = [{ title: "Genres", id: "genres", tags: genres }];

    return TagSections;
  }

  async parseSearchResults($: CheerioAPI, source: MadaraGeneric) {
    const results = [];

    for (const obj of $(source.searchMangaSelector).toArray()) {
      const slug: string =
        ($("a", obj).attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";

      if (!slug) {
        throw new Error(`Unable to parse slug  (${slug})!`);
      }

      const title: string = $("a", obj).attr("title") ?? "";
      const image: string = encodeURI(await this.getImageSrc($("img", obj), source));
      const rating: string = $(source.searchRatingSelector, obj).text().trim() ?? "";
      const subtitle: string = $("span.font-meta.chapter", obj).text().trim();

      results.push({
        slug: slug,
        image: image,
        title: Application.decodeHTMLEntities(title),
        subtitle: Application.decodeHTMLEntities(
          subtitle ? `${subtitle} | ⭐${rating}` : `⭐${rating}`,
        ),
      });
    }

    return results;
  }

  parseDirectoryPath($: CheerioAPI, source: MadaraGeneric): string {
    // Parse path from first search result
    const searchResult = $(source.searchMangaSelector).first();
    const searchResultPath: string =
      ($("a", searchResult).attr("href") ?? "").replace(/\/$/, "").split("/").slice(-2).shift() ??
      "";
    if (searchResultPath) {
      return searchResultPath;
    }

    // Fallback: Parse path from meta property
    const url = $('meta[property="og:url"]').attr("content") ?? "";
    const fullPath = url.replace(source.domain, "");
    const pathSegment = (fullPath.split("/")[1] ?? "").trim();
    if (pathSegment) {
      return pathSegment;
    }

    return "manga";
  }

  // Utils
  async getImageSrc(
    imageObj: Cheerio<Element> | undefined,
    source: MadaraGeneric,
  ): Promise<string> {
    let image: string | undefined;
    if (typeof imageObj?.attr("data-src") != "undefined" && imageObj?.attr("data-src") != "") {
      image = imageObj?.attr("data-src");
    } else if (
      typeof imageObj?.attr("data-lazy-src") != "undefined" &&
      imageObj?.attr("data-lazy-src") != ""
    ) {
      image = imageObj?.attr("data-lazy-src");
    } else if (typeof imageObj?.attr("srcset") != "undefined" && imageObj?.attr("srcset") != "") {
      image = imageObj?.attr("srcset")?.split(" ")[0] ?? "";
    } else if (typeof imageObj?.attr("src") != "undefined" && imageObj?.attr("src") != "") {
      image = imageObj?.attr("src");
    } else if (
      typeof imageObj?.attr("data-cfsrc") != "undefined" &&
      imageObj?.attr("data-cfsrc") != ""
    ) {
      image = imageObj?.attr("data-cfsrc");
    } else {
      image = "";
    }

    if (getUseHQThumbnails()) {
      image = image?.replace(/-\d+x\d+/g, "");
    }

    if (image?.startsWith("/")) {
      image = source.domain + image;
    }

    image = image?.trim().replace(/(\s{2,})/gi, "");

    image = image?.replace(/http:\/\/\//g, "http://"); // only changes urls with http protocol
    image = image?.replace(/http:\/\//g, "https://");
    // Malforumed url fix (Turns https:///example.com into https://example.com (or the http:// equivalent))
    image = image?.replace(/https:\/\/\//g, "https://"); // only changes urls with https protocol

    return decodeURI(Application.decodeHTMLEntities(image ?? ""));
  }

  parseDate = (date: string): Date => {
    date = date.toUpperCase();

    if (date.includes("LESS THAN AN HOUR") || date.includes("JUST NOW")) {
      return new Date();
    }

    if (date.includes("YESTERDAY")) {
      return new Date(Date.now() - 86400000);
    }

    const timeUnits: Record<string, number> = {
      YEAR: 31556952000,
      MONTH: 2592000000,
      WEEK: 604800000,
      DAY: 86400000,
      HOUR: 3600000,
      MINUTE: 60000,
      SECOND: 1000,
    };

    const match = date.match(/(\d+)\s*(YEAR|MONTH|WEEK|DAY|HOUR|MINUTE|SECOND)/);
    if (match) {
      const [, numStr, unit] = match;
      const number = Number(numStr);
      return new Date(Date.now() - number * timeUnits[unit]);
    }

    return new Date(date);
  };

  idCleaner(str: string): string {
    let cleanId: string | null = str;
    cleanId = cleanId.replace(/\/$/, "");
    cleanId = cleanId.split("/").pop() ?? null;

    if (!cleanId) throw new Error(`Unable to parse id for ${str}`);
    return cleanId;
  }
}
