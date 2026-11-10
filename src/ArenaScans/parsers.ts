/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  DiscoverSectionType,
  type DiscoverSection,
  type DiscoverSectionItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import type { MadaraGeneric } from "../generic/main";
import { MadaraParser } from "../generic/parsers";

// This is Madara underneath — the chapter ajax route answers the usual markup —
// but the "madara-child-mk" theme replaces every page with its own: listing
// cards are `a.acard` and the series page is a `h*`-prefixed hero block.
export class ArenaScansParser extends MadaraParser {
  override async parseMangaDetails(
    $: CheerioAPI,
    mangaId: string,
    source: MadaraGeneric,
  ): Promise<SourceManga> {
    const title = Application.decodeHTMLEntities($("h1.htitle").first().text().trim());

    const tags: Tag[] = [];
    $("div.hchips--genres a.chip, a.chip--tag").each((_, element) => {
      const name = $(element).text().trim();
      const id = ($(element).attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";

      if (name && id && !tags.some((tag) => tag.id === id)) {
        tags.push({ id, title: name });
      }
    });

    const status = $("span.htag--status").first().text().trim().toUpperCase();
    const synopsis = Application.decodeHTMLEntities(
      $("div.syn").first().text().replace(/\s+/g, " ").trim(),
    );

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: encodeURI($("div.hposter img").first().attr("src") ?? ""),
        synopsis,
        contentRating: source.defaultContentRating ?? ContentRating.EVERYONE,
        shareUrl: `${source.domain}/manga/${mangaId}`,
        ...(status ? { status } : {}),
        ...(tags.length ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
      },
    };
  }

  override async parseSearchResults($: CheerioAPI, _source: MadaraGeneric) {
    return this.cards($).map((card) => ({
      slug: card.slug,
      image: card.image,
      title: card.title,
      subtitle: card.subtitle,
    }));
  }

  override async parseDiscoverSections(
    $: CheerioAPI,
    section: DiscoverSection,
    _source: MadaraGeneric,
  ): Promise<DiscoverSectionItem[]> {
    return this.cards($).map((card) =>
      section.type === DiscoverSectionType.featured
        ? {
            mangaId: card.slug,
            imageUrl: card.image,
            title: card.title,
            supertitle: card.subtitle,
            type: "featuredCarouselItem" as const,
          }
        : {
            mangaId: card.slug,
            imageUrl: card.image,
            title: card.title,
            subtitle: card.subtitle,
            type: "simpleCarouselItem" as const,
          },
    );
  }

  private cards($: CheerioAPI): {
    slug: string;
    title: string;
    image: string;
    subtitle: string;
  }[] {
    const cards: { slug: string; title: string; image: string; subtitle: string }[] = [];
    const seen = new Set<string>();

    for (const element of $("a.acard").toArray()) {
      const card = $(element);
      const slug = (card.attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";
      const title = card.attr("title") ?? card.find("img").first().attr("alt") ?? "";

      if (!slug || !title || seen.has(slug)) {
        continue;
      }
      seen.add(slug);

      cards.push({
        slug,
        title: Application.decodeHTMLEntities(title),
        image: encodeURI(card.find("img").first().attr("src") ?? ""),
        subtitle: card
          .find("div.ac-status, span.ac-chap")
          .first()
          .text()
          .replace(/\s+/g, " ")
          .trim(),
      });
    }

    return cards;
  }
}
